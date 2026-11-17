import type { ReportingDatePreset } from '@/modules/reporting/reportingDateFilter'

/* Player Profitability (/reporting/players/profitability): the page's logic without React (page
   migration C, W3 Task 124). Every rule here moved from the legacy PlayerProfitabilityPage.tsx, with its
   arithmetic, fallbacks and copy unchanged; playerProfitabilityModel.test.ts pins them. */

export type ProfitabilityDomain = 'all' | 'sports' | 'casino' | 'matka'

/** One table row, as the legacy page built it. `winRate` is the backend's ratio, 0–1. */
export interface PlayerBreakdownData {
  playerId: number
  playerUsername: string
  playerPhone?: string | null
  directAgentId?: string | null
  directAgentName?: string | null
  agentChain?: string[]
  totalStakes: number
  totalPayouts: number
  grossGamingRevenue: number
  betCount: number
  avgStake: number
  winRate: number
}

/** A row of the sports, casino or matka player breakdown, as the documents return it. */
export interface PlayerBreakdownSource {
  playerId: number | string
  playerUsername?: string | null
  playerPhone?: string | null
  directAgentId?: string | null
  directAgentName?: string | null
  agentChain?: string[] | null
  totalStakes?: number | string | null
  totalPayouts?: number | string | null
  grossGamingRevenue?: number | string | null
  betCount?: number | string | null
  avgStake?: number | string | null
  winRate?: number | string | null
}

/** The four figures each domain's KPI document returns. */
export interface ProfitabilityTotals {
  totalStakes: number
  totalPayouts: number
  totalGGR: number
  totalBets: number
}

export type ProfitabilitySortKey =
  | 'playerUsername'
  | 'totalStakes'
  | 'totalPayouts'
  | 'grossGamingRevenue'
  | 'betCount'
  | 'avgStake'
  | 'winRate'

export interface ProfitabilitySort {
  key: string
  dir: 'asc' | 'desc'
}

/** The legacy table's size changer, in its order. */
export const PROFITABILITY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export const PROFITABILITY_DOMAIN_LABELS: Record<ProfitabilityDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  casino: 'Casino',
  matka: 'Matka',
}

/** Every domain an admin sees, and an agent's fallback when it has no allowedDomains. */
export const PROFITABILITY_DEFAULT_DOMAINS = ['sports', 'casino', 'matka'] as const

const DOMAIN_ORDER = ['sports', 'casino', 'matka'] as const

/**
 * The tabs a caller sees: All Domains always; a domain tab for an admin, or for an agent whose
 * allowedDomains include it. The tabs decide which documents run, nothing more: the server still
 * scopes every figure (W1-S1).
 */
export function visibleProfitabilityDomains(
  isAgent: boolean,
  allowedDomains: readonly string[],
): ProfitabilityDomain[] {
  const domains: ProfitabilityDomain[] = ['all']
  for (const domain of DOMAIN_ORDER) {
    if (!isAgent || allowedDomains.includes(domain)) domains.push(domain)
  }
  return domains
}

/** One breakdown row as the table shows it when a single domain is selected. */
export function normalizeProfitabilityRow(row: PlayerBreakdownSource): PlayerBreakdownData {
  const pid = Number(row.playerId)
  const totalStakes = Number(row.totalStakes) || 0
  const totalPayouts = Number(row.totalPayouts) || 0
  /* The legacy line read `Number(row.grossGamingRevenue) ?? (totalStakes - totalPayouts)`. A number is
     never nullish, so its fallback never ran (a missing value stayed NaN); the dead branch is dropped
     and the result is the same. */
  const ggr = Number(row.grossGamingRevenue)
  const betCount = Number(row.betCount) || 0
  return {
    playerId: pid,
    playerUsername: row.playerUsername || 'Unknown',
    playerPhone: row.playerPhone ?? null,
    directAgentId: row.directAgentId,
    directAgentName: row.directAgentName,
    agentChain: row.agentChain ?? [],
    totalStakes,
    totalPayouts,
    grossGamingRevenue: ggr,
    betCount,
    avgStake: betCount > 0 ? totalStakes / betCount : Number(row.avgStake) || 0,
    winRate: totalStakes > 0 ? totalPayouts / totalStakes : Number(row.winRate) || 0,
  }
}

/**
 * The rows for the selected tab. A single domain shows its own rows; All Domains merges the three by
 * playerId, sums the figures, keeps the first real agent label, chain and phone it meets, and
 * recomputes the average stake and win rate from the sums.
 */
export function profitabilityPlayers(
  activeTab: string,
  sports: readonly PlayerBreakdownSource[],
  casino: readonly PlayerBreakdownSource[],
  matka: readonly PlayerBreakdownSource[],
): PlayerBreakdownData[] {
  if (activeTab === 'sports') return sports.map(normalizeProfitabilityRow)
  if (activeTab === 'casino') return casino.map(normalizeProfitabilityRow)
  if (activeTab === 'matka') return matka.map(normalizeProfitabilityRow)

  const playerMap = new Map<number, PlayerBreakdownData>()
  ;[...sports, ...casino, ...matka].forEach((row) => {
    const pid = Number(row.playerId)
    const totalStakes = Number(row.totalStakes) || 0
    const totalPayouts = Number(row.totalPayouts) || 0
    const ggr = Number(row.grossGamingRevenue)
    const betCount = Number(row.betCount) || 0

    const existing = playerMap.get(pid)
    if (existing) {
      existing.totalStakes += totalStakes
      existing.totalPayouts += totalPayouts
      existing.grossGamingRevenue += ggr
      existing.betCount += betCount
      // Prefer a real agent label from any domain (casino/matka rows omitted agent in GQL before; sports can return Unknown if name lookup failed)
      if (
        row.directAgentName &&
        row.directAgentName !== 'Unknown' &&
        (!existing.directAgentName || existing.directAgentName === 'Unknown')
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
      if ((!existing.agentChain || existing.agentChain.length === 0) && row.agentChain && row.agentChain.length > 0) {
        existing.agentChain = row.agentChain
      }
      if (!existing.playerPhone && row.playerPhone) {
        existing.playerPhone = row.playerPhone
      }
    } else {
      playerMap.set(pid, {
        playerId: pid,
        playerUsername: row.playerUsername || 'Unknown',
        playerPhone: row.playerPhone ?? null,
        directAgentId: row.directAgentId,
        directAgentName: row.directAgentName,
        agentChain: row.agentChain ?? [],
        totalStakes,
        totalPayouts,
        grossGamingRevenue: ggr,
        betCount,
        avgStake: betCount > 0 ? totalStakes / betCount : 0,
        winRate: totalStakes > 0 ? totalPayouts / totalStakes : 0,
      })
    }
  })

  // Recompute derived fields for merged rows
  playerMap.forEach((p) => {
    p.avgStake = p.betCount > 0 ? p.totalStakes / p.betCount : 0
    p.winRate = p.totalStakes > 0 ? p.totalPayouts / p.totalStakes : 0
  })

  return Array.from(playerMap.values())
}

/** The search box: username, phone or id, case-insensitive; the typed text is not trimmed. */
export function filterProfitabilityPlayers(
  players: PlayerBreakdownData[],
  searchQuery: string,
): PlayerBreakdownData[] {
  if (!searchQuery.trim()) return players
  const query = searchQuery.toLowerCase()
  return players.filter(
    (p) =>
      p.playerUsername?.toLowerCase().includes(query) ||
      p.playerPhone?.toLowerCase().includes(query) ||
      String(p.playerId).includes(query),
  )
}

/** One page of the filtered players (the table pages on the client). */
export function profitabilityPage<T>(rows: readonly T[], currentPage: number, pageSize: number): T[] {
  const start = (currentPage - 1) * pageSize
  const end = start + pageSize
  return rows.slice(start, end)
}

const COMPARATORS: Record<ProfitabilitySortKey, (a: PlayerBreakdownData, b: PlayerBreakdownData) => number> = {
  playerUsername: (a, b) => (a.playerUsername || '').localeCompare(b.playerUsername || ''),
  totalStakes: (a, b) => a.totalStakes - b.totalStakes,
  totalPayouts: (a, b) => a.totalPayouts - b.totalPayouts,
  grossGamingRevenue: (a, b) => (a.grossGamingRevenue ?? 0) - (b.grossGamingRevenue ?? 0),
  betCount: (a, b) => a.betCount - b.betCount,
  avgStake: (a, b) => a.avgStake - b.avgStake,
  winRate: (a, b) => a.winRate - b.winRate,
}

function isSortKey(key: string): key is ProfitabilitySortKey {
  return Object.prototype.hasOwnProperty.call(COMPARATORS, key)
}

/**
 * The legacy table sorted the rows it was given, and it was given the current page: a sort orders
 * the page on screen, never the whole list, and it does not move the page. Ties keep their order.
 */
export function sortProfitabilityPage(
  rows: readonly PlayerBreakdownData[],
  sort: ProfitabilitySort | null,
): PlayerBreakdownData[] {
  if (!sort || !isSortKey(sort.key)) return [...rows]
  const compare = COMPARATORS[sort.key]
  return [...rows].sort((a, b) => {
    const result = compare(a, b)
    if (result === 0) return 0
    return sort.dir === 'asc' ? result : -result
  })
}

/**
 * The KPI row's figures: the listed players' rows (the tab's, then the search) added up. They were the
 * three domains' KPI documents added up whatever the tab, so the Sports tab showed the all-domain GGR
 * next to its sports players' count (F-REP-16).
 */
export function profitabilityTotals(
  rows: readonly Pick<PlayerBreakdownData, 'totalStakes' | 'totalPayouts' | 'grossGamingRevenue' | 'betCount'>[],
): ProfitabilityTotals {
  const sum = (pick: (row: (typeof rows)[number]) => unknown) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0)
  return {
    totalStakes: sum((row) => row.totalStakes),
    totalPayouts: sum((row) => row.totalPayouts),
    totalGGR: sum((row) => row.grossGamingRevenue),
    totalBets: sum((row) => row.betCount),
  }
}

/** Total Payouts' note: the payout share of stakes, or a dash with no stakes. */
export function payoutShareNote(totals: ProfitabilityTotals): string {
  return totals.totalStakes > 0
    ? `Payout: ${((totals.totalPayouts / totals.totalStakes) * 100).toFixed(1)}%`
    : '—'
}

/** The win rate as the table prints it, `52.4%`. */
export function winRateLabel(winRate: number): string {
  return `${(Number(winRate) * 100).toFixed(1)}%`
}

/**
 * The legacy tag colours on semantic tones: above 50% red, above 30% orange, else green. A high win
 * rate is a player taking money from the house, so the reading is kept.
 */
export function winRateTone(winRate: number): 'neg' | 'warn' | 'ok' {
  const pct = Number(winRate) * 100
  return pct > 50 ? 'neg' : pct > 30 ? 'warn' : 'ok'
}

/** GGR is green at zero or above and red below, as before. */
export function ggrTone(ggr: number): 'pos' | 'neg' {
  return (ggr ?? 0) >= 0 ? 'pos' : 'neg'
}

/** The agent chain joined with `>`, the direct agent when there is no chain, or a dash. */
export function agentChainLabel(row: Pick<PlayerBreakdownData, 'agentChain' | 'directAgentName'>): string {
  const chain = row.agentChain && row.agentChain.length > 0
    ? row.agentChain
    : (row.directAgentName ? [row.directAgentName] : null)
  if (!chain) return '—'
  return chain.join(' > ')
}

/** `1 player`, `12 players`. */
export function playerCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'player' : 'players'}`
}

/**
 * The FilterBar's count, and so its Clear all: a typed search (spaces included, as before) and a period
 * other than All time. The domain tab is not a filter.
 */
export function profitabilityActiveFilterCount(searchQuery: string, preset: ReportingDatePreset): number {
  return [searchQuery, preset !== 'allTime'].filter(Boolean).length
}

/** The parts of an Apollo error the page reads. */
export interface ProfitabilityQueryError {
  networkError?: unknown
  graphQLErrors?: ReadonlyArray<{ message: string }>
}

/* The message test the Apollo error link uses to keep a permission refusal out of its toasts
   (shared/core/api.ts, isPermissionError); the P&L report (Task 122) reads refusals the same way. */
const PERMISSION_REFUSAL = /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i

/**
 * True when the server refused the document for want of a permission and nothing failed on the wire.
 * The page guard is `reporting.players-profitability:view`, but each breakdown and KPI resolver checks
 * its own `reporting.<domain>:view` and overviewKPIs checks `overview.dashboard:view`, so a role holding
 * only the page permission is refused on every load, whatever the period.
 */
export function isProfitabilityPermissionRefusal(error: ProfitabilityQueryError | null | undefined): boolean {
  if (!error || error.networkError) return false
  const errors = error.graphQLErrors ?? []
  return errors.length > 0 && errors.every((entry) => PERMISSION_REFUSAL.test(entry.message))
}

/**
 * Whether the page reports this error. A refusal is not reported: Retry or Refresh can never clear it,
 * and the legacy page showed the rows and totals that did arrive without a word, which the page keeps.
 * Any other failure is reported.
 */
export function isReportableProfitabilityError(error: ProfitabilityQueryError | null | undefined): boolean {
  return !!error && !isProfitabilityPermissionRefusal(error)
}
