import { normalizeBid } from '@shared/matka/rules.js'
import { db } from '@src/db/client.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'
import { eq, and, gte, lte, desc, sql, inArray, notInArray, or, ilike, getTableColumns } from 'drizzle-orm'
import { matkaBets, matkas, users } from '@shared/db/schema.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { getStartOfDayForDate, getEndOfDayForDate, parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'

export type CreateMatkaBetInput = {
  tenant: string
  whitelabelId: string
  userId: number
  matkaId: string
  matkaType: 'worli' | 'starline' | 'jackpot' | 'sattaMatka'
  marketName: string
  marketSession?: string
  bidType: string
  betNumbers: string
  betAmount: number
  payoutMultiplier: number
  potentialWin?: number
  currency?: string
  // Worli running market linkage (optional)
  instanceId?: string
  side?: 'OPEN'|'CLOSE'
  selectionKey?: string
  selectionJson?: any
  rulesVersionId?: string
}

export type MatkaBetFilter = {
  betIds?: string[]
  stakeMin?: number
  stakeMax?: number
  matkaName?: string
  tenant?: string
  whitelabelId?: string
  userId?: number
  userIds?: number[] // For agent filtering - filter by multiple user IDs
  matkaId?: string
  matkaType?: string
  marketName?: string
  marketSession?: string
  bidType?: string
  status?: string
  statuses?: string[] // For BetsPage multi-select
  dateFrom?: string
  dateTo?: string
  search?: string // Free-text: marketName, betNumbers, user name/username/phone
  limit?: number
  offset?: number
}

export async function createMatkaBet(input: CreateMatkaBetInput) {
  const tenant = input.tenant ?? input.whitelabelId;
  const currency = input.currency ?? await getWhitelabelCurrency(tenant);
  const [bet] = await db.insert(matkaBets).values({
    tenant: input.tenant,
    whitelabelId: input.whitelabelId,
    userId: input.userId,
    matkaId: input.matkaId,
    matkaType: input.matkaType,
    marketName: input.marketName,
    marketSession: input.marketSession,
    bidType: input.bidType,
    betNumbers: input.betNumbers,
    betAmount: String(input.betAmount),
    payoutMultiplier: String(input.payoutMultiplier),
    potentialWin: input.potentialWin ? String(input.potentialWin) : null,
    currency,
    status: 'pending',
    instanceId: input.instanceId ?? null,
    side: (input.side as any) ?? null,
    selectionKey: input.selectionKey ?? null,
    selectionJson: input.selectionJson ?? null,
    rulesVersionId: input.rulesVersionId ?? null,
  }).returning()
  return bet
}

async function buildMatkaBetConditions(filter: MatkaBetFilter) {
  const conditions: any[] = []
  if (filter.betIds) conditions.push(inArray(matkaBets.id, filter.betIds))
  if (filter.matkaName) conditions.push(sql`${matkaBets.matkaId} in (select id from matkas where tenant=${filter.tenant} and name=${filter.matkaName})`)
  if (filter.stakeMin != null) conditions.push(gte(matkaBets.betAmount, String(filter.stakeMin)))
  if (filter.stakeMax != null) conditions.push(lte(matkaBets.betAmount, String(filter.stakeMax)))
  if (filter.tenant) {
    conditions.push(eq(matkaBets.tenant, filter.tenant))
  }
  if (filter.whitelabelId) {
    conditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId))
  }
  if (filter.userIds && filter.userIds.length > 0) {
    conditions.push(inArray(matkaBets.userId, filter.userIds))
  } else if (filter.userId !== undefined) {
    conditions.push(eq(matkaBets.userId, filter.userId))
  }
  if (filter.matkaId) {
    conditions.push(eq(matkaBets.matkaId, filter.matkaId))
  }
  if (filter.matkaType) {
    conditions.push(eq(matkaBets.matkaType, filter.matkaType as any))
  }
  if (filter.marketName) {
    conditions.push(eq(matkaBets.marketName, filter.marketName))
  }
  if (filter.marketSession) {
    conditions.push(eq(matkaBets.marketSession, filter.marketSession))
  }
  if (filter.bidType) {
    conditions.push(eq(matkaBets.bidType, normalizeBid(filter.bidType)))
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(inArray(matkaBets.status, filter.statuses as any))
  } else if (filter.status) {
    conditions.push(eq(matkaBets.status, filter.status as any))
  }
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getWhitelabelTimezone(filter.tenant ?? 'default')
    if (filter.dateFrom) conditions.push(gte(matkaBets.createdAt, parseDateFrom(filter.dateFrom, tz)))
    if (filter.dateTo) conditions.push(lte(matkaBets.createdAt, parseDateTo(filter.dateTo, tz)))
  }
  return conditions
}

export async function buildMatkaBetsQuery(filter: MatkaBetFilter) {
  const conditions = await buildMatkaBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(matkaBets.userId, searchUserIds) : sql`false`,
      ilike(matkaBets.marketName, q),
      ilike(matkaBets.betNumbers, q),
      ilike(matkaBets.bidType, q),
      sql`${matkaBets.id}::text ILIKE ${q}`,
      inArray(matkaBets.matkaId, db.select({ id: matkas.id }).from(matkas).where(and(eq(matkas.tenant, filter.tenant!), ilike(matkas.name, q))))
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  return { query: db
    // Every bet column plus the matka's name. `market_name` is stored on the
    // bet but the matka's own name is not, and the live-analysis screens label
    // rows with it — without the join they fell back to "Matka <uuid>".
    // Spread rather than listed so adding a column to the table does not
    // silently drop it from this query.
    .select({ ...getTableColumns(matkaBets), matkaName: matkas.name })
    .from(matkaBets)
    .leftJoin(matkas, eq(matkas.id, matkaBets.matkaId))
    .where(whereClause)
  }
}

export async function getMatkaBets(filter: MatkaBetFilter) {
  const { query } = await buildMatkaBetsQuery(filter)
  return query.orderBy(desc(matkaBets.createdAt), desc(matkaBets.id))
    .limit(filter.limit || 100).offset(filter.offset || 0)
}

/** Aggregated GGR and P&L for given user IDs (won/lost only). No row limit; use for agent dashboard. */
export async function getAggregatedGGRPlForUserIds(
  tenant: string,
  userIds: number[]
): Promise<{ ggr: number; pl: number }> {
  if (!tenant || !userIds?.length) return { ggr: 0, pl: 0 }
  const [row] = await db
    .select({
      ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
    })
    .from(matkaBets)
    .where(
      and(
        eq(matkaBets.tenant, tenant),
        inArray(matkaBets.userId, userIds),
        inArray(matkaBets.status, ['won', 'lost'])
      )
    )
  return { ggr: Number(row?.ggr ?? 0), pl: Number(row?.pl ?? 0) }
}

/** Player overview: settled GGR/PL/count for one user in date range (no row limit). */
export async function getPlayerOverviewSettledAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ ggr: number; pl: number; settledCount: number; settledStakeSum: number }> {
  const conditions = [
    eq(matkaBets.tenant, tenant),
    eq(matkaBets.userId, userId),
    inArray(matkaBets.status, ['won', 'lost']),
    gte(matkaBets.createdAt, dateFrom),
    lte(matkaBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
      settledCount: sql<number>`COUNT(*)::int`,
      settledStakeSum: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
    })
    .from(matkaBets)
    .where(and(...conditions))
  return {
    ggr: Number(row?.ggr ?? 0),
    pl: Number(row?.pl ?? 0),
    settledCount: Number(row?.settledCount ?? 0),
    settledStakeSum: Number(row?.settledStakeSum ?? 0),
  }
}

/** Player overview: all matka bets in date range (count + total stake). */
export async function getPlayerOverviewAllBetsAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ totalCount: number; totalStakeSum: number }> {
  const conditions = [
    eq(matkaBets.tenant, tenant),
    eq(matkaBets.userId, userId),
    gte(matkaBets.createdAt, dateFrom),
    lte(matkaBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      totalCount: sql<number>`COUNT(*)::int`,
      totalStakeSum: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
    })
    .from(matkaBets)
    .where(and(...conditions))
  return {
    totalCount: Number(row?.totalCount ?? 0),
    totalStakeSum: Number(row?.totalStakeSum ?? 0),
  }
}

/** Player overview: open matka bets in date range. */
export async function getPlayerOverviewOpenAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ openCount: number; openStakeSum: number }> {
  const conditions = [
    eq(matkaBets.tenant, tenant),
    eq(matkaBets.userId, userId),
    inArray(matkaBets.status, ['pending', 'active']),
    gte(matkaBets.createdAt, dateFrom),
    lte(matkaBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      openCount: sql<number>`COUNT(*)::int`,
      openStakeSum: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
    })
    .from(matkaBets)
    .where(and(...conditions))
  return {
    openCount: Number(row?.openCount ?? 0),
    openStakeSum: Number(row?.openStakeSum ?? 0),
  }
}

/** Total count with same filters as getMatkaBets (no limit/offset). */
export async function getMatkaBetsCount(filter: MatkaBetFilter): Promise<number> {
  const conditions = await buildMatkaBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(matkaBets.userId, searchUserIds) : sql`false`,
      ilike(matkaBets.marketName, q),
      ilike(matkaBets.betNumbers, q),
      ilike(matkaBets.bidType, q),
      sql`${matkaBets.id}::text ILIKE ${q}`,
      inArray(matkaBets.matkaId, db.select({ id: matkas.id }).from(matkas).where(and(eq(matkas.tenant, filter.tenant!), ilike(matkas.name, q))))
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(matkaBets).where(whereClause)
  return row?.count ?? 0
}

/** Total count + total stake sum with same filters as getMatkaBetsCount. */
export async function getMatkaBetsCountAndStake(filter: MatkaBetFilter): Promise<{ count: number; stakeSum: number }> {
  const conditions = await buildMatkaBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(matkaBets.userId, searchUserIds) : sql`false`,
      ilike(matkaBets.marketName, q),
      ilike(matkaBets.betNumbers, q),
      ilike(matkaBets.bidType, q),
      sql`${matkaBets.id}::text ILIKE ${q}`,
      inArray(matkaBets.matkaId, db.select({ id: matkas.id }).from(matkas).where(and(eq(matkas.tenant, filter.tenant!), ilike(matkas.name, q))))
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const [row] = await db.select({
    count: sql<number>`count(*)::int`,
    stakeSum: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
  }).from(matkaBets).where(whereClause)
  return { count: row?.count ?? 0, stakeSum: Number(row?.stakeSum ?? 0) }
}

// The results list's waiting-bet count is countOpenMatkaBets (domains/matka/services/runningMarkets.ts): it
// counted only "pending" bets on their created_at day, and Matka bets are stored as active.

export async function getMatkaBetById(id: string) {
  const [bet] = await db.select().from(matkaBets)
    .where(eq(matkaBets.id, id))
    .limit(1)
  return bet || null
}

export async function updateMatkaBetStatus(
  id: string,
  status: string,
  actualWin?: number,
  result?: string,
  settledAt?: Date
) {
  const betBefore = await getMatkaBetById(id)
  const tenant = betBefore?.tenant || 'default'

  const updateData: any = {
    status: status as any,
    updatedAt: new Date(),
  }
  if (actualWin !== undefined) updateData.actualWin = String(actualWin)
  if (result !== undefined) updateData.result = result
  if (settledAt !== undefined) updateData.settledAt = settledAt

  // `won`, `lost` and `void` are terminal. The UPDATE carried no status
  // predicate, so voiding an already-void bet — or settling an already-settled
  // one — matched the row again and ran the settlement hooks a second time. A
  // rollback moves a bet back to `pending` first, so a legitimate re-settlement
  // still passes.
  const TERMINAL = ['won', 'lost', 'void']
  const enteringTerminal = TERMINAL.includes(status)
  const where = enteringTerminal
    ? and(eq(matkaBets.id, id), notInArray(matkaBets.status, TERMINAL as any))
    : eq(matkaBets.id, id)
  // This records the status only and moves no money, for every player type.
  // Credit players (AGENT_CREDIT, WHITELABEL_CREDIT) are on the cash-wallet path
  // as well, so nothing is released or booked on credit figures and nothing is
  // pushed to the agent's or the whitelabel's balances.
  const [updated] = await db.update(matkaBets).set(updateData).where(where).returning()
  // Lost the race, or the bet was already terminal: no transition, so no hooks.
  if (!updated && enteringTerminal) return await getMatkaBetById(id)
  const bet = updated ?? null

  if (bet && (status === 'won' || status === 'lost') && betBefore) {
    const stake = Number(betBefore.betAmount || 0)
    const win = actualWin !== undefined ? Number(actualWin) : 0
    const netRevenue = win - stake
    try {
      // Credit players' bets earn no referral loss-share.
      if ((await referralEligibleMatkaBets(tenant, [bet])).length) {
        const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
        await referralIntegrationService.handleBetSettlement(tenant, bet.userId, netRevenue, (bet.currency || 'INR') as any, 'matka')
      }
    } catch (err) {
    }
  }
  return bet
}

/**
 * The settled bets whose losses can earn the player's referrer loss-share. Credit
 * players' bets cannot: their chips move only through the upline's Deposit /
 * Withdraw, so they get no referral cash or loss-share.
 */
export async function referralEligibleMatkaBets<T extends { userId: number }>(tenant: string, bets: T[], executor: any = db): Promise<T[]> {
  if (!bets.length) return []
  const players: Array<{ id: number; playerType: string | null }> = await executor
    .select({ id: users.id, playerType: users.playerType })
    .from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.id, [...new Set(bets.map((bet) => bet.userId))])))
  const credit = new Set(players.filter((player) => isCreditPlayer(player.playerType)).map((player) => Number(player.id)))
  return bets.filter((bet) => !credit.has(Number(bet.userId)))
}

export async function listBetsByInstance(instanceId: string, limit = 200, offset = 0) {
  return db.select().from(matkaBets).where(eq(matkaBets.instanceId, instanceId)).orderBy(desc(matkaBets.createdAt)).limit(limit).offset(offset)
}

export async function aggregateInstanceBets(instanceId: string) {
  const [{ totalStakeMinor, betCount }] = await db
    .select({
      totalStakeMinor: sql<number>`coalesce(sum((${matkaBets.betAmount}::decimal * 100)::bigint), 0)` as any,
      betCount: sql<number>`count(*)::int` as any,
    })
    .from(matkaBets)
    .where(and(eq(matkaBets.instanceId, instanceId), notInArray(matkaBets.status, ['void', 'cancelled'])))
  return { totalStakeMinor: Number(totalStakeMinor || 0), betCount: Number(betCount || 0) }
}

/**
 * A bound of the session bets list's time filter (worliBets' timeFrom / timeTo): blank is no bound; anything else
 * must read as a date and time created_at can be compared with. "abc" made an Invalid Date, whose toISOString() threw
 * the raw "Invalid time value" at the query, and a year outside 0001-9999 (the lenient Date parser reads "99999" as
 * one) binds as '+099998-...' or '0000-...', which Postgres refuses. Both are refused by name, before any query.
 */
function betTimeBound(value: string | null | undefined, label: 'timeFrom' | 'timeTo'): Date | undefined {
  const text = value == null ? '' : String(value).trim()
  if (!text) return undefined
  const at = new Date(text)
  const year = at.getUTCFullYear()
  if (Number.isNaN(year) || year < 1 || year > 9999) throw new Error(`${label} is not a valid date and time`)
  return at
}

export async function listBetsByInstanceWithFilters(
  instanceId: string,
  filters: {
    search?: string
    userId?: number
    bidType?: string
    stakeMin?: number
    stakeMax?: number
    timeFrom?: string
    timeTo?: string
  },
  page = 1,
  limit = 50,
) {
  const conds: any[] = [eq(matkaBets.instanceId, instanceId)]
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim()}%`
    conds.push(or(sql`${matkaBets.userId}::text ilike ${pattern}`, ilike(matkaBets.betNumbers, pattern), ilike(matkaBets.bidType, pattern), sql`${matkaBets.status}::text ilike ${pattern}`))
  }
  if (filters.userId) conds.push(eq(matkaBets.userId, filters.userId))
  if (filters.bidType) conds.push(eq(matkaBets.bidType, normalizeBid(filters.bidType)))
  if (filters.stakeMin != null) conds.push(sql`${matkaBets.betAmount}::decimal >= ${filters.stakeMin}`)
  if (filters.stakeMax != null) conds.push(sql`${matkaBets.betAmount}::decimal <= ${filters.stakeMax}`)
  const timeFrom = betTimeBound(filters.timeFrom, 'timeFrom'), timeTo = betTimeBound(filters.timeTo, 'timeTo')
  if (timeFrom) conds.push(gte(matkaBets.createdAt, timeFrom))
  if (timeTo) conds.push(lte(matkaBets.createdAt, timeTo))
  const where = and(...conds)
  const size = Math.max(1, Math.min(100, limit))
  const offset = (Math.max(1, page) - 1) * size
  const [items, [{ count }]] = await Promise.all([
    db.select().from(matkaBets).where(where).orderBy(desc(matkaBets.createdAt), desc(matkaBets.id)).limit(size).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(matkaBets).where(where),
  ])
  return { items, total: count }
}

/**
 * One session's open book by selection: what is staked on each selection and what it pays if it wins, in
 * minor units (a legacy bet without a stored potential win pays stake x multiplier). The worst-outcome
 * figure on the Worli session page is worked out from this.
 */
export async function openBookEntriesByInstance(instanceId: string) {
  const selection = sql<string>`coalesce(${matkaBets.selectionKey}, ${matkaBets.betNumbers})`
  const rows = await db
    .select({
      bidType: matkaBets.bidType,
      selection,
      matkaType: matkaBets.matkaType,
      stakeMinor: sql<string>`coalesce(sum(round(${matkaBets.betAmount} * 100)), 0)::text`,
      payoutMinor: sql<string>`coalesce(sum(round(coalesce(${matkaBets.potentialWin}, ${matkaBets.betAmount} * ${matkaBets.payoutMultiplier}) * 100)), 0)::text`,
    })
    .from(matkaBets)
    .where(and(eq(matkaBets.instanceId, instanceId), inArray(matkaBets.status, ['active', 'pending'])))
    .groupBy(matkaBets.bidType, selection, matkaBets.matkaType)
  return rows.map((row) => ({ ...row, stakeMinor: BigInt(row.stakeMinor), payoutMinor: BigInt(row.payoutMinor) }))
}

export async function computeWorliBookByInstance(instanceId: string) {
  // Group by bidType and a normalized selection key (prefer selectionKey, fallback to betNumbers)
  const rows = await db
    .select({
      bidType: matkaBets.bidType,
      selection: sql<string>`coalesce(${matkaBets.selectionKey}, ${matkaBets.betNumbers})` as any,
      betCount: sql<number>`count(*)::int` as any,
      totalStakeMinor: sql<number>`coalesce(sum((${matkaBets.betAmount}::decimal * 100)::bigint), 0)` as any,
      totalPotentialWinMinor: sql<number>`coalesce(sum((${matkaBets.potentialWin}::decimal * 100)::bigint), 0)` as any,
    })
    .from(matkaBets)
    .where(and(eq(matkaBets.instanceId, instanceId), inArray(matkaBets.status, ['active', 'pending'])))
    .groupBy(matkaBets.bidType, matkaBets.selectionKey, matkaBets.betNumbers)

  const groupsMap = new Map<string, { bidType: string; items: { selection: string; betCount: number; plMinor: number }[] }>()
  let totalStakeMinor = 0
  for (const r of rows) {
    totalStakeMinor += Number(r.totalStakeMinor || 0)
    const plMinor = Number(r.totalStakeMinor || 0) - Number(r.totalPotentialWinMinor || 0)
    const key = r.bidType
    if (!groupsMap.has(key)) groupsMap.set(key, { bidType: key, items: [] })
    groupsMap.get(key)!.items.push({ selection: r.selection, betCount: Number(r.betCount || 0), plMinor })
  }
  const groups = Array.from(groupsMap.values()).map((g) => ({
    bidType: g.bidType,
    items: g.items.sort((a, b) => a.selection.localeCompare(b.selection)),
  }))
  return { totalStakeMinor, groups }
}
