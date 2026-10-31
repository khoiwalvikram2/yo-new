import { createHash } from 'node:crypto'

export type SiteAssetSource = 'settings' | 'advertisements' | 'payments'
type Asset = { bytes: Buffer; contentType: string; hash: string }
export const validAssetTenant = (tenant: string) => /^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(tenant)
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const MAX_CACHE_BYTES = 32 * 1024 * 1024
const images = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])

export function decodeSiteImage(value: string | null | undefined): Asset | null {
  if (!value || value.length > MAX_ASSET_BYTES * 1.5) return null
  const match = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(value)
  if (!match || !images.has(match[1].toLowerCase())) return null
  try {
    const contentType = match[1].toLowerCase()
    const bytes = match[2].toLowerCase().includes(';base64') ? Buffer.from(match[3].replace(/\s/g, ''), 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8')
    if (!bytes.length || bytes.length > MAX_ASSET_BYTES) return null
    const hash = createHash('sha256').update(contentType).update('\0').update(bytes).digest('hex')
    return { bytes, contentType, hash }
  } catch { return null }
}

export class SiteAssetCache {
  private values = new Map<string, Asset>()
  private bytes = 0
  constructor(private readonly maxBytes = MAX_CACHE_BYTES) {}
  get(key: string) {
    const asset = this.values.get(key)
    if (asset) { this.values.delete(key); this.values.set(key, asset) }
    return asset
  }
  put(key: string, asset: Asset) {
    const previous = this.values.get(key)
    if (previous) { this.values.delete(key); this.bytes -= previous.bytes.length }
    if (asset.bytes.length > this.maxBytes) return
    this.values.set(key, asset); this.bytes += asset.bytes.length
    while (this.bytes > this.maxBytes) {
      const oldest = this.values.keys().next().value!
      this.bytes -= this.values.get(oldest)!.bytes.length; this.values.delete(oldest)
    }
  }
}
const cache = new SiteAssetCache()
const assetKey = (tenant: string, source: SiteAssetSource, hash: string) => `${tenant}/${source}/${hash}`

/** Stable image bytes travel once as a cacheable asset, instead of in each JSON poll. */
export function siteAssetUrl(value: string | null | undefined, tenant: string, source: SiteAssetSource) {
  if (!validAssetTenant(tenant)) return value
  const asset = decodeSiteImage(value)
  if (!asset) return value
  cache.put(assetKey(tenant, source, asset.hash), asset)
  return `/api/site-assets/${encodeURIComponent(tenant)}/${source}/${asset.hash}`
}

export function settingsVersion(settings: unknown) {
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex')
}

export async function readSiteAsset(tenant: string, source: SiteAssetSource, hash: string) {
  const key = assetKey(tenant, source, hash), existing = cache.get(key)
  if (existing) return existing
  // Rebuild from current source after a process restart, including cached URLs
  // used before the next settings response arrives. No storage writes/uploads.
  const repo = await import('../repos/userAppRepo.js')
  let values: Array<string | null | undefined> = []
  if (source === 'settings') values = (await repo.getAppSettings(tenant)).map(row => row.value)
  else if (source === 'advertisements') values = (await repo.listAdvertisements(tenant)).map(row => row.image)
  else if (source === 'payments') values = (await repo.getWhitelabelAccounts(tenant)).flatMap(row => [row.qrKey, row.qrUrl])
  for (const value of values) {
    const asset = decodeSiteImage(value)
    if (asset?.hash === hash) { cache.put(key, asset); return asset }
  }
  return null
}
