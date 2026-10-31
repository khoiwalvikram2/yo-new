export type Draw = { id: string; type: 'single'|'double'; openAt: string; cutoffAt: string; timezone: string; status: 'scheduled'|'open'|'closed'|'settled'|'corrected' }
export type RateVersion = { id: string; effectiveFrom: string; rates: Record<string, number>; createdBy: string; status: 'draft'|'review'|'approved'|'published' }
export type Result = { id: string; drawId: string; value: string; enteredBy: string; verifiedBy?: string; enteredAt: string; verifiedAt?: string }
export type SettlementBatch = { id: string; drawId: string; status: 'pending'|'processing'|'completed'|'exception'; createdAt: string }

const draws = new Map<string, Draw>()
const rates = new Map<string, RateVersion>()
const results = new Map<string, Result>()
const settlements = new Map<string, SettlementBatch>()

function now() { return new Date().toISOString() }

export function seedMatka() {
  if (draws.size) return
  const d1: Draw = { id: 'draw-100', type: 'single', openAt: new Date(Date.now()+10*60*1000).toISOString(), cutoffAt: new Date(Date.now()+60*60*1000).toISOString(), timezone: 'Asia/Kolkata', status: 'scheduled' }
  const d2: Draw = { id: 'draw-101', type: 'double', openAt: new Date(Date.now()+2*60*60*1000).toISOString(), cutoffAt: new Date(Date.now()+3*60*60*1000).toISOString(), timezone: 'Asia/Kolkata', status: 'scheduled' }
  ;[d1, d2].forEach(d => draws.set(d.id, d))
  const r1: RateVersion = { id: 'rate-1', effectiveFrom: now(), rates: { panel: 10, ank: 9 }, createdBy: 'sys', status: 'published' }
  rates.set(r1.id, r1)
}

export function listDraws(filter?: { status?: string; from?: string; to?: string }): Draw[] {
  const arr = Array.from(draws.values())
  return arr.filter(d => (
    (!filter?.status || d.status === filter.status) &&
    (!filter?.from || new Date(d.openAt) >= new Date(filter.from)) &&
    (!filter?.to || new Date(d.cutoffAt) <= new Date(filter.to))
  ))
}

export function createDraw(input: { type: 'single'|'double'; openAt: string; cutoffAt: string; timezone: string }): Draw {
  const id = `draw-${Math.random().toString(36).slice(2,8)}`
  const d: Draw = { id, type: input.type, openAt: input.openAt, cutoffAt: input.cutoffAt, timezone: input.timezone, status: 'scheduled' }
  draws.set(id, d)
  return d
}

export function updateDraw(id: string, patch: Partial<Pick<Draw,'openAt'|'cutoffAt'|'status'>>): Draw {
  const d = draws.get(id)
  if (!d) throw new Error('Draw not found')
  Object.assign(d, patch)
  draws.set(id, d)
  return d
}

export function listRateVersions(): RateVersion[] { return Array.from(rates.values()) }
export function getCurrentRates(): RateVersion | undefined {
  const published = Array.from(rates.values()).filter(r => r.status === 'published')
  return published[published.length - 1]
}
export function createRateDraft(baseOnId?: string): RateVersion {
  const base = baseOnId ? rates.get(baseOnId) : getCurrentRates()
  const id = `rate-${Math.random().toString(36).slice(2,8)}`
  const draft: RateVersion = { id, effectiveFrom: now(), rates: { ...(base?.rates ?? {}) }, createdBy: 'admin', status: 'draft' }
  rates.set(id, draft)
  return draft
}
export function submitRatesForReview(id: string): RateVersion {
  const v = rates.get(id); if (!v) throw new Error('Rate not found')
  v.status = 'review'; rates.set(id, v); return v
}
export function publishRates(id: string): RateVersion {
  const v = rates.get(id); if (!v) throw new Error('Rate not found')
  v.status = 'published'; rates.set(id, v); return v
}

export function postResult(drawId: string, value: string, enteredBy: string): Result {
  const id = `res-${Math.random().toString(36).slice(2,8)}`
  const r: Result = { id, drawId, value, enteredBy, enteredAt: now() }
  results.set(id, r)
  return r
}
export function listResults(drawId: string): Result[] { return Array.from(results.values()).filter(r => r.drawId === drawId) }

export function createSettlementBatch(drawId: string, mode: 'auto'|'recalc'): SettlementBatch {
  const id = `set-${Math.random().toString(36).slice(2,8)}`
  const b: SettlementBatch = { id, drawId, status: 'pending', createdAt: now() }
  settlements.set(id, b)
  return b
}
export function listSettlements(drawId: string): SettlementBatch[] { return Array.from(settlements.values()).filter(s => s.drawId === drawId) }
