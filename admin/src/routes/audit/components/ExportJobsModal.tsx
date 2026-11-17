import { useEffect, useRef, useState } from 'react'
import { useApolloClient, useQuery, useMutation } from '@apollo/client'
import { AUDIT_EXPORT_JOB_DOWNLOAD_QUERY, AUDIT_EXPORT_JOBS_PAGE_QUERY } from '@/modules/audit/graphql/queries'
import { CREATE_AUDIT_EXPORT_JOB } from '@/modules/audit/graphql/mutations'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { Form } from '@/ui/components/Form'
import { notify } from '@/shared/services/notification'
import { dataUriMime, saveDataUri } from '@/shared/utils/dataUriFile'
import { auditExportFilename, exportJobDate, exportJobError } from '../auditPageModel'
import styles from '../AuditEvents.module.css'
interface AuditExportJob { id: string; status: string; exportFormat: string; createdAt: string; completedAt?: string | null; errorMessage?: string | null; fileUrl?: string | null }
export function ExportJobsModal({ open, onClose, currentFiltersJson }: { open: boolean; onClose: () => void; currentFiltersJson?: Record<string, unknown> }) {
  const { formatDateTime } = useFormatDate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [format, setFormat] = useState('')
  const [formError, setFormError] = useState('')
  const busy = useRef(false)
  const input = useRef<HTMLSelectElement>(null)
  const { data, loading, error, refetch } = useQuery<{ auditExportJobsPage: { items: AuditExportJob[]; total: number } }>(AUDIT_EXPORT_JOBS_PAGE_QUERY, { variables: { limit: pageSize, offset: (page-1)*pageSize }, errorPolicy: 'all', fetchPolicy: 'cache-and-network', skip: !open })
  const [createJob, { loading: creating }] = useMutation(CREATE_AUDIT_EXPORT_JOB)
  const client = useApolloClient()
  const [downloading, setDownloading] = useState<string | null>(null)
  useEffect(() => { if (!open) return; const timer = setInterval(() => { void refetch() }, 5000); return () => clearInterval(timer) }, [open, refetch])
  /* Since 2026-11-04 the file is kept in its job row: auditExportJobDownload answers it as a base64 data URI, saved
     through the shared helper (the list's fileUrl is only the file's name). A refusal is the server's own words
     (the error link raises no toast of its own), and the file is not kept in the Apollo cache. */
  async function download(job: AuditExportJob) {
    if (downloading) return
    setDownloading(job.id)
    try {
      const { data: file, errors } = await client.query<{ auditExportJobDownload: string | null }>({ query: AUDIT_EXPORT_JOB_DOWNLOAD_QUERY, variables: { id: job.id }, fetchPolicy: 'no-cache', errorPolicy: 'all', context: { skipNotification: true } })
      const fileData = file?.auditExportJobDownload
      if (!fileData) throw new Error(errors?.[0]?.message || 'Could not get the file')
      saveDataUri(fileData, auditExportFilename(job, dataUriMime(fileData)))
      notify.success('Your file download has started.', 'Download Started')
    } catch (cause) { notify.error(cause instanceof Error && cause.message ? cause.message : 'Failed to download file. Please try again or contact support.', 'Download Failed') }
    finally { setDownloading(null) }
  }
  async function save() {
    if (busy.current) return
    if (!format) { setFormError('Please select a format'); return }
    busy.current = true; setFormError('')
    try {
      const result = await createJob({ variables: { input: { filtersJson: currentFiltersJson ?? {}, exportFormat: format } } })
      if (!result.data?.createAuditExportJob?.id) throw new Error('Failed to create export job')
      notify.success('Export job created'); setCreateOpen(false); setFormat(''); void refetch()
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Failed to create export job'; setFormError(message); notify.error(message, 'Failed to create export job') }
    finally { busy.current = false }
  }
  function closeCreate() { if (!busy.current) { setCreateOpen(false); setFormat(''); setFormError('') } }
  const columns: DataTableColumn<AuditExportJob>[] = [
    { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={row.status === 'completed' ? 'ok' : row.status === 'failed' ? 'neg' : row.status === 'processing' ? 'info' : 'neutral'}>{({ pending: 'Pending', processing: 'Processing', completed: 'Completed', failed: 'Failed' } as Record<string, string>)[row.status] ?? 'Pending'}</StatusPill> },
    { key: 'format', header: 'Format', cell: (row) => row.exportFormat },
    { key: 'created', header: 'Created', cell: (row) => { const at = exportJobDate(row.createdAt); return at ? formatDateTime(at, 'MMM d, yyyy h:mm a') : '—' } },
    { key: 'completed', header: 'Completed', cell: (row) => { const at = exportJobDate(row.completedAt); return at ? formatDateTime(at, 'MMM d, yyyy h:mm a') : '—' } },
    { key: 'error', header: 'Error', cell: (row) => row.errorMessage ? <span className={styles.error} title={row.errorMessage}>{exportJobError(row.errorMessage)}</span> : '-' },
    { key: 'actions', header: 'Actions', cell: (row) => row.status === 'completed' && row.fileUrl ? <Button size="xs" variant="link" loading={downloading === row.id} disabled={downloading !== null && downloading !== row.id} onClick={() => void download(row)}>Download</Button> : null },
  ]
  return <><Dialog title="Export Jobs" open={open && !createOpen} onOpenChange={(next) => { if (!next && !busy.current) onClose() }} size="xl" dismissible={!creating}>
    <div className={styles.stack}>
      <div className={styles.actions}><Button variant="primary" onClick={() => setCreateOpen(true)}>New export job</Button></div>
      {error && <Notice tone="error">{error.message}</Notice>}
      <DataTable label="Audit export jobs" columns={columns} rows={data?.auditExportJobsPage?.items ?? []} rowKey={(row) => row.id} state={loading ? 'loading' : 'ready'} pagination={{ current: page, pageSize, total: data?.auditExportJobsPage?.total ?? 0, onChange: setPage, onPageSizeChange: size => { setPageSize(size); setPage(1) } }} />
    </div>
  </Dialog>
    <Dialog title="Create export job" open={createOpen && open} onOpenChange={(next) => { if (!next) closeCreate() }} initialFocus={input} dismissible={!creating}>
      <Form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className={styles.stack}>
          <p className={styles.secondary}>Current filters will be applied to this export. The job will be processed in the background; refresh the list to see status and download when ready.</p>
          <Select ref={input} label="Format" layout="stacked" value={format} placeholder="Select format" options={['CSV', 'JSON', 'XLSX'].map((value) => ({ value, label: value }))} disabled={creating} onChange={setFormat} />
          {formError && <Notice tone="error">{formError}</Notice>}
          <div className={styles.actions}><Button variant="primary" type="submit" loading={creating}>Create job</Button><Button disabled={creating} onClick={closeCreate}>Cancel</Button></div>
        </div>
      </Form>
    </Dialog>
  </>
}
