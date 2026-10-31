import { fetchGames, type Game } from '@src/adapters/casinoApi.js'

export type RTPPoint = { at: string; value: number; gameId?: string }
export type Incident = { id: string; gameId: string; level: 'info'|'warn'|'error'; message: string; occurredAt: string }

export interface CasinoAdapter {
  id: string
  name: string
  fetchGames: (params: { provider?: string; category?: string; enabled?: boolean }) => Promise<Game[]>
  fetchRTP: (params: { provider?: string; range?: string; gameId?: string }) => Promise<RTPPoint[]>
  fetchIncidents: (params: { provider?: string; from?: string; to?: string; level?: string }) => Promise<Incident[]>
}

function randomSeries(days: number, startValue = 96): RTPPoint[] {
  const out: RTPPoint[] = []
  const start = Date.now() - days * 24 * 3600 * 1000
  let v = startValue
  for (let i = 0; i < days; i++) {
    v += (Math.random() - 0.5) * 0.8
    out.push({ at: new Date(start + i * 24 * 3600 * 1000).toISOString(), value: Math.max(80, Math.min(99.9, v)) })
  }
  return out
}

const providerA: CasinoAdapter = {
  id: 'ProviderA',
  name: 'ProviderA',
  fetchGames: (params) => fetchGames({ ...params, provider: 'ProviderA' }),
  fetchRTP: async (_params) => randomSeries(14, 96.2),
  fetchIncidents: async (_params) => [
    { id: 'ia-1', gameId: 'g-100', level: 'warn', message: 'Spike in errors', occurredAt: new Date().toISOString() },
  ],
}

const providerB: CasinoAdapter = {
  id: 'ProviderB',
  name: 'ProviderB',
  fetchGames: (params) => fetchGames({ ...params, provider: 'ProviderB' }),
  fetchRTP: async (_params) => randomSeries(14, 97.1),
  fetchIncidents: async (_params) => [
    { id: 'ib-1', gameId: 'g-101', level: 'info', message: 'Scheduled maintenance', occurredAt: new Date().toISOString() },
  ],
}

const adapters: CasinoAdapter[] = [providerA, providerB]

export function getAdapters(provider?: string): CasinoAdapter[] {
  if (!provider) return adapters
  return adapters.filter(a => a.id.toLowerCase() === provider.toLowerCase() || a.name.toLowerCase() === provider.toLowerCase())
}

export async function aggregateRTP(params: { provider?: string; range?: string; gameId?: string }): Promise<RTPPoint[]> {
  const ads = getAdapters(params.provider)
  const results = await Promise.all(ads.map(a => a.fetchRTP(params)))
  // naive merge: choose first adapter series for now
  return results[0] ?? []
}

export async function aggregateIncidents(params: { provider?: string; from?: string; to?: string; level?: string }): Promise<Incident[]> {
  const ads = getAdapters(params.provider)
  const results = await Promise.all(ads.map(a => a.fetchIncidents(params)))
  return results.flat()
}

