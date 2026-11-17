import { classifyStoredAsset, displayableAsset } from '@shared/utils/dataUri.js'

/**
 * Attach a displayable `qrUrl` to each UPI or USDT payment-method entry.
 *
 * QR images are stored inline as base64 data URIs (owner decision 2026-11-04: S3 is gone), and a data URI is
 * already displayable, so it is handed out as it is (a link too). A legacy S3 object key or S3 URL can no longer
 * be fetched by anyone: both `qrUrl` and `qrKey` read as null for it, so the page shows no QR and a save of the
 * method clears the dead key instead of carrying it on.
 */
export async function attachQrUrls<T extends { qrKey?: string | null }>(
  upis: T[] | null | undefined,
): Promise<(T & { qrUrl: string | null })[]> {
  return (upis || []).map((upi) => {
    const kind = classifyStoredAsset(upi.qrKey)
    const legacy = kind === 's3-key' || kind === 's3-url'
    return { ...upi, ...(legacy ? { qrKey: null } : {}), qrUrl: displayableAsset(upi.qrKey) }
  })
}
