import { getMatkaLiveDashboard as getMatkaLiveDashboardFromRepo } from '@src/repos/matka/matkaAnalyticsRepo.js'
import { QueryCache } from '@src/services/QueryCache.js'

export interface LiveScope {
  tenant?: string
  whitelabelId?: string
  windowMins?: number
  agentId?: string
}

export interface MatkaLiveKpis {
  at: string
  betsPerMin: number
  wagered: number
  payouts: number
  ggr: number
  rtp: number
  activePlayers: number
}

export interface MatkaTypeStat {
  matkaType: string
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface MatkaMarketStat {
  marketName: string
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface MatkaBidTypeStat {
  bidType: string
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface MatkaEntityStat {
  matkaId: string
  matkaName?: string | null
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface MatkaSessionStat {
  marketSession: string | null
  wagered: number
  payouts: number
  ggr: number
  bets: number
}

export interface MatkaDigitStat {
  digit: string
  wagered: number
  payouts: number
  exposure: number
  bets: number
}

export interface MatkaSelectionStat {
  selection: string // selectionKey or betNumbers + bidType
  matkaId: string
  matkaName?: string | null
  marketName: string
  marketSession: string | null
  bidType: string
  wagered: number
  payouts: number
  exposure: number
  bets: number
}

export interface MatkaLiveBreakdown {
  byType: MatkaTypeStat[]
  byMarket: MatkaMarketStat[]
  byBidType: MatkaBidTypeStat[]
  byMatka: MatkaEntityStat[]
  bySession: MatkaSessionStat[]
  byDigit: MatkaDigitStat[]
  bySelection: MatkaSelectionStat[]
}

export interface MatkaLiveDashboard {
  kpis: MatkaLiveKpis
  breakdown: MatkaLiveBreakdown
}

function getScopeKey(scope: LiveScope): string {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  // For open bets, we don't use windowMins in cache key since we filter by status
  return JSON.stringify([tenant, wl, scope.agentId || null])
}

const lastSnapshots = new Map<string, MatkaLiveDashboard>()
const pendingSnapshots = new Map<string, Promise<MatkaLiveDashboard>>()

export async function computeDashboard(scope: LiveScope): Promise<MatkaLiveDashboard> {
  const key = getScopeKey(scope)
  const pending = pendingSnapshots.get(key)
  if (pending) return pending
  const read = readDashboard(scope)
  pendingSnapshots.set(key, read)
  try { return await read }
  finally { if (pendingSnapshots.get(key) === read) pendingSnapshots.delete(key) }
}

/** Share only reads currently in flight; retain the existing Redis cache and error fallback. */
async function readDashboard(scope: LiveScope): Promise<MatkaLiveDashboard> {
  try {
    const tenant = scope.tenant || 'default'
    const wl = scope.whitelabelId || 'default'
    
    // Build cache key including agent context
    const cacheKey = scope.agentId 
      ? `matka:live:${tenant}:${wl}:agent:${scope.agentId}`
      : `matka:live:${tenant}:${wl}`
    
    // Check Redis cache (5 second TTL)
    const cached = await QueryCache.getLive<MatkaLiveDashboard>(cacheKey)
    if (cached) {
      return cached
    }
    
    // Query with agent filtering using SQL aggregation
    const snapshot = await getMatkaLiveDashboardFromRepo({
      tenant,
      whitelabelId: wl,
      agentId: scope.agentId,
    })
    
    // Cache dashboard result for 5 seconds
    await QueryCache.setLive(cacheKey, snapshot)
    
    // Also update in-memory cache for backward compatibility
    const scopeKey = getScopeKey(scope)
    lastSnapshots.set(scopeKey, snapshot)
    
    return snapshot
  } catch (error: any) {
    // Return empty dashboard on error
    const now = new Date()
    return {
      kpis: {
        at: now.toISOString(),
        betsPerMin: 0,
        wagered: 0,
        payouts: 0,
        ggr: 0,
        rtp: 0,
        activePlayers: 0,
      },
      breakdown: {
        byType: [],
        byMarket: [],
        byBidType: [],
        byMatka: [],
        bySession: [],
        byDigit: [],
        bySelection: [],
      },
    }
  }
}

// Invalidate cache helper
export async function invalidateDashboardCache(scope: LiveScope): Promise<void> {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  const pattern = scope.agentId 
    ? `matka:live:${tenant}:${wl}:agent:${scope.agentId}`
    : `matka:live:${tenant}:${wl}*`
  await QueryCache.invalidatePattern(pattern)
}

export function getLastSnapshot(scope: LiveScope): MatkaLiveDashboard | null {
  return lastSnapshots.get(getScopeKey(scope)) || null
}

export function clearSnapshot(scope: LiveScope): void {
  lastSnapshots.delete(getScopeKey(scope))
}

