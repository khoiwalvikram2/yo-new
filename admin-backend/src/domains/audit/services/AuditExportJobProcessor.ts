import { and, eq } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { auditExportJobs } from '@src/db/schema.js'
import { getAuditExportJobById, updateAuditExportJob } from '@src/repos/audit/auditExportJobRepo.js'
import { listAuditDb } from '@src/repos/audit/auditRepo.js'
import { exportFileDataUri } from '@src/services/storage/exportFile.js'

/**
 * Normalize filters from UI (from/to) or legacy (dateFrom/dateTo) for listAuditDb.
 */
function normalizeFilters(filtersJson: any, tenant: string): Record<string, unknown> {
  const f = filtersJson && typeof filtersJson === 'object' ? filtersJson : {}
  const from = f.from ?? f.dateFrom
  const to = f.to ?? f.dateTo
  return {
    tenant,
    id: f.id,
    domain: f.domain,
    action: f.action,
    actorId: f.actorId,
    resourceType: f.resourceType,
    resourceId: f.resourceId,
    from: typeof from === 'string' ? from : undefined,
    to: typeof to === 'string' ? to : undefined,
    search: f.search,
    page: 1,
    limit: 10000,
    sort: f.sort ?? 'timestamp:desc',
  }
}

/**
 * Generate CSV string from audit events.
 */
function generateCSV(items: any[]): string {
  const headers = ['id', 'tenant', 'actorId', 'domain', 'action', 'resourceType', 'resourceId', 'timestamp']
  const lines = [headers.join(',')]
  for (const event of items) {
    const row = [
      event.id,
      event.tenant ?? '',
      event.actorId,
      event.domain,
      event.action,
      event.resourceType,
      event.resourceId,
      event.timestamp,
    ].map((val) => {
      const str = String(val ?? '')
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

/**
 * Process a single audit export job: fetch data, generate the file, store it in the job row, update the job.
 * @param jobId - Export job ID
 * @param tenant - Tenant (required for getAuditExportJobById)
 */
export async function processAuditExportJob(jobId: string, tenant: string): Promise<void> {
  const job = await getAuditExportJobById(jobId, tenant)
  if (!job) {
    throw new Error(`Audit export job not found: ${jobId}`)
  }
  if (job.status !== 'pending') {
    return
  }

  await updateAuditExportJob({
    id: jobId,
    tenant,
    status: 'processing',
  })

  const jobTenant = job.tenant
  try {
    const filters = normalizeFilters(job.filtersJson, jobTenant)
    const { items } = await listAuditDb(filters)

    const format = (job.exportFormat || 'CSV').toUpperCase()
    let fileContent: Buffer
    let fileExtension: string
    let contentType: string

    if (format === 'CSV' || format === 'XLSX') {
      const csv = generateCSV(items)
      fileContent = Buffer.from(csv, 'utf-8')
      fileExtension = 'csv'
      contentType = 'text/csv'
    } else if (format === 'JSON') {
      const json = JSON.stringify(items, null, 2)
      fileContent = Buffer.from(json, 'utf-8')
      fileExtension = 'json'
      contentType = 'application/json'
    } else {
      throw new Error(`Unsupported audit export format: ${format}`)
    }

    // The file is kept in the job row as a data URI (S3 is gone, owner decision 2026-11-04), which
    // auditExportJobDownload hands out; file_url keeps the bare file name, so the list still names it and
    // never carries the file. A file too large to store throws here and fails the job with its size.
    const fileName = `audit-${jobId}-${Date.now()}.${fileExtension}`
    const fileData = exportFileDataUri(fileContent, contentType)

    // updateAuditExportJob does not write file_data, so the completed row is written here, scoped the same way.
    await db
      .update(auditExportJobs)
      .set({ status: 'completed', fileUrl: fileName, fileData, completedAt: new Date() })
      .where(and(eq(auditExportJobs.id, jobId), eq(auditExportJobs.tenant, jobTenant)))
  } catch (err: any) {
    // Any failure after the job started ends it as failed, with the reason, rather than leaving it processing.
    await updateAuditExportJob({
      id: jobId,
      tenant: jobTenant,
      status: 'failed',
      errorMessage: err?.message ?? 'Audit export failed',
    })
    throw err
  }
}
