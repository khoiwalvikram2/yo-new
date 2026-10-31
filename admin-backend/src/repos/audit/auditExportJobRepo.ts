import { db } from '@src/db/client.js'
import { auditExportJobs } from '@src/db/schema.js'
import { and, eq, desc, sql } from 'drizzle-orm'

export interface AuditExportJobRow {
  id: string
  tenant: string
  whitelabelId: string
  createdBy: number
  filtersJson: any
  exportFormat: string
  status: string
  fileUrl: string | null
  errorMessage: string | null
  scheduledAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

/**
 * List export jobs with filters
 */
export async function getAuditExportJobsPage(filters: {
  tenant: string
  whitelabelId?: string
  createdBy?: number
  status?: string
  limit?: number
  offset?: number
}) {
  const whereClauses: any[] = [eq(auditExportJobs.tenant, filters.tenant)]

  if (filters.whitelabelId) {
    whereClauses.push(eq(auditExportJobs.whitelabelId, filters.whitelabelId))
  }

  if (filters.createdBy) {
    whereClauses.push(eq(auditExportJobs.createdBy, filters.createdBy))
  }

  if (filters.status) {
    whereClauses.push(eq(auditExportJobs.status, filters.status))
  }

  const whereClause = whereClauses.length > 0 ? and(...whereClauses) : undefined
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50))

  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(auditExportJobs).where(whereClause)
  const rows = await db.select()
    .from(auditExportJobs)
    .where(whereClause)
    .orderBy(desc(auditExportJobs.createdAt), desc(auditExportJobs.id))
    .limit(limit).offset(Math.max(0, filters.offset ?? 0))

  const items = rows.map((r: any) => ({
    id: String(r.id),
    tenant: String(r.tenant),
    whitelabelId: String(r.whitelabelId),
    createdBy: r.createdBy,
    filtersJson: r.filtersJson,
    exportFormat: String(r.exportFormat),
    status: String(r.status),
    fileUrl: r.fileUrl ? String(r.fileUrl) : null,
    errorMessage: r.errorMessage ? String(r.errorMessage) : null,
    scheduledAt: r.scheduledAt ? (r.scheduledAt as Date) : null,
    completedAt: r.completedAt ? (r.completedAt as Date) : null,
    createdAt: r.createdAt as Date,
  }))
  return { items, total: count.total }
}

export async function getAuditExportJobs(filters: Parameters<typeof getAuditExportJobsPage>[0]): Promise<AuditExportJobRow[]> {
  return (await getAuditExportJobsPage(filters)).items
}

/**
 * Get a single export job by ID
 */
export async function getAuditExportJobById(
  id: string,
  tenant: string
): Promise<AuditExportJobRow | null> {
  const rows = await db.select()
    .from(auditExportJobs)
    .where(
      and(
        eq(auditExportJobs.id, id),
        eq(auditExportJobs.tenant, tenant)
      )
    )
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  const r = rows[0]
  return {
    id: String(r.id),
    tenant: String(r.tenant),
    whitelabelId: String(r.whitelabelId),
    createdBy: r.createdBy,
    filtersJson: r.filtersJson,
    exportFormat: String(r.exportFormat),
    status: String(r.status),
    fileUrl: r.fileUrl ? String(r.fileUrl) : null,
    errorMessage: r.errorMessage ? String(r.errorMessage) : null,
    scheduledAt: r.scheduledAt ? (r.scheduledAt as Date) : null,
    completedAt: r.completedAt ? (r.completedAt as Date) : null,
    createdAt: r.createdAt as Date,
  }
}

/**
 * Create a new export job
 */
export async function createAuditExportJob(input: {
  tenant: string
  whitelabelId: string
  createdBy: number
  filtersJson: any
  exportFormat: string
  scheduledAt?: Date | null
}): Promise<AuditExportJobRow> {
  const result = await db.insert(auditExportJobs).values({
    tenant: input.tenant,
    whitelabelId: input.whitelabelId,
    createdBy: input.createdBy,
    filtersJson: input.filtersJson,
    exportFormat: input.exportFormat,
    status: 'pending',
    scheduledAt: input.scheduledAt ?? null,
  }).returning()

  const row = result[0]
  return {
    id: String(row.id),
    tenant: String(row.tenant),
    whitelabelId: String(row.whitelabelId),
    createdBy: row.createdBy,
    filtersJson: row.filtersJson,
    exportFormat: String(row.exportFormat),
    status: String(row.status),
    fileUrl: row.fileUrl ? String(row.fileUrl) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    scheduledAt: row.scheduledAt ? (row.scheduledAt as Date) : null,
    completedAt: row.completedAt ? (row.completedAt as Date) : null,
    createdAt: row.createdAt as Date,
  }
}

/**
 * Update export job status
 */
export async function updateAuditExportJob(input: {
  id: string
  tenant: string
  status?: string
  fileUrl?: string | null
  errorMessage?: string | null
  completedAt?: Date | null
}): Promise<AuditExportJobRow> {
  const updateData: any = {}
  
  if (input.status !== undefined) {
    updateData.status = input.status
  }
  if (input.fileUrl !== undefined) {
    updateData.fileUrl = input.fileUrl
  }
  if (input.errorMessage !== undefined) {
    updateData.errorMessage = input.errorMessage
  }
  if (input.completedAt !== undefined) {
    updateData.completedAt = input.completedAt
  }

  const result = await db.update(auditExportJobs)
    .set(updateData)
    .where(
      and(
        eq(auditExportJobs.id, input.id),
        eq(auditExportJobs.tenant, input.tenant)
      )
    )
    .returning()

  if (!result[0]) {
    throw new Error('Export job not found')
  }

  const row = result[0]
  return {
    id: String(row.id),
    tenant: String(row.tenant),
    whitelabelId: String(row.whitelabelId),
    createdBy: row.createdBy,
    filtersJson: row.filtersJson,
    exportFormat: String(row.exportFormat),
    status: String(row.status),
    fileUrl: row.fileUrl ? String(row.fileUrl) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    scheduledAt: row.scheduledAt ? (row.scheduledAt as Date) : null,
    completedAt: row.completedAt ? (row.completedAt as Date) : null,
    createdAt: row.createdAt as Date,
  }
}
