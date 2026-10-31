/* Pure logic of the drill-down report pieces (page migration Task 121).
 *
 * Every rule here is lifted from the legacy antd components in ../components and
 * routes/reporting/components/ReportDetailSidebar.tsx, so the kit components in this folder render
 * the same figures, labels and branches. No React, no Apollo, no antd: the tests run it directly. */

import type { StatDelta, StatHue } from '@/ui/components/Stat'
import type { StatusPillTone } from '@/ui/components/StatusPill'
import type { ReportingFilters } from '@/state/reportingStore'

/* ============================== KPI grid ============================== */

export interface KPICard {
  title: string
  value: number | string
  /** Accepted for parity; the legacy grid never rendered it. */
  prefix?: string
  suffix?: string
  precision?: number
  secondaryLabel?: string
  secondaryValue?: string | number
  trend?: {
    value: number
    isPositive: boolean
  }
  formatter?: (value: number) => string
}

/** ReportKpiGrid.tsx formatValue: a string as given, then the formatter, the precision, else 2 decimals. */
export function formatKpiValue(kpi: KPICard, locale: string): string {
  if (typeof kpi.value === 'string') return kpi.value
  if (kpi.formatter) return kpi.formatter(kpi.value)
  if (kpi.precision !== undefined) {
    return kpi.value.toLocaleString(locale, {
      minimumFractionDigits: kpi.precision,
      maximumFractionDigits: kpi.precision,
    })
  }
  return kpi.value.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** The value the card shows: the formatted figure plus the suffix (the prefix was never shown). */
export function kpiDisplayValue(kpi: KPICard, locale: string): string {
  return `${formatKpiValue(kpi, locale)}${kpi.suffix ?? ''}`
}

/* The legacy CARD_STYLES cycle (green, cyan, orange, indigo, grey, amber, emerald) mapped onto the
   kit's decorative ramp. Decorative only: no tile hue carries meaning. */
export const KPI_HUES: readonly StatHue[] = ['grn', 'blu', 'amb', 'ind', 'vio', 'amb', 'grn']

export function kpiHue(index: number): StatHue {
  return KPI_HUES[index % KPI_HUES.length]
}

/** "Vs previous: +x.xx%" becomes a stated direction with the magnitude, as the kit Stat requires. */
export function kpiTrendDelta(trend: NonNullable<KPICard['trend']>): StatDelta {
  return {
    value: `${Math.abs(trend.value).toFixed(2)}%`,
    dir: trend.isPositive ? 'up' : 'down',
    note: 'vs previous',
  }
}

/** The secondary row, "Label: value", shown only when there is no trend (legacy order). */
export function kpiSecondaryNote(kpi: KPICard): string | undefined {
  if (kpi.trend || !kpi.secondaryLabel) return undefined
  return `${kpi.secondaryLabel}: ${kpi.secondaryValue ?? ''}`
}

/* ============================== Level KPIs ============================== */

export type LevelKpi = Pick<KPICard, 'title' | 'formatter' | 'suffix' | 'precision'> & { value: number }

const count = (v: number) => v.toLocaleString()

/** LevelKpiGrid.tsx, branch for branch. `data` is the level's own GraphQL row. */
export function levelKpis(
  level: string,
  domain: string,
  // The level row is whatever shape its query returns; each branch reads named fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  formatAmount: (value: number) => string,
  convertCurrency: (value: number) => number,
): LevelKpi[] {
  const kpis: LevelKpi[] = []
  if (!data) return kpis
  const amount = (value: number) => ({ value: convertCurrency(value), formatter: formatAmount })
  const percent = (value: number) => ({ value: value * 100, suffix: '%', precision: 2 })

  if ((level === 'all' && domain === 'bonuses') || level === 'campaign') {
    kpis.push(
      { title: 'Total Issued', ...amount(data.totalIssued || 0) },
      { title: 'Total Redeemed', ...amount(data.totalRedeemed || 0) },
      { title: 'Outstanding Liability', ...amount(data.outstandingLiability || 0) },
      { title: 'Total Revenue', ...amount(data.totalRevenue || 0) },
      { title: 'ROI', ...percent(data.roi || 0) },
      { title: 'Awards', value: data.awardCount || 0, formatter: count },
      { title: 'Players', value: data.playerCount || 0, formatter: count },
    )
  } else if (level === 'all' || level === 'sport' || level === 'league' || level === 'event') {
    kpis.push(
      { title: 'Total Stakes', ...amount(data.totalStakes || 0) },
      { title: 'Total Payouts', ...amount(data.totalPayouts || 0) },
      { title: 'Gross Gaming Revenue', ...amount(data.grossGamingRevenue || 0) },
      { title: 'Hold Percentage', ...percent(data.holdPercentage || 0) },
      { title: 'Total Bets', value: data.betCount || 0, formatter: count },
      { title: 'Active Players', value: data.activePlayerCount || data.playerCount || 0, formatter: count },
    )
  } else if (level === 'agent') {
    kpis.push(
      { title: 'Total Turnover', ...amount(data.totalTurnover || data.totalStakes || 0) },
      { title: 'Total GGR', ...amount(data.totalGGR || data.grossGamingRevenue || 0) },
      { title: 'Commission Earned', ...amount(data.commissionEarned || data.commission || 0) },
      { title: 'Player Count', value: data.playerCount || 0, formatter: count },
    )
  } else if (level === 'player') {
    if (domain === 'bonuses') {
      kpis.push(
        { title: 'Total Issued', ...amount(data.totalIssued || 0) },
        { title: 'Total Redeemed', ...amount(data.totalRedeemed || 0) },
        { title: 'Total Expired', ...amount(data.totalExpired || 0) },
        { title: 'Avg Amount', ...amount(data.avgAmount || 0) },
        { title: 'Redemption Rate', ...percent(data.redemptionRate || 0) },
        { title: 'Awards', value: data.awardCount || 0, formatter: count },
      )
    } else {
      kpis.push(
        { title: 'Total Stakes', ...amount(data.totalStakes || 0) },
        { title: 'Total Payouts', ...amount(data.totalPayouts || 0) },
        { title: 'Average Stake', ...amount(data.avgStake || 0) },
        { title: 'Win Rate', ...percent(data.winRate || 0) },
        { title: 'Total Bets', value: data.betCount || 0, formatter: count },
      )
    }
  }
  return kpis
}

/* ============================== Filters bar ============================== */

export interface FilterVisibility {
  showDomainFilter: boolean
  showCurrencyFilter: boolean
  showAgentFilter: boolean
  showCampaignFilter: boolean
}

type FilterValues = Pick<ReportingFilters, 'dateFrom' | 'dateTo' | 'currency' | 'domain' | 'agentId' | 'campaignId'>

/** ReportFiltersBar.tsx activeFiltersCount: a whole date range is one filter, the rest count when shown. */
export function activeFilterCount(filters: FilterValues, visible: FilterVisibility): number {
  let total = 0
  if (filters.dateFrom && filters.dateTo) total++
  if (filters.currency && visible.showCurrencyFilter) total++
  if (filters.domain && visible.showDomainFilter) total++
  if (filters.agentId && visible.showAgentFilter) total++
  if (filters.campaignId && visible.showCampaignFilter) total++
  return total
}

/** ReportFiltersBar.tsx handleClearAll: a hidden currency filter keeps its value. */
export function clearedFilters(filters: FilterValues, visible: FilterVisibility): Partial<ReportingFilters> {
  return {
    dateFrom: undefined,
    dateTo: undefined,
    currency: visible.showCurrencyFilter ? undefined : filters.currency,
    domain: undefined,
    agentId: undefined,
    campaignId: undefined,
  }
}

/** The date field's two states: a whole range is "custom"; anything else (none, or one end) is "all". */
export type FilterRangePreset = 'all' | 'custom'

export const FILTER_RANGE_PRESETS: readonly { value: FilterRangePreset; label: string }[] = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

export function filterRangePreset(filters: Pick<ReportingFilters, 'dateFrom' | 'dateTo'>): FilterRangePreset {
  return filters.dateFrom && filters.dateTo ? 'custom' : 'all'
}

export const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'USD' },
  { label: 'INR', value: 'INR' },
  { label: 'EUR', value: 'EUR' },
] as const

export const DOMAIN_OPTIONS = [
  { label: 'Sports', value: 'sports' },
  { label: 'Casino', value: 'casino' },
  { label: 'Matka', value: 'matka' },
  { label: 'Global', value: 'global' },
] as const

/** The agent list is skipped while hidden, and while a search is one character long. */
export function agentSearchSkipped(showAgentFilter: boolean, search: string): boolean {
  return !showAgentFilter || (search.trim().length > 0 && search.trim().length < 2)
}

export interface FilterOption {
  label: string
  value: string
}

interface AgentRow {
  id: string | number
  username?: string | null
  phone?: string | null
}

interface CampaignRow {
  id: string | number
  name?: string | null
  status?: string | null
}

export function agentOptionsFrom(data: { agents?: { agentsPage?: { items?: AgentRow[] | null } | null } | null } | undefined): FilterOption[] {
  const agents = data?.agents?.agentsPage?.items || []
  return agents.map((agent) => ({
    label: `${agent.username}${agent.phone ? ` (${agent.phone})` : ''}`,
    value: String(agent.id),
  }))
}

export function campaignOptionsFrom(data: { bonusCampaigns?: CampaignRow[] | null } | undefined): FilterOption[] {
  const campaigns = data?.bonusCampaigns || []
  return campaigns.map((campaign) => ({
    label: `${campaign.name}${campaign.status ? ` (${campaign.status})` : ''}`,
    value: String(campaign.id),
  }))
}

/** The legacy notFoundContent, as text: what the list says when it has nothing to offer. */
export function agentEmptyText(loading: boolean, search: string): string {
  if (loading) return 'Loading agents'
  return search.trim().length > 0 && search.trim().length < 2 ? 'Type at least 2 characters' : 'No agents found'
}

export function campaignEmptyText(loading: boolean): string {
  return loading ? 'Loading campaigns' : 'No campaigns found'
}

/**
 * Native-select options for a clearable choice: an "All" entry with the empty value (antd allowClear),
 * the loaded options, the retained value when the current list no longer holds it (antd showed the raw
 * value), and a disabled line saying why the list is empty.
 */
export function clearableOptions(
  allLabel: string,
  options: readonly FilterOption[],
  value: string | undefined,
  emptyText: string,
): { label: string; value: string; disabled?: boolean }[] {
  const result: { label: string; value: string; disabled?: boolean }[] = [{ label: allLabel, value: '' }]
  if (value && !options.some((option) => option.value === value)) result.push({ label: value, value })
  result.push(...options)
  if (options.length === 0) result.push({ label: emptyText, value: '__empty__', disabled: true })
  return result
}

/* ============================== Charts ============================== */

/** TrendCard/ContextCharts X tick: an ISO-ish date becomes "MMM d"; anything else passes through. */
export function formatTrendAxisDate(value: string, formatDate: (value: string, pattern: string) => string): string {
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return formatDate(value, 'MMM d')
  } catch {
    return value
  }
}

/** TrendCard's Y tick: 1.2M, 3.4K, else the plain number. */
export function compactAxisValue(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return value.toString()
}

/** TrendCard's tooltip figure: the line's own formatter, else two fixed decimals in the locale. */
export function trendTooltipValue(value: number, locale: string, formatter?: (value: number) => string): string {
  if (formatter) return formatter(value)
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Series colour slots. Up to three series take the chart ramp in order (--s1, --s2, --s3: one indigo
 * in three steps, tokens.css); a fourth series cannot be told apart on that ramp, so a chart with more
 * than three takes the decorative hue ramp instead (the token file's own rule for categorical series).
 */
export type SeriesSlot = 's1' | 's2' | 's3' | 'hInd' | 'hRed' | 'hGrn' | 'hVio' | 'hBlu' | 'hAmb'

const RAMP: readonly SeriesSlot[] = ['s1', 's2', 's3']
const HUES: readonly SeriesSlot[] = ['hInd', 'hRed', 'hGrn', 'hVio', 'hBlu', 'hAmb']

export function seriesSlots(seriesCount: number): SeriesSlot[] {
  const source = seriesCount <= RAMP.length ? RAMP : HUES
  return Array.from({ length: Math.max(0, seriesCount) }, (_, index) => source[index % source.length])
}

/** A plotted series: a line names its own slot when its colour carries a reading (see contextChartCopy). */
export interface SlottedSeries {
  key: string
  name: string
  slot?: SeriesSlot
}

/** Each line's slot: the one it names, else its place on seriesSlots. Lines, tips and legend all read it. */
export function lineSlots(lines: readonly Pick<SlottedSeries, 'slot'>[]): SeriesSlot[] {
  const fallback = seriesSlots(lines.length)
  return lines.map((line, index) => line.slot ?? fallback[index])
}

export interface LegendItem {
  key: string
  name: string
  slot: SeriesSlot
}

/**
 * The legend's entries, in series order, each with its line's slot. The legend is drawn from this and
 * not from recharts' payload: recharts 3 sorts that payload by name (Legend itemSorter 'value'), so a
 * swatch coloured by position would label the wrong line.
 */
export function seriesLegend(lines: readonly SlottedSeries[]): LegendItem[] {
  const slots = lineSlots(lines)
  return lines.map((line, index) => ({ key: line.key, name: line.name, slot: slots[index] }))
}

/** A categorical slice or bar takes the hue ramp, cycling as the legacy six-colour list did. */
export function categorySlot(index: number): SeriesSlot {
  return HUES[index % HUES.length]
}

export type ChartDomain = 'sports' | 'casino' | 'matka' | 'bonuses'

export interface DistributionRow {
  name: string
  totalStakes: number
  grossGamingRevenue: number
}

/** ContextCharts' distribution rows: the top ten, renamed per domain exactly as before. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function distributionData(domain: ChartDomain, breakdown: any[] | null | undefined): DistributionRow[] {
  const rawBreakdown = breakdown?.slice(0, 10) || []
  if (domain === 'bonuses') {
    return rawBreakdown.map((r) => ({
      name: r.campaignName ?? 'Unknown',
      totalStakes: r.totalIssued ?? 0,
      grossGamingRevenue: r.totalRedeemed ?? 0,
    }))
  }
  if (domain === 'casino') {
    return rawBreakdown.map((r) => ({
      name: r.gameName ?? r.vendorName ?? 'Unknown',
      totalStakes: r.totalStakes ?? 0,
      grossGamingRevenue: r.grossGamingRevenue ?? 0,
    }))
  }
  return rawBreakdown
}

export interface ContextChartCopy {
  trendTitle: string
  barTitle: string
  barSeries: string
  pieTitle: string
  lines: SlottedSeries[]
}

export function contextChartCopy(domain: ChartDomain): ContextChartCopy {
  if (domain === 'bonuses') {
    return {
      trendTitle: 'Bonus Trends',
      barTitle: 'Top Campaigns (Issued)',
      barSeries: 'Total Issued',
      pieTitle: 'Distribution (Redeemed)',
      // The legacy lines were indigo, green, red and amber in this order, so redeemed bonuses read
      // green and expired ones red. Named slots keep that reading; the hue ramp's own order would
      // swap the two.
      lines: [
        { key: 'issued', name: 'Issued', slot: 'hInd' },
        { key: 'redeemed', name: 'Redeemed', slot: 'hGrn' },
        { key: 'expired', name: 'Expired', slot: 'hRed' },
        { key: 'revenue', name: 'Revenue', slot: 'hAmb' },
      ],
    }
  }
  return {
    trendTitle: 'Performance Trends',
    barTitle: 'Top Performers (Stakes)',
    barSeries: 'Total Stakes',
    pieTitle: 'Distribution (GGR)',
    lines: [
      { key: 'stakes', name: 'Stakes' },
      { key: 'payouts', name: 'Payouts' },
      { key: 'ggr', name: 'GGR' },
    ],
  }
}

/** The pie's in-plot label, "name: 42%". */
export function pieLabelText(name: unknown, percent: unknown): string {
  return `${name ?? ''}: ${(Number(percent ?? 0) * 100).toFixed(0)}%`
}

/* ============================== Drill-down table ============================== */

export type DataIndex = string | number | readonly (string | number)[]

/**
 * antd's dataIndex lookup (rc-table useCellRender + rc-util get): a key, or a path of keys. A column
 * with no dataIndex (undefined, null or '') reads the empty path, which is the record itself, so a
 * legacy `render: (record) => …` column keeps working.
 */
export function cellValue(row: unknown, dataIndex: DataIndex | null | undefined): unknown {
  const path: readonly (string | number)[] =
    dataIndex === undefined || dataIndex === null || dataIndex === ''
      ? []
      : Array.isArray(dataIndex)
        ? dataIndex
        : [dataIndex as string | number]
  let current: unknown = row
  for (const key of path) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/** A rendered cell for a column with no render function, as antd printed it. */
export function plainCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

export function resolveRowKey<T>(rowKey: string | ((record: T) => string), row: T): string {
  if (typeof rowKey === 'function') return rowKey(row)
  return String((row as Record<string, unknown>)[rowKey])
}

/** The legacy default: 20 rows a page, "Total N items". */
export const DRILL_DOWN_PAGE_SIZE = 20

/** antd's own size-changer list, which the legacy table showed. */
export const DRILL_DOWN_PAGE_SIZES: readonly number[] = [10, 20, 50, 100]

export function drillDownSummary(total: number): string {
  return `Total ${total} items`
}

/**
 * The rows one page shows, by antd Table's rule: rows fewer than a supplied total are a server page
 * and show as given (sliced only if longer than a page); otherwise the rows are sliced locally.
 */
export function pageRows<T>(rows: readonly T[], current: number, pageSize: number, total?: number): T[] {
  const size = Math.max(1, Math.trunc(pageSize) || DRILL_DOWN_PAGE_SIZE)
  const page = Math.max(1, Math.trunc(current) || 1)
  if (total !== undefined && rows.length < total && rows.length <= size) return [...rows]
  return rows.slice((page - 1) * size, page * size)
}

/* ============================== Breadcrumbs ============================== */

export function domainRootLabel(domain: string): string {
  return `All ${domain.charAt(0).toUpperCase() + domain.slice(1)}`
}

/* ============================== Detail drawer ============================== */

export interface DetailFilter {
  sportId?: string
  leagueId?: string
  eventId?: string
  vendorId?: string | number
  gameId?: string | number
  dateFrom?: string
  dateTo?: string
  currency?: string
  _refreshKey?: number
}

export function hasSportsContext(domain: string | undefined, filter: DetailFilter | undefined): boolean {
  return Boolean(domain === 'sports' && filter && (filter.sportId || filter.leagueId || filter.eventId))
}

export function hasCasinoContext(domain: string | undefined, filter: DetailFilter | undefined): boolean {
  return Boolean(domain === 'casino' && filter && (filter.vendorId != null || filter.gameId != null))
}

/** The "<Level> Context" tag. */
export function contextLabel(domain: string | undefined, filter: DetailFilter | undefined): string {
  if (domain === 'sports') {
    return filter?.eventId ? 'Event' : filter?.leagueId ? 'League' : filter?.sportId ? 'Sport' : 'All'
  }
  if (domain === 'casino') {
    return filter?.gameId ? 'Game' : filter?.vendorId ? 'Vendor' : 'All'
  }
  return 'All'
}

export function noSelectionMessage(domain: string | undefined): string {
  return domain === 'casino'
    ? 'Drill into a vendor or select a game to see contributing players and agents.'
    : 'Drill into a sport, league, or event to see contributing players and agents.'
}

export interface SportsBet {
  id: string
  side?: string | null
  price?: number | string | null
  stake?: number | string | null
  liability?: number | string | null
  status?: string | null
  result?: number | string | null
  oddsSize?: number | string | null
}

/**
 * The sports P/L column, verbatim: settled won/lost only (null otherwise). Fancy bets (oddsSize > 0)
 * pay the posted result on a back win, result minus liability on a lay win, and lose the stake or the
 * liability; a matched-odds bet wins stake × (price − 1) and loses its stake.
 */
export function sportsBetPnl(record: SportsBet): number | null {
  if (record.status !== 'won' && record.status !== 'lost') return null
  const stake = Number(record.stake) || 0
  const liability = Number(record.liability) || 0
  const price = Number(record.price) || 0
  const oddsSize = record.oddsSize != null ? Number(record.oddsSize) : 0
  const isFancy = oddsSize > 0
  const resultNum =
    record.result != null && String(record.result).trim() !== '' ? Number(String(record.result).trim()) : NaN
  const hasResult = !Number.isNaN(resultNum)
  let pl = 0
  if (record.status === 'won') {
    if (isFancy) {
      if (record.side === 'back') pl = hasResult ? resultNum : 0
      else pl = hasResult ? resultNum - liability : 0
    } else {
      pl = stake * (price - 1)
    }
  } else if (isFancy) {
    pl = record.side === 'back' ? -stake : -liability
  } else {
    pl = -stake
  }
  return pl
}

export interface CasinoBet {
  id: string
  stake?: number | string | null
  payout?: number | string | null
  winAmount?: number | string | null
  status?: string | null
}

/** The casino P/L column: payout (or win amount) minus stake. */
export function casinoBetPnl(record: CasinoBet): number {
  const stake = Number(record.stake) || 0
  const payout = Number(record.payout || record.winAmount) || 0
  return payout - stake
}

/* The legacy antd Tag colours per status, carried onto the kit's semantic tones. The legacy
   map, not toneForStatus, decides: a settled sports bet was blue (info), not green. */
const SPORTS_STATUS_TONES: Readonly<Record<string, StatusPillTone>> = {
  won: 'ok',
  lost: 'neg',
  settled: 'info',
  matched: 'info',
  unmatched: 'warn',
  void: 'neutral',
  cancelled: 'neutral',
}

const CASINO_STATUS_TONES: Readonly<Record<string, StatusPillTone>> = {
  won: 'ok',
  lost: 'neg',
  pending: 'neutral',
  active: 'info',
  cancelled: 'neutral',
  void: 'neutral',
}

export function betStatusTone(domain: string | undefined, status: string | null | undefined): StatusPillTone {
  const map = domain === 'casino' ? CASINO_STATUS_TONES : SPORTS_STATUS_TONES
  return (status && map[status]) || 'neutral'
}

/** "+₹10.00" / "-₹10.00": the sign the legacy column printed before the amount. */
export function signedAmount(value: number, format: (value: number) => string): string {
  return `${value >= 0 ? '+' : ''}${format(value)}`
}
