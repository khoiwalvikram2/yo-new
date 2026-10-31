import { auditLogs } from '../db/schema/audit.js'

export interface RecordAuditPayload {
  tenant?: string
  actorId: string
  domain: string
  action: string
  resourceType: string
  resourceId: string
  before?: unknown
  after?: unknown
}

/**
 * Insert a single audit event. Used by admin-backend and user-backend.
 * Caller must pass its own db instance (same audit_logs table in shared schema).
 * Returns inserted id and createdAt for optional pubsub in admin-backend.
 */
export async function recordAudit(db: any, payload: RecordAuditPayload): Promise<{ id: number; createdAt: Date } | null> {
  const raw = payload.tenant ?? 'default'
  const tenant = (typeof raw === 'string' && raw.trim()) ? raw.trim() : 'default'
  try {
    const result = await db
      .insert(auditLogs)
      .values({
        tenant,
        actorId: payload.actorId,
        domain: payload.domain,
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        before: payload.before ?? null,
        after: payload.after ?? null,
      })
      .returning({ id: auditLogs.id, createdAt: auditLogs.createdAt })

    const row = result[0]
    if (row) {
      return { id: row.id, createdAt: row.createdAt as Date }
    }
    return null
  } catch (err) {
    console.error('[audit] recordAudit failed', err instanceof Error ? err.message : String(err))
    return null
  }
}
