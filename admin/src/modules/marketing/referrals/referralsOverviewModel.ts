/* Pure logic of /referrals (W6 Task 175): the period filter and its query variables, the rows and
   reward modes the page shows, the six referral figures and the earnings table's cell text and
   sorting. React-free, so the page and its tests share one reading of the legacy page. */
import { istDayEnd, istDayStart, isDayString } from '@/ui/components/istDate'

/** One `referralEarnings` row, exactly the fields the overview's earnings document selects. */
export interface ReferralEarningRow {
  id?: string
  referrerId?: string | number
  refereeId?: string | number
  tier?: number
  ruleType?: string
  grossAmount?: number | string
  netAmount?: number | string
  currency?: string
  calculatedAt?: string
}

/** `referralProgramByTenant` as the overview selects it. */
export interface ReferralProgramSummary {
  id?: string
  name?: string | null
  enabledModes?: readonly string[] | null
  maxDepth?: number | null
}

/** `referralStats`, as the stats cards select it. */
export interface ReferralStatsData {
  totalClicks?: number | null
  totalSignups?: number | null
  totalAttributions?: number | null
  totalEarnings?: number | null
  totalSettled?: number | null
  totalPending?: number | null
  currency?: string | null
  periodStart?: string | null
  periodEnd?: string | null
}

/** The applied period: two IST `yyyy-MM-dd` days, or neither (every date, the legacy default). */
export interface ReferralDateRange {
  from?: string
  to?: string
}

export type ReferralDatePreset = 'all' | 'custom'

/** The legacy filter had only a range picker; its cleared state meant every date. */
export const REFERRAL_DATE_PRESETS: ReadonlyArray<{ value: ReferralDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

/** The rule type the referral pages never show (revenue share is not offered). */
export const HIDDEN_RULE_TYPE = 'REVSHARE'

/** A complete, well-formed range filters by date; anything else is the unfiltered state. */
export function normalizeReferralRange(range: ReferralDateRange | null | undefined): ReferralDateRange {
  if (!range || !isDayString(range.from) || !isDayString(range.to)) return {}
  return range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from }
}

export function referralDatePreset(range: ReferralDateRange | null | undefined): ReferralDatePreset {
  return normalizeReferralRange(range).from ? 'custom' : 'all'
}

/**
 * The period as the two documents' `fromDate` / `toDate`: the start of the first IST day and the end
 * of the last one. Named change: the legacy picker sent each picked day's browser midnight, so the
 * last day was left out and a one-day range matched nothing.
 */
export function referralRangeVariables(range: ReferralDateRange | null | undefined): {
  fromDate: string | undefined
  toDate: string | undefined
} {
  const applied = normalizeReferralRange(range)
  return {
    fromDate: applied.from ? istDayStart(applied.from) : undefined,
    toDate: applied.to ? istDayEnd(applied.to) : undefined,
  }
}

/** The earnings the overview lists: every row but revenue share, in the server's order. */
export function visibleEarnings(rows: readonly ReferralEarningRow[] | null | undefined): ReferralEarningRow[] {
  return (rows ?? []).filter((row) => row.ruleType !== HIDDEN_RULE_TYPE)
}

/** The program's reward modes as the configuration card lists them (revenue share left out). */
export function visibleRewardModes(modes: readonly string[] | null | undefined): string[] {
  return (modes ?? []).filter((mode) => mode !== HIDDEN_RULE_TYPE)
}

/** `SIGNUP_CPA` reads `SIGNUP CPA`, as the legacy tags printed it. */
export function ruleTypeLabel(type: string | null | undefined): string {
  return (type ?? '').replace(/_/g, ' ')
}

export function tierLabel(tier: number | null | undefined): string {
  return `L${tier ?? ''}`
}

export function maxDepthLabel(depth: number | null | undefined): string {
  return `${depth ?? ''} tiers`
}

/** The row key: the earning id, which the legacy table keyed on too. */
export function earningRowKey(row: ReferralEarningRow, index = 0): string {
  return row.id !== undefined && row.id !== null ? String(row.id) : `row-${index}`
}

/* The legacy column sorters, verbatim. The table applies the direction. */
export function compareTier(a: ReferralEarningRow, b: ReferralEarningRow): number {
  return (a.tier ?? 0) - (b.tier ?? 0)
}

export function compareNetAmount(a: ReferralEarningRow, b: ReferralEarningRow): number {
  return Number(a.netAmount) - Number(b.netAmount)
}

export function compareCalculatedAt(a: ReferralEarningRow, b: ReferralEarningRow): number {
  return new Date(a.calculatedAt ?? 0).getTime() - new Date(b.calculatedAt ?? 0).getTime()
}

export interface EarningsSort {
  key: string
  dir: 'asc' | 'desc'
}

const EARNING_COMPARATORS: Readonly<Record<string, (a: ReferralEarningRow, b: ReferralEarningRow) => number>> = {
  tier: compareTier,
  netAmount: compareNetAmount,
  calculatedAt: compareCalculatedAt,
}

/** The sortable columns, in the legacy order: Tier, Amount, Date. */
export const SORTABLE_EARNING_COLUMNS = Object.keys(EARNING_COMPARATORS)

/**
 * The whole list in the chosen order (antd sorted every row, then paged): ascending runs the legacy
 * sorter, descending reverses its result, equal rows keep the server order. No sort is the server order.
 */
export function sortEarnings(
  rows: readonly ReferralEarningRow[],
  sort: EarningsSort | null | undefined,
): ReferralEarningRow[] {
  const comparator = sort ? EARNING_COMPARATORS[sort.key] : undefined
  if (!sort || !comparator) return [...rows]
  const direction = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => direction * comparator(a, b))
}

/** Ten rows a page, as the legacy table showed; the kit pager also offers larger pages. */
export const EARNINGS_PAGE_SIZE = 10
export const EARNINGS_PAGE_SIZES: readonly number[] = [10, 20, 50, 100]

/** A page past the end shows the last page (antd clamped the same way). */
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

export interface ReferralStatsFigures {
  clicks: string
  signups: string
  earnings: number
  settled: number
  pending: number
  currency: string
  conversionRate: string
}

/**
 * The six figures, as the legacy cards computed them: counts in the browser's number format, missing
 * amounts as 0 in the stats currency (INR when absent), and signups over clicks to two decimals
 * (`0.00` unless both are non-zero).
 */
export function referralStatsFigures(stats: ReferralStatsData | null | undefined): ReferralStatsFigures {
  const clicks = stats?.totalClicks
  const signups = stats?.totalSignups
  return {
    clicks: (clicks || 0).toLocaleString(),
    signups: (signups || 0).toLocaleString(),
    earnings: stats?.totalEarnings || 0,
    settled: stats?.totalSettled || 0,
    pending: stats?.totalPending || 0,
    currency: stats?.currency || 'INR',
    conversionRate: signups && clicks ? ((signups / clicks) * 100).toFixed(2) : '0.00',
  }
}
