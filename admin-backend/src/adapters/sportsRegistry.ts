import { fetchProviderSports, ProviderSport } from '@src/adapters/sportsApi.js'

export interface SportsAdapter {
  id: string
  name: string
  listSports: (params: { whitelabelId: string }) => Promise<ProviderSport[]>
  listLeagues: (params: { sportCode: string }) => Promise<any[]>
  listEvents: (params: { leagueId: string }) => Promise<any[]>
  listMarkets: (params: { eventId: string }) => Promise<any[]>
}

const PROVIDER_URL = process.env.SPORTS_API_URL || 'http://174.138.121.69/get-sports'

const adapterOne: SportsAdapter = {
  id: 'SportsProviderA',
  name: 'SportsProviderA',
  listSports: async (_params) => fetchProviderSports(PROVIDER_URL),
  listLeagues: async (params) => {
    const base = process.env.SPORTS_API_BASE_URL || 'http://174.138.121.69'
    const path = process.env.SPORTS_API_LEAGUES_PATH || '/get-leagues'
    const url = `${base}${path}?sport_id=${encodeURIComponent(params.sportCode)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch leagues: ${res.status}`)
    return await res.json()
  },
  listEvents: async (_params) => {
    const base = process.env.SPORTS_API_BASE_URL || 'http://174.138.121.69'
    const path = process.env.SPORTS_API_EVENTS_PATH || '/get-events'
    const url = `${base}${path}?league_id=${encodeURIComponent(_params.leagueId)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`)
    return await res.json()
  },
  listMarkets: async (params) => {
    const base = process.env.SPORTS_API_BASE_URL || 'http://174.138.121.69'
    const path = process.env.SPORTS_API_MARKETS_PATH || '/get-markets'
    const url = `${base}${path}?event_id=${encodeURIComponent(params.eventId)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch markets: ${res.status}`)
    return await res.json()
  },
}

const adapters: SportsAdapter[] = [adapterOne]

export function getSportsAdapters(provider?: string): SportsAdapter[] {
  if (!provider) return adapters
  return adapters.filter(a => a.id === provider || a.name.toLowerCase() === provider.toLowerCase())
}

