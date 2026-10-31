import { CurrencyCode } from '@src/types/currency.js'

export type Jackpot = {
  id: string
  name: string
  tiers: { name: string; threshold: number }[]
  pot: number
  currency: CurrencyCode
  status: 'active'|'paused'
  updatedAt: string
}

const byId = new Map<string, Jackpot>()

function now() { return new Date().toISOString() }

export function seedJackpots() {
  if (byId.size) return
  byId.set('jp-1', { id: 'jp-1', name: 'Daily Mega', tiers: [{ name: 'Tier 1', threshold: 1000 }, { name: 'Tier 2', threshold: 5000 }], pot: 12000, currency: 'INR', status: 'active', updatedAt: now() })
  byId.set('jp-2', { id: 'jp-2', name: 'Weekend Super', tiers: [{ name: 'Tier 1', threshold: 5000 }], pot: 35000, currency: 'INR', status: 'active', updatedAt: now() })
}

export function listJackpots(): Jackpot[] { return Array.from(byId.values()) }

export function setPaused(id: string, pause: boolean): Jackpot {
  const jp = byId.get(id)
  if (!jp) throw new Error('Jackpot not found')
  jp.status = pause ? 'paused' : 'active'
  jp.updatedAt = now()
  byId.set(id, jp)
  return jp
}

export function payout(id: string, amount?: number): Jackpot {
  const jp = byId.get(id)
  if (!jp) throw new Error('Jackpot not found')
  const pay = amount == null ? jp.pot : Math.min(amount, jp.pot)
  jp.pot = Math.max(0, jp.pot - pay)
  jp.updatedAt = now()
  byId.set(id, jp)
  return jp
}

export function incrementPot(id: string, delta: number) {
  const jp = byId.get(id)
  if (!jp) return
  if (jp.status === 'paused') return
  jp.pot += delta
  jp.updatedAt = now()
  byId.set(id, jp)
}
