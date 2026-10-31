export type AuditEvent = { id: string; actorId: string; domain: string; action: string; resourceType: string; resourceId: string; timestamp: string; reason?: string }

const events: AuditEvent[] = []

function now() { return new Date().toISOString() }

export function record(e: Omit<AuditEvent, 'id'|'timestamp'>): AuditEvent {
  const ev: AuditEvent = { id: Math.random().toString(36).slice(2, 10), timestamp: now(), ...e }
  events.unshift(ev)
  return ev
}

export function listAudit(filter: { domain?: string; action?: string; actorId?: string; from?: string; to?: string }): AuditEvent[] {
  return events.filter(ev => (
    (!filter.domain || ev.domain === filter.domain) &&
    (!filter.action || ev.action === filter.action) &&
    (!filter.actorId || ev.actorId === filter.actorId)
  ))
}

export function exportCSV(filter: Parameters<typeof listAudit>[0]): string {
  const rows = listAudit(filter)
  const header = 'id,actorId,domain,action,resourceType,resourceId,timestamp\n'
  const body = rows.map(r => [r.id, r.actorId, r.domain, r.action, r.resourceType, r.resourceId, r.timestamp].join(',')).join('\n')
  return header + body
}
