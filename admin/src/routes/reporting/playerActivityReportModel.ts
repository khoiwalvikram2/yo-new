import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays } from 'date-fns'
import { ADMIN_TZ, isDayString } from '@/ui/components/istDate'
import type { StatusPillTone } from '@/ui/components/StatusPill'
import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'

/* The logic of /reporting/players/activity, out of the page and free of React (page migration C, W3
 * Task 123). Every rule here is the legacy page's own: the per-player merge of the three domain
 * breakdowns, the deposit/withdrawal join, the local search, the KPI totals, the slice-then-sort
 * paging and the agent's domain rules. Only the day count moved from dayjs to date-fns (D6); a
 * throwaway proof ran both over the same day pairs in eight zones (DST changes included) with equal
 * results, and playerActivityReportModel.test.ts pins those values. */

export type PlayerActivityDomain = 'all' | 'sports' | 'casino' | 'matka'

/** One player's row in a domain breakdown (sportsPlayerBreakdown and its two siblings). */
export interface PlayerBreakdownRow {
  playerId?: number | string | null
  playerUsername?: string | null
  playerPhone?: string | null
  directAgentId?: string | null
  directAgentName?: string | null
  totalStakes?: number | string | null
  totalPayouts?: number | string | null
  grossGamingRevenue?: number | string | null
  betCount?: number | string | null
  avgStake?: number | string | null
  winRate?: number | string | null
}

/** A usersByIds row. `createdAt` is read as before, although the query does not select it. */
export interface PlayerActivityUser {
  id: number | string
  name?: string | null
  username?: string | null
  email?: string | null
  phone?: string | null
  status?: string | null
  createdAt?: string | null
}

/** A playerActivityDepositWithdrawalStats row. */
export interface PlayerDepositWithdrawalStats {
  playerId?: number | string | null
  totalDepositAmount?: number | null
  totalDepositCount?: number | null
  totalWithdrawalAmount?: number | null
  totalWithdrawalCount?: number | null
  rangeDepositAmount?: number | null
  rangeDepositCount?: number | null
  rangeWithdrawalAmount?: number | null
  rangeWithdrawalCount?: number | null
}

export interface PlayerActivityData {
  playerId: number
  playerUsername: string
  name?: string | null
  email?: string | null
  phone?: string | null
  status?: string | null
  createdAt?: string | null
  directAgentId?: string | null
  directAgentName?: string | null
  totalBets: number
  totalStakes: number
  totalPayouts: number
  grossGamingRevenue: number
  avgStake: number
  winRate: number
  activeDays: number
  bettingFrequency: number
  lastBetInPeriod?: boolean
}

/** Table row: the deposit/withdrawal figures are always present (0 when the stats have no row). */
export type PlayerActivityRow = PlayerActivityData & {
  totalDepositAmount: number
  totalDepositCount: number
  rangeDepositAmount: number
  rangeDepositCount: number
  totalWithdrawalAmount: number
  totalWithdrawalCount: number
  rangeWithdrawalAmount: number
  rangeWithdrawalCount: number
}

/** One domain's KPI totals (sportsKPIs, casinoKPIs, matkaKPIs). */
export interface PlayerActivityKpis {
  totalStakes?: number | string | null
  totalPayouts?: number | string | null
  grossGamingRevenue?: number | string | null
  betCount?: number | string | null
}

export interface PlayerActivityTotals {
  totalBets: number
  totalStakes: number
  totalPlayers: number
  avgBetsPerPlayer: number
}

export interface PlayerActivitySkips {
  skipSports: boolean
  skipCasino: boolean
  skipMatka: boolean
}

export type PlayerActivitySortKey =
  | 'playerUsername'
  | 'email'
  | 'phone'
  | 'totalDeposit'
  | 'rangeDeposit'
  | 'totalWithdraw'
  | 'rangeWithdraw'
  | 'totalBets'
  | 'bettingFrequency'
  | 'totalStakes'
  | 'totalPayouts'
  | 'grossGamingRevenue'
  | 'avgStake'
  | 'winRate'
  | 'activeDays'

export interface PlayerActivitySort {
  key: PlayerActivitySortKey
  dir: 'asc' | 'desc'
}

export const PLAYER_ACTIVITY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const PLAYER_ACTIVITY_DEFAULT_PAGE_SIZE = 20

/** What an agent without an allowedDomains list may see, as the legacy page assumed. */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ['sports', 'casino', 'matka']

export const PLAYER_ACTIVITY_DOMAIN_LABELS: Record<PlayerActivityDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

export function resolveAllowedDomains(allowedDomains?: readonly string[] | null): readonly string[] {
  return allowedDomains || DEFAULT_ALLOWED_DOMAINS
}

/**
 * Which breakdown queries the page skips. A domain tab asks for its own domain only; on All Domains
 * an agent asks only for the domains it is allowed (presentation and request scoping as before; the
 * server still decides what an agent may read).
 */
export function playerActivitySkips(
  activeTab: PlayerActivityDomain,
  isAgent: boolean,
  allowedDomains: readonly string[],
): PlayerActivitySkips {
  return {
    skipSports: activeTab === 'casino' || activeTab === 'matka'
      || (isAgent && activeTab === 'all' && !allowedDomains.includes('sports')),
    skipCasino: activeTab === 'sports' || activeTab === 'matka'
      || (isAgent && activeTab === 'all' && !allowedDomains.includes('casino')),
    skipMatka: activeTab === 'sports' || activeTab === 'casino'
      || (isAgent && activeTab === 'all' && !allowedDomains.includes('matka')),
  }
}

/** The domain tabs: All Domains always, each domain for an admin or an agent allowed it. */
export function visiblePlayerActivityDomains(
  isAgent: boolean,
  allowedDomains: readonly string[],
): PlayerActivityDomain[] {
  const domains: PlayerActivityDomain[] = ['all']
  if (!isAgent || allowedDomains.includes('sports')) domains.push('sports')
  if (!isAgent || allowedDomains.includes('casino')) domains.push('casino')
  if (!isAgent || allowedDomains.includes('matka')) domains.push('matka')
  return domains
}

/** The distinct numeric player ids of the three breakdowns, in order of first appearance. */
export function collectBreakdownPlayerIds(
  sports: readonly PlayerBreakdownRow[],
  casino: readonly PlayerBreakdownRow[],
  matka: readonly PlayerBreakdownRow[],
): string[] {
  const ids = new Set<string>()
  for (const row of [...sports, ...casino, ...matka]) {
    const pid = Number(row?.playerId)
    if (Number.isFinite(pid)) ids.add(String(pid))
  }
  return Array.from(ids)
}

/**
 * The period's inclusive day count, as `dayjs(dateTo).diff(dayjs(dateFrom), 'day') + 1` gave it: the
 * calendar days between the two `yyyy-MM-dd` days, plus one. It does not depend on the browser's
 * zone. An unreadable day gives NaN, as dayjs did.
 */
export function playerActivityPeriodDays(dateFrom: string, dateTo: string): number {
  if (!isDayString(dateFrom) || !isDayString(dateTo)) return Number.NaN
  const day = (value: string) => {
    const [year, month, date] = value.split('-').map(Number)
    return new TZDate(year, month - 1, date, ADMIN_TZ)
  }
  return differenceInCalendarDays(day(dateTo), day(dateFrom)) + 1
}

/**
 * One row per player across the three breakdowns, with the users' details joined. The first row a
 * player appears in sets its identity and `lastBetInPeriod`; later rows add their bets, stakes,
 * payouts and GGR, fill a missing phone, and replace a missing or `Unknown` direct agent. Average
 * stake, win rate and betting frequency are then recomputed from the sums.
 */
export function mergePlayerActivity(
  sports: readonly PlayerBreakdownRow[],
  casino: readonly PlayerBreakdownRow[],
  matka: readonly PlayerBreakdownRow[],
  users: readonly PlayerActivityUser[],
  dateFrom: string,
  dateTo: string,
): PlayerActivityData[] {
  const userMap = new Map<number, PlayerActivityUser>()
  users.forEach((user) => userMap.set(Number(user.id), user))

  const playerMap = new Map<number, PlayerActivityData>()
  const daysDiff = playerActivityPeriodDays(dateFrom, dateTo)

  for (const row of [...sports, ...casino, ...matka]) {
    const pid = Number(row.playerId)
    const user = userMap.get(pid)
    const betCount = Number(row.betCount) || 0
    const totalStakes = Number(row.totalStakes) || 0
    const totalPayouts = Number(row.totalPayouts) || 0
    // The legacy `Number(...) ?? (stakes - payouts)` never reached its fallback: Number() is never
    // nullish. A missing GGR therefore counts as Number(null) = 0, or NaN when the field is absent.
    const ggr = Number(row.grossGamingRevenue)

    const existing = playerMap.get(pid)
    if (existing) {
      existing.totalBets += betCount
      existing.totalStakes += totalStakes
      existing.totalPayouts += totalPayouts
      existing.grossGamingRevenue += ggr
      if (
        row.directAgentName
        && row.directAgentName !== 'Unknown'
        && (!existing.directAgentName || existing.directAgentName === 'Unknown')
      ) {
        existing.directAgentName = row.directAgentName
        if (row.directAgentId) existing.directAgentId = row.directAgentId
      }
      if (!existing.directAgentId && row.directAgentId) {
        existing.directAgentId = row.directAgentId
        if (!existing.directAgentName && row.directAgentName) {
          existing.directAgentName = row.directAgentName
        }
      }
      if (!existing.phone && row.playerPhone) {
        existing.phone = row.playerPhone
      }
    } else {
      playerMap.set(pid, {
        playerId: pid,
        playerUsername: row.playerUsername || 'Unknown',
        name: user?.name,
        email: user?.email,
        phone: user?.phone || row.playerPhone || undefined,
        status: user?.status,
        createdAt: user?.createdAt,
        directAgentId: row.directAgentId,
        directAgentName: row.directAgentName,
        totalBets: betCount,
        totalStakes,
        totalPayouts,
        grossGamingRevenue: ggr,
        avgStake: Number(row.avgStake) || 0,
        winRate: Number(row.winRate) || 0,
        activeDays: daysDiff,
        bettingFrequency: daysDiff > 0 ? betCount / daysDiff : 0,
        lastBetInPeriod: betCount > 0,
      })
    }
  }

  playerMap.forEach((player) => {
    player.avgStake = player.totalBets > 0 ? player.totalStakes / player.totalBets : 0
    player.winRate = player.totalStakes > 0 ? player.totalPayouts / player.totalStakes : 0
    player.bettingFrequency = daysDiff > 0 ? player.totalBets / daysDiff : 0
  })

  return Array.from(playerMap.values())
}

/** Joins each player's deposit/withdrawal stats by id; a player without a stats row reads 0. */
export function withDepositWithdrawal(
  players: readonly PlayerActivityData[],
  stats: readonly (PlayerDepositWithdrawalStats | null | undefined)[],
): PlayerActivityRow[] {
  const statsMap = new Map<string, PlayerDepositWithdrawalStats>()
  for (const row of stats) {
    if (row?.playerId) statsMap.set(String(row.playerId), row)
  }
  return players.map((player) => {
    const row = statsMap.get(String(player.playerId))
    return {
      ...player,
      totalDepositAmount: row?.totalDepositAmount ?? 0,
      totalDepositCount: row?.totalDepositCount ?? 0,
      rangeDepositAmount: row?.rangeDepositAmount ?? 0,
      rangeDepositCount: row?.rangeDepositCount ?? 0,
      totalWithdrawalAmount: row?.totalWithdrawalAmount ?? 0,
      totalWithdrawalCount: row?.totalWithdrawalCount ?? 0,
      rangeWithdrawalAmount: row?.rangeWithdrawalAmount ?? 0,
      rangeWithdrawalCount: row?.rangeWithdrawalCount ?? 0,
    }
  })
}

export interface PlayerActivityQueryErrors {
  sports?: { message: string } | null
  casino?: { message: string } | null
  matka?: { message: string } | null
  users?: { message: string } | null
  depositWithdrawal?: { message: string } | null
}

/** The partial-failure lines, in the legacy order and wording. A skipped domain reports nothing. */
export function collectPlayerActivityErrors(
  errors: PlayerActivityQueryErrors,
  { skipSports, skipCasino, skipMatka }: PlayerActivitySkips,
): string[] {
  const lines: string[] = []
  if (errors.sports && !skipSports) lines.push(`Sports: ${errors.sports.message}`)
  if (errors.casino && !skipCasino) lines.push(`Casino: ${errors.casino.message}`)
  if (errors.matka && !skipMatka) lines.push(`Matka: ${errors.matka.message}`)
  if (errors.users) lines.push(`Users: ${errors.users.message}`)
  if (errors.depositWithdrawal) lines.push(`Deposit/Withdrawal: ${errors.depositWithdrawal.message}`)
  return lines
}

/**
 * The local search: any text matches username, name, email, phone or the player id. Only the
 * emptiness test trims; the match itself uses the query as typed, lower-cased.
 */
export function filterPlayerActivity(
  rows: readonly PlayerActivityRow[],
  searchQuery: string,
): PlayerActivityRow[] {
  if (!searchQuery.trim()) return [...rows]
  const query = searchQuery.toLowerCase()
  return rows.filter(
    (player) =>
      player.playerUsername?.toLowerCase().includes(query)
      || player.name?.toLowerCase().includes(query)
      || player.email?.toLowerCase().includes(query)
      || player.phone?.toLowerCase().includes(query)
      || String(player.playerId).includes(query),
  )
}

/**
 * The KPI row. Bets and stakes are the three domains' KPI totals (every domain, whatever the tab);
 * the player count is the rows left after the search.
 */
export function playerActivityTotals(
  kpis: {
    sports?: PlayerActivityKpis | null
    casino?: PlayerActivityKpis | null
    matka?: PlayerActivityKpis | null
  },
  filteredCount: number,
): PlayerActivityTotals {
  const { sports: s, casino: c, matka: m } = kpis
  const totalBets = (Number(s?.betCount) || 0) + (Number(c?.betCount) || 0) + (Number(m?.betCount) || 0)
  const totalStakes =
    (Number(s?.totalStakes) || 0) + (Number(c?.totalStakes) || 0) + (Number(m?.totalStakes) || 0)
  const totalPlayers = filteredCount
  const avgBetsPerPlayer = totalPlayers > 0 ? totalBets / totalPlayers : 0
  return { totalBets, totalStakes, totalPlayers, avgBetsPerPlayer }
}

/** The page's rows: the filtered list sliced by the controlled page. */
export function paginatePlayerActivity<T>(rows: readonly T[], currentPage: number, pageSize: number): T[] {
  const start = (currentPage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export const PLAYER_ACTIVITY_SORTERS: Record<
  PlayerActivitySortKey,
  (a: PlayerActivityRow, b: PlayerActivityRow) => number
> = {
  playerUsername: (a, b) => (a.playerUsername || '').localeCompare(b.playerUsername || ''),
  email: (a, b) => (a.email || '').localeCompare(b.email || ''),
  phone: (a, b) => (a.phone || '').localeCompare(b.phone || ''),
  totalDeposit: (a, b) => (a.totalDepositAmount ?? 0) - (b.totalDepositAmount ?? 0),
  rangeDeposit: (a, b) => (a.rangeDepositAmount ?? 0) - (b.rangeDepositAmount ?? 0),
  totalWithdraw: (a, b) => (a.totalWithdrawalAmount ?? 0) - (b.totalWithdrawalAmount ?? 0),
  rangeWithdraw: (a, b) => (a.rangeWithdrawalAmount ?? 0) - (b.rangeWithdrawalAmount ?? 0),
  totalBets: (a, b) => a.totalBets - b.totalBets,
  bettingFrequency: (a, b) => a.bettingFrequency - b.bettingFrequency,
  totalStakes: (a, b) => a.totalStakes - b.totalStakes,
  totalPayouts: (a, b) => a.totalPayouts - b.totalPayouts,
  grossGamingRevenue: (a, b) => (a.grossGamingRevenue ?? 0) - (b.grossGamingRevenue ?? 0),
  avgStake: (a, b) => a.avgStake - b.avgStake,
  winRate: (a, b) => a.winRate - b.winRate,
  activeDays: (a, b) => a.activeDays - b.activeDays,
}

export function isPlayerActivitySortKey(key: string): key is PlayerActivitySortKey {
  return Object.prototype.hasOwnProperty.call(PLAYER_ACTIVITY_SORTERS, key)
}

/**
 * Sorts only the rows already on the current page, as the antd table did with its page slice as the
 * data source. The sort is stable, and a cleared sort keeps the slice's order.
 */
export function sortPlayerActivityPage(
  pageRows: readonly PlayerActivityRow[],
  sort: PlayerActivitySort | null,
): PlayerActivityRow[] {
  if (!sort) return [...pageRows]
  const compare = PLAYER_ACTIVITY_SORTERS[sort.key]
  const direction = sort.dir === 'asc' ? 1 : -1
  return [...pageRows].sort((a, b) => direction * compare(a, b))
}

/** Applied filters for the count: a search (even blank spaces) and any period other than All time. */
export function playerActivityFilterCount(searchQuery: string, preset: ReportingDatePreset): number {
  return [searchQuery, preset !== 'allTime'].filter(Boolean).length
}

/** Active reads ok and inactive warn (the legacy green and orange tags); anything else is neutral. */
export function playerStatusTone(status: string): StatusPillTone {
  const value = String(status).toLowerCase()
  if (value === 'active') return 'ok'
  if (value === 'inactive') return 'warn'
  return 'neutral'
}

export function playerStatusLabel(status: string): string {
  return String(status).toUpperCase()
}

export function formatBettingFrequency(value: number): string {
  return `${Number(value).toFixed(2)} bets/day`
}

export function formatWinRate(value: number): string {
  return `${(Number(value) * 100).toFixed(1)}%`
}

export function playerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'player' : 'players'}`
}

/**
 * The table's empty text: the long hint once loading has finished with no player left after the
 * search, `No data` otherwise (a page past the end of a shrunken list).
 */
export function playerActivityEmptyText(filteredCount: number, isLoading: boolean): string {
  return filteredCount === 0 && !isLoading
    ? 'No players found for the selected period. Try adjusting the date range or search.'
    : 'No data'
}
