import { TZDate } from '@date-fns/tz'
import { format, startOfMonth, subDays } from 'date-fns'
import { ADMIN_TZ, istDayEnd, istDayOf, istDayStart, istToday, isDayString } from '@/ui/components/istDate'

/* The React-free logic of /reporting/agent-overview: the period presets, the query filter, the export
 * range, the domain list an agent may pick from, and the small cell formatters. Data hooks stay in the
 * page; nothing here touches GraphQL. Dates are on date-fns + @date-fns/tz with the kit's IST helpers,
 * not dayjs (page migration C, D6). */

export type AgentOverviewPreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom'

/* 'top-events' is gone (F-REP-08): it was a fixed "will be displayed here" placeholder with no query
   behind it, and the existing top-event and game reads cannot be scoped to the agents' players for an
   admin, so the tab is left out until a source exists. */
export type AgentOverviewTab = 'ggr' | 'activity' | 'top-players'
export type AgentOverviewDomain = 'all' | 'sports' | 'casino' | 'matka'

/** The legacy Date Range options, in order and wording. */
export const AGENT_OVERVIEW_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
] as const satisfies readonly { value: AgentOverviewPreset; label: string }[]

/** The preset the page opens on and Clear All / Reset returns to. */
export const AGENT_OVERVIEW_DEFAULT_PRESET = 'last30days' satisfies AgentOverviewPreset

/** The legacy view tabs, in order and wording. */
export const AGENT_OVERVIEW_TABS = [
  { value: 'ggr', label: 'GGR by Domain' },
  { value: 'activity', label: 'Player Activity' },
  { value: 'top-players', label: 'Top Players' },
] as const satisfies readonly { value: AgentOverviewTab; label: string }[]

export const AGENT_OVERVIEW_DOMAIN_LABELS: Record<AgentOverviewDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

/** The legacy fallback when an agent record carries no allowedDomains. */
const DEFAULT_ALLOWED_DOMAINS = ['sports', 'casino', 'matka'] as const

/** antd's own page-size choices, which the legacy tables showed. */
export const AGENT_OVERVIEW_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

/** Legacy page sizes: the performance and trend tables 10, the player table 20. */
export const PERFORMANCE_PAGE_SIZE = 10
export const TRENDS_PAGE_SIZE = 10
export const TOP_PLAYERS_PAGE_SIZE = 20

/** The player table shows the first 50 rows the breakdown returns. */
export const TOP_PLAYERS_LIMIT = 50

const DAY_MS = 24 * 60 * 60 * 1000

export interface AgentOverviewPeriod {
  preset: AgentOverviewPreset
  /** The first IST calendar day sent to the queries, `yyyy-MM-dd`. */
  dateFrom: string
  /** The last IST calendar day sent to the queries, `yyyy-MM-dd`. */
  dateTo: string
  /** The export job's `dateRange.from`, an ISO instant. */
  exportFrom: string
  /** The export job's `dateRange.to`, an ISO instant. */
  exportTo: string
}

/** The AgentKPIs fields the page shows (AgentKPIs in modules/reporting/graphql.ts). */
export interface AgentKpis {
  totalTurnover?: number | null
  totalGGR?: number | null
  commissionEarned?: number | null
  shareEarned?: number | null
}

/** One AgentPerformance agent, the fields the table shows. */
export interface AgentPerformanceRow {
  agentId: string
  agentName?: string | null
  totalTurnover: number
  totalGGR: number
  commissionEarned: number
  playerCount: number
}

/** One AgentTrends point, the fields the table shows. */
export interface AgentTrendRow {
  date: string
  turnover: number
  ggr: number
  commission: number
  playerCount: number
}

/** One AgentPlayerBreakdown row, the fields the table shows. */
export interface AgentPlayerRow {
  playerId: string
  playerUsername?: string | null
  totalStakes: number
  grossGamingRevenue: number
  betCount: number
  avgStake: number
}

export interface AgentOverviewFilter {
  dateFrom: string
  dateTo: string
  domain?: Exclude<AgentOverviewDomain, 'all'>
}

export function isAgentOverviewPreset(value: unknown): value is AgentOverviewPreset {
  return AGENT_OVERVIEW_PRESETS.some((preset) => preset.value === value)
}

export function isAgentOverviewTab(value: unknown): value is AgentOverviewTab {
  return AGENT_OVERVIEW_TABS.some((tab) => tab.value === value)
}

function istDate(day: string): TZDate {
  if (!isDayString(day)) throw new Error(`Agent overview day must be yyyy-MM-dd: ${String(day)}`)
  const [year, month, date] = day.split('-').map(Number)
  return new TZDate(year, month - 1, date, ADMIN_TZ)
}

/* A TZDate reads its fields in IST, and date-fns formats through those fields, so this prints the IST
   calendar day whatever zone the browser is in. */
function dayString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function periodFromDays(preset: AgentOverviewPreset, dateFrom: string, dateTo: string): AgentOverviewPeriod {
  return {
    preset,
    dateFrom,
    dateTo,
    exportFrom: istDayStart(dateFrom),
    exportTo: istDayEnd(dateTo),
  }
}

/**
 * The state the legacy page opened on: Last 30 Days as `nowIST().subtract(30, 'day')` to `nowIST()`.
 * The query days are the IST days of those two moments; the export range keeps the moments
 * themselves (the time of day included), exactly as the legacy `toISOString()` calls sent them.
 */
export function initialAgentOverviewPeriod(now: Date = new Date()): AgentOverviewPeriod {
  const start = new Date(now.getTime() - 30 * DAY_MS)
  return {
    preset: AGENT_OVERVIEW_DEFAULT_PRESET,
    dateFrom: istDayOf(start),
    dateTo: istDayOf(now),
    exportFrom: start.toISOString(),
    exportTo: now.toISOString(),
  }
}

/**
 * A preset's IST window, from the first instant of its first day to the last instant of its last day,
 * as the legacy `getDateRangeForPreset` built it (startOfDay/endOfDay/startOfMonth/endOfMonth in IST).
 * Last 7 Days and Last 30 Days run from 7 / 30 days before today through today.
 */
export function agentOverviewPresetPeriod(
  preset: Exclude<AgentOverviewPreset, 'custom'>,
  todayDay: string = istToday(),
): AgentOverviewPeriod {
  const today = istDate(todayDay)

  switch (preset) {
    case 'today':
      return periodFromDays(preset, todayDay, todayDay)
    case 'yesterday': {
      const yesterday = dayString(subDays(today, 1))
      return periodFromDays(preset, yesterday, yesterday)
    }
    case 'last7days':
      return periodFromDays(preset, dayString(subDays(today, 7)), todayDay)
    case 'last30days':
      return periodFromDays(preset, dayString(subDays(today, 30)), todayDay)
    case 'thisMonth':
      return periodFromDays(preset, dayString(startOfMonth(today)), todayDay)
    case 'lastMonth': {
      const lastDayOfPreviousMonth = subDays(startOfMonth(today), 1)
      return periodFromDays(
        preset,
        dayString(startOfMonth(lastDayOfPreviousMonth)),
        dayString(lastDayOfPreviousMonth),
      )
    }
  }
}

/** A custom range of IST days, from the first instant of `from` to the last instant of `to`. */
export function agentOverviewCustomPeriod(from: string, to: string): AgentOverviewPeriod {
  return periodFromDays('custom', from, to)
}

/** The period the totals cover, as the Total Turnover card notes it (it said "All time" whatever was chosen, F-REP-09). */
export function agentOverviewPeriodNote(period: Pick<AgentOverviewPeriod, 'preset' | 'dateFrom' | 'dateTo'>): string {
  const range = period.dateFrom === period.dateTo ? period.dateFrom : `${period.dateFrom} – ${period.dateTo}`
  if (period.preset === 'custom') return range
  return AGENT_OVERVIEW_PRESETS.find((preset) => preset.value === period.preset)?.label ?? range
}

/** The filter the four queries receive: the two days, then the domain unless it is All Domains. */
export function agentOverviewFilter(
  period: Pick<AgentOverviewPeriod, 'dateFrom' | 'dateTo'>,
  domain: AgentOverviewDomain,
): AgentOverviewFilter {
  const filter: AgentOverviewFilter = {
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
  }
  if (domain !== 'all') filter.domain = domain
  return filter
}

/**
 * Whether a new filter sends the queries different variables. The legacy tables went back to page 1
 * exactly then: with `network-only`, new variables left each query's data undefined while they loaded,
 * which unmounted the antd tables; equal variables started no request and kept them (and their page).
 */
export function agentOverviewFilterChanged(previous: AgentOverviewFilter, next: AgentOverviewFilter): boolean {
  return previous.dateFrom !== next.dateFrom || previous.dateTo !== next.dateTo || previous.domain !== next.domain
}

/** The `dateRange` the export job carries. */
export function agentOverviewExportRange(
  period: Pick<AgentOverviewPeriod, 'exportFrom' | 'exportTo'>,
): { from: string; to: string } {
  return { from: period.exportFrom, to: period.exportTo }
}

/**
 * The domain choices the legacy page offered: All Domains always, then each domain a non-agent sees or
 * the agent's allowedDomains include. Presentation only; the server scopes the data.
 */
export function visibleAgentOverviewDomains(
  isAgent: boolean,
  allowedDomains?: readonly string[] | null,
): AgentOverviewDomain[] {
  const allowed = allowedDomains || DEFAULT_ALLOWED_DOMAINS
  const domains: AgentOverviewDomain[] = ['all']
  if (!isAgent || allowed.includes('sports')) domains.push('sports')
  if (!isAgent || allowed.includes('casino')) domains.push('casino')
  if (!isAgent || allowed.includes('matka')) domains.push('matka')
  return domains
}

export interface AgentOverviewErrors {
  kpis?: { message: string } | null
  trends?: { message: string } | null
  performance?: { message: string } | null
  players?: { message: string } | null
}

/** The legacy error box's lines, in its order and wording. Empty when nothing failed. */
export function agentOverviewErrorLines(errors: AgentOverviewErrors): string[] {
  const lines: string[] = []
  if (errors.kpis) lines.push(`KPIs: ${errors.kpis.message}`)
  if (errors.trends) lines.push(`Trends: ${errors.trends.message}`)
  if (errors.performance) lines.push(`Performance: ${errors.performance.message}`)
  if (errors.players) lines.push(`Players: ${errors.players.message}`)
  return lines
}

/** The legacy agent caption: the first eight characters of the id and an ellipsis, always appended. */
export function shortAgentId(agentId: string | null | undefined): string {
  return `${agentId?.slice(0, 8) ?? ''}...`
}

/** The legacy count cells: the browser's own grouping (`toLocaleString()` with no locale). */
export function formatCount(value: number): string {
  return value.toLocaleString()
}

/**
 * The page actually shown: the requested one, held inside the pages the rows fill, as antd's table did
 * when a new period returned fewer rows than the page it was on.
 */
export function clampPage(current: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / size))
  return Math.min(Math.max(1, Math.trunc(current) || 1), pages)
}

/** The rows of one controlled page, after clamping it. */
export function pageRows<T>(rows: readonly T[], current: number, pageSize: number): T[] {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const start = (clampPage(current, rows.length, size) - 1) * size
  return rows.slice(start, start + size)
}

/** The player table's rows: the first fifty the breakdown returns, in its order. */
export function topPlayerRows<T>(rows: readonly T[]): T[] {
  return rows.slice(0, TOP_PLAYERS_LIMIT)
}
