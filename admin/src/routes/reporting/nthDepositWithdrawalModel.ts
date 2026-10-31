import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'

/* Nth D/W (/reporting/players/nth-dw): the page's logic without React (page migration C, W3 Task 125).
   Every rule here moved from the legacy NthDepositWithdrawalReportPage.tsx with its fallbacks and copy
   unchanged; nthDepositWithdrawalModel.test.ts pins them. */

/** One player of the usersPage document. */
export interface NthDwUser {
  id: string
  name?: string | null
  phone?: string | null
  username?: string | null
  parentAgent?: { id?: string | null; username?: string | null } | null
}

/** One player's figures from the deposit/withdrawal stats document. */
export interface NthDwStats {
  playerId: string | number
  totalDepositAmount?: number | null
  totalDepositCount?: number | null
  totalWithdrawalAmount?: number | null
  totalWithdrawalCount?: number | null
  rangeDepositAmount?: number | null
  rangeDepositCount?: number | null
  rangeWithdrawalAmount?: number | null
  rangeWithdrawalCount?: number | null
}

export interface NthDwRow {
  id: string
  name: string
  phone: string | null
  username: string
  agentName: string
  totalDepositAmount: number
  rangeDepositAmount: number
  totalWithdrawalAmount: number
  rangeWithdrawalAmount: number
}

export interface NthDwKpis {
  totalDeposits?: number | string | null
  totalWithdrawals?: number | string | null
}

export interface NthDwTotals {
  totalDeposit: number
  rangeDeposit: number
  totalWithdraw: number
  rangeWithdraw: number
  netFlow: number
  rangeNetFlow: number
}

export type NthDwSortKey =
  | 'player'
  | 'agentName'
  | 'totalDepositAmount'
  | 'rangeDepositAmount'
  | 'totalWithdrawalAmount'
  | 'rangeWithdrawalAmount'

export interface NthDwSort {
  key: string
  dir: 'asc' | 'desc'
}

/** The legacy TablePagination's default sizes; the page starts at 20, which the pager lists first. */
export const NTH_DW_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

/** The ids the stats document is asked about: the players on the current page. */
export function nthDwPlayerIds(items: readonly Pick<NthDwUser, 'id'>[]): string[] {
  return items.map((u) => String(u.id)).filter(Boolean)
}

/** The stats rows keyed by player id; a row without a player id is dropped. */
export function nthDwStatsMap(rows: readonly (NthDwStats | null | undefined)[]): Map<string, NthDwStats> {
  const map = new Map<string, NthDwStats>()
  for (const row of rows) {
    if (row?.playerId) map.set(String(row.playerId), row)
  }
  return map
}

/** The table rows: each player with its figures, zero when the stats document has none. */
export function buildNthDwRows(items: readonly NthDwUser[], statsMap: Map<string, NthDwStats>): NthDwRow[] {
  return items.map((u) => {
    const stats = statsMap.get(String(u.id))
    return {
      id: u.id,
      name: u.name || '—',
      phone: u.phone || null,
      username: u.username || '',
      agentName: u.parentAgent?.username || '—',
      totalDepositAmount: stats?.totalDepositAmount ?? 0,
      rangeDepositAmount: stats?.rangeDepositAmount ?? 0,
      totalWithdrawalAmount: stats?.totalWithdrawalAmount ?? 0,
      rangeWithdrawalAmount: stats?.rangeWithdrawalAmount ?? 0,
    }
  })
}

/**
 * The KPI row's figures from the overview KPI document. The range figures equal the totals, as they
 * always did (the document is already asked for the selected period).
 */
export function nthDwTotals(kpi?: NthDwKpis | null): NthDwTotals {
  const totalDeposit = Number(kpi?.totalDeposits) || 0
  const totalWithdraw = Number(kpi?.totalWithdrawals) || 0
  const rangeDeposit = totalDeposit
  const rangeWithdraw = totalWithdraw
  return {
    totalDeposit,
    rangeDeposit,
    totalWithdraw,
    rangeWithdraw,
    netFlow: totalDeposit - totalWithdraw,
    rangeNetFlow: rangeDeposit - rangeWithdraw,
  }
}

/** The player cell's link text: name, then username, then `User <id>`. */
export function nthDwPlayerLabel(row: Pick<NthDwRow, 'id' | 'name' | 'username'>): string {
  return row.name || row.username || `User ${row.id}`
}

const COMPARATORS: Record<NthDwSortKey, (a: NthDwRow, b: NthDwRow) => number> = {
  player: (a, b) => (a.name || a.username || '').localeCompare(b.name || b.username || ''),
  agentName: (a, b) => (a.agentName || '').localeCompare(b.agentName || ''),
  totalDepositAmount: (a, b) => a.totalDepositAmount - b.totalDepositAmount,
  rangeDepositAmount: (a, b) => a.rangeDepositAmount - b.rangeDepositAmount,
  totalWithdrawalAmount: (a, b) => a.totalWithdrawalAmount - b.totalWithdrawalAmount,
  rangeWithdrawalAmount: (a, b) => a.rangeWithdrawalAmount - b.rangeWithdrawalAmount,
}

function isSortKey(key: string): key is NthDwSortKey {
  return Object.prototype.hasOwnProperty.call(COMPARATORS, key)
}

/**
 * The server pages the players; the legacy table then sorted the page it was given. A sort orders the
 * rows on screen only, and it does not change the page or the request. Ties keep their order.
 */
export function sortNthDwPage(rows: readonly NthDwRow[], sort: NthDwSort | null): NthDwRow[] {
  if (!sort || !isSortKey(sort.key)) return [...rows]
  const compare = COMPARATORS[sort.key]
  return [...rows].sort((a, b) => {
    const result = compare(a, b)
    if (result === 0) return 0
    return sort.dir === 'asc' ? result : -result
  })
}

/** The table card's subtitle. */
export function nthDwSummary(total: number): string {
  return `${total.toLocaleString()} ${total === 1 ? 'player' : 'players'} • All amounts in whitelabel currency`
}

/** The FilterBar's count, and so its Clear all: a search (spaces ignored) and a period other than All time. */
export function nthDwActiveFilterCount(searchQuery: string | null | undefined, preset: ReportingDatePreset): number {
  return [searchQuery?.trim(), preset !== 'allTime'].filter(Boolean).length
}

/** The parts of an Apollo error the page reads. */
export interface NthDwQueryError {
  networkError?: unknown
  graphQLErrors?: ReadonlyArray<{ message: string }>
}

/* The message test the Apollo error link uses to keep a permission refusal out of its toasts
   (shared/core/api.ts, isPermissionError); the P&L report (Task 122) reads refusals the same way. */
const PERMISSION_REFUSAL = /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i

/**
 * True when the server refused the document for want of a permission and nothing failed on the wire.
 * The page guard is `reporting.players-activity:view`, but usersPage and the stats check
 * `players.list:view` and overviewKPIs checks `overview.dashboard:view`, so a role holding only the
 * page permission is refused on every load, whatever the search or period.
 */
export function isNthDwPermissionRefusal(error: NthDwQueryError | null | undefined): boolean {
  if (!error || error.networkError) return false
  const errors = error.graphQLErrors ?? []
  return errors.length > 0 && errors.every((entry) => PERMISSION_REFUSAL.test(entry.message))
}

/**
 * The error the page reports, or undefined. A refusal is not reported: Retry or Refresh can never clear
 * it, and the legacy page showed what did arrive (or its empty copy) without a word, which the page keeps.
 */
export function reportableNthDwError<E extends NthDwQueryError>(error: E | null | undefined): E | undefined {
  return error && !isNthDwPermissionRefusal(error) ? error : undefined
}
