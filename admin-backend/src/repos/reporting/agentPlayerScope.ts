import { sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { buildAgentFilterCTE } from '../common/AgentFilterUtils.js'

/**
 * The players an agent may see, as one SQL subquery, for reporting queries.
 *
 * An agent's players are every player whose `users.agent_id` is the agent or
 * any descendant (agent_hierarchy_closure, depth-0 self row included) PLUS the
 * players those players referred (`referral_attributions`). Both routes are the
 * canonical ones from `buildAgentFilterCTE`; this wraps that CTE so it can sit
 * inside a drizzle query-builder `where()` as `column IN (WITH … SELECT …)`,
 * which PostgreSQL accepts. The CTE is reused rather than copied so reporting
 * and the live analytics repos agree on who an agent's players are.
 *
 * Why reporting needed this: the reporting repos scoped agents three different
 * ways, none of them complete —
 *   - the live paths matched `users.agent_id IN subtree` (referral players lost),
 *   - the snapshot paths matched `reporting_daily_snapshots.agent_id IN subtree`
 *     with no `player_id` filter, so each day's agent-level row and the
 *     player-level rows it was built from were summed together (double count),
 *   - pnl/exposure matched `agent_id = <agent>` only (sub-agents' players lost),
 *   - and the matka drill-downs did not scope at all.
 *
 * Note: `buildAgentFilterCTE` counts only `status = 'confirmed'` referrals, while
 * `PlayerAuthService.getAgentPlayerIds` counts referrals of any status. The two
 * definitions disagree for pending/rejected attributions; reporting follows the
 * CTE (confirmed only), as the live analytics dashboards already do.
 */
export function agentPlayerIdsSubquery(agentId: string, tenant: string | undefined | null): SQL {
  const { cte } = buildAgentFilterCTE(agentId, tenant && tenant.trim() ? tenant : 'default')
  return sql`(${cte} SELECT player_id FROM agent_players)`
}

/**
 * `<column> IN (<agent's players>)`. Pass the bet table's user id column, or
 * `users.id` when the query already left-joins users on the bet's user id, or a
 * snapshot's `player_id` column.
 */
export function inAgentPlayers(column: AnyColumn | SQL, agentId: string, tenant: string | undefined | null): SQL {
  return sql`${column} IN ${agentPlayerIdsSubquery(agentId, tenant)}`
}

/** The agent's player ids, materialised (same definition as the subquery). */
export async function listAgentPlayerIds(agentId: string, tenant: string | undefined | null): Promise<number[]> {
  const { db } = await import('@/db/client.js')
  const result: any = await db.execute(sql`SELECT player_id FROM ${agentPlayerIdsSubquery(agentId, tenant)} AS ap`)
  const rows: any[] = Array.isArray(result) ? result : result?.rows ?? []
  return rows.map((r) => Number(r.player_id)).filter((n) => Number.isFinite(n))
}

/**
 * The part of a player's agent chain an agent caller may see.
 *
 * `ancestors` are closure rows for the player's direct agent, sorted root first
 * (depth descending). An admin (no caller agent) sees the whole chain. An agent
 * sees the chain from itself down — never its upline's usernames — and `null`
 * means the direct agent is outside the caller's subtree altogether (possible
 * for a referral-linked player), so the caller should be shown no agent at all.
 */
export function callerVisibleChain<T extends { ancestorId: string; depth: number }>(
  ancestors: T[],
  callerAgentId: string | undefined | null,
): T[] | null {
  if (!callerAgentId) return ancestors
  const self = ancestors.find((a) => a.ancestorId === callerAgentId)
  return self ? ancestors.filter((a) => a.depth <= self.depth) : null
}
