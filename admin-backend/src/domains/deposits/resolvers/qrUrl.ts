import { isDataUri } from '@shared/utils/dataUri.js'

/**
 * Attach a displayable `qrUrl` to each UPI payment-method entry.
 *
 * QR images are stored inline as base64 data URIs. A data URI is already
 * displayable and must never be handed to the S3 presigner: doing so produces a
 * signed URL for a key that does not exist, and the admin panel and both player
 * apps render a broken image. Legacy rows still hold an S3 object key and are
 * presigned as before until the backfill converts them.
 */
export async function attachQrUrls<T extends { qrKey?: string | null }>(
  upis: T[] | null | undefined,
): Promise<(T & { qrUrl: string | null })[]> {
  const { generatePresignedGetUrl } = await import('@/services/storage/s3.js')

  return Promise.all(
    (upis || []).map(async (upi) => {
      let qrUrl: string | null = null

      if (isDataUri(upi.qrKey)) {
        qrUrl = upi.qrKey as string
      } else if (upi.qrKey) {
        try {
          qrUrl = await generatePresignedGetUrl(upi.qrKey, 3600)
        } catch {
          // A missing or unreachable object simply renders no QR.
        }
      }

      return { ...upi, qrUrl }
    }),
  )
}
