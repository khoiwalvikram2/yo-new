import { CurrencyCode } from '@src/types/currency.js'

export type BonusCampaign = { id: string; name: string; status: 'draft'|'active'|'paused'|'ended'; rules: any; budget: number; currency: CurrencyCode }

const byId = new Map<string, BonusCampaign>()

export function seedBonuses() {
  if (byId.size) return
  byId.set('bonus-1', { id: 'bonus-1', name: 'Deposit 100 get 50', status: 'active', rules: { minDeposit: 100, bonus: 50 }, budget: 100000, currency: 'INR' })
}

export function listBonusCampaigns(): BonusCampaign[] { return Array.from(byId.values()) }
export function createBonusCampaign(name: string): BonusCampaign { const id = `bonus-${Math.random().toString(36).slice(2,8)}`; const b: BonusCampaign = { id, name, status: 'draft', rules: {}, budget: 0, currency: 'INR' }; byId.set(id, b); return b }
