/** The formats an export job can produce (ExportJobProcessor writes both as CSV for now). */
export const EXPORT_FORMATS = ['CSV', 'XLSX'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/**
 * The format createExportJob stores: the caller's, upper-cased, or a refusal before any job row is
 * written. The processor matches 'CSV' / 'XLSX' exactly, so the Agent Overview's 'csv' / 'xlsx' queued
 * jobs that all failed with "Unsupported export format", and any other string ("NOPE") queued a job
 * that could only fail (F-REP-02, F-REP-15).
 */
export function normalizeExportFormat(value: unknown): ExportFormat {
  const format = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if ((EXPORT_FORMATS as readonly string[]).includes(format)) return format as ExportFormat
  throw new Error(`Export format must be CSV or XLSX (got "${String(value ?? '').slice(0, 20)}")`)
}
