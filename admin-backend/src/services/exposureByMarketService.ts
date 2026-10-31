/**
 * The dashboard's "Exposure by market" card: the live open book, split by market.
 *
 * For an admin it splits exactly the figure "Risk & Liquidity" shows as Exposure
 * (`overviewKPIs.exposure`), so for any dashboard range that ends today the rows
 * add up to that figure. An agent sees only its own players, so an agent's rows
 * add up to less: overviewKPIs does not scope agents at all. The definition is
 * the KPI's, predicate for predicate — see getCurrentOpenSportsExposure
 * (sportsReportingRepo) and getCurrentOpenMatkaExposure (matkaReportingRepo):
 *
 *   sports: SUM(sports_bets.liability), status matched / unmatched — one row per sport;
 *   matka:  SUM(matka_bets.potential_win), status pending / active, a NULL adding
 *           nothing — one row for all matka types together;
 *
 * each for the tenant, the whitelabel and that whitelabel's base currency, with
 * no date filter. Two consequences are deliberate:
 *
 *   - Casino is not here. casino_bets has no potential-payout column, so what an
 *     open casino bet could cost the operator is unknowable; its open stake is
 *     player money in flight, not risk. The KPI leaves casino out too.
 *   - Bets placed through the bet tool ARE here (no exclude_from_admin_running
 *     filter), because the KPI and the Exposure report it links to include them.
 *
 * A point-in-time reading, like the Real-time snapshot: `Query.exposureByMarket`
 * takes no arguments. For a past range the KPI uses max(snapshot, live) per
 * product, which cannot be split by market, so the card says "Open now" and never
 * claims to follow the period.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '@/db/client.js'
import { sportsBets, sportsTable, matkaBets } from '@shared/db/schema.js'
import { listWhitelabelsDb } from '@/repos/common/whitelabelRepo.js'
import { getWhitelabelBaseCurrency } from '@/services/dashboardService.js'
import { QueryCache } from '@/services/QueryCache.js'

/*
 * Open statuses, the same lists getCurrentOpenSportsExposure and
 * getCurrentOpenMatkaExposure use. If those change, this card and the Exposure
 * figure beside it stop agreeing; the integration test reconciles the two.
 */
export const OPEN_SPORTS_STATUSES = ['matched', 'unmatched'] as const
export const OPEN_MATKA_STATUSES = ['pending', 'active'] as const

export const MATKA_MARKET_KEY = 'matka'
export const MATKA_MARKET_LABEL = 'Matka'

export type ExposureProduct = 'sports' | 'matka'

export interface ExposureByMarketRow {
  /** 'sports:<sports.key>' or 'matka'. */
  key: string
  product: ExposureProduct
  /** sports.name, or 'Matka'. */
  label: string
  /** Raw amount in the whitelabel base currency, like overviewKPIs.exposure. */
  amount: number
}

export interface ExposureByMarket {
  at: string
  /** amount DESC, then label ASC; rows whose amount is not above 0 are omitted. */
  markets: ExposureByMarketRow[]
}

/**
 * Who is asking, reduced to what limits the figures — the same shape as the
 * Real-time snapshot's scope.
 *
 * `tenant` and `whitelabelId` are both undefined only in director core mode,
 * which means every whitelabel. `agent` is set exactly when the caller is an
 * agent; its `playerIds` are the agent's whole subtree of players (both the
 * direct and the referral route), and an empty list means the agent has no
 * players — not "no restriction".
 */
export interface ExposureByMarketScope {
  tenant?: string
  whitelabelId?: string
  agent?: { agentId: string; playerIds: number[] }
}

/** One whitelabel's open book: the predicates every read below applies. */
export interface OpenBookFilter {
  tenant?: string
  whitelabelId?: string
  currency: string
  /** Set only for an agent; never empty (see computeExposureByMarket). */
  playerIds?: number[]
}

/** A reading with nothing in it, taken at `now`. */
export function emptyExposureByMarket(now: Date = new Date()): ExposureByMarket {
  return { at: now.toISOString(), markets: [] }
}

/**
 * The cache key for one scope. THIS IS A SECURITY BOUNDARY.
 *
 * Built exactly like realtimeSnapshotCacheKey: a cached reading is served to
 * whoever produces the same key, so the key names the tenant, the whitelabel,
 * and whether the caller is an agent (and which one) or a tenant-wide admin.
 * Core mode gets an explicit marker rather than an empty segment, and every
 * value is URI-encoded so no id can contain a separator and forge another
 * scope's key.
 */
export function exposureByMarketCacheKey(scope: ExposureByMarketScope): string {
  const enc = (v: string) => encodeURIComponent(v)
  const tenantPart = scope.tenant === undefined ? 'core' : `tenant=${enc(scope.tenant)}`
  const whitelabelPart =
    scope.whitelabelId === undefined ? 'wl-any' : `wl=${enc(scope.whitelabelId)}`
  const callerPart = scope.agent ? `agent=${enc(scope.agent.agentId)}` : 'admin'
  return `live:exposure-by-market:v1|${tenantPart}|${whitelabelPart}|${callerPart}`
}

/**
 * `user_id = ANY($1::int[])` — one bound parameter however many players an
 * agent has, so a large subtree cannot run past Postgres's bind-parameter limit.
 * Deliberately not the reporting repos' agent filter: that one matches
 * users.agent_id only and misses players who reach an agent by referral.
 */
function userIn(column: AnyPgColumn, ids: number[]): SQL {
  return sql`${column} = ANY(${sql.param(ids)}::int[])`
}

/** Open sports liability for one book, one row per sport that has any open bet. */
async function openSportsBySport(filter: OpenBookFilter): Promise<ExposureByMarketRow[]> {
  const conditions: SQL[] = [
    inArray(sportsBets.status, [...OPEN_SPORTS_STATUSES]),
    eq(sportsBets.currency, filter.currency),
  ]
  if (filter.tenant) conditions.push(eq(sportsBets.tenant, filter.tenant))
  if (filter.whitelabelId) conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId))
  if (filter.playerIds) conditions.push(userIn(sportsBets.userId, filter.playerIds))
  // sport_id is NOT NULL with a foreign key to sports, so the inner join drops
  // no bet and the rows still add up to the unsplit figure.
  const rows = await db
    .select({
      key: sportsTable.key,
      label: sportsTable.name,
      amount: sql<string>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .innerJoin(sportsTable, eq(sportsTable.id, sportsBets.sportId))
    .where(and(...conditions))
    .groupBy(sportsTable.key, sportsTable.name)
  return rows.map((r) => ({
    key: `sports:${r.key}`,
    product: 'sports' as const,
    label: r.label,
    amount: Number(r.amount) || 0,
  }))
}

/** Open matka potential payout for one book, all matka types together. */
async function openMatka(filter: OpenBookFilter): Promise<number> {
  const conditions: SQL[] = [
    inArray(matkaBets.status, [...OPEN_MATKA_STATUSES]),
    eq(matkaBets.currency, filter.currency),
  ]
  if (filter.tenant) conditions.push(eq(matkaBets.tenant, filter.tenant))
  if (filter.whitelabelId) conditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId))
  if (filter.playerIds) conditions.push(userIn(matkaBets.userId, filter.playerIds))
  const [row] = await db
    .select({ amount: sql<string>`COALESCE(SUM(${matkaBets.potentialWin}::numeric), 0)` })
    .from(matkaBets)
    .where(and(...conditions))
  return Number(row?.amount) || 0
}

/**
 * The reads this module makes, gathered on one object so the unit tests can
 * stand in for them without a database. Nothing in production replaces them.
 */
export const exposureByMarketReads = {
  /** The whitelabel list the KPI's core mode walks. */
  async whitelabelIds(): Promise<string[]> {
    return (await listWhitelabelsDb()).map((wl) => wl.id)
  },
  /** The KPI's own base-currency resolution (app_configs, falling back to INR). */
  baseCurrency(tenant: string): Promise<string> {
    return getWhitelabelBaseCurrency(tenant)
  },
  openSportsBySport,
  openMatka,
}

/** Every market of one book, zero rows included; mergeMarketRows drops them. */
async function readBook(filter: OpenBookFilter): Promise<ExposureByMarketRow[]> {
  const [sports, matka] = await Promise.all([
    exposureByMarketReads.openSportsBySport(filter),
    exposureByMarketReads.openMatka(filter),
  ])
  return [...sports, { key: MATKA_MARKET_KEY, product: 'matka', label: MATKA_MARKET_LABEL, amount: matka }]
}

/**
 * Adds rows that share a key (the same sport in several whitelabels), drops
 * every row whose total is not above 0, and orders by amount DESC, then label
 * ASC; the key breaks a remaining tie so the order never depends on the input.
 */
export function mergeMarketRows(books: ExposureByMarketRow[][]): ExposureByMarketRow[] {
  const byKey = new Map<string, ExposureByMarketRow>()
  for (const book of books) {
    for (const row of book) {
      const seen = byKey.get(row.key)
      if (seen) seen.amount += row.amount
      else byKey.set(row.key, { ...row })
    }
  }
  return [...byKey.values()]
    .filter((r) => r.amount > 0)
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        a.label.localeCompare(b.label, 'en') ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    )
}

/**
 * Refuses a scope whose tenant, whitelabel or agent id is the empty string,
 * for the reason realtimeSnapshotService gives: the cache key treats only
 * `undefined` as core mode while the SQL predicates test truthiness, so ''
 * would read platform-wide under a key that is not the core key.
 */
function assertScopeIsWellFormed(scope: ExposureByMarketScope): void {
  if (scope.tenant === '' || scope.whitelabelId === '' || scope.agent?.agentId === '') {
    throw new Error('exposureByMarket: an empty tenant, whitelabel or agent id is not a valid scope')
  }
}

/**
 * One reading, straight from the database, never cached.
 *
 * Director core mode (no tenant and no whitelabel) mirrors overviewKPIs in core
 * mode: every whitelabel is read on its own, with tenant = whitelabel = its id
 * and in ITS OWN base currency, and the raw amounts are added by market. Like
 * the KPI, that sum mixes currencies if whitelabels ever differ in base
 * currency (all are INR today); it is kept so the card and the figure beside it
 * cannot disagree, not fixed here.
 */
export async function computeExposureByMarket(
  scope: ExposureByMarketScope,
  now: Date = new Date()
): Promise<ExposureByMarket> {
  assertScopeIsWellFormed(scope)

  // An agent with no players sees nothing, and costs no query at all. (An empty
  // ANY() would also match nothing; returning here keeps that from depending on it.)
  if (scope.agent && scope.agent.playerIds.length === 0) {
    return emptyExposureByMarket(now)
  }
  const playerIds = scope.agent?.playerIds

  if (scope.tenant === undefined && scope.whitelabelId === undefined) {
    const ids = await exposureByMarketReads.whitelabelIds()
    const books = await Promise.all(
      ids.map(async (id) =>
        readBook({
          tenant: id,
          whitelabelId: id,
          currency: await exposureByMarketReads.baseCurrency(id),
          playerIds,
        })
      )
    )
    return { at: now.toISOString(), markets: mergeMarketRows(books) }
  }

  // The KPI resolves the currency from the tenant; the whitelabel id stands in
  // only for a scope that names no tenant, which the resolver never builds.
  const currency = await exposureByMarketReads.baseCurrency((scope.tenant ?? scope.whitelabelId) as string)
  const book = await readBook({ tenant: scope.tenant, whitelabelId: scope.whitelabelId, currency, playerIds })
  return { at: now.toISOString(), markets: mergeMarketRows([book]) }
}

function isMarketRow(value: unknown): value is ExposureByMarketRow {
  const r = value as ExposureByMarketRow | null
  return (
    !!r &&
    typeof r.key === 'string' &&
    (r.product === 'sports' || r.product === 'matka') &&
    typeof r.label === 'string' &&
    typeof r.amount === 'number' &&
    Number.isFinite(r.amount)
  )
}

function isExposureByMarket(value: unknown): value is ExposureByMarket {
  const v = value as ExposureByMarket | null
  return !!v && typeof v.at === 'string' && Array.isArray(v.markets) && v.markets.every(isMarketRow)
}

/**
 * The reading for a scope, served from the 5-second live cache when one is
 * there. A cached reading keeps the `at` it was taken at.
 *
 * The cache key does not include `now`, so tests that vary it should call
 * computeExposureByMarket directly. When Redis is unavailable QueryCache
 * degrades to a miss and every call computes.
 */
export async function getExposureByMarket(
  scope: ExposureByMarketScope,
  now: Date = new Date()
): Promise<ExposureByMarket> {
  // Before the key is even built: a malformed scope must not reach the cache either.
  assertScopeIsWellFormed(scope)
  const key = exposureByMarketCacheKey(scope)
  const cached = await QueryCache.getLive<ExposureByMarket>(key)
  if (isExposureByMarket(cached)) return cached

  const fresh = await computeExposureByMarket(scope, now)
  // setLive swallows its own errors; not awaited so a slow cache write never
  // delays the reading.
  void QueryCache.setLive(key, fresh)
  return fresh
}
