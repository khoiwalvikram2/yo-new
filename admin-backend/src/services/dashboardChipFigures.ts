/**
 * Chip figures for the Executive Dashboard, since the CREDIT scheme moved to Deposit/Withdraw chips
 * (docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §2 and §6). Every figure comes from ChipService's
 * batch reads, so the dashboard shows exactly what the Chips pages show:
 *   - an agent's Ref P/L is its chips + its downline's chips - its credit reference; a player's is its chips -
 *     its credit reference. Positive: the upline owes the account. Negative: the account owes the upline.
 *   - network totals take the top of each chip chain only (memory gw-agent-hierarchy-model). An agent's Ref P/L
 *     already counts every chip below it, so adding its sub-agents as well would count those chips twice.
 *
 * The retired CREDIT columns (credit_used, credit_available, settlement_balance) are never read here.
 * ChipService reads one whitelabel at a time, so in director core mode (tenant undefined) the accounts are
 * grouped by tenant first.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { chipCents, chipService, roundChips, type ChipAccount } from '@/domains/agents/services/ChipService.js'

export interface ChipDashboardScope {
  /** undefined: director core mode, every whitelabel. */
  tenant?: string
}

/** A CREDIT account of one whitelabel. */
export interface ChipAccountRef {
  tenant: string
  id: string
}

const inScope = (column: SQL, tenant?: string): SQL => (tenant === undefined ? sql`TRUE` : sql`${column} = ${tenant}`)

async function accountRefs(query: SQL): Promise<ChipAccountRef[]> {
  const result = await db.execute(query)
  return (result.rows as Array<Record<string, unknown>>).map((r) => ({ tenant: String(r.tenant), id: String(r.id) }))
}

function groupByTenant(refs: readonly ChipAccountRef[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const ref of refs) {
    const ids = out.get(ref.tenant)
    if (ids) ids.push(ref.id)
    else out.set(ref.tenant, [ref.id])
  }
  return out
}

const key = (tenant: string, id: string) => `${tenant}\u0000${id}`

/** The agents' ChipAccounts, in the order given. Anything that is not a CREDIT agent of its tenant is left out. */
export async function agentChipAccounts(refs: readonly ChipAccountRef[]): Promise<ChipAccount[]> {
  const found = new Map<string, ChipAccount>()
  for (const [tenant, ids] of groupByTenant(refs)) {
    // Keyed by lower-case agent id (ChipService.chipAccountsForAgents).
    for (const [id, account] of await chipService.chipAccountsForAgents(tenant, ids)) found.set(key(tenant, id), account)
  }
  return refs.flatMap((ref) => found.get(key(ref.tenant, ref.id.toLowerCase())) ?? [])
}

/** The players' ChipAccounts, in the order given. Anything that is not a credit player of its tenant is left out. */
export async function playerChipAccounts(refs: readonly ChipAccountRef[]): Promise<ChipAccount[]> {
  const found = new Map<string, ChipAccount>()
  for (const [tenant, ids] of groupByTenant(refs)) {
    // Keyed by the player id as a string (ChipService.chipAccountsForPlayers).
    for (const [id, account] of await chipService.chipAccountsForPlayers(tenant, ids)) found.set(key(tenant, id), account)
  }
  return refs.flatMap((ref) => found.get(key(ref.tenant, ref.id)) ?? [])
}

/**
 * The top of each chip chain: CREDIT agents with no CREDIT agent above them in agent_hierarchy_closure. These
 * are the root CREDIT agents, plus any CREDIT agent whose only uplines are of another scheme, so no chip below
 * them is counted twice and none is dropped.
 */
export async function topCreditAgents(scope: ChipDashboardScope): Promise<ChipAccount[]> {
  return agentChipAccounts(await accountRefs(sql`
    SELECT a.tenant_id AS tenant, a.id::text AS id
    FROM agents a
    WHERE ${inScope(sql`a.tenant_id`, scope.tenant)} AND a.scheme_type::text = 'CREDIT'
      AND NOT EXISTS (
        SELECT 1 FROM agent_hierarchy_closure h JOIN agents up ON up.id = h.ancestor_id
        WHERE h.descendant_id = a.id AND h.ancestor_id <> a.id AND h.depth > 0 AND up.scheme_type::text = 'CREDIT')
    ORDER BY a.tenant_id, a.id`))
}

/** The whitelabel's own credit players (WHITELABEL_CREDIT): its direct chip downline beside its root agents. */
export async function whitelabelCreditPlayers(scope: ChipDashboardScope): Promise<ChipAccount[]> {
  return playerChipAccounts(await accountRefs(sql`
    SELECT u.tenant, u.id::text AS id
    FROM users u
    WHERE ${inScope(sql`u.tenant`, scope.tenant)} AND u.player_type::text = 'WHITELABEL_CREDIT'
    ORDER BY u.tenant, u.id`))
}

/**
 * CREDIT agents by how far their own chips sit below their credit reference, furthest first: the agents that
 * most need chips from their upline. With `lowShare`, only ACTIVE agents with a reference whose chips sit at
 * least that share of it below it ("low on chips", the old near-limit card's rule on chips).
 */
export async function creditAgentsByChipUse(
  scope: ChipDashboardScope,
  options: { limit: number; lowShare?: number }
): Promise<ChipAccount[]> {
  const gap = sql`GREATEST(a.credit_limit - a.chip_balance, 0)`
  const low = options.lowShare === undefined
    ? sql``
    : sql`AND a.status = 'ACTIVE' AND a.credit_limit > 0 AND a.credit_limit - a.chip_balance >= a.credit_limit * ${options.lowShare}`
  return agentChipAccounts(await accountRefs(sql`
    SELECT a.tenant_id AS tenant, a.id::text AS id
    FROM agents a
    WHERE ${inScope(sql`a.tenant_id`, scope.tenant)} AND a.scheme_type::text = 'CREDIT' ${low}
    ORDER BY ${gap} / NULLIF(a.credit_limit, 0) DESC NULLS LAST, ${gap} DESC, a.id
    LIMIT ${options.limit}`))
}

/** Ref P/L summed in cents, so the total is exact. */
export function sumRefPnl(accounts: readonly ChipAccount[]): number {
  return accounts.reduce((cents, account) => cents + chipCents(account.refPnl), 0) / 100
}

export interface RefPnlSplit {
  /** Σ positive Ref P/L: what the upline owes these accounts. */
  owed: number
  /** Σ negative Ref P/L, kept negative: what these accounts owe the upline. */
  owing: number
  /** Accounts whose Ref P/L is not 0. */
  withBalance: number
}

export function splitRefPnl(accounts: readonly ChipAccount[]): RefPnlSplit {
  let owed = 0
  let owing = 0
  let withBalance = 0
  for (const account of accounts) {
    const cents = chipCents(account.refPnl)
    if (cents > 0) owed += cents
    if (cents < 0) owing += cents
    if (cents !== 0) withBalance++
  }
  return { owed: owed / 100, owing: owing / 100, withBalance }
}

/** A CREDIT agent's chips in the credit-limit shape the dashboard's GraphQL types still carry. */
export interface CreditShape {
  agentId: string
  username: string | null
  /** The credit reference. */
  creditLimit: number
  /** How far the agent's own chips sit below its reference: chips handed down or lost (0 when it holds more). */
  creditUsed: number
  /** The agent's own chips: its available figure. */
  creditAvailable: number
  /** creditUsed / reference; 0 without a reference. */
  usedShare: number
  /** Ref P/L: positive, the upline owes the agent; negative, the agent owes the upline. */
  settlementBalance: number
  // The chip figures under their own names, for when the GraphQL types carry them.
  creditReference: number
  balance: number
  exposure: number
  downlineBalance: number
  refPnl: number
}

export function creditShapeOf(account: ChipAccount): CreditShape {
  const used = Math.max(0, roundChips(account.creditReference - account.balance))
  return {
    agentId: account.id,
    username: account.username || null,
    creditLimit: account.creditReference,
    creditUsed: used,
    creditAvailable: account.balance,
    usedShare: account.creditReference > 0 ? used / account.creditReference : 0,
    settlementBalance: account.refPnl,
    creditReference: account.creditReference,
    balance: account.balance,
    exposure: account.exposure,
    downlineBalance: account.downlineBalance,
    refPnl: account.refPnl,
  }
}
