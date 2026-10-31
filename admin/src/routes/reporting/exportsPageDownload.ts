import type { ApolloClient } from '@apollo/client'
import { toast } from '@/ui/components/toast'
import { errorMessageOf } from './exportsPageModel'
import { EXPORT_JOB_DOWNLOAD_URL } from './exportsPageQueries'

/* Downloading a finished export (page migration C, W3 Task 128). Moved out of ExportsPage.tsx's
 * handleDownload with the same steps: ask the server for the file's URL, then fetch it as a blob and
 * save it under the page's file name; an absolute URL that cannot be fetched (a CORS refusal, a failed
 * request) opens in a new tab instead. The antd notifications are kit toasts with the same titles, texts
 * and timings (antd's 4.5 s default); "Preparing Download..." is a busy toast until the outcome. */

type DownloadClient = Pick<ApolloClient<unknown>, 'query'>

const NOTIFICATION_MS = 4500

function clickLink(href: string, filename: string, newTab: boolean) {
  const link = document.createElement('a')
  link.href = href
  link.download = filename || `export-${Date.now()}.csv`
  if (newTab) {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function saveBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  clickLink(url, filename, false)
  window.URL.revokeObjectURL(url)
}

function started(message: string) {
  toast({ title: 'Download Started', message, tone: 'ok', duration: NOTIFICATION_MS })
}

async function fetchFile(fileUrl: string): Promise<Response> {
  return fetch(fileUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/octet-stream',
    },
  })
}

export async function downloadExportFile(client: DownloadClient, jobId: string, filename: string): Promise<void> {
  const preparing = toast({
    title: 'Preparing Download...',
    message: 'Please wait while we prepare your file.',
    tone: 'info',
    busy: true,
  })

  try {
    const { data } = await client.query<{ exportJobDownloadUrl: string }>({
      query: EXPORT_JOB_DOWNLOAD_URL,
      variables: { jobId },
    })
    const fileUrl = data?.exportJobDownloadUrl
    if (!fileUrl) {
      throw new Error('Could not get download URL')
    }

    // Use presigned or returned URL for download
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // For external URLs (S3, CDN), try to download directly; a server without CORS headers refuses
      // the fetch, so the file opens in a new tab instead.
      try {
        const response = await fetchFile(fileUrl)
        if (response.ok) {
          saveBlob(await response.blob(), filename)
          toast.dismiss(preparing)
          started('Your file download has started.')
        } else {
          clickLink(fileUrl, filename, true)
          toast.dismiss(preparing)
          started('Your file download has started in a new tab.')
        }
      } catch {
        clickLink(fileUrl, filename, true)
        toast.dismiss(preparing)
        started('Your file download has started in a new tab.')
      }
    } else {
      // For relative URLs or API endpoints, fetch and download
      const response = await fetchFile(fileUrl)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      saveBlob(await response.blob(), filename)
      toast.dismiss(preparing)
      started('Your file download has started.')
    }
  } catch (error: unknown) {
    toast.dismiss(preparing)
    toast({
      title: 'Download Failed',
      message: errorMessageOf(error) || 'Failed to download file. Please try again or contact support.',
      tone: 'error',
      duration: NOTIFICATION_MS,
    })
  }
}
