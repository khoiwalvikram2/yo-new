/**
 * Pure helpers describing how an asset value is stored in the database.
 *
 * Files are stored as base64 data URIs (owner decision 2026-11-04: Amazon S3 is
 * gone, nothing uploads to it or reads from it). Some columns may also hold an
 * external http(s) link. Older rows held S3 object keys (and, for some rows,
 * full S3 URLs): nothing can fetch those any more, so read paths hand them out
 * as null (displayableAsset), and the 2026-11-04 data step cleared them.
 */

/**
 * Deposit proof sentinels that are not files and must never be fetched. 'inline' marks a
 * request whose screenshot is the data URI in proof_data (user-backend depositProof.ts).
 */
const DEPOSIT_SENTINELS = new Set(['welivepay', 'manual', 'proof-missing', 'inline'])

export type StoredAssetKind =
  | 'empty'
  | 'data-uri'
  | 's3-key'
  | 's3-url'
  | 'external-url'
  | 'sentinel'

/** True when the value is already an inline base64 data URI. */
export function isDataUri(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('data:')
}

/** Classify a stored asset value so callers know whether to fetch, skip or inline it. */
export function classifyStoredAsset(value: string | null | undefined): StoredAssetKind {
  if (typeof value !== 'string' || value.length === 0) return 'empty'
  if (isDataUri(value)) return 'data-uri'
  if (DEPOSIT_SENTINELS.has(value)) return 'sentinel'
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.includes('.amazonaws.com/') ? 's3-url' : 'external-url'
  }
  return 's3-key'
}

/**
 * A stored asset as a read path hands it to a page: a data URI or an external
 * URL as stored; anything else as null. A legacy S3 key or S3 URL can no longer
 * be fetched, a deposit sentinel is not a file, and an empty value names none.
 */
export function displayableAsset(value: string | null | undefined): string | null {
  const kind = classifyStoredAsset(value)
  return kind === 'data-uri' || kind === 'external-url' ? (value as string) : null
}

/** Decoded byte size of a data URI's base64 payload; 0 for non-data-URIs. */
export function estimateBase64Bytes(value: string | null | undefined): number {
  if (!isDataUri(value)) return 0
  const comma = (value as string).indexOf(',')
  if (comma === -1) return 0
  const payload = (value as string).slice(comma + 1)
  if (payload.length === 0) return 0
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.floor((payload.length * 3) / 4) - padding
}
