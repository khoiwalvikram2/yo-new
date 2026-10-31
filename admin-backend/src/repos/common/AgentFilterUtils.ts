import { sql } from 'drizzle-orm'

export interface AgentFilterResult {
  cte: ReturnType<typeof sql>
  userCondition: ReturnType<typeof sql>
}

/**
 * Build a CTE that resolves every player belonging to an agent's subtree.
 * Works for sports, casino and matka — any table with a user_id column.
 *
 * A player reaches an agent by one of two routes, and both must be covered:
 *
 *   1. Direct assignment — `users.agent_id` points at the agent. This is how
 *      agent-created players are linked (playerType AGENT_CREDIT /
 *      SHARING_AGENT_PLAYER / COMMISSION_AGENT_PLAYER).
 *   2. Referral — the player was referred by someone already in the subtree,
 *      recorded in `referral_attributions`.
 *
 * Earlier revisions resolved route 2 only, which silently returned zero rows
 * for every agent whose players were assigned directly — the common case.
 * Agent-scoped analytics therefore reported 0 bets while the reporting repos,
 * which filter on `users.agent_id`, reported the true totals for the same agent.
 *
 * The subtree comes from `agent_hierarchy_closure`, which stores a depth-0
 * self-row, so the agent's own players are always included, and arbitrary depth
 * is supported (not just direct children).
 *
 * @param agentId - Agent UUID (from JWT context)
 * @param tenant - Tenant string
 * @param userIdColumn - Column name for user_id (e.g. 'sb.user_id' or 'cb.user_id')
 */
export function buildAgentFilterCTE(
  agentId: string | undefined,
  tenant: string,
  userIdColumn: string = 'user_id'
): AgentFilterResult {
  if (!agentId) {
    return {
      cte: sql``,
      userCondition: sql``
    }
  }
  
  return {
    cte: sql`
      WITH agent_descendants AS (
        SELECT descendant_id
        FROM agent_hierarchy_closure
        WHERE ancestor_id = ${agentId}
      ),
      agent_direct_players AS (
        SELECT id AS player_id
        FROM users
        WHERE agent_id IN (SELECT descendant_id FROM agent_descendants)
          AND tenant = ${tenant}
      ),
      agent_referred_players AS (
        SELECT DISTINCT referee_id AS player_id
        FROM referral_attributions
        WHERE referrer_id IN (SELECT player_id FROM agent_direct_players)
          AND status = 'confirmed'
          AND tenant = ${tenant}
      ),
      agent_players AS (
        SELECT player_id FROM agent_direct_players
        UNION
        SELECT player_id FROM agent_referred_players
      )
    `,
    // userCondition starts with "AND" for direct use in WHERE clauses
    // For use in reduce() patterns, use userConditionForReduce() helper
    userCondition: sql.raw(`AND ${userIdColumn} IN (SELECT player_id FROM agent_players)`)
  }
}

/**
 * True when a drizzle SQL fragment carries no usable condition.
 *
 * Drizzle stores its parts in `queryChunks`; `sql.raw('x')` produces a single
 * chunk whose `value` is `['x']`, and an empty `sql``` produces no chunks at
 * all. Earlier revisions inspected `.sql` and `.chunks`, neither of which
 * exists on a drizzle SQL object, so every branch fell through and the function
 * returned `false` for every input — including genuinely empty fragments.
 */
export function isEmptySqlCondition(condition: ReturnType<typeof sql> | null | undefined): boolean {
  if (!condition) return true
  return sqlFragmentText(condition).length === 0
}

/** Flatten a drizzle SQL fragment to the literal text it contributes. */
function sqlFragmentText(fragment: unknown): string {
  const chunks = (fragment as any)?.queryChunks
  if (!Array.isArray(chunks)) return ''
  const text = chunks
    .map((chunk: any) => {
      if (typeof chunk === 'string') return chunk
      // sql.raw() wraps its text in a StringChunk whose `value` is a string[]
      const value = chunk?.value
      if (typeof value === 'string') return value
      if (Array.isArray(value)) return value.join('')
      // Bound parameters carry content even though their text is a placeholder
      return chunk == null ? '' : ' ? '
    })
    .join('')
    .trim()
  // A bare "AND" contributes nothing on its own
  return /^AND$/i.test(text) ? '' : text
}

/**
 * Strip the leading `AND` so a condition can be combined inside a reduce()
 * without producing `AND AND`.
 *
 * Returns an empty fragment when there is nothing left to contribute.
 */
export function userConditionForReduce(userCondition: ReturnType<typeof sql>): ReturnType<typeof sql> {
  const text = sqlFragmentText(userCondition)
  if (!text) return sql``
  const stripped = text.replace(/^\s*AND\s+/i, '').trim()
  return stripped ? sql.raw(stripped) : sql``
}
