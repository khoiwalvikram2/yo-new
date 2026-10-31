/** Provider `marketName` values allowed for sports DB ingestion (trimmed, case-insensitive, spaces collapsed). */
const ALLOWED_NORMALIZED = new Set(['match odds'])

export const NO_ALLOWED_MARKETS_REASON = 'No Match Odds market'

export function normalizeIngestMarketName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function isAllowedIngestMarketName(name: string): boolean {
  return ALLOWED_NORMALIZED.has(normalizeIngestMarketName(name))
}

/** True if provider returned at least one Match Odds market (normalized name matches allowlist). */
export function eventHasAnyAllowedProviderMarket(markets: unknown[] | null | undefined): boolean {
  for (const m of markets || []) {
    const raw = String((m as { marketName?: string })?.marketName ?? '')
    if (isAllowedIngestMarketName(raw)) return true
  }
  return false
}
