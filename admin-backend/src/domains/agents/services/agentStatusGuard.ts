import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { auditLogs } from '@shared/db/schema.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'

/**
 * Who may change an agent's status when the caller is an agent (owner decision 1, 2026-10-21).
 *
 * An agent may restrict any agent below it. A restriction (INACTIVE, SUSPENDED, BLOCKED) can only
 * be changed again by the caller's own branch: the caller or an agent below it must be the one who
 * set it. Otherwise a sub-agent that an admin or a higher agent suspended could simply be switched
 * back on by its parent — or first made stricter (which records the parent as its setter) and then
 * lifted. Admin callers are not limited by this rule.
 *
 * "Who set it" is read from the audit log: the newest agent row that changed the status (its `after`
 * carries a status that differs from its `before`; a creation row has no `before` and counts).
 */

export interface StatusSetter {
  actorId: string
  status: string
}

export type StatusChangeVerdict = { ok: true } | { ok: false; message: string }

const norm = (status: unknown) => String(status ?? '').trim().toUpperCase()

/** Pure rule (exported for tests). `callerSubtreeIds` includes the caller itself. */
export function agentMayChangeStatus(args: {
  currentStatus: string
  nextStatus: string
  lastSetter: StatusSetter | null
  callerSubtreeIds: readonly string[]
}): StatusChangeVerdict {
  const current = norm(args.currentStatus)
  const next = norm(args.nextStatus)
  if (current === next) return { ok: true }
  if (current === 'ACTIVE') return { ok: true }
  const setter = args.lastSetter
  const setByOwnBranch =
    setter !== null && norm(setter.status) === current && args.callerSubtreeIds.includes(String(setter.actorId))
  if (setByOwnBranch) return { ok: true }
  return {
    ok: false,
    message:
      'This agent was restricted by an admin or a higher-level agent. Only they can change its status.',
  }
}

/** The newest audit entry that set this agent's status, or null. */
export async function findLastStatusSetter(agentId: string): Promise<StatusSetter | null> {
  const rows = await db
    .select({ actorId: auditLogs.actorId, after: auditLogs.after })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, 'agent'),
        eq(auditLogs.resourceId, String(agentId)),
        sql`${auditLogs.after} ? 'status'`,
        // Only a row that changed the status set it. update_agent records the status on every save, so an
        // unchanged one would otherwise make whoever saved the agent its setter, and a parent could lift an
        // admin's suspension by saving the sub-agent once first.
        sql`upper(${auditLogs.before}->>'status') is distinct from upper(${auditLogs.after}->>'status')`
      )
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const status = (row.after as { status?: unknown } | null)?.status
  return { actorId: String(row.actorId), status: String(status ?? '') }
}

const repo = new AgentsRepo()

/**
 * Throws when an agent caller may not move `target` from `currentStatus` to `nextStatus`.
 * No-op for admin callers. The caller's subtree check (target strictly below the caller) is
 * done by the resolver before this.
 */
export async function ensureAgentMayChangeStatus(
  ctx: any,
  target: { id: string; status: string },
  nextStatus: string
): Promise<void> {
  const callerAgentId = ctx?.user?.type === 'agent' ? ctx?.user?.agentId : null
  if (!callerAgentId) return
  if (norm(target.status) === norm(nextStatus) || norm(target.status) === 'ACTIVE') return
  const [lastSetter, callerSubtreeIds] = await Promise.all([
    findLastStatusSetter(target.id),
    repo.getDescendantIds(String(callerAgentId)),
  ])
  const verdict = agentMayChangeStatus({
    currentStatus: target.status,
    nextStatus,
    lastSetter,
    callerSubtreeIds,
  })
  if (!verdict.ok) throw new Error(verdict.message)
}
