import { getSportsLiveDashboard as getSportsLiveDashboardFromRepo } from '@src/repos/sports/sportsAnalyticsRepo.js'
import { QueryCache } from '@src/services/QueryCache.js'

export interface SportsLiveScope {
  tenant?: string
  whitelabelId?: string
  agentId?: string
}

export interface SportsLiveKpis {
  at: string
  totalStake: number
  totalLiability: number
  netExposure: number
  grossExposure: number
  activeMarkets: number
  activePlayers: number
  betsPerMin: number
  avgOdds: number
  backBets: number
  layBets: number
}

export interface SportsSportStat {
  sportId: string
  sportName?: string | null
  totalStake: number
  totalLiability: number
  netExposure: number
  bets: number
}

export interface SportsLeagueStat {
  leagueId: string
  leagueName?: string | null
  totalStake: number
  totalLiability: number
  netExposure: number
  bets: number
}

export interface SportsEventStat {
  eventId: string
  eventName?: string | null
  totalStake: number
  totalLiability: number
  netExposure: number
  bets: number
}

export interface SportsMarketTypeStat {
  marketType: 'exchange' | 'bookmaker' | 'fancy'
  totalStake: number
  totalLiability: number
  netExposure: number
  bets: number
}

export interface SportsBetSideStat {
  side: 'back' | 'lay'
  totalStake: number
  totalLiability: number
  bets: number
}

export interface SportsLiveBreakdown {
  bySport: SportsSportStat[]
  byLeague: SportsLeagueStat[]
  byEvent: SportsEventStat[]
  byMarketType: SportsMarketTypeStat[]
  byBetSide: SportsBetSideStat[]
}

export interface SportsLiveDashboard {
  kpis: SportsLiveKpis
  breakdown: SportsLiveBreakdown
}

function getScopeKey(scope: SportsLiveScope): string {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  return JSON.stringify([tenant, wl, scope.agentId || null])
}

const lastSnapshots = new Map<string, SportsLiveDashboard>()
const pendingSnapshots = new Map<string, Promise<SportsLiveDashboard>>()

// Invalidate cache helper
export async function invalidateDashboardCache(scope: SportsLiveScope): Promise<void> {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  const pattern = scope.agentId 
    ? `sports:live:${tenant}:${wl}:agent:${scope.agentId}`
    : `sports:live:${tenant}:${wl}*`
  await QueryCache.invalidatePattern(pattern)
}

export async function computeDashboard(scope: SportsLiveScope): Promise<SportsLiveDashboard> {
  const scopeKey = getScopeKey(scope)
  const pending = pendingSnapshots.get(scopeKey)
  if (pending) return pending
  const read = readDashboard(scope)
  pendingSnapshots.set(scopeKey, read)
  try {
    return await read
  } finally {
    if (pendingSnapshots.get(scopeKey) === read) pendingSnapshots.delete(scopeKey)
  }
}

/** Coalesce concurrent streams only while their shared computation is in flight. */
async function readDashboard(scope: SportsLiveScope): Promise<SportsLiveDashboard> {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  
  // Build cache key including agent context
  const cacheKey = scope.agentId 
    ? `sports:live:${tenant}:${wl}:agent:${scope.agentId}`
    : `sports:live:${tenant}:${wl}`
  
  // Check Redis cache (5 second TTL)
  const cached = await QueryCache.getLive<SportsLiveDashboard>(cacheKey)
  if (cached) {
    return cached
  }
  
  // Query with agent filtering using SQL aggregation
  const snapshot = await getSportsLiveDashboardFromRepo({
    tenant,
    whitelabelId: wl,
    agentId: scope.agentId,
  })
  
  // Cache dashboard result for 5 seconds
  await QueryCache.setLive(cacheKey, snapshot)
  
  // Also update in-memory cache for backward compatibility
  lastSnapshots.set(getScopeKey(scope), snapshot)
  
  return snapshot
}

export function getLastSnapshot(scope: SportsLiveScope): SportsLiveDashboard | null {
  return lastSnapshots.get(getScopeKey(scope)) || null
}

export function clearSnapshot(scope: SportsLiveScope): void {
  lastSnapshots.delete(getScopeKey(scope))
}

