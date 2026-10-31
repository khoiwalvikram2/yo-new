export type RiskLimit = { id: string; segment?: string; userId?: string; maxStake: number; liabilityCap: number; updatedAt: string }

const byId = new Map<string, RiskLimit>()

export function listRiskLimits(filter: { segment?: string; userId?: string }): RiskLimit[] {
  const arr = Array.from(byId.values())
  return arr.filter(r => (!filter.segment || r.segment === filter.segment) && (!filter.userId || r.userId === filter.userId))
}

export function upsertRiskLimit(limit: Omit<RiskLimit, 'id'|'updatedAt'> & { id?: string }): RiskLimit {
  const id = limit.id ?? [limit.segment ?? 'seg', limit.userId ?? 'any', 'limit'].join(':')
  const existing = byId.get(id)
  const next: RiskLimit = { id, segment: limit.segment, userId: limit.userId, maxStake: limit.maxStake, liabilityCap: limit.liabilityCap, updatedAt: new Date().toISOString() }
  byId.set(id, next)
  return next
}

export function demoSeed() {
  upsertRiskLimit({ segment: 'vip', maxStake: 5000, liabilityCap: 25000 })
  upsertRiskLimit({ segment: 'standard', maxStake: 1000, liabilityCap: 5000 })
}

export function listExposurePoints(filter: { sport?: string; competition?: string }): { dimension: string; value: number }[] {
  // Demo: random exposures by competition
  const base = [
    { dimension: 'Cricket:IPL', value: 120000 },
    { dimension: 'Football:EPL', value: 90000 },
    { dimension: 'Tennis:ATP', value: 30000 },
  ]
  return base.filter(x => (!filter.sport || x.dimension.toLowerCase().startsWith(filter.sport.toLowerCase())) && (!filter.competition || x.dimension.toLowerCase().includes(filter.competition.toLowerCase())))
}
