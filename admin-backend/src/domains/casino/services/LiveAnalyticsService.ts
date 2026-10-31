import { getCasinoLiveDashboard as getCasinoLiveDashboardFromRepo } from '@src/repos/casino/casinoAnalyticsRepo.js'
import { QueryCache } from '@src/services/QueryCache.js'

export interface LiveScope {
  tenant?: string
  whitelabelId?: string
  windowMins?: number
  agentId?: string
}

export interface CasinoLiveKpis {
  at: string
  betsPerMin: number
  wagered: number
  payouts: number
  ggr: number
  rtp: number
  activePlayers: number
}

export interface CasinoGameStat {
  gameId: string
  gameName?: string | null
  thumbnailUrl?: string | null
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface CasinoProviderStat {
  providerId: string
  providerName?: string | null
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface CasinoVendorStat {
  vendorId: string
  vendorName?: string | null
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface CasinoLiveBreakdown {
  byGame: CasinoGameStat[]
  byProvider: CasinoProviderStat[]
  byVendor: CasinoVendorStat[]
}

export interface CasinoLiveDashboard {
  kpis: CasinoLiveKpis
  breakdown: CasinoLiveBreakdown
}

function getScopeKey(scope: LiveScope): string {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  const mins = scope.windowMins ?? 5
  return JSON.stringify([tenant, wl, mins, scope.agentId || null])
}

const lastSnapshots = new Map<string, CasinoLiveDashboard>()
const pendingSnapshots = new Map<string, Promise<CasinoLiveDashboard>>()

export async function computeDashboard(scope: LiveScope): Promise<CasinoLiveDashboard> {
  const key = getScopeKey(scope)
  const pending = pendingSnapshots.get(key)
  if (pending) return pending
  const read = readDashboard(scope)
  pendingSnapshots.set(key, read)
  try { return await read }
  finally { if (pendingSnapshots.get(key) === read) pendingSnapshots.delete(key) }
}

/** Share only computations currently in flight; existing Redis expiry remains unchanged. */
async function readDashboard(scope: LiveScope): Promise<CasinoLiveDashboard> {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  const windowMins = scope.windowMins ?? 5
  
  // Build cache key including agent context
  const cacheKey = scope.agentId 
    ? `casino:live:${tenant}:${wl}:${windowMins}:agent:${scope.agentId}`
    : `casino:live:${tenant}:${wl}:${windowMins}`
  
  // Check Redis cache (5 second TTL)
  const cached = await QueryCache.getLive<CasinoLiveDashboard>(cacheKey)
  if (cached) {
    return cached
  }
  
  // Query with agent filtering using SQL aggregation
  const snapshot = await getCasinoLiveDashboardFromRepo({
    tenant,
    whitelabelId: wl,
    windowMins,
    agentId: scope.agentId,
  })
  
  // Cache dashboard result for 5 seconds
  await QueryCache.setLive(cacheKey, snapshot)
  
  // Also update in-memory cache for backward compatibility
  const scopeKey = getScopeKey(scope)
  lastSnapshots.set(scopeKey, snapshot)
  
  return snapshot
}

// Invalidate cache helper
export async function invalidateDashboardCache(scope: LiveScope): Promise<void> {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  const windowMins = scope.windowMins ?? 5
  const pattern = scope.agentId 
    ? `casino:live:${tenant}:${wl}:${windowMins}:agent:${scope.agentId}`
    : `casino:live:${tenant}:${wl}:${windowMins}*`
  await QueryCache.invalidatePattern(pattern)
}

export function getLastSnapshot(scope: LiveScope): CasinoLiveDashboard | null {
  return lastSnapshots.get(getScopeKey(scope)) || null
}

export function clearSnapshot(scope: LiveScope): void {
  lastSnapshots.delete(getScopeKey(scope))
}

