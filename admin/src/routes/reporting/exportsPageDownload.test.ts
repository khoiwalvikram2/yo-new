/**
 * Downloading a finished export (page migration C, W3 Task 128): the URL query, the blob save or the
 * new-tab fallback, and the legacy notification copy, now raised as kit toasts.
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
  target: string
  rel: string
}

const clicks: Clicked[] = []
let fetchMock: ReturnType<typeof vi.fn>
let clickSpy: { mockRestore: () => void } | undefined

function client(answer: unknown) {
  const calls: unknown[] = []
  return {
    calls,
    client: {
      query: async (options: unknown) => {
        calls.push(options)
        if (answer instanceof Error) throw answer
        return { data: answer, loading: false, networkStatus: 7 }
      },
    } as unknown as Parameters<typeof downloadExportFile>[0],
  }
}

beforeEach(() => {
  clicks.length = 0
  feedback.toast.mockClear()
  feedback.dismiss.mockClear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  window.URL.createObjectURL = vi.fn(() => 'blob:export-1')
  window.URL.revokeObjectURL = vi.fn()
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download, target: this.target, rel: this.rel })
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
  test('asks for the URL, saves a relative file as a blob under the given name and says so', async () => {
    const api = client({ exportJobDownloadUrl: '/api/exports/job-1/file' })
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['a,b']) })

    await downloadExportFile(api.client, 'job-1', 'Players Data-2026-10-07-job-1.csv')

    assert.deepEqual(api.calls, [{ query: EXPORT_JOB_DOWNLOAD_URL, variables: { jobId: 'job-1' } }])
    assert.deepEqual(fetchMock.mock.calls[0], [
      '/api/exports/job-1/file',
      { method: 'GET', headers: { Accept: 'application/octet-stream' } },
    ])
    assert.deepEqual(clicks, [{ href: 'blob:export-1', download: 'Players Data-2026-10-07-job-1.csv', target: '', rel: '' }])
    assert.equal((window.URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]?.[0], 'blob:export-1')
    assert.deepEqual(feedback.toast.mock.calls.map((call) => call[0]), [
      PREPARING,
      { title: 'Download Started', message: 'Your file download has started.', tone: 'ok', duration: 4500 },
    ])
    assert.deepEqual(feedback.dismiss.mock.calls, [[41]])
    assert.equal(document.querySelectorAll('a').length, 0, 'the temporary link is removed')
  })

  test('saves an absolute file the same way when it can be fetched', async () => {
    const api = client({ exportJobDownloadUrl: 'https://cdn.example/exports/1.csv' })
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['x']) })
    await downloadExportFile(api.client, 'job-2', 'GGR Reports-2026-10-07-job-2.csv')
    assert.equal(clicks[0]?.href, 'blob:export-1')
    assert.equal(feedback.toast.mock.calls[1]?.[0].message, 'Your file download has started.')
  })

  test('opens an absolute file in a new tab when the fetch is refused or fails', async () => {
    const refused = client({ exportJobDownloadUrl: 'https://cdn.example/exports/2.csv' })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    await downloadExportFile(refused.client, 'job-3', 'file-3.csv')
    assert.deepEqual(clicks[0], {
      href: 'https://cdn.example/exports/2.csv',
      download: 'file-3.csv',
      target: '_blank',
      rel: 'noopener noreferrer',
    })
    assert.deepEqual(feedback.toast.mock.calls[1]?.[0], {
      title: 'Download Started',
      message: 'Your file download has started in a new tab.',
      tone: 'ok',
      duration: 4500,
    })

    const thrown = client({ exportJobDownloadUrl: 'http://cdn.example/exports/3.csv' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await downloadExportFile(thrown.client, 'job-4', 'file-4.csv')
    assert.equal(clicks[1]?.target, '_blank')
    assert.equal(feedback.toast.mock.calls[3]?.[0].message, 'Your file download has started in a new tab.')
    assert.equal(feedback.dismiss.mock.calls.length, 2)
  })

  test('reports a failed relative fetch, a missing URL and a failed query', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    await downloadExportFile(client({ exportJobDownloadUrl: '/api/exports/gone' }).client, 'job-5', 'f.csv')
    assert.deepEqual(feedback.toast.mock.calls[1]?.[0], {
      title: 'Download Failed',
      message: 'HTTP error! status: 404',
      tone: 'error',
      duration: 4500,
    })

    await downloadExportFile(client({ exportJobDownloadUrl: null }).client, 'job-6', 'f.csv')
    assert.equal(feedback.toast.mock.calls[3]?.[0].message, 'Could not get download URL')

    await downloadExportFile(client(new Error('')).client, 'job-7', 'f.csv')
    assert.equal(
      feedback.toast.mock.calls[5]?.[0].message,
      'Failed to download file. Please try again or contact support.',
    )
    assert.equal(feedback.dismiss.mock.calls.length, 3)
    assert.equal(clicks.length, 0)
  })
})
