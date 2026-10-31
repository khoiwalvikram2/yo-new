import { REPORTING_ALL_TIME_FROM, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import type { DrillDownLevel, ReportingFilters } from '@/state/reportingStore'
import type { DataTableSort } from '@/ui/components/DataTable'
import type { StatHue } from '@/ui/components/Stat'
import type { StatusPillTone } from '@/ui/components/StatusPill'
import { istToday } from '@/ui/components/istDate'

/* /reporting/agents/performance (page migration C, W3 Task 132): the page's rules without React. Each
   rule is the legacy AgentPerformanceReport.tsx's, moved as it was (the pre-image is in
   .backups/page-migration-2026-09-22/task-132/), so the queries receive the same filters and the
   table the same rows and columns. */

export type AgentPerfLevelType = DrillDownLevel['type']
export type AgentPerfDomain = 'all' | 'sports' | 'casino' | 'matka'
export type AgentPerfScheme = 'COMMISSION' | 'SHARING' | 'CREDIT'

export interface AgentDomainBreakdown {
  domain: string
  turnover?: number | null
  ggr?: number | null
  cut?: number | null
  cutPercent?: number | null
  userCutPercent?: number | null
  agentCutPercent?: number | null
}

export interface AgentPerformanceRow {
  agentId?: string | null
  agentName?: string | null
  schemeType?: string | null
  totalTurnover: number
  totalGGR: number
  commissionEarned: number
  shareEarned: number
  playerCount: number
  betCount: number
  domainBreakdown?: AgentDomainBreakdown[] | null
}

export interface AgentPlayerRow {
  playerId?: string | number | null
  playerUsername?: string | null
  totalStakes: number
  totalPayouts: number
  grossGamingRevenue: number
  avgStake: number
  winRate: number
  betCount: number
}

/** One table row: an agent at the top level, a player one level down. */
export type AgentPerfRow = AgentPerformanceRow & AgentPlayerRow

export interface AgentPerfTotals {
  totalTurnover: number
  totalGGR: number
  commissionEarned: number
  shareEarned: number
  agentCount: number
  playerCount: number
  betCount: number
}

export interface AgentPerfKpis {
  totalTurnover?: number | null
  totalGGR?: number | null
  commissionEarned?: number | null
  shareEarned?: number | null
  playerCount?: number | null
  betCount?: number | null
  agentCount?: number | null
}

export const AGENT_PERF_PAGE_SIZE = 20
export const AGENT_PERF_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]
export const AGENT_PERF_LIMIT = 50
export const AGENT_PERF_ALL_DOMAINS: readonly string[] = ['sports', 'casino', 'matka']

/** The whitelabel's agent-type rail, in the legacy order and wording. */
export const AGENT_TYPE_OPTIONS: ReadonlyArray<{ value: AgentPerfScheme; label: string }> = [
  { value: 'COMMISSION', label: 'Commission' },
  { value: 'SHARING', label: 'Sharing' },
  { value: 'CREDIT', label: 'Credit' },
]

export const AGENT_PERF_DOMAIN_LABELS: Record<AgentPerfDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

/** What the page applies on arrival and on Clear all: All time, through today's IST day. */
export function agentPerfAllTimeRange(todayDay: string = istToday()): { dateFrom: string; dateTo: string } {
  return { dateFrom: REPORTING_ALL_TIME_FROM, dateTo: todayDay }
}

export function agentPerfCurrentLevel(path: readonly DrillDownLevel[]): AgentPerfLevelType {
  return path.length > 0 ? path[path.length - 1].type : 'all'
}

export function isAgentLevel(level: string): boolean {
  return level === 'agent' || level === 'all'
}

/** An agent's allowed domains, or all three when the profile names none. */
export function agentAllowedDomains(allowedDomains: readonly string[] | null | undefined): readonly string[] {
  return allowedDomains || AGENT_PERF_ALL_DOMAINS
}

export interface AgentPerfFilterInput {
  filters: ReportingFilters
  drillDownPath: readonly DrillDownLevel[]
  activeFilters: Record<string, { value: string | number; label: string }>
  selectedDomain: string
  selectedAgentType: string
  isAgent: boolean
  agentId?: string | null
  allowedDomains: readonly string[]
  todayDay?: string
}

/**
 * The filter every query receives. An agent with a single allowed domain on All Domains is scoped to
 * that domain; an agent sees their direct sub-agents (parentAgentId); the path's agent and player
 * levels and every active filter chip are added last. Key order is the legacy one.
 */
export function agentPerfFilter({
  filters,
  drillDownPath,
  activeFilters,
  selectedDomain,
  selectedAgentType,
  isAgent,
  agentId,
  allowedDomains,
  todayDay = istToday(),
}: AgentPerfFilterInput): Record<string, unknown> {
  const effectiveDomain =
    selectedDomain === 'all'
      ? (isAgent && allowedDomains?.length === 1 ? allowedDomains[0] : undefined)
      : selectedDomain

  const baseFilter: Record<string, unknown> = {
    ...filters,
    dateFrom: filters.dateFrom || REPORTING_ALL_TIME_FROM,
    dateTo: filters.dateTo || todayDay,
    currency: filters.currency || undefined,
    domain: effectiveDomain,
    schemeType: selectedAgentType,
  }

  if (isAgent && agentId) {
    baseFilter.parentAgentId = agentId
  }

  drillDownPath.forEach((level) => {
    if (level.type === 'agent') baseFilter.agentId = level.id
    if (level.type === 'player') baseFilter.playerId = level.id
  })

  Object.entries(activeFilters).forEach(([key, { value }]) => {
    baseFilter[key] = value
  })

  return baseFilter
}

export interface AgentPerfLevelData {
  data: AgentPerfRow[]
  totals: AgentPerfTotals | null
  source: 'performance' | 'players' | null
  kpis: AgentPerfKpis | null | undefined
}

/**
 * The rows, totals and figures a level shows. At the agent level the performance totals, when the
 * server sends them, overlay the KPI figures.
 */
export function agentPerfLevelData(
  level: string,
  performance: { agents?: AgentPerformanceRow[] | null; totals?: AgentPerfTotals | null } | null | undefined,
  players: AgentPlayerRow[] | null | undefined,
  agentKpis: AgentPerfKpis | null | undefined,
): AgentPerfLevelData {
  if (level === 'all' || level === 'agent') {
    const agents = (performance?.agents ?? []) as AgentPerfRow[]
    const totals = performance?.totals ?? null
    return {
      data: agents,
      totals,
      source: 'performance',
      kpis: totals ? { ...agentKpis, ...totals } : agentKpis,
    }
  } else if (level === 'player') {
    return { data: (players || []) as AgentPerfRow[], totals: null, source: 'players', kpis: agentKpis }
  }
  return { data: [], totals: null, source: null, kpis: null }
}

/** The domain cut columns show only at the agent level and only when the server sent totals. */
export function agentPerfShowDomainBreakdown(totals: AgentPerfTotals | null, level: string): boolean {
  return !!totals && isAgentLevel(level)
}

/** How many levels a crumb press pops; -1 is the root, which resets the whole path. */
export function agentPerfLevelsToRemove(pathLength: number, index: number): number {
  return pathLength - index - 1
}

/** The table's local search, per level, as typed (lower-cased, untrimmed once it is not blank). */
export function filterAgentPerfRows(rows: readonly AgentPerfRow[], level: string, searchQuery: string): AgentPerfRow[] {
  if (!searchQuery.trim()) return [...rows]
  const query = searchQuery.toLowerCase()
  return rows.filter((item) => {
    if (level === 'agent' || level === 'all') {
      return item.agentName?.toLowerCase().includes(query) || item.agentId?.toLowerCase().includes(query)
    } else if (level === 'player') {
      return item.playerUsername?.toLowerCase().includes(query) || String(item.playerId).includes(query)
    }
    return true
  })
}

export function agentPerfSearchPlaceholder(level: string): string {
  return level === 'player' ? 'Search by username, ID...' : 'Search by agent name, ID...'
}

/** A row's key; `index` is its place on the page, as antd passed it. */
export function agentPerfRowKey(level: string, record: AgentPerfRow, index: number): string {
  if (isAgentLevel(level)) return String(record.agentId || `agent-${index}`)
  if (level === 'player') return String(record.playerId || `player-${index}`)
  return `row-${index}`
}

/** The card title, which the legacy table head showed above the count. */
export function agentPerfTableTitle(level: string): string {
  return level === 'player' ? 'Player Performance' : 'Agent Performance'
}

/** The count under the title: `1 agent`, `12 players`. */
export function agentPerfCountText(count: number, level: string): string {
  const noun = count === 1
    ? (level === 'player' ? 'player' : 'agent')
    : (level === 'player' ? 'players' : 'agents')
  return `${count} ${noun}`
}

/** The drill path's root crumb. */
export function agentPerfRootLabel(level: string): string {
  return `All ${level === 'player' ? 'Players' : 'Agents'}`
}

export function agentPerfTotalText(total: number, level: string): string {
  return `Total ${total} ${level === 'player' ? 'players' : 'agents'}`
}

/** The filters Clear all clears (the search and the period), the count the filter bar states. */
export function agentPerfClearableFilterCount(searchQuery: string, datePreset: ReportingDatePreset): number {
  return [searchQuery, datePreset !== 'allTime'].filter(Boolean).length
}

/** All Domains, then each domain an admin sees or the agent's allowed domains include. */
export function agentPerfDomainOptions(isAgent: boolean, allowedDomains: readonly string[]): AgentPerfDomain[] {
  const options: AgentPerfDomain[] = ['all']
  if (!isAgent || allowedDomains.includes('sports')) options.push('sports')
  if (!isAgent || allowedDomains.includes('casino')) options.push('casino')
  if (!isAgent || allowedDomains.includes('matka')) options.push('matka')
  return options
}

export type AgentPerfColumnKey =
  | 'agent'
  | 'totalGGR'
  | 'cut'
  | 'commission'
  | 'share'
  | 'sportsCut'
  | 'casinoCut'
  | 'matkaCut'
  | 'playerCount'
  | 'betCount'
  | 'player'
  | 'totalStakes'
  | 'totalPayouts'
  | 'ggr'
  | 'avgStake'
  | 'winRate'

export interface AgentPerfColumnSpec {
  key: AgentPerfColumnKey
  title: string
  align?: 'right'
  sortable: boolean
}

const CUT: AgentPerfColumnSpec = { key: 'cut', title: 'Cut', align: 'right', sortable: true }
const COMMISSION: AgentPerfColumnSpec = { key: 'commission', title: 'Commission', align: 'right', sortable: true }
const SHARE: AgentPerfColumnSpec = { key: 'share', title: 'Share', align: 'right', sortable: true }

/** The earnings columns by agent type: COMMISSION → Cut, Commission; SHARING → Cut; else all three. */
export function agentPerfEarningColumns(agentType: string | undefined): AgentPerfColumnSpec[] {
  return agentType === 'COMMISSION'
    ? [CUT, COMMISSION]
    : agentType === 'SHARING'
      ? [CUT]
      : [CUT, COMMISSION, SHARE]
}

export const AGENT_PERF_DOMAIN_CUTS: ReadonlyArray<{ key: AgentPerfColumnKey; title: string; domain: string }> = [
  { key: 'sportsCut', title: 'Sports Cut', domain: 'sports' },
  { key: 'casinoCut', title: 'Casino Cut', domain: 'casino' },
  { key: 'matkaCut', title: 'Matka Cut', domain: 'matka' },
]

/**
 * Each level's columns in the order the legacy table drew them. The domain cut columns go where the
 * legacy splice put them, at index 3 + the earnings columns, which is after Players and before Bets
 * (its comment said "before Players"; the drawn order is kept).
 */
export function agentPerfColumns(
  level: string,
  showDomainBreakdown: boolean,
  agentType: string | undefined,
): AgentPerfColumnSpec[] {
  if (isAgentLevel(level)) {
    const earnings = agentPerfEarningColumns(agentType)
    const baseCols: AgentPerfColumnSpec[] = [
      { key: 'agent', title: 'Agent', sortable: false },
      { key: 'totalGGR', title: 'Total GGR', align: 'right', sortable: true },
      ...earnings,
      { key: 'playerCount', title: 'Players', align: 'right', sortable: true },
      { key: 'betCount', title: 'Bets', align: 'right', sortable: true },
    ]
    if (showDomainBreakdown) {
      baseCols.splice(
        3 + earnings.length,
        0,
        ...AGENT_PERF_DOMAIN_CUTS.map(({ key, title }) => ({ key, title, align: 'right' as const, sortable: false })),
      )
    }
    return baseCols
  } else if (level === 'player') {
    return [
      { key: 'player', title: 'Player', sortable: false },
      { key: 'totalStakes', title: 'Total Stakes', align: 'right', sortable: true },
      { key: 'totalPayouts', title: 'Total Payouts', align: 'right', sortable: true },
      { key: 'ggr', title: 'GGR', align: 'right', sortable: true },
      { key: 'avgStake', title: 'Avg Stake', align: 'right', sortable: true },
      { key: 'winRate', title: 'Win Rate', align: 'right', sortable: true },
      { key: 'betCount', title: 'Bets', align: 'right', sortable: true },
    ]
  }
  return []
}

/** An agent's cut as the Cut cell shows it: commission plus share, a missing one counting 0. */
export function agentCut(record: Pick<AgentPerformanceRow, 'commissionEarned' | 'shareEarned'>): number {
  return (record.commissionEarned || 0) + (record.shareEarned || 0)
}

export interface DomainCut {
  cut: number
  /** `user% − agent% = cut%`, one decimal each, when the server sent all three. */
  formula: string | null
}

export function agentDomainCut(record: Pick<AgentPerformanceRow, 'domainBreakdown'>, domain: string): DomainCut {
  const d = record.domainBreakdown?.find((x) => x.domain === domain)
  const cut = d?.cut ?? 0
  const userPct = d?.userCutPercent
  const agentPct = d?.agentCutPercent
  const cutPct = d?.cutPercent
  return {
    cut,
    formula:
      userPct != null && agentPct != null && cutPct != null
        ? `${userPct.toFixed(1)}% − ${agentPct.toFixed(1)}% = ${cutPct.toFixed(1)}%`
        : null,
  }
}

type Comparator = (a: AgentPerfRow, b: AgentPerfRow) => number

/** The legacy column sorters, by column key. */
export const AGENT_PERF_COMPARATORS: Partial<Record<string, Comparator>> = {
  totalGGR: (a, b) => a.totalGGR - b.totalGGR,
  cut: (a, b) => (a.commissionEarned + a.shareEarned) - (b.commissionEarned + b.shareEarned),
  commission: (a, b) => a.commissionEarned - b.commissionEarned,
  share: (a, b) => a.shareEarned - b.shareEarned,
  playerCount: (a, b) => a.playerCount - b.playerCount,
  betCount: (a, b) => a.betCount - b.betCount,
  totalStakes: (a, b) => a.totalStakes - b.totalStakes,
  totalPayouts: (a, b) => a.totalPayouts - b.totalPayouts,
  ggr: (a, b) => a.grossGamingRevenue - b.grossGamingRevenue,
  avgStake: (a, b) => a.avgStake - b.avgStake,
  winRate: (a, b) => a.winRate - b.winRate,
}

/**
 * A column sort orders the rows of the current page only, as the antd table did with the page slice
 * it was given; the comparator is found by key, so a sort carries across levels for a shared field.
 */
export function sortAgentPerfPage<T extends AgentPerfRow>(rows: readonly T[], sort: DataTableSort | null): T[] {
  const comparator = sort ? AGENT_PERF_COMPARATORS[sort.key] : undefined
  if (!sort || !comparator) return [...rows]
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => direction * comparator(a, b))
}

/** The page the table can show: a page past the last one shows the last one. */
export function clampAgentPerfPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function agentPerfPageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/**
 * The totals row, by column key: Total; the GGR; the cut (commission plus share); commission and
 * share; a dash under each domain cut; players and bets. Each value sits under its own column.
 */
export function agentPerfTotalsCells(
  totals: AgentPerfTotals,
  money: (value: number) => string,
): Partial<Record<AgentPerfColumnKey, string>> {
  return {
    agent: 'Total',
    totalGGR: money(totals.totalGGR),
    cut: money(totals.commissionEarned + totals.shareEarned),
    commission: money(totals.commissionEarned),
    share: money(totals.shareEarned),
    sportsCut: '—',
    casinoCut: '—',
    matkaCut: '—',
    playerCount: totals.playerCount.toLocaleString(),
    betCount: totals.betCount.toLocaleString(),
  }
}

export function winRateText(winRate: number): string {
  return `${(winRate * 100).toFixed(2)}%`
}

/** The legacy tag colours (red over 50%, orange over 30%, else green) on the semantic tones. */
export function winRateTone(winRate: number): StatusPillTone {
  return winRate > 0.5 ? 'neg' : winRate > 0.3 ? 'warn' : 'ok'
}

export type AgentPerfKpiIcon = 'chart' | 'cash' | 'percent' | 'users'

export interface AgentPerfKpiTile {
  key: string
  label: string
  value: string | number
  note: string
  hue: StatHue
  icon: AgentPerfKpiIcon
}

/**
 * The four figures, with the legacy values and notes. `money` is formatAmount over the whitelabel
 * conversion. Hues follow the legacy tiles (blue, green, grey, red); grey takes indigo (the decorative
 * ramp has no grey), as on the other migrated reports.
 */
export function agentPerfKpiTiles(kpis: AgentPerfKpis, money: (value: number) => string): AgentPerfKpiTile[] {
  return [
    {
      key: 'turnover',
      label: 'Total Turnover',
      value: money(kpis.totalTurnover || 0),
      note: `${kpis.agentCount || 0} agents`,
      hue: 'blu',
      icon: 'chart',
    },
    {
      key: 'ggr',
      label: 'Total GGR',
      value: money(kpis.totalGGR || 0),
      note: `${(kpis.betCount || 0).toLocaleString()} bets`,
      hue: 'grn',
      icon: 'cash',
    },
    {
      key: 'commission',
      label: 'Commission',
      value: money(kpis.commissionEarned || 0),
      note: `Share: ${money(kpis.shareEarned || 0)}`,
      hue: 'ind',
      icon: 'percent',
    },
    {
      key: 'agents',
      label: 'Active Agents',
      value: kpis.agentCount || 0,
      note: `${kpis.playerCount || 0} players`,
      hue: 'red',
      icon: 'users',
    },
  ]
}
