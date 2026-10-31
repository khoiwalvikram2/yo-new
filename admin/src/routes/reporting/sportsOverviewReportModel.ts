/* /reporting/sports page logic (page migration C, W3 Task 129).
 *
 * Every rule here is lifted from the legacy SportsOverviewReport.tsx (the drill-down filter it sends,
 * the level hierarchy, the rows each level shows, search, paging, sorting, the KPI figures, the chips
 * and the trend series) so the kit page renders the same data and sends the same variables. No React,
 * no Apollo, no antd: the tests run it directly. */

import type { DrillDownLevel, ReportingFilters } from '@/state/reportingStore'
import {
  REPORTING_ALL_TIME_FROM,
  type ReportingDatePreset,
} from '@/modules/reporting/reportingDateFilter'

/* ============================== Levels ============================== */

/** The page's current level: 'all' at the root, else the last drill-down step's type. */
export type SportsLevel = DrillDownLevel['type']

/** The step types this report pushes; a path holding any other type came from another report. */
export const SPORTS_LEVEL_TYPES: readonly string[] = ['sport', 'league', 'event', 'market']

/** The main table stops at event: markets are displayed, not drilled (legacy getNextLevel). */
export function nextSportsLevel(currentLevel: string): DrillDownLevel['type'] | null {
  const hierarchy: Record<string, DrillDownLevel['type']> = {
    all: 'sport',
    sport: 'league',
    league: 'event',
  }
  return hierarchy[currentLevel] ?? null
}

export function currentSportsLevel(path: readonly DrillDownLevel[]): SportsLevel {
  return path.length > 0 ? path[path.length - 1].type : 'all'
}

/** The mount-time reset rule: a non-empty path with a step this report never pushes. */
export function isPathFromOtherReport(path: readonly DrillDownLevel[]): boolean {
  return path.length > 0 && path.some((level) => !SPORTS_LEVEL_TYPES.includes(level.type))
}

/* ============================== The filter the page sends ============================== */

/** Only the fields SportsDrillDownFilter allows (schemeType, domain and the like stay out). */
export const SPORTS_FILTER_KEYS = [
  'tenant',
  'whitelabelId',
  'dateFrom',
  'dateTo',
  'sportId',
  'leagueId',
  'eventId',
  'agentId',
  'playerId',
  'currency',
] as const

export type SportsReportFilter = Record<string, unknown> & {
  dateFrom: string
  dateTo: string
  currency: string | undefined
  sportId?: string | number
  leagueId?: string | number
  eventId?: string | number
}

export type ActiveFilters = Record<string, { value: string | number; label: string } | undefined | null>

function isFilterEntry(entry: unknown): entry is { value: unknown; label?: string } {
  return Boolean(entry) && typeof entry === 'object' && 'value' in (entry as object)
}

/**
 * The legacy filter memo, step for step: the date range (all time through `today` when unset), the
 * currency, the allowed store fields, the drill-down ids, then the allowed active filters.
 */
export function sportsReportFilter(
  filters: ReportingFilters | null | undefined,
  path: readonly DrillDownLevel[],
  activeFilters: ActiveFilters | null | undefined,
  today: string,
): SportsReportFilter {
  const f: ReportingFilters = filters ?? {}
  const baseFilter: SportsReportFilter = {
    dateFrom: f.dateFrom || REPORTING_ALL_TIME_FROM,
    dateTo: f.dateTo || today,
    currency: f.currency ?? undefined,
  }
  const source = f as Record<string, unknown>
  const target = baseFilter as Record<string, unknown>
  SPORTS_FILTER_KEYS.forEach((key) => {
    const v = source[key]
    if (v !== undefined && v !== null) target[key] = v
  })

  path.forEach((level) => {
    if (level.type === 'sport') baseFilter.sportId = level.id
    if (level.type === 'league') baseFilter.leagueId = level.id
    if (level.type === 'event') baseFilter.eventId = level.id
    if (level.type === 'agent') baseFilter.agentId = level.id
    if (level.type === 'player') baseFilter.playerId = level.id
  })

  Object.entries(activeFilters ?? {}).forEach(([key, entry]) => {
    if (isFilterEntry(entry) && (SPORTS_FILTER_KEYS as readonly string[]).includes(key)) {
      target[key] = entry.value
    }
  })

  return baseFilter
}

/* ============================== Rows ============================== */

/** One row of any level's breakdown query (the fields each level's columns and search read). */
export interface SportsBreakdownRow {
  id?: string | number | null
  name?: string | null
  sportId?: string | number | null
  sportName?: string | null
  leagueId?: string | number | null
  leagueName?: string | null
  eventId?: string | number | null
  eventName?: string | null
  marketId?: string | number | null
  marketName?: string | null
  agentId?: string | null
  agentName?: string | null
  playerId?: string | number | null
  playerUsername?: string | null
  totalStakes?: number | null
  totalPayouts?: number | null
  grossGamingRevenue?: number | null
  betCount?: number | null
  playerCount?: number | null
  avgStake?: number | null
  winRate?: number | null
  commission?: number | null
}

export interface SportsKpis {
  totalStakes?: number | null
  totalPayouts?: number | null
  grossGamingRevenue?: number | null
  holdPercentage?: number | null
  betCount?: number | null
  playerCount?: number | null
  activePlayerCount?: number | null
}

/** Which breakdown query feeds a level's table. */
export type SportsSource = 'sports' | 'league' | 'event' | 'market'

export function levelSource(level: string): SportsSource | null {
  if (level === 'all') return 'sports'
  if (level === 'sport') return 'league'
  if (level === 'league') return 'event'
  if (level === 'event') return 'market'
  return null
}

export interface SourceResult {
  rows: SportsBreakdownRow[] | null | undefined
  loading: boolean
}

export interface LevelView {
  data: SportsBreakdownRow[]
  loading: boolean
  kpis: SportsKpis | null | undefined
}

/**
 * The legacy currentLevelData: the root shows sports, a sport its leagues, a league its events, an
 * event its markets, each with the report's KPIs; any other level shows nothing and no KPIs.
 */
export function levelView(
  level: string,
  sources: Record<SportsSource, SourceResult>,
  kpis: SportsKpis | null | undefined,
): LevelView {
  const source = levelSource(level)
  if (!source) return { data: [], loading: false, kpis: null }
  return { data: sources[source].rows || [], loading: sources[source].loading, kpis }
}

/** The step a row click pushes, or null where the legacy handler returned without pushing. */
export function drillDownStep(level: string, record: SportsBreakdownRow): DrillDownLevel | null {
  if (level === 'event') return null // Markets view: no drill
  const nextLevel = nextSportsLevel(level)
  if (!nextLevel) return null
  let id: string | number | null | undefined
  let name: string | null | undefined
  if (nextLevel === 'sport') {
    id = record.id
    name = record.name
  } else if (nextLevel === 'league') {
    id = record.leagueId
    name = record.leagueName
  } else if (nextLevel === 'event') {
    id = record.eventId
    name = record.eventName
  } else {
    return null
  }
  // the legacy guard was `if (id)`: a missing or zero id pushes nothing; the name is passed as the row has it
  if (!id) return null
  return { type: nextLevel, id, name: name as string }
}

/** Whether rows at this level open the next level (event rows list markets and stop there). */
export function levelDrills(level: string): boolean {
  return level !== 'event' && nextSportsLevel(level) !== null
}

/** The legacy rowKey: the level's id field, else `<level>-<index on the page>`. */
export function sportsRowKey(level: string, record: SportsBreakdownRow, index: number): string {
  const pick = (value: string | number | null | undefined, fallback: string) =>
    value ? String(value) : fallback
  if (level === 'all') return pick(record.id, `sport-${index}`)
  if (level === 'sport') return pick(record.leagueId, `league-${index}`)
  if (level === 'league') return pick(record.eventId, `event-${index}`)
  if (level === 'event') return pick(record.marketId, `market-${index}`)
  if (level === 'agent') return pick(record.agentId, `agent-${index}`)
  if (level === 'player') return pick(record.playerId, `player-${index}`)
  return `row-${index}`
}

const includes = (value: string | null | undefined, query: string) =>
  Boolean(value?.toLowerCase().includes(query))

/** The legacy search: a blank query keeps every row; otherwise the level's own name fields. */
export function filterSportsRows(
  rows: readonly SportsBreakdownRow[],
  level: string,
  searchQuery: string,
): SportsBreakdownRow[] {
  if (!searchQuery.trim()) return [...rows]
  const query = searchQuery.toLowerCase()
  return rows.filter((item) => {
    if (level === 'all') return includes(item.name, query)
    if (level === 'sport') return includes(item.leagueName, query) || includes(item.sportName, query)
    if (level === 'league') return includes(item.eventName, query) || includes(item.leagueName, query)
    if (level === 'event') {
      return (
        includes(item.marketName, query) ||
        includes(item.eventName, query) ||
        includes(item.leagueName, query) ||
        includes(item.sportName, query)
      )
    }
    if (level === 'agent') return includes(item.agentName, query) || includes(item.agentId, query)
    if (level === 'player') return includes(item.playerUsername, query) || String(item.playerId).includes(query)
    return true
  })
}

/** One page of rows, sliced as the legacy page did before handing them to the table. */
export function sportsPageRows<T>(rows: readonly T[], currentPage: number, pageSize: number): T[] {
  const start = (currentPage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export const SPORTS_PAGE_SIZE = 20
export const SPORTS_PAGE_SIZES: readonly number[] = [10, 20, 50, 100]

export function sportsTableSummary(total: number): string {
  return `Total ${total} items`
}

/* ============================== Columns ============================== */

export type SportsColumnKind = 'entity' | 'text' | 'amount' | 'ggr' | 'count' | 'winRate'

export type SportsNumericField =
  | 'totalStakes'
  | 'totalPayouts'
  | 'grossGamingRevenue'
  | 'betCount'
  | 'playerCount'
  | 'avgStake'
  | 'winRate'
  | 'commission'

export interface SportsColumn {
  key: string
  title: string
  kind: SportsColumnKind
  /** The figure a numeric column prints and sorts on. */
  field?: SportsNumericField
  /** entity: the name over a dim line; text: the one field printed as given. */
  nameField?: keyof SportsBreakdownRow
  subField?: keyof SportsBreakdownRow
  subPrefix?: string
  align?: 'right'
  sortable: boolean
}

/** A figure column: right-aligned and sortable, or, `plain`, neither (the legacy agent columns). */
const metric = (
  key: string,
  title: string,
  kind: SportsColumnKind,
  field: SportsNumericField,
  plain = false,
): SportsColumn => (plain ? { key, title, kind, field, sortable: false } : { key, title, kind, field, sortable: true, align: 'right' })

const SPORT_METRICS: readonly SportsColumn[] = [
  metric('totalStakes', 'Total Stakes', 'amount', 'totalStakes'),
  metric('totalPayouts', 'Total Payouts', 'amount', 'totalPayouts'),
  metric('ggr', 'GGR', 'ggr', 'grossGamingRevenue'),
  metric('betCount', 'Bets', 'count', 'betCount'),
  metric('playerCount', 'Players', 'count', 'playerCount'),
]

/** The legacy getColumnsForLevel, as data: titles, keys, alignment and sortable columns per level. */
export function sportsColumns(level: string): SportsColumn[] {
  if (level === 'all') {
    return [{ key: 'sport', title: 'Sport', kind: 'entity', nameField: 'name', sortable: false }, ...SPORT_METRICS]
  }
  if (level === 'sport') {
    return [
      { key: 'league', title: 'League', kind: 'entity', nameField: 'leagueName', subField: 'sportName', sortable: false },
      ...SPORT_METRICS,
    ]
  }
  if (level === 'league') {
    return [
      { key: 'event', title: 'Event', kind: 'entity', nameField: 'eventName', subField: 'leagueName', sortable: false },
      ...SPORT_METRICS,
    ]
  }
  if (level === 'event') {
    return [
      { key: 'market', title: 'Market', kind: 'entity', nameField: 'marketName', subField: 'eventName', sortable: false },
      ...SPORT_METRICS,
    ]
  }
  if (level === 'agent') {
    return [
      { key: 'agentName', title: 'Agent', kind: 'text', nameField: 'agentName', sortable: false },
      metric('totalStakes', 'Total Stakes', 'amount', 'totalStakes', true),
      metric('ggr', 'GGR', 'amount', 'grossGamingRevenue', true),
      metric('commission', 'Commission', 'amount', 'commission', true),
      metric('playerCount', 'Players', 'count', 'playerCount', true),
    ]
  }
  if (level === 'player') {
    return [
      {
        key: 'player',
        title: 'Player',
        kind: 'entity',
        nameField: 'playerUsername',
        subField: 'playerId',
        subPrefix: 'ID: ',
        sortable: false,
      },
      metric('totalStakes', 'Total Stakes', 'amount', 'totalStakes'),
      metric('totalPayouts', 'Total Payouts', 'amount', 'totalPayouts'),
      metric('avgStake', 'Avg Stake', 'amount', 'avgStake'),
      metric('winRate', 'Win Rate', 'winRate', 'winRate'),
      metric('betCount', 'Bets', 'count', 'betCount'),
    ]
  }
  return []
}

/** Agent and player rows had a "View details" action; no other level did. */
export function levelHasDetails(level: string): boolean {
  return level === 'agent' || level === 'player'
}

export interface SportsSort {
  key: string
  dir: 'asc' | 'desc'
}

/**
 * The legacy column sorters (`a.x - b.x`, a missing figure as 0) applied to the rows the table was
 * given — the current page only, as antd sorted its dataSource. A sort on a column the level does
 * not have, or cannot sort, leaves the order as it is. Stable, as Array.prototype.sort is.
 */
export function sortSportsRows<T>(
  rows: readonly T[],
  sort: SportsSort | null,
  columns: readonly SportsColumn[],
  rowOf: (item: T) => SportsBreakdownRow,
): T[] {
  const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined
  if (!sort || !column?.sortable || !column.field) return [...rows]
  const field = column.field
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => direction * ((rowOf(a)[field] ?? 0) - (rowOf(b)[field] ?? 0)))
}

/** The entity cell's name, with the legacy 'N/A' for a missing one. */
export function entityName(record: SportsBreakdownRow, column: SportsColumn): string {
  const value = column.nameField ? record[column.nameField] : undefined
  return value ? String(value) : 'N/A'
}

/** The entity cell's dim line (sport, league, event or `ID: n`), printed even when empty, as before. */
export function entitySub(record: SportsBreakdownRow, column: SportsColumn): string | null {
  if (!column.subField) return null
  const value = record[column.subField]
  return `${column.subPrefix ?? ''}${value ?? ''}`
}

/** `0.4567` → `45.67%`, the legacy win-rate tag text. */
export function winRateText(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/** The legacy tag colours: above 50% red, above 30% orange, else green. */
export function winRateTone(value: number): 'neg' | 'warn' | 'ok' {
  return value > 0.5 ? 'neg' : value > 0.3 ? 'warn' : 'ok'
}

/* ============================== KPIs ============================== */

export interface SportsKpiFigure {
  key: 'ggr' | 'stakes' | 'bets' | 'players'
  label: string
  value: string
  note: string
}

/** The four legacy stat cards, figure for figure; `money` converts and formats an amount. */
export function sportsKpiFigures(kpis: SportsKpis, money: (value: number) => string): SportsKpiFigure[] {
  const playerCount = kpis.playerCount ?? 0
  const betCount = kpis.betCount || 0
  return [
    {
      key: 'ggr',
      label: 'Total GGR',
      value: money(kpis.grossGamingRevenue || 0),
      note: `Hold: ${((kpis.holdPercentage || 0) * 100).toFixed(2)}%`,
    },
    {
      key: 'stakes',
      label: 'Total Stakes',
      value: money(kpis.totalStakes || 0),
      note: `Payouts: ${money(kpis.totalPayouts || 0)}`,
    },
    {
      key: 'bets',
      label: 'Total Bets',
      value: betCount.toLocaleString(),
      note: playerCount > 0 ? `Avg: ${(betCount / playerCount).toFixed(1)}/player` : '—',
    },
    {
      key: 'players',
      label: 'Active Players',
      value: String(kpis.activePlayerCount || 0),
      note: `${kpis.playerCount || 0} total`,
    },
  ]
}

/* ============================== Filters, chips and search copy ============================== */

/**
 * The FilterBar count: the filters its Clear all resets (a search and a period other than All time),
 * which is exactly when the legacy bar showed Clear All.
 */
export function sportsActiveFilterCount(searchQuery: string, datePreset: ReportingDatePreset): number {
  return [Boolean(searchQuery), datePreset !== 'allTime'].filter(Boolean).length
}

export interface SportsChip {
  key: string
  label: string
  value: string | number
}

/** The legacy chips: every well-formed active filter (a persisted entry may be malformed). */
export function sportsFilterChips(activeFilters: ActiveFilters | null | undefined): SportsChip[] {
  return Object.entries(activeFilters ?? {})
    .filter(([, entry]) => isFilterEntry(entry))
    .map(([key, entry]) => {
      const typed = entry as { value?: string | number | null; label?: string }
      return { key, label: typed.label ?? key, value: (typed.value ?? '') as string | number }
    })
}

export function searchPlaceholder(level: string): string {
  if (level === 'player') return 'Search by username, ID...'
  if (level === 'agent') return 'Search by agent name, ID...'
  if (level === 'event') return 'Search by market name...'
  if (level === 'league') return 'Search by event name...'
  if (level === 'sport') return 'Search by league name...'
  return 'Search by sport name...'
}

/** The search box's label: its legacy placeholder without the trailing ellipsis. */
export function searchLabel(level: string): string {
  return searchPlaceholder(level).replace(/\.\.\.$/, '')
}

/* ============================== Trends ============================== */

export interface SportsTrendPoint {
  date: string
  stakes?: number | null
  payouts?: number | null
  ggr?: number | null
  betCount?: number | null
}

/* A type alias, not an interface, so a row satisfies the chart's `{ date; [key]: string | number }`. */
export type SportsTrendRow = {
  date: string
  stakes: number
  payouts: number
  ggr: number
  betCount: number
}

/** The legacy trendsDataFormatted: amounts converted to the whitelabel currency, bets as given. */
export function sportsTrendRows(
  points: readonly SportsTrendPoint[] | null | undefined,
  convert: (value: number) => number,
): SportsTrendRow[] {
  return (points ?? []).map((point) => ({
    date: point.date,
    stakes: convert(point.stakes as number),
    payouts: convert(point.payouts as number),
    ggr: convert(point.ggr as number),
    betCount: point.betCount as number,
  }))
}

/** The trend series the Trends tab plots, in the legacy order (the colours come from the token ramp). */
export const SPORTS_TREND_LINES = [
  { key: 'stakes', name: 'Stakes' },
  { key: 'payouts', name: 'Payouts' },
  { key: 'ggr', name: 'GGR' },
] as const

/* ============================== Page copy ============================== */

export const SPORTS_REPORT_COPY = {
  title: 'Sports Overview Report',
  sub: 'Analyze sports betting performance and revenue across all sports',
  trendsTitle: 'Performance Trends',
} as const

export type SportsViewTab = 'breakdown' | 'overview' | 'trends'

export const SPORTS_VIEW_TABS: readonly { value: SportsViewTab; label: string }[] = [
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'overview', label: 'Overview' },
  { value: 'trends', label: 'Trends' },
]
