import type { CasinoMainCategory } from '@/state/casinoStore'

export type ViewMode = 'table' | 'grid'
export type DrawerMode = 'single' | 'bulk'
export type DrawerTab = 'main' | 'betSettings'
export type BetTargetTab = 'all' | 'specific'

export interface CasinoProvider {
  id: string
  name: string
  key?: string | null
  status?: string | null
  lastSyncAt?: string | null
}

export interface CasinoVendor {
  id: string
  name: string
  slug?: string | null
}

export interface VipTier {
  id: string
  name: string
  level?: number | null
  color?: string | null
}

export interface GameVipTier {
  tierId: string
  tierName?: string | null
  enabled?: boolean | null
  updatedAt?: string | null
}

export interface GameRow {
  id: string
  name: string
  slug: string
  mainCategory: Exclude<CasinoMainCategory, 'ALL'>
  vendorId: string
  vendorName: string
  thumbnailUrl?: string | null
  rtp?: number | null
  demoUrl?: string | null
  isActive: boolean
  tenantEnabled?: boolean | null
  premiumOnly?: boolean | null
  betSettingsCount?: number | null
  order?: number | null
  featured?: boolean | null
  categoryAssigned?: boolean | null
  limits?: {
    minStake?: number | null
    maxStake?: number | null
    maxWin?: number | null
    maxWinTarget?: string | null
    maxWinPlayers?: string[] | null
  } | null
  updatedAt?: string | null
}

export interface GamesPage {
  total: number
  page: number
  pageSize: number
  items: GameRow[]
}

export interface BetSetting {
  id: string
  gameId: string
  playerId?: string | null
  playerName?: string | null
  playerPhone?: string | null
  betEnabled: boolean
  minStake?: number | null
  maxStake?: number | null
  maxWin?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

export interface BetTargetPlayer {
  id: string
  label: string
}

export interface BetValues {
  betEnabled: boolean
  minStake: number | null
  maxStake: number | null
  maxWin: number | null
}

export const EMPTY_BET_VALUES: BetValues = {
  betEnabled: true,
  minStake: null,
  maxStake: null,
  maxWin: null,
}

export const CATEGORY_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'LIVE_CASINO', label: 'Live' },
  { value: 'CASINO', label: 'Casino' },
  { value: 'SLOTS', label: 'Slots' },
] as const

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
] as const

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export function isWhitelabelAdminRole(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((role) => {
    const normalised = role.toLowerCase()
    return normalised.includes('whitelabel') || normalised.includes('tenant')
  })
}

export function searchedGameTerm(search: string): string | undefined {
  const trimmed = search.trim()
  return trimmed.length >= 3 ? trimmed : undefined
}

export interface GameQueryFilters {
  providerId: string | null
  vendorId: string | null
  vipTierId: string | null
  search: string
  enabled: boolean | null
  page: number
  pageSize: number
  whitelabelAdmin: boolean
}

export function gameQueryInput(
  filters: GameQueryFilters,
  category: Exclude<CasinoMainCategory, 'ALL'>,
  allCategories: boolean,
) {
  return {
    input: {
      providerId: filters.whitelabelAdmin ? undefined : (filters.providerId || undefined),
      category,
      vendorId: filters.vendorId || undefined,
      vipTierId: filters.vipTierId || undefined,
      search: searchedGameTerm(filters.search),
      enabled: typeof filters.enabled === 'boolean' ? filters.enabled : undefined,
      page: allCategories ? 1 : filters.page,
      pageSize: allCategories ? 10000 : filters.pageSize,
    },
  }
}

export function shouldSkipGames(
  providerId: string | null,
  category: CasinoMainCategory | null,
  whitelabelAdmin: boolean,
  requested: CasinoMainCategory,
): boolean {
  if (!whitelabelAdmin && !providerId) return true
  if (!category) return true
  return requested === 'ALL' ? category !== 'ALL' : category !== requested
}

export function vendorVariables(
  providerId: string | null,
  category: CasinoMainCategory | null,
  whitelabelAdmin: boolean,
) {
  return {
    providerId: whitelabelAdmin ? undefined : (providerId || undefined),
    category: category && category !== 'ALL' ? category : undefined,
  }
}

export function combineAllCategoryGames(
  pages: readonly (GamesPage | null | undefined)[],
  selectedVendorId: string | null,
  page: number,
  pageSize: number,
): GamesPage {
  const allItems = pages.flatMap((result) => result?.items ?? [])
  const totalFromQueries = pages.reduce((total, result) => total + Number(result?.total || 0), 0)
  const filtered = selectedVendorId
    ? allItems.filter((game) => String(game.vendorId) === selectedVendorId)
    : allItems
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize)
  return {
    total: selectedVendorId ? filtered.length : totalFromQueries,
    page,
    pageSize,
    items: filtered.slice(start, start + pageSize),
  }
}

export function sortGameRows(items: readonly GameRow[]): GameRow[] {
  return [...items].sort((left, right) => {
    const leftOrder = left.order ?? 999999
    const rightOrder = right.order ?? 999999
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return (left.name || '').localeCompare(right.name || '')
  })
}

export function moveGameId(ids: readonly string[], activeId: string, overId: string | null): string[] | null {
  if (!overId || activeId === overId) return null
  const oldIndex = ids.indexOf(activeId)
  const newIndex = ids.indexOf(overId)
  if (oldIndex < 0 || newIndex < 0) return null
  const next = [...ids]
  const [moved] = next.splice(oldIndex, 1)
  next.splice(newIndex, 0, moved)
  return next
}

export function canReorderGames(vendorId: string | null, category: CasinoMainCategory | null): boolean {
  return Boolean(vendorId && category && category !== 'ALL')
}

export function toggleSelection(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

export function paginationCopy(page: number, pageSize: number, total: number): string {
  if (total <= 0) return 'Showing 0 of 0 games'
  const start = (Math.max(1, page) - 1) * pageSize + 1
  const end = Math.min(Math.max(1, page) * pageSize, total)
  return `Showing ${start}–${end} of ${total.toLocaleString()} ${total === 1 ? 'game' : 'games'}`
}

export function gameAccessStatus(game: Pick<GameRow, 'isActive' | 'tenantEnabled'>) {
  if (!game.isActive) return { label: 'BLOCKED', tone: 'neg' as const }
  if (game.tenantEnabled) return { label: 'ENABLED', tone: 'ok' as const }
  return { label: 'DISABLED', tone: 'muted' as const }
}

export interface CasinoStats {
  totalProviders: number
  activeProviders: number
  inactiveProviders: number
  totalVendors: number
  gamesTotal: number
  gamesEnabled: number
  gamesDisabled: number
  activeRate: number
}

export function casinoStats(
  providers: readonly CasinoProvider[],
  vendors: readonly CasinoVendor[],
  games: Pick<GamesPage, 'total' | 'items'> | null | undefined,
): CasinoStats {
  const totalProviders = providers.length
  const activeProviders = providers.filter(
    (provider) => String(provider.status ?? 'active').toLowerCase() === 'active',
  ).length
  const gamesTotal = Number(games?.total || 0)
  const gamesEnabled = (games?.items ?? []).filter((game) => game.tenantEnabled !== false).length
  return {
    totalProviders,
    activeProviders,
    inactiveProviders: totalProviders - activeProviders,
    totalVendors: vendors.length,
    gamesTotal,
    gamesEnabled,
    gamesDisabled: gamesTotal - gamesEnabled,
    activeRate: totalProviders > 0 ? Math.round((activeProviders / totalProviders) * 100) : 0,
  }
}

function limitKey(setting: BetSetting): string {
  return `${setting.minStake ?? ''}_${setting.maxStake ?? ''}_${setting.maxWin ?? ''}_${Boolean(setting.betEnabled)}`
}

export interface BetSettingGroup {
  key: string
  settings: BetSetting[]
  isAllPlayers: boolean
}

export function groupBetSettings(settings: readonly BetSetting[]): BetSettingGroup[] {
  const groups: BetSettingGroup[] = []
  const append = (rows: BetSetting[], isAllPlayers: boolean) => {
    const grouped = new Map<string, BetSetting[]>()
    for (const setting of rows) {
      const key = limitKey(setting)
      const current = grouped.get(key) ?? []
      current.push(setting)
      grouped.set(key, current)
    }
    for (const rowsWithLimits of grouped.values()) {
      const first = rowsWithLimits[0]
      groups.push({
        key: `${isAllPlayers ? 'all' : 'specific'}-${limitKey(first)}${isAllPlayers ? '' : `-${first.id}`}`,
        settings: rowsWithLimits,
        isAllPlayers,
      })
    }
  }
  append(settings.filter((setting) => !setting.playerId), true)
  append(settings.filter((setting) => Boolean(setting.playerId)), false)
  return groups
}

export function betValuesFromSetting(setting: BetSetting | null | undefined): BetValues {
  return setting
    ? {
        betEnabled: setting.betEnabled,
        minStake: setting.minStake ?? null,
        maxStake: setting.maxStake ?? null,
        maxWin: setting.maxWin ?? null,
      }
    : { ...EMPTY_BET_VALUES }
}

export function betTargetIds(tab: BetTargetTab, players: readonly BetTargetPlayer[]): (string | null)[] {
  return tab === 'specific' ? players.map((player) => player.id) : [null]
}

export function betSettingsVariables(gameId: string, playerId: string | null, values: BetValues) {
  return {
    gameId,
    settings: {
      playerId: playerId ?? undefined,
      betEnabled: values.betEnabled ?? true,
      minStake: values.minStake ?? undefined,
      maxStake: values.maxStake ?? undefined,
      maxWin: values.maxWin ?? undefined,
    },
  }
}

export function enabledVipTierIds(settings: readonly GameVipTier[]): Set<string> {
  return new Set(settings.filter((setting) => setting.enabled).map((setting) => String(setting.tierId)))
}

export function vipTierDiff(original: ReadonlySet<string>, next: ReadonlySet<string>) {
  return {
    enable: [...next].filter((tierId) => !original.has(tierId)),
    disable: [...original].filter((tierId) => !next.has(tierId)),
  }
}

export function categoryLabel(category: CasinoMainCategory | null): string | null {
  if (!category) return null
  return category === 'ALL' ? 'All Categories' : category.replace('_', ' ')
}
