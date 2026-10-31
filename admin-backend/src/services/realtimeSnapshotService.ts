/**
 * The dashboard's "Real-time snapshot": what is happening right now.
 *
 * Deliberately independent of the dashboard period presets. Every other figure
 * on the overview follows the selected date range; this one never does, which
 * is why `Query.realtimeSnapshot` takes no arguments at all.
 *
 * Honesty about "active players": this platform records no presence, heartbeat
 * or last-seen time, so "players online now" does not exist here. The figure is
 * activity-based — distinct players who placed a bet in the trailing
 * ACTIVITY_WINDOW_MINS — and the window is returned with it so the label on the
 * page cannot drift from the query.
 *
 * Money figures are raw amounts in the whitelabel's own currency, exactly like
 * every other money figure the dashboard receives; the client converts and
 * formats them. In director core mode they are summed platform-wide, the same
 * convention `overviewKPIs` follows in core mode.
 */
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import { db } from '@/db/client.js'
import {
  sportsBets,
  casinoBets,
  matkaBets,
  depositRequests,
  withdrawalRequests,
} from '@shared/db/schema.js'
import { getSportsBetsCountAndStake } from '@/repos/sports/sportsBetsRepo.js'
import { getCasinoBetsCountAndStake } from '@/repos/casino/casinoBetsRepo.js'
import { getMatkaBetsCountAndStake } from '@/repos/matka/matkaBetsRepo.js'
import { settlementDateExpr } from '@/shared/reportingSql.js'
import { QueryCache } from '@/services/QueryCache.js'

/** Trailing window, in minutes, that counts a player as active. */
export const ACTIVITY_WINDOW_MINS = 5

/** Trailing window, in minutes, for the deposit and withdrawal figures. */
export const MONEY_WINDOW_MINS = 60

/*
 * Open-bet statuses per product. Each was checked against its pgEnum in
 * shared/src/db/schema (and the live database's enum labels) on 2026-09-22:
 *   sports_bet_status: matched, unmatched, cancelled, settled, won, lost, void
 *   casino_bet_status: pending, active, won, lost, cancelled, void
 *   matka_bet_status:  pending, active, won, lost, cancelled, void
 */
export const OPEN_SPORTS_STATUSES = ['matched', 'unmatched'] as const
export const OPEN_CASINO_STATUSES = ['pending', 'active'] as const
export const OPEN_MATKA_STATUSES = ['pending', 'active'] as const

export interface RealtimeSnapshot {
  at: string
  activePlayers: number
  activityWindowMins: number
  activeBets: number
  depositsLastHour: number
  withdrawalsLastHour: number
}

/**
 * Who is asking, reduced to what limits the figures.
 *
 * `tenant` and `whitelabelId` are both undefined only in director core mode,
 * which means platform-wide. `agent` is set exactly when the caller is an
 * agent; its `playerIds` are the agent's whole subtree of players (both the
 * direct and the referral route), and an empty list means the agent has no
 * players — not "no restriction".
 */
export interface RealtimeSnapshotScope {
  tenant?: string
  whitelabelId?: string
  agent?: { agentId: string; playerIds: number[] }
}

/** A reading with nothing in it, taken at `now`. */
export function emptyRealtimeSnapshot(now: Date = new Date()): RealtimeSnapshot {
  return {
    at: now.toISOString(),
    activePlayers: 0,
    activityWindowMins: ACTIVITY_WINDOW_MINS,
    activeBets: 0,
    depositsLastHour: 0,
    withdrawalsLastHour: 0,
  }
}

/**
 * The cache key for one scope. THIS IS A SECURITY BOUNDARY.
 *
 * A cached reading is served to whoever produces the same key, so the key has
 * to name everything that narrows the figures: the tenant, the whitelabel, and
 * whether the caller is an agent (and which one) or a tenant-wide admin. Core
 * mode gets its own explicit marker rather than an empty segment. Every value
 * is URI-encoded, so no tenant or agent id can contain a separator and forge
 * another scope's key.
 */
export function realtimeSnapshotCacheKey(scope: RealtimeSnapshotScope): string {
  const enc = (v: string) => encodeURIComponent(v)
  const tenantPart = scope.tenant === undefined ? 'core' : `tenant=${enc(scope.tenant)}`
  const whitelabelPart =
    scope.whitelabelId === undefined ? 'wl-any' : `wl=${enc(scope.whitelabelId)}`
  const callerPart = scope.agent ? `agent=${enc(scope.agent.agentId)}` : 'admin'
  return `live:realtime-snapshot:v1|${tenantPart}|${whitelabelPart}|${callerPart}`
}

type BetTableCols = {
  table: PgTable
  userId: AnyPgColumn
  tenant: AnyPgColumn
  whitelabelId: AnyPgColumn
  createdAt: AnyPgColumn
}

const SPORTS_COLS: BetTableCols = {
  table: sportsBets,
  userId: sportsBets.userId,
  tenant: sportsBets.tenant,
  whitelabelId: sportsBets.whitelabelId,
  createdAt: sportsBets.createdAt,
}
const CASINO_COLS: BetTableCols = {
  table: casinoBets,
  userId: casinoBets.userId,
  tenant: casinoBets.tenant,
  whitelabelId: casinoBets.whitelabelId,
  createdAt: casinoBets.createdAt,
}
const MATKA_COLS: BetTableCols = {
  table: matkaBets,
  userId: matkaBets.userId,
  tenant: matkaBets.tenant,
  whitelabelId: matkaBets.whitelabelId,
  createdAt: matkaBets.createdAt,
}

/**
 * `user_id = ANY($1::int[])` — one bound parameter however many players an
 * agent has, so a large subtree cannot run this module's OWN statements past
 * Postgres's bind-parameter limit (the activity query uses the list three
 * times). This does not cover activeBets: that figure goes through the shared
 * count helpers, which expand the list with inArray, one parameter per player.
 * An agent subtree beyond roughly 65k players would make that one query error —
 * failing closed, not open. If trees that large appear, count open bets here
 * with this helper instead of reusing the shared ones.
 */
function userIn(column: AnyPgColumn, ids: number[]): SQL {
  return sql`${column} = ANY(${sql.param(ids)}::int[])`
}

/** One branch of the activity UNION: user ids that bet in [since, now]. */
function activityBranch(cols: BetTableCols, scope: RealtimeSnapshotScope, since: Date, now: Date): SQL {
  const conditions: SQL[] = [gte(cols.createdAt, since), lte(cols.createdAt, now)]
  if (scope.tenant) conditions.push(eq(cols.tenant, scope.tenant))
  if (scope.whitelabelId) conditions.push(eq(cols.whitelabelId, scope.whitelabelId))
  if (scope.agent) conditions.push(userIn(cols.userId, scope.agent.playerIds))
  return sql`SELECT ${cols.userId} AS user_id FROM ${cols.table} WHERE ${and(...conditions)}`
}

/**
 * Distinct players who placed a bet in any product during the window. The
 * three tables are combined first and counted once, so a player who bet on
 * sports and casino in the same five minutes is one player, not two.
 */
async function countActivePlayers(scope: RealtimeSnapshotScope, since: Date, now: Date): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT u.user_id)::int AS n FROM (
      ${activityBranch(SPORTS_COLS, scope, since, now)}
      UNION ALL
      ${activityBranch(CASINO_COLS, scope, since, now)}
      UNION ALL
      ${activityBranch(MATKA_COLS, scope, since, now)}
    ) AS u`)
  const row = result.rows[0] as { n?: number | string } | undefined
  return Number(row?.n ?? 0)
}

/**
 * Bets open right now, across all three products.
 *
 * Reuses the same count helpers as `betsPageTotals`. Verified by reading them
 * on 2026-09-22: each adds a tenant / whitelabel predicate only when that value
 * is set, so an undefined tenant (core mode) means no tenant predicate — never
 * a literal 'default'. (The only 'default' fallback in them picks a timezone,
 * and only inside the date filter, which is not used here.)
 *
 * Also verified: an EMPTY `userIds` list is treated as "no user filter". That is
 * why an agent with no players must never reach this function — see
 * `computeRealtimeSnapshot`.
 *
 * Sports and casino hide open bets placed through the bet tool / integration
 * (`omitOpenAdminToolBets`), which the admin "running" views already exclude;
 * matka has no such flag.
 */
async function countOpenBets(scope: RealtimeSnapshotScope): Promise<number> {
  const base = {
    tenant: scope.tenant,
    whitelabelId: scope.whitelabelId,
    userIds: scope.agent ? scope.agent.playerIds : undefined,
  }
  const [sportsRes, casinoRes, matkaRes] = await Promise.all([
    getSportsBetsCountAndStake({ ...base, statuses: [...OPEN_SPORTS_STATUSES], omitOpenAdminToolBets: true }),
    getCasinoBetsCountAndStake({ ...base, statuses: [...OPEN_CASINO_STATUSES], omitOpenAdminToolBets: true }),
    getMatkaBetsCountAndStake({ ...base, statuses: [...OPEN_MATKA_STATUSES] }),
  ])
  return (sportsRes.count ?? 0) + (casinoRes.count ?? 0) + (matkaRes.count ?? 0)
}

/*
 * Deposits and withdrawals settled in the trailing hour, from the REQUEST
 * tables only.
 *
 * Money "settled at" is COALESCE(reviewed_at, created_at) — the moment an
 * admin approved it, not when the player asked — as in dashboardService.
 *
 * Deliberately excluded: manual admin credits and debits. Those live only in
 * ledger_entries, and ledger_entries has NO index on created_at (checked
 * against the live database on 2026-09-22), so a trailing-hour filter there
 * would scan the whole ledger on every poll of this card. That is not
 * acceptable for a figure refreshed every few seconds.
 *
 * deposit_requests / withdrawal_requests carry no whitelabel_id column, so the
 * tenant predicate is the whole of their tenant scoping.
 */
async function sumApprovedDeposits(scope: RealtimeSnapshotScope, since: Date, now: Date): Promise<number> {
  const settledAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt)
  const conditions: SQL[] = [
    eq(depositRequests.status, 'APPROVED'),
    gte(settledAt, since),
    lte(settledAt, now),
  ]
  if (scope.tenant) conditions.push(eq(depositRequests.tenant, scope.tenant))
  if (scope.agent) conditions.push(userIn(depositRequests.userId, scope.agent.playerIds))
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)` })
    .from(depositRequests)
    .where(and(...conditions))
  return Number(row?.total ?? 0)
}

async function sumCompletedWithdrawals(scope: RealtimeSnapshotScope, since: Date, now: Date): Promise<number> {
  const settledAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt)
  const conditions: SQL[] = [
    eq(withdrawalRequests.status, 'COMPLETED'),
    gte(settledAt, since),
    lte(settledAt, now),
  ]
  if (scope.tenant) conditions.push(eq(withdrawalRequests.tenant, scope.tenant))
  if (scope.agent) conditions.push(userIn(withdrawalRequests.userId, scope.agent.playerIds))
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)` })
    .from(withdrawalRequests)
    .where(and(...conditions))
  return Number(row?.total ?? 0)
}

/**
 * Refuses a scope whose tenant, whitelabel or agent id is the empty string.
 *
 * The two halves of this module would read '' differently: the cache key treats
 * only `undefined` as core mode, while every SQL predicate here and inside the
 * reused count helpers tests truthiness. So '' would run PLATFORM-WIDE queries
 * under a key that is not the core key. Reading '' as undefined would widen
 * access in exactly the same way, so it is refused instead. buildGraphqlContext
 * never produces '' today; this guards the exported entry points against a
 * future caller that does.
 */
function assertScopeIsWellFormed(scope: RealtimeSnapshotScope): void {
  if (scope.tenant === '' || scope.whitelabelId === '' || scope.agent?.agentId === '') {
    throw new Error('realtimeSnapshot: an empty tenant, whitelabel or agent id is not a valid scope')
  }
}

/**
 * One reading, straight from the database, never cached.
 *
 * In core mode this is a single platform-wide aggregate per figure — it never
 * loops over whitelabels.
 */
export async function computeRealtimeSnapshot(
  scope: RealtimeSnapshotScope,
  now: Date = new Date()
): Promise<RealtimeSnapshot> {
  assertScopeIsWellFormed(scope)

  // An agent with no players sees nothing. This short-circuit is load-bearing,
  // not an optimisation: the bet count helpers read an empty `userIds` as "no
  // user filter", so passing [] through would count every bet in the tenant.
  if (scope.agent && scope.agent.playerIds.length === 0) {
    return emptyRealtimeSnapshot(now)
  }

  const activitySince = new Date(now.getTime() - ACTIVITY_WINDOW_MINS * 60_000)
  const moneySince = new Date(now.getTime() - MONEY_WINDOW_MINS * 60_000)

  const [activePlayers, activeBets, depositsLastHour, withdrawalsLastHour] = await Promise.all([
    countActivePlayers(scope, activitySince, now),
    countOpenBets(scope),
    sumApprovedDeposits(scope, moneySince, now),
    sumCompletedWithdrawals(scope, moneySince, now),
  ])

  return {
    at: now.toISOString(),
    activePlayers,
    activityWindowMins: ACTIVITY_WINDOW_MINS,
    activeBets,
    depositsLastHour,
    withdrawalsLastHour,
  }
}

function isSnapshot(value: unknown): value is RealtimeSnapshot {
  const v = value as RealtimeSnapshot | null
  return (
    !!v &&
    typeof v.at === 'string' &&
    typeof v.activePlayers === 'number' &&
    typeof v.activityWindowMins === 'number' &&
    typeof v.activeBets === 'number' &&
    typeof v.depositsLastHour === 'number' &&
    typeof v.withdrawalsLastHour === 'number'
  )
}

/**
 * The reading for a scope, served from the 5-second live cache when one is
 * there. A cached reading keeps the `at` it was taken at.
 *
 * `now` exists for callers that need a fixed clock; note that the cache key
 * does not include it, so tests that vary `now` should call
 * `computeRealtimeSnapshot` directly. When Redis is unavailable QueryCache
 * degrades to a miss and every call computes.
 */
export async function getRealtimeSnapshot(
  scope: RealtimeSnapshotScope,
  now: Date = new Date()
): Promise<RealtimeSnapshot> {
  // Before the key is even built: a malformed scope must not reach the cache either.
  assertScopeIsWellFormed(scope)
  const key = realtimeSnapshotCacheKey(scope)
  const cached = await QueryCache.getLive<RealtimeSnapshot>(key)
  if (isSnapshot(cached)) return cached

  const fresh = await computeRealtimeSnapshot(scope, now)
  // setLive swallows its own errors; not awaited so a slow cache write never
  // delays the reading.
  void QueryCache.setLive(key, fresh)
  return fresh
}
