/**
 * The Executive Dashboard's operations sections (the owner's list, 2026-10-29), which replace Advanced
 * Analytics on the Overview tab:
 *
 *   B2C (cash) whitelabel: Deposits & Withdrawals, Pending Actions, Player Activity, Registrations & Status,
 *   Balances & Agents.
 *   Credit (B2B / chips) whitelabel: Chip Movements, Credit Pool & Settlement, Player Activity,
 *   Registrations & Status, Players & Agents.
 *
 * There is no column that marks a whitelabel B2C or credit, so the kind is read from what it has: credit
 * players (WHITELABEL_CREDIT / AGENT_CREDIT) or CREDIT agents make it a credit whitelabel; cash players, an
 * enabled payment gateway or enabled payment methods make it B2C. A whitelabel with both shows both.
 *
 * Period figures follow the dashboard's date range; the pending counts, the online count, balances, the
 * credit pool and the head counts are what is true now. Money is raw, in the whitelabel's own currency, as
 * every other dashboard figure; the client converts and formats it. A tenant of `undefined` is director core
 * mode: every figure is platform-wide (one aggregate, or the per-whitelabel helpers summed).
 *
 * Player counts leave out admin users the way getPlayerStatistics does: a user holding any role whose name
 * contains "admin" is not a player.
 *
 * Credit figures are chips (CREDIT on Deposit/Withdraw, 2026-11-02): chip movements read credit_chip_ledger,
 * a credit player's chips are its cash wallet, and the settlement figure is the Ref P/L of the whitelabel's
 * direct chip downline (dashboardChipFigures). The retired credit_used / credit_available / settlement_balance
 * columns of agents and players are not read.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { getLedgerAggregatesByWalletDb, getManualDepositWithdrawalStatsTenantDb } from '@/repos/players/walletsRepo.js'
import { OPEN_SPORTS_STATUSES, OPEN_CASINO_STATUSES, OPEN_MATKA_STATUSES } from '@/services/realtimeSnapshotService.js'
import { sumRefPnl, topCreditAgents, whitelabelCreditPlayers } from '@/services/dashboardChipFigures.js'

/** "Online now": a sign-in or a bet in this many trailing minutes. */
export const ONLINE_WINDOW_MINS = 10

/** Awaiting settlement: an open sports bet older than this many hours is probably on a finished event. */
export const STALE_SPORTS_HOURS = 24

/** Awaiting settlement: an open casino round older than this is stuck (the stuck-round alert's own setting). */
export const CASINO_STUCK_MINUTES = Number(process.env.CASINO_STUCK_ROUND_MINUTES) || 30

/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = 330 * 60_000

export interface DashboardOperationsScope {
  /** undefined: director core mode, every whitelabel. */
  tenant?: string
}

export interface DashboardOperations {
  showB2C: boolean
  showCredit: boolean
  // Deposits & Withdrawals (period)
  directDeposits: number
  manualDeposits: number
  directWithdrawals: number
  manualWithdrawals: number
  // Pending Actions (now)
  pendingDepositRequests: number
  pendingDepositAmount: number
  pendingWithdrawalRequests: number
  pendingWithdrawalAmount: number
  pendingPayoutAccounts: number
  // Player Activity
  onlineNow: number
  onlineWindowMins: number
  loggedInPlayers: number
  playersWhoBet: number
  /** Every bet placed in the period, open ones included (overviewKPIs.totalBets counts settled bets only). */
  betsPlaced: number
  playersWithOpenBet: number
  // Registrations & Status
  registeredToday: number
  inactivePlayers: number
  suspendedPlayers: number
  // Balances & Agents
  /** Cash players' wallets.cash, now (credit players' chips are in chipsWithPlayers). */
  walletBalance: number
  bonusGiven: number
  sharingAgentsActive: number
  commissionAgentsActive: number
  // Chip Movements (period)
  chipsDepositedByWhitelabel: number
  chipsDepositedByAgents: number
  chipsWithdrawnByWhitelabel: number
  chipsWithdrawnByAgents: number
  chipsGivenToAgents: number
  // Credit Pool & Settlement
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  /** Σ Ref P/L of the root CREDIT agents and WHITELABEL_CREDIT players: positive, the whitelabel owes them. */
  settlementDue: number
  settledAmount: number
  /** Credit players' available chips: Σ (cash - exposure) of their wallets. */
  chipsWithPlayers: number
  // Players & Agents
  directPlayers: number
  agentPlayers: number
  creditAgentsActive: number
  // Awaiting Settlement (now)
  staleSportsBets: number
  staleSportsEvents: number
  staleSportsHours: number
  stuckCasinoRounds: number
  casinoStuckMinutes: number
  overdueMatkaBets: number
  overdueMatkaMarkets: number
}

const CREDIT_TYPES = sql`('WHITELABEL_CREDIT', 'AGENT_CREDIT')`
const CASH_TYPES = sql`('REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER')`

/** `column = tenant`, or no predicate in core mode. */
export function inTenant(column: SQL, tenant?: string): SQL {
  return tenant === undefined ? sql`TRUE` : sql`${column} = ${tenant}`
}

/** The user `alias` is a player: it holds no admin role in its tenant. */
export function isPlayer(alias: SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ${alias}.id AND ur.tenant = ${alias}.tenant AND LOWER(r.name) LIKE '%admin%'
  )`
}

const num = (value: unknown) => Number(value ?? 0) || 0

async function one(query: SQL): Promise<Record<string, unknown>> {
  const result = await db.execute(query)
  return (result.rows[0] ?? {}) as Record<string, unknown>
}

/** Midnight of today in IST, as an instant. */
export function istMidnight(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS)
}

/**
 * A credit player's chip wallet as `alias`: its first wallets row for its tenant (the row ChipService moves),
 * for a source that has joined users as `player`.
 */
export function creditWalletOf(player: SQL, alias: SQL): SQL {
  return sql`LEFT JOIN LATERAL (
    SELECT cw.cash, cw.exposure FROM wallets cw
    WHERE cw.user_id = ${player}.id AND cw.tenant = ${player}.tenant
    ORDER BY cw.id LIMIT 1
  ) ${alias} ON TRUE`
}

/** Head counts, statuses, sign-ins and the credit players' available chips (cash - exposure), now. */
function usersAggregate(scope: DashboardOperationsScope, from: Date, to: Date, today: Date): SQL {
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE u.created_at >= ${today})::int AS registered_today,
      COUNT(*) FILTER (WHERE u.status = 'inactive')::int AS inactive,
      COUNT(*) FILTER (WHERE u.status = 'suspended')::int AS suspended,
      COUNT(*) FILTER (WHERE u.last_login_at >= ${from} AND u.last_login_at <= ${to})::int AS logged_in,
      COUNT(*) FILTER (WHERE u.agent_id IS NULL)::int AS direct_players,
      COUNT(*) FILTER (WHERE u.agent_id IS NOT NULL)::int AS agent_players,
      COUNT(*) FILTER (WHERE u.player_type::text IN ${CREDIT_TYPES})::int AS credit_players,
      COUNT(*) FILTER (WHERE u.player_type::text IN ${CASH_TYPES})::int AS cash_players,
      (SELECT COALESCE(SUM(COALESCE(w.cash, 0) - COALESCE(w.exposure, 0)), 0)
        FROM users cu ${creditWalletOf(sql`cu`, sql`w`)}
        WHERE ${inTenant(sql`cu.tenant`, scope.tenant)} AND cu.player_type::text IN ${CREDIT_TYPES} AND ${isPlayer(sql`cu`)}
      ) AS chips_with_players
    FROM users u
    WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}`
}

/** One branch per product of "who bet": user ids with a bet created in the window (or open now). */
function betBranches(scope: DashboardOperationsScope, where: (table: 'sports' | 'casino' | 'matka') => SQL): SQL {
  return sql`
    SELECT s.user_id FROM sports_bets s WHERE ${inTenant(sql`s.tenant`, scope.tenant)} AND ${where('sports')}
    UNION ALL
    SELECT c.user_id FROM casino_bets c WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND ${where('casino')}
    UNION ALL
    SELECT m.user_id FROM matka_bets m WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND ${where('matka')}`
}

const ALIAS = { sports: sql`s`, casino: sql`c`, matka: sql`m` }
const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)
const OPEN = {
  sports: list(OPEN_SPORTS_STATUSES),
  casino: list(OPEN_CASINO_STATUSES),
  matka: list(OPEN_MATKA_STATUSES),
}

async function activity(scope: DashboardOperationsScope, from: Date, to: Date, onlineSince: Date) {
  const placedIn = (t: 'sports' | 'casino' | 'matka') => sql`${ALIAS[t]}.created_at >= ${from} AND ${ALIAS[t]}.created_at <= ${to}`
  const [bettors, open, online, placed] = await Promise.all([
    one(sql`SELECT COUNT(DISTINCT b.user_id)::int AS n FROM (${betBranches(scope, placedIn)}) b`),
    one(sql`SELECT COUNT(DISTINCT b.user_id)::int AS n FROM (${betBranches(scope, (t) => sql`${ALIAS[t]}.status::text IN (${OPEN[t]})`)}) b`),
    // Online: signed in, or placed a bet, in the trailing window. The platform keeps no heartbeat.
    one(sql`SELECT COUNT(DISTINCT o.user_id)::int AS n FROM (
      SELECT u.id AS user_id FROM users u WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND u.last_login_at >= ${onlineSince}
      UNION ALL
      ${betBranches(scope, (t) => sql`${ALIAS[t]}.created_at >= ${onlineSince}`)}
    ) o`),
    one(sql`SELECT COUNT(*)::int AS n FROM (${betBranches(scope, placedIn)}) b`),
  ])
  return { playersWhoBet: num(bettors.n), playersWithOpenBet: num(open.n), onlineNow: num(online.n), betsPlaced: num(placed.n) }
}

/** Agents by scheme: active counts, and whether any credit agent exists at all. */
function agentsAggregate(scope: DashboardOperationsScope): SQL {
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE a.scheme_type::text = 'SHARING' AND a.status = 'ACTIVE')::int AS sharing_active,
      COUNT(*) FILTER (WHERE a.scheme_type::text = 'COMMISSION' AND a.status = 'ACTIVE')::int AS commission_active,
      COUNT(*) FILTER (WHERE a.scheme_type::text = 'CREDIT' AND a.status = 'ACTIVE')::int AS credit_active,
      COUNT(*) FILTER (WHERE a.scheme_type::text = 'CREDIT')::int AS credit_any
    FROM agents a
    WHERE ${inTenant(sql`a.tenant_id`, scope.tenant)}`
}

/** Requests and payout accounts waiting for an admin, now. */
function pendingAggregate(scope: DashboardOperationsScope): SQL {
  return sql`
    SELECT
      (SELECT COUNT(*)::int FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'PENDING') AS deposits,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'PENDING') AS deposit_amount,
      (SELECT COUNT(*)::int FROM withdrawal_requests w WHERE ${inTenant(sql`w.tenant`, scope.tenant)} AND w.status::text = 'PENDING') AS withdrawals,
      (SELECT COALESCE(SUM(w.amount), 0) FROM withdrawal_requests w WHERE ${inTenant(sql`w.tenant`, scope.tenant)} AND w.status::text = 'PENDING') AS withdrawal_amount,
      (SELECT COUNT(*)::int FROM user_payout_accounts p WHERE ${inTenant(sql`p.tenant`, scope.tenant)} AND p.approval_status::text = 'PENDING' AND p.deleted_at IS NULL) AS payout_accounts,
      (SELECT EXISTS (SELECT 1 FROM whitelabel_pg_settings g WHERE ${inTenant(sql`g.tenant`, scope.tenant)} AND g.enabled)) AS pg_enabled,
      (SELECT EXISTS (SELECT 1 FROM whitelabel_payment_methods pm WHERE ${inTenant(sql`pm.tenant`, scope.tenant)}
        AND pm.enabled_methods IS NOT NULL AND pm.enabled_methods::text NOT IN ('[]', '{}', 'null', ''))) AS methods_enabled`
}

/**
 * Players' cash and the bonus awarded in the period (cancelled awards left out). The cash is the cash players'
 * only: a credit player's wallets.cash holds its chips, which Chips with Players already counts.
 */
function moneyAggregate(scope: DashboardOperationsScope, from: Date, to: Date): SQL {
  return sql`
    SELECT
      (SELECT COALESCE(SUM(w.cash), 0) FROM wallets w JOIN users u ON u.id = w.user_id
        WHERE ${inTenant(sql`w.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}
          AND u.player_type::text IN ${CASH_TYPES}) AS wallet_balance,
      (SELECT COALESCE(SUM(b.amount), 0) FROM bonus_awards b JOIN users u ON u.id = b.user_id
        WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND b.awarded_at >= ${from} AND b.awarded_at <= ${to}
          AND b.status::text <> 'cancelled') AS bonus_given,
      (SELECT COALESCE(SUM(ABS(t.amount)), 0) FROM agent_settlement_transactions t
        WHERE ${inTenant(sql`t.tenant`, scope.tenant)} AND t.created_at >= ${from} AND t.created_at <= ${to}) AS settled_amount`
}

/**
 * Chip movements read credit_chip_ledger as `l`. A deposit or a withdrawal writes two rows that share a
 * transfer_id, one per side; each transfer is counted once, on its parent's row: the whitelabel's row, or the
 * agent's row that gave chips (a deposit, amount < 0) or took them back (a withdrawal, amount > 0). OPENING
 * rows (the 0019 conversion) and CREDIT_REFERENCE rows move no chips between accounts and are left out.
 */
const CHIP_PARENT_ROW = sql`(l.account_type::text <> 'player'
  AND ((l.kind::text = 'DEPOSIT' AND l.amount < 0) OR (l.kind::text = 'WITHDRAW' AND l.amount > 0)))`

/**
 * One Chip Movements figure, by its drill-down arg; any other arg is every movement. Deposits and withdrawals
 * are split by who was the parent (the whitelabel's pool, or an agent); to_agents is every deposit an agent
 * received, from the whitelabel or from its parent agent. The drill-down lists use the same predicates, so a
 * list's total matches its figure.
 */
export function chipMoveWhere(arg: string): SQL {
  const deposit = sql`l.kind::text = 'DEPOSIT'`
  const withdraw = sql`l.kind::text = 'WITHDRAW'`
  const byWhitelabel = sql`l.account_type::text = 'whitelabel'`
  const byAgent = sql`l.account_type::text = 'agent'`
  switch (arg) {
    case 'wl_in': return sql`(${CHIP_PARENT_ROW} AND ${deposit} AND ${byWhitelabel})`
    case 'agent_in': return sql`(${CHIP_PARENT_ROW} AND ${deposit} AND ${byAgent})`
    case 'in': return sql`(${CHIP_PARENT_ROW} AND ${deposit})`
    case 'wl_out': return sql`(${CHIP_PARENT_ROW} AND ${withdraw} AND ${byWhitelabel})`
    case 'agent_out': return sql`(${CHIP_PARENT_ROW} AND ${withdraw} AND ${byAgent})`
    case 'out': return sql`(${CHIP_PARENT_ROW} AND ${withdraw})`
    case 'to_agents': return sql`(${CHIP_PARENT_ROW} AND ${deposit} AND l.counterparty_type::text = 'agent')`
    default: return CHIP_PARENT_ROW
  }
}

/** Chip movements in the period, each transfer once (see chipMoveWhere). */
function chipsAggregate(scope: DashboardOperationsScope, from: Date, to: Date): SQL {
  const sum = (arg: string) => sql`COALESCE(SUM(ABS(l.amount)) FILTER (WHERE ${chipMoveWhere(arg)}), 0)`
  return sql`
    SELECT ${sum('wl_in')} AS wl_in, ${sum('agent_in')} AS agent_in, ${sum('wl_out')} AS wl_out,
      ${sum('agent_out')} AS agent_out, ${sum('to_agents')} AS to_agents
    FROM credit_chip_ledger l
    WHERE ${inTenant(sql`l.tenant_id`, scope.tenant)} AND l.created_at >= ${from} AND l.created_at <= ${to}`
}

/** The whitelabel's credit pool (the chips its admins deposit from), now. */
function poolAggregate(scope: DashboardOperationsScope): SQL {
  return sql`
    SELECT
      COALESCE(SUM(wl.credit_limit), 0) AS credit_limit,
      COALESCE(SUM(wl.credit_used), 0) AS credit_used,
      COALESCE(SUM(wl.credit_available), 0) AS credit_available
    FROM whitelabels wl
    WHERE ${inTenant(sql`wl.id`, scope.tenant)}`
}

/**
 * What the whitelabel owes its direct chip downline, net, now: Σ Ref P/L of the top CREDIT agents and the
 * WHITELABEL_CREDIT players. Positive: the whitelabel owes them; negative: they owe the whitelabel.
 */
async function whitelabelRefPnl(scope: DashboardOperationsScope): Promise<number> {
  const [agentsAtTop, players] = await Promise.all([topCreditAgents(scope), whitelabelCreditPlayers(scope)])
  return sumRefPnl([...agentsAtTop, ...players])
}

/**
 * What should have settled by now and has not: open sports bets older than STALE_SPORTS_HOURS (and their
 * events), casino rounds open longer than the stuck-round alert's age, and open matka bets whose draw day
 * (run_date, else the IST day they were placed) is before today in IST.
 */
function awaitingAggregate(scope: DashboardOperationsScope, now: Date): SQL {
  const staleBefore = new Date(now.getTime() - STALE_SPORTS_HOURS * 3_600_000)
  const stuckBefore = new Date(now.getTime() - CASINO_STUCK_MINUTES * 60_000)
  const istDay = (instant: SQL) => sql`(${instant} AT TIME ZONE 'Asia/Kolkata')::date`
  const overdue = sql`COALESCE(m.run_date, ${istDay(sql`m.created_at`)}) < ${istDay(sql`${now}::timestamptz`)}`
  return sql`
    SELECT
      (SELECT COUNT(*)::int FROM sports_bets s WHERE ${inTenant(sql`s.tenant`, scope.tenant)}
        AND s.status::text IN (${OPEN.sports}) AND s.created_at < ${staleBefore}) AS sports_bets,
      (SELECT COUNT(DISTINCT s.event_id)::int FROM sports_bets s WHERE ${inTenant(sql`s.tenant`, scope.tenant)}
        AND s.status::text IN (${OPEN.sports}) AND s.created_at < ${staleBefore}) AS sports_events,
      (SELECT COUNT(*)::int FROM casino_bets c WHERE ${inTenant(sql`c.tenant`, scope.tenant)}
        AND c.status::text IN (${OPEN.casino}) AND c.created_at < ${stuckBefore}) AS casino_stuck,
      (SELECT COUNT(*)::int FROM matka_bets m WHERE ${inTenant(sql`m.tenant`, scope.tenant)}
        AND m.status::text IN (${OPEN.matka}) AND ${overdue}) AS matka_bets,
      (SELECT COUNT(DISTINCT m.matka_id)::int FROM matka_bets m WHERE ${inTenant(sql`m.tenant`, scope.tenant)}
        AND m.status::text IN (${OPEN.matka}) AND ${overdue}) AS matka_markets`
}

/** Direct (request-table) and manual (admin ledger) money in the period, per whitelabel, summed in core mode. */
async function moneySplit(scope: DashboardOperationsScope, from: Date, to: Date) {
  let tenants: string[]
  if (scope.tenant !== undefined) tenants = [scope.tenant]
  else {
    const { listWhitelabelsDb } = await import('@/repos/common/whitelabelRepo.js')
    tenants = (await listWhitelabelsDb()).map((row) => row.id)
  }
  const parts = await Promise.all(tenants.map(async (tenant) => {
    const [direct, manual] = await Promise.all([
      getLedgerAggregatesByWalletDb({ tenant, dateFrom: from, dateTo: to }),
      getManualDepositWithdrawalStatsTenantDb({ tenant, dateFrom: from, dateTo: to }),
    ])
    return { direct, manual }
  }))
  return parts.reduce((sum, { direct, manual }) => ({
    directDeposits: sum.directDeposits + num(direct.depositVolume),
    manualDeposits: sum.manualDeposits + num(manual.manualDepositVolume),
    directWithdrawals: sum.directWithdrawals + num(direct.withdrawalVolume),
    manualWithdrawals: sum.manualWithdrawals + num(manual.manualWithdrawalVolume),
  }), { directDeposits: 0, manualDeposits: 0, directWithdrawals: 0, manualWithdrawals: 0 })
}

export async function getDashboardOperations(
  scope: DashboardOperationsScope,
  range: { dateFrom?: string; dateTo?: string },
  now: Date = new Date()
): Promise<DashboardOperations> {
  if (scope.tenant === '') throw new Error('dashboardOperations: an empty tenant is not a valid scope')
  const today = istMidnight(now)
  const from = range.dateFrom && !isNaN(Date.parse(range.dateFrom)) ? new Date(range.dateFrom) : today
  const to = range.dateTo && !isNaN(Date.parse(range.dateTo)) ? new Date(range.dateTo) : now
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MINS * 60_000)

  const [people, act, agentsRow, pending, money, chips, pool, split, awaiting, settlementDue] = await Promise.all([
    one(usersAggregate(scope, from, to, today)),
    activity(scope, from, to, onlineSince),
    one(agentsAggregate(scope)),
    one(pendingAggregate(scope)),
    one(moneyAggregate(scope, from, to)),
    one(chipsAggregate(scope, from, to)),
    one(poolAggregate(scope)),
    moneySplit(scope, from, to),
    one(awaitingAggregate(scope, now)),
    whitelabelRefPnl(scope),
  ])

  const showCredit = num(people.credit_players) > 0 || num(agentsRow.credit_any) > 0
  const showB2C = num(people.cash_players) > 0 || pending.pg_enabled === true || pending.methods_enabled === true || !showCredit

  return {
    showB2C,
    showCredit,
    ...split,
    pendingDepositRequests: num(pending.deposits),
    pendingDepositAmount: num(pending.deposit_amount),
    pendingWithdrawalRequests: num(pending.withdrawals),
    pendingWithdrawalAmount: num(pending.withdrawal_amount),
    pendingPayoutAccounts: num(pending.payout_accounts),
    onlineNow: act.onlineNow,
    onlineWindowMins: ONLINE_WINDOW_MINS,
    loggedInPlayers: num(people.logged_in),
    playersWhoBet: act.playersWhoBet,
    playersWithOpenBet: act.playersWithOpenBet,
    betsPlaced: act.betsPlaced,
    registeredToday: num(people.registered_today),
    inactivePlayers: num(people.inactive),
    suspendedPlayers: num(people.suspended),
    walletBalance: num(money.wallet_balance),
    bonusGiven: num(money.bonus_given),
    sharingAgentsActive: num(agentsRow.sharing_active),
    commissionAgentsActive: num(agentsRow.commission_active),
    chipsDepositedByWhitelabel: num(chips.wl_in),
    chipsDepositedByAgents: num(chips.agent_in),
    chipsWithdrawnByWhitelabel: num(chips.wl_out),
    chipsWithdrawnByAgents: num(chips.agent_out),
    chipsGivenToAgents: num(chips.to_agents),
    creditLimit: num(pool.credit_limit),
    creditUsed: num(pool.credit_used),
    creditAvailable: num(pool.credit_available),
    settlementDue,
    settledAmount: num(money.settled_amount),
    chipsWithPlayers: num(people.chips_with_players),
    directPlayers: num(people.direct_players),
    agentPlayers: num(people.agent_players),
    creditAgentsActive: num(agentsRow.credit_active),
    staleSportsBets: num(awaiting.sports_bets),
    staleSportsEvents: num(awaiting.sports_events),
    staleSportsHours: STALE_SPORTS_HOURS,
    stuckCasinoRounds: num(awaiting.casino_stuck),
    casinoStuckMinutes: CASINO_STUCK_MINUTES,
    overdueMatkaBets: num(awaiting.matka_bets),
    overdueMatkaMarkets: num(awaiting.matka_markets),
  }
}
