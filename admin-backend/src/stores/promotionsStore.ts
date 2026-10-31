export type Promotion = {
  id: string
  name: string
  status: 'draft'|'active'|'paused'|'ended'
  targetingRules: any
  schedule: { start: string, end: string }
  updatedAt: string
}

const byId = new Map<string, Promotion>()

function now() { return new Date().toISOString() }

export function seedPromotions() {
  if (byId.size) return
  const p: Promotion = {
    id: 'promo-1',
    name: 'Welcome Bonus',
    status: 'active',
    targetingRules: { segment: 'new' },
    schedule: { start: now(), end: new Date(Date.now() + 7*24*3600*1000).toISOString() },
    updatedAt: now(),
  }
  byId.set(p.id, p)
}

export function listPromotions(_whitelabelId?: string): Promotion[] { return Array.from(byId.values()) }

export function createPromotion(draft: { name: string, targetingRules?: any, schedule?: { start?: string, end?: string } }): Promotion {
  const id = `promo-${Math.random().toString(36).slice(2,8)}`
  const p: Promotion = {
    id,
    name: draft.name,
    status: 'draft',
    targetingRules: draft.targetingRules ?? {},
    schedule: { start: draft.schedule?.start ?? now(), end: draft.schedule?.end ?? new Date(Date.now()+7*24*3600*1000).toISOString() },
    updatedAt: now(),
  }
  byId.set(id, p)
  return p
}

export function publishPromotion(id: string): Promotion {
  const p = byId.get(id)
  if (!p) throw new Error('Promotion not found')
  p.status = 'active'
  p.updatedAt = now()
  byId.set(id, p)
  return p
}

export function pausePromotion(id: string): Promotion {
  const p = byId.get(id)
  if (!p) throw new Error('Promotion not found')
  p.status = 'paused'
  p.updatedAt = now()
  byId.set(id, p)
  return p
}
