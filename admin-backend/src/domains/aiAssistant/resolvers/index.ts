import { and, asc, eq } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { aiConversations, aiMessages } from '@shared/db/schema.js'
import { isAiConfigured } from '../openaiClient.js'
import { runTurn } from '../orchestrator.js'
import { confirmProposal, listPendingProposals, rejectProposal } from '../proposals.js'
import { ensureAgentCanMutate } from '@src/domains/common/auth.js'
import { aiWhitelabelSettings } from '@shared/db/schema.js'
import { getEntitlement, upsertSettings, type LimitPeriod } from '../entitlement.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * GraphQL surface for the assistant.
 *
 * Each resolver derives tenant and identity from the caller's context and hands
 * that same context to the assistant, so tools reach exactly the data the
 * caller could reach through the UI. Nothing here widens access.
 */

function requireAdmin(ctx: any): { tenant: string; adminUserId: number } {
  const user = ctx?.user
  if (!user) throw new Error('Unauthorized')
  // The assistant is an admin-portal feature; agent tokens have their own,
  // narrower surface and are not given tool access.
  if (user.type === 'agent') {
    throw new Error('The assistant is available to portal administrators.')
  }
  const adminUserId = Number(user.sub ?? user.id)
  if (!Number.isFinite(adminUserId)) throw new Error('Unauthorized')

  const tenant = ctx?.tenant ?? ctx?.whitelabel?.id
  if (!tenant) throw new Error('Tenant could not be determined for this request.')

  return { tenant: String(tenant), adminUserId }
}

/**
 * Only Super Admin owns the allowance. The check mirrors
 * directorModeUtils: role names vary across seeds, so it matches the same way
 * rather than assuming one spelling.
 */
function requireSuperAdmin(ctx: any): string {
  const roles: string[] = ctx?.user?.roles ?? []
  const isSuperAdmin = roles.some(
    (r) =>
      r === 'Super Admin' ||
      r.toLowerCase() === 'super_admin' ||
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
  )
  if (!isSuperAdmin) {
    throw new Error('Only a Super Admin can change assistant settings.')
  }
  return String(ctx?.user?.sub ?? 'unknown')
}

const VALID_PERIODS: LimitPeriod[] = ['monthly', 'daily', 'total']

export const aiAssistantResolvers = {
  Query: {
    aiAvailability: async (_parent: unknown, _args: unknown, ctx: any) => {
      // Requires a session: whether the assistant is configured is server state,
      // not something an anonymous caller needs to know.
      requireAdmin(ctx)
      const enabled = isAiConfigured()
      return {
        enabled,
        reason: enabled ? null : 'OPENAI_API_KEY is not set on the server.',
      }
    },

    aiEntitlement: async (_parent: unknown, _args: unknown, ctx: any) => {
      const { tenant } = requireAdmin(ctx)
      return getEntitlement(tenant)
    },

    aiWhitelabelSettings: async (_parent: unknown, _args: unknown, ctx: any) => {
      requireAdmin(ctx)
      requireSuperAdmin(ctx)

      const rows = await db.select().from(aiWhitelabelSettings)
      // Usage is derived, not stored, so it cannot drift from the transcript.
      return Promise.all(
        rows.map(async (row) => {
          const entitlement = await getEntitlement(row.tenant)
          return {
            tenant: row.tenant,
            enabled: row.enabled,
            chatLimit: row.chatLimit,
            limitPeriod: entitlement.limitPeriod,
            used: entitlement.used,
            remaining: entitlement.remaining,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt?.toISOString() ?? null,
          }
        })
      )
    },

    aiConversation: async (_parent: unknown, args: { id: string }, ctx: any) => {
      const { tenant, adminUserId } = requireAdmin(ctx)

      const [conversation] = await db
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, args.id),
            eq(aiConversations.tenant, tenant),
            eq(aiConversations.adminUserId, adminUserId)
          )
        )
        .limit(1)

      if (!conversation) return null

      const rows = await db
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversation.id))
        .orderBy(asc(aiMessages.seq))

      const pending = await listPendingProposals(tenant, conversation.id)

      return {
        id: conversation.id,
        title: conversation.title,
        // Tool traffic is machinery, not conversation; the transcript shows what
        // the operator and the assistant actually said.
        messages: rows
          .filter((r) => r.role === 'user' || (r.role === 'assistant' && r.content))
          .map((r) => ({
            id: r.id,
            role: r.role,
            content: r.content,
            createdAt: r.createdAt.toISOString(),
          })),
        pendingProposals: pending.map((p) => ({
          id: p.id,
          toolName: p.toolName,
          summary: p.summary,
          expiresAt: p.expiresAt.toISOString(),
        })),
      }
    },
  },

  Mutation: {
    aiChat: async (
      _parent: unknown,
      args: { message: string; conversationId?: string | null },
      ctx: any
    ) => {
      const { tenant, adminUserId } = requireAdmin(ctx)
      const message = (args.message ?? '').trim()
      if (!message) throw new Error('Message cannot be empty.')
      if (message.length > 4000) throw new Error('Message is too long.')

      const turn = await runTurn({
        tenant,
        adminUserId,
        conversationId: args.conversationId ?? null,
        message,
        ctx,
      })

      return {
        conversationId: turn.conversationId,
        reply: turn.reply,
        proposals: turn.proposals.map((p) => ({
          id: p.id,
          toolName: p.toolName,
          summary: p.summary,
          expiresAt: p.expiresAt.toISOString(),
        })),
        toolsUsed: turn.toolsUsed,
      }
    },

    aiConfirmAction: async (_parent: unknown, args: { proposalId: string }, ctx: any) => {
      const { tenant, adminUserId } = requireAdmin(ctx)
      // Read-only admins must not be able to apply a queued change.
      ensureAgentCanMutate(ctx)
      const outcome = await confirmProposal({
        tenant,
        proposalId: args.proposalId,
        adminUserId,
        ctx,
      })
      return { status: outcome.status, message: outcome.message }
    },

    setAiWhitelabelSettings: async (
      _parent: unknown,
      args: { tenant: string; enabled: boolean; chatLimit: number; limitPeriod?: string | null },
      ctx: any
    ) => {
      requireAdmin(ctx)
      const actorId = requireSuperAdmin(ctx)
      ensureAgentCanMutate(ctx)

      const tenant = (args.tenant ?? '').trim()
      if (!tenant) throw new Error('A whitelabel must be named.')

      const limitPeriod = (args.limitPeriod ?? 'monthly') as LimitPeriod
      if (!VALID_PERIODS.includes(limitPeriod)) {
        throw new Error(`limitPeriod must be one of: ${VALID_PERIODS.join(', ')}`)
      }
      if (!Number.isFinite(args.chatLimit) || args.chatLimit < 0) {
        throw new Error('chatLimit must be zero or a positive whole number.')
      }

      await upsertSettings({
        tenant,
        enabled: Boolean(args.enabled),
        chatLimit: Math.floor(args.chatLimit),
        limitPeriod,
        updatedBy: actorId,
      })

      // Spending authority changed hands; that belongs in the audit trail.
      await recordAuditDb({
        tenant,
        actorId,
        domain: 'aiAssistant',
        action: 'set_ai_whitelabel_settings',
        resourceType: 'ai_whitelabel_settings',
        resourceId: tenant,
        after: { enabled: args.enabled, chatLimit: args.chatLimit, limitPeriod },
      }).catch((err) => console.error('[ai] failed to record settings audit:', err?.message ?? err))

      const entitlement = await getEntitlement(tenant)
      return {
        tenant,
        enabled: entitlement.enabled,
        chatLimit: entitlement.chatLimit,
        limitPeriod: entitlement.limitPeriod,
        used: entitlement.used,
        remaining: entitlement.remaining,
        updatedBy: actorId,
        updatedAt: new Date().toISOString(),
      }
    },

    aiRejectAction: async (_parent: unknown, args: { proposalId: string }, ctx: any) => {
      const { tenant, adminUserId } = requireAdmin(ctx)
      const outcome = await rejectProposal({ tenant, proposalId: args.proposalId, adminUserId })
      return { status: outcome.status, message: outcome.message }
    },
  },
}
