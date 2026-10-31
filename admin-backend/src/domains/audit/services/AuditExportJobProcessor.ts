import { getAuditExportJobById, updateAuditExportJob } from '@src/repos/audit/auditExportJobRepo.js'
import { listAuditDb } from '@src/repos/audit/auditRepo.js'
import { uploadToS3 } from '@src/services/storage/s3.js'

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
 * Process a single audit export job: fetch data, generate file, upload, update job.
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

  const fileName = `exports/audit/${jobTenant}/${job.whitelabelId}/audit-${jobId}-${Date.now()}.${fileExtension}`

  let fileUrl: string
  try {
    fileUrl = await uploadToS3(fileContent, fileName, contentType)
  } catch (err: any) {
    await updateAuditExportJob({
      id: jobId,
      tenant: jobTenant,
      status: 'failed',
      errorMessage: `Upload failed: ${err?.message ?? 'Unknown error'}`,
    })
    throw err
  }

  await updateAuditExportJob({
    id: jobId,
    tenant: jobTenant,
    status: 'completed',
    fileUrl,
    completedAt: new Date(),
  })
}
