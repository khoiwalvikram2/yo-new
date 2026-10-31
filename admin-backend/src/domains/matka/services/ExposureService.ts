import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { matkaBets } from '@shared/db/schema.js'
import { inAgentPlayers } from '@src/repos/reporting/agentPlayerScope.js'

export interface LiveScope {
  tenant?: string
  whitelabelId?: string
  /**
   * Agent caller: only the open bets of the agent's players (subtree + referral,
   * repos/reporting/agentPlayerScope.ts). Without it the book is tenant-wide,
   * which is what every agent used to receive.
   */
  agentId?: string
}

export interface MatkaExposureSelection {
  marketName: string
  marketSession: string | null
  bidType: string
  selectionKey: string
  bets: number
  totalStake: number
  potentialPayout: number
  exposure: number
}

export interface MatkaMarketExposure {
  marketName: string
  marketSession: string | null
  bets: number
  totalStake: number
  potentialPayout: number
  exposure: number
  selections: MatkaExposureSelection[]
}

export interface MatkaExposureBook {
  at: string
  markets: MatkaMarketExposure[]
}

function getScopeKey(scope: LiveScope): string {
  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'
  // The agent is part of the key: an agent's book must never be served from,
  // or into, the whitelabel's cache entry.
  return scope.agentId ? `${tenant}:${wl}:exposure:open:agent:${scope.agentId}` : `${tenant}:${wl}:exposure:open`
}

const computationCache = new Map<string, { snapshot: MatkaExposureBook; timestamp: number }>()
const CACHE_TTL_MS = 2000

export async function computeExposureBook(scope: LiveScope): Promise<MatkaExposureBook> {
  const cacheKey = getScopeKey(scope)
  const cached = computationCache.get(cacheKey)
  const nowNum = Date.now()
  if (cached && (nowNum - cached.timestamp) < CACHE_TTL_MS) {
    return cached.snapshot
  }

  const tenant = scope.tenant || 'default'
  const wl = scope.whitelabelId || 'default'

  // Fetch open bets
  const bets = await db.select().from(matkaBets)
    .where(and(
      eq(matkaBets.tenant, tenant),
      eq(matkaBets.whitelabelId, wl),
      inArray(matkaBets.status, ['pending', 'active'] as any),
      scope.agentId ? inAgentPlayers(matkaBets.userId, scope.agentId, tenant) : undefined,
    ))
    .orderBy(desc(matkaBets.createdAt))
    .limit(20_000)

  // Group by market -> selection
  const marketMap = new Map<string, MatkaMarketExposure>()
  const marketKeyOf = (marketName: string | null | undefined, session: string | null | undefined) =>
    `${marketName || 'unknown'}::${session || ''}`

  for (const betAny of bets as any[]) {
    const marketName: string = betAny.marketName || 'unknown'
    const marketSession: string | null = betAny.marketSession || null
    const bidType: string = betAny.bidType || 'unknown'
    const betNumbers: string = betAny.betNumbers || ''
    const selectionKey = `${bidType}:${betNumbers}`
    const betAmount = Number(betAny.betAmount || 0)
    const multiplier = Number(betAny.payoutMultiplier || 0)
    const potentialWin = betAny.potentialWin != null ? Number(betAny.potentialWin) : (multiplier > 0 ? betAmount * multiplier : 0)

    const mkey = marketKeyOf(marketName, marketSession)
    let market = marketMap.get(mkey)
    if (!market) {
      market = {
        marketName,
        marketSession,
        bets: 0,
        totalStake: 0,
        potentialPayout: 0,
        exposure: 0,
        selections: [],
      }
      marketMap.set(mkey, market)
    }

    // Selection within market
    let selection = market.selections.find(s => s.selectionKey === selectionKey)
    if (!selection) {
      selection = {
        marketName,
        marketSession,
        bidType,
        selectionKey,
        bets: 0,
        totalStake: 0,
        potentialPayout: 0,
        exposure: 0,
      }
      market.selections.push(selection)
    }

    selection.bets += 1
    selection.totalStake += betAmount
    selection.potentialPayout += potentialWin
    selection.exposure = selection.potentialPayout - selection.totalStake

    market.bets += 1
    market.totalStake += betAmount
    market.potentialPayout += potentialWin
    market.exposure = market.potentialPayout - market.totalStake
  }

  // Sort selections and markets
  for (const market of marketMap.values()) {
    market.selections.sort((a, b) => b.exposure - a.exposure)
    market.selections = market.selections.slice(0, 200)
  }
  const markets = Array.from(marketMap.values()).sort((a, b) => b.exposure - a.exposure).slice(0, 200)

  const snapshot: MatkaExposureBook = {
    at: new Date().toISOString(),
    markets,
  }

  computationCache.set(cacheKey, { snapshot, timestamp: nowNum })
  return snapshot
}

