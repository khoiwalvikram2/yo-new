import type { ApolloClient } from '@apollo/client'
import { toast } from '@/ui/components/toast'
import { saveDataUri } from '@/shared/utils/dataUriFile'
import { errorMessageOf } from './exportsPageModel'
import { EXPORT_JOB_DOWNLOAD_URL } from './exportsPageQueries'

/* Downloading a finished export (page migration C, W3 Task 128). The antd notifications are kit toasts with
 * the same titles, texts and timings (antd's 4.5 s default); "Preparing Download..." is a busy toast until the
 * outcome.
 * Owner decision 2026-11-04: no external file store remains. The export is kept in its job row and
 * exportJobDownloadUrl answers the file itself as a base64 data URI, which is decoded into a Blob and saved
 * under the page's file name. A refusal (another tenant's job, an export made before files moved into the
 * database) is the server's own message on "Download Failed". */

type DownloadClient = Pick<ApolloClient<unknown>, 'query'>

const NOTIFICATION_MS = 4500

function started(message: string) {
  toast({ title: 'Download Started', message, tone: 'ok', duration: NOTIFICATION_MS })
}

export async function downloadExportFile(client: DownloadClient, jobId: string, filename: string): Promise<void> {
  const preparing = toast({
    title: 'Preparing Download...',
    message: 'Please wait while we prepare your file.',
    tone: 'info',
    busy: true,
  })

  try {
    // The client answers a refusal with its errors (errorPolicy 'all'); this toast reports it, so the error
    // link raises none of its own. The file is not kept in the Apollo cache (it can run to megabytes).
    const { data, errors } = await client.query<{ exportJobDownloadUrl: string | null }>({
      query: EXPORT_JOB_DOWNLOAD_URL,
      variables: { jobId },
      fetchPolicy: 'no-cache',
      context: { skipNotification: true },
    })
    const fileData = data?.exportJobDownloadUrl
    if (!fileData) {
      throw new Error(errors?.[0]?.message || 'Could not get the file')
    }
    saveDataUri(fileData, filename || `export-${Date.now()}.csv`)
    toast.dismiss(preparing)
    started('Your file download has started.')
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
