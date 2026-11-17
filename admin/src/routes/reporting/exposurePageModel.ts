import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, format, subDays } from 'date-fns'
import { ADMIN_TZ, isDayString, istToday } from '@/ui/components/istDate'

export interface ExposureDataPoint {
  date: string
  value: number
  dimension: string
}

export type ExposureDomain = 'all' | 'sports' | 'matka'
export type ExposureDatePreset = 'allTime' | 'today' | 'yesterday' | 'custom'

export interface ExposureDateRange {
  dateFrom: string
  dateTo: string
}

export type ExposureSortKey = 'date' | 'value'
export type ExposureSortDirection = 'asc' | 'desc'

export interface ExposureSort {
  key: ExposureSortKey
  dir: ExposureSortDirection
}

export interface ExposureFilterOptions {
  domain: ExposureDomain
  search: string
  formatDate: (date: string) => string
  formatAmount: (amount: number) => string
  convertAmount: (amount: number) => number
}

export interface ExposureMetrics {
  avgExposure: number
  maxExposure: number
  minExposure: number
  exposureChange: number
}

export const EXPOSURE_DATE_PRESETS = [
  { value: 'allTime', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'custom', label: 'Custom' },
] as const satisfies readonly { value: ExposureDatePreset; label: string }[]

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

const DEFAULT_ALLOWED_DOMAINS = ['sports', 'casino', 'matka'] as const

function istDateForDay(day: string): TZDate {
  if (!isDayString(day)) {
    throw new Error(`Exposure date must be a yyyy-MM-dd day: ${String(day)}`)
  }

  const [year, month, date] = day.split('-').map(Number)
  return new TZDate(year, month - 1, date, ADMIN_TZ)
}

function dayString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Resolve the report's legacy inclusive IST calendar windows. */
export function getExposureDateRange(
  preset: ExposureDatePreset,
  todayDay: string = istToday(),
): ExposureDateRange {
  const today = istDateForDay(todayDay)

  if (preset === 'allTime') {
    return { dateFrom: '2000-01-01', dateTo: todayDay }
  }
  if (preset === 'today') {
    return { dateFrom: todayDay, dateTo: todayDay }
  }
  if (preset === 'yesterday') {
    const yesterday = dayString(subDays(today, 1))
    return { dateFrom: yesterday, dateTo: yesterday }
  }

  // Selecting Custom historically seeds today plus the prior 30 calendar days.
  return { dateFrom: dayString(subDays(today, 30)), dateTo: todayDay }
}

/** The Exposure operation receives the non-inclusive day difference as a string. */
export function exposureRangeDays(dateFrom: string, dateTo: string): string {
  return differenceInCalendarDays(
    istDateForDay(dateTo),
    istDateForDay(dateFrom),
  ).toString()
}

/**
 * Return only the tabs the legacy page showed. `all` remains visible for every persona; this is
 * presentation only and must not be mistaken for backend domain scoping.
 */
export function visibleExposureDomains(
  isAgent: boolean,
  allowedDomains?: readonly string[] | null,
): ExposureDomain[] {
  if (!isAgent) return ['all', 'sports', 'matka']

  const allowed = allowedDomains || DEFAULT_ALLOWED_DOMAINS
  const domains: ExposureDomain[] = ['all']
  if (allowed.includes('sports')) domains.push('sports')
  if (allowed.includes('matka')) domains.push('matka')
  return domains
}

export interface ExposureKpiSkips {
  sportsSkipped: boolean
  matkaSkipped: boolean
}

/**
 * Which of the two KPI totals the page does not ask for. A domain tab asks for its own total only, and an
 * agent never asks for a domain its allowed domains lack (SCO-07): the API refuses that total, so the All
 * tab showed "Some totals could not be loaded" on every visit, although the total was 0 anyway (the agent's
 * players cannot bet there). That domain's tab is already hidden (visibleExposureDomains).
 */
export function exposureKpiSkips(
  domain: ExposureDomain,
  isAgent: boolean,
  allowedDomains?: readonly string[] | null,
): ExposureKpiSkips {
  const allowed = allowedDomains || DEFAULT_ALLOWED_DOMAINS
  return {
    sportsSkipped: domain === 'matka' || (isAgent && !allowed.includes('sports')),
    matkaSkipped: domain === 'sports' || (isAgent && !allowed.includes('matka')),
  }
}

function legacyUnixSeconds(value: string): number {
  const milliseconds = new Date(value).getTime()
  return Number.isNaN(milliseconds) ? Number.NaN : Math.floor(milliseconds / 1_000)
}

/** Match the legacy dayjs search key in the browser's local timezone. */
export function formatExposureSearchDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'yyyy-MM-dd')
}

/** The rows of a domain tab, in the server's order: the old domain rule without the search. */
export function exposureDomainRows(rows: readonly ExposureDataPoint[], domain: ExposureDomain): ExposureDataPoint[] {
  if (domain === 'all') return [...rows]
  return rows.filter((row) => {
    const rowDomain = row.dimension?.toLowerCase()
    if (domain === 'sports') return rowDomain === 'sports' || rowDomain === 'all'
    return rowDomain === 'matka' || rowDomain === 'all'
  })
}

/**
 * Apply the old domain/search rules and restore the page's default newest-first order. The search
 * guard trims only to decide whether a query exists; matching deliberately uses the raw query.
 */
export function filterExposureRows(
  rows: readonly ExposureDataPoint[],
  { domain, search, formatDate, formatAmount, convertAmount }: ExposureFilterOptions,
): ExposureDataPoint[] {
  let filtered: readonly ExposureDataPoint[] = exposureDomainRows(rows, domain)

  if (search.trim()) {
    const query = search.toLowerCase()
    filtered = filtered.filter((row) => (
      row.dimension?.toLowerCase().includes(query)
      || formatDate(row.date).toLowerCase().includes(query)
      || formatAmount(convertAmount(row.value)).toLowerCase().includes(query)
    ))
  }

  return [...filtered].sort(
    (left, right) => legacyUnixSeconds(right.date) - legacyUnixSeconds(left.date),
  )
}

/** Slice after filtering, exactly as the legacy controlled table did. */
export function paginateExposureRows(
  rows: readonly ExposureDataPoint[],
  currentPage: number,
  pageSize: number,
): ExposureDataPoint[] {
  const start = (currentPage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/** Sort only the rows already selected for the current page. A cleared sort keeps their order. */
export function sortExposurePage(
  currentPageRows: readonly ExposureDataPoint[],
  sort: ExposureSort | null,
): readonly ExposureDataPoint[] {
  if (!sort) return currentPageRows

  const direction = sort.dir === 'asc' ? 1 : -1
  return [...currentPageRows].sort((left, right) => {
    const comparison = sort.key === 'date'
      ? legacyUnixSeconds(left.date) - legacyUnixSeconds(right.date)
      : left.value - right.value
    return direction * comparison
  })
}

/** Cycle none -> ascending -> descending -> none, resetting to ascending for a new key. */
export function nextExposureSort(
  current: ExposureSort | null,
  key: ExposureSortKey,
): ExposureSort | null {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return null
}

/**
 * Calculate the cards from the domain tab's raw rows (exposureDomainRows: not searched, not converted).
 * They read every row the server returned, so under the Sports tab the Records, Avg and Peak cards
 * still counted the matka rows (F-REP-17).
 */
export function calculateExposureMetrics(
  fullRows: readonly ExposureDataPoint[],
): ExposureMetrics {
  if (fullRows.length === 0) {
    return {
      avgExposure: 0,
      maxExposure: 0,
      minExposure: 0,
      exposureChange: 0,
    }
  }

  const values = fullRows.map((row) => row.value)
  const total = values.reduce((sum, value) => sum + value, 0)
  const first = values[0]
  const last = values[values.length - 1]

  return {
    avgExposure: total / values.length,
    maxExposure: Math.max(...values),
    minExposure: Math.min(...values),
    exposureChange: values.length < 2 || first === 0
      ? 0
      : ((last - first) / first) * 100,
  }
}

/** Match the signed, two-decimal percentage shown beneath Total Exposure. */
export function formatExposureChange(change: number): string {
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
}

/** Preserve the current KPI composition, including conversion before summing the All total. */
export function calculateTotalExposure(
  domain: ExposureDomain,
  sportsRaw: number | null | undefined,
  matkaRaw: number | null | undefined,
  convertAmount: (amount: number) => number,
): number {
  if (domain === 'sports') return convertAmount(sportsRaw || 0)
  if (domain === 'matka') return convertAmount(matkaRaw || 0)
  return convertAmount(sportsRaw || 0) + convertAmount(matkaRaw || 0)
}
