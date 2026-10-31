export type CasinoMainCategory = 'LIVE_CASINO' | 'CASINO' | 'SLOTS'
export type CasinoCategoryType = 'GENERAL' | 'TOP' | 'FEATURED' | 'LOUNGE'
export type QuickFilter = 'all' | 'enabled' | 'disabled' | 'premium' | 'selected'
export type CategoryFilter = 'all' | 'in-categories' | 'not-in-categories'
export type GameSort = 'name' | 'vendor' | 'rtp' | 'popular'
export type ViewMode = 'grid' | 'list'

export interface CatalogGame {
  id: string
  name: string
  slug: string
  vendorId?: string
  vendorName?: string
  thumbnailUrl?: string
  enabled: boolean
  featured: boolean
  premiumOnly: boolean
  rtp?: number
  categoryAssigned: boolean
}

export interface RawCatalogGame {
  id: unknown
  name?: unknown
  slug?: unknown
  vendorId?: unknown
  vendorName?: unknown
  thumbnailUrl?: unknown
  tenantEnabled?: unknown
  featured?: unknown
  premiumOnly?: unknown
  rtp?: unknown
  categoryAssigned?: unknown
}

export const QUICK_FILTER_OPTIONS = [
  { value: 'all', label: 'All games' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'premium', label: 'Premium' },
  { value: 'selected', label: 'Selected' },
] as const

export const CATEGORY_FILTER_OPTIONS = [
  { value: 'all', label: 'All category states' },
  { value: 'in-categories', label: 'In any category' },
  { value: 'not-in-categories', label: 'Not in any category' },
] as const

export const SORT_OPTIONS = [
  { value: 'name', label: 'By name' },
  { value: 'vendor', label: 'By vendor' },
  { value: 'rtp', label: 'By RTP' },
  { value: 'popular', label: 'Popular' },
] as const

export const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
] as const

const optionalString = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined
  return String(value)
}

export function mapCatalogGame(game: RawCatalogGame): CatalogGame {
  const numericRtp = game.rtp === null || game.rtp === undefined || game.rtp === ''
    ? undefined
    : Number(game.rtp)
  return {
    id: String(game.id),
    name: optionalString(game.name) ?? 'Unnamed game',
    slug: optionalString(game.slug) ?? '',
    vendorId: optionalString(game.vendorId),
    vendorName: optionalString(game.vendorName),
    thumbnailUrl: optionalString(game.thumbnailUrl),
    enabled: game.tenantEnabled !== false,
    featured: Boolean(game.featured),
    premiumOnly: Boolean(game.premiumOnly),
    rtp: numericRtp !== undefined && Number.isFinite(numericRtp) ? numericRtp : undefined,
    categoryAssigned: Boolean(game.categoryAssigned),
  }
}

export function mergeCatalogPages(
  current: readonly CatalogGame[],
  incoming: readonly CatalogGame[],
  page: number,
) {
  if (page === 1) return [...incoming]
  const ids = new Set(current.map((game) => game.id))
  return [...current, ...incoming.filter((game) => !ids.has(game.id))]
}

export function selectionDiff(current: readonly unknown[], selected: ReadonlySet<string>) {
  const currentIds = current.map(String)
  const currentSet = new Set(currentIds)
  return {
    remove: currentIds.filter((id) => !selected.has(id)),
    add: [...selected].filter((id) => !currentSet.has(id)),
  }
}

export function filterAndSortGames({
  games,
  selectedIds,
  selectedDetails,
  quickFilter,
  categoryFilter,
  sortBy,
}: {
  games: readonly CatalogGame[]
  selectedIds: ReadonlySet<string>
  selectedDetails: Readonly<Record<string, CatalogGame>>
  quickFilter: QuickFilter
  categoryFilter: CategoryFilter
  sortBy: GameSort
}) {
  let result = quickFilter === 'selected'
    ? [...selectedIds].map((id) => selectedDetails[id]).filter((game): game is CatalogGame => Boolean(game))
    : [...games]

  if (quickFilter === 'enabled') result = result.filter((game) => game.enabled)
  if (quickFilter === 'disabled') result = result.filter((game) => !game.enabled)
  if (quickFilter === 'premium') result = result.filter((game) => game.premiumOnly)
  if (categoryFilter === 'in-categories') result = result.filter((game) => game.categoryAssigned)
  if (categoryFilter === 'not-in-categories') result = result.filter((game) => !game.categoryAssigned)

  if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name))
  if (sortBy === 'vendor') result.sort((a, b) => (a.vendorName ?? '').localeCompare(b.vendorName ?? ''))
  if (sortBy === 'rtp') result.sort((a, b) => (b.rtp ?? 0) - (a.rtp ?? 0))
  return result
}

export function filterSelectedGames(
  selectedIds: ReadonlySet<string>,
  selectedDetails: Readonly<Record<string, CatalogGame>>,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...selectedIds]
  return [...selectedIds].filter((id) => {
    const game = selectedDetails[id]
    if (!game) return id.toLocaleLowerCase().includes(needle)
    return [game.name, game.vendorName, game.slug]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(needle))
  })
}

export function shouldLoadNextPage({
  intersecting,
  loading,
  networkStatus,
  clientFilterActive,
  loaded,
  total,
}: {
  intersecting: boolean
  loading: boolean
  networkStatus: number
  clientFilterActive: boolean
  loaded: number
  total: number
}) {
  return intersecting && !loading && networkStatus !== 2 && networkStatus !== 3 && !clientFilterActive && loaded < total
}

export function categoryLabel(value: string) {
  if (value === 'LOUNGE') return 'Casino lounge'
  return value.replaceAll('_', ' ')
}

export function hasActiveFilters(
  query: string,
  vendorId: string,
  quickFilter: QuickFilter,
  categoryFilter: CategoryFilter,
  sortBy: GameSort,
) {
  return Boolean(query || vendorId || quickFilter !== 'all' || categoryFilter !== 'all' || sortBy !== 'name')
}
