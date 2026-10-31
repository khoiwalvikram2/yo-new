/**
 * The Executive Dashboard's insight cards (the owner's ask, 2026-10-29: "jisme jo fit hota hai sb kr do"),
 * each on the tab it fits:
 *
 *   Overview   - Top risk events: the open book by event (sports) and by draw (matka), largest first.
 *              - Big bets: the largest single bets placed in the period, and the players who won most.
 *              - Agents near their credit limit (credit whitelabels).
 *   Players    - Retention & conversion: daily / weekly / monthly bettors, first-deposit conversion,
 *                returning and repeat players, and players drifting away.
 *   Financial  - Casino providers: turnover, payouts and GGR per vendor.
 *              - Bonus analysis: what was given, by type, what is still outstanding, and how much of it
 *                finished its wagering.
 *
 * Definitions follow the rest of the dashboard so the figures agree with it:
 *   - open sports exposure is SUM(liability) over matched / unmatched bets, and open matka exposure is
 *     SUM(potential_win) over pending / active ones (exposureByMarketService);
 *   - a sports bet's risk is COALESCE(liability, stake) and its player P/L is sportsPlayerProfitSql
 *     (shared/reportingSql); casino P/L is payout (else win_amount) minus stake on won / lost rounds; matka
 *     P/L is actual_win minus the bet on a win and minus the bet on a loss;
 *   - "active" means placed a bet, the one activity every product records;
 *   - players leave out admin users (isPlayer), and a tenant of undefined is director core mode.
 *
 * Money is raw, in the whitelabel's own currency, as every other dashboard figure; the client converts it.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { sportsPlayerProfitSql } from '@/shared/reportingSql.js'
import { OPEN_SPORTS_STATUSES, OPEN_MATKA_STATUSES } from '@/services/exposureByMarketService.js'
import { inTenant, isPlayer, istMidnight } from '@/services/dashboardOperationsService.js'

export interface DashboardInsightsScope {
  /** undefined: director core mode, every whitelabel. */
  tenant?: string
}

type Range = { dateFrom?: string; dateTo?: string }

export type InsightProduct = 'sports' | 'casino' | 'matka'

export interface RiskEvent {
  /** 'sports:<event id>' or 'matka:<matka id>:<draw day>:<session>'. */
  key: string
  product: 'sports' | 'matka'
  label: string
  /** The sport, or the matka session and draw day. */
  detail: string | null
  startsAt: string | null
  exposure: number
  bets: number
  players: number
}

export interface BigBet {
  id: string
  product: InsightProduct
  userId: number
  username: string
  agent: string | null
  /** The event, the game or the matka market and bid. */
  label: string | null
  amount: number
  /** 'open' | 'won' | 'lost' | 'void' */
  outcome: string
  /** The player's P/L on the bet; 0 while open. */
  playerPl: number
  placedAt: string
}

export interface TopWinner {
  userId: number
  username: string
  agent: string | null
  profit: number
  staked: number
  bets: number
}

export interface AgentNearLimit {
  agentId: string
  username: string | null
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  /** creditUsed / creditLimit, 0..1+. */
  usedShare: number
  settlementBalance: number
}

export interface DashboardInsights {
  riskEvents: RiskEvent[]
  /** Every open event and draw together, so a row can show its share. */
  openExposure: number
  bigBets: BigBet[]
  topWinners: TopWinner[]
  /** Active credit agents, so the client can leave the near-limit card out where there are none. */
  creditAgents: number
  agentsNearLimit: AgentNearLimit[]
  nearLimitShare: number
}

export interface PlayerRetention {
  /** Bettors since midnight IST, in the trailing 7 days and in the trailing 30 days (now-relative). */
  dailyActive: number
  weeklyActive: number
  monthlyActive: number
  /** Bettors in the period, and in the window of the same length just before it. */
  activeInPeriod: number
  activePrevious: number
  /** Bettors in the period who also bet in the window before it. */
  returning: number
  /** Players registered in the period, and how many of them have an approved deposit. */
  newPlayers: number
  newDepositors: number
  /** Players with two or more approved deposits in the period. */
  repeatDepositors: number
  depositors: number
  /** Bet in the 30 days before the last 7, and not since. */
  lapsing: number
}

export interface CasinoProviderRow {
  vendor: string
  turnover: number
  payouts: number
  ggr: number
  bets: number
  players: number
}

export interface BonusTypeRow {
  type: string
  amount: number
  awards: number
}

export interface FinancialInsights {
  casinoProviders: CasinoProviderRow[]
  casinoTotal: CasinoProviderRow
  bonusGiven: number
  bonusAwards: number
  bonusByType: BonusTypeRow[]
  /** Pending and active awards now, whenever awarded. */
  bonusOutstanding: number
  bonusOutstandingAwards: number
  /** Of the awards given in the period that have finished, the share that completed their wagering. */
  bonusCompleted: number
  bonusExpired: number
  /** Stakes placed with bonus money in the period (casino and matka record the award). */
  bonusStakes: number
}

/** A credit agent this far into its limit is "near" it. */
export const NEAR_LIMIT_SHARE = 0.8

const num = (value: unknown) => Number(value ?? 0) || 0
const text = (value: unknown) => (value === null || value === undefined ? null : String(value))
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null)

async function rows(query: SQL): Promise<Record<string, unknown>[]> {
  const result = await db.execute(query)
  return result.rows as Record<string, unknown>[]
}

async function one(query: SQL): Promise<Record<string, unknown>> {
  return (await rows(query))[0] ?? {}
}

const list = (values: readonly string[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)

/** The period, as the dashboard sends it; today (IST) when it sends none. */
function period(range: Range, now: Date): { from: Date; to: Date } {
  const from = range.dateFrom && !isNaN(Date.parse(range.dateFrom)) ? new Date(range.dateFrom) : istMidnight(now)
  const to = range.dateTo && !isNaN(Date.parse(range.dateTo)) ? new Date(range.dateTo) : now
  return { from, to }
}

/** The player's username and their agent's login name. */
function withPlayer(inner: SQL, userColumn: SQL): SQL {
  return sql`
    SELECT x.*, u.username, ac.username AS agent
    FROM (${inner}) x
    JOIN users u ON u.id = ${userColumn}
    LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = u.agent_id LIMIT 1) ac ON TRUE`
}

/* ------------------------------------------------------------------------------------------------ */
/* Overview                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

async function riskEvents(scope: DashboardInsightsScope, limit: number): Promise<{ events: RiskEvent[]; total: number }> {
  const book = sql`
    SELECT 'sports' AS product, 'sports:' || e.id::text AS key, e.name AS label, sp.name AS detail,
      e.start_time AS starts_at, COALESCE(SUM(b.liability::numeric), 0) AS exposure,
      COUNT(*)::int AS bets, COUNT(DISTINCT b.user_id)::int AS players
    FROM sports_bets b
    JOIN sports_events e ON e.id = b.event_id
    LEFT JOIN sports sp ON sp.id = b.sport_id
    WHERE ${inTenant(sql`b.tenant`, scope.tenant)} AND b.status::text IN (${list(OPEN_SPORTS_STATUSES)})
    GROUP BY e.id, e.name, sp.name, e.start_time
    UNION ALL
    SELECT 'matka', 'matka:' || m.matka_id::text || ':' || COALESCE(m.run_date::text, '') || ':' || COALESCE(m.market_session, ''),
      COALESCE(m.market_name, 'Matka'), NULLIF(CONCAT_WS(' · ', m.market_session, TO_CHAR(m.run_date, 'DD Mon')), ''),
      NULL, COALESCE(SUM(m.potential_win::numeric), 0), COUNT(*)::int, COUNT(DISTINCT m.user_id)::int
    FROM matka_bets m
    WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.status::text IN (${list(OPEN_MATKA_STATUSES)})
    GROUP BY m.matka_id, m.market_name, m.market_session, m.run_date`
  const [top, total] = await Promise.all([
    rows(sql`SELECT * FROM (${book}) x WHERE x.exposure > 0 ORDER BY x.exposure DESC, x.label ASC LIMIT ${limit}`),
    one(sql`SELECT COALESCE(SUM(x.exposure), 0) AS total FROM (${book}) x WHERE x.exposure > 0`),
  ])
  return {
    total: num(total.total),
    events: top.map((r) => ({
      key: String(r.key),
      product: r.product === 'matka' ? 'matka' : 'sports',
      label: String(r.label ?? ''),
      detail: text(r.detail),
      startsAt: iso(r.starts_at),
      exposure: num(r.exposure),
      bets: num(r.bets),
      players: num(r.players),
    })),
  }
}

/** The outcome of one bet, in the four words the card shows. */
const OUTCOME = (status: SQL) => sql`CASE
  WHEN ${status} IN ('won') THEN 'won'
  WHEN ${status} IN ('lost') THEN 'lost'
  WHEN ${status} IN ('settled') THEN 'settled'
  WHEN ${status} IN ('void', 'cancelled') THEN 'void'
  ELSE 'open' END`

async function bigBets(scope: DashboardInsightsScope, from: Date, to: Date, limit: number): Promise<BigBet[]> {
  // Each product's largest bets first, so the union sorts a handful of rows rather than the period.
  const inner = sql`
    (SELECT 'sports' AS product, b.id::text AS id, b.user_id, COALESCE(b.liability::numeric, b.stake::numeric, 0) AS amount,
       e.name AS label, ${OUTCOME(sql`b.status::text`)} AS outcome, (${sql.raw(sportsPlayerProfitSql('b'))}) AS player_pl, b.created_at
     FROM sports_bets b LEFT JOIN sports_events e ON e.id = b.event_id
     WHERE ${inTenant(sql`b.tenant`, scope.tenant)} AND b.created_at >= ${from} AND b.created_at <= ${to}
     ORDER BY amount DESC LIMIT ${limit})
    UNION ALL
    (SELECT 'casino', c.id::text, c.user_id, COALESCE(c.stake::numeric, 0),
       COALESCE(c.game_name, c.vendor_name), ${OUTCOME(sql`c.status::text`)},
       CASE WHEN c.status::text IN ('won', 'lost') THEN COALESCE(c.payout, c.win_amount, 0)::numeric - COALESCE(c.stake::numeric, 0) ELSE 0 END,
       c.created_at
     FROM casino_bets c
     WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.created_at >= ${from} AND c.created_at <= ${to}
     ORDER BY 4 DESC LIMIT ${limit})
    UNION ALL
    (SELECT 'matka', m.id::text, m.user_id, COALESCE(m.bet_amount::numeric, 0),
       NULLIF(CONCAT_WS(' · ', m.market_name, m.bid_type, m.bet_numbers), ''), ${OUTCOME(sql`m.status::text`)},
       CASE WHEN m.status::text = 'won' THEN COALESCE(m.actual_win::numeric, 0) - COALESCE(m.bet_amount::numeric, 0)
            WHEN m.status::text = 'lost' THEN -COALESCE(m.bet_amount::numeric, 0) ELSE 0 END,
       m.created_at
     FROM matka_bets m
     WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.created_at >= ${from} AND m.created_at <= ${to}
     ORDER BY 4 DESC LIMIT ${limit})`
  const found = await rows(sql`${withPlayer(inner, sql`x.user_id`)} ORDER BY x.amount DESC, x.created_at DESC LIMIT ${limit}`)
  return found.map((r) => ({
    id: `${r.product}:${r.id}`,
    product: r.product as InsightProduct,
    userId: num(r.user_id),
    username: String(r.username ?? ''),
    agent: text(r.agent),
    label: text(r.label),
    amount: num(r.amount),
    outcome: String(r.outcome ?? 'open'),
    playerPl: num(r.player_pl),
    placedAt: iso(r.created_at) ?? '',
  }))
}

async function topWinners(scope: DashboardInsightsScope, from: Date, to: Date, limit: number): Promise<TopWinner[]> {
  const inner = sql`
    SELECT p.user_id, SUM(p.profit) AS profit, SUM(p.staked) AS staked, SUM(p.bets)::int AS bets
    FROM (
      SELECT b.user_id, SUM(${sql.raw(sportsPlayerProfitSql('b'))}) AS profit,
        SUM(COALESCE(b.liability::numeric, b.stake::numeric, 0)) AS staked, COUNT(*) AS bets
      FROM sports_bets b
      WHERE ${inTenant(sql`b.tenant`, scope.tenant)} AND b.status::text IN ('won', 'lost', 'settled')
        AND b.created_at >= ${from} AND b.created_at <= ${to}
      GROUP BY b.user_id
      UNION ALL
      SELECT c.user_id, SUM(COALESCE(c.payout, c.win_amount, 0)::numeric - COALESCE(c.stake::numeric, 0)),
        SUM(COALESCE(c.stake::numeric, 0)), COUNT(*)
      FROM casino_bets c
      WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.status::text IN ('won', 'lost')
        AND c.created_at >= ${from} AND c.created_at <= ${to}
      GROUP BY c.user_id
      UNION ALL
      SELECT m.user_id, SUM(CASE WHEN m.status::text = 'won' THEN COALESCE(m.actual_win::numeric, 0) - COALESCE(m.bet_amount::numeric, 0)
          ELSE -COALESCE(m.bet_amount::numeric, 0) END),
        SUM(COALESCE(m.bet_amount::numeric, 0)), COUNT(*)
      FROM matka_bets m
      WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.status::text IN ('won', 'lost')
        AND m.created_at >= ${from} AND m.created_at <= ${to}
      GROUP BY m.user_id
    ) p
    GROUP BY p.user_id
    HAVING SUM(p.profit) > 0
    ORDER BY SUM(p.profit) DESC
    LIMIT ${limit}`
  const found = await rows(sql`${withPlayer(inner, sql`x.user_id`)} ORDER BY x.profit DESC`)
  return found.map((r) => ({
    userId: num(r.user_id),
    username: String(r.username ?? ''),
    agent: text(r.agent),
    profit: num(r.profit),
    staked: num(r.staked),
    bets: num(r.bets),
  }))
}

async function agentsNearLimit(scope: DashboardInsightsScope, limit: number) {
  const credit = sql`${inTenant(sql`a.tenant_id`, scope.tenant)} AND a.scheme_type::text = 'CREDIT' AND a.status = 'ACTIVE'`
  const [count, found] = await Promise.all([
    one(sql`SELECT COUNT(*)::int AS n FROM agents a WHERE ${credit}`),
    rows(sql`
      SELECT a.id::text AS agent_id, ac.username, a.credit_limit, a.credit_used, a.credit_available, a.settlement_balance,
        a.credit_used::numeric / NULLIF(a.credit_limit::numeric, 0) AS used_share
      FROM agents a
      LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = a.id LIMIT 1) ac ON TRUE
      WHERE ${credit} AND a.credit_limit > 0 AND a.credit_used >= a.credit_limit * ${NEAR_LIMIT_SHARE}
      ORDER BY used_share DESC, a.credit_used DESC
      LIMIT ${limit}`),
  ])
  return {
    creditAgents: num(count.n),
    agents: found.map((r) => ({
      agentId: String(r.agent_id),
      username: text(r.username),
      creditLimit: num(r.credit_limit),
      creditUsed: num(r.credit_used),
      creditAvailable: num(r.credit_available),
      usedShare: num(r.used_share),
      settlementBalance: num(r.settlement_balance),
    })),
  }
}

export async function getDashboardInsights(
  scope: DashboardInsightsScope,
  range: Range,
  options: { includeRisk: boolean },
  now: Date = new Date()
): Promise<DashboardInsights> {
  if (scope.tenant === '') throw new Error('dashboardInsights: an empty tenant is not a valid scope')
  const { from, to } = period(range, now)
  const [risk, bets, winners, agents] = await Promise.all([
    options.includeRisk ? riskEvents(scope, 5) : Promise.resolve({ events: [], total: 0 }),
    bigBets(scope, from, to, 5),
    topWinners(scope, from, to, 5),
    agentsNearLimit(scope, 6),
  ])
  return {
    riskEvents: risk.events,
    openExposure: risk.total,
    bigBets: bets,
    topWinners: winners,
    creditAgents: agents.creditAgents,
    agentsNearLimit: agents.agents,
    nearLimitShare: NEAR_LIMIT_SHARE,
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Players tab                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** User ids with a bet in [from, to), any product. */
function bettors(scope: DashboardInsightsScope, from: Date, to: Date): SQL {
  return sql`
    SELECT s.user_id FROM sports_bets s WHERE ${inTenant(sql`s.tenant`, scope.tenant)} AND s.created_at >= ${from} AND s.created_at < ${to}
    UNION
    SELECT c.user_id FROM casino_bets c WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.created_at >= ${from} AND c.created_at < ${to}
    UNION
    SELECT m.user_id FROM matka_bets m WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.created_at >= ${from} AND m.created_at < ${to}`
}

const DAY_MS = 86_400_000

export async function getPlayerRetention(scope: DashboardInsightsScope, range: Range, now: Date = new Date()): Promise<PlayerRetention> {
  if (scope.tenant === '') throw new Error('playerRetention: an empty tenant is not a valid scope')
  const { from, to } = period(range, now)
  const end = new Date(to.getTime() + 1)
  const length = Math.max(end.getTime() - from.getTime(), 60_000)
  const previousFrom = new Date(from.getTime() - length)
  const later = new Date(now.getTime() + 1)
  const week = new Date(now.getTime() - 7 * DAY_MS)
  const month = new Date(now.getTime() - 30 * DAY_MS)
  const lapseFrom = new Date(now.getTime() - 37 * DAY_MS)

  const [activity, people] = await Promise.all([
    one(sql`
      SELECT
        (SELECT COUNT(*)::int FROM (${bettors(scope, istMidnight(now), later)}) d) AS daily,
        (SELECT COUNT(*)::int FROM (${bettors(scope, week, later)}) w) AS weekly,
        (SELECT COUNT(*)::int FROM (${bettors(scope, month, later)}) mo) AS monthly,
        (SELECT COUNT(*)::int FROM (${bettors(scope, from, end)}) p) AS in_period,
        (SELECT COUNT(*)::int FROM (${bettors(scope, previousFrom, from)}) q) AS previous,
        (SELECT COUNT(*)::int FROM (${bettors(scope, from, end)}) p JOIN (${bettors(scope, previousFrom, from)}) q USING (user_id)) AS returning,
        (SELECT COUNT(*)::int FROM (${bettors(scope, lapseFrom, week)}) l
          WHERE NOT EXISTS (SELECT 1 FROM (${bettors(scope, week, later)}) r WHERE r.user_id = l.user_id)) AS lapsing`),
    one(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users u WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}
          AND u.created_at >= ${from} AND u.created_at < ${end}) AS new_players,
        (SELECT COUNT(*)::int FROM users u WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}
          AND u.created_at >= ${from} AND u.created_at < ${end}
          AND EXISTS (SELECT 1 FROM deposit_requests d WHERE d.user_id = u.id AND d.status::text = 'APPROVED')) AS new_depositors,
        (SELECT COUNT(*)::int FROM (
          SELECT d.user_id FROM deposit_requests d
          WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at < ${end}
          GROUP BY d.user_id HAVING COUNT(*) >= 2) r) AS repeat_depositors,
        (SELECT COUNT(DISTINCT d.user_id)::int FROM deposit_requests d
          WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at < ${end}) AS depositors`),
  ])

  return {
    dailyActive: num(activity.daily),
    weeklyActive: num(activity.weekly),
    monthlyActive: num(activity.monthly),
    activeInPeriod: num(activity.in_period),
    activePrevious: num(activity.previous),
    returning: num(activity.returning),
    newPlayers: num(people.new_players),
    newDepositors: num(people.new_depositors),
    repeatDepositors: num(people.repeat_depositors),
    depositors: num(people.depositors),
    lapsing: num(activity.lapsing),
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Financial tab                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

async function casinoProviders(scope: DashboardInsightsScope, from: Date, to: Date, limit: number) {
  // Settled cash rounds, as the casino GGR report counts them (casinoReportingRepo).
  const settled = sql`
    FROM casino_bets c
    WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.status::text IN ('won', 'lost')
      AND COALESCE(c.wallet_type, 'cash') = 'cash'
      AND c.created_at >= ${from} AND c.created_at <= ${to}`
  const columns = sql`
    COALESCE(SUM(c.stake::numeric), 0) AS turnover,
    COALESCE(SUM(COALESCE(c.payout, c.win_amount, 0)::numeric), 0) AS payouts,
    COUNT(*)::int AS bets,
    COUNT(DISTINCT c.user_id)::int AS players`
  const [byVendor, total] = await Promise.all([
    rows(sql`SELECT COALESCE(NULLIF(c.vendor_name, ''), 'Unknown') AS vendor, ${columns} ${settled}
      GROUP BY 1 ORDER BY turnover DESC LIMIT ${limit}`),
    one(sql`SELECT 'All providers' AS vendor, ${columns} ${settled}`),
  ])
  const shape = (r: Record<string, unknown>): CasinoProviderRow => ({
    vendor: String(r.vendor ?? 'Unknown'),
    turnover: num(r.turnover),
    payouts: num(r.payouts),
    ggr: Math.round((num(r.turnover) - num(r.payouts)) * 100) / 100,
    bets: num(r.bets),
    players: num(r.players),
  })
  return { providers: byVendor.map(shape), total: shape(total) }
}

async function bonusAnalysis(scope: DashboardInsightsScope, from: Date, to: Date) {
  const awards = sql`FROM bonus_awards b JOIN users u ON u.id = b.user_id WHERE ${inTenant(sql`u.tenant`, scope.tenant)}`
  const given = sql`b.awarded_at >= ${from} AND b.awarded_at <= ${to} AND b.status::text <> 'cancelled'`
  const [summary, byType, stakes] = await Promise.all([
    one(sql`
      SELECT
        COALESCE(SUM(b.amount) FILTER (WHERE ${given}), 0) AS given,
        COUNT(*) FILTER (WHERE ${given})::int AS awards,
        COALESCE(SUM(b.amount) FILTER (WHERE b.status::text IN ('pending', 'active')), 0) AS outstanding,
        COUNT(*) FILTER (WHERE b.status::text IN ('pending', 'active'))::int AS outstanding_awards,
        COUNT(*) FILTER (WHERE ${given} AND b.status::text = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE ${given} AND b.status::text = 'expired')::int AS expired
      ${awards}`),
    rows(sql`
      SELECT b.type::text AS type, COALESCE(SUM(b.amount), 0) AS amount, COUNT(*)::int AS awards
      ${awards} AND ${given}
      GROUP BY 1 ORDER BY amount DESC LIMIT 6`),
    one(sql`
      SELECT
        (SELECT COALESCE(SUM(c.stake::numeric), 0) FROM casino_bets c
          WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.bonus_award_id IS NOT NULL
            AND c.created_at >= ${from} AND c.created_at <= ${to})
        + (SELECT COALESCE(SUM(m.bet_amount::numeric), 0) FROM matka_bets m
          WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.bonus_award_id IS NOT NULL
            AND m.created_at >= ${from} AND m.created_at <= ${to}) AS stakes`),
  ])
  return {
    bonusGiven: num(summary.given),
    bonusAwards: num(summary.awards),
    bonusByType: byType.map((r) => ({ type: String(r.type), amount: num(r.amount), awards: num(r.awards) })),
    bonusOutstanding: num(summary.outstanding),
    bonusOutstandingAwards: num(summary.outstanding_awards),
    bonusCompleted: num(summary.completed),
    bonusExpired: num(summary.expired),
    bonusStakes: num(stakes.stakes),
  }
}

export async function getFinancialInsights(scope: DashboardInsightsScope, range: Range, now: Date = new Date()): Promise<FinancialInsights> {
  if (scope.tenant === '') throw new Error('financialInsights: an empty tenant is not a valid scope')
  const { from, to } = period(range, now)
  const [casino, bonus] = await Promise.all([casinoProviders(scope, from, to, 8), bonusAnalysis(scope, from, to)])
  return { casinoProviders: casino.providers, casinoTotal: casino.total, ...bonus }
}
