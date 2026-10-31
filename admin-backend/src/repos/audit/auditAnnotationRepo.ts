import { db } from '@src/db/client.js'
import { auditAnnotations } from '@shared/db/schema.js'
import { and, eq, desc } from 'drizzle-orm'

export interface AuditAnnotationRow {
  id: number
  tenant: string
  auditEventId: number
  createdBy: number
  note: string
  createdAt: Date
  updatedAt: Date | null
}

/**
 * Get all annotations for an audit event
 */
export async function getAuditAnnotations(
  auditEventId: number,
  tenant: string = 'default'
): Promise<AuditAnnotationRow[]> {
  const rows = await db.select()
    .from(auditAnnotations)
    .where(
      and(
        eq(auditAnnotations.auditEventId, auditEventId),
        eq(auditAnnotations.tenant, tenant)
      )
    )
    .orderBy(desc(auditAnnotations.createdAt))

  return rows.map((r: any) => ({
    id: r.id,
    tenant: String(r.tenant),
    auditEventId: r.auditEventId,
    createdBy: r.createdBy,
    note: String(r.note),
    createdAt: r.createdAt as Date,
    updatedAt: (r.updatedAt as Date | null) ?? null,
  }))
}

/**
 * Create a new annotation
 */
export async function createAuditAnnotation(input: {
  tenant?: string
  auditEventId: number
  createdBy: number
  note: string
}): Promise<AuditAnnotationRow> {
  const tenant = input.tenant || 'default'
  const result = await db.insert(auditAnnotations).values({
    tenant,
    auditEventId: input.auditEventId,
    createdBy: input.createdBy,
    note: input.note,
  }).returning()

  const row = result[0]
  return {
    id: row.id,
    tenant: String(row.tenant),
    auditEventId: row.auditEventId,
    createdBy: row.createdBy,
    note: String(row.note),
    createdAt: row.createdAt as Date,
    updatedAt: (row.updatedAt as Date | null) ?? null,
  }
}

/**
 * Update an existing annotation
 */
export async function updateAuditAnnotation(input: {
  id: number
  tenant?: string
  note: string
}): Promise<AuditAnnotationRow> {
  const tenant = input.tenant ?? 'default'
  const result = await db.update(auditAnnotations)
    .set({
      note: input.note,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(auditAnnotations.id, input.id),
        eq(auditAnnotations.tenant, tenant)
      )
    )
    .returning()

  if (!result[0]) {
    throw new Error('Annotation not found')
  }

  const row = result[0]
  return {
    id: row.id,
    tenant: String(row.tenant),
    auditEventId: row.auditEventId,
    createdBy: row.createdBy,
    note: String(row.note),
    createdAt: row.createdAt as Date,
    updatedAt: (row.updatedAt as Date | null) ?? null,
  }
}

/**
 * Delete an annotation
 */
export async function deleteAuditAnnotation(
  id: number,
  tenant: string = 'default'
): Promise<boolean> {
  const result = await db.delete(auditAnnotations)
    .where(
      and(
        eq(auditAnnotations.id, id),
        eq(auditAnnotations.tenant, tenant)
      )
    )
    .returning()
  return result.length > 0
}
