import type { AuditFilters } from '@/state/auditStore'
import type { AuditEvent } from '@/modules/audit/types'
import { startOfDay, endOfDay, addDays, DEFAULT_ADMIN_TZ, formatInTimeZone } from '@/shared/utils/date'
import { extensionForMime } from '@/shared/utils/dataUriFile'

export function auditActiveFilters(filters: Partial<AuditFilters>) {
  return Number(Boolean(filters.id)) + Number(Boolean(filters.domain?.length)) + Number(Boolean(filters.action?.length)) + Number(Boolean(filters.actorId)) + Number(Boolean(filters.resourceType?.length)) + Number(Boolean(filters.resourceId)) + Number(Boolean(filters.from || filters.to)) + Number(Boolean(filters.search))
}
export function auditGraphqlFilters(filters: AuditFilters): AuditFilters {
  const result: AuditFilters = { page: filters.page, limit: filters.limit, sort: filters.sort }
  for (const key of ['id', 'actorId', 'resourceId', 'from', 'to', 'search'] as const) if (filters[key]) result[key] = filters[key]
  for (const key of ['domain', 'action', 'resourceType'] as const) if (filters[key]?.length) result[key] = filters[key]
  return result
}
/** Store setters merge patches, so reset must explicitly clear every supported filter. */
export function auditResetFilters(): AuditFilters {
  return { page: 1, limit: 100, sort: 'timestamp:desc', id: undefined, domain: undefined, action: undefined, actorId: undefined, resourceType: undefined, resourceId: undefined, from: undefined, to: undefined, search: undefined }
}
export function auditTimePreset(preset: string, now = new Date()): Partial<AuditFilters> | null {
  if (preset === 'custom') return null
  const days = ({ today: 0, last7days: 7, last30days: 30, last90days: 90 } as Record<string, number>)[preset]
  if (days === undefined) return { from: undefined, to: undefined, page: 1 }
  return { from: addDays(startOfDay(now, DEFAULT_ADMIN_TZ), -days).toISOString(), to: endOfDay(now, DEFAULT_ADMIN_TZ).toISOString(), page: 1 }
}
export function auditCalendarRange(from: string, to: string): Partial<AuditFilters> {
  if (!from || !to) return { from: undefined, to: undefined, page: 1 }
  return { from: new Date(`${from}T00:00:00+05:30`).toISOString(), to: new Date(`${to}T23:59:59.999+05:30`).toISOString(), page: 1 }
}
export function auditCalendarDay(value?: string) { return value ? formatInTimeZone(value, 'yyyy-MM-dd', DEFAULT_ADMIN_TZ) : '' }
export function auditHasChanges(event: AuditEvent) {
  return [event.before, event.after].some((value) => typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0)
}
export function escapeAuditHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
export function auditPrintDocument(events: AuditEvent[], total: number, filters: AuditFilters, formatDateTime: (date: string) => string, formatDate: (date: string) => string) {
  const escaped = escapeAuditHtml
  return `<!doctype html><html><head><title>Audit Trail Report</title><style>body{font-family:system-ui,sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid;padding:8px;text-align:left}.metadata{font-size:12px}</style></head><body><h1>Audit Trail Report</h1><div class="metadata"><div>Generated: ${escaped(formatDateTime(new Date().toISOString()))}</div><div>Total Events: ${escaped(total)}</div>${filters.from || filters.to ? `<div>Date Range: ${escaped(filters.from ? formatDate(filters.from) : '...')} - ${escaped(filters.to ? formatDate(filters.to) : '...')}</div>` : ''}</div><table><thead><tr><th>ID</th><th>Timestamp</th><th>Actor</th><th>Domain</th><th>Action</th><th>Resource</th></tr></thead><tbody>${events.map((event) => `<tr><td>${escaped(event.id)}</td><td>${escaped(formatDateTime(event.timestamp))}</td><td>${escaped(event.actor?.name || event.actorId)}</td><td>${escaped(event.domain)}</td><td>${escaped(event.action)}</td><td>${escaped(event.resourceType)}: ${escaped(event.resourceId)}</td></tr>`).join('')}</tbody></table></body></html>`
}
/** An export job's date as an ISO string. The server sent epoch milliseconds as a string ("1793645111717"),
 *  which the Export Jobs list showed as "Invalid Date"; it sends ISO now, and the old shape is still read. */
export function exportJobDate(value?: string | null): string | null {
  if (!value) return null
  return /^\d+$/.test(value) ? new Date(Number(value)).toISOString() : value
}
/** A failed export job's reason, readable (the server's text stays in the tooltip). Since 2026-11-04 an export is
 *  kept in its job row: "Upload failed: …" only comes from jobs that failed in the old external file storage,
 *  which is gone, so the way forward is a new job. Any other reason (a file too large to store) is kept as sent. */
export function exportJobError(message: string): string {
  return /^upload failed:/i.test(message.trim())
    ? 'This export failed in the old file storage, which is no longer used. Create a new export job.'
    : message
}
/** `Audit Trail-2026-11-04-3f2a9c1e.csv`: the Export Center's file name shape (the creation day, in IST, and the id's
 *  first 8 characters), with the extension the file's own type names, else the job's format. */
export function auditExportFilename(job: { id: string; exportFormat: string; createdAt?: string | null }, mime?: string | null): string {
  const created = exportJobDate(job.createdAt)
  const day = created && !Number.isNaN(new Date(created).getTime()) ? formatInTimeZone(created, 'yyyy-MM-dd', DEFAULT_ADMIN_TZ) : 'export'
  const extension = (mime ? extensionForMime(mime) : null) || job.exportFormat.trim().toLowerCase() || 'csv'
  return `Audit Trail-${day}-${job.id.slice(0, 8)}.${extension}`
}
