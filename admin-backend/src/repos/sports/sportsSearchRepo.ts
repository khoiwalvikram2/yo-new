import { db } from '@src/db/client.js'
import { sportsTable } from '@shared/db/schema.js'
import { sportsLeaguesTable, sportsEventsTable } from '@shared/db/schema.js'
import { ilike, eq, and, inArray } from 'drizzle-orm'

export interface SportsSearchResult {
  type: 'sport' | 'league' | 'event'
  sportId: string
  sportName: string
  leagueId?: string
  leagueName?: string
  eventId?: string
  eventName?: string
}

export async function searchSportsHierarchy(
  query: string,
  whitelabelId: string, // Kept for backward compatibility but not used
  limit: number = 50
): Promise<SportsSearchResult[]> {
  // Global data - no tenant filtering
  const results: SportsSearchResult[] = []
  const searchPattern = `%${query}%`

  // Search sports
  const sports = await db
    .select({
      id: sportsTable.id,
      name: sportsTable.name,
    })
    .from(sportsTable)
    .where(ilike(sportsTable.name, searchPattern))
    .limit(limit)

  sports.forEach((sport) => {
    results.push({
      type: 'sport',
      sportId: sport.id,
      sportName: sport.name,
    })
  })

  // Search leagues (global data - no tenant filtering)
  const leagues = await db
    .select({
      leagueId: sportsLeaguesTable.id,
      leagueName: sportsLeaguesTable.name,
      sportId: sportsLeaguesTable.sportId,
    })
    .from(sportsLeaguesTable)
    .where(ilike(sportsLeaguesTable.name, searchPattern))
    .limit(limit)

  // Get sport names for leagues
  const sportIds = [...new Set(leagues.map((l) => l.sportId))]
  const sportsMap = new Map()
  
  if (sportIds.length > 0) {
    const sportsForLeagues = await db
      .select({
        id: sportsTable.id,
        name: sportsTable.name,
      })
      .from(sportsTable)
      .where(inArray(sportsTable.id, sportIds))

    sportsForLeagues.forEach((s) => sportsMap.set(s.id, s.name))
  }

  leagues.forEach((league) => {
    results.push({
      type: 'league',
      sportId: league.sportId!,
      sportName: sportsMap.get(league.sportId) || 'Unknown Sport',
      leagueId: league.leagueId,
      leagueName: league.leagueName,
    })
  })

  // Search events (global data - no tenant filtering)
  const events = await db
    .select({
      eventId: sportsEventsTable.id,
      eventName: sportsEventsTable.name,
      leagueId: sportsEventsTable.leagueId,
    })
    .from(sportsEventsTable)
    .where(ilike(sportsEventsTable.name, searchPattern))
    .limit(limit)

  // Get league and sport info for events
  const leagueIds = [...new Set(events.map((e) => e.leagueId))]
  const leaguesMap = new Map()

  if (leagueIds.length > 0) {
    const leaguesForEvents = await db
      .select({
        id: sportsLeaguesTable.id,
        name: sportsLeaguesTable.name,
        sportId: sportsLeaguesTable.sportId,
      })
      .from(sportsLeaguesTable)
      .where(inArray(sportsLeaguesTable.id, leagueIds))

    leaguesForEvents.forEach((l) => {
      leaguesMap.set(l.id, { name: l.name, sportId: l.sportId })
    })
  }

  events.forEach((event) => {
    const league = leaguesMap.get(event.leagueId)
    results.push({
      type: 'event',
      sportId: league?.sportId || '',
      sportName: sportsMap.get(league?.sportId) || 'Unknown Sport',
      leagueId: event.leagueId!,
      leagueName: league?.name || 'Unknown League',
      eventId: event.eventId,
      eventName: event.eventName,
    })
  })

  return results.slice(0, limit)
}

