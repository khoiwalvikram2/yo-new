/* Pure logic of /referrals/top-referrers (W6 Task 179): the three filters and their query variables, the
   filter count, the server rank, the legacy column sorters, paging, the totals and the cell text.
   React-free, so the page and its tests share one reading of the legacy page. */
import { istDayEnd, istDayStart, isDayString } from '@/ui/components/istDate'

/** One `topReferrers` row, exactly the fields the page's document selects. */
export interface TopReferrerRow {
  referrerId: number | string
  referrerName?: string | null
  referrerPhone?: string | null
  totalEarnings?: number | string | null
  totalReferrals?: number | null
  activeReferrals?: number | null
  totalTransactions?: number | null
  totalClicks?: number | null
  conversionRate?: number | null
}

/** A row with its place in the server's answer (1 is the top referrer for the chosen order). */
export interface RankedReferrer extends TopReferrerRow {
  rank: number
}

export type TopReferrersSortBy = 'referrals' | 'earnings' | 'conversion'

export const DEFAULT_SORT_BY: TopReferrersSortBy = 'earnings'
export const DEFAULT_LIMIT = 50

/** The legacy Sort By choices, in their order. */
export const SORT_BY_OPTIONS: ReadonlyArray<{ value: TopReferrersSortBy; label: string }> = [
  { value: 'earnings', label: 'Total Earnings' },
  { value: 'referrals', label: 'Total Referrals' },
  { value: 'conversion', label: 'Conversion Rate' },
]

/** The legacy Limit choices; the select works in strings, the query in numbers. */
export const LIMIT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '25', label: 'Top 25' },
  { value: '50', label: 'Top 50' },
  { value: '100', label: 'Top 100' },
]

export function isTopReferrersSortBy(value: string): value is TopReferrersSortBy {
  return SORT_BY_OPTIONS.some((option) => option.value === value)
}

/** A limit the select does not offer falls back to the default, so a damaged value never reaches the query. */
export function parseLimit(value: string): number {
  return LIMIT_OPTIONS.some((option) => option.value === value) ? Number(value) : DEFAULT_LIMIT
}

/** The applied period: two IST `yyyy-MM-dd` days, or neither (every date, the legacy default). */
export interface TopReferrersDateRange {
  from?: string
  to?: string
}

export type TopReferrersDatePreset = 'all' | 'custom'

/** The legacy picker had no presets; its cleared state meant every date. */
export const TOP_REFERRERS_DATE_PRESETS: ReadonlyArray<{ value: TopReferrersDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

export function normalizeTopReferrersRange(range: TopReferrersDateRange | null | undefined): TopReferrersDateRange {
  if (!range || !isDayString(range.from) || !isDayString(range.to)) return {}
  return range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from }
}

export function topReferrersDatePreset(range: TopReferrersDateRange | null | undefined): TopReferrersDatePreset {
  return normalizeTopReferrersRange(range).from ? 'custom' : 'all'
}

/**
 * The variables in the legacy key order. The period is the start of its first IST day and the end of its
 * last, the instants the legacy page computed with `dayjs.tz(…, 'Asia/Kolkata').startOf/endOf('day')`.
 */
export function topReferrersVariables(
  limit: number,
  sortBy: TopReferrersSortBy,
  range: TopReferrersDateRange | null | undefined,
): { limit: number; sortBy: TopReferrersSortBy; fromDate: string | undefined; toDate: string | undefined } {
  const applied = normalizeTopReferrersRange(range)
  return {
    limit,
    sortBy,
    fromDate: applied.from ? istDayStart(applied.from) : undefined,
    toDate: applied.to ? istDayEnd(applied.to) : undefined,
  }
}

/** Each filter away from its default counts once: a period, a limit other than 50, an order other than earnings. */
export function topReferrersFilterCount(
  sortBy: TopReferrersSortBy,
  limit: number,
  range: TopReferrersDateRange | null | undefined,
): number {
  return [topReferrersDatePreset(range) === 'custom', limit !== DEFAULT_LIMIT, sortBy !== DEFAULT_SORT_BY]
    .filter(Boolean).length
}

/**
 * Each referrer's place in the server's answer. Named change: the legacy Rank printed the row's index on
 * the current table page, so page 2 started again at #1 and a column sort renumbered the rows.
 */
export function rankReferrers(rows: readonly TopReferrerRow[] | null | undefined): RankedReferrer[] {
  return (rows ?? []).map((row, index) => ({ ...row, rank: index + 1 }))
}

/* The legacy column sorters, verbatim; the table applies the direction. */
export function compareReferrerName(a: TopReferrerRow, b: TopReferrerRow): number {
  return (a.referrerName || '').localeCompare(b.referrerName || '')
}

export function compareTotalReferrals(a: TopReferrerRow, b: TopReferrerRow): number {
  return Number(a.totalReferrals) - Number(b.totalReferrals)
}

export function compareTotalEarnings(a: TopReferrerRow, b: TopReferrerRow): number {
  return Number(a.totalEarnings) - Number(b.totalEarnings)
}

export function compareConversionRate(a: TopReferrerRow, b: TopReferrerRow): number {
  return Number(a.conversionRate) - Number(b.conversionRate)
}

const COMPARATORS: Readonly<Record<string, (a: TopReferrerRow, b: TopReferrerRow) => number>> = {
  referrer: compareReferrerName,
  totalReferrals: compareTotalReferrals,
  totalEarnings: compareTotalEarnings,
  conversionRate: compareConversionRate,
}

/** The sortable columns, in the legacy order: Referrer, Total Referrals, Total Earnings, Conversion %. */
export const SORTABLE_REFERRER_COLUMNS = Object.keys(COMPARATORS)

export interface ReferrerSort {
  key: string
  dir: 'asc' | 'desc'
}

/** Every returned row in the chosen order (antd sorted all rows, then paged); ties keep the server order. */
export function sortReferrers<T extends TopReferrerRow>(rows: readonly T[], sort: ReferrerSort | null | undefined): T[] {
  const comparator = sort ? COMPARATORS[sort.key] : undefined
  if (!sort || !comparator) return [...rows]
  const direction = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => direction * comparator(a, b))
}

/** Twenty rows a page, as the legacy table; its size changer now takes effect. */
export const TOP_REFERRERS_PAGE_SIZE = 20
export const TOP_REFERRERS_PAGE_SIZES: readonly number[] = [10, 20, 50, 100]

export function clampPage(page: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / size))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, Math.trunc(pageSize) || 1)
  const start = (clampPage(page, rows.length, size) - 1) * size
  return rows.slice(start, start + size)
}

export interface TopReferrerTotals {
  earnings: number
  referrals: number
  referrers: number
}

/** The legacy summary: summed earnings and referrals (a missing value counts 0) and the row count. */
export function topReferrerTotals(rows: readonly TopReferrerRow[]): TopReferrerTotals {
  return {
    earnings: rows.reduce((sum, row) => sum + Number(row.totalEarnings || 0), 0),
    referrals: rows.reduce((sum, row) => sum + Number(row.totalReferrals || 0), 0),
    referrers: rows.length,
  }
}

export function referrerNameText(name: string | null | undefined): string {
  return name?.trim() || '—'
}

export function referrerPhoneText(phone: string | null | undefined): string {
  return phone?.trim() || '—'
}

export function referrerStatsPath(referrerId: number | string): string {
  return `/referrals/referrers/${referrerId}`
}

/** Clicks and transactions in the browser's number format, `—` when missing. */
export function countText(count: number | null | undefined): string {
  return count?.toLocaleString() ?? '—'
}

export function conversionText(rate: number | null | undefined): string {
  return rate != null ? `${Number(rate).toFixed(2)}%` : '—'
}

/** The legacy emphasis: 10% and up reads high, 5% and up middling, anything else plain. */
export function conversionLevel(rate: number | null | undefined): 'high' | 'mid' | 'plain' {
  if (rate == null) return 'plain'
  if (rate >= 10) return 'high'
  if (rate >= 5) return 'mid'
  return 'plain'
}

/** The top three carry a trophy (gold, silver, bronze in the legacy colours); the rest none. */
export function rankMedal(rank: number): 'gold' | 'silver' | 'bronze' | null {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return null
}

export function topReferrersEmptyText(hasFilters: boolean): string {
  return hasFilters ? 'No referrers match your filters' : 'No referrers data available'
}

export function topReferrerRowKey(row: TopReferrerRow): string {
  return String(row.referrerId)
}
