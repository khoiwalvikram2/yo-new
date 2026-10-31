import { sql } from 'drizzle-orm'

/**
 * Agent betting gate (owner decisions 1 and 4, 2026-10-21).
 *
 * A player linked to an agent (users.agent_id) may place a new bet only when:
 *   - the agent and every ancestor of the agent (agent_hierarchy_closure) is ACTIVE.
 *     A suspended or blocked agent blocks its whole subtree. Login, history and
 *     withdrawals stay open; only new stakes are refused.
 *   - the agent's allowed_domains include the domain of the bet (sports / casino / matka),
 *     on top of the player's own flags, which the callers check themselves.
 *
 * Players without an agent are not affected. One query fetches the agent, its ancestors,
 * their statuses and the agent's domains together.
 */

export type BettingDomain = 'sports' | 'casino' | 'matka'

export type AgentBettingGateReason = 'AGENT_BRANCH_INACTIVE' | 'AGENT_DOMAIN_NOT_ALLOWED'

export type AgentBettingGateResult =
  | { ok: true }
  | { ok: false; reason: AgentBettingGateReason; message: string }

/** One row per (player, agent in the chain). agent_id is null when the player has no agent, or the agent row is missing. */
export type AgentChainRow = {
  player_agent_id: string | null
  agent_id: string | null
  status: string | null
  allowed_domains: string[] | string | null
}

export const AGENT_BRANCH_INACTIVE_MESSAGE =
  'Betting is suspended for your account. Please contact your agent.'

const DOMAIN_LABEL: Record<BettingDomain, string> = {
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

export function agentDomainNotAllowedMessage(domain: BettingDomain): string {
  return `${DOMAIN_LABEL[domain]} betting is not available for your account. Please contact your agent.`
}

function parseDomains(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((d) => String(d).trim().toLowerCase())
  if (typeof value === 'string') {
    // Postgres text[] literal, e.g. '{sports,casino}', if a driver hands back the raw form.
    return value
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((d) => d.replace(/"/g, '').trim().toLowerCase())
      .filter(Boolean)
  }
  return []
}

function isActiveStatus(status: string | null | undefined): boolean {
  return String(status ?? '').trim().toUpperCase() === 'ACTIVE'
}

/**
 * True when the agent row is present and it and every ancestor in `rows` is ACTIVE.
 * Fails closed on a missing agent row: users.agent_id has no foreign key, so a dangling
 * link is possible.
 */
export function isAgentBranchActive(
  rows: Array<{ agent_id: string | null; status: string | null }>,
  agentId: string
): boolean {
  const chain = rows.filter((r) => r.agent_id != null)
  if (!chain.some((r) => String(r.agent_id) === String(agentId))) return false
  return chain.every((r) => isActiveStatus(r.status))
}

/** Pure decision over the rows of the chain query (exported for tests). */
export function evaluateAgentBettingGate(rows: AgentChainRow[], domain: BettingDomain): AgentBettingGateResult {
  if (rows.length === 0) return { ok: true } // player not found: the caller's own lookup handles it
  const playerAgentId = rows[0].player_agent_id
  if (!playerAgentId) return { ok: true } // not an agent player

  if (!isAgentBranchActive(rows, playerAgentId)) {
    return { ok: false, reason: 'AGENT_BRANCH_INACTIVE', message: AGENT_BRANCH_INACTIVE_MESSAGE }
  }

  const own = rows.find((r) => String(r.agent_id) === String(playerAgentId))!
  if (!parseDomains(own.allowed_domains).includes(domain)) {
    return { ok: false, reason: 'AGENT_DOMAIN_NOT_ALLOWED', message: agentDomainNotAllowedMessage(domain) }
  }
  return { ok: true }
}

function resultRows(result: any): any[] {
  if (Array.isArray(result?.rows)) return result.rows
  if (Array.isArray(result)) return result
  return []
}

/**
 * Checks the agent gate for a player. `executor` is the db or the caller's tx (anything
 * with drizzle's `execute`). Reads only.
 */
export async function checkPlayerAgentBettingGate(
  executor: any,
  args: { userId: number; tenant: string },
  domain: BettingDomain
): Promise<AgentBettingGateResult> {
  // The player's agent is its own users.agent_id or, for a player who joined through an agent
  // player's referral link, its CONFIRMED referrer's agent — the same attribution the commission and
  // sharing maths use (owner decision 3: referral-linked players are the agent's players), so a
  // suspended branch and the agent's domains gate them too.
  const result = await executor.execute(sql`
    WITH p AS (
      SELECT COALESCE(
        u.agent_id,
        (
          SELECT ru.agent_id
          FROM referral_attributions ra
          JOIN users ru ON ru.id = ra.referrer_id AND ru.tenant = u.tenant
          WHERE ra.referee_id = u.id AND ra.tenant = u.tenant AND ra.status = 'confirmed'
          LIMIT 1
        )
      ) AS agent_id
      FROM users u
      WHERE u.id = ${args.userId} AND u.tenant = ${args.tenant}
    )
    SELECT
      p.agent_id::text AS player_agent_id,
      a.id::text AS agent_id,
      a.status AS status,
      a.allowed_domains AS allowed_domains
    FROM p
    LEFT JOIN agents a
      ON p.agent_id IS NOT NULL
     AND (
       a.id = p.agent_id
       OR a.id IN (
         SELECT c.ancestor_id FROM agent_hierarchy_closure c WHERE c.descendant_id = p.agent_id
       )
     )
  `)
  return evaluateAgentBettingGate(resultRows(result) as AgentChainRow[], domain)
}

/** An agent and all its ancestors (agent_hierarchy_closure), keyed by agent id. */
export type AgentWithAncestorsRow = {
  agent_id: string
  status: string | null
  scheme_type: string | null
  tenant_id: string | null
}

export async function loadAgentWithAncestors(executor: any, agentId: string): Promise<AgentWithAncestorsRow[]> {
  const result = await executor.execute(sql`
    SELECT a.id::text AS agent_id, a.status, a.scheme_type::text AS scheme_type, a.tenant_id
    FROM agents a
    WHERE a.id = ${agentId}
       OR a.id IN (SELECT c.ancestor_id FROM agent_hierarchy_closure c WHERE c.descendant_id = ${agentId})
  `)
  return resultRows(result) as AgentWithAncestorsRow[]
}

export class AgentBettingBlockedError extends Error {
  readonly code = 'AGENT_BETTING_BLOCKED'
  constructor(readonly reason: AgentBettingGateReason, message: string) {
    super(message)
    this.name = 'AgentBettingBlockedError'
  }
}

/** Throws AgentBettingBlockedError (message is safe to show to the player) when the gate refuses. */
export async function assertPlayerAgentAllowsBetting(
  executor: any,
  args: { userId: number; tenant: string },
  domain: BettingDomain
): Promise<void> {
  const gate = await checkPlayerAgentBettingGate(executor, args, domain)
  if (!gate.ok) throw new AgentBettingBlockedError(gate.reason, gate.message)
}
