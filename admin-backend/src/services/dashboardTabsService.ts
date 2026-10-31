/**
 * The Executive Dashboard's Players, Agents and Time tabs, rebuilt on the owner's ask (2026-10-29: "sare
 * data proper show hone chahiye"). The Financial tab reads the period KPIs and dashboardTrends it already
 * had, plus dashboardFinancialInsights (dashboardInsightsService).
 *
 *   Players - the player base as a funnel, how it splits by status and type, daily sign-ups and first
 *             deposits, where players play, how they bet and deposit, the biggest stakers and depositors,
 *             and the period against the one before it.
 *   Agents  - the network (schemes, levels, players under agents), commission and settlement, an agent
 *             leaderboard on each agent's own players, and the credit agents' limits.
 *   Time    - bets by IST weekday and hour (a heatmap), the hourly and weekday profiles, and this month's
 *             run rate against last month.
 *
 * Definitions are the rest of the dashboard's:
 *   - a bet's stake is COALESCE(liability, stake) for sports, stake for casino, bet_amount for matka;
 *   - the house's GGR on a settled bet is minus the player's P/L: -sportsPlayerProfitSql for sports,
 *     stake - payout (else win_amount) on won / lost cash rounds for casino (as the casino GGR report),
 *     bet - actual_win on a win and the bet on a loss for matka; an open bet adds nothing;
 *   - "active" means placed a bet; players leave out admin users; a tenant of undefined is core mode;
 *   - an agent's own players are those with users.agent_id = the agent, plus players they referred
 *     (confirmed referral_attributions), the two routes PlayerAuthService.getAgentPlayerIds follows.
 * Days, hours and weekdays are IST (Asia/Kolkata). Money is raw, in the whitelabel's own currency.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { sportsPlayerProfitSql } from '@/shared/reportingSql.js'
import { inTenant, isPlayer, istMidnight } from '@/services/dashboardOperationsService.js'

export interface DashboardTabsScope {
  /** undefined: director core mode, every whitelabel. */
  tenant?: string
}

type Range = { dateFrom?: string; dateTo?: string }

const IST = sql`'Asia/Kolkata'`
const DAY_MS = 86_400_000
/** The daily series never runs longer than this; a longer period shows its last this-many days. */
const MAX_SERIES_DAYS = 93

const num = (value: unknown) => Number(value ?? 0) || 0
const text = (value: unknown) => (value === null || value === undefined ? null : String(value))

async function rows(query: SQL): Promise<Record<string, unknown>[]> {
  const result = await db.execute(query)
  return result.rows as Record<string, unknown>[]
}

async function one(query: SQL): Promise<Record<string, unknown>> {
  return (await rows(query))[0] ?? {}
}

function period(range: Range, now: Date): { from: Date; to: Date } {
  const from = range.dateFrom && !isNaN(Date.parse(range.dateFrom)) ? new Date(range.dateFrom) : istMidnight(now)
  const to = range.dateTo && !isNaN(Date.parse(range.dateTo)) ? new Date(range.dateTo) : now
  return { from, to }
}

/**
 * Every bet of the window, one row per bet in one shape: the product, the player, when, the stake, the
 * house's GGR on it (0 while open) and whether it has settled.
 */
export function allBets(scope: DashboardTabsScope, from: Date, to: Date): SQL {
  const profit = sql.raw(sportsPlayerProfitSql('b'))
  return sql`
    SELECT 'sports' AS product, b.user_id, b.created_at, COALESCE(b.liability::numeric, b.stake::numeric, 0) AS stake,
      -(${profit}) AS house, (b.status::text IN ('won', 'lost', 'settled')) AS settled, TRUE AS cash
    FROM sports_bets b
    WHERE ${inTenant(sql`b.tenant`, scope.tenant)} AND b.created_at >= ${from} AND b.created_at <= ${to}
    UNION ALL
    SELECT 'casino', c.user_id, c.created_at, COALESCE(c.stake::numeric, 0),
      CASE WHEN c.status::text IN ('won', 'lost') AND COALESCE(c.wallet_type, 'cash') = 'cash'
        THEN COALESCE(c.stake::numeric, 0) - COALESCE(c.payout, c.win_amount, 0)::numeric ELSE 0 END,
      (c.status::text IN ('won', 'lost')), COALESCE(c.wallet_type, 'cash') = 'cash'
    FROM casino_bets c
    WHERE ${inTenant(sql`c.tenant`, scope.tenant)} AND c.created_at >= ${from} AND c.created_at <= ${to}
    UNION ALL
    SELECT 'matka', m.user_id, m.created_at, COALESCE(m.bet_amount::numeric, 0),
      CASE WHEN m.status::text = 'won' THEN COALESCE(m.bet_amount::numeric, 0) - COALESCE(m.actual_win::numeric, 0)
           WHEN m.status::text = 'lost' THEN COALESCE(m.bet_amount::numeric, 0) ELSE 0 END,
      (m.status::text IN ('won', 'lost')), TRUE
    FROM matka_bets m
    WHERE ${inTenant(sql`m.tenant`, scope.tenant)} AND m.created_at >= ${from} AND m.created_at <= ${to}`
}

/** User ids with a bet in [from, to], any product. */
function bettors(scope: DashboardTabsScope, from: Date, to: Date): SQL {
  return sql`SELECT DISTINCT x.user_id FROM (${allBets(scope, from, to)}) x`
}

/** The player's username and their agent's login name, for a row set with a user_id column. */
function withPlayer(inner: SQL): SQL {
  return sql`
    SELECT x.*, u.username, ac.username AS agent
    FROM (${inner}) x
    JOIN users u ON u.id = x.user_id
    LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = u.agent_id LIMIT 1) ac ON TRUE`
}

const istDate = (column: SQL) => sql`(${column} AT TIME ZONE ${IST})::date`

/* ------------------------------------------------------------------------------------------------ */
/* Players                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface PlayersTab {
  funnel: { registered: number; depositors: number; bettors30: number; bettors7: number; bettorsToday: number }
  byStatus: Array<{ key: string; players: number }>
  byType: Array<{ key: string; players: number }>
  daily: Array<{ day: string; registrations: number; firstDeposits: number; firstDepositAmount: number }>
  products: Array<{ product: string; bettors: number; bets: number; stake: number; ggr: number }>
  topStakers: Array<{ userId: number; username: string; agent: string | null; bets: number; staked: number; playerPl: number }>
  topDepositors: Array<{ userId: number; username: string; agent: string | null; deposits: number; amount: number }>
  current: PlayerPeriodFigures
  previous: PlayerPeriodFigures
}

export interface PlayerPeriodFigures {
  newPlayers: number
  bettors: number
  bets: number
  turnover: number
  depositors: number
  deposits: number
  depositAmount: number
}

async function playerPeriod(scope: DashboardTabsScope, from: Date, to: Date): Promise<PlayerPeriodFigures> {
  const r = await one(sql`
    SELECT
      (SELECT COUNT(*)::int FROM users u WHERE ${inTenant(sql`u.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}
        AND u.created_at >= ${from} AND u.created_at <= ${to}) AS new_players,
      (SELECT COUNT(DISTINCT x.user_id)::int FROM (${allBets(scope, from, to)}) x) AS bettors,
      (SELECT COUNT(*)::int FROM (${allBets(scope, from, to)}) x) AS bets,
      (SELECT COALESCE(SUM(x.stake), 0) FROM (${allBets(scope, from, to)}) x) AS turnover,
      (SELECT COUNT(DISTINCT d.user_id)::int FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)}
        AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at <= ${to}) AS depositors,
      (SELECT COUNT(*)::int FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)}
        AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at <= ${to}) AS deposits,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)}
        AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at <= ${to}) AS deposit_amount`)
  return {
    newPlayers: num(r.new_players),
    bettors: num(r.bettors),
    bets: num(r.bets),
    turnover: num(r.turnover),
    depositors: num(r.depositors),
    deposits: num(r.deposits),
    depositAmount: num(r.deposit_amount),
  }
}

export async function getPlayersTab(scope: DashboardTabsScope, range: Range, now: Date = new Date()): Promise<PlayersTab> {
  if (scope.tenant === '') throw new Error('dashboardPlayersTab: an empty tenant is not a valid scope')
  const { from, to } = period(range, now)
  const length = Math.max(to.getTime() - from.getTime(), 60_000)
  const previousFrom = new Date(from.getTime() - length)
  const seriesFrom = new Date(Math.max(from.getTime(), to.getTime() - (MAX_SERIES_DAYS - 1) * DAY_MS))
  const players = sql`${inTenant(sql`u.tenant`, scope.tenant)} AND ${isPlayer(sql`u`)}`

  const [funnel, byStatus, byType, daily, products, stakers, depositors, current, previous] = await Promise.all([
    one(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users u WHERE ${players}) AS registered,
        (SELECT COUNT(DISTINCT d.user_id)::int FROM deposit_requests d WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'APPROVED') AS depositors,
        (SELECT COUNT(*)::int FROM (${bettors(scope, new Date(now.getTime() - 30 * DAY_MS), now)}) a) AS bettors30,
        (SELECT COUNT(*)::int FROM (${bettors(scope, new Date(now.getTime() - 7 * DAY_MS), now)}) b) AS bettors7,
        (SELECT COUNT(*)::int FROM (${bettors(scope, istMidnight(now), now)}) c) AS today`),
    rows(sql`SELECT COALESCE(u.status::text, 'unknown') AS key, COUNT(*)::int AS players FROM users u WHERE ${players} GROUP BY 1 ORDER BY 2 DESC`),
    rows(sql`SELECT COALESCE(u.player_type::text, 'REGULAR') AS key, COUNT(*)::int AS players FROM users u WHERE ${players} GROUP BY 1 ORDER BY 2 DESC`),
    rows(sql`
      WITH days AS (
        SELECT generate_series(${istDate(sql`${seriesFrom}::timestamptz`)}, ${istDate(sql`${to}::timestamptz`)}, interval '1 day')::date AS day
      ),
      regs AS (
        SELECT ${istDate(sql`u.created_at`)} AS day, COUNT(*)::int AS n FROM users u
        WHERE ${players} AND u.created_at >= ${seriesFrom} AND u.created_at <= ${to} GROUP BY 1
      ),
      firsts AS (
        SELECT DISTINCT ON (d.user_id) d.user_id, d.created_at, d.amount FROM deposit_requests d
        WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'APPROVED'
        ORDER BY d.user_id, d.created_at
      ),
      ftd AS (
        SELECT ${istDate(sql`f.created_at`)} AS day, COUNT(*)::int AS n, COALESCE(SUM(f.amount), 0) AS amount FROM firsts f
        WHERE f.created_at >= ${seriesFrom} AND f.created_at <= ${to} GROUP BY 1
      )
      SELECT TO_CHAR(days.day, 'YYYY-MM-DD') AS day, COALESCE(regs.n, 0) AS registrations,
        COALESCE(ftd.n, 0) AS first_deposits, COALESCE(ftd.amount, 0) AS first_deposit_amount
      FROM days LEFT JOIN regs ON regs.day = days.day LEFT JOIN ftd ON ftd.day = days.day
      ORDER BY days.day`),
    rows(sql`
      SELECT p.product, COUNT(DISTINCT x.user_id)::int AS bettors, COUNT(x.user_id)::int AS bets,
        COALESCE(SUM(x.stake), 0) AS stake, COALESCE(SUM(x.house), 0) AS ggr
      FROM (VALUES ('sports'), ('casino'), ('matka')) p(product)
      LEFT JOIN (${allBets(scope, from, to)}) x ON x.product = p.product
      GROUP BY p.product ORDER BY stake DESC, p.product`),
    rows(sql`${withPlayer(sql`
      SELECT x.user_id, COUNT(*)::int AS bets, SUM(x.stake) AS staked, -SUM(x.house) AS player_pl
      FROM (${allBets(scope, from, to)}) x GROUP BY x.user_id ORDER BY staked DESC LIMIT 8`)} ORDER BY x.staked DESC`),
    rows(sql`${withPlayer(sql`
      SELECT d.user_id, COUNT(*)::int AS deposits, SUM(d.amount) AS amount FROM deposit_requests d
      WHERE ${inTenant(sql`d.tenant`, scope.tenant)} AND d.status::text = 'APPROVED' AND d.created_at >= ${from} AND d.created_at <= ${to}
      GROUP BY d.user_id ORDER BY amount DESC LIMIT 5`)} ORDER BY x.amount DESC`),
    playerPeriod(scope, from, to),
    playerPeriod(scope, previousFrom, from),
  ])

  return {
    funnel: {
      registered: num(funnel.registered),
      depositors: num(funnel.depositors),
      bettors30: num(funnel.bettors30),
      bettors7: num(funnel.bettors7),
      bettorsToday: num(funnel.today),
    },
    byStatus: byStatus.map((r) => ({ key: String(r.key), players: num(r.players) })),
    byType: byType.map((r) => ({ key: String(r.key), players: num(r.players) })),
    daily: daily.map((r) => ({
      day: String(r.day),
      registrations: num(r.registrations),
      firstDeposits: num(r.first_deposits),
      firstDepositAmount: num(r.first_deposit_amount),
    })),
    products: products.map((r) => ({ product: String(r.product), bettors: num(r.bettors), bets: num(r.bets), stake: num(r.stake), ggr: num(r.ggr) })),
    topStakers: stakers.map((r) => ({
      userId: num(r.user_id), username: String(r.username ?? ''), agent: text(r.agent),
      bets: num(r.bets), staked: num(r.staked), playerPl: num(r.player_pl),
    })),
    topDepositors: depositors.map((r) => ({
      userId: num(r.user_id), username: String(r.username ?? ''), agent: text(r.agent),
      deposits: num(r.deposits), amount: num(r.amount),
    })),
    current,
    previous,
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Agents                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface AgentsTab {
  network: {
    total: number
    active: number
    suspended: number
    sharing: number
    commission: number
    credit: number
    topLevel: number
    levels: number
    newAgents: number
    playersUnderAgents: number
    directPlayers: number
  }
  commissionTotal: number
  commissionByDomain: Array<{ domain: string; amount: number }>
  settlementOwed: number
  settlementOwing: number
  agentsWithBalance: number
  settlementsPosted: number
  settlementsAmount: number
  leaderboard: Array<{
    agentId: string
    username: string | null
    scheme: string
    status: string
    subAgents: number
    players: number
    activePlayers: number
    turnover: number
    ggr: number
    commission: number
  }>
  creditAgents: Array<{ agentId: string; username: string | null; creditLimit: number; creditUsed: number; creditAvailable: number; usedShare: number }>
  creditLimit: number
  creditUsed: number
}

export async function getAgentsTab(scope: DashboardTabsScope, range: Range, now: Date = new Date()): Promise<AgentsTab> {
  if (scope.tenant === '') throw new Error('dashboardAgentsTab: an empty tenant is not a valid scope')
  const { from, to } = period(range, now)
  const agentsIn = inTenant(sql`a.tenant_id`, scope.tenant)
  const usersIn = inTenant(sql`u.tenant`, scope.tenant)

  const [network, commission, settlement, leaderboard, credit] = await Promise.all([
    one(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE a.status <> 'ACTIVE')::int AS suspended,
        COUNT(*) FILTER (WHERE a.scheme_type::text = 'SHARING')::int AS sharing,
        COUNT(*) FILTER (WHERE a.scheme_type::text = 'COMMISSION')::int AS commission,
        COUNT(*) FILTER (WHERE a.scheme_type::text = 'CREDIT')::int AS credit,
        COUNT(*) FILTER (WHERE a.parent_agent_id IS NULL)::int AS top_level,
        COALESCE(MAX(a.level_index), 0)::int + 1 AS levels,
        COUNT(*) FILTER (WHERE a.created_at >= ${from} AND a.created_at <= ${to})::int AS new_agents,
        (SELECT COUNT(*)::int FROM users u WHERE ${usersIn} AND ${isPlayer(sql`u`)} AND u.agent_id IS NOT NULL) AS under_agents,
        (SELECT COUNT(*)::int FROM users u WHERE ${usersIn} AND ${isPlayer(sql`u`)} AND u.agent_id IS NULL) AS direct_players
      FROM agents a WHERE ${agentsIn}`),
    rows(sql`
      SELECT COALESCE(l.domain, 'other') AS domain, COALESCE(SUM(l.amount), 0) AS amount
      FROM agent_ledger l JOIN agents a ON a.id = l.agent_id
      WHERE ${agentsIn} AND l.line_type::text = 'COMMISSION' AND l.created_at >= ${from} AND l.created_at <= ${to}
      GROUP BY 1 ORDER BY 2 DESC`),
    one(sql`
      SELECT
        COALESCE(SUM(a.settlement_balance) FILTER (WHERE a.settlement_balance > 0), 0) AS owed,
        COALESCE(SUM(a.settlement_balance) FILTER (WHERE a.settlement_balance < 0), 0) AS owing,
        COUNT(*) FILTER (WHERE a.settlement_balance <> 0)::int AS with_balance,
        (SELECT COUNT(*)::int FROM agent_settlement_transactions t WHERE ${inTenant(sql`t.tenant`, scope.tenant)}
          AND t.created_at >= ${from} AND t.created_at <= ${to}) AS posted,
        (SELECT COALESCE(SUM(ABS(t.amount)), 0) FROM agent_settlement_transactions t WHERE ${inTenant(sql`t.tenant`, scope.tenant)}
          AND t.created_at >= ${from} AND t.created_at <= ${to}) AS posted_amount
      FROM agents a WHERE ${agentsIn}`),
    rows(sql`
      WITH own AS (
        SELECT u.agent_id, u.id AS user_id FROM users u WHERE ${usersIn} AND u.agent_id IS NOT NULL
        UNION
        SELECT u.agent_id, ra.referee_id FROM users u
        JOIN referral_attributions ra ON ra.referrer_id = u.id AND ra.tenant = u.tenant AND ra.status::text = 'confirmed'
        WHERE ${usersIn} AND u.agent_id IS NOT NULL
      ),
      play AS (
        SELECT x.user_id, SUM(x.stake) AS stake, SUM(x.house) AS house FROM (${allBets(scope, from, to)}) x GROUP BY x.user_id
      ),
      board AS (
        SELECT own.agent_id, COUNT(own.user_id)::int AS players, COUNT(play.user_id)::int AS active,
          COALESCE(SUM(play.stake), 0) AS turnover, COALESCE(SUM(play.house), 0) AS ggr
        FROM own LEFT JOIN play ON play.user_id = own.user_id GROUP BY own.agent_id
      )
      SELECT a.id::text AS agent_id, ac.username, a.scheme_type::text AS scheme, a.status,
        (SELECT COUNT(*)::int FROM agents c WHERE c.parent_agent_id = a.id) AS sub_agents,
        COALESCE(board.players, 0) AS players, COALESCE(board.active, 0) AS active,
        COALESCE(board.turnover, 0) AS turnover, COALESCE(board.ggr, 0) AS ggr,
        (SELECT COALESCE(SUM(l.amount), 0) FROM agent_ledger l WHERE l.agent_id = a.id AND l.line_type::text = 'COMMISSION'
          AND l.created_at >= ${from} AND l.created_at <= ${to}) AS commission
      FROM agents a
      LEFT JOIN board ON board.agent_id = a.id
      LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = a.id LIMIT 1) ac ON TRUE
      WHERE ${agentsIn}
      ORDER BY turnover DESC, players DESC, ac.username ASC
      LIMIT 10`),
    rows(sql`
      SELECT a.id::text AS agent_id, ac.username, a.credit_limit, a.credit_used, a.credit_available,
        a.credit_used::numeric / NULLIF(a.credit_limit::numeric, 0) AS used_share
      FROM agents a
      LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = a.id LIMIT 1) ac ON TRUE
      WHERE ${agentsIn} AND a.scheme_type::text = 'CREDIT'
      ORDER BY used_share DESC NULLS LAST, a.credit_used DESC
      LIMIT 8`),
  ])

  const commissionByDomain = commission.map((r) => ({ domain: String(r.domain), amount: num(r.amount) }))
  const creditAgents = credit.map((r) => ({
    agentId: String(r.agent_id), username: text(r.username),
    creditLimit: num(r.credit_limit), creditUsed: num(r.credit_used), creditAvailable: num(r.credit_available), usedShare: num(r.used_share),
  }))
  const totals = await one(sql`
    SELECT COALESCE(SUM(a.credit_limit), 0) AS credit_limit, COALESCE(SUM(a.credit_used), 0) AS credit_used
    FROM agents a WHERE ${agentsIn} AND a.scheme_type::text = 'CREDIT'`)

  return {
    network: {
      total: num(network.total),
      active: num(network.active),
      suspended: num(network.suspended),
      sharing: num(network.sharing),
      commission: num(network.commission),
      credit: num(network.credit),
      topLevel: num(network.top_level),
      levels: num(network.total) > 0 ? num(network.levels) : 0,
      newAgents: num(network.new_agents),
      playersUnderAgents: num(network.under_agents),
      directPlayers: num(network.direct_players),
    },
    commissionTotal: commissionByDomain.reduce((sum, row) => sum + row.amount, 0),
    commissionByDomain,
    settlementOwed: num(settlement.owed),
    settlementOwing: num(settlement.owing),
    agentsWithBalance: num(settlement.with_balance),
    settlementsPosted: num(settlement.posted),
    settlementsAmount: num(settlement.posted_amount),
    leaderboard: leaderboard.map((r) => ({
      agentId: String(r.agent_id),
      username: text(r.username),
      scheme: String(r.scheme ?? ''),
      status: String(r.status ?? ''),
      subAgents: num(r.sub_agents),
      players: num(r.players),
      activePlayers: num(r.active),
      turnover: num(r.turnover),
      ggr: num(r.ggr),
      commission: num(r.commission),
    })),
    creditAgents,
    creditLimit: num(totals.credit_limit),
    creditUsed: num(totals.credit_used),
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Time                                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export interface TimeTab {
  /** The window the heatmap and profiles read: the period, or the last 30 days when the period is under a week. */
  windowFrom: string
  windowTo: string
  windowDays: number
  widened: boolean
  /** ISO weekday 1 (Mon) .. 7 (Sun) × hour 0..23; only cells with bets. */
  heatmap: Array<{ weekday: number; hour: number; bets: number; stake: number }>
  hourly: Array<{ hour: number; bets: number; stake: number; ggr: number; players: number }>
  weekdays: Array<{ weekday: number; bets: number; stake: number; ggr: number; players: number }>
  month: {
    /** e.g. "2026-10" */
    month: string
    daysElapsed: number
    daysInMonth: number
    ggr: number
    turnover: number
    bets: number
    previousGgr: number
    previousTurnover: number
    previousBets: number
  }
}

/** The first instant of an IST calendar month, `offset` months from the month of `now`. */
function istMonthStart(now: Date, offset: number): Date {
  const ist = new Date(now.getTime() + 330 * 60_000)
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + offset, 1) - 330 * 60_000)
}

export async function getTimeTab(scope: DashboardTabsScope, range: Range, now: Date = new Date()): Promise<TimeTab> {
  if (scope.tenant === '') throw new Error('dashboardTimeTab: an empty tenant is not a valid scope')
  const requested = period(range, now)
  // A profile of the day needs more than a day or two of bets.
  const widened = requested.to.getTime() - requested.from.getTime() < 7 * DAY_MS
  const from = widened ? new Date(requested.to.getTime() - 30 * DAY_MS) : requested.from
  const to = requested.to
  const local = (column: SQL) => sql`(${column} AT TIME ZONE ${IST})`
  const bets = allBets(scope, from, to)

  const monthStart = istMonthStart(now, 0)
  const previousStart = istMonthStart(now, -1)
  const nextStart = istMonthStart(now, 1)
  const daysInMonth = Math.round((nextStart.getTime() - monthStart.getTime()) / DAY_MS)
  const daysElapsed = Math.min(daysInMonth, Math.floor((now.getTime() - monthStart.getTime()) / DAY_MS) + 1)
  // Last month to the same point, so the comparison is like for like.
  const previousCut = new Date(Math.min(monthStart.getTime(), previousStart.getTime() + (now.getTime() - monthStart.getTime())))

  const [heatmap, hourly, weekdays, month, previous] = await Promise.all([
    rows(sql`
      SELECT EXTRACT(ISODOW FROM ${local(sql`x.created_at`)})::int AS weekday, EXTRACT(HOUR FROM ${local(sql`x.created_at`)})::int AS hour,
        COUNT(*)::int AS bets, COALESCE(SUM(x.stake), 0) AS stake
      FROM (${bets}) x GROUP BY 1, 2`),
    rows(sql`
      SELECT h.hour, COUNT(x.user_id)::int AS bets, COALESCE(SUM(x.stake), 0) AS stake, COALESCE(SUM(x.house), 0) AS ggr,
        COUNT(DISTINCT x.user_id)::int AS players
      FROM generate_series(0, 23) h(hour)
      LEFT JOIN (${bets}) x ON EXTRACT(HOUR FROM ${local(sql`x.created_at`)})::int = h.hour
      GROUP BY h.hour ORDER BY h.hour`),
    rows(sql`
      SELECT d.weekday, COUNT(x.user_id)::int AS bets, COALESCE(SUM(x.stake), 0) AS stake, COALESCE(SUM(x.house), 0) AS ggr,
        COUNT(DISTINCT x.user_id)::int AS players
      FROM generate_series(1, 7) d(weekday)
      LEFT JOIN (${bets}) x ON EXTRACT(ISODOW FROM ${local(sql`x.created_at`)})::int = d.weekday
      GROUP BY d.weekday ORDER BY d.weekday`),
    one(sql`SELECT COALESCE(SUM(x.house), 0) AS ggr, COALESCE(SUM(x.stake), 0) AS turnover, COUNT(*)::int AS bets
      FROM (${allBets(scope, monthStart, now)}) x`),
    one(sql`SELECT COALESCE(SUM(x.house), 0) AS ggr, COALESCE(SUM(x.stake), 0) AS turnover, COUNT(*)::int AS bets
      FROM (${allBets(scope, previousStart, previousCut)}) x`),
  ])

  const ist = new Date(now.getTime() + 330 * 60_000)
  return {
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    windowDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS)),
    widened,
    heatmap: heatmap.map((r) => ({ weekday: num(r.weekday), hour: num(r.hour), bets: num(r.bets), stake: num(r.stake) })),
    hourly: hourly.map((r) => ({ hour: num(r.hour), bets: num(r.bets), stake: num(r.stake), ggr: num(r.ggr), players: num(r.players) })),
    weekdays: weekdays.map((r) => ({ weekday: num(r.weekday), bets: num(r.bets), stake: num(r.stake), ggr: num(r.ggr), players: num(r.players) })),
    month: {
      month: `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`,
      daysElapsed,
      daysInMonth,
      ggr: num(month.ggr),
      turnover: num(month.turnover),
      bets: num(month.bets),
      previousGgr: num(previous.ggr),
      previousTurnover: num(previous.turnover),
      previousBets: num(previous.bets),
    },
  }
}
