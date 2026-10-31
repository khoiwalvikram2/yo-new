import type { BundleDomain } from '../bundleCreateEditModel'

export type CasinoCategory = 'SLOTS' | 'CASINO' | 'LIVE_CASINO'

export interface SelectorFilters {
  search: string
  providerId: string
  vendorId: string
}

export interface CasinoGameRow {
  id: string | number
  name?: string | null
  vendorId?: string | number | null
  vendorName?: string | null
  mainCategory?: string | null
  thumbnailUrl?: string | null
}

export interface MatkaRow {
  id: string | number
  name?: string | null
  code?: string | null
  description?: string | null
  status?: string | null
  timezone?: string | null
}

export const SELECTOR_PAGE_SIZE = 50
export const SELECTOR_FETCH_SIZE = 200

export function searchTerm(search: string): string | undefined {
  const term = search.trim()
  return term.length >= 2 ? term : undefined
}

export function casinoGamesVariables(category: CasinoCategory, filters: SelectorFilters) {
  return {
    input: {
      category,
      providerId: filters.providerId || undefined,
      vendorId: filters.vendorId || undefined,
      search: searchTerm(filters.search),
      page: 1,
      pageSize: SELECTOR_FETCH_SIZE,
    },
  }
}

export function matkaVariables(search: string) {
  return {
    filters: {
      query: searchTerm(search),
      status: 'ACTIVE',
    },
  }
}

export function activeSelectorFilterCount(domain: BundleDomain, filters: SelectorFilters): number {
  return domain === 'casino'
    ? [filters.search, filters.providerId, filters.vendorId].filter(Boolean).length
    : domain === 'matka'
      ? Number(Boolean(filters.search))
      : 0
}

export function casinoRowsForPage(
  games: readonly CasinoGameRow[],
  vendorId: string,
  page: number,
  pageSize: number,
): { rows: CasinoGameRow[]; total: number } {
  const filtered = vendorId
    ? games.filter((game) => String(game.vendorId) === vendorId)
    : [...games]
  const safePage = Math.max(1, Math.trunc(page) || 1)
  const safeSize = Math.max(1, Math.trunc(pageSize) || SELECTOR_PAGE_SIZE)
  const start = (safePage - 1) * safeSize
  return { rows: filtered.slice(start, start + safeSize), total: filtered.length }
}

export function filteredMatkas(markets: readonly MatkaRow[], search: string): MatkaRow[] {
  const query = searchTerm(search)?.toLocaleLowerCase('en-US')
  if (!query) return [...markets]
  return markets.filter((market) => [market.name, market.code, market.description]
    .some((value) => value?.toLocaleLowerCase('en-US').includes(query)))
}

export function nextSelection(
  selected: readonly string[],
  visible: readonly { id: string | number }[],
  checked: boolean,
): string[] {
  const next = new Set(selected.map(String))
  for (const item of visible) {
    const id = String(item.id)
    if (checked) next.add(id)
    else next.delete(id)
  }
  return [...next]
}

