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

/**
 * A Super Admin in core mode: the casino screens list every whitelabel's games at once, so no
 * per-whitelabel setting (enabled, priority, premium, VIP tiers, bet rules) has a single value,
 * and the server refuses those writes until a whitelabel is selected. Only Master Control applies.
 */
export function isCoreModeView(roles: readonly string[] | null | undefined, directorMode: string | null | undefined): boolean {
  const superAdmin = (roles ?? []).some((role) => {
    const lower = (role ?? '').toLowerCase()
    return role === 'Super Admin' || lower === 'super_admin' || (lower.includes('super') && lower.includes('admin'))
  })
  return superAdmin && directorMode !== 'whitelabel'
}

export const CORE_MODE_HINT =
  'Core mode lists every game on the platform. Master Control switches a game on or off for all whitelabels; select a whitelabel in the top bar to change its own settings.'

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

/**
 * The casinoGames input for one page. "All" sends no category and the server pages the three main
 * categories together; it used to fetch each category with pageSize 10000 and page them here, which
 * lost every game past the server's 10,000 cap and left the last pages empty under a full total.
 */
export function gameQueryInput(filters: GameQueryFilters, category: CasinoMainCategory) {
  return {
    input: {
      providerId: filters.whitelabelAdmin ? undefined : (filters.providerId || undefined),
      category: category === 'ALL' ? undefined : category,
      vendorId: filters.vendorId || undefined,
      vipTierId: filters.vipTierId || undefined,
      search: searchedGameTerm(filters.search),
      enabled: typeof filters.enabled === 'boolean' ? filters.enabled : undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  }
}

/** The input for every game of one vendor in one category, in the saved order (a drag renumbers them all). */
export function vendorOrderQueryInput(
  filters: Pick<GameQueryFilters, 'providerId' | 'whitelabelAdmin'>,
  vendorId: string,
  category: Exclude<CasinoMainCategory, 'ALL'>,
) {
  return {
    input: {
      providerId: filters.whitelabelAdmin ? undefined : (filters.providerId || undefined),
      category,
      vendorId,
      page: 1,
      pageSize: 10000,
    },
  }
}

/** The last page that has games, at least 1. */
export function lastGamesPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
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

/**
 * The vendor's whole order after a drag on one page of it.
 *
 * The page only holds some of the vendor's games, and sending just those had the server number them
 * 1..n: on page 2 they took the same priorities as page 1. The drag left `activeId` beside a
 * neighbour on the visible page (after the one above it, or before the one below when it went to the
 * top); the same move is made in the full list, so every other game keeps its place. Null when the
 * move cannot be placed.
 */
export function reorderVendorGameIds(
  fullIds: readonly string[],
  visibleNext: readonly string[],
  activeId: string,
): string[] | null {
  const index = visibleNext.indexOf(activeId)
  if (index < 0 || !fullIds.includes(activeId)) return null
  const rest = fullIds.filter((id) => id !== activeId)
  const above = index > 0 ? visibleNext[index - 1] : undefined
  if (above !== undefined) {
    const at = rest.indexOf(above)
    if (at < 0) return null
    rest.splice(at + 1, 0, activeId)
    return rest
  }
  const below = visibleNext[index + 1]
  const at = below === undefined ? -1 : rest.indexOf(below)
  if (at < 0) return null
  rest.splice(at, 0, activeId)
  return rest
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

/** The Status column. In core mode there is no whitelabel to be enabled for, so it is the platform flag. */
export function gameAccessStatus(game: Pick<GameRow, 'isActive' | 'tenantEnabled'>, coreMode = false) {
  if (!game.isActive) return { label: 'BLOCKED', tone: 'neg' as const }
  if (coreMode) return { label: 'ACTIVE', tone: 'ok' as const }
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
  coreMode = false,
): CasinoStats {
  const totalProviders = providers.length
  const activeProviders = providers.filter(
    (provider) => String(provider.status ?? 'active').toLowerCase() === 'active',
  ).length
  const gamesTotal = Number(games?.total || 0)
  // Core mode has no whitelabel setting to count, only the platform's Master Control flag.
  const gamesEnabled = (games?.items ?? []).filter((game) => (coreMode ? game.isActive : game.tenantEnabled !== false)).length
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

/**
 * The Games card's figures from two counts of the table's scope (B002): every game, and the enabled ones by the
 * server's Status filter (the whitelabel's switch, or the platform flag in core mode). Counts, not rows, so the
 * All view's whole catalogue is counted; the card read rows only once a vendor was chosen, and said 0 before.
 */
export function casinoGameCounts(total: number | null | undefined, enabled: number | null | undefined) {
  const gamesTotal = Math.max(0, Number(total || 0))
  const gamesEnabled = Math.min(gamesTotal, Math.max(0, Number(enabled || 0)))
  return { gamesTotal, gamesEnabled, gamesDisabled: gamesTotal - gamesEnabled }
}

/** The games query input the cards count with: the table's scope without its search, status, VIP tier or page. */
export function casinoScopeCountInput(
  providerId: string | null,
  category: CasinoMainCategory | null,
  vendorId: string | null,
  whitelabelAdmin: boolean,
) {
  return {
    providerId: whitelabelAdmin ? undefined : (providerId || undefined),
    category: category && category !== 'ALL' ? category : undefined,
    vendorId: vendorId || undefined,
    page: 1,
    pageSize: 1,
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

/**
 * Why the bet form cannot be saved, on the field to mark, or null. The server applies the same
 * rule; a minimum above the maximum used to be stored, and the player could then place no stake.
 */
export function betValuesError(values: BetValues): { field: 'minStake' | 'maxStake' | 'maxWin'; message: string } | null {
  for (const field of ['minStake', 'maxStake', 'maxWin'] as const) {
    const value = values[field]
    if (value != null && value < 0) return { field, message: 'Cannot be negative' }
  }
  if (values.minStake != null && values.maxStake != null && values.minStake > values.maxStake) {
    return { field: 'minStake', message: 'Minimum cannot be above the maximum' }
  }
  return null
}

/** A player in the search list: the name, then the first identifier they have (players sign in by phone). */
export function playerSearchLabel(player: {
  name?: string | null
  username?: string | null
  phone?: string | null
  email?: string | null
  id?: string | null
}): string {
  const name = player.name?.trim() || player.username?.trim() || (player.id ? `User #${player.id}` : 'Player')
  const identifier = [player.username, player.phone, player.email]
    .map((value) => value?.trim())
    .find((value) => value && value !== name)
  return identifier ? `${name} (${identifier})` : name
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
