/**
 * Downloading a finished export (page migration C, W3 Task 128): the download query, the blob save and the
 * legacy notification copy, now raised as kit toasts. Since 2026-11-04 the query answers the file itself as a
 * base64 data URI (no external file store), which is decoded and saved with the type it names.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { downloadExportFile } from './exportsPageDownload'
import { EXPORT_JOB_DOWNLOAD_URL } from './exportsPageQueries'

interface ToastCall {
  title?: string
  message: string
  tone?: string
  duration?: number
  busy?: boolean
}

const feedback = vi.hoisted(() => ({
  toast: vi.fn((options: ToastCall) => {
    void options
    return 41
  }),
  dismiss: vi.fn(),
}))

vi.mock('@/ui/components/toast', () => ({
  toast: Object.assign(feedback.toast, { dismiss: feedback.dismiss }),
}))


interface Clicked {
  href: string
  download: string
  blob: Blob | undefined
}

const clicks: Clicked[] = []
let fetchMock: ReturnType<typeof vi.fn>
let clickSpy: { mockRestore: () => void } | undefined
let lastBlob: Blob | undefined

/** A client whose query answers `answer` (an Error is thrown), with `errors` beside it as errorPolicy 'all' does. */
function client(answer: unknown, errors?: Array<{ message: string }>) {
  const calls: unknown[] = []
  return {
    calls,
    client: {
      query: async (options: unknown) => {
        calls.push(options)
        if (answer instanceof Error) throw answer
        return { data: answer, errors, loading: false, networkStatus: 7 }
      },
    } as unknown as Parameters<typeof downloadExportFile>[0],
  }
}

const CSV = 'Player,Deposits\nAsha,1200\n'
const CSV_URI = `data:text/csv;base64,${btoa(CSV)}`
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** jsdom's Blob has no text() or arrayBuffer(); FileReader reads it. */
function blobBytes(blob: Blob | undefined): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    if (!blob) return reject(new Error('no blob'))
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

beforeEach(() => {
  clicks.length = 0
  lastBlob = undefined
  feedback.toast.mockClear()
  feedback.dismiss.mockClear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob
    return 'blob:export-1'
  })
  window.URL.revokeObjectURL = vi.fn()
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download, blob: lastBlob })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  clickSpy?.mockRestore()
})

const PREPARING = {
  title: 'Preparing Download...',
  message: 'Please wait while we prepare your file.',
  tone: 'info',
  busy: true,
}

describe('downloadExportFile', () => {
  test('asks for the file, saves the decoded data URI as a Blob of its type under the given name and says so', async () => {
    const api = client({ exportJobDownloadUrl: CSV_URI })

    await downloadExportFile(api.client, 'job-1', 'Players Data-2026-10-07-job-1.csv')

    // Kept out of the Apollo cache, and reported here rather than by the error link.
    assert.deepEqual(api.calls, [{
      query: EXPORT_JOB_DOWNLOAD_URL,
      variables: { jobId: 'job-1' },
      fetchPolicy: 'no-cache',
      context: { skipNotification: true },
    }])
    assert.equal(fetchMock.mock.calls.length, 0, 'nothing is fetched: the answer is the file')
    assert.equal(clicks.length, 1)
    assert.equal(clicks[0].href, 'blob:export-1')
    assert.equal(clicks[0].download, 'Players Data-2026-10-07-job-1.csv')
    assert.equal(clicks[0].blob?.type, 'text/csv')
    assert.equal(new TextDecoder().decode(await blobBytes(clicks[0].blob)), CSV)
    assert.equal((window.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0], 'blob:export-1')
    assert.deepEqual(feedback.toast.mock.calls.map((call) => call[0]), [
      PREPARING,
      { title: 'Download Started', message: 'Your file download has started.', tone: 'ok', duration: 4500 },
    ])
    assert.deepEqual(feedback.dismiss.mock.calls, [[41]])
    assert.equal(document.querySelectorAll('a').length, 0, 'the temporary link is removed')
  })

  test('an Excel export keeps its spreadsheet type and its bytes', async () => {
    const bytes = String.fromCharCode(80, 75, 3, 4, 0, 255)
    await downloadExportFile(client({ exportJobDownloadUrl: `data:${XLSX};base64,${btoa(bytes)}` }).client, 'job-2', 'GGR Reports-2026-10-07-job-2.xlsx')
    assert.equal(clicks[0]?.download, 'GGR Reports-2026-10-07-job-2.xlsx')
    assert.equal(clicks[0]?.blob?.type, XLSX)
    assert.deepEqual(Array.from(await blobBytes(clicks[0]?.blob)), [80, 75, 3, 4, 0, 255])
    assert.equal(feedback.toast.mock.calls[1]?.[0].title, 'Download Started')
  })

  test("a refusal is a failed download with the server's own words, and nothing is saved", async () => {
    const refused = client(
      { exportJobDownloadUrl: null },
      [{ message: 'This export was made before files moved into the database; run it again' }],
    )
    await downloadExportFile(refused.client, 'job-3', 'file-3.csv')
    assert.equal(clicks.length, 0)
    assert.deepEqual(feedback.toast.mock.calls[1]?.[0], {
      title: 'Download Failed',
      message: 'This export was made before files moved into the database; run it again',
      tone: 'error',
      duration: 4500,
    })
    assert.equal(feedback.toast.mock.calls.some((call) => call[0].title === 'Download Started'), false)
    assert.equal(feedback.dismiss.mock.calls.length, 1)
  })

  test('an answer that is not a data URI (an old storage link) is not opened or fetched', async () => {
    await downloadExportFile(client({ exportJobDownloadUrl: 'https://bucket.example/exports/2.csv?X-Amz-Signature=x' }).client, 'job-4', 'f.csv')
    assert.equal(fetchMock.mock.calls.length, 0)
    assert.equal(clicks.length, 0)
    assert.deepEqual(feedback.toast.mock.calls[1]?.[0], {
      title: 'Download Failed',
      message: 'The file the server sent could not be read.',
      tone: 'error',
      duration: 4500,
    })
  })

  test('reports a missing file and a failed query', async () => {
    await downloadExportFile(client({ exportJobDownloadUrl: null }).client, 'job-6', 'f.csv')
    assert.equal(feedback.toast.mock.calls[1]?.[0].message, 'Could not get the file')

    await downloadExportFile(client(new Error('')).client, 'job-7', 'f.csv')
    assert.equal(
      feedback.toast.mock.calls[3]?.[0].message,
      'Failed to download file. Please try again or contact support.',
    )
    assert.equal(feedback.dismiss.mock.calls.length, 2)
    assert.equal(clicks.length, 0)
  })
})
