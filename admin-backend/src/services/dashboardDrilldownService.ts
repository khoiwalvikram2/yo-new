/**
 * The Executive Dashboard's drill-downs (the owner's ask, 2026-10-29): click a figure, see the rows behind
 * it in a modal. "Pending Deposit Requests" opens every pending request with its player; "Players Who Bet"
 * opens those players with their bets and stakes; a risk event opens its open bets; and so on.
 *
 * One query serves every figure: a `kind` names what is listed, an optional `arg` narrows it (a scheme, a
 * status, an event, a trailing window), and the dashboard's period, a search and a page apply on top. Each
 * kind is a SQL source plus the columns the modal draws; the source's predicates are the figure's own, so
 * a list's total matches the figure it opened from:
 *
 *   - direct money is approved deposit requests / completed withdrawal requests by COALESCE(reviewed_at,
 *     created_at) (getLedgerAggregatesByWalletDb); manual money is the admin ledger entries
 *     getManualDepositWithdrawalStatsTenantDb counts, at ABS(meta.originalAmount);
 *   - open bets, stale / stuck / overdue bets and chip movements use dashboardOperationsService's rules;
 *   - bets, stakes and GGR use dashboardTabsService's allBets.
 *
 * Every source selects `row_id`, a `search_text` (the player's or agent's names and phone), the columns'
 * keys, and `player_id` / `agent_id` where a row links to a player or an agent. Players leave out admin
 * users; a tenant of undefined is director core mode. Money is raw, in the whitelabel's own currency.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client.js'
import { sportsPlayerProfitSql } from '@/shared/reportingSql.js'
import {
  CASINO_STUCK_MINUTES,
  ONLINE_WINDOW_MINS,
  STALE_SPORTS_HOURS,
  inTenant,
  isPlayer,
  istMidnight,
} from '@/services/dashboardOperationsService.js'
import { allBets } from '@/services/dashboardTabsService.js'

export type DrillColumnKind = 'text' | 'player' | 'agent' | 'money' | 'count' | 'datetime' | 'status' | 'percent' | 'duration'

export interface DrillColumn {
  key: string
  label: string
  kind: DrillColumnKind
}

export interface DrillRow {
  id: string
  /** One per column, in the columns' order; null where the source has nothing. */
  cells: Array<string | null>
  playerId: number | null
  agentId: string | null
}

export interface Drilldown {
  kind: string
  title: string
  subtitle: string
  columns: DrillColumn[]
  rows: DrillRow[]
  total: number
  /** A page that manages these rows, when there is one. */
  page: string | null
}

export interface DrillScope {
  tenant?: string
}

interface DrillContext {
  scope: DrillScope
  from: Date
  to: Date
  now: Date
  arg: string
  /** True when the arg set the window (mins:N, today); the subtitle then names it. */
  windowFromArg: boolean
}

interface DrillSpec {
  title: string
  subtitle: (c: DrillContext) => string
  columns: DrillColumn[]
  source: (c: DrillContext) => SQL
  /** Over the source's alias `q`. */
  order: SQL
  page?: string
}

const CREDIT_TYPES = sql`('WHITELABEL_CREDIT', 'AGENT_CREDIT')`
const OPEN_SPORTS = sql`('matched', 'unmatched')`
const OPEN_OTHER = sql`('pending', 'active')`

/* ---- shared fragments ---------------------------------------------------------------------------- */

/** The player's columns and search text, for a source that has joined users as `u` and agentOf(u) as `ac`. */
const PLAYER = sql`u.id AS player_id, u.username, u.name AS player_name, u.phone, ac.username AS agent, u.agent_id::text AS agent_id,
  CONCAT_WS(' ', u.username, u.name, u.phone, ac.username) AS search_text`
/** The player's agent's login name. */
const AGENT_OF = sql`LEFT JOIN LATERAL (SELECT c.username FROM agent_credentials c WHERE c.agent_id = u.agent_id LIMIT 1) ac ON TRUE`

const PLAYER_COLUMNS: DrillColumn[] = [
  { key: 'username', label: 'Player', kind: 'player' },
  { key: 'player_name', label: 'Name', kind: 'text' },
  { key: 'phone', label: 'Phone', kind: 'text' },
  { key: 'agent', label: 'Agent', kind: 'agent' },
]
const PLAYER_SHORT: DrillColumn[] = [
  { key: 'username', label: 'Player', kind: 'player' },
  { key: 'agent', label: 'Agent', kind: 'agent' },
]

const minutesSince = (column: SQL, now: Date) => sql`EXTRACT(EPOCH FROM (${now}::timestamptz - ${column})) / 60`
const periodText = (c: DrillContext) => {
  if (!c.windowFromArg) return 'In the selected period'
  const mins = Math.round((c.to.getTime() - c.from.getTime()) / 60_000)
  if (c.arg === 'today') return 'Since midnight IST'
  if (mins < 120) return `In the last ${mins} minutes`
  if (mins < 2_880) return `In the last ${Math.round(mins / 60)} hours`
  return `In the last ${Math.round(mins / 1_440)} days`
}

/** A bank account as "BANK · HDFC · ••1234" and a UPI id as "UPI · name@bank". */
const PAYOUT = (p: string) => sql.raw(`CONCAT_WS(' · ', ${p}.method::text, ${p}.bank_name,
  CASE WHEN ${p}.method::text = 'BANK' AND ${p}.account_number IS NOT NULL THEN '••' || RIGHT(${p}.account_number, 4) ELSE ${p}.account_number END,
  ${p}.ifsc_code)`)

/** The arg's value after a prefix, or null. */
const after = (arg: string, prefix: string) => (arg.startsWith(prefix) ? arg.slice(prefix.length) : null)

/* ---- money ---------------------------------------------------------------------------------------- */

function directDeposits(c: DrillContext): SQL {
  return sql`
    SELECT 'request:' || d.id AS row_id, ${PLAYER}, d.amount, d.method::text AS method, COALESCE(d.utr, d.reference_id) AS reference,
      'Request' AS source, COALESCE(d.reviewed_at, d.created_at) AS at
    FROM deposit_requests d JOIN users u ON u.id = d.user_id ${AGENT_OF}
    WHERE ${inTenant(sql`d.tenant`, c.scope.tenant)} AND d.status::text = 'APPROVED'
      AND COALESCE(d.reviewed_at, d.created_at) >= ${c.from} AND COALESCE(d.reviewed_at, d.created_at) <= ${c.to}`
}

function manualMoney(c: DrillContext, direction: 'credit' | 'debit'): SQL {
  const types = direction === 'credit' ? sql`('deposit', 'admin_adjustment')` : sql`('withdrawal', 'admin_adjustment')`
  const notRequest = direction === 'credit' ? sql`AND (le.meta->>'depositRequestId' IS NULL OR le.meta->>'depositRequestId' = '')` : sql``
  return sql`
    SELECT 'ledger:' || le.id AS row_id, ${PLAYER}, ABS(NULLIF(le.meta->>'originalAmount', '')::numeric) AS amount,
      'Manual' AS method, COALESCE(le.meta->>'note', le.meta->>'reason') AS reference, 'Manual' AS source, le.created_at AS at
    FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id JOIN users u ON u.id = w.user_id ${AGENT_OF}
    WHERE ${inTenant(sql`le.tenant`, c.scope.tenant)} AND le.type = ${direction} AND le.meta IS NOT NULL
      AND le.meta->>'type' IN ${types} ${notRequest}
      AND le.created_at >= ${c.from} AND le.created_at <= ${c.to}`
}

function directWithdrawals(c: DrillContext): SQL {
  return sql`
    SELECT 'request:' || w.id AS row_id, ${PLAYER}, w.amount, ${PAYOUT('pa')} AS method, NULL::text AS reference,
      'Request' AS source, COALESCE(w.reviewed_at, w.created_at) AS at
    FROM withdrawal_requests w JOIN users u ON u.id = w.user_id ${AGENT_OF}
    LEFT JOIN user_payout_accounts pa ON pa.id = w.payout_account_id
    WHERE ${inTenant(sql`w.tenant`, c.scope.tenant)} AND w.status::text = 'COMPLETED'
      AND COALESCE(w.reviewed_at, w.created_at) >= ${c.from} AND COALESCE(w.reviewed_at, w.created_at) <= ${c.to}`
}

const MONEY_COLUMNS: DrillColumn[] = [
  ...PLAYER_SHORT,
  { key: 'amount', label: 'Amount', kind: 'money' },
  { key: 'source', label: 'Source', kind: 'text' },
  { key: 'method', label: 'Method / account', kind: 'text' },
  { key: 'reference', label: 'UTR / note', kind: 'text' },
  { key: 'at', label: 'When', kind: 'datetime' },
]

/* ---- bets ----------------------------------------------------------------------------------------- */

interface BetFilter {
  from?: Date
  to?: Date
  open?: boolean
  products?: ReadonlyArray<'sports' | 'casino' | 'matka'>
  sportKey?: string
  eventId?: string
  draw?: { matkaId: string; runDate: string | null; session: string | null }
  sportsStatus?: string
  createdBefore?: Date
  matkaOverdue?: Date
}

/** Bets with what they were on, one shape across products, narrowed by `f` inside each product's branch. */
function labelledBets(c: DrillContext, f: BetFilter): SQL {
  const has = (p: 'sports' | 'casino' | 'matka') => !f.products || f.products.includes(p)
  const when = (alias: string) => sql.join([
    f.from ? sql`${sql.raw(alias)}.created_at >= ${f.from}` : sql`TRUE`,
    f.to ? sql`${sql.raw(alias)}.created_at <= ${f.to}` : sql`TRUE`,
    f.createdBefore ? sql`${sql.raw(alias)}.created_at < ${f.createdBefore}` : sql`TRUE`,
  ], sql` AND `)
  const branches: SQL[] = []
  if (has('sports') && !f.draw) {
    branches.push(sql`
      SELECT 'sports:' || b.id AS row_id, b.user_id, 'Sports' AS product,
        CONCAT_WS(' · ', e.name, mk.name, rn.name, b.side::text) AS detail,
        COALESCE(b.liability::numeric, b.stake::numeric, 0) AS stake, b.status::text AS status, b.created_at AS placed,
        CASE WHEN b.status::text IN ('won', 'lost', 'settled') THEN (${sql.raw(sportsPlayerProfitSql('b'))}) ELSE NULL END AS player_pl
      FROM sports_bets b
      LEFT JOIN sports_events e ON e.id = b.event_id
      LEFT JOIN sports_markets mk ON mk.id = b.market_id
      LEFT JOIN sports_runners rn ON rn.id = b.runner_id
      ${f.sportKey ? sql`JOIN sports sp ON sp.id = b.sport_id AND sp.key = ${f.sportKey}` : sql``}
      WHERE ${inTenant(sql`b.tenant`, c.scope.tenant)} AND ${when('b')}
        ${f.open ? sql`AND b.status::text IN ${OPEN_SPORTS}` : sql``}
        ${f.sportsStatus ? sql`AND b.status::text = ${f.sportsStatus}` : sql``}
        ${f.eventId ? sql`AND b.event_id::text = ${f.eventId}` : sql``}`)
  }
  if (has('casino') && !f.sportKey && !f.eventId && !f.draw && !f.sportsStatus) {
    branches.push(sql`
      SELECT 'casino:' || cb.id AS row_id, cb.user_id, 'Casino' AS product, CONCAT_WS(' · ', cb.game_name, cb.vendor_name, cb.game_round_id) AS detail,
        COALESCE(cb.stake::numeric, 0) AS stake, cb.status::text AS status, cb.created_at AS placed,
        CASE WHEN cb.status::text IN ('won', 'lost') THEN COALESCE(cb.payout, cb.win_amount, 0)::numeric - COALESCE(cb.stake::numeric, 0) ELSE NULL END AS player_pl
      FROM casino_bets cb
      WHERE ${inTenant(sql`cb.tenant`, c.scope.tenant)} AND ${when('cb')} ${f.open ? sql`AND cb.status::text IN ${OPEN_OTHER}` : sql``}`)
  }
  if (has('matka') && !f.sportKey && !f.eventId && !f.sportsStatus) {
    branches.push(sql`
      SELECT 'matka:' || m.id AS row_id, m.user_id, 'Matka' AS product,
        CONCAT_WS(' · ', m.market_name, m.market_session, m.bid_type, m.bet_numbers, TO_CHAR(m.run_date, 'DD Mon')) AS detail,
        COALESCE(m.bet_amount::numeric, 0) AS stake, m.status::text AS status, m.created_at AS placed,
        CASE WHEN m.status::text = 'won' THEN COALESCE(m.actual_win::numeric, 0) - COALESCE(m.bet_amount::numeric, 0)
             WHEN m.status::text = 'lost' THEN -COALESCE(m.bet_amount::numeric, 0) ELSE NULL END AS player_pl
      FROM matka_bets m
      WHERE ${inTenant(sql`m.tenant`, c.scope.tenant)} AND ${when('m')} ${f.open ? sql`AND m.status::text IN ${OPEN_OTHER}` : sql``}
        ${f.draw ? sql`AND m.matka_id::text = ${f.draw.matkaId} AND m.run_date IS NOT DISTINCT FROM ${f.draw.runDate}::date
          AND m.market_session IS NOT DISTINCT FROM ${f.draw.session}` : sql``}
        ${f.matkaOverdue ? sql`AND COALESCE(m.run_date, (m.created_at AT TIME ZONE 'Asia/Kolkata')::date) < (${f.matkaOverdue}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date` : sql``}`)
  }
  if (branches.length === 0) {
    branches.push(sql`SELECT NULL::text AS row_id, NULL::int AS user_id, NULL::text AS product, NULL::text AS detail, NULL::numeric AS stake,
      NULL::text AS status, NULL::timestamptz AS placed, NULL::numeric AS player_pl WHERE FALSE`)
  }
  return sql`
    SELECT x.row_id, ${PLAYER}, x.product, x.detail, x.stake, x.status, x.placed, x.player_pl
    FROM (${sql.join(branches, sql` UNION ALL `)}) x
    JOIN users u ON u.id = x.user_id ${AGENT_OF}`
}

const BET_COLUMNS: DrillColumn[] = [
  ...PLAYER_SHORT,
  { key: 'product', label: 'Product', kind: 'text' },
  { key: 'detail', label: 'On', kind: 'text' },
  { key: 'stake', label: 'Stake', kind: 'money' },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'player_pl', label: 'Player P/L', kind: 'money' },
  { key: 'placed', label: 'Placed', kind: 'datetime' },
]

/** The bets an arg asks for: the period's, the open book (or part of it), or those awaiting settlement. */
function betFilter(c: DrillContext): BetFilter {
  const a = c.arg
  if (a === 'open') return { open: true }
  if (a === 'exposure') return { open: true, products: ['sports', 'matka'] }
  if (a === 'unmatched') return { products: ['sports'], sportsStatus: 'unmatched' }
  if (a === 'stale') return { open: true, products: ['sports'], createdBefore: new Date(c.now.getTime() - STALE_SPORTS_HOURS * 3_600_000) }
  if (a === 'stuck') return { open: true, products: ['casino'], createdBefore: new Date(c.now.getTime() - CASINO_STUCK_MINUTES * 60_000) }
  if (a === 'overdue') return { open: true, products: ['matka'], matkaOverdue: c.now }
  const sport = after(a, 'sport:')
  if (sport) return { open: true, products: ['sports'], sportKey: sport }
  if (a === 'product:matka') return { open: true, products: ['matka'] }
  const event = after(a, 'event:')
  if (event) return { open: true, products: ['sports'], eventId: event }
  const draw = after(a, 'draw:')
  if (draw) {
    const [matkaId, runDate, session] = draw.split(':')
    return { open: true, products: ['matka'], draw: { matkaId, runDate: runDate || null, session: session || null } }
  }
  return { from: c.from, to: c.to }
}

const BET_TITLES: Record<string, string> = {
  open: 'Open bets',
  exposure: 'Open bets (exposure)',
  unmatched: 'Unmatched bets',
  stale: `Sports bets open > ${STALE_SPORTS_HOURS}h`,
  stuck: 'Stuck casino rounds',
  overdue: 'Overdue matka bets',
}

/* ---- the kinds ------------------------------------------------------------------------------------ */

const PLAYER_ROW = sql`
  SELECT u.id::text AS row_id, ${PLAYER}, u.status::text AS status, u.player_type::text AS player_type, u.created_at AS registered,
    u.last_login_at AS last_login, COALESCE(w.cash, 0) AS balance
  FROM users u ${AGENT_OF}
  LEFT JOIN LATERAL (SELECT SUM(x.cash) AS cash FROM wallets x WHERE x.user_id = u.id) w ON TRUE`

const PLAYER_ROW_COLUMNS: DrillColumn[] = [
  ...PLAYER_COLUMNS,
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'balance', label: 'Balance', kind: 'money' },
  { key: 'registered', label: 'Registered', kind: 'datetime' },
  { key: 'last_login', label: 'Last login', kind: 'datetime' },
]

/** The `players` kind's args: which players. */
function playerWhere(c: DrillContext): SQL {
  const a = c.arg
  const status = after(a, 'status:')
  if (status) return sql`u.status::text = ${status}`
  const type = after(a, 'type:')
  if (type) return sql`COALESCE(u.player_type::text, 'REGULAR') = ${type}`
  if (a === 'agent:none') return sql`u.agent_id IS NULL`
  if (a === 'agent:any') return sql`u.agent_id IS NOT NULL`
  if (a === 'credit') return sql`u.player_type::text IN ${CREDIT_TYPES}`
  if (a === 'registered:today') return sql`u.created_at >= ${istMidnight(c.now)}`
  if (a === 'registered:period') return sql`u.created_at >= ${c.from} AND u.created_at <= ${c.to}`
  return sql`TRUE`
}

const SPECS: Record<string, DrillSpec> = {
  pending_deposits: {
    title: 'Pending deposit requests',
    subtitle: () => 'Waiting for an admin now, oldest first',
    page: '/payments/deposits',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'method', label: 'Method', kind: 'text' },
      { key: 'reference', label: 'UTR / reference', kind: 'text' },
      { key: 'requested', label: 'Requested', kind: 'datetime' },
      { key: 'waiting', label: 'Waiting', kind: 'duration' },
    ],
    source: (c) => sql`
      SELECT d.id::text AS row_id, ${PLAYER}, d.amount, d.method::text AS method, COALESCE(d.utr, d.reference_id) AS reference,
        d.created_at AS requested, ${minutesSince(sql`d.created_at`, c.now)} AS waiting
      FROM deposit_requests d JOIN users u ON u.id = d.user_id ${AGENT_OF}
      WHERE ${inTenant(sql`d.tenant`, c.scope.tenant)} AND d.status::text = 'PENDING'`,
    order: sql`q.requested ASC`,
  },
  pending_withdrawals: {
    title: 'Pending withdrawal requests',
    subtitle: () => 'Waiting for an admin now, oldest first',
    page: '/payments/withdrawal-requests',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'account', label: 'Pay to', kind: 'text' },
      { key: 'balance', label: 'Balance before', kind: 'money' },
      { key: 'requested', label: 'Requested', kind: 'datetime' },
      { key: 'waiting', label: 'Waiting', kind: 'duration' },
    ],
    source: (c) => sql`
      SELECT w.id::text AS row_id, ${PLAYER}, w.amount, ${PAYOUT('pa')} AS account, w.balance_before AS balance,
        w.created_at AS requested, ${minutesSince(sql`w.created_at`, c.now)} AS waiting
      FROM withdrawal_requests w JOIN users u ON u.id = w.user_id ${AGENT_OF}
      LEFT JOIN user_payout_accounts pa ON pa.id = w.payout_account_id
      WHERE ${inTenant(sql`w.tenant`, c.scope.tenant)} AND w.status::text = 'PENDING'`,
    order: sql`q.requested ASC`,
  },
  pending_payout_accounts: {
    title: 'Pending bank / UPI approvals',
    subtitle: () => 'Payout accounts waiting for an admin now, oldest first',
    page: '/payments/payout-approvals',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'method', label: 'Method', kind: 'text' },
      { key: 'holder', label: 'Account holder', kind: 'text' },
      { key: 'account', label: 'Account', kind: 'text' },
      { key: 'submitted', label: 'Submitted', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT p.id::text AS row_id, ${PLAYER}, p.method::text AS method, p.account_holder_name AS holder, ${PAYOUT('p')} AS account,
        p.created_at AS submitted
      FROM user_payout_accounts p JOIN users u ON u.id = p.user_id ${AGENT_OF}
      WHERE ${inTenant(sql`p.tenant`, c.scope.tenant)} AND p.approval_status::text = 'PENDING'`,
    order: sql`q.submitted ASC`,
  },
  deposits: {
    title: 'Deposits',
    subtitle: (c) => `${periodText(c)} · ${c.arg === 'manual' ? 'added by an admin' : c.arg === 'direct' ? 'approved requests' : 'requests and manual'}`,
    columns: MONEY_COLUMNS,
    source: (c) => c.arg === 'manual' ? manualMoney(c, 'credit')
      : c.arg === 'direct' || c.windowFromArg ? directDeposits(c)
      : sql`${directDeposits(c)} UNION ALL ${manualMoney(c, 'credit')}`,
    order: sql`q.at DESC`,
    page: '/payments/deposits',
  },
  withdrawals: {
    title: 'Withdrawals',
    subtitle: (c) => `${periodText(c)} · ${c.arg === 'manual' ? 'taken by an admin' : c.arg === 'direct' ? 'completed requests' : 'requests and manual'}`,
    columns: MONEY_COLUMNS,
    source: (c) => c.arg === 'manual' ? manualMoney(c, 'debit')
      : c.arg === 'direct' || c.windowFromArg ? directWithdrawals(c)
      : sql`${directWithdrawals(c)} UNION ALL ${manualMoney(c, 'debit')}`,
    order: sql`q.at DESC`,
    page: '/payments/withdrawal-requests',
  },
  net_deposits: {
    title: 'Net deposits by player',
    subtitle: (c) => `${periodText(c)} · deposits minus withdrawals, requests and manual`,
    columns: [
      ...PLAYER_SHORT,
      { key: 'deposited', label: 'Deposited', kind: 'money' },
      { key: 'withdrawn', label: 'Withdrawn', kind: 'money' },
      { key: 'net', label: 'Net', kind: 'money' },
    ],
    source: (c) => sql`
      SELECT MIN(m.row_id) AS row_id, m.player_id, m.username, m.agent, m.agent_id, m.search_text,
        SUM(m.amount) FILTER (WHERE m.dir = 'in') AS deposited, SUM(m.amount) FILTER (WHERE m.dir = 'out') AS withdrawn,
        COALESCE(SUM(m.amount) FILTER (WHERE m.dir = 'in'), 0) - COALESCE(SUM(m.amount) FILTER (WHERE m.dir = 'out'), 0) AS net
      FROM (
        SELECT i.*, 'in' AS dir FROM (${directDeposits(c)} UNION ALL ${manualMoney(c, 'credit')}) i
        UNION ALL
        SELECT o.*, 'out' FROM (${directWithdrawals(c)} UNION ALL ${manualMoney(c, 'debit')}) o
      ) m GROUP BY m.player_id, m.username, m.agent, m.agent_id, m.search_text`,
    order: sql`q.net DESC`,
  },
  first_depositors: {
    title: 'First-time depositors',
    subtitle: (c) => `${periodText(c)} · a player's first deposit (an approved request, or an admin credit)`,
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'amount', label: 'First deposit', kind: 'money' },
      { key: 'source', label: 'Source', kind: 'text' },
      { key: 'at', label: 'Deposited', kind: 'datetime' },
      { key: 'registered', label: 'Registered', kind: 'datetime' },
    ],
    source: (c) => {
      const credit = sql`le.type = 'credit' AND le.meta IS NOT NULL AND le.meta->>'type' IN ('deposit', 'admin_adjustment')
        AND (le.meta->>'depositRequestId' IS NULL OR le.meta->>'depositRequestId' = '')`
      return sql`
        SELECT 'request:' || d.id AS row_id, ${PLAYER}, d.amount, 'Request' AS source, COALESCE(d.reviewed_at, d.created_at) AS at,
          u.created_at AS registered
        FROM deposit_requests d JOIN users u ON u.id = d.user_id ${AGENT_OF}
        WHERE ${inTenant(sql`d.tenant`, c.scope.tenant)} AND d.status::text = 'APPROVED'
          AND COALESCE(d.reviewed_at, d.created_at) >= ${c.from} AND COALESCE(d.reviewed_at, d.created_at) <= ${c.to}
          AND NOT EXISTS (SELECT 1 FROM deposit_requests d2 WHERE d2.user_id = d.user_id AND d2.status::text = 'APPROVED'
            AND COALESCE(d2.reviewed_at, d2.created_at) < COALESCE(d.reviewed_at, d.created_at))
        UNION ALL
        SELECT 'manual:' || u.id, ${PLAYER}, m.amount, 'Manual', m.at, u.created_at
        FROM (
          SELECT w.user_id, SUM(ABS(NULLIF(le.meta->>'originalAmount', '')::numeric)) AS amount, MIN(le.created_at) AS at
          FROM ledger_entries le JOIN wallets w ON w.id = le.wallet_id
          WHERE ${inTenant(sql`le.tenant`, c.scope.tenant)} AND ${credit} AND le.created_at >= ${c.from} AND le.created_at <= ${c.to}
            AND NOT EXISTS (SELECT 1 FROM deposit_requests dr WHERE dr.user_id = w.user_id AND dr.tenant = le.tenant
              AND dr.status::text = 'APPROVED' AND dr.created_at < ${c.from})
            AND NOT EXISTS (SELECT 1 FROM ledger_entries le2 JOIN wallets w2 ON w2.id = le2.wallet_id
              WHERE w2.user_id = w.user_id AND le2.tenant = le.tenant AND le2.type = 'credit' AND le2.meta IS NOT NULL
                AND le2.meta->>'type' IN ('deposit', 'admin_adjustment')
                AND (le2.meta->>'depositRequestId' IS NULL OR le2.meta->>'depositRequestId' = '') AND le2.created_at < ${c.from})
            AND NOT EXISTS (SELECT 1 FROM deposit_requests dr3 WHERE dr3.user_id = w.user_id AND dr3.tenant = le.tenant
              AND dr3.status::text = 'APPROVED' AND dr3.created_at >= ${c.from} AND dr3.created_at <= ${c.to})
          GROUP BY w.user_id
        ) m
        JOIN users u ON u.id = m.user_id ${AGENT_OF}`
    },
    order: sql`q.at DESC`,
  },
  depositors: {
    title: 'Players who have deposited',
    subtitle: (c) => c.arg === 'period'
      ? 'Approved deposit requests made in the selected period, by player'
      : 'An approved deposit request, ever',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'deposits', label: 'Deposits', kind: 'count' },
      { key: 'total', label: 'Total', kind: 'money' },
      { key: 'last', label: 'Last deposit', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT u.id::text AS row_id, ${PLAYER}, d.deposits, d.total, d.last
      FROM (SELECT d.user_id, COUNT(*)::int AS deposits, SUM(d.amount) AS total, MAX(d.created_at) AS last FROM deposit_requests d
            WHERE ${inTenant(sql`d.tenant`, c.scope.tenant)} AND d.status::text = 'APPROVED'
              ${c.arg === 'period' ? sql`AND d.created_at >= ${c.from} AND d.created_at <= ${c.to}` : sql``}
            GROUP BY d.user_id) d
      JOIN users u ON u.id = d.user_id ${AGENT_OF}`,
    order: sql`q.total DESC`,
  },
  players: {
    title: 'Players',
    subtitle: (c) => c.arg === 'registered:period' ? 'Registered in the selected period' : c.arg === 'registered:today' ? 'Registered since midnight IST' : 'Now',
    columns: PLAYER_ROW_COLUMNS,
    source: (c) => sql`${PLAYER_ROW} WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)} AND ${isPlayer(sql`u`)} AND ${playerWhere(c)}`,
    order: sql`q.registered DESC`,
    page: '/players/search',
  },
  online_now: {
    title: 'Online now',
    subtitle: () => `Signed in or placed a bet in the last ${ONLINE_WINDOW_MINS} minutes`,
    columns: PLAYER_ROW_COLUMNS,
    source: (c) => {
      const since = new Date(c.now.getTime() - ONLINE_WINDOW_MINS * 60_000)
      return sql`${PLAYER_ROW} WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)} AND ${isPlayer(sql`u`)} AND u.id IN (
        SELECT v.id FROM users v WHERE v.last_login_at >= ${since}
        UNION SELECT x.user_id FROM (${allBets(c.scope, since, c.now)}) x)`
    },
    order: sql`q.last_login DESC NULLS LAST`,
  },
  logged_in: {
    title: 'Logged-in players',
    subtitle: (c) => `${periodText(c)} · last sign-in in the window`,
    columns: PLAYER_ROW_COLUMNS,
    source: (c) => sql`${PLAYER_ROW} WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)} AND ${isPlayer(sql`u`)}
      AND u.last_login_at >= ${c.from} AND u.last_login_at <= ${c.to}`,
    order: sql`q.last_login DESC`,
  },
  bettors: {
    title: 'Players who bet',
    subtitle: (c) => `${periodText(c)} · most staked first; stake includes open bets`,
    columns: [
      ...PLAYER_SHORT,
      { key: 'bets', label: 'Bets', kind: 'count' },
      { key: 'staked', label: 'Staked', kind: 'money' },
      { key: 'player_pl', label: 'Player P/L', kind: 'money' },
      { key: 'last_bet', label: 'Last bet', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT u.id::text AS row_id, ${PLAYER}, b.bets, b.staked, b.player_pl, b.last_bet
      FROM (SELECT x.user_id, COUNT(*)::int AS bets, SUM(x.stake) AS staked, -SUM(x.house) AS player_pl, MAX(x.created_at) AS last_bet
            FROM (${allBets(c.scope, c.from, c.to)}) x GROUP BY x.user_id) b
      JOIN users u ON u.id = b.user_id ${AGENT_OF}`,
    order: sql`q.staked DESC`,
  },
  ggr_players: {
    title: 'GGR by player',
    subtitle: (c) => `${periodText(c)} · settled cash bets, as the GGR and Turnover cards count them; the house's gain (+) or loss (−)`,
    columns: [
      ...PLAYER_SHORT,
      { key: 'bets', label: 'Settled bets', kind: 'count' },
      { key: 'staked', label: 'Staked', kind: 'money' },
      { key: 'ggr', label: 'GGR', kind: 'money' },
    ],
    source: (c) => sql`
      SELECT u.id::text AS row_id, ${PLAYER}, g.bets, g.staked, g.ggr
      FROM (SELECT x.user_id, COUNT(*)::int AS bets, SUM(x.stake) AS staked, SUM(x.house) AS ggr
            FROM (${allBets(c.scope, c.from, c.to)}) x WHERE x.settled AND x.cash GROUP BY x.user_id) g
      JOIN users u ON u.id = g.user_id ${AGENT_OF}`,
    order: sql`ABS(q.ggr) DESC`,
  },
  open_bet_players: {
    title: 'Players with an open bet',
    subtitle: () => 'Now · open sports, casino and matka bets',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'bets', label: 'Open bets', kind: 'count' },
      { key: 'stake', label: 'Open stake', kind: 'money' },
      { key: 'oldest', label: 'Oldest', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT q2.player_id::text AS row_id, q2.player_id, q2.username, q2.player_name, q2.phone, q2.agent, q2.agent_id, q2.search_text,
        COUNT(*)::int AS bets, SUM(q2.stake) AS stake, MIN(q2.placed) AS oldest
      FROM (${labelledBets(c, { open: true })}) q2
      GROUP BY q2.player_id, q2.username, q2.player_name, q2.phone, q2.agent, q2.agent_id, q2.search_text`,
    order: sql`q.stake DESC`,
  },
  bets: {
    title: 'Bets',
    subtitle: (c) => BET_TITLES[c.arg] ? 'Now' : c.arg ? 'Open now' : `${periodText(c)} · newest first`,
    columns: BET_COLUMNS,
    source: (c) => labelledBets(c, betFilter(c)),
    order: sql`q.placed DESC`,
    page: '/bets',
  },
  wallet_balances: {
    title: 'Players by wallet balance',
    subtitle: () => 'Now · cash, bonus and exposure',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'cash', label: 'Cash', kind: 'money' },
      { key: 'bonus', label: 'Bonus', kind: 'money' },
      { key: 'exposure', label: 'Exposure', kind: 'money' },
    ],
    source: (c) => sql`
      SELECT w.id::text AS row_id, ${PLAYER}, w.cash, w.bonus, w.exposure
      FROM wallets w JOIN users u ON u.id = w.user_id ${AGENT_OF}
      WHERE ${inTenant(sql`w.tenant`, c.scope.tenant)} AND ${isPlayer(sql`u`)} AND (w.cash <> 0 OR w.bonus <> 0 OR w.exposure <> 0)`,
    order: sql`q.cash DESC`,
  },
  bonus_awards: {
    title: 'Bonus given',
    subtitle: (c) => `${periodText(c)} · cancelled awards left out`,
    page: '/bonuses',
    columns: [
      ...PLAYER_SHORT,
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'wagering', label: 'Wagering done', kind: 'percent' },
      { key: 'awarded', label: 'Awarded', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT b.id::text AS row_id, ${PLAYER}, INITCAP(REPLACE(b.type::text, '_', ' ')) AS type, b.amount, b.status::text AS status,
        CASE WHEN b.wagering_req > 0 THEN LEAST(1, b.current_wagering / b.wagering_req) ELSE NULL END AS wagering, b.awarded_at AS awarded
      FROM bonus_awards b JOIN users u ON u.id = b.user_id ${AGENT_OF}
      WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)} AND b.awarded_at >= ${c.from} AND b.awarded_at <= ${c.to}
        AND b.status::text <> 'cancelled'`,
    order: sql`q.awarded DESC`,
  },
  agents: {
    title: 'Agents',
    subtitle: (c) => c.arg ? `${c.arg.charAt(0)}${c.arg.slice(1).toLowerCase()} agents, active` : 'Every agent',
    columns: [
      { key: 'agent', label: 'Agent', kind: 'agent' },
      { key: 'scheme', label: 'Scheme', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'status' },
      { key: 'parent', label: 'Parent', kind: 'text' },
      { key: 'players', label: 'Own players', kind: 'count' },
      { key: 'credit_limit', label: 'Credit limit', kind: 'money' },
      { key: 'credit_used', label: 'Credit used', kind: 'money' },
      { key: 'created', label: 'Created', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT a.id::text AS row_id, NULL::int AS player_id, a.id::text AS agent_id, ac.username AS agent, INITCAP(a.scheme_type::text) AS scheme,
        a.status, pc.username AS parent, (SELECT COUNT(*)::int FROM users u WHERE u.agent_id = a.id) AS players,
        a.credit_limit, a.credit_used, a.created_at AS created, CONCAT_WS(' ', ac.username, a.phone) AS search_text
      FROM agents a
      LEFT JOIN LATERAL (SELECT x.username FROM agent_credentials x WHERE x.agent_id = a.id LIMIT 1) ac ON TRUE
      LEFT JOIN LATERAL (SELECT x.username FROM agent_credentials x WHERE x.agent_id = a.parent_agent_id LIMIT 1) pc ON TRUE
      WHERE ${inTenant(sql`a.tenant_id`, c.scope.tenant)}
        ${c.arg ? sql`AND a.scheme_type::text = ${c.arg} AND a.status = 'ACTIVE'` : sql``}`,
    order: sql`q.players DESC, q.agent ASC`,
  },
  agent_players: {
    title: "Agent's players",
    subtitle: (c) => `${periodText(c)} · the agent's own players, direct and referred`,
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'route', label: 'Linked by', kind: 'text' },
      { key: 'bets', label: 'Bets', kind: 'count' },
      { key: 'staked', label: 'Staked', kind: 'money' },
      { key: 'ggr', label: 'GGR', kind: 'money' },
    ],
    source: (c) => sql`
      SELECT u.id::text AS row_id, ${PLAYER}, o.route, COALESCE(b.bets, 0) AS bets, COALESCE(b.staked, 0) AS staked, COALESCE(b.ggr, 0) AS ggr
      FROM (
        SELECT v.id AS user_id, 'Direct' AS route FROM users v WHERE v.agent_id::text = ${c.arg}
        UNION
        SELECT ra.referee_id, 'Referral' FROM users v
        JOIN referral_attributions ra ON ra.referrer_id = v.id AND ra.tenant = v.tenant AND ra.status::text = 'confirmed'
        WHERE v.agent_id::text = ${c.arg}
      ) o
      JOIN users u ON u.id = o.user_id ${AGENT_OF}
      LEFT JOIN (SELECT x.user_id, COUNT(*)::int AS bets, SUM(x.stake) AS staked, SUM(x.house) AS ggr
                 FROM (${allBets(c.scope, c.from, c.to)}) x GROUP BY x.user_id) b ON b.user_id = u.id
      WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)}`,
    order: sql`q.staked DESC, q.username ASC`,
  },
  chip_moves: {
    title: 'Chip movements',
    subtitle: (c) => `${periodText(c)} · ${CHIP_TITLES[c.arg] ?? 'every chip movement'}`,
    columns: [
      { key: 'at', label: 'When', kind: 'datetime' },
      { key: 'from_name', label: 'From', kind: 'text' },
      { key: 'to_name', label: 'To', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'reason', label: 'Reason', kind: 'text' },
    ],
    source: (c) => {
      const entity = (type: string, id: string) => sql.raw(`CASE ${type}::text
        WHEN 'player' THEN (SELECT x.username FROM users x WHERE x.id::text = ${id})
        WHEN 'agent' THEN (SELECT x.username FROM agent_credentials x WHERE x.agent_id::text = ${id} LIMIT 1)
        ELSE 'Whitelabel' END`)
      return sql`
        SELECT l.id::text AS row_id, NULL::int AS player_id, NULL::text AS agent_id, l.created_at AS at,
          ${entity('l.from_entity_type', 'l.from_entity_id')} AS from_name, ${entity('l.to_entity_type', 'l.to_entity_id')} AS to_name,
          INITCAP(REPLACE(l.transaction_type::text, '_', ' ')) AS type, ABS(l.amount) AS amount, l.reason,
          CONCAT_WS(' ', ${entity('l.from_entity_type', 'l.from_entity_id')}, ${entity('l.to_entity_type', 'l.to_entity_id')}) AS search_text
        FROM agent_credit_ledger l
        WHERE ${inTenant(sql`l.tenant_id`, c.scope.tenant)} AND l.created_at >= ${c.from} AND l.created_at <= ${c.to}
          AND ${chipWhere(c.arg)}`
    },
    order: sql`q.at DESC`,
  },
  settlements: {
    title: 'Agent settlements',
    subtitle: (c) => `${periodText(c)} · settlements posted`,
    columns: [
      { key: 'agent', label: 'Agent', kind: 'agent' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'direction', label: 'Direction', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'new_balance', label: 'Balance after', kind: 'money' },
      { key: 'notes', label: 'Notes', kind: 'text' },
      { key: 'at', label: 'When', kind: 'datetime' },
    ],
    source: (c) => sql`
      SELECT t.id::text AS row_id, NULL::int AS player_id, t.agent_id::text AS agent_id, ac.username AS agent, t.settlement_type AS type,
        t.direction, ABS(t.amount) AS amount, t.new_balance, t.notes, t.created_at AS at, CONCAT_WS(' ', ac.username, t.notes) AS search_text
      FROM agent_settlement_transactions t
      LEFT JOIN LATERAL (SELECT x.username FROM agent_credentials x WHERE x.agent_id = t.agent_id LIMIT 1) ac ON TRUE
      WHERE ${inTenant(sql`t.tenant`, c.scope.tenant)} AND t.created_at >= ${c.from} AND t.created_at <= ${c.to}`,
    order: sql`q.at DESC`,
  },
  credit_players: {
    title: 'Credit players',
    subtitle: () => 'Now · credit limit, used and available chips',
    columns: [
      ...PLAYER_COLUMNS,
      { key: 'credit_limit', label: 'Limit', kind: 'money' },
      { key: 'credit_used', label: 'Used', kind: 'money' },
      { key: 'credit_available', label: 'Available', kind: 'money' },
    ],
    source: (c) => sql`
      SELECT u.id::text AS row_id, ${PLAYER}, u.credit_limit, u.credit_used, u.credit_available
      FROM users u ${AGENT_OF}
      WHERE ${inTenant(sql`u.tenant`, c.scope.tenant)} AND ${isPlayer(sql`u`)} AND u.player_type::text IN ${CREDIT_TYPES}`,
    order: sql`q.credit_available DESC`,
  },
}

/** The chip-movement args, with dashboardOperationsService's chipsAggregate predicates. */
const CHIP_TITLES: Record<string, string> = {
  wl_in: 'chips deposited by the whitelabel',
  agent_in: 'chips deposited by agents',
  in: 'every chip deposited',
  wl_out: 'chips withdrawn by the whitelabel',
  agent_out: 'chips withdrawn by agents',
  out: 'every chip withdrawn',
  to_agents: 'chips given to agents',
}

function chipWhere(arg: string): SQL {
  const up = sql`l.balance_after > l.balance_before`
  const down = sql`l.balance_after < l.balance_before`
  const adjusting = sql`l.transaction_type::text IN ('ADJUSTMENT', 'CREDIT_LIMIT_ADJUSTMENT')`
  const notSettle = sql`COALESCE(l.metadata->>'adjustmentType', l.meta->>'adjustmentType', '') <> 'SETTLE'`
  const wlIn = sql`(l.from_entity_type::text = 'whitelabel' AND l.to_entity_type::text = 'player'
    AND (l.transaction_type::text = 'DEPOSIT' OR (${adjusting} AND ${up})) AND ${notSettle})`
  const agentIn = sql`(l.from_entity_type::text = 'agent' AND l.to_entity_type::text = 'player' AND l.transaction_type::text IN ('DEPOSIT', 'ALLOCATION'))`
  const wlOut = sql`((l.from_entity_type::text = 'player' AND l.to_entity_type::text = 'whitelabel' AND l.transaction_type::text = 'WITHDRAWAL')
    OR (l.from_entity_type::text = 'whitelabel' AND l.to_entity_type::text = 'player' AND ${adjusting} AND ${down} AND ${notSettle}))`
  const agentOut = sql`(l.from_entity_type::text = 'player' AND l.to_entity_type::text = 'agent' AND l.transaction_type::text = 'WITHDRAWAL')`
  const toAgents = sql`(l.from_entity_type::text = 'whitelabel' AND l.to_entity_type::text = 'agent'
    AND (l.transaction_type::text IN ('DEPOSIT', 'ALLOCATION') OR (${adjusting} AND ${up})))`
  switch (arg) {
    case 'wl_in': return wlIn
    case 'agent_in': return agentIn
    case 'in': return sql`(${wlIn} OR ${agentIn})`
    case 'wl_out': return wlOut
    case 'agent_out': return agentOut
    case 'out': return sql`(${wlOut} OR ${agentOut})`
    case 'to_agents': return toAgents
    default: return sql`TRUE`
  }
}

// The Turnover card: the same rows as GGR by player, largest stake first, so they add up to the card.
SPECS.turnover_players = { ...SPECS.ggr_players, title: 'Turnover by player', order: sql`q.staked DESC` }

export const DRILL_KINDS = Object.keys(SPECS)

const MAX_LIMIT = 100

function cell(value: unknown, kind: DrillColumnKind): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (kind === 'datetime') {
    const parsed = new Date(String(value))
    return isNaN(parsed.getTime()) ? String(value) : parsed.toISOString()
  }
  return String(value)
}

export async function getDashboardDrilldown(
  scope: DrillScope,
  input: { kind: string; arg?: string | null; dateFrom?: string; dateTo?: string; search?: string | null; limit?: number | null; offset?: number | null },
  now: Date = new Date()
): Promise<Drilldown> {
  if (scope.tenant === '') throw new Error('dashboardDrilldown: an empty tenant is not a valid scope')
  const spec = SPECS[input.kind]
  if (!spec) throw new Error(`dashboardDrilldown: unknown kind "${input.kind}"`)
  const arg = (input.arg ?? '').trim()
  if (input.kind === 'agent_players' && !/^[0-9a-f-]{36}$/i.test(arg)) throw new Error('dashboardDrilldown: agent_players needs an agent id')

  // The window: the dashboard's period, unless the arg names one ("mins:60", "today").
  let from = input.dateFrom && !isNaN(Date.parse(input.dateFrom)) ? new Date(input.dateFrom) : istMidnight(now)
  let to = input.dateTo && !isNaN(Date.parse(input.dateTo)) ? new Date(input.dateTo) : now
  let windowFromArg = false
  const mins = after(arg, 'mins:')
  if (mins && Number(mins) > 0) {
    from = new Date(now.getTime() - Math.min(Number(mins), 525_600) * 60_000)
    to = now
    windowFromArg = true
  } else if (arg === 'today') {
    from = istMidnight(now)
    to = now
    windowFromArg = true
  }
  const c: DrillContext = { scope, from, to, now, arg: mins || arg === 'today' ? '' : arg, windowFromArg }
  if (arg === 'today') c.arg = 'today'

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit) || 25))
  const offset = Math.max(0, Number(input.offset) || 0)
  const term = (input.search ?? '').trim().slice(0, 80)
  const filter = term ? sql`WHERE q.search_text ILIKE ${`%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`}` : sql``
  const source = spec.source(c)

  const [found, counted] = await Promise.all([
    db.execute(sql`SELECT * FROM (${source}) q ${filter} ORDER BY ${spec.order}, q.row_id LIMIT ${limit} OFFSET ${offset}`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM (${source}) q ${filter}`),
  ])
  const rows = found.rows as Record<string, unknown>[]
  return {
    kind: input.kind,
    title: input.kind === 'bets' && BET_TITLES[c.arg] ? BET_TITLES[c.arg] : spec.title,
    subtitle: spec.subtitle(c),
    columns: spec.columns,
    rows: rows.map((r) => ({
      id: String(r.row_id ?? ''),
      cells: spec.columns.map((col) => cell(r[col.key], col.kind)),
      playerId: r.player_id === null || r.player_id === undefined ? null : Number(r.player_id),
      agentId: r.agent_id === null || r.agent_id === undefined ? null : String(r.agent_id),
    })),
    total: Number((counted.rows[0] as Record<string, unknown> | undefined)?.n ?? 0),
    page: spec.page ?? null,
  }
}
