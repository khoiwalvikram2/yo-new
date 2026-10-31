import { classifyStoredAsset } from '@shared/utils/dataUri.js'

export interface QrKeyLike {
  qrKey?: string | null
}

/**
 * Given a UPI list before and after an update, return the S3 object keys whose QR
 * image is no longer referenced and should be deleted from storage.
 *
 * A UPI's QR is stored in `qrKey`, which is either an inline base64 data URI (new
 * format — no file to delete) or a legacy S3 object key like `deposits/<ts>-<rand>.png`.
 * When an edit replaces the QR, removes it, or deletes the whole UPI, the old S3
 * object is otherwise left orphaned in the bucket. This computes exactly those
 * stale keys so the caller can delete them.
 *
 * Rules:
 *  - only true S3 object keys are returned (data URIs, sentinels like 'welivepay'/
 *    'manual', and external URLs are never ours to delete);
 *  - a key still present in the new list (QR unchanged, or reused by another UPI) is
 *    never returned;
 *  - duplicates are collapsed.
 */
export function computeOrphanedQrKeys(oldUpis: QrKeyLike[], newUpis: QrKeyLike[]): string[] {
  const stillReferenced = new Set<string>()
  for (const u of newUpis) {
    if (u.qrKey) stillReferenced.add(u.qrKey)
  }

  const orphans: string[] = []
  const seen = new Set<string>()
  for (const u of oldUpis) {
    const key = u.qrKey
    if (!key) continue
    if (stillReferenced.has(key)) continue
    if (seen.has(key)) continue
    if (classifyStoredAsset(key) !== 's3-key') continue
    seen.add(key)
    orphans.push(key)
  }
  return orphans
}
