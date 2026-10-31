export type Provider = { id: string; name: string; endpoint: string; tokenMasked: string; health: 'healthy'|'degraded'|'offline'; lastSyncAt: string }

const list: Provider[] = [
  { id: 'prov-a', name: 'ProviderA', endpoint: 'https://api.provider-a.example', tokenMasked: 'sk_live_****abcd', health: 'healthy', lastSyncAt: new Date().toISOString() },
  { id: 'prov-b', name: 'ProviderB', endpoint: 'https://api.provider-b.example', tokenMasked: 'sk_live_****wxyz', health: 'degraded', lastSyncAt: new Date().toISOString() },
]

export function listProviders(_whitelabelId?: string): Provider[] { return list }
