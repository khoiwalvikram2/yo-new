import { CurrencyCode } from '@src/types/currency.js'

export type Limit = { id: string; scope: 'provider'|'category'|'game'; scopeId: string; maxStake: number; maxPayout: number; currency: CurrencyCode; updatedAt: string }

const byId = new Map<string, Limit>()

export function listLimits(scope?: string): Limit[] {
  const arr = Array.from(byId.values())
  return scope ? arr.filter(l => l.scope === scope) : arr
}

export function upsertLimit(limit: Omit<Limit, 'id'|'updatedAt'> & { id?: string }): Limit {
  const id = limit.id ?? `${limit.scope}:${limit.scopeId}`
  const next: Limit = { id, scope: limit.scope, scopeId: limit.scopeId, maxStake: limit.maxStake, maxPayout: limit.maxPayout, currency: limit.currency, updatedAt: new Date().toISOString() }
  byId.set(id, next)
  return next
}

export function seedLimits() {
  upsertLimit({ scope: 'provider', scopeId: 'ProviderA', maxStake: 2000, maxPayout: 20000, currency: 'INR' })
  upsertLimit({ scope: 'category', scopeId: 'cat-slots', maxStake: 1500, maxPayout: 15000, currency: 'INR' })
}
