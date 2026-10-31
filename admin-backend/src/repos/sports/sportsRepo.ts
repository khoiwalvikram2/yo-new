import { db } from '@src/db/client.js'
import { desc, eq, and, gte, lte, sql, count, sum, or, isNull, isNotNull, inArray, max } from 'drizzle-orm'
import { sportsTable } from '@shared/db/schema.js'
import { sportsLeaguesTable, sportsEventsTable, sportsMarketsTable, sportsRunnersTable, sportsAutoRunsTable } from '@shared/db/schema.js'
import { sportsBets } from '@shared/db/schema.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { isAllowedIngestMarketName } from '@src/repos/sports/ingestMarketAllowlist.js'

export type UpsertSportInput = {
  sportCode: string
  key: string
  name: string
  sort?: number
  status?: 'active'|'inactive'
}

export async function upsertSports(inputs: UpsertSportInput[]) {
  // Global data - no tenant/whitelabel filtering. All whitelabels see the same sports.
  let inserted = 0
  let updated = 0
  for (const item of inputs) {
    const existing = await db.select().from(sportsTable).where(
      eq(sportsTable.sportCode, item.sportCode)
    )
    if (existing.length === 0) {
      await db.insert(sportsTable).values({
        sportCode: item.sportCode,
        key: item.key,
        name: item.name,
        sort: item.sort ?? 999,
        status: (item.status ?? 'active') as any,
      })
      inserted++
    } else {
      const current = existing[0]
      await db.update(sportsTable).set({
        key: item.key,
        name: item.name,
        sort: item.sort ?? current.sort,
        updatedAt: new Date(),
      }).where(eq(sportsTable.id, current.id))
      updated++
    }
  }
  return { inserted, updated }
}

export async function listSports() {
  // Global data - no tenant filtering, all whitelabels see same sports
  return db.select().from(sportsTable)
    .orderBy(sportsTable.sort)
}

export async function setSportStatus(key: string, status: 'active'|'inactive') {
  // Global data - no tenant filtering
  await db.update(sportsTable).set({ status: status as any, updatedAt: new Date() })
    .where(eq(sportsTable.key, key))
  return true
}

export async function getSportById(id: string) {
  const rows = await db.select().from(sportsTable).where(eq(sportsTable.id, id))
  return rows[0] || null
}

// League upsert
export type UpsertLeagueInput = {
  sportId: string
  leagueCode: string
  key: string
  name: string
  status?: 'active'|'inactive'
}

export async function upsertLeague(input: UpsertLeagueInput) {
  // Global data - no tenant/whitelabel filtering
  const existing = await db.select({ id: sportsLeaguesTable.id }).from(sportsLeaguesTable)
    .where(eq(sportsLeaguesTable.leagueCode, input.leagueCode))
  if (existing.length) {
    await db.update(sportsLeaguesTable)
      .set({ name: input.name, key: input.key, sportId: input.sportId, status: (input.status ?? 'active') as any, updatedAt: new Date() })
      .where(eq(sportsLeaguesTable.id, existing[0].id))
    return existing[0].id
  }
  const inserted = await db.insert(sportsLeaguesTable).values({
    sportId: input.sportId,
    leagueCode: input.leagueCode,
    key: input.key,
    name: input.name,
    status: (input.status ?? 'active') as any,
  }).returning({ id: sportsLeaguesTable.id })
  return inserted[0].id
}

// Event upsert
export type UpsertEventInput = {
  leagueId: string
  eventCode: string
  key: string
  name: string
  startTime?: string | null
  status?: 'active'|'inactive'
}

export async function upsertEvent(input: UpsertEventInput) {
  // Global data - no tenant/whitelabel filtering
  const existing = await db.select({ id: sportsEventsTable.id }).from(sportsEventsTable)
    .where(eq(sportsEventsTable.eventCode, input.eventCode))
  const startTimeVal = input.startTime ? new Date(input.startTime) : null
  if (existing.length) {
    await db.update(sportsEventsTable)
      .set({ name: input.name, key: input.key, leagueId: input.leagueId, startTime: startTimeVal as any, status: (input.status ?? 'active') as any, updatedAt: new Date() })
      .where(eq(sportsEventsTable.id, existing[0].id))
    return existing[0].id
  }
  const inserted = await db.insert(sportsEventsTable).values({
    leagueId: input.leagueId,
    eventCode: input.eventCode,
    key: input.key,
    name: input.name,
    startTime: startTimeVal as any,
    status: (input.status ?? 'active') as any,
  }).returning({ id: sportsEventsTable.id })
  return inserted[0].id
}

// Market upsert
export type UpsertMarketInput = {
  eventId: string
  marketCode: string
  name: string
  type?: string
  status?: 'active'|'inactive'
}

export async function upsertMarket(input: UpsertMarketInput): Promise<string | null> {
  if (!isAllowedIngestMarketName(input.name)) {
    return null
  }
  // Global data - no tenant/whitelabel filtering
  const existing = await db.select({ id: sportsMarketsTable.id }).from(sportsMarketsTable)
    .where(eq(sportsMarketsTable.marketCode, input.marketCode))
  if (existing.length) {
    await db.update(sportsMarketsTable)
      .set({ name: input.name, type: (input.type ?? 'match_odds'), eventId: input.eventId, status: (input.status ?? 'active') as any, updatedAt: new Date() })
      .where(eq(sportsMarketsTable.id, existing[0].id))
    return existing[0].id
  }
  const inserted = await db.insert(sportsMarketsTable).values({
    eventId: input.eventId,
    marketCode: input.marketCode,
    name: input.name,
    type: input.type ?? 'match_odds',
    status: (input.status ?? 'active') as any,
  }).returning({ id: sportsMarketsTable.id })
  return inserted[0].id
}

// Runner upsert
export type UpsertRunnerInput = {
  marketId: string
  selectionCode: string
  name: string
  sort?: number
  status?: 'active'|'inactive'
}

export async function upsertRunner(input: UpsertRunnerInput) {
  // Global data - no tenant/whitelabel filtering
  const existing = await db.select({ id: sportsRunnersTable.id }).from(sportsRunnersTable)
    .where(and(eq(sportsRunnersTable.marketId, input.marketId), eq(sportsRunnersTable.selectionCode, input.selectionCode)))
  if (existing.length) {
    await db.update(sportsRunnersTable)
      .set({ name: input.name, sort: input.sort ?? 999, status: (input.status ?? 'active') as any, updatedAt: new Date() })
      .where(eq(sportsRunnersTable.id, existing[0].id))
    return existing[0].id
  }
  const inserted = await db.insert(sportsRunnersTable).values({
    marketId: input.marketId,
    selectionCode: input.selectionCode,
    name: input.name,
    sort: input.sort ?? 999,
    status: (input.status ?? 'active') as any,
  }).returning({ id: sportsRunnersTable.id })
  return inserted[0].id
}

// Lookups for already-added content
export async function listExistingLeagueCodes(sportId: string) {
  // Global data - no tenant filtering
  const rows = await db.select({ code: sportsLeaguesTable.leagueCode })
    .from(sportsLeaguesTable)
    .where(eq(sportsLeaguesTable.sportId, sportId))
  return rows.map(r => String(r.code))
}

export async function listExistingEventCodesByLeagueCode(leagueCode: string) {
  // Global data - no tenant filtering
  const league = await db.select({ id: sportsLeaguesTable.id })
    .from(sportsLeaguesTable)
    .where(eq(sportsLeaguesTable.leagueCode, leagueCode))
  if (!league.length) return []
  const rows = await db.select({ code: sportsEventsTable.eventCode })
    .from(sportsEventsTable)
    .where(eq(sportsEventsTable.leagueId, league[0].id))
  return rows.map(r => String(r.code))
}

// Auto run history
export type CreateAutoRunInput = {
  whitelabelId: string
  sportId: string
}

export async function createAutoRun(input: CreateAutoRunInput) {
  const inserted = await db.insert(sportsAutoRunsTable).values({
    whitelabelId: input.whitelabelId,
    sportId: input.sportId,
    status: 'running',
  }).returning({ id: sportsAutoRunsTable.id })
  return inserted[0].id
}

export type CompleteAutoRunInput = {
  runId: string
  status: 'success' | 'failure'
  leaguesAdded: number
  eventsAdded: number
  marketsAdded: number
  runnersAdded: number
  skippedEventsCount: number
  skippedEvents?: any
  errorMessage?: string | null
}

export async function completeAutoRun(input: CompleteAutoRunInput) {
  await db.update(sportsAutoRunsTable).set({
    finishedAt: new Date(),
    status: input.status,
    leaguesAdded: input.leaguesAdded,
    eventsAdded: input.eventsAdded,
    marketsAdded: input.marketsAdded,
    runnersAdded: input.runnersAdded,
    skippedEventsCount: input.skippedEventsCount,
    skippedEvents: (input.skippedEvents ?? null) as any,
    errorMessage: input.errorMessage ?? null,
  }).where(eq(sportsAutoRunsTable.id, input.runId))
}

export async function listAutoRuns(whitelabelId: string, sportId: string, limit = 20) {
  const rows = await db.select()
    .from(sportsAutoRunsTable)
    .where(and(eq(sportsAutoRunsTable.whitelabelId, whitelabelId), eq(sportsAutoRunsTable.sportId, sportId)))
    .orderBy(sportsAutoRunsTable.startedAt)
  return rows.slice(-limit)
}

export async function deleteAutoRuns(whitelabelId: string, sportId: string) {
  await db.delete(sportsAutoRunsTable)
    .where(and(eq(sportsAutoRunsTable.whitelabelId, whitelabelId), eq(sportsAutoRunsTable.sportId, sportId)))
  return true
}

// Running events query
export type GetRunningEventsFilter = {
  whitelabelId: string
  sport?: string
  from?: string
  to?: string
}

export type RunningEvent = {
  id: string
  sport: string
  competition: string
  name: string
  startTime: string | null
  status: 'upcoming' | 'in_play' | 'finished' | 'suspended'
  marketCount: number
  matchedVolume: number
  totalLiquidity: number
  betsCount: number
  inPlay: boolean
  updatedAt: string
  lastBetAt?: string | null
  eventCode?: string | null
}

export async function getRunningEvents(filter: GetRunningEventsFilter): Promise<RunningEvent[]> {
  // Global data - no tenant filtering for core events
  const conditions = [eq(sportsEventsTable.status, 'active')]
  
  // Filter by sport name if provided
  if (filter.sport) {
    conditions.push(eq(sportsTable.name, filter.sport))
  }
  
  // Filter by date range if provided (IST-aware for YYYY-MM-DD inputs)
  if (filter.from) {
    conditions.push(gte(sportsEventsTable.startTime, parseDateFrom(filter.from, 'Asia/Kolkata')))
  }
  if (filter.to) {
    conditions.push(lte(sportsEventsTable.startTime, parseDateTo(filter.to, 'Asia/Kolkata')))
  }

  // Query events with joins to get sport and league names
  const events = await db
    .select({
      id: sportsEventsTable.id,
      name: sportsEventsTable.name,
      startTime: sportsEventsTable.startTime,
      updatedAt: sportsEventsTable.updatedAt,
      sportName: sportsTable.name,
      leagueName: sportsLeaguesTable.name,
    })
    .from(sportsEventsTable)
    .innerJoin(sportsLeaguesTable, eq(sportsEventsTable.leagueId, sportsLeaguesTable.id))
    .innerJoin(sportsTable, eq(sportsLeaguesTable.sportId, sportsTable.id))
    .where(and(...conditions))

  if (events.length === 0) {
    return []
  }

  const eventIds = events.map(e => String(e.id))
  const now = new Date()

  // Get market counts per event (global data - no tenant filtering)
  const marketCounts = eventIds.length > 0 ? await db
    .select({
      eventId: sportsMarketsTable.eventId,
      count: count(),
    })
    .from(sportsMarketsTable)
    .where(
      and(
        eq(sportsMarketsTable.status, 'active'),
        inArray(sportsMarketsTable.eventId, eventIds)
      )
    )
    .groupBy(sportsMarketsTable.eventId) : []

  const marketCountMap = new Map<string, number>()
  marketCounts.forEach(mc => {
    marketCountMap.set(String(mc.eventId), Number(mc.count) || 0)
  })

  // Get matched volume (sum of stake from matched bets)
  const matchedVolumes = eventIds.length > 0 ? await db
    .select({
      eventId: sportsBets.eventId,
      volume: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.whitelabelId, filter.whitelabelId),
        eq(sportsBets.status, 'matched'),
        eq(sportsBets.excludeFromAdminRunning, false),
        inArray(sportsBets.eventId, eventIds)
      )
    )
    .groupBy(sportsBets.eventId) : []

  const matchedVolumeMap = new Map<string, number>()
  matchedVolumes.forEach(mv => {
    matchedVolumeMap.set(String(mv.eventId), Number(mv.volume) || 0)
  })

  // Get total exposure (sum of liability from all open bets: matched + unmatched)
  // Note: Exposure = liability only, NOT stake + liability (which would double-count)
  const totalLiquidities = eventIds.length > 0 ? await db
    .select({
      eventId: sportsBets.eventId,
      liquidity: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.whitelabelId, filter.whitelabelId),
        or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
        eq(sportsBets.excludeFromAdminRunning, false),
        inArray(sportsBets.eventId, eventIds)
      )
    )
    .groupBy(sportsBets.eventId) : []

  const totalLiquidityMap = new Map<string, number>()
  totalLiquidities.forEach(tl => {
    totalLiquidityMap.set(String(tl.eventId), Number(tl.liquidity) || 0)
  })

  // Get bets count per event (count of all open bets: matched + unmatched)
  const betsCounts = eventIds.length > 0 ? await db
    .select({
      eventId: sportsBets.eventId,
      count: count(),
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.whitelabelId, filter.whitelabelId),
        or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
        eq(sportsBets.excludeFromAdminRunning, false),
        inArray(sportsBets.eventId, eventIds)
      )
    )
    .groupBy(sportsBets.eventId) : []

  const betsCountMap = new Map<string, number>()
  betsCounts.forEach(bc => {
    const eventIdStr = String(bc.eventId)
    const countValue = Number(bc.count) || 0
    betsCountMap.set(eventIdStr, countValue)
  })

  // Get last bet placed time per event (MAX createdAt from all bets for each event)
  const lastBetTimes = eventIds.length > 0 ? await db
    .select({
      eventId: sportsBets.eventId,
      lastBetAt: sql<Date | null>`MAX(${sportsBets.createdAt})`,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.whitelabelId, filter.whitelabelId),
        inArray(sportsBets.eventId, eventIds)
      )
    )
    .groupBy(sportsBets.eventId) : []

  const lastBetAtMap = new Map<string, Date | null>()
  lastBetTimes.forEach(lbt => {
    const eventIdStr = String(lbt.eventId)
    const lastBetDate = lbt.lastBetAt ? new Date(lbt.lastBetAt) : null
    lastBetAtMap.set(eventIdStr, lastBetDate)
  })

  // Get events that have open bets (matched or unmatched) - only show events with real betting activity
  const eventsWithOpenBets = eventIds.length > 0 ? await db
    .select({ eventId: sportsBets.eventId })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.whitelabelId, filter.whitelabelId),
        or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
        eq(sportsBets.excludeFromAdminRunning, false),
        inArray(sportsBets.eventId, eventIds)
      )
    )
    .groupBy(sportsBets.eventId) : []

  const eventsWithBetsSet = new Set(eventsWithOpenBets.map(e => String(e.eventId)))

  // Map results to RunningEvent format - only include events with open bets
  const filtered = events.filter(event => {
    const eventId = String(event.id)
    // Only show events that have active markets AND open bets AND actual liquidity
    const hasMarkets = (marketCountMap.get(eventId) || 0) > 0
    const hasOpenBets = eventsWithBetsSet.has(eventId)
    const hasLiquidity = (totalLiquidityMap.get(eventId) || 0) > 0
    
    // Debug logging for events without bets
    if (hasMarkets && !hasOpenBets) {
    }
    
    // All three conditions must be true: markets exist, bets exist, and there's actual money
    return hasMarkets && hasOpenBets && hasLiquidity
  })

  return filtered
    .map(event => {
      const eventId = String(event.id)
      const startTime = event.startTime ? new Date(event.startTime) : null
      
      // Properly determine inPlay: event must have started AND not finished
      // Consider event finished if startTime was more than 24 hours ago (or adjust based on sport)
      let inPlay = false
      if (startTime) {
        const timeDiff = now.getTime() - startTime.getTime()
        const hoursSinceStart = timeDiff / (1000 * 60 * 60)
        // Event is in play if it started and hasn't been more than 24 hours (adjust as needed)
        inPlay = timeDiff >= 0 && hoursSinceStart < 24
      }
      
      // Determine status based on time and market state
      let status: 'upcoming' | 'in_play' | 'finished' | 'suspended' = 'upcoming'
      if (startTime) {
        if (now < startTime) {
          status = 'upcoming'
        } else if (inPlay) {
          status = 'in_play'
        } else {
          status = 'finished'
        }
      }

      const betsCount = betsCountMap.get(eventId) || 0
      
      // Debug: Log if we have liquidity but no bets count
      if ((totalLiquidityMap.get(eventId) ?? 0) > 0 && betsCount === 0) {
      }

      const lastBetAt = lastBetAtMap.get(eventId)

      return {
        id: eventId,
        sport: event.sportName || 'Unknown',
        competition: event.leagueName || 'Unknown',
        name: event.name || 'Unknown',
        startTime: startTime ? startTime.toISOString() : new Date().toISOString(),
        status,
        marketCount: marketCountMap.get(eventId) || 0,
        matchedVolume: matchedVolumeMap.get(eventId) || 0,
        totalLiquidity: totalLiquidityMap.get(eventId) || 0,
        betsCount,
        inPlay,
        updatedAt: event.updatedAt ? new Date(event.updatedAt).toISOString() : new Date().toISOString(),
        lastBetAt: lastBetAt ? lastBetAt.toISOString() : null,
      }
    })
}

// Get event detail with markets
export type EventDetailResult = {
  event: RunningEvent
  markets: Array<{
    id: string
    name: string
    eventId: string
    state: 'open' | 'suspended' | 'void' | 'settled'
    kind: 'exchange' | 'bookmaker' | 'fancy'
    liquidity?: number
    unmatchedOrders?: number
    cutoffAt: string
    tickSize: number
    createdBy: string
    updatedAt: string
    runners?: Array<{ id: string; name: string; sortOrder: number; selectionCode?: string }>
  }>
}

export async function getEventDetail(eventId: string, whitelabelId: string): Promise<EventDetailResult | null> {
  // Global data - no tenant filtering for core event data
  // whitelabelId parameter kept for backward compatibility but not used in core data queries
  const events = await db
    .select({
      id: sportsEventsTable.id,
      name: sportsEventsTable.name,
      startTime: sportsEventsTable.startTime,
      updatedAt: sportsEventsTable.updatedAt,
      sportName: sportsTable.name,
      leagueName: sportsLeaguesTable.name,
      eventCode: sportsEventsTable.eventCode,
    })
    .from(sportsEventsTable)
    .innerJoin(sportsLeaguesTable, eq(sportsEventsTable.leagueId, sportsLeaguesTable.id))
    .innerJoin(sportsTable, eq(sportsLeaguesTable.sportId, sportsTable.id))
    .where(eq(sportsEventsTable.id, eventId))
    .limit(1)

  if (events.length === 0) {
    return null
  }

  const event = events[0]
  const now = new Date()
  const startTime = event.startTime ? new Date(event.startTime) : null
  
  // Properly determine inPlay: event must have started AND not finished
  // Consider event finished if startTime was more than 24 hours ago
  let inPlay = false
  if (startTime) {
    const timeDiff = now.getTime() - startTime.getTime()
    const hoursSinceStart = timeDiff / (1000 * 60 * 60)
    // Event is in play if it started and hasn't been more than 24 hours
    inPlay = timeDiff >= 0 && hoursSinceStart < 24
  }
  
  // Determine status based on time and market state
  let status: 'upcoming' | 'in_play' | 'finished' | 'suspended' = 'upcoming'
  if (startTime) {
    if (now < startTime) {
      status = 'upcoming'
    } else if (inPlay) {
      status = 'in_play'
    } else {
      status = 'finished'
    }
  }

  // Get market count (global data - no tenant filtering)
  const marketCountResult = await db
    .select({ count: count() })
    .from(sportsMarketsTable)
    .where(
      and(
        eq(sportsMarketsTable.eventId, eventId),
        eq(sportsMarketsTable.status, 'active')
      )
    )

  const marketCount = Number(marketCountResult[0]?.count || 0)

  // Get matched volume
  const matchedVolumeResult = await db
    .select({ volume: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)` })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.whitelabelId, whitelabelId),
        eq(sportsBets.status, 'matched'),
        eq(sportsBets.excludeFromAdminRunning, false)
      )
    )

  const matchedVolume = Number(matchedVolumeResult[0]?.volume || 0)

  // Get total exposure (liability only, NOT stake + liability which would double-count)
  const totalLiquidityResult = await db
    .select({ liquidity: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)` })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.whitelabelId, whitelabelId),
        or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
        eq(sportsBets.excludeFromAdminRunning, false)
      )
    )

  const totalLiquidity = Number(totalLiquidityResult[0]?.liquidity || 0)

  // Get bets count for this event
  const betsCountResult = await db
    .select({ count: count() })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.whitelabelId, whitelabelId),
        or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
        eq(sportsBets.excludeFromAdminRunning, false)
      )
    )

  const betsCount = Number(betsCountResult[0]?.count || 0)

  const eventDetail: RunningEvent = {
    id: String(event.id),
    sport: event.sportName || 'Unknown',
    competition: event.leagueName || 'Unknown',
    name: event.name || 'Unknown',
    startTime: startTime ? startTime.toISOString() : new Date().toISOString(),
    status,
    marketCount,
    matchedVolume,
    totalLiquidity,
    betsCount,
    inPlay,
    updatedAt: event.updatedAt ? new Date(event.updatedAt).toISOString() : new Date().toISOString(),
    eventCode: event.eventCode || null,
  }

  // Get markets for this event (global data - no tenant filtering)
  const markets = await db
    .select({
      id: sportsMarketsTable.id,
      name: sportsMarketsTable.name,
      eventId: sportsMarketsTable.eventId,
      type: sportsMarketsTable.type,
      status: sportsMarketsTable.status,
      updatedAt: sportsMarketsTable.updatedAt,
      marketCode: sportsMarketsTable.marketCode,
    })
    .from(sportsMarketsTable)
    .where(eq(sportsMarketsTable.eventId, eventId))

  // Get runners for each market
  const marketIds = markets.map(m => String(m.id))
  const runners = marketIds.length > 0 ? await db
    .select({
      id: sportsRunnersTable.id,
      name: sportsRunnersTable.name,
      marketId: sportsRunnersTable.marketId,
      sort: sportsRunnersTable.sort,
      selectionCode: sportsRunnersTable.selectionCode,
    })
    .from(sportsRunnersTable)
    .where(inArray(sportsRunnersTable.marketId, marketIds)) : []

  const runnersByMarket = new Map<string, Array<{ id: string; name: string; sortOrder: number; selectionCode?: string }>>()
  runners.forEach(r => {
    const marketId = String(r.marketId)
    if (!runnersByMarket.has(marketId)) {
      runnersByMarket.set(marketId, [])
    }
    runnersByMarket.get(marketId)!.push({
      id: String(r.id),
      name: r.name || 'Unknown',
      sortOrder: Number(r.sort || 999),
      selectionCode: r.selectionCode ? String(r.selectionCode) : undefined,
    })
  })

  // Map markets to Market format
  const mappedMarkets = markets.map(m => {
    const marketId = String(m.id)
    // Determine market kind from type (this is a simplification - you may need to adjust based on your actual type values)
    const kind: 'exchange' | 'bookmaker' | 'fancy' = 
      m.type?.includes('fancy') ? 'fancy' :
      m.type?.includes('bookmaker') ? 'bookmaker' : 'exchange'
    
    // Determine state from status
    const state: 'open' | 'suspended' | 'void' | 'settled' = 
      m.status === 'active' ? 'open' :
      m.status === 'inactive' ? 'suspended' : 'open'

    return {
      id: marketId,
      name: m.name || 'Unknown',
      eventId: String(m.eventId),
      state,
      kind,
      liquidity: 0, // Would need to calculate from bets if needed
      unmatchedOrders: 0, // Would need to count unmatched bets
      cutoffAt: startTime ? startTime.toISOString() : new Date().toISOString(),
      tickSize: 0.01, // Default tick size
      createdBy: 'system',
      updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : new Date().toISOString(),
      runners: runnersByMarket.get(marketId) || [],
      marketCode: m.marketCode || null, // Market code for WebSocket subscription
    }
  })

  return {
    event: eventDetail,
    markets: mappedMarkets,
  }
}


export async function listAutoRunsPage(whitelabelId: string, sportId: string, limit = 20, offset = 0) {
  const where = and(eq(sportsAutoRunsTable.whitelabelId, whitelabelId), eq(sportsAutoRunsTable.sportId, sportId));
  const [totals] = await db.select({ total: sql<number>`count(*)::int` }).from(sportsAutoRunsTable).where(where);
  const items = await db.select().from(sportsAutoRunsTable).where(where)
    .orderBy(desc(sportsAutoRunsTable.startedAt), desc(sportsAutoRunsTable.id))
    .limit(Math.min(100, Math.max(1, limit))).offset(Math.max(0, offset));
  return { items, total: totals.total };
}
