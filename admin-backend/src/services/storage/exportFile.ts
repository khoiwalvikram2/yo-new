/**
 * Generated export files live in their job row as a base64 data URI (owner decision 2026-11-04: Amazon S3 is
 * gone). The Export Center's jobs (reporting_export_jobs) and the audit trail's (audit_export_jobs) both keep the
 * file in file_data and its bare name in file_url, so a completed job's list row still names its file while the
 * lists never carry the file itself.
 */

/** The largest base64 payload a job row stores: 40 MB. */
export const EXPORT_FILE_MAX_BASE64_BYTES = 40 * 1024 * 1024

/** What a download of a job made before this change answers: its file went to S3, which nothing can read now. */
export const EXPORT_FILE_PREDATES_DATABASE = 'This export was made before files moved into the database; run it again'

const MB = 1024 * 1024

/** The base64 length of a file of `bytes` bytes: 4 characters for every 3 bytes, padded. */
export function base64LengthOf(bytes: number): number {
  return 4 * Math.ceil(bytes / 3)
}

/**
 * The file as a data URI (`data:<mime>;base64,<payload>`). A file whose base64 would pass the cap is refused
 * before it is encoded, with its size and what to do about it; the processors record that as the job's failure.
 */
export function exportFileDataUri(
  content: Buffer | string,
  mimeType: string,
  maxBase64Bytes: number = EXPORT_FILE_MAX_BASE64_BYTES,
): string {
  const file = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const size = base64LengthOf(file.length)
  if (size > maxBase64Bytes) {
    // Rounded up, so a refused size never reads as the cap itself.
    const mb = (Math.ceil((size / MB) * 10) / 10).toFixed(1)
    throw new Error(`The export is too large to store (${mb} MB); narrow the filters`)
  }
  return `data:${mimeType};base64,${file.toString('base64')}`
}

/**
 * What a download of a job hands out: the data URI its row stores. A job with a file_url and no file_data was
 * uploaded to S3 before files moved into the database, so it is refused by name; a job with neither (pending,
 * processing or failed) has no file yet.
 */
export function exportFileDownload(job: { fileUrl: string | null; fileData: string | null }): string {
  if (job.fileData) return job.fileData
  if (job.fileUrl) throw new Error(EXPORT_FILE_PREDATES_DATABASE)
  throw new Error('Export file is not available')
}
