import { istDayEnd, istDayStart } from '@/ui/components/istDate'

/* The pure model behind /referrals/earnings (W6 Task 178). The legacy antd page (pre-image in
 * .backups/page-migration-2026-09-22/task-178) is the contract: the search thresholds, the query
 * variables, the filter count, the table's client-side sorters and column filters, the totals and the
 * search-field copy are transcribed from it. No React here. */

export const MIN_SEARCH_LEN = 3
export const SEARCH_DEBOUNCE_MS = 350

/** antd's default page sizes; the legacy table opened at 20 a page. */
export const EARNINGS_PAGE_SIZE = 20
export const EARNINGS_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export interface UserOption {
  value: string
  label: string
}

export function userToOption(user: { id: string | number; name?: string | null; phone?: string | null }): UserOption {
  const label = [user.name, user.phone].filter(Boolean).join(' · ')
  return { value: String(user.id), label: label || String(user.id) }
}

/** Two `yyyy-MM-dd` IST calendar days, both ends inclusive. */
export interface EarningsDateRange {
  from: string
  to: string
}

export interface EarningsFilters {
  referrerId?: string
  refereeId?: string
  ruleType?: string
  /** Kept in the variables as before; no control has ever set it. */
  tier?: number
  dateRange?: EarningsDateRange
}

export interface ReferralEarning {
  id: string
  referrerId: string | number
  refereeId: string | number
  referrerName?: string | null
  referrerPhone?: string | null
  refereeName?: string | null
  refereePhone?: string | null
  tier: number | null
  ruleType: string | null
  grossAmount: number | string | null
  netAmount: number | string | null
  currency?: string | null
  calculatedAt?: string | null
}

/**
 * The ReferralEarnings variables in the legacy order. Named change: a date range sends the IST start of
 * its first day and the IST end of its last (the antd picker sent the picked days at the browser's
 * time of day).
 */
export function earningsQueryVariables(filters: EarningsFilters) {
  return {
    referrerId: filters.referrerId?.trim() || undefined,
    refereeId: filters.refereeId?.trim() || undefined,
    ruleType: filters.ruleType,
    tier: filters.tier,
    fromDate: filters.dateRange ? istDayStart(filters.dateRange.from) : undefined,
    toDate: filters.dateRange ? istDayEnd(filters.dateRange.to) : undefined,
  }
}

/** REVSHARE earnings exist server-side but the page has never listed them. */
export function displayedEarnings<T extends Pick<ReferralEarning, 'ruleType'>>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.ruleType !== 'REVSHARE')
}

/** The legacy filter count: referrer, referee, rule type, tier and a date range each count once. */
export function earningsFilterCount(filters: EarningsFilters): number {
  return [
    filters.referrerId !== undefined && filters.referrerId !== '',
    filters.refereeId !== undefined && filters.refereeId !== '',
    filters.ruleType !== undefined && filters.ruleType !== '',
    filters.tier !== undefined && filters.tier !== null,
    Boolean(filters.dateRange),
  ].filter(Boolean).length
}

export function hasEarningsFilters(filters: EarningsFilters): boolean {
  return earningsFilterCount(filters) > 0
}

/* ---------- the table ---------- */

/** The legacy Rule Type filter options (the bar's select and the column's filter shared them). */
export const RULE_TYPE_FILTER_OPTIONS = [
  { value: 'SIGNUP_CPA', label: 'Signup CPA' },
  { value: 'FIRST_DEPOSIT_PCT', label: 'First Deposit %' },
  { value: 'RELOAD_DEPOSITS_PCT', label: 'Reload Deposits %' },
  { value: 'DEPOSITS_WINDOW_PCT', label: 'Deposits Window %' },
  { value: 'ACTIVITY_MILESTONE', label: 'Activity Milestone' },
] as const

/** The legacy Tier column filter: Tier 1 to Tier 5. */
export const TIER_FILTER_OPTIONS = [1, 2, 3, 4, 5].map((tier) => ({ value: String(tier), label: `Tier ${tier}` }))

export interface EarningsColumnFilters {
  /** Tier numbers as strings, as the multi-select holds them. */
  tiers: readonly string[]
  ruleTypes: readonly string[]
}

/**
 * The table's own filters (antd column filters, moved into the filter bar by D5): any chosen tier and
 * any chosen rule type, the two combined, applied to the rows on screen only.
 */
export function applyColumnFilters<T extends Pick<ReferralEarning, 'tier' | 'ruleType'>>(
  rows: readonly T[],
  filters: EarningsColumnFilters,
): T[] {
  return rows.filter((row) => (
    (filters.tiers.length === 0 || filters.tiers.some((tier) => row.tier === Number(tier)))
    && (filters.ruleTypes.length === 0 || filters.ruleTypes.some((type) => row.ruleType === type))
  ))
}

export function columnFilterCount(filters: EarningsColumnFilters): number {
  return Number(filters.tiers.length > 0) + Number(filters.ruleTypes.length > 0)
}

export type EarningsSortKey = 'referrer' | 'referee' | 'tier' | 'grossAmount' | 'netAmount' | 'calculatedAt'

export interface EarningsSort {
  key: string
  dir: 'asc' | 'desc'
}

type Row = ReferralEarning

/** The legacy antd sorters, column by column. */
export const EARNINGS_COMPARATORS: Record<EarningsSortKey, (a: Row, b: Row) => number> = {
  referrer: (a, b) => (a.referrerName || '').localeCompare(b.referrerName || ''),
  referee: (a, b) => (a.refereeName || '').localeCompare(b.refereeName || ''),
  tier: (a, b) => (a.tier as number) - (b.tier as number),
  grossAmount: (a, b) => Number(a.grossAmount) - Number(b.grossAmount),
  netAmount: (a, b) => Number(a.netAmount) - Number(b.netAmount),
  calculatedAt: (a, b) => {
    const t1 = a.calculatedAt ? new Date(a.calculatedAt).getTime() : 0
    const t2 = b.calculatedAt ? new Date(b.calculatedAt).getTime() : 0
    return t1 - t2
  },
}

function isSortKey(key: string): key is EarningsSortKey {
  return Object.prototype.hasOwnProperty.call(EARNINGS_COMPARATORS, key)
}

/** A stable sort; descending reverses the comparator, as antd did. No sort keeps the server order. */
export function sortEarnings<T extends Row>(rows: readonly T[], sort: EarningsSort | null): T[] {
  if (!sort || !isSortKey(sort.key)) return [...rows]
  const compare = EARNINGS_COMPARATORS[sort.key]
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => direction * compare(a, b))
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
}

/** The rows of one page; a page past the end shows the last one (antd clamped the same way). */
export function pageOf<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(rows.length, pageSize))
  const start = (current - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function earningsTotalLabel(total: number): string {
  return `Total ${total} earnings`
}

export interface EarningsTotals {
  net: number
  gross: number
  count: number
  /** The first row's currency, as the legacy summary used for every total. */
  currency: string
}

export function earningsTotals(rows: readonly Row[]): EarningsTotals {
  return {
    net: rows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0),
    gross: rows.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0),
    count: rows.length,
    currency: rows[0]?.currency || 'INR',
  }
}

export function tierText(tier: number | null | undefined): string {
  return tier != null ? `L${tier}` : '—'
}

export function ruleTypeText(ruleType: string | null | undefined): string {
  return ruleType ? ruleType.replace(/_/g, ' ') : '—'
}

export function earningsEmptyTitle(filtered: boolean): string {
  return filtered ? 'No earnings match your filters' : 'No earnings data available'
}

/* ---------- the referrer and referee searches ---------- */

/** The chosen referrer, the one found through a referee, then the search results; each person once. */
export function mergeReferrerOptions(
  selected: UserOption | null,
  fromReferee: UserOption | null,
  searched: readonly UserOption[],
): UserOption[] {
  const combined = [...(selected ? [selected] : []), ...(fromReferee ? [fromReferee] : []), ...searched]
  const seen = new Set<string>()
  return combined.filter((option) => {
    if (seen.has(option.value)) return false
    seen.add(option.value)
    return true
  })
}

/** The chosen referee stays listed while a new search runs. */
export function mergeRefereeOptions(selected: UserOption | null, options: readonly UserOption[]): UserOption[] {
  if (!selected || options.some((option) => option.value === selected.value)) return [...options]
  return [selected, ...options]
}

export function referrerEmptyText(search: string): string {
  return search.trim().length < MIN_SEARCH_LEN ? `Type ${MIN_SEARCH_LEN}+ chars` : 'No users found'
}

export function refereePlaceholder(referrerId: string | undefined): string {
  return referrerId ? "Referee (this referrer's referrals)" : 'Referee (search name or phone)'
}

export function refereeLoading(state: {
  refereesLoading: boolean
  usersSearchLoading: boolean
  search: string
  referrerId: string | undefined
}): boolean {
  return state.refereesLoading || (!!state.search.trim() && !state.referrerId && state.usersSearchLoading)
}

/** The legacy notFoundContent; null while a search is running (antd showed an empty list). */
export function refereeEmptyText(state: {
  refereesLoading: boolean
  usersSearchLoading: boolean
  search: string
  referrerId: string | undefined
}): string | null {
  if (state.refereesLoading || (!state.referrerId && state.usersSearchLoading)) return null
  const short = state.search.trim().length < MIN_SEARCH_LEN
  if (short && !state.referrerId) return `Type ${MIN_SEARCH_LEN}+ chars`
  if (state.referrerId && short) return 'No referees'
  return 'No one found'
}

export type SearchKeyAction = 'pickFirst' | 'none'

/**
 * antd made the first option active whenever the list changed, so Enter or Tab took the first person a
 * server search returned. The kit highlights while typing, before the debounced results arrive; with the
 * list open and nothing active, Enter or Tab picks the first person here instead.
 */
export function searchKeyAction(
  key: string,
  state: { listOpen: boolean; optionActive: boolean; hasOptions: boolean },
): SearchKeyAction {
  if (!state.listOpen || state.optionActive || !state.hasOptions) return 'none'
  return key === 'Enter' || key === 'Tab' ? 'pickFirst' : 'none'
}

/* ---------- the date filter ---------- */

/** The legacy picker had no presets: empty meant every date, otherwise a custom range. */
export type EarningsDatePreset = 'all' | 'custom'

export const EARNINGS_DATE_PRESETS: ReadonlyArray<{ value: EarningsDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

export function earningsDatePreset(range: EarningsDateRange | undefined): EarningsDatePreset {
  return range ? 'custom' : 'all'
}
