/* Pure logic of /matka/worli (Worli Running Markets), lifted out of the legacy page and its table and card
   components so it can be tested without React. Every rule below is the legacy one, word for word: the
   quick filters, the stats, the filter count, the OPEN/CLOSE grouping, the exposure health bands, the volume
   label and the session tones. */
import type { StatusPillTone } from '@/ui/components/StatusPill'
import type { WorliStatus } from '@/state/matkaWorli'

export interface WorliCounters {
  betCount?: number | string | null
  totalStakeMinor?: number | string | null
  exposureTotalMinor?: number | string | null
  worstOutcomeKey?: string | null
  worstOutcomePlMinor?: number | string | null
}

/** One session (OPEN or CLOSE) of a Worli market on a day, as `worliRunningInstances` returns it. */
export interface WorliInstance {
  id: string
  marketId: string
  marketName?: string | null
  runDate?: string | null
  side?: string | null
  status?: string | null
  scheduledOpenAt?: string | null
  scheduledLockAt?: string | null
  scheduledCloseAt?: string | null
  operatorMessage?: string | null
  counters?: WorliCounters | null
  bidRulesVersionId?: string | null
}

export interface WorliInstancesData {
  worliRunningInstances?: { total?: number | null; items?: WorliInstance[] | null } | null
}

export interface WorliInstanceUpdatedData {
  worliInstanceUpdated?: Partial<WorliInstance> & { id: string }
}

export const PAGE_TITLE = 'Worli Running Markets'
// The legacy subtitle, curly apostrophe included.
export const PAGE_SUB = 'Monitor and manage today’s Worli sessions (Open/Close)'

/* ---------- quick filters (client side, over the rows the server returned) ---------- */

export type QuickFilter = 'live' | 'high-exposure' | 'locking-soon' | 'paused'

export const QUICK_FILTERS: ReadonlyArray<{ value: QuickFilter; label: string }> = [
  { value: 'live', label: 'Live' },
  { value: 'high-exposure', label: 'High Exposure' },
  { value: 'locking-soon', label: 'Locking Soon' },
  { value: 'paused', label: 'Paused' },
]

/** Locking Soon: the lock is in the future and less than ten minutes away. */
export const LOCKING_SOON_MS = 10 * 60 * 1000
/** High Exposure: a session's exposure (major units) at or above this. The legacy comment called it arbitrary. */
export const HIGH_EXPOSURE_THRESHOLD = 10000

export function matchesQuickFilter(row: WorliInstance, quickFilter: QuickFilter | null, now: number): boolean {
  if (!quickFilter) return true
  switch (quickFilter) {
    case 'live':
      return row.status === 'OPEN'
    case 'locking-soon': {
      if (!row.scheduledLockAt) return false
      const ms = new Date(row.scheduledLockAt).getTime() - now
      return ms > 0 && ms < LOCKING_SOON_MS
    }
    case 'high-exposure': {
      const exp = Number(row?.counters?.exposureTotalMinor ?? 0) / 100
      return exp >= HIGH_EXPOSURE_THRESHOLD
    }
    case 'paused':
      return row.status === 'PAUSED'
    default:
      return true
  }
}

export function applyQuickFilter(
  rows: readonly WorliInstance[],
  quickFilter: QuickFilter | null,
  now: number,
): WorliInstance[] {
  return rows.filter((row) => matchesQuickFilter(row, quickFilter, now))
}

/** A quick filter is a toggle: picking the active one turns it off, as the legacy tags did. */
export function toggleQuickFilter(current: QuickFilter | null, picked: QuickFilter): QuickFilter | null {
  return current === picked ? null : picked
}

export function isQuickFilter(value: string): value is QuickFilter {
  return QUICK_FILTERS.some((filter) => filter.value === value)
}

/* ---------- stats (over the quick-filtered sessions) ---------- */

export interface MarketStats {
  openInstances: number
  /** Minor units; the page divides by 100 before formatting. */
  totalExposure: number
  totalBets: number
  totalInstances: number
}

export function marketStats(rows: readonly WorliInstance[]): MarketStats {
  const openInstances = rows.filter((r) => r.status === 'OPEN').length
  const totalExposure = rows.reduce((sum, r) => sum + Number(r?.counters?.exposureTotalMinor ?? 0), 0)
  const totalBets = rows.reduce((sum, r) => sum + Number(r?.counters?.betCount ?? 0), 0)
  const totalInstances = rows.length
  return { openInstances, totalExposure, totalBets, totalInstances }
}

/* ---------- filters ---------- */

export interface CountedFilters {
  search?: string
  status?: readonly WorliStatus[] | null
  hasResult?: boolean
  quickFilter: QuickFilter | null
}

/** The legacy badge: search, a status choice, Has result switched on, and a quick filter. Date and sort never
 *  count, and Has result switched back off (false) does not count either. */
export function activeFilterCount({ search, status, hasResult, quickFilter }: CountedFilters): number {
  return [search, status && status.length ? status : null, hasResult, quickFilter].filter(Boolean).length
}

export const WORLI_STATUSES: readonly WorliStatus[] = [
  'SCHEDULED',
  'OPENING_SOON',
  'OPEN',
  'LOCKED',
  'CLOSED',
  'SETTLING',
  'SETTLED',
  'PAUSED',
  'VOIDED',
]

export const WORLI_STATUS_OPTIONS = WORLI_STATUSES.map((s) => ({ value: s, label: s }))

export function isWorliStatus(value: string): value is WorliStatus {
  return (WORLI_STATUSES as readonly string[]).includes(value)
}

export const WORLI_SORT_OPTIONS = [
  { value: 'closeAt:asc', label: 'Close ↑' },
  { value: 'closeAt:desc', label: 'Close ↓' },
  { value: 'name:asc', label: 'Name A→Z' },
  { value: 'name:desc', label: 'Name Z→A' },
  { value: 'bets:desc', label: 'Bets ↓' },
  { value: 'exposure:desc', label: 'Exposure ↓' },
] as const

/* ---------- the table: one row per market and day, its OPEN and CLOSE sessions side by side ---------- */

export interface MarketRow {
  key: string
  marketId: string
  marketName?: string | null
  runDate?: string | null
  open: WorliInstance | null
  close: WorliInstance | null
}

export function groupMarketRows(items: readonly WorliInstance[]): MarketRow[] {
  const map: Record<string, MarketRow> = {}
  for (const it of items) {
    const key = `${it.marketId}::${it.runDate}`
    if (!map[key]) {
      map[key] = {
        key,
        marketId: it.marketId,
        marketName: it.marketName,
        runDate: it.runDate,
        open: null,
        close: null,
      }
    }
    if (String(it.side).toUpperCase() === 'OPEN') {
      map[key].open = it
    } else if (String(it.side).toUpperCase() === 'CLOSE') {
      map[key].close = it
    }
  }
  return Object.values(map)
}

export interface MarketRowFigures {
  openBets: number
  closeBets: number
  /** Major units, as are the stakes and exposures below. */
  openStake: number
  closeStake: number
  openExposure: number
  closeExposure: number
  totalStake: number
  totalExposure: number
  totalBets: number
  openStatus: string
  closeStatus: string
  isLive: boolean
  isPaused: boolean
  /** The session the row opens: OPEN when there is one, else CLOSE. */
  viewId: string | undefined
}

export function marketRowFigures(row: MarketRow): MarketRowFigures {
  const openBets = Number(row.open?.counters?.betCount ?? 0)
  const closeBets = Number(row.close?.counters?.betCount ?? 0)
  const openStake = Number(row.open?.counters?.totalStakeMinor ?? 0) / 100
  const closeStake = Number(row.close?.counters?.totalStakeMinor ?? 0) / 100
  const openExposure = Number(row.open?.counters?.exposureTotalMinor ?? 0) / 100
  const closeExposure = Number(row.close?.counters?.exposureTotalMinor ?? 0) / 100
  const openStatus = row.open?.status || 'N/A'
  const closeStatus = row.close?.status || 'N/A'
  return {
    openBets,
    closeBets,
    openStake,
    closeStake,
    openExposure,
    closeExposure,
    totalStake: openStake + closeStake,
    totalExposure: openExposure + closeExposure,
    totalBets: openBets + closeBets,
    openStatus,
    closeStatus,
    isLive: openStatus === 'OPEN' || closeStatus === 'OPEN',
    isPaused: openStatus === 'PAUSED' || closeStatus === 'PAUSED',
    viewId: row.open?.id || row.close?.id,
  }
}

export interface ExposureHealth {
  text: 'High Risk' | 'Medium' | 'Low'
  /** The legacy bar's fixed fill for the band. */
  percent: 100 | 60 | 30
  /** Meter tone. The kit Meter has no ok tone, so Low (legacy green) takes the accent. */
  tone: 'neg' | 'warn' | 'acc'
}

export function exposureHealth(exposure: number): ExposureHealth {
  if (exposure > 100000) return { text: 'High Risk', percent: 100, tone: 'neg' }
  if (exposure > 50000) return { text: 'Medium', percent: 60, tone: 'warn' }
  return { text: 'Low', percent: 30, tone: 'acc' }
}

export function volumeLabel(totalStake: number): 'High volume' | 'Normal volume' {
  return totalStake > 50000 ? 'High volume' : 'Normal volume'
}

/** The legacy tag colours on the approved status tones: OPEN success, LOCKED warning, PAUSED volcano
 *  (the negative pair), anything else (N/A included) default. */
export function sessionTone(status: string | null | undefined): StatusPillTone {
  if (status === 'OPEN') return 'ok'
  if (status === 'LOCKED') return 'warn'
  if (status === 'PAUSED') return 'neg'
  return 'neutral'
}

/* ---------- paging (client side, over the grouped rows) ---------- */

export const MARKET_PAGE_SIZES = [10, 25, 50, 100] as const
export const DEFAULT_MARKET_PAGE_SIZE = 25

export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function pageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/* ---------- the card view (one card per session, not grouped) ---------- */

export interface SessionCardFigures {
  name: string
  bets: number
  /** Major units. */
  exposure: number
}

export function sessionCardFigures(row: WorliInstance): SessionCardFigures {
  return {
    name: row.marketName || row.marketId,
    bets: Number(row?.counters?.betCount ?? 0),
    exposure: Number(row?.counters?.exposureTotalMinor ?? 0) / 100,
  }
}

export function loadErrorText(message: string | undefined): string {
  return `Failed to load Worli markets: ${message || 'Unknown error'}`
}
