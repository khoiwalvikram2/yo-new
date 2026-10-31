import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, format } from 'date-fns'
import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'
import type { TableExportColumn } from '@/shared/utils/tableExport'
import { ADMIN_TZ, isDayString } from '@/ui/components/istDate'

/* The logic of /reporting/pnl without React (page migration C, W3 Task 122). Every rule here is the
   legacy PNLPage.tsx rule moved as it was; the dayjs calls it made are ported to date-fns with the
   same results (pnlPageModel.test.ts pins them), because dayjs leaves with antd (D6). */

export interface PnlDataPoint {
  date: string
  value: number
  dimension: string
}

export type PnlDomain = 'all' | 'sports' | 'casino' | 'matka'

export type PnlSortKey = 'date' | 'value'

export interface PnlSort {
  key: PnlSortKey
  dir: 'asc' | 'desc'
}

export interface PnlFilterOptions {
  domain: PnlDomain
  search: string
  formatAmount: (amount: number) => string
  convertAmount: (amount: number) => number
}

export interface PnlMetrics {
  avgPnl: number
  maxPnl: number
  pnlChange: number
  positiveDays: number
  negativeDays: number
  winRate: number
}

export interface PnlCopy {
  title: string
  sub: string
  totalLabel: string
  avgLabel: string
  rateLabel: string
  bestLabel: string
  tableTitle: string
  valueHeader: string
  exportFilename: string
  sheetName: string
  exportTitleLead: string
  searchLabel: string
  emptyTitle: string
  statsLabel: string
}

export const PNL_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const PNL_DEFAULT_PAGE_SIZE = 20

export const PNL_DOMAIN_LABELS: Record<PnlDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

const DEFAULT_ALLOWED_DOMAINS = ['sports', 'casino', 'matka'] as const
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

const COMMISSION_COPY: PnlCopy = {
  title: 'Commission Earned Report',
  sub: 'Track your commission earnings from player turnover',
  totalLabel: 'Total Commission',
  avgLabel: 'Avg Commission',
  rateLabel: 'Earning Rate',
  bestLabel: 'Best Earning',
  tableTitle: 'Commission Earned Data',
  valueHeader: 'Commission',
  exportFilename: 'Commission-Earned-Report',
  sheetName: 'Commission',
  exportTitleLead: 'Commission Earned',
  searchLabel: 'Search commission',
  emptyTitle: 'No commission data',
  statsLabel: 'Commission statistics',
}

const PNL_COPY: PnlCopy = {
  title: 'Profit & Loss Report',
  sub: 'Analyze profit and loss performance across all domains',
  totalLabel: 'Total P&L',
  avgLabel: 'Average P&L',
  rateLabel: 'Win Rate',
  bestLabel: 'Profitable Days',
  tableTitle: 'Profit & Loss Data',
  valueHeader: 'P&L',
  exportFilename: 'PNL-Report',
  sheetName: 'P&L',
  exportTitleLead: 'P&L',
  searchLabel: 'Search P&L',
  emptyTitle: 'No P&L data',
  statsLabel: 'P&L statistics',
}

/** A COMMISSION-scheme agent reads the page as commission earned; everyone else as P&L. */
export function isCommissionAgent(isAgent: boolean, schemeType: string | null | undefined): boolean {
  return isAgent && schemeType === 'COMMISSION'
}

/** Every visible string that depends on the persona, word for word from the legacy page. */
export function pnlCopy(commissionAgent: boolean): PnlCopy {
  return commissionAgent ? COMMISSION_COPY : PNL_COPY
}

/**
 * The domain tabs the legacy page showed: All always, and each domain an admin sees or an agent's
 * `allowedDomains` lists (all three when the agent has none). Presentation only: the queries are
 * scoped by the server, not by this list.
 */
export function visiblePnlDomains(
  isAgent: boolean,
  allowedDomains?: readonly string[] | null,
): PnlDomain[] {
  const allowed = allowedDomains || DEFAULT_ALLOWED_DOMAINS
  const domains: PnlDomain[] = ['all']
  if (!isAgent || allowed.includes('sports')) domains.push('sports')
  if (!isAgent || allowed.includes('casino')) domains.push('casino')
  if (!isAgent || allowed.includes('matka')) domains.push('matka')
  return domains
}

function istDay(day: string): TZDate {
  const [year, month, date] = day.split('-').map(Number)
  return new TZDate(year, month - 1, date, ADMIN_TZ)
}

/**
 * The PNL operation's `range`: the whole days from `dateFrom` to `dateTo` as a string, which the
 * legacy page computed as `dayjs(dateTo).diff(dayjs(dateFrom), 'days')`. For two calendar days that is
 * their calendar distance in any zone (dayjs corrects the difference for DST), so it is counted on IST
 * days here. The period controls only ever produce real `yyyy-MM-dd` days; anything else gives the
 * string `NaN`, as an unparseable day did under dayjs.
 */
export function pnlRangeDays(dateFrom: string, dateTo: string): string {
  if (!isDayString(dateFrom) || !isDayString(dateTo)) return String(Number.NaN)
  return differenceInCalendarDays(istDay(dateTo), istDay(dateFrom)).toString()
}

/**
 * How dayjs read a row's `date`: an instant string as itself, a bare `yyyy-MM-dd` as local
 * midnight (where `new Date` would take UTC midnight), and null or an empty string as invalid.
 */
function legacyDate(value: string | null | undefined): Date {
  if (value === null || value === undefined || value === '') return new Date(Number.NaN)
  if (DAY_ONLY.test(value)) {
    const [year, month, date] = value.split('-').map(Number)
    return new Date(year, month - 1, date)
  }
  return new Date(value)
}

/** `dayjs(date).unix()`: whole seconds, NaN for an invalid date. */
export function legacyUnixSeconds(value: string | null | undefined): number {
  const milliseconds = legacyDate(value).getTime()
  return Number.isNaN(milliseconds) ? Number.NaN : Math.floor(milliseconds / 1000)
}

/** `dayjs(date).format('YYYY-MM-DD')`: the browser-local calendar day the search matches. */
export function formatPnlSearchDate(value: string | null | undefined): string {
  const date = legacyDate(value)
  return Number.isNaN(date.getTime()) ? 'Invalid Date' : format(date, 'yyyy-MM-dd')
}

/**
 * The legacy domain and search rules, then newest first. A domain keeps its own rows and the
 * server's `All` rows. The search runs only when it has more than spaces, and then matches the raw
 * lower-cased text against the domain, the local day and the converted, formatted amount.
 */
export function filterPnlRows(
  rows: readonly PnlDataPoint[],
  { domain, search, formatAmount, convertAmount }: PnlFilterOptions,
): PnlDataPoint[] {
  let filtered: readonly PnlDataPoint[] = rows

  if (domain !== 'all') {
    filtered = filtered.filter((row) => {
      const rowDomain = row.dimension?.toLowerCase()
      if (domain === 'sports') return rowDomain === 'sports' || rowDomain === 'all'
      if (domain === 'casino') return rowDomain === 'casino' || rowDomain === 'all'
      if (domain === 'matka') return rowDomain === 'matka' || rowDomain === 'all'
      return true
    })
  }

  if (search.trim()) {
    const query = search.toLowerCase()
    filtered = filtered.filter((row) => (
      row.dimension?.toLowerCase().includes(query)
      || formatPnlSearchDate(row.date).includes(query)
      || formatAmount(convertAmount(row.value)).toLowerCase().includes(query)
    ))
  }

  return [...filtered].sort(
    (left, right) => legacyUnixSeconds(right.date) - legacyUnixSeconds(left.date),
  )
}

/** The page's slice, taken after filtering, as the legacy controlled table did. */
export function paginatePnlRows(
  rows: readonly PnlDataPoint[],
  currentPage: number,
  pageSize: number,
): PnlDataPoint[] {
  const start = (currentPage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/**
 * A column sort orders only the rows of the current page (antd sorted the slice it was given) and a
 * cleared sort keeps the newest-first order. Equal keys keep their order.
 */
export function sortPnlPage<T extends PnlDataPoint>(
  pageRows: readonly T[],
  sort: PnlSort | null,
): readonly T[] {
  if (!sort) return pageRows
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...pageRows].sort((left, right) => {
    const comparison = sort.key === 'date'
      ? legacyUnixSeconds(left.date) - legacyUnixSeconds(right.date)
      : left.value - right.value
    return direction * comparison
  })
}

/** The cards' figures, from every row the PNL operation returned (not the filtered rows). */
export function calculatePnlMetrics(rows: readonly PnlDataPoint[]): PnlMetrics {
  const count = rows.length
  const positiveDays = rows.filter((row) => row.value > 0).length
  const negativeDays = rows.filter((row) => row.value < 0).length

  let pnlChange = 0
  if (count >= 2) {
    const first = rows[0].value
    const last = rows[count - 1].value
    pnlChange = first === 0 ? (last > 0 ? 100 : -100) : ((last - first) / Math.abs(first)) * 100
  }

  return {
    avgPnl: count === 0 ? 0 : rows.reduce((sum, row) => sum + row.value, 0) / count,
    maxPnl: count === 0 ? 0 : Math.max(...rows.map((row) => row.value)),
    pnlChange,
    positiveDays,
    negativeDays,
    winRate: count === 0 ? 0 : (positiveDays / count) * 100,
  }
}

/**
 * The Total card: one domain's net revenue, or the three summed after conversion for All. It does not
 * follow an agent's allowed domains, as before.
 */
export function calculateTotalPnl(
  domain: PnlDomain,
  sportsRaw: number | null | undefined,
  matkaRaw: number | null | undefined,
  casinoRaw: number | null | undefined,
  convertAmount: (amount: number) => number,
): number {
  if (domain === 'sports') return convertAmount(sportsRaw || 0)
  if (domain === 'matka') return convertAmount(matkaRaw || 0)
  if (domain === 'casino') return convertAmount(casinoRaw || 0)
  const sports = convertAmount(sportsRaw || 0)
  const matka = convertAmount(matkaRaw || 0)
  const casino = convertAmount(casinoRaw || 0)
  return sports + matka + casino
}

export type PnlKpiDomain = Exclude<PnlDomain, 'all'>

/** The parts of an Apollo error the totals notices read. */
export interface PnlQueryError {
  networkError?: unknown
  graphQLErrors?: ReadonlyArray<{ message: string }>
}

/** Which totals the Total card is missing, and why. */
export interface PnlTotalsIssues {
  /** The caller may not view these reports: the server refused the query. */
  refused: PnlKpiDomain[]
  /** These failed for any other reason (network, server error). */
  failed: PnlKpiDomain[]
}

const KPI_DOMAINS: readonly PnlKpiDomain[] = ['sports', 'casino', 'matka']

/* The message test the Apollo error link uses to keep a permission refusal out of its toasts
   (shared/core/api.ts, isPermissionError). */
const PERMISSION_REFUSAL = /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i

/**
 * True when the server refused the query for want of a permission and nothing failed on the wire.
 * sportsKPIs, casinoKPIs and matkaKPIs each check their own `reporting.<domain>:view`, which
 * `reporting.pnl:view` does not imply, so a role holding only the page permission gets this on every
 * load, whatever the period.
 */
export function isPnlPermissionRefusal(error: PnlQueryError | null | undefined): boolean {
  if (!error || error.networkError) return false
  const errors = error.graphQLErrors ?? []
  return errors.length > 0 && errors.every((entry) => PERMISSION_REFUSAL.test(entry.message))
}

/**
 * Sorts the failed totals into refusals and other failures. Only the totals that feed the Total card
 * count: all three under All Domains, the selected domain's otherwise.
 */
export function pnlTotalsIssues(
  domain: PnlDomain,
  errors: Readonly<Record<PnlKpiDomain, PnlQueryError | null | undefined>>,
): PnlTotalsIssues {
  const feeding = domain === 'all' ? KPI_DOMAINS : [domain]
  const issues: PnlTotalsIssues = { refused: [], failed: [] }
  for (const kpi of feeding) {
    const error = errors[kpi]
    if (!error) continue
    if (isPnlPermissionRefusal(error)) issues.refused.push(kpi)
    else issues.failed.push(kpi)
  }
  return issues
}

/** `Sports`, `Sports and Casino`, `Sports, Casino and Matka`. */
function domainList(domains: readonly PnlKpiDomain[]): string {
  const labels = domains.map((domain) => PNL_DOMAIN_LABELS[domain])
  if (labels.length < 2) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** The refusal notice's sentence: which reports the caller cannot view and that the total leaves them out. */
export function pnlRefusedTotalsText(copy: PnlCopy, refused: readonly PnlKpiDomain[]): string {
  const one = refused.length === 1
  return `You do not have access to the ${domainList(refused)} ${one ? 'report' : 'reports'}, `
    + `so ${copy.totalLabel} does not include ${one ? 'it' : 'them'}.`
}

/** `+12.50%` / `-3.00%` under the Total card. */
export function formatPnlChange(change: number): string {
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
}

/** A row's amount with the legacy leading plus on zero and gains. */
export function formatSignedPnl(value: number, formatted: string): string {
  return `${value >= 0 ? '+' : ''}${formatted}`
}

/** Earned / Zero for a commission agent, Profit / Loss for everyone else. */
export function pnlStatusLabel(value: number, commissionAgent: boolean): string {
  if (value >= 0) return commissionAgent ? 'Earned' : 'Profit'
  return commissionAgent ? 'Zero' : 'Loss'
}

/** The legacy tag colours: blue for the server's `All` rows, green for a domain. */
export function pnlDomainTone(dimension: string): 'info' | 'ok' {
  return dimension === 'All' ? 'info' : 'ok'
}

/** Search, a domain other than All, and a period other than All time each count once. */
export function pnlActiveFilterCount(
  search: string,
  domain: PnlDomain,
  preset: ReportingDatePreset,
): number {
  return [search, domain !== 'all', preset !== 'allTime'].filter(Boolean).length
}

/** `P&L — 12 record(s)` (`Commission Earned — …` for a commission agent), the export's title line. */
export function pnlExportTitle(copy: PnlCopy, count: number): string {
  return `${copy.exportTitleLead} — ${count} record(s)`
}

/** The Excel columns, as the legacy export wrote them (the amount raw, not converted). */
export function pnlExportColumns(
  commissionAgent: boolean,
  formatDateTime: (value: string, pattern?: string) => string,
): TableExportColumn<PnlDataPoint>[] {
  return [
    {
      header: 'Date',
      key: 'date',
      width: 18,
      getter: (row) => (row.date ? formatDateTime(row.date, 'yyyy-MM-dd HH:mm') : '—'),
    },
    { header: 'Domain', key: 'dimension', width: 12, getter: (row) => row.dimension ?? '' },
    {
      header: commissionAgent ? 'Commission' : 'P&L',
      key: 'value',
      width: 14,
      getter: (row) => row.value,
    },
    {
      header: 'Status',
      key: 'status',
      width: 10,
      getter: (row) => pnlStatusLabel(row.value, commissionAgent),
    },
  ]
}
