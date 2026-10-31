export type Game = {
  id: string
  name: string
  provider: string
  categories: string[]
  jurisdictions: string[]
  enabled: boolean
  version: string
  rolloutPercent: number
  featureFlags: string[]
  errors24h?: number
  depositBonusAllow: boolean
}

export type GameParams = { provider?: string; category?: string; enabled?: boolean; whitelabelId?: string }

type CacheEntry<T> = { data: T; expiresAt: number }
const cache: Map<string, CacheEntry<Game[]>> = new Map()
const TTL_MS = 5_000

function key(params: GameParams) { return JSON.stringify(params || {}) }

export async function fetchGames(params: GameParams): Promise<Game[]> {
  const k = key(params)
  const now = Date.now()
  const c = cache.get(k)
  if (c && c.expiresAt > now) return c.data

  // TODO: Replace with real third-party API calls
  const demo: Game[] = [
    { id: 'g-100', name: 'Mega Slots', provider: 'ProviderA', categories: ['slots'], jurisdictions: ['UK','IN'], enabled: true, version: '1.2.3', rolloutPercent: 25, featureFlags: ['ab-test'], errors24h: 2, depositBonusAllow: true },
    { id: 'g-101', name: 'Roulette Pro', provider: 'ProviderB', categories: ['table'], jurisdictions: ['IN'], enabled: false, version: '2.0.1', rolloutPercent: 0, featureFlags: [], errors24h: 0, depositBonusAllow: false },
    { id: 'g-102', name: 'Blackjack Elite', provider: 'ProviderA', categories: ['table'], jurisdictions: ['UK'], enabled: true, version: '1.0.0', rolloutPercent: 60, featureFlags: [], errors24h: 5, depositBonusAllow: false },
  ]

  const filtered = demo.filter(g => (
    (!params.provider || g.provider.toLowerCase().includes(params.provider.toLowerCase())) &&
    (!params.category || g.categories.some(c => c.toLowerCase().includes(params.category!.toLowerCase()))) &&
    (params.enabled == null || g.enabled === params.enabled)
  ))

  cache.set(k, { data: filtered, expiresAt: now + TTL_MS })
  return filtered
}

