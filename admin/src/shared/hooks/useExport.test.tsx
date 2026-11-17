/**
 * useExport after it left antd: the same export-job calls, the same texts, now through the shared
 * notification service (the kit toast). Apollo's hooks are replaced so the polling loop can run on fake
 * timers; the documents are checked by operation name.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import { useExport } from './useExport'

interface MutationCall {
  variables: { input: Record<string, unknown> }
}

const apollo = vi.hoisted(() => ({
  mutationDocument: undefined as unknown,
  createExportJob: vi.fn(),
  query: vi.fn(),
}))

const feedback = vi.hoisted(() => ({
  hide: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>()
  return {
    ...actual,
    useMutation: (document: unknown) => {
      apollo.mutationDocument = document
      return [apollo.createExportJob]
    },
    useApolloClient: () => ({ query: apollo.query }),
  }
})

vi.mock('@/shared/services/notification', () => ({
  notify: { loading: feedback.loading },
  messageService: {
    success: feedback.success,
    error: feedback.error,
    info: feedback.info,
    warning: feedback.warning,
  },
}))

const operationName = (document: unknown) =>
  (document as { definitions?: Array<{ name?: { value?: string } }> }).definitions?.[0]?.name?.value

/** The export as the server answers its download since 2026-11-04: the file itself, as a base64 data URI. */
const fileUri = (mime: string, text: string) => `data:${mime};base64,${btoa(text)}`
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

let clicked: HTMLAnchorElement[] = []
/** The Blob behind each object URL the hook made, in order. */
let saved: Blob[] = []

beforeEach(() => {
  apollo.createExportJob.mockReset()
  apollo.query.mockReset()
  for (const fn of Object.values(feedback)) fn.mockReset()
  feedback.loading.mockReturnValue(feedback.hide)
  clicked = []
  saved = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicked.push(this)
  })
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    saved.push(blob)
    return `blob:export-${saved.length}`
  })
  window.URL.revokeObjectURL = vi.fn()
})

/** jsdom's Blob has no text(); FileReader reads it. */
function blobText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useExport', () => {
  test('queues the export job with the filters and range, and saves a ready file from the data URI the server sends', async () => {
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-1', status: 'completed', fileUrl: 'ggr-job-1.csv', errorMessage: null } },
    })
    apollo.query.mockResolvedValueOnce({ data: { exportJobDownloadUrl: fileUri('text/csv', 'Date,GGR\n2026-11-04,1200\n') } })
    const { result } = renderHook(() => useExport())
    assert.equal(operationName(apollo.mutationDocument), 'CreateExportJobFromHook')

    await act(async () => {
      await result.current.exportCSV('ggr', { scope: 'x' }, { from: 'a', to: 'b' })
    })

    // F-REP-02: the processor's format name, and the period under the keys its fetchers read.
    const call = apollo.createExportJob.mock.calls[0][0] as MutationCall
    assert.deepEqual(call.variables, {
      input: {
        reportType: 'ggr',
        exportFormat: 'CSV',
        filtersJson: { scope: 'x', dateRange: { from: 'a', to: 'b' }, dateFrom: 'a', dateTo: 'b' },
      },
    })
    assert.deepEqual(feedback.loading.mock.calls, [['Preparing export...', 0]])
    assert.equal(feedback.hide.mock.calls.length, 1)
    assert.deepEqual(feedback.success.mock.calls, [['Export ready! Downloading...']])
    // The stored fileUrl is only the file's name: the file is asked for by the job's id.
    assert.equal(apollo.query.mock.calls.length, 1)
    const fileOptions = apollo.query.mock.calls[0][0] as { query: unknown; variables: unknown; fetchPolicy: string; context?: { skipNotification?: boolean } }
    assert.equal(operationName(fileOptions.query), 'ExportJobDownloadUrlFromHook')
    assert.deepEqual(fileOptions.variables, { jobId: 'job-1' })
    // The file is not kept in the Apollo cache.
    assert.equal(fileOptions.fetchPolicy, 'no-cache')
    // The hook reports a refusal itself, so the error link does not toast it a second time.
    assert.equal(fileOptions.context?.skipNotification, true)
    assert.equal(clicked.length, 1)
    assert.equal(clicked[0].getAttribute('href'), 'blob:export-1')
    assert.match(clicked[0].download, /^export-\d+\.csv$/)
    assert.equal(clicked[0].isConnected, false)
    assert.equal(saved[0].type, 'text/csv')
    assert.equal(await blobText(saved[0]), 'Date,GGR\n2026-11-04,1200\n')
    assert.deepEqual((window.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls, [['blob:export-1']])
    assert.equal(result.current.loading, false)
  })

  test('Excel sends XLSX and a missing range as null', async () => {
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-2', status: 'completed', fileUrl: 'ggr-job-2.xlsx', errorMessage: null } },
    })
    apollo.query.mockResolvedValueOnce({ data: { exportJobDownloadUrl: fileUri(XLSX, 'PK\u0003\u0004') } })
    const { result } = renderHook(() => useExport())
    await act(async () => {
      await result.current.exportExcel('ggr')
    })
    const call = apollo.createExportJob.mock.calls[0][0] as MutationCall
    assert.deepEqual(call.variables.input, {
      reportType: 'ggr',
      exportFormat: 'XLSX',
      filtersJson: { dateRange: null },
    })
    assert.match(clicked[0].download, /^export-\d+\.xlsx$/)
    assert.equal(saved[0].type, XLSX)
  })

  test('a file the server refuses is reported with its reason, not saved', async () => {
    const reason = 'This export was made before files moved into the database; run it again'
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-9', status: 'completed', fileUrl: 'exports/t/t/ggr-job-9.csv', errorMessage: null } },
    })
    // As the app's client answers it (errorPolicy 'all' for queries): resolved, with no file and the server's errors.
    apollo.query.mockResolvedValueOnce({ data: { exportJobDownloadUrl: null }, errors: [{ message: reason }] })
    const { result } = renderHook(() => useExport())
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    assert.deepEqual(feedback.error.mock.calls, [[reason]])
    assert.deepEqual(feedback.success.mock.calls, [])
    assert.equal(clicked.length, 0)
  })

  test('a request that fails on the way (a thrown network error) is reported too; no answer at all gets the generic line', async () => {
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-10', status: 'completed', fileUrl: 'ggr-job-10.csv', errorMessage: null } },
    })
    apollo.query.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderHook(() => useExport())
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    apollo.query.mockResolvedValueOnce({ data: { exportJobDownloadUrl: null } })
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    // An answer that is not a data URI (an old storage link) is not opened.
    apollo.query.mockResolvedValueOnce({ data: { exportJobDownloadUrl: 'https://files.test/e.csv?signed' } })
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    assert.deepEqual(feedback.error.mock.calls, [['Failed to fetch'], ['Could not get the file'], ['The file the server sent could not be read.']])
    assert.equal(clicked.length, 0)
    assert.deepEqual(feedback.success.mock.calls, [])
  })

  test('says when a job could not be queued', async () => {
    apollo.createExportJob.mockResolvedValue({ data: { createExportJob: null } })
    const { result } = renderHook(() => useExport())
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    assert.equal(feedback.hide.mock.calls.length, 1)
    assert.deepEqual(feedback.error.mock.calls, [['Export could not be queued']])
    assert.equal(clicked.length, 0)
  })

  test('polls the job list and downloads once the file appears', async () => {
    vi.useFakeTimers()
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-3', status: 'pending', fileUrl: null, errorMessage: null } },
    })
    apollo.query
      .mockResolvedValueOnce({ data: { exportJobs: [{ id: 'job-3', status: 'running', fileUrl: null, errorMessage: null }] } })
      .mockResolvedValueOnce({
        data: {
          exportJobs: [
            { id: 'other', status: 'completed', fileUrl: 'https://files.test/other.csv', errorMessage: null },
            { id: 'job-3', status: 'completed', fileUrl: 'ggr-job-3.csv', errorMessage: null },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { exportJobDownloadUrl: fileUri('text/csv', 'job-3') } })
    const { result } = renderHook(() => useExport())
    let done: Promise<void> | undefined
    act(() => {
      done = result.current.exportCSV('ggr')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
      await vi.advanceTimersByTimeAsync(1500)
      await done
    })

    assert.equal(apollo.query.mock.calls.length, 3, 'two polls, then the file')
    const pollOptions = apollo.query.mock.calls[0][0] as { query: unknown; variables: unknown; fetchPolicy: string }
    assert.equal(operationName(pollOptions.query), 'ExportJobStatusFromHook')
    assert.deepEqual(pollOptions.variables, { limit: 20 })
    assert.equal(pollOptions.fetchPolicy, 'network-only')
    assert.deepEqual((apollo.query.mock.calls[2][0] as { variables: unknown }).variables, { jobId: 'job-3' })
    assert.deepEqual(feedback.success.mock.calls, [['Export ready! Downloading...']])
    assert.equal(clicked[0].getAttribute('href'), 'blob:export-1')
    vi.useRealTimers() // jsdom's FileReader answers on a timer
    assert.equal(await blobText(saved[0]), 'job-3')
  })

  test('reports a failed job with its message, or the fallback', async () => {
    vi.useFakeTimers()
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-4', status: 'pending', fileUrl: null, errorMessage: null } },
    })
    apollo.query.mockResolvedValueOnce({
      data: { exportJobs: [{ id: 'job-4', status: 'failed', fileUrl: null, errorMessage: 'Disk full' }] },
    })
    const { result } = renderHook(() => useExport())
    let done: Promise<void> | undefined
    act(() => {
      done = result.current.exportCSV('ggr')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
      await done
    })
    assert.deepEqual(feedback.error.mock.calls, [['Disk full']])
    assert.equal(feedback.hide.mock.calls.length, 1)

    apollo.query.mockResolvedValueOnce({
      data: { exportJobs: [{ id: 'job-4', status: 'failed', fileUrl: null, errorMessage: null }] },
    })
    act(() => {
      done = result.current.exportCSV('ggr')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
      await done
    })
    assert.deepEqual(feedback.error.mock.calls[1], ['Export failed'])
  })

  test('hands a slow export to the Export Centre after ten polls', async () => {
    vi.useFakeTimers()
    apollo.createExportJob.mockResolvedValue({
      data: { createExportJob: { id: 'job-5', status: 'pending', fileUrl: null, errorMessage: null } },
    })
    apollo.query.mockResolvedValue({ data: { exportJobs: [] } })
    const { result } = renderHook(() => useExport())
    let done: Promise<void> | undefined
    act(() => {
      done = result.current.exportCSV('ggr')
    })
    await act(async () => {
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1500)
      await done
    })
    assert.equal(apollo.query.mock.calls.length, 10)
    assert.deepEqual(feedback.info.mock.calls, [
      ['Export is still running. It will appear in the Export Centre when it is ready.'],
    ])
    assert.equal(feedback.hide.mock.calls.length, 1)
    assert.equal(clicked.length, 0)
  })

  test('reports a thrown error with its message, or the fallback, and clears loading', async () => {
    apollo.createExportJob.mockRejectedValueOnce(new Error('Network down'))
    const { result } = renderHook(() => useExport())
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    assert.deepEqual(feedback.error.mock.calls, [['Network down']])
    assert.equal(feedback.hide.mock.calls.length, 1)
    assert.equal(result.current.loading, false)

    apollo.createExportJob.mockRejectedValueOnce({})
    await act(async () => {
      await result.current.exportCSV('ggr')
    })
    assert.deepEqual(feedback.error.mock.calls[1], ['Failed to export data'])
  })

  test('is loading while an export runs', async () => {
    let resolveJob: (value: unknown) => void = () => {}
    apollo.createExportJob.mockReturnValue(new Promise((resolve) => {
      resolveJob = resolve
    }))
    const { result } = renderHook(() => useExport())
    let done: Promise<void> | undefined
    act(() => {
      done = result.current.exportCSV('ggr')
    })
    assert.equal(result.current.loading, true)
    await act(async () => {
      resolveJob({ data: { createExportJob: null } })
      await done
    })
    assert.equal(result.current.loading, false)
  })

  test('exportToCSV warns on no rows and writes an escaped CSV otherwise', async () => {
    const { result } = renderHook(() => useExport())
    result.current.exportToCSV([], 'empty')
    assert.deepEqual(feedback.warning.mock.calls, [['No data to export']])
    assert.equal(clicked.length, 0)

    const created: Blob[] = []
    const urls = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob)
      return 'blob:csv'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    result.current.exportToCSV([{ Name: 'A, B', Note: 'say "hi"', Count: 3, Empty: null }], 'report')
    assert.equal(urls.mock.calls.length, 1)
    assert.equal(clicked[0].getAttribute('download'), 'report.csv')
    assert.deepEqual(revoke.mock.calls, [['blob:csv']])
    assert.equal(created[0].type, 'text/csv;charset=utf-8;')
    // jsdom's Blob has no text(); FileReader reads it
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(created[0])
    })
    assert.equal(csv, 'Name,Note,Count,Empty\n"A, B","say ""hi""",3,')

    result.current.exportToCSV([{ a: 1 }], 'already.csv')
    assert.equal(clicked[1].getAttribute('download'), 'already.csv')
  })
})
