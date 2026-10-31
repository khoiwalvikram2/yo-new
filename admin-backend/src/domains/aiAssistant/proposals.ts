import { and, eq, gt, lt } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { aiActionProposals } from '@shared/db/schema.js'
import { getEnv } from '@src/config/env.js'
import { getTool, isWriteTool } from './tools/registry.js'
import type { AiContext } from './tools/types.js'
import { hasPermission } from '@src/domains/common/auth.js'

/**
 * Pending writes proposed by the assistant.
 *
 * The model never performs a change. It emits a proposal, an operator reads the
 * rendered summary and confirms, and only then does the action run — under the
 * confirming operator's own context, so the usual permission checks and audit
 * writes apply. This is what keeps an instruction smuggled into a player name
 * or a support message from moving anything: the worst it can produce is a card
 * somebody declines.
 *
 * Confirmation carries an id and nothing else. The arguments live here, so what
 * an operator approved is exactly what runs.
 */

export interface StoredProposal {
  id: string
  toolName: string
  summary: string
  args: Record<string, unknown>
  status: string
  expiresAt: Date
}

export async function createProposal(params: {
  tenant: string
  conversationId: string
  adminUserId: number
  toolName: string
  summary: string
  args: Record<string, unknown>
}): Promise<StoredProposal> {
  const ttlSeconds = Number(getEnv().AI_PROPOSAL_TTL_SECONDS) || 900
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const [row] = await db
    .insert(aiActionProposals)
    .values({
      tenant: params.tenant,
      conversationId: params.conversationId,
      adminUserId: params.adminUserId,
      toolName: params.toolName,
      args: params.args,
      summary: params.summary,
      status: 'pending',
      expiresAt,
    })
    .returning()

  return {
    id: row.id,
    toolName: row.toolName,
    summary: row.summary,
    args: row.args as Record<string, unknown>,
    status: row.status,
    expiresAt: row.expiresAt,
  }
}

/**
 * Proposals still awaiting a decision.
 *
 * Lapsed rows are excluded rather than merely marked, because status alone
 * would show an expired change as an actionable card that fails the moment
 * somebody clicks it. Sweeping first keeps the stored status honest too, so
 * this needs no separate scheduled job.
 */
export async function listPendingProposals(
  tenant: string,
  conversationId: string
): Promise<StoredProposal[]> {
  await expireStaleProposals()

  const rows = await db
    .select()
    .from(aiActionProposals)
    .where(
      and(
        eq(aiActionProposals.tenant, tenant),
        eq(aiActionProposals.conversationId, conversationId),
        eq(aiActionProposals.status, 'pending'),
        gt(aiActionProposals.expiresAt, new Date())
      )
    )
  return rows.map((r) => ({
    id: r.id,
    toolName: r.toolName,
    summary: r.summary,
    args: r.args as Record<string, unknown>,
    status: r.status,
    expiresAt: r.expiresAt,
  }))
}

export interface ExecutionOutcome {
  status: 'confirmed' | 'rejected' | 'expired' | 'failed' | 'already_resolved'
  message: string
  result?: unknown
}

/**
 * Runs a proposal once.
 *
 * The claim is a conditional UPDATE: only a row that is still pending and
 * unconsumed is taken. Two confirmations racing therefore produce one execution
 * and one `already_resolved`, without a read-then-write window between them.
 */
export async function confirmProposal(params: {
  tenant: string
  proposalId: string
  adminUserId: number
  ctx: AiContext
}): Promise<ExecutionOutcome> {
  const claimed = await db
    .update(aiActionProposals)
    .set({ consumed: true })
    .where(
      and(
        eq(aiActionProposals.id, params.proposalId),
        eq(aiActionProposals.tenant, params.tenant),
        eq(aiActionProposals.adminUserId, params.adminUserId),
        eq(aiActionProposals.status, 'pending'),
        eq(aiActionProposals.consumed, false)
      )
    )
    .returning()

  if (claimed.length === 0) {
    return {
      status: 'already_resolved',
      message: 'That action is no longer pending. It may have been confirmed, rejected or expired.',
    }
  }

  const proposal = claimed[0]

  if (proposal.expiresAt.getTime() < Date.now()) {
    await db
      .update(aiActionProposals)
      .set({ status: 'expired', resolvedAt: new Date() })
      .where(eq(aiActionProposals.id, proposal.id))
    return { status: 'expired', message: 'That action expired before it was confirmed. Ask again to get a fresh one.' }
  }

  const tool = getTool(proposal.toolName)
  if (!tool || !isWriteTool(tool)) {
    await db
      .update(aiActionProposals)
      .set({ status: 'failed', error: 'Unknown or non-write tool', resolvedAt: new Date() })
      .where(eq(aiActionProposals.id, proposal.id))
    return { status: 'failed', message: `"${proposal.toolName}" is not an action this assistant can perform.` }
  }

  // Checked again at confirmation: the proposal may have been queued minutes
  // ago, and permissions can be revoked in between. The confirming operator is
  // the one whose authority actually applies the change.
  const { domain, action } = tool.requiredPermission
  if (!hasPermission(params.ctx?.permissions, domain, action)) {
    await db
      .update(aiActionProposals)
      .set({ status: 'failed', error: 'permission denied', resolvedAt: new Date() })
      .where(eq(aiActionProposals.id, proposal.id))
    return {
      status: 'failed',
      message: `You do not have permission to do that (${domain}:${action} required).`,
    }
  }

  try {
    const result = await tool.execute(proposal.args as Record<string, unknown>, params.ctx)
    await db
      .update(aiActionProposals)
      .set({ status: 'confirmed', result: result as any, resolvedAt: new Date() })
      .where(eq(aiActionProposals.id, proposal.id))
    return { status: 'confirmed', message: proposal.summary, result }
  } catch (err: any) {
    const message = err?.message ?? 'The action failed.'
    await db
      .update(aiActionProposals)
      .set({ status: 'failed', error: String(message).slice(0, 2000), resolvedAt: new Date() })
      .where(eq(aiActionProposals.id, proposal.id))
    return { status: 'failed', message }
  }
}

export async function rejectProposal(params: {
  tenant: string
  proposalId: string
  adminUserId: number
}): Promise<ExecutionOutcome> {
  const rows = await db
    .update(aiActionProposals)
    .set({ status: 'rejected', consumed: true, resolvedAt: new Date() })
    .where(
      and(
        eq(aiActionProposals.id, params.proposalId),
        eq(aiActionProposals.tenant, params.tenant),
        eq(aiActionProposals.adminUserId, params.adminUserId),
        eq(aiActionProposals.status, 'pending')
      )
    )
    .returning()

  if (rows.length === 0) {
    return { status: 'already_resolved', message: 'That action is no longer pending.' }
  }
  return { status: 'rejected', message: 'Action discarded.' }
}

/** Marks lapsed proposals so they stop appearing as pending. Called by
 *  listPendingProposals, which is the only place that needs it. */
async function expireStaleProposals(): Promise<number> {
  const rows = await db
    .update(aiActionProposals)
    .set({ status: 'expired', resolvedAt: new Date() })
    .where(and(eq(aiActionProposals.status, 'pending'), lt(aiActionProposals.expiresAt, new Date())))
    .returning({ id: aiActionProposals.id })
  return rows.length
}
