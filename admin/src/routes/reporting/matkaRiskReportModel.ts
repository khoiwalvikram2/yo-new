import { REPORTING_ALL_TIME_FROM, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import type { DrillDownLevel, ReportingFilters } from '@/state/reportingStore'
import type { DataTableSort } from '@/ui/components/DataTable'
import type { StatHue } from '@/ui/components/Stat'
import type { StatusPillTone } from '@/ui/components/StatusPill'
import { istToday } from '@/ui/components/istDate'

/* /reporting/matka (page migration C, W3 Task 131): the page's rules without React. Each rule is the
   legacy MatkaRiskReport.tsx's, moved as it was (the pre-image is in .backups/page-migration-2026-09-22/
   task-131/), so the queries receive the same filters and the table the same rows. */

export type MatkaLevelType = DrillDownLevel['type']

/** A breakdown row. One shape for every level; each level's query fills the fields its cells read. */
export interface MatkaRow {
  matkaType?: string | null
  matkaId?: string | number | null
  marketName?: string | null
  marketSession?: string | null
  agentId?: string | number | null
  agentName?: string | null
  playerId?: string | number | null
  playerUsername?: string | null
  totalStakes: number
  totalPayouts: number
  grossGamingRevenue: number
  betCount: number
  playerCount: number
  marketCount: number
  sessionCount: number
  commission: number
  avgStake: number
  winRate: number
}

export interface MatkaKpis {
  totalStakes?: number | null
  totalPayouts?: number | null
  grossGamingRevenue?: number | null
  holdPercentage?: number | null
  betCount?: number | null
  playerCount?: number | null
  activePlayerCount?: number | null
}

/** The levels this report draws; a path holding any other level came from another report. */
export const MATKA_LEVEL_TYPES: readonly string[] = ['matkaType', 'market', 'session', 'agent', 'player']

/** The fields MatkaDrillDownFilter accepts; the shared store's schemeType, domain etc. are left out. */
export const MATKA_FILTER_KEYS: readonly string[] = [
  'tenant',
  'whitelabelId',
  'dateFrom',
  'dateTo',
  'matkaType',
  'matkaId',
  'marketSession',
  'agentId',
  'playerId',
  'currency',
]

export const MATKA_PAGE_SIZE = 20
export const MATKA_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]

/** What the page applies on arrival and on Clear all: All time, through today's IST day. */
export function matkaAllTimeRange(todayDay: string = istToday()): { dateFrom: string; dateTo: string } {
  return { dateFrom: REPORTING_ALL_TIME_FROM, dateTo: todayDay }
}

/** On arrival, a drill-down path left behind by the sports or casino report is dropped. */
export function matkaPathFromOtherReport(path: readonly DrillDownLevel[]): boolean {
  const pathFromOtherReport = path.some((level) => !MATKA_LEVEL_TYPES.includes(level.type))
  return pathFromOtherReport && path.length > 0
}

export function matkaCurrentLevel(path: readonly DrillDownLevel[]): MatkaLevelType {
  return path.length > 0 ? path[path.length - 1].type : 'all'
}

export function matkaNextLevel(currentLevel: string): MatkaLevelType {
  const hierarchy: Record<string, MatkaLevelType> = {
    all: 'matkaType',
    matkaType: 'market',
    market: 'session',
    session: 'agent',
    agent: 'player',
  }
  return hierarchy[currentLevel] || 'matkaType'
}

/**
 * The filter every matka query receives: the store's period (All time through today when unset) and
 * currency, the store fields MatkaDrillDownFilter accepts, then each drill-down level, then each
 * active filter chip whose key is one of those fields — in that order, later ones winning.
 */
export function matkaReportFilter(
  filters: ReportingFilters | null | undefined,
  drillDownPath: readonly DrillDownLevel[],
  activeFilters: Record<string, { value: string | number; label: string }> | null | undefined,
  todayDay: string = istToday(),
): Record<string, unknown> {
  const f = filters ?? {}
  const baseFilter: Record<string, unknown> = {
    dateFrom: f.dateFrom || REPORTING_ALL_TIME_FROM,
    dateTo: f.dateTo || todayDay,
    currency: f.currency ?? undefined,
  }
  MATKA_FILTER_KEYS.forEach((key) => {
    const v = (f as Record<string, unknown>)[key]
    if (v !== undefined && v !== null) baseFilter[key] = v
  })

  drillDownPath.forEach((level) => {
    if (level.type === 'matkaType') baseFilter.matkaType = level.name
    if (level.type === 'market') baseFilter.matkaId = level.id
    if (level.type === 'session') baseFilter.marketSession = level.name
    if (level.type === 'agent') baseFilter.agentId = level.id
    if (level.type === 'player') baseFilter.playerId = level.id
  })

  Object.entries(activeFilters ?? {}).forEach(([key, entry]) => {
    if (entry && typeof entry === 'object' && 'value' in entry && MATKA_FILTER_KEYS.includes(key)) {
      baseFilter[key] = (entry as { value: unknown }).value
    }
  })

  return baseFilter
}

export type MatkaSource = 'type' | 'market' | 'session' | 'agent' | 'player'

/**
 * Which breakdown query's rows a level shows: the level below it, filtered by the path, as the sports
 * report does. The root shows the types, a type its markets, a market its sessions, a session its
 * agents and an agent its players; a player is the last level and shows its own row. (Each level
 * showed its own rows, so a clicked type showed that one type row again, and since a type row carries
 * no market id the drill-down stopped there: F-REP-01.)
 */
export function matkaLevelSource(level: string): MatkaSource | null {
  if (level === 'all') return 'type'
  if (level === 'matkaType') return 'market'
  if (level === 'market') return 'session'
  if (level === 'session') return 'agent'
  if (level === 'agent' || level === 'player') return 'player'
  return null
}

/** The level whose rows a level shows (matkaLevelSource); the columns, row keys and search follow it. */
export function matkaRowsLevel(level: string): MatkaLevelType {
  const rows: Record<string, MatkaLevelType> = {
    all: 'matkaType',
    matkaType: 'market',
    market: 'session',
    session: 'agent',
    agent: 'player',
    player: 'player',
  }
  return rows[level] ?? 'matkaType'
}

/**
 * The level a row click opens, or null when the row lacks the next level's id. The id is read from
 * the clicked row, which is a row of the next level (matkaLevelSource), so every level's rows carry
 * it; a player row opens nothing, the player being the last level.
 */
export function matkaDrillTarget(currentLevel: string, record: MatkaRow): DrillDownLevel | null {
  const nextLevel = matkaNextLevel(currentLevel)
  let id: string | number | null | undefined
  let name: string = 'Unknown'

  if (nextLevel === 'matkaType') {
    id = record.matkaType
    name = record.matkaType as string
  } else if (nextLevel === 'market') {
    id = record.matkaId
    name = record.marketName as string
  } else if (nextLevel === 'session') {
    id = record.marketSession
    name = record.marketSession as string
  } else if (nextLevel === 'agent') {
    id = record.agentId
    name = record.agentName || 'Unknown'
  } else if (nextLevel === 'player') {
    id = record.playerId
    name = record.playerUsername || 'Unknown'
  }

  return id ? { type: nextLevel, id, name } : null
}

/** How many levels a breadcrumb press pops; -1 is the root, which resets the whole path. */
export function matkaLevelsToRemove(pathLength: number, index: number): number {
  return pathLength - index - 1
}

/** The table's local search, per level, as typed (lower-cased, untrimmed once it is not blank). */
export function filterMatkaRows(rows: readonly MatkaRow[], level: string, searchQuery: string): MatkaRow[] {
  if (!searchQuery.trim()) return [...rows]
  const query = searchQuery.toLowerCase()
  return rows.filter((item) => {
    if (level === 'matkaType' || level === 'all') {
      return item.matkaType?.toLowerCase().includes(query)
    } else if (level === 'market') {
      return item.marketName?.toLowerCase().includes(query) || item.matkaType?.toLowerCase().includes(query)
    } else if (level === 'session') {
      return item.marketSession?.toLowerCase().includes(query) || item.marketName?.toLowerCase().includes(query)
    } else if (level === 'agent') {
      return item.agentName?.toLowerCase().includes(query) || String(item.agentId).includes(query)
    } else if (level === 'player') {
      return item.playerUsername?.toLowerCase().includes(query) || String(item.playerId).includes(query)
    }
    return true
  })
}

export function matkaSearchPlaceholder(level: string): string {
  return level === 'player'
    ? 'Search by username, ID...'
    : level === 'agent'
      ? 'Search by agent name, ID...'
      : level === 'session'
        ? 'Search by session...'
        : level === 'market'
          ? 'Search by market name...'
          : 'Search by matka type...'
}

/** A row's key; `index` is its place on the page, as antd passed it. */
export function matkaRowKey(level: string, record: MatkaRow, index: number): string {
  if (level === 'matkaType' || level === 'all') return String(record.matkaType || `type-${index}`)
  if (level === 'market') return String(record.matkaId || `market-${index}`)
  // The legacy `|| session-N` fallback after this template string could never apply (it is never empty).
  if (level === 'session') return `${record.marketSession}-${record.matkaId}`
  if (level === 'agent') return String(record.agentId || `agent-${index}`)
  if (level === 'player') return String(record.playerId || `player-${index}`)
  return `row-${index}`
}

export type MatkaColumnKey =
  | 'matkaType'
  | 'market'
  | 'session'
  | 'agent'
  | 'player'
  | 'totalStakes'
  | 'ggr'
  | 'betCount'
  | 'marketCount'
  | 'sessionCount'
  | 'commission'
  | 'avgStake'
  | 'winRate'

export interface MatkaColumnSpec {
  key: MatkaColumnKey
  title: string
  align?: 'right'
  sortable: boolean
}

const STAKES: MatkaColumnSpec = { key: 'totalStakes', title: 'Total Stakes', align: 'right', sortable: true }
const GGR: MatkaColumnSpec = { key: 'ggr', title: 'GGR', align: 'right', sortable: true }
const BETS: MatkaColumnSpec = { key: 'betCount', title: 'Bets', align: 'right', sortable: true }

/** Each level's columns, in the legacy order, with the legacy titles and keys. */
export function matkaColumns(level: string): MatkaColumnSpec[] {
  if (level === 'matkaType' || level === 'all') {
    return [
      { key: 'matkaType', title: 'Matka Type', sortable: false },
      STAKES,
      GGR,
      BETS,
      { key: 'marketCount', title: 'Markets', align: 'right', sortable: true },
    ]
  } else if (level === 'market') {
    return [
      { key: 'market', title: 'Market', sortable: false },
      STAKES,
      GGR,
      { key: 'sessionCount', title: 'Sessions', align: 'right', sortable: true },
    ]
  } else if (level === 'session') {
    return [{ key: 'session', title: 'Session', sortable: false }, STAKES, GGR, BETS]
  } else if (level === 'agent') {
    return [
      { key: 'agent', title: 'Agent', sortable: false },
      STAKES,
      GGR,
      { key: 'commission', title: 'Commission', align: 'right', sortable: true },
    ]
  } else if (level === 'player') {
    return [
      { key: 'player', title: 'Player', sortable: false },
      STAKES,
      { key: 'avgStake', title: 'Avg Stake', align: 'right', sortable: true },
      { key: 'winRate', title: 'Win Rate', align: 'right', sortable: true },
      BETS,
    ]
  }
  return []
}

type Comparator = (a: MatkaRow, b: MatkaRow) => number

/** The legacy column sorters, by column key (a key means the same field at every level). */
export const MATKA_COMPARATORS: Partial<Record<string, Comparator>> = {
  totalStakes: (a, b) => a.totalStakes - b.totalStakes,
  ggr: (a, b) => a.grossGamingRevenue - b.grossGamingRevenue,
  betCount: (a, b) => a.betCount - b.betCount,
  marketCount: (a, b) => a.marketCount - b.marketCount,
  sessionCount: (a, b) => a.sessionCount - b.sessionCount,
  commission: (a, b) => a.commission - b.commission,
  avgStake: (a, b) => a.avgStake - b.avgStake,
  winRate: (a, b) => a.winRate - b.winRate,
}

/**
 * A column sort orders the rows of the current page only, as the antd table did with the page slice
 * it was given. The comparator is found by key, so, as under antd, a sort chosen at one level keeps
 * ordering the rows of the next level when they carry the same field.
 */
export function sortMatkaPage<T extends MatkaRow>(rows: readonly T[], sort: DataTableSort | null): T[] {
  const comparator = sort ? MATKA_COMPARATORS[sort.key] : undefined
  if (!sort || !comparator) return [...rows]
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => direction * comparator(a, b))
}

/** The page the table can show: a page past the last one shows the last one. */
export function clampMatkaPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function matkaPageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function matkaTotalText(total: number): string {
  return `Total ${total} items`
}

/** The filters Clear all clears (the search and the period), the count the filter bar states. */
export function matkaClearableFilterCount(searchQuery: string, datePreset: ReportingDatePreset): number {
  return [searchQuery, datePreset !== 'allTime'].filter(Boolean).length
}

export function winRateText(winRate: number): string {
  return `${(winRate * 100).toFixed(2)}%`
}

/** The legacy tag colours (red over 50%, orange over 30%, else green) on the semantic tones. */
export function winRateTone(winRate: number): StatusPillTone {
  return winRate > 0.5 ? 'neg' : winRate > 0.3 ? 'warn' : 'ok'
}

export type MatkaKpiIcon = 'chart' | 'cash' | 'bars' | 'users'

export interface MatkaKpiTile {
  key: string
  label: string
  value: string | number
  note: string
  hue: StatHue
  icon: MatkaKpiIcon
}

/**
 * The four figures, with the legacy values and notes. `money` is formatAmount over the whitelabel
 * conversion. Hues follow the legacy tiles (blue, green, grey, red); the decorative ramp has no grey,
 * so grey takes indigo, as on the other migrated reports.
 */
export function matkaKpiTiles(kpis: MatkaKpis, money: (value: number) => string): MatkaKpiTile[] {
  const playerCount = kpis.playerCount ?? 0
  return [
    {
      key: 'ggr',
      label: 'Total GGR',
      value: money(kpis.grossGamingRevenue || 0),
      note: `Hold: ${((kpis.holdPercentage || 0) * 100).toFixed(2)}%`,
      hue: 'blu',
      icon: 'chart',
    },
    {
      key: 'stakes',
      label: 'Total Stakes',
      value: money(kpis.totalStakes || 0),
      note: `Payouts: ${money(kpis.totalPayouts || 0)}`,
      hue: 'grn',
      icon: 'cash',
    },
    {
      key: 'bets',
      label: 'Total Bets',
      value: (kpis.betCount || 0).toLocaleString(),
      note: playerCount > 0 ? `Avg: ${((kpis.betCount || 0) / playerCount).toFixed(1)}/player` : '—',
      hue: 'ind',
      icon: 'bars',
    },
    {
      key: 'players',
      label: 'Active Players',
      value: kpis.activePlayerCount || 0,
      note: `${kpis.playerCount || 0} total`,
      hue: 'red',
      icon: 'users',
    },
  ]
}
