import { useState } from 'react'
import { gql, useMutation, useApolloClient } from '@apollo/client'
import { messageService, notify } from '@/shared/services/notification'
import { saveDataUri } from '@/shared/utils/dataUriFile'

/**
 * Server-side export goes through the export-job API.
 *
 * This hook used to call `reporting { exportData(input: ExportDataInput!) }`,
 * which does not exist and never has — there is no `reporting` field on
 * Mutation and no `ExportDataInput` type — so every server-side export button
 * wired to it failed at query validation before reaching the network.
 *
 * The real API queues a job and fills in `fileUrl` when the file is ready, so
 * this polls briefly for a fast export and hands the user off to the Export
 * Centre for a slow one, rather than pretending the download is synchronous.
 *
 * Its feedback goes through the shared notification service (the kit toast) rather than antd's
 * `message`, so the hook no longer pulls antd in (page migration C, with /reporting/agent-overview).
 * Every text and timing is unchanged: the progress toast stays until it is closed, the others keep
 * antd's 3-second message default.
 */
const CREATE_EXPORT_JOB = gql`
  mutation CreateExportJobFromHook($input: ExportJobInput!) {
    createExportJob(input: $input) {
      id
      status
      fileUrl
      errorMessage
    }
  }
`

const EXPORT_JOB_STATUS = gql`
  query ExportJobStatusFromHook($status: String, $limit: Int) {
    exportJobs(status: $status, limit: $limit) {
      id
      status
      fileUrl
      errorMessage
    }
  }
`

/** A finished job's file, asked for on download: the server answers it as a base64 data URI (2026-11-04). */
const EXPORT_JOB_DOWNLOAD_URL = gql`
  query ExportJobDownloadUrlFromHook($jobId: ID!) {
    exportJobDownloadUrl(jobId: $jobId)
  }
`

/** How long to wait for a quick export before pointing at the Export Centre. */
const POLL_ATTEMPTS = 10
const POLL_INTERVAL_MS = 1500

interface ExportOptions {
  type: 'players' | 'transactions' | 'commission' | 'settlement' | 'ggr' | 'subagents'
  format: 'csv' | 'xlsx'
  filters?: Record<string, unknown>
  dateRange?: { from: string; to: string }
}

/** The ExportJob fields both documents above select. */
interface ExportJob {
  id: string
  status: string
  fileUrl?: string | null
  errorMessage?: string | null
}

/** A thrown value's `message` when it has a string one, as `error.message` was read before. */
function errorText(error: unknown): string {
  const text = (error as { message?: unknown } | null | undefined)?.message
  return typeof text === 'string' ? text : ''
}

export function useExport() {
  const [loading, setLoading] = useState(false)
  const client = useApolloClient()
  const [createExportJob] = useMutation<{ createExportJob: ExportJob | null }>(CREATE_EXPORT_JOB)

  const exportToFile = async (options: ExportOptions): Promise<void> => {
    setLoading(true)
    const hideLoading = notify.loading('Preparing export...', 0)

    try {
      // The format as the processor names it ('CSV' / 'XLSX': 'csv' failed every job), and the period
      // as dateFrom / dateTo too, the keys the export fetchers read (with dateRange alone the file
      // ignored the period and held every bet).
      const { data } = await createExportJob({
        variables: {
          input: {
            reportType: options.type,
            exportFormat: options.format.toUpperCase(),
            filtersJson: {
              ...(options.filters ?? {}),
              dateRange: options.dateRange ?? null,
              ...(options.dateRange ? { dateFrom: options.dateRange.from, dateTo: options.dateRange.to } : {}),
            },
          },
        },
      })

      const job = data?.createExportJob
      if (!job?.id) {
        hideLoading()
        messageService.error('Export could not be queued')
        return
      }

      // The job is processed after the mutation returns, so wait for the file
      // rather than reporting success on a job that has not run yet.
      let ready: ExportJob | null = job.fileUrl ? job : null
      for (let i = 0; !ready && i < POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const { data: poll } = await client.query<{ exportJobs: ExportJob[] | null }>({
          query: EXPORT_JOB_STATUS,
          variables: { limit: 20 },
          fetchPolicy: 'network-only',
        })
        const found = (poll?.exportJobs ?? []).find((j) => j.id === job.id)
        if (found?.status === 'failed') {
          hideLoading()
          messageService.error(found.errorMessage || 'Export failed')
          return
        }
        if (found?.fileUrl) ready = found
      }

      hideLoading()

      if (!ready?.fileUrl) {
        // Not a failure — a big export simply takes longer than anyone wants
        // to watch a spinner for.
        messageService.info('Export is still running. It will appear in the Export Centre when it is ready.')
        return
      }

      // The stored fileUrl is only the file's name; the file itself is asked for here, and the server answers
      // it as a base64 data URI (no external file store since 2026-11-04), decoded and saved as a Blob. The
      // app's client answers a refusal with its errors rather than a throw (errorPolicy 'all'), so the reason
      // is shown here, once, instead of a generic line beside the error link's own toast. The file is not
      // kept in the Apollo cache.
      const { data: file, errors: fileErrors } = await client.query<{ exportJobDownloadUrl: string | null }>({
        query: EXPORT_JOB_DOWNLOAD_URL,
        variables: { jobId: job.id },
        fetchPolicy: 'no-cache',
        context: { skipNotification: true },
      })
      const fileData = file?.exportJobDownloadUrl
      if (!fileData) {
        messageService.error(fileErrors?.[0]?.message || 'Could not get the file')
        return
      }

      saveDataUri(fileData, `export-${Date.now()}.${options.format}`)
      messageService.success('Export ready! Downloading...')
    } catch (error: unknown) {
      hideLoading()
      messageService.error(errorText(error) || 'Failed to export data')
    } finally {
      setLoading(false)
    }
  }

  const exportCSV = (type: ExportOptions['type'], filters?: Record<string, unknown>, dateRange?: { from: string; to: string }) => {
    return exportToFile({ type, format: 'csv', filters, dateRange })
  }

  const exportExcel = (type: ExportOptions['type'], filters?: Record<string, unknown>, dateRange?: { from: string; to: string }) => {
    return exportToFile({ type, format: 'xlsx', filters, dateRange })
  }

  const exportToCSV = (data: Array<Record<string, unknown>>, filename: string): void => {
    if (!data || data.length === 0) {
      messageService.warning('No data to export')
      return
    }

    // Get headers from first object
    const headers = Object.keys(data[0])
    
    // Create CSV content
    const csvRows = [
      headers.join(','), // Header row
      ...data.map(row => 
        headers.map(header => {
          const value = row[header]
          // Escape quotes and wrap in quotes if contains comma, quote, or newline
          const stringValue = String(value ?? '')
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`
          }
          return stringValue
        }).join(',')
      )
    ]
    
    const csv = csvRows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return {
    exportToFile,
    exportCSV,
    exportExcel,
    exportToCSV,
    loading,
  }
}

