/* /reporting/casino's page logic (page migration C, W3 Task 130), lifted from the legacy
   CasinoOverviewReport.tsx without React, Apollo or antd so it can be tested directly. Every rule
   keeps the legacy branch, wording and arithmetic; where a rule changed, its doc says so and the
   record names it. */

import type { StatusPillTone } from '@/ui/components/StatusPill'
import { REPORTING_ALL_TIME_FROM, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import type { DetailFilter } from '@/modules/reporting/ui/drillDownModel'
import type { DrillDownLevel, ReportingFilters } from '@/state/reportingStore'

/* ============================== Levels ============================== */

/** The page's own drill-down levels: all -> vendor -> game (a game is a leaf, selected in place). */
export const CASINO_LEVEL_TYPES: readonly DrillDownLevel['type'][] = ['vendor', 'game']

export type CasinoLevel = DrillDownLevel['type']

/** Legacy getNextLevel: all -> vendor, vendor -> game, anything else has no next level. */
export function casinoNextLevel(currentLevel: string): CasinoLevel | null {
  const hierarchy: Record<string, CasinoLevel> = {
    all: 'vendor',
    vendor: 'game',
  }
  return hierarchy[currentLevel] ?? null
}

/** The level the table shows: the last pushed level, or 'all'. */
export function casinoCurrentLevel(path: readonly DrillDownLevel[]): CasinoLevel {
  return path.length > 0 ? path[path.length - 1].type : 'all'
}

/** A path left in the shared store by another report (sport, league, event…) is reset on mount. */
export function isPathFromOtherReport(path: readonly DrillDownLevel[]): boolean {
  return path.length > 0 && path.some((level) => !CASINO_LEVEL_TYPES.includes(level.type))
}

/** How many levels a crumb at `index` pops (the legacy loop count). */
export function levelsToPop(pathLength: number, index: number): number {
  return pathLength - index - 1
}

export interface CasinoCrumb {
  label: string
  key: string
  value?: string | number
}

export function casinoCrumbs(path: readonly DrillDownLevel[]): CasinoCrumb[] {
  return path.map((level) => ({ label: level.name, key: level.type, value: level.id }))
}

/* ============================== Query filter ============================== */

/** Only fields CasinoDrillDownFilter accepts pass from the shared store (no schemeType, domain…). */
export const CASINO_FILTER_KEYS = [
  'tenant',
  'whitelabelId',
  'dateFrom',
  'dateTo',
  'providerId',
  'vendorId',
  'gameId',
  'agentId',
  'playerId',
  'currency',
] as const

export type ActiveFilters = Record<string, { value: string | number; label: string } | undefined>

/** The page's query filter, as the legacy useMemo built it (keys in the same order). */
export type CasinoReportFilter = Record<string, unknown>

export function casinoReportFilter(
  filters: ReportingFilters | null | undefined,
  path: readonly DrillDownLevel[],
  activeFilters: ActiveFilters | null | undefined,
  today: string,
): CasinoReportFilter {
  const f = (filters ?? {}) as Record<string, unknown>
  const baseFilter: CasinoReportFilter = {
    dateFrom: f.dateFrom || REPORTING_ALL_TIME_FROM,
    dateTo: f.dateTo || today,
    currency: f.currency ?? undefined,
  }
  CASINO_FILTER_KEYS.forEach((key) => {
    const v = f[key]
    if (v !== undefined && v !== null) baseFilter[key] = v
  })

  path.forEach((level) => {
    if (level.type === 'vendor') baseFilter.vendorId = level.id
  })

  Object.entries(activeFilters ?? {}).forEach(([key, entry]) => {
    if (entry && typeof entry === 'object' && 'value' in entry && (CASINO_FILTER_KEYS as readonly string[]).includes(key)) {
      baseFilter[key] = entry.value
    }
  })

  return baseFilter
}

/**
 * The contributors panel's filter: the page filter, the drilled vendor, the selected game and the
 * refresh key. The page filter's other fields ride along untyped, as before; the panel reads only the
 * DetailFilter fields.
 */
export function casinoSidebarFilter(
  filter: CasinoReportFilter,
  path: readonly DrillDownLevel[],
  selectedGameId: string | null,
  refreshKey: number,
): DetailFilter & CasinoReportFilter {
  const vendorLevel = path.find((level) => level.type === 'vendor')
  return {
    ...filter,
    vendorId: vendorLevel?.id,
    gameId: selectedGameId ?? undefined,
    _refreshKey: refreshKey, // forces the contributors queries to refetch on Refresh
  } as DetailFilter & CasinoReportFilter
}

export interface CasinoChip {
  key: string
  label: string
  value: string | number
}

/** The chips for the shared store's active filters: the label, else the key; the value, else ''. */
export function casinoFilterChips(activeFilters: ActiveFilters | null | undefined): CasinoChip[] {
  return Object.entries(activeFilters ?? {})
    .filter(([, entry]) => entry && typeof entry === 'object' && 'value' in entry)
    .map(([key, entry]) => ({
      key,
      label: entry?.label ?? key,
      value: (entry?.value ?? '') as string | number,
    }))
}

/* ============================== Rows ============================== */

/** One breakdown row as CasinoVendorBreakdown / CasinoGameBreakdown return it. */
export interface CasinoBreakdownRecord {
  vendorId?: string | number | null
  vendorName?: string | null
  providerId?: string | number | null
  gameId?: string | number | null
  gameName?: string | null
  totalStakes?: number | null
  totalPayouts?: number | null
  grossGamingRevenue?: number | null
  betCount?: number | null
  playerCount?: number | null
  gameCount?: number | null
  rtp?: number | string | null
}

/** The legacy search: a vendor by name; a game by its name or its vendor's; spaces alone do not filter. */
export function filterCasinoRows(
  rows: readonly CasinoBreakdownRecord[],
  searchQuery: string,
  level: string,
): CasinoBreakdownRecord[] {
  if (!searchQuery.trim()) return [...rows]
  const query = searchQuery.toLowerCase()
  return rows.filter((item) => {
    if (level === 'all') {
      return item.vendorName?.toLowerCase().includes(query)
    }
    if (level === 'vendor') {
      return item.gameName?.toLowerCase().includes(query) || item.vendorName?.toLowerCase().includes(query)
    }
    return true
  })
}

export const CASINO_DEFAULT_PAGE_SIZE = 20
export const CASINO_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]

export function casinoPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

/**
 * The page the table shows. The legacy table kept a page past the end (after a crumb back to a
 * shorter level, for one) and sliced nothing from it, so it showed "No data" under a pager that
 * already read page 1; the page is now clamped into range before slicing.
 */
export function clampCasinoPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), casinoPageCount(total, pageSize))
}

export function casinoPageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, pageSize)
  const start = (clampCasinoPage(page, rows.length, size) - 1) * size
  return rows.slice(start, start + size)
}

export function casinoSummary(total: number): string {
  return `Total ${total} items`
}

/** Legacy rowKey: the vendor or game id, else a positional key. */
export function casinoRowKey(level: string, record: CasinoBreakdownRecord, index: number): string {
  if (level === 'all') return record.vendorId != null ? String(record.vendorId) : `vendor-${index}`
  if (level === 'vendor') return record.gameId != null ? String(record.gameId) : `game-${index}`
  return `row-${index}`
}

/** The row drawn as selected: the selected game, at the vendor level only. */
export function selectedCasinoRowKey(level: string, selectedGameId: string | null): string | undefined {
  return level === 'vendor' && selectedGameId !== null ? selectedGameId : undefined
}

export type CasinoRowAction =
  | { kind: 'select'; gameId: string | null }
  | { kind: 'drill'; level: DrillDownLevel | null }
  | { kind: 'none' }

/**
 * What a row click does (legacy handleRowClick). At the vendor level a game is selected in place, and
 * the same game again clears it; at the top a vendor with an id is drilled into (no id: nothing is
 * pushed, the selection still clears). Every click also returns the table to page 1, as before.
 */
export function casinoRowAction(level: string, record: CasinoBreakdownRecord, selectedGameId: string | null): CasinoRowAction {
  if (level === 'vendor') {
    const newId = record.gameId != null ? String(record.gameId) : null
    return { kind: 'select', gameId: selectedGameId === newId ? null : newId }
  }
  if (level === 'all') {
    const nextLevel = casinoNextLevel(level)
    if (nextLevel === 'vendor' && record.vendorId) {
      return { kind: 'drill', level: { type: 'vendor', id: record.vendorId, name: record.vendorName as string } }
    }
    return { kind: 'drill', level: null }
  }
  return { kind: 'none' }
}

/* ============================== Cells ============================== */

/** Counts as the legacy cells printed them: the browser's own grouping, a missing count as 0. */
export function casinoCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString()
}

/**
 * GGR's ink: gain from zero up, loss below. This is the legacy `v >= 0` test, kept as it was: null
 * (what GraphQL returns for a missing GGR) coerces to 0 and reads as a gain; undefined reads as a loss.
 */
export function casinoGgrTone(value: number | null | undefined): 'gain' | 'loss' {
  return (value as number) >= 0 ? 'gain' : 'loss'
}

/** RTP as a percentage: 96 stays 96, a fraction 0.96 becomes 96; missing or non-numeric is null. */
export function casinoRtpPercent(value: number | string | null | undefined): number | null {
  if (value == null || Number.isNaN(Number(value))) return null
  const num = Number(value)
  return num > 0 && num <= 1 ? num * 100 : num
}

/** The legacy tag colours on kit tones: above 95% red, above 90% orange, else green; N/A grey. */
export function casinoRtpTone(percent: number | null): StatusPillTone {
  if (percent === null) return 'neutral'
  return percent > 95 ? 'neg' : percent > 90 ? 'warn' : 'ok'
}

export function casinoRtpText(percent: number | null): string {
  return percent === null ? 'N/A' : `${percent.toFixed(2)}%`
}

/** The legacy sorter for RTP: null counts as 0, a fraction as its percentage. */
function rtpSortValue(value: number | string | null | undefined): number {
  if (value == null) return 0
  const n = Number(value)
  return n > 0 && n <= 1 ? n * 100 : n
}

export type CasinoSortKey = 'totalStakes' | 'totalPayouts' | 'ggr' | 'betCount' | 'playerCount' | 'gameCount' | 'rtp'

/** The legacy column sorters, verbatim (stakes and GGR without a null guard, as before). */
export const CASINO_SORTERS: Readonly<Record<CasinoSortKey, (a: CasinoBreakdownRecord, b: CasinoBreakdownRecord) => number>> = {
  totalStakes: (a, b) => (a.totalStakes as number) - (b.totalStakes as number),
  totalPayouts: (a, b) => (a.totalPayouts ?? 0) - (b.totalPayouts ?? 0),
  ggr: (a, b) => (a.grossGamingRevenue as number) - (b.grossGamingRevenue as number),
  betCount: (a, b) => (a.betCount ?? 0) - (b.betCount ?? 0),
  playerCount: (a, b) => (a.playerCount ?? 0) - (b.playerCount ?? 0),
  gameCount: (a, b) => (a.gameCount ?? 0) - (b.gameCount ?? 0),
  rtp: (a, b) => rtpSortValue(a.rtp) - rtpSortValue(b.rtp),
}

/** The sortable columns each level shows, in column order; the page sorts exactly these (a column's key is its sort key). */
export function casinoSortKeys(level: string): CasinoSortKey[] {
  if (level === 'all') return ['totalStakes', 'totalPayouts', 'ggr', 'betCount', 'playerCount', 'gameCount']
  if (level === 'vendor') return ['totalStakes', 'totalPayouts', 'ggr', 'betCount', 'playerCount', 'rtp']
  return []
}

/* ============================== Filters and copy ============================== */

/**
 * The FilterBar count: the filters Clear all resets — a typed search (spaces count, as the legacy
 * badge counted them) and a period other than All time. Clear all shows exactly when the legacy one did.
 */
export function casinoActiveFilterCount(searchQuery: string, preset: ReportingDatePreset): number {
  return [Boolean(searchQuery), preset !== 'allTime'].filter(Boolean).length
}

export function casinoSearchPlaceholder(level: string): string {
  return level === 'vendor' ? 'Search by game name...' : 'Search by vendor name...'
}

/** BEYOND the legacy copy: the search field's accessible name (the legacy input had only a placeholder). */
export function casinoSearchLabel(level: string): string {
  return level === 'vendor' ? 'Search games' : 'Search vendors'
}

/** BEYOND the legacy copy: the table's accessible name (antd tables were unnamed). */
export function casinoTableLabel(level: string): string {
  return level === 'vendor' ? 'Game breakdown' : 'Vendor breakdown'
}

/* ============================== KPIs and trends ============================== */

export interface CasinoKpis {
  totalStakes?: number | null
  totalPayouts?: number | null
  grossGamingRevenue?: number | null
  netRevenue?: number | null
  holdPercentage?: number | null
  betCount?: number | null
  playerCount?: number | null
  activePlayerCount?: number | null
}

export interface CasinoKpiTile {
  key: 'ggr' | 'stakes' | 'bets' | 'players'
  label: string
  value: string
  note: string
}

/** The four legacy stat cards' figures and lines, verbatim. */
export function casinoKpiTiles(
  kpis: CasinoKpis,
  formatAmount: (value: number) => string,
  convert: (value: number) => number,
): CasinoKpiTile[] {
  const betCount = kpis.betCount || 0
  const playerCount = kpis.playerCount || 0
  return [
    {
      key: 'ggr',
      label: 'Total GGR',
      value: formatAmount(convert(kpis.grossGamingRevenue || 0)),
      note: `Hold: ${((kpis.holdPercentage || 0) * 100).toFixed(2)}%`,
    },
    {
      key: 'stakes',
      label: 'Total Stakes',
      value: formatAmount(convert(kpis.totalStakes || 0)),
      note: `Payouts: ${formatAmount(convert(kpis.totalPayouts || 0))}`,
    },
    {
      key: 'bets',
      label: 'Total Bets',
      value: betCount.toLocaleString(),
      note: (kpis.playerCount as number) > 0 ? `Avg: ${(betCount / (kpis.playerCount as number)).toFixed(1)}/player` : '—',
    },
    {
      key: 'players',
      label: 'Active Players',
      // the legacy card printed the raw number, with no grouping
      value: String(kpis.activePlayerCount || 0),
      note: `${playerCount} total`,
    },
  ]
}

export interface CasinoTrendRow {
  date: string
  stakes: number
  payouts: number
  ggr: number
  betCount: number
  [key: string]: string | number
}

interface CasinoTrendPoint {
  date: string
  stakes: number
  payouts: number
  ggr: number
  betCount: number
}

/** The plotted trend rows: each amount converted from the whitelabel currency, bets as given. */
export function casinoTrendRows(
  points: readonly CasinoTrendPoint[] | null | undefined,
  convert: (value: number) => number,
): CasinoTrendRow[] {
  return (
    points?.map((point) => ({
      date: point.date,
      stakes: convert(point.stakes),
      payouts: convert(point.payouts),
      ggr: convert(point.ggr),
      betCount: point.betCount,
    })) || []
  )
}

/**
 * The Trends tab's series. The legacy lines named their colours (blue, red, green); the kit plots a
 * series on the token ramp by its place (TrendCard ignores `color`), so none is passed.
 */
export const CASINO_TREND_LINES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'stakes', name: 'Stakes' },
  { key: 'payouts', name: 'Payouts' },
  { key: 'ggr', name: 'GGR' },
]

export type CasinoView = 'breakdown' | 'overview' | 'trends'

export const CASINO_VIEWS: ReadonlyArray<{ value: CasinoView; label: string }> = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'overview', label: 'Overview' },
  { value: 'trends', label: 'Trends' },
]
