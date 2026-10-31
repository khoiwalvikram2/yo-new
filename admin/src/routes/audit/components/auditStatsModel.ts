export interface AuditStatistics {
  total: number
  today: number
  uniqueActors: number
  byDomain: { domain: string; count: number }[]
  byAction: { action: string; count: number }[]
  recentEvents: { id: string; domain: string; action: string; timestamp: string }[]
}
export const EMPTY_AUDIT_STATS: AuditStatistics = { total: 0, today: 0, uniqueActors: 0, byDomain: [], byAction: [], recentEvents: [] }

/** Same rolling-hour and local-hour sample buckets as the legacy charts, not full activity totals. */
export function auditSampleBuckets(events: AuditStatistics['recentEvents'], now = new Date()) {
  const timeline = Array.from({ length: 24 }, (_, index) => ({ timestamp: new Date(now.getTime() - (23 - index) * 3600000).toISOString(), count: 0 }))
  const hourly = Array.from({ length: 24 }, (_, index) => ({ hour: `${index}:00`, count: 0 }))
  events.forEach((event) => {
    const date = new Date(event.timestamp)
    if (!Number.isFinite(date.getTime())) return
    const index = 23 - ((now.getTime() - date.getTime()) / 3600000 | 0)
    if (index >= 0 && index < 24) timeline[index].count += 1
    const hour = date.getHours()
    if (hour >= 0 && hour < 24) hourly[hour].count += 1
  })
  return { timeline, hourly }
}

export type AuditChartHue = 'ind' | 'red' | 'grn' | 'vio' | 'blu' | 'amb'
export function auditChartHue(name: string): AuditChartHue {
  const hues: Record<string, AuditChartHue> = {
    sports: 'blu', casino: 'vio', matka: 'amb', players: 'grn', agents: 'blu', payments: 'amb', bonuses: 'vio', users: 'ind', rbac: 'red', 'app-config': 'grn', jackpots: 'red',
    create: 'grn', update: 'blu', delete: 'red', status: 'amb', settings: 'vio', approve: 'grn', reject: 'red', submit: 'blu', pause: 'amb', resume: 'grn', payout: 'amb',
  }
  return hues[name] ?? 'ind'
}
