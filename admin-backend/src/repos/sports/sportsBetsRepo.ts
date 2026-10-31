import { db } from '@src/db/client.js'
import { eq, and, gte, lte, or, not, desc, asc, sql, inArray, like, ilike, getTableColumns } from 'drizzle-orm'
import { sportsBets } from '@shared/db/schema.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { getEndOfDayForDate, parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { sportsMarketsTable, sportsRunnersTable, sportsLeaguesTable, sportsEventsTable, sportsTable } from '@shared/db/schema.js'
import { users, wallets, ledgerEntries } from '@shared/db/schema.js'
import { currencyService } from '@src/services/currencyService.js'

export type CreateSportsBetInput = {
  tenant: string
  whitelabelId: string
  userId: number
  sportId: string
  leagueId: string
  marketId: string
  eventId: string
  runnerId: string
  selectionId: string
  side: 'back' | 'lay'
  price: number
  size: number
  stake: number
  liability: number
  currency?: string
}

export type SportsBetFilter = {
  betIds?: string[]
  stakeMin?: number
  stakeMax?: number
  tenant?: string
  whitelabelId?: string
  userId?: number
  userIds?: number[] // For agent filtering - filter by multiple user IDs
  eventId?: string // Filter by specific event ID
  sportId?: string
  leagueId?: string
  marketId?: string
  runnerId?: string
  selectionId?: string
  status?: string
  statuses?: string[] // For BetsPage multi-select
  side?: 'back' | 'lay'
  dateFrom?: string
  dateTo?: string
  search?: string // Comprehensive search: odds, stake, user name, market name, selection name, back/lay, date/time, market type
  limit?: number
  offset?: number
  /**
   * When true, hide in-flight bets placed via bet-tool / integration (`excludeFromAdminRunning`)
   * while still showing them once settled (won/lost/void/cancelled).
   */
  omitOpenAdminToolBets?: boolean
}

/** OR conditions for `filter.search` — must match getSportsBets search branch. */
function buildSportsBetsSearchOrConditions(searchTermRaw: string): any[] {
  const searchTerm = searchTermRaw.trim()
  const searchTermLower = searchTerm.toLowerCase()
  const searchConditions: any[] = []
  const textSearchTerm = `%${searchTerm}%`
  searchConditions.push(
    ilike(users.name, textSearchTerm),
    ilike(users.username, textSearchTerm),
    ilike(sportsMarketsTable.name, textSearchTerm),
    ilike(sportsRunnersTable.name, textSearchTerm),
    ilike(sportsMarketsTable.type, textSearchTerm),
    ilike(sportsEventsTable.name, textSearchTerm),
    ilike(sportsLeaguesTable.name, textSearchTerm),
    ilike(sportsTable.name, textSearchTerm),
    ilike(sportsBets.selectionId, textSearchTerm),
    ilike(users.phone, textSearchTerm)
  )
  if (searchTermLower === 'back' || searchTermLower === 'lay') {
    searchConditions.push(eq(sportsBets.side, searchTermLower as 'back' | 'lay'))
  }
  const numericValue = Number(searchTerm)
  if (!Number.isNaN(numericValue)) {
    searchConditions.push(eq(sportsBets.price, numericValue.toString()))
    searchConditions.push(eq(sportsBets.stake, numericValue.toString()))
    // Guard against phone numbers exceeding PostgreSQL integer max (2,147,483,647)
    if (numericValue > 0 && numericValue <= 2147483647) {
      searchConditions.push(eq(users.id, numericValue))
    }
  }
  return searchConditions
}

export async function createSportsBet(input: CreateSportsBetInput) {
  const tenant = input.tenant ?? input.whitelabelId;
  const currency = input.currency ?? await getWhitelabelCurrency(tenant);
  const [bet] = await db.insert(sportsBets).values({
    tenant: input.tenant,
    whitelabelId: input.whitelabelId,
    userId: input.userId,
    sportId: input.sportId,
    leagueId: input.leagueId,
    marketId: input.marketId,
    eventId: input.eventId,
    runnerId: input.runnerId,
    selectionId: input.selectionId,
    side: input.side,
    price: String(input.price),
    size: String(input.size),
    stake: String(input.stake),
    liability: String(input.liability),
    currency,
    status: 'unmatched',
  }).returning()
  
  return bet
}

async function buildSportsBetsConditions(filter: SportsBetFilter) {
  const conditions = []
  if (filter.betIds) conditions.push(inArray(sportsBets.id, filter.betIds))
  if (filter.stakeMin != null) conditions.push(gte(sportsBets.stake, String(filter.stakeMin)))
  if (filter.stakeMax != null) conditions.push(lte(sportsBets.stake, String(filter.stakeMax)))
  
  if (filter.tenant) {
    conditions.push(eq(sportsBets.tenant, filter.tenant))
  }
  if (filter.whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId))
  }
  // Handle userId filtering: userIds takes precedence over userId (for agent filtering)
  if (filter.userIds && Array.isArray(filter.userIds) && filter.userIds.length > 0) {
    conditions.push(inArray(sportsBets.userId, filter.userIds))
  } else if (filter.userId) {
    conditions.push(eq(sportsBets.userId, filter.userId))
  }
  if (filter.eventId) {
    conditions.push(eq(sportsBets.eventId, filter.eventId))
  }
  if (filter.sportId) {
    conditions.push(eq(sportsBets.sportId, filter.sportId))
  }
  if (filter.leagueId) {
    conditions.push(eq(sportsBets.leagueId, filter.leagueId))
  }
  if (filter.marketId) {
    conditions.push(eq(sportsBets.marketId, filter.marketId))
  }
  if (filter.runnerId) {
    conditions.push(eq(sportsBets.runnerId, filter.runnerId))
  }
  if (filter.selectionId) {
    conditions.push(eq(sportsBets.selectionId, filter.selectionId))
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(inArray(sportsBets.status, filter.statuses as any))
  } else if (filter.status) {
    conditions.push(eq(sportsBets.status, filter.status as any))
  }
  if (filter.side) {
    conditions.push(eq(sportsBets.side, filter.side))
  }
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getWhitelabelTimezone(filter.tenant ?? 'default')
    if (filter.dateFrom) conditions.push(gte(sportsBets.createdAt, parseDateFrom(filter.dateFrom, tz)))
    if (filter.dateTo) conditions.push(lte(sportsBets.createdAt, parseDateTo(filter.dateTo, tz)))
  }
  if (filter.omitOpenAdminToolBets) {
    conditions.push(
      or(
        eq(sportsBets.excludeFromAdminRunning, false),
        not(inArray(sportsBets.status, ['matched', 'unmatched'] as any))
      )
    )
  }

  return conditions
}

/** Return a wrapped builder so callers can compose it without executing its thenable query. */
export async function buildSportsBetsQuery(filter: SportsBetFilter) {
  const conditions = await buildSportsBetsConditions(filter)
  if (filter.search?.trim()) conditions.push(or(...buildSportsBetsSearchOrConditions(filter.search)))
  return {
    query: db.select({
      ...getTableColumns(sportsBets),
      sportName: sportsTable.name,
      leagueName: sportsLeaguesTable.name,
      eventName: sportsEventsTable.name,
      marketName: sportsMarketsTable.name,
      selectionName: sportsRunnersTable.name,
    })
      .from(sportsBets)
      // Names enrich historical bets; missing catalog metadata must not drop counted bets.
      .leftJoin(users, eq(sportsBets.userId, users.id))
      .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
      .leftJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
      .leftJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
      .leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
      .leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
      .where(and(...conditions)),
  }
}

export async function getSportsBets(filter: SportsBetFilter) {
  const { query } = await buildSportsBetsQuery(filter)
  // Surface database failures as errors instead of a misleading successful empty page.
  return query.orderBy(desc(sportsBets.createdAt), desc(sportsBets.id))
    .limit(filter.limit || 100).offset(filter.offset || 0)
}

/** Total count with same base filters as getSportsBets (no limit/offset). Search uses the same joins as the list. */
export async function getSportsBetsCount(filter: SportsBetFilter): Promise<number> {
  const conditions = await buildSportsBetsConditions(filter)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  if (filter.search?.trim()) {
    const searchConditions = buildSportsBetsSearchOrConditions(filter.search)
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sportsBets)
      .leftJoin(users, eq(sportsBets.userId, users.id))
      .leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
      .leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
      .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
      .leftJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
      .leftJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
      .where(and(whereClause, or(...searchConditions)))
    return row?.count ?? 0
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sportsBets)
    .where(whereClause)
  return row?.count ?? 0
}

/** Total count + total stake sum with same filters as getSportsBetsCount. */
export async function getSportsBetsCountAndStake(filter: SportsBetFilter): Promise<{ count: number; stakeSum: number }> {
  const conditions = await buildSportsBetsConditions(filter)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  if (filter.search?.trim()) {
    const searchConditions = buildSportsBetsSearchOrConditions(filter.search)
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        stakeSum: sql<number>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)`,
      })
      .from(sportsBets)
      .leftJoin(users, eq(sportsBets.userId, users.id))
      .leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
      .leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
      .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
      .leftJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
      .leftJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
      .where(and(whereClause, or(...searchConditions)))
    return { count: row?.count ?? 0, stakeSum: Number(row?.stakeSum ?? 0) }
  }

  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      stakeSum: sql<number>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(whereClause)
  return { count: row?.count ?? 0, stakeSum: Number(row?.stakeSum ?? 0) }
}

/** Aggregated GGR and P&L for given user IDs (settled bets only). No row limit; use for agent dashboard. */
export async function getAggregatedGGRPlForUserIds(
  tenant: string,
  userIds: number[]
): Promise<{ ggr: number; pl: number }> {
  if (!tenant || !userIds?.length) return { ggr: 0, pl: 0 }
  const [row] = await db
    .select({
      ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.tenant, tenant),
        inArray(sportsBets.userId, userIds),
        inArray(sportsBets.status, ['won', 'lost', 'settled']),
        sql`${sportsBets.pl} IS NOT NULL`
      )
    )
  return { ggr: Number(row?.ggr ?? 0), pl: Number(row?.pl ?? 0) }
}

/** Player overview: aggregated settled stats for one user in date range (no row limit). */
export async function getPlayerOverviewSettledAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ ggr: number; pl: number; settledCount: number; settledStakeSum: number }> {
  const conditions = [
    eq(sportsBets.tenant, tenant),
    eq(sportsBets.userId, userId),
    inArray(sportsBets.status, ['won', 'lost', 'settled']),
    gte(sportsBets.createdAt, dateFrom),
    lte(sportsBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
      settledCount: sql<number>`COUNT(*)::int`,
      settledStakeSum: sql<number>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(and(...conditions))
  return {
    ggr: Number(row?.ggr ?? 0),
    pl: Number(row?.pl ?? 0),
    settledCount: Number(row?.settledCount ?? 0),
    settledStakeSum: Number(row?.settledStakeSum ?? 0),
  }
}

/** Player overview: all bets in date range (count + total stake). */
export async function getPlayerOverviewAllBetsAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ totalCount: number; totalStakeSum: number }> {
  const conditions = [
    eq(sportsBets.tenant, tenant),
    eq(sportsBets.userId, userId),
    gte(sportsBets.createdAt, dateFrom),
    lte(sportsBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      totalCount: sql<number>`COUNT(*)::int`,
      totalStakeSum: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(and(...conditions))
  return {
    totalCount: Number(row?.totalCount ?? 0),
    totalStakeSum: Number(row?.totalStakeSum ?? 0),
  }
}

/** Player overview: open bets in date range (count + liability sum for exposure). */
export async function getPlayerOverviewOpenAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ openCount: number; openStakeSum: number }> {
  const conditions = [
    eq(sportsBets.tenant, tenant),
    eq(sportsBets.userId, userId),
    inArray(sportsBets.status, ['matched', 'unmatched']),
    gte(sportsBets.createdAt, dateFrom),
    lte(sportsBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      openCount: sql<number>`COUNT(*)::int`,
      openStakeSum: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(and(...conditions))
  return {
    openCount: Number(row?.openCount ?? 0),
    openStakeSum: Number(row?.openStakeSum ?? 0),
  }
}

export async function getSportsBetById(id: string) {
  const [bet] = await db.select().from(sportsBets)
    .where(eq(sportsBets.id, id))
    .limit(1)
  return bet || null
}

export async function updateSportsBetStatus(
  id: string,
  status: string,
  result?: string,
  settledAt?: Date
) {
  const updateData: any = {
    status: status as any,
    updatedAt: new Date(),
  }
  
  if (result !== undefined) {
    updateData.result = result
  }
  if (settledAt !== undefined) {
    updateData.settledAt = settledAt
  }
  if (status === 'matched') {
    updateData.matchedAt = new Date()
  }

  // Reset pl when moving back to non-settled states
  if (['matched', 'unmatched'].includes(status)) {
    updateData.pl = null
  }

  if (['won', 'lost', 'void', 'settled', 'cancelled'].includes(status)) {
    updateData.excludeFromAdminRunning = false
  }

  const [bet] = await db.update(sportsBets)
    .set(updateData)
    .where(eq(sportsBets.id, id))
    .returning()
  
  return bet || null
}

export type OpenBetsForRunningMarketsFilter = {
  tenant?: string
  whitelabelId?: string
  limit?: number
  offset?: number
}

/**
 * Get open bets (matched/unmatched) for running markets (active markets).
 * This is used for live analysis dashboard.
 */
export async function getOpenBetsForRunningMarkets(filter: OpenBetsForRunningMarketsFilter) {
  const conditions = []
  
  if (filter.tenant) {
    conditions.push(eq(sportsBets.tenant, filter.tenant))
  }
  if (filter.whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId))
  }
  
  // Filter by bet status: only matched or unmatched (open bets)
  conditions.push(inArray(sportsBets.status, ['matched', 'unmatched']))
  conditions.push(eq(sportsBets.excludeFromAdminRunning, false))

  // Join with markets table and filter only active markets (running markets)
  // Also join with sports, leagues, events to get names
  const query = db
    .select({
      // Bet fields
      id: sportsBets.id,
      tenant: sportsBets.tenant,
      whitelabelId: sportsBets.whitelabelId,
      userId: sportsBets.userId,
      sportId: sportsBets.sportId,
      leagueId: sportsBets.leagueId,
      marketId: sportsBets.marketId,
      eventId: sportsBets.eventId,
      runnerId: sportsBets.runnerId,
      selectionId: sportsBets.selectionId,
      side: sportsBets.side,
      price: sportsBets.price,
      size: sportsBets.size,
      stake: sportsBets.stake,
      liability: sportsBets.liability,
      status: sportsBets.status,
      matchedAt: sportsBets.matchedAt,
      settledAt: sportsBets.settledAt,
      result: sportsBets.result,
      pl: sportsBets.pl,
      currency: sportsBets.currency,
      createdAt: sportsBets.createdAt,
      updatedAt: sportsBets.updatedAt,
      // Sport name
      sportName: sportsTable.name,
      // League name
      leagueName: sportsLeaguesTable.name,
      // Event name
      eventName: sportsEventsTable.name,
      // Market name and type
      marketName: sportsMarketsTable.name,
      marketType: sportsMarketsTable.type,
    })
    .from(sportsBets)
    .innerJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
    .innerJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
    .innerJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
    .innerJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
    .where(
      and(
        ...conditions,
        // Only active markets (running markets)
        eq(sportsMarketsTable.status, 'active')
      )
    )
    .orderBy(desc(sportsBets.createdAt))
    .limit(filter.limit || 10000)
    .offset(filter.offset || 0)

  return query
}

/**
 * Get all open bets for a specific market/event that need settlement.
 * For fancy markets with selectionName, finds bets across ALL markets in the event
 * with matching name (handles admin vs user-created market ID mismatch).
 */
export async function getOpenBetsForMarket(
  marketId: string,
  eventId: string,
  tenant: string,
  whitelabelId: string,
  options?: { marketType?: string; selectionName?: string | null }
) {
  const baseConditions = [
    eq(sportsBets.eventId, eventId),
    eq(sportsBets.tenant, tenant),
    eq(sportsBets.whitelabelId, whitelabelId),
    inArray(sportsBets.status, ['matched', 'unmatched']),
  ]

  // For fancy with a run-line selection (not VOID/CANCELLED/SUSPENDED), find markets by name
  const isFancySpecialStatus = options?.selectionName && ['VOID', 'CANCELLED', 'SUSPENDED'].includes(options.selectionName)
  if (options?.marketType === 'fancy' && options?.selectionName && !isFancySpecialStatus) {
    const fancyMarkets = await db
      .select({ id: sportsMarketsTable.id })
      .from(sportsMarketsTable)
      .where(
        and(
          eq(sportsMarketsTable.eventId, eventId),
          eq(sportsMarketsTable.type, 'fancy'),
          ilike(sportsMarketsTable.name, options.selectionName)
        )
      )
    const marketIds = fancyMarkets.map((m) => m.id)
    if (marketIds.length === 0) {
      marketIds.push(marketId)
    }
    return await db
      .select()
      .from(sportsBets)
      .where(and(...baseConditions, inArray(sportsBets.marketId, marketIds)))
  }

  return await db
    .select()
    .from(sportsBets)
    .where(and(...baseConditions, eq(sportsBets.marketId, marketId)))
}

/** Open statuses: only these can transition to settled. */
const OPEN_BET_STATUSES = ['matched', 'unmatched'] as const

/**
 * Settle a sports bet only when it is still open (matched/unmatched). Atomic open→settled transition.
 * @param executor - Database transaction context (tx) or db for standalone operations
 * @param pl - Profit/Loss value: positive = user profit, negative = user loss, 0 = void
 * @returns The updated bet row if the transition occurred, or null if bet was already settled/not open (idempotent).
 */
export async function settleSportsBet(
  betId: string,
  status: 'won' | 'lost' | 'void',
  winAmount?: number,
  settledAt?: Date,
  executor: any = db,
  pl?: number
): Promise<{ id: string; userId: number; [key: string]: unknown } | null> {
  const updateData: any = {
    status: status as any,
    updatedAt: new Date(),
    settledAt: settledAt || new Date(),
    excludeFromAdminRunning: false,
  }

  if (winAmount !== undefined && winAmount > 0) {
    updateData.result = String(winAmount)
  }

  if (pl !== undefined) {
    updateData.pl = String(pl)
  }

  const [bet] = await executor
    .update(sportsBets)
    .set(updateData)
    .where(and(eq(sportsBets.id, betId), inArray(sportsBets.status, OPEN_BET_STATUSES)))
    .returning()

  return bet || null
}

/**
 * Get bets ready for settlement (alias for getOpenBetsForMarket)
 */
export async function getBetsForSettlement(
  marketId: string,
  eventId: string,
  tenant: string,
  whitelabelId: string
) {
  return getOpenBetsForMarket(marketId, eventId, tenant, whitelabelId)
}

/**
 * Cancel a bet manually (admin action = Invalid from event detail).
 * EXPOSURE MODEL: Cash was NOT deducted at bet placement.
 * - Updates bet status to 'cancelled'
 * - NO cash change (nothing to refund)
 * - Logs audit ledger entry (amount 0)
 * - Recalculates wallet exposure from remaining open bets
 * - Releases credit for AGENT_CREDIT / WHITELABEL_CREDIT players
 */
export async function cancelBet(
  betId: string,
  reason: string,
  _cancelledBy: string,
  tenant: string,
  _executor?: any
): Promise<void> {
  await db.transaction(async (tx) => {
    // Took no tenant at all, so it cancelled any brand's bet by id. Required
    // rather than optional: an omitted scope is the bug this closes.
    const [bet] = await tx
      .select()
      .from(sportsBets)
      .where(and(eq(sportsBets.id, betId), eq(sportsBets.tenant, tenant)))
      .limit(1);

    if (!bet) {
      throw new Error('Bet not found');
    }

    if (bet.status !== 'matched' && bet.status !== 'unmatched') {
      throw new Error(`Cannot cancel bet with status: ${bet.status}`);
    }

    // Transition-guarded status flip: only flip if still open (matched/unmatched).
    // RETURNING the row guarantees a single winner under concurrency — a second
    // concurrent cancel/void finds no open row and skips credit release (no double-release).
    const [transitioned] = await tx
      .update(sportsBets)
      .set({
        status: 'cancelled' as any,
        updatedAt: new Date(),
        result: reason,
        pl: '0',
      })
      .where(
        and(
          eq(sportsBets.id, betId),
          eq(sportsBets.tenant, tenant),
          inArray(sportsBets.status, OPEN_BET_STATUSES)
        )
      )
      .returning();

    // Lost the race (already cancelled/voided/settled by another tx): no-op, no release.
    if (!transitioned) {
      return;
    }

    // The bet was fetched scoped to `tenant`, so the row's own tenant is the
    // same value; the local that used to redefine it here now shadows the
    // parameter, so it is gone.
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, bet.userId), eq(wallets.tenant, tenant)))
      .limit(1);

    if (!wallet) {
      throw new Error(`Wallet not found for user ${bet.userId}`);
    }

    const stake = Number(bet.stake || 0);
    const liability = Number(bet.liability || 0);
    const currency = (bet.currency || wallet.currency || 'INR') as string;

    // Audit ledger only (no cash change in exposure model)
    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: wallet.id,
      type: 'void',
      amount: '0',
      meta: {
        type: 'sports_bet_cancel',
        betId,
        outcome: 'cancelled',
        reason,
        stake,
        liability,
        originalCurrency: currency,
        baseCurrency: currencyService.getBaseCurrency(),
        note: 'No cash change - exposure model (manual invalid from admin)',
      } as any,
    });

    // Release credit for credit players INSIDE the same tx so the status flip and
    // credit release commit/rollback atomically (no separate self-tx, no double-release).
    const [player] = await tx
      .select({ playerType: users.playerType, agentId: users.agentId })
      .from(users)
      .where(eq(users.id, bet.userId))
      .limit(1);

    if (player && (player.playerType === 'AGENT_CREDIT' || player.playerType === 'WHITELABEL_CREDIT')) {
      const betAmount = bet.side === 'back' ? Number(bet.stake || 0) : Number(bet.liability || 0);
      const { BetCreditValidationService } = await import('@src/domains/agents/services/BetCreditValidationService.js');
      const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
      const { AgentPlayerCreditsRepo } = await import('@src/repos/agents/AgentPlayerCreditsRepo.js');
      const agentsRepo = new AgentsRepo();
      const playerCreditsRepo = new AgentPlayerCreditsRepo();
      const betCreditService = new BetCreditValidationService(agentsRepo, playerCreditsRepo);

      await betCreditService.releaseCreditForBet(
        bet.userId,
        betAmount,
        'void',
        0,
        tenant,
        bet.id,
        'sports',
        tx
      );
    }

    // Recalculate exposure from remaining open bets (this bet now excluded)
    try {
      const { recalculateUserExposure } = await import('@src/services/sports/sportsSettlementService.js');
      await recalculateUserExposure(bet.userId, tenant, tx);
    } catch (err) {
    }
  });
}

/**
 * Void a bet (admin action from event detail).
 * EXPOSURE MODEL: Cash was NOT deducted at bet placement.
 * - Updates bet status to 'void'
 * - NO cash change (nothing to refund)
 * - Logs audit ledger entry (amount 0)
 * - Recalculates wallet exposure from remaining open bets
 * - Releases credit for AGENT_CREDIT / WHITELABEL_CREDIT players
 */
export async function voidBetWithRefund(betId: string, _reason: string, tenant: string): Promise<void> {
  await db.transaction(async (tx) => {
    // The tenant argument was declared `_tenant` and never used: the bet was
    // found by id alone and its own row then supplied the tenant for everything
    // downstream. A whitelabel admin who knew a bet id could void a bet
    // belonging to a different brand. The caller already passes its own tenant;
    // this makes the lookup honour it.
    const [bet] = await tx
      .select()
      .from(sportsBets)
      .where(and(eq(sportsBets.id, betId), eq(sportsBets.tenant, tenant)))
      .limit(1)

    if (!bet) throw new Error('Bet not found')
    if (bet.status !== 'matched' && bet.status !== 'unmatched') {
      throw new Error(`Cannot void bet with status: ${bet.status}`)
    }

    const betTenant = bet.tenant || 'default'

    // Transition-guarded status flip: only flip if still open (matched/unmatched).
    // RETURNING guarantees a single winner under concurrency — a second concurrent
    // void/cancel finds no open row and skips credit release (no double-release).
    const [transitioned] = await tx
      .update(sportsBets)
      .set({
        status: 'void' as any,
        updatedAt: new Date(),
        pl: '0',
        excludeFromAdminRunning: false,
      })
      .where(
        and(
          eq(sportsBets.id, betId),
          eq(sportsBets.tenant, tenant),
          inArray(sportsBets.status, OPEN_BET_STATUSES)
        )
      )
      .returning()

    // Lost the race (already voided/cancelled/settled by another tx): no-op, no release.
    if (!transitioned) {
      return
    }

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, bet.userId), eq(wallets.tenant, betTenant)))
      .limit(1)

    if (!wallet) throw new Error(`Wallet not found for user ${bet.userId}`)

    const stake = Number(bet.stake || 0)
    const liability = Number(bet.liability || 0)
    const currency = (bet.currency || wallet.currency || 'INR') as string

    // Audit ledger only (no cash change in exposure model)
    await tx.insert(ledgerEntries).values({
      tenant: betTenant,
      walletId: wallet.id,
      type: 'void',
      amount: '0',
      meta: {
        type: 'sports_bet_void',
        betId,
        outcome: 'void',
        stake,
        liability,
        originalCurrency: currency,
        baseCurrency: currencyService.getBaseCurrency(),
        note: 'No cash change - exposure model (manual void from admin)',
      } as any,
    })

    // Release credit for credit players INSIDE the same tx so the status flip and
    // credit release commit/rollback atomically (no separate self-tx, no double-release).
    const [player] = await tx
      .select({ playerType: users.playerType, agentId: users.agentId })
      .from(users)
      .where(eq(users.id, bet.userId))
      .limit(1)

    if (player && (player.playerType === 'AGENT_CREDIT' || player.playerType === 'WHITELABEL_CREDIT')) {
      const { BetCreditValidationService } = await import('@src/domains/agents/services/BetCreditValidationService.js')
      const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
      const { AgentPlayerCreditsRepo } = await import('@src/repos/agents/AgentPlayerCreditsRepo.js')
      const agentsRepo = new AgentsRepo()
      const playerCreditsRepo = new AgentPlayerCreditsRepo()
      const betCreditService = new BetCreditValidationService(agentsRepo, playerCreditsRepo)
      const heldAmount = bet.side === 'back' ? Number(bet.stake || 0) : Number(bet.liability || 0)
      await betCreditService.releaseCreditForBet(
        bet.userId,
        heldAmount,
        'void',
        0,
        betTenant,
        betId,
        'sports',
        tx
      )
    }

    // Recalculate exposure from remaining open bets (this bet now excluded)
    try {
      const { recalculateUserExposure } = await import('@src/services/sports/sportsSettlementService.js')
      await recalculateUserExposure(bet.userId, betTenant, tx)
    } catch (err) {
      // Don't fail the void; exposure will correct on next recalc
    }
  })
}

/**
 * Leagues that have at least one open bet (matched/unmatched) for the given sport.
 * Used by declare-result flow to show only leagues with open bets.
 */
export async function getLeaguesWithOpenBets(sportId: string): Promise<
  Array<{ id: string; name: string; sportId: string; sort: number; status: string | null; updatedAt: Date | null }>
> {
  const leagueIds = await db
    .selectDistinct({ leagueId: sportsBets.leagueId })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.sportId, sportId),
        inArray(sportsBets.status, [...OPEN_BET_STATUSES])
      )
    )
  const ids = leagueIds.map((r) => r.leagueId)
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: sportsLeaguesTable.id,
      name: sportsLeaguesTable.name,
      sportId: sportsLeaguesTable.sportId,
      sort: sportsLeaguesTable.sort,
      status: sportsLeaguesTable.status,
      updatedAt: sportsLeaguesTable.updatedAt,
    })
    .from(sportsLeaguesTable)
    .where(inArray(sportsLeaguesTable.id, ids))
    .orderBy(sportsLeaguesTable.sort)
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    sportId: String(r.sportId),
    sort: Number(r.sort ?? 999),
    status: r.status,
    updatedAt: r.updatedAt,
  }))
}

/**
 * Events that have at least one open bet for the given league.
 * Used by declare-result flow to show only events with open bets.
 */
export async function getEventsWithOpenBets(leagueId: string): Promise<
  Array<{ id: string; name: string; leagueId: string; startTime: Date | null; status: string | null; updatedAt: Date | null }>
> {
  const eventIds = await db
    .selectDistinct({ eventId: sportsBets.eventId })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.leagueId, leagueId),
        inArray(sportsBets.status, [...OPEN_BET_STATUSES])
      )
    )
  const ids = eventIds.map((r) => r.eventId)
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: sportsEventsTable.id,
      name: sportsEventsTable.name,
      leagueId: sportsEventsTable.leagueId,
      startTime: sportsEventsTable.startTime,
      status: sportsEventsTable.status,
      updatedAt: sportsEventsTable.updatedAt,
    })
    .from(sportsEventsTable)
    .where(inArray(sportsEventsTable.id, ids))
    .orderBy(asc(sportsEventsTable.startTime))
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    leagueId: String(r.leagueId),
    startTime: r.startTime,
    status: r.status,
    updatedAt: r.updatedAt,
  }))
}

/**
 * Markets that have at least one open bet for the given event.
 * Used by declare-result flow to show only markets with open bets.
 */
export async function getMarketsWithOpenBets(eventId: string): Promise<
  Array<{ id: string; name: string; eventId: string; type: string; status: string | null; updatedAt: Date | null }>
> {
  const marketIds = await db
    .selectDistinct({ marketId: sportsBets.marketId })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.eventId, eventId),
        inArray(sportsBets.status, [...OPEN_BET_STATUSES])
      )
    )
  const ids = marketIds.map((r) => r.marketId)
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: sportsMarketsTable.id,
      name: sportsMarketsTable.name,
      eventId: sportsMarketsTable.eventId,
      type: sportsMarketsTable.type,
      status: sportsMarketsTable.status,
      updatedAt: sportsMarketsTable.updatedAt,
    })
    .from(sportsMarketsTable)
    .where(inArray(sportsMarketsTable.id, ids))
    .orderBy(sportsMarketsTable.name)
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    eventId: String(r.eventId),
    type: String(r.type ?? 'match_odds'),
    status: r.status,
    updatedAt: r.updatedAt,
  }))
}

