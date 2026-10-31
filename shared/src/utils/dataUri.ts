/**
 * Pure helpers describing how an asset value is stored in the database.
 *
 * Historically these columns held Amazon S3 object keys (and, for some rows,
 * full S3 URLs). They now hold base64 data URIs. Read paths must be able to
 * tell the shapes apart, and the backfill script must classify legacy values.
 */

/** Deposit proof sentinels that are not files and must never be fetched. */
const DEPOSIT_SENTINELS = new Set(['welivepay', 'manual', 'proof-missing'])

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
