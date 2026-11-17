/* Pure logic of /matka/worli/:id (one Worli session), lifted out of the legacy page, its status chip and its
   operator controls so it can be tested without React. Every rule is the legacy one: the id check and the
   redirects, the stat figures and their antd-Statistic formatting, the exposure bands, the book filters and
   sorts, the top risks, the bets search, the countdown and the suspend-minutes parse. */
import type { StatusPillTone } from '@/ui/components/StatusPill'

export interface WorliCounters {
  betCount?: number | null
  totalStakeMinor?: number | null
  exposureTotalMinor?: number | null
  worstOutcomeKey?: string | null
  worstOutcomePlMinor?: number | null
}

export interface WorliSession {
  id: string
  marketId: string
  marketName?: string | null
  runDate?: string | null
  side: 'OPEN' | 'CLOSE'
  status: string
  scheduledOpenAt?: string | null
  scheduledLockAt?: string | null
  scheduledCloseAt?: string | null
  operatorMessage?: string | null
  /** Lock Now or Close Now stopped it and Unlock may reopen it (server rule: before the result and the scheduled close). */
  canUnlock?: boolean | null
  counters?: WorliCounters | null
  bidRulesVersionId?: string | null
}

export interface WorliInstanceData {
  worliInstance?: WorliSession | null
}

export interface WorliBet {
  id: string
  userId?: string | null
  bidType?: string | null
  betNumbers?: string | null
  betAmount?: number | string | null
  payoutMultiplier?: number | string | null
  potentialWin?: number | string | null
  status?: string | null
  currency?: string | null
  createdAt?: string | null
}

export interface WorliLiveBet extends WorliBet {
  matkaId?: string | null
  marketName?: string | null
  marketSession?: string | null
}

export interface WorliBetCreatedData {
  worliBetCreated?: WorliLiveBet | null
}

export interface WorliBetsData {
  worliBets?: { total?: number | null; items?: WorliBet[] | null } | null
}

export interface WorliBookItem {
  selection: string
  betCount: number
  plMinor: number
}

export interface WorliBookGroup {
  bidType: string
  items: WorliBookItem[]
}

export interface WorliBook {
  totalStakeMinor: number
  groups: WorliBookGroup[]
}

export interface WorliBookData {
  worliBook?: WorliBook | null
}

export interface WorliActivityEntry {
  id: string
  action: string
  reason?: string | null
  actorId?: string | null
  createdAt?: string | null
}

export interface WorliActivityData {
  worliActivity?: WorliActivityEntry[] | null
}

export const LIST_PATH = '/matka/worli'
/** The route's breadcrumb label (shared/core/routeConfig.ts), the heading while there is no session to name. */
export const DETAIL_TITLE = 'Market Details'
export const LIVE_BETS_LIMIT = 10

/* ---------- the route id and what the page shows ---------- */

/** A session id is a UUID (8-4-4-4-12). "running" came from an old navigation and is sent back to the list. */
export function isValidInstanceId(str: string | undefined): boolean {
  if (!str || str === 'running') return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

export type InstanceView = 'loading' | 'error' | 'not-found' | 'ready'

/** admin-backend's answer for an id with no session in this whitelabel (matka-worli authorizedWorliInstance): an
 *  error, not a null, so the page read it as a failed load. */
export const SESSION_NOT_FOUND = 'Market session not found'

export function isSessionNotFound(message: string | null | undefined): boolean {
  return (message ?? '').trim() === SESSION_NOT_FOUND
}

/** What the page shows. The legacy page showed "Loading market details..." in every state but ready; the
 *  failed and not-found states now say so while the legacy two-second redirect to the list runs (an invalid
 *  id is sent back at once and keeps the loading state meanwhile). The server's not-found error is a not-found,
 *  like a null answer; any other error is a failed load. */
export function instanceView({
  isValidId,
  loading,
  hasError,
  hasData,
  hasInstance,
  errorMessage,
}: {
  isValidId: boolean
  loading: boolean
  hasError: boolean
  hasData: boolean
  hasInstance: boolean
  /** The failed lookup's message. */
  errorMessage?: string | null
}): InstanceView {
  if (hasInstance) return 'ready'
  if (!isValidId) return 'loading'
  if (hasError) return isSessionNotFound(errorMessage) ? 'not-found' : 'error'
  if (!loading && hasData) return 'not-found'
  return 'loading'
}

export function loadErrorText(message: string | undefined): string {
  return `Failed to load market details: ${message || 'Unknown error'}`
}

/** The fingerprint the header shows: the first eight characters of the route id. */
export function shortId(id: string | null | undefined): string {
  return `${(id ?? '').slice(0, 8)}...`
}

/* ---------- figures ---------- */

export type ExposureLevel = 'critical' | 'warning' | 'healthy'

export interface SessionFigures {
  betCount: number
  /** Major units, as the stake, exposure and worst P/L below. */
  totalStake: number
  exposure: number
  worstOutcome: string
  worstPL: number
  level: ExposureLevel
  /** The bar's fill: exposure against a 1,50,000 scale, capped at 100. */
  exposurePercent: number
  averageStake: number
}

export function sessionFigures(inst: Pick<WorliSession, 'counters'>): SessionFigures {
  const betCount = inst.counters?.betCount ?? 0
  const totalStake = (inst.counters?.totalStakeMinor ?? 0) / 100
  const exposure = (inst.counters?.exposureTotalMinor ?? 0) / 100
  const worstOutcome = inst.counters?.worstOutcomeKey || '-'
  const worstPL = (inst.counters?.worstOutcomePlMinor ?? 0) / 100
  return {
    betCount,
    totalStake,
    exposure,
    worstOutcome,
    worstPL,
    level: exposureLevel(exposure),
    exposurePercent: Math.min(100, (exposure / 150000) * 100),
    averageStake: betCount > 0 ? totalStake / betCount : 0,
  }
}

export function exposureLevel(exposure: number): ExposureLevel {
  return exposure > 100000 ? 'critical' : exposure > 50000 ? 'warning' : 'healthy'
}

/** The legacy tag colours (red, orange, green) on the status tones; the bar has no ok tone, so healthy takes
 *  the accent. */
export function exposureLevelTone(level: ExposureLevel): { pill: StatusPillTone; meter: 'neg' | 'warn' | 'acc' } {
  if (level === 'critical') return { pill: 'neg', meter: 'neg' }
  if (level === 'warning') return { pill: 'warn', meter: 'warn' }
  return { pill: 'ok', meter: 'acc' }
}

/** antd's Statistic number, exactly: comma groups of three, the decimals cut (not rounded) or padded to the
 *  precision, and anything that is not a plain number printed as it is. */
export function formatStatisticValue(value: number | string | null | undefined, precision?: number): string {
  const val = String(value)
  const cells = val.match(/^(-?)(\d*)(\.(\d+))?$/)
  if (!cells || val === '-') return val
  const negative = cells[1]
  let int = cells[2] || '0'
  let decimal = cells[4] || ''
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (typeof precision === 'number') {
    decimal = decimal.padEnd(precision, '0').slice(0, precision > 0 ? precision : 0)
  }
  if (decimal) decimal = `.${decimal}`
  return `${negative}${int}${decimal}`
}

/** A P/L figure's sign as the legacy page wrote it: '-' below zero, '+' otherwise (zero included). */
export function plSign(value: number): '-' | '+' {
  return value < 0 ? '-' : '+'
}

/* ---------- status tones (the legacy tag colours) ---------- */

/** The header chip: OPEN green, LOCKED orange, PAUSED volcano, anything else default. */
export function sessionStatusTone(status: string | null | undefined): StatusPillTone {
  if (status === 'OPEN') return 'ok'
  if (status === 'LOCKED') return 'warn'
  if (status === 'PAUSED') return 'neg'
  return 'neutral'
}

/** The Market Summary status: OPEN green, LOCKED orange, anything else default (PAUSED included). */
export function summaryStatusTone(status: string | null | undefined): StatusPillTone {
  if (status === 'OPEN') return 'ok'
  if (status === 'LOCKED') return 'warn'
  return 'neutral'
}

/** A bet: ACTIVE green, VOID red, anything else default. The API sends the statuses lower-case (only CSS
 *  shows them upper-case), so either spelling is read. */
export function betStatusTone(status: string | null | undefined): StatusPillTone {
  const value = String(status ?? '').toUpperCase()
  if (value === 'ACTIVE') return 'ok'
  if (value === 'VOID') return 'neg'
  return 'neutral'
}

/** Only an open bet (pending or active) can be voided; a void, won or lost one is refused by the server. */
export function canVoidBet(status: string | null | undefined): boolean {
  return ['pending', 'active'].includes(String(status ?? '').toLowerCase())
}

/* ---------- what the session allows ---------- */

export interface BettingNote {
  label: string
  tone: StatusPillTone
  text: string
  /** The session is taking bets. */
  open: boolean
}

/** The Total Bets tile's note follows the session's status, not its bet count: a session past its lock with
 *  bets on it is not live. While it takes bets the note is the legacy Live (or Idle without bets). */
export function bettingNote(status: string | null | undefined, betCount: number): BettingNote {
  if (status === 'OPEN') return { label: betCount > 0 ? 'Live' : 'Idle', tone: betCount > 0 ? 'ok' : 'neutral', text: 'Active betting', open: true }
  if (status === 'PAUSED') return { label: 'Paused', tone: 'warn', text: 'Betting paused', open: false }
  if (status === 'SCHEDULED' || status === 'OPENING_SOON') return { label: 'Upcoming', tone: 'neutral', text: 'Betting not open yet', open: false }
  return { label: 'Closed', tone: 'neutral', text: 'Betting closed', open: false }
}

export type SessionControl = OperatorAction | 'MESSAGE' | 'SUSPEND_ADJUST'

const TAKING_OR_DUE = ['SCHEDULED', 'OPENING_SOON', 'OPEN']

/** Whether a control can still change the session: Pause only while it takes (or is about to take) bets,
 *  Resume only when paused, Lock Now until it is locked, Close Now until it is closed; nothing once a result
 *  is settled. An unknown status leaves every control on. */
export function sessionControlEnabled(status: string | null | undefined, control: SessionControl): boolean {
  if (!status) return true
  if (['SETTLING', 'SETTLED', 'VOIDED'].includes(status)) return false
  switch (control) {
    case 'PAUSE': return TAKING_OR_DUE.includes(status)
    case 'RESUME': return status === 'PAUSED'
    case 'LOCK': return [...TAKING_OR_DUE, 'PAUSED'].includes(status)
    case 'CLOSE': return [...TAKING_OR_DUE, 'PAUSED', 'LOCKED'].includes(status)
    default: return true
  }
}

/* ---------- the status chip's countdown ---------- */

/** OPEN counts down to the lock, LOCKED and OPENING_SOON to the close; other statuses show no countdown.
 *  The text is hours (unbounded), minutes and seconds, as dayjs.duration gave them; under ten minutes it is
 *  urgent. */
export function statusCountdown(
  status: string | null | undefined,
  lockAt: string | null | undefined,
  closeAt: string | null | undefined,
  now: number,
): { text: string; urgent: boolean } | null {
  let nextTs: number | undefined
  if (status === 'OPEN') nextTs = lockAt ? new Date(lockAt).getTime() : undefined
  else if (status === 'LOCKED' || status === 'OPENING_SOON') nextTs = closeAt ? new Date(closeAt).getTime() : undefined
  if (nextTs === undefined || !Number.isFinite(nextTs)) return null
  const remain = Math.max(0, nextTs - now)
  const h = String(Math.floor(remain / 3600000)).padStart(2, '0')
  const m = String(Math.floor(remain / 60000) % 60).padStart(2, '0')
  const s = String(Math.floor(remain / 1000) % 60).padStart(2, '0')
  return { text: `${h}:${m}:${s}`, urgent: remain > 0 && remain < 10 * 60 * 1000 }
}

/* ---------- live bets ---------- */

/** The newest bet first, ten at most. */
export function prependLiveBet(previous: readonly WorliLiveBet[], bet: WorliLiveBet): WorliLiveBet[] {
  return [bet, ...previous].slice(0, LIVE_BETS_LIMIT)
}

/* ---------- the book ---------- */

export type BookSort = 'pl:asc' | 'pl:desc' | 'bets:desc' | 'default'

export const BOOK_SORT_OPTIONS: ReadonlyArray<{ value: BookSort; label: string }> = [
  { value: 'default', label: 'Series Order' },
  { value: 'bets:desc', label: 'Most Bets' },
  { value: 'pl:desc', label: 'PL High → Low' },
  { value: 'pl:asc', label: 'PL Low → High' },
]

export function isBookSort(value: string): value is BookSort {
  return BOOK_SORT_OPTIONS.some((option) => option.value === value)
}

export function bookBidTypes(book: WorliBook | null | undefined): string[] {
  if (!book?.groups) return []
  return book.groups.map((g) => g.bidType)
}

/** The book view's filters: one bid type or all, a selection search (trimmed, substring), then a sort. */
export function filterBookGroups(
  book: WorliBook | null | undefined,
  { query, sort, selectedType }: { query: string; sort: BookSort; selectedType: string },
): WorliBookGroup[] {
  if (!book?.groups) return []
  const groups = selectedType === 'all' ? book.groups : book.groups.filter((g) => g.bidType === selectedType)
  return groups.map((g) => {
    let items = [...g.items]
    if (query.trim()) {
      items = items.filter((i) => String(i.selection).includes(query.trim()))
    }
    if (sort === 'pl:desc') items.sort((a, b) => b.plMinor - a.plMinor)
    if (sort === 'pl:asc') items.sort((a, b) => a.plMinor - b.plMinor)
    if (sort === 'bets:desc') items.sort((a, b) => b.betCount - a.betCount)
    return { ...g, items }
  })
}

/** The five selections that lose the most, worst first. */
export function topRiskSelections(book: WorliBook | null | undefined): Array<WorliBookItem & { bidType: string }> {
  if (!book?.groups) return []
  const allItems: Array<WorliBookItem & { bidType: string }> = []
  book.groups.forEach((g) => {
    g.items.forEach((i) => {
      allItems.push({ ...i, bidType: g.bidType })
    })
  })
  return allItems
    .filter((i) => i.plMinor < 0)
    .sort((a, b) => a.plMinor - b.plMinor)
    .slice(0, 5)
}

/** antd's small Badge: 0 shown, above 99 written 99+. */
export function badgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/* ---------- bets ---------- */

export const BET_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'All Types' },
  { value: 'SINGLE', label: 'Single' },
  { value: 'JODI', label: 'Jodi' },
  { value: 'SP', label: 'Single Patti' },
  { value: 'DP', label: 'Double Patti' },
  { value: 'TP', label: 'Triple Patti' },
  { value: 'HS', label: 'Half Sangam' },
  { value: 'FS', label: 'Full Sangam' },
]

export const BET_PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_BET_PAGE_SIZE = 20

/** The bets search: case-insensitive substring of the user id, the selection or the bid type. A blank
 *  search keeps every bet; the query itself is not trimmed. */
export function filterBets(items: readonly WorliBet[], searchQuery: string): WorliBet[] {
  if (!searchQuery.trim()) return [...items]
  const q = searchQuery.toLowerCase()
  return items.filter((item) =>
    item.userId?.toLowerCase().includes(q) ||
    item.betNumbers?.toLowerCase().includes(q) ||
    item.bidType?.toLowerCase().includes(q),
  )
}

/** The Bets tab's Export CSV: one row per bet, amounts as the API sends them (whitelabel currency), every
 *  cell quoted. The server pages bets 100 at a time, so the page collects them first. */
export const BET_EXPORT_PAGE_SIZE = 100

export function worliBetsCsv(bets: readonly WorliBet[]): string {
  const header = ['Bet ID', 'User ID', 'Bid Type', 'Selection', 'Stake', 'Rate', 'Potential Win', 'Status', 'Currency', 'Placed At']
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = bets.map((bet) => [bet.id, bet.userId, bet.bidType, bet.betNumbers, bet.betAmount, bet.payoutMultiplier, bet.potentialWin, bet.status, bet.currency, bet.createdAt])
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n')
}

export function worliBetsCsvName(instanceId: string): string {
  return `worli-bets-${instanceId.slice(0, 8)}.csv`
}

export function formatRate(rate: number | string | null | undefined): string {
  return `${Number(rate).toFixed(2)}x`
}

/** The first eight characters and an ellipsis; a missing id leaves only the ellipsis, as the legacy cell did. */
export function shortUserId(userId: string | null | undefined): string {
  return `${userId?.slice(0, 8) ?? ''}...`
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function pageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/* ---------- activity ---------- */

export type ActivityHue = 'amb' | 'grn' | 'red' | 'vio' | 'blu' | 'ind' | 'none'

/** The legacy per-action colours: orange, green, red, purple, blue, cyan; the tag takes the nearest status
 *  tone and the icon tile the decorative ramp step. Unknown actions are neutral. */
export function activityStyle(action: string): { tone: StatusPillTone; hue: ActivityHue } {
  switch (action) {
    case 'PAUSE':
      return { tone: 'warn', hue: 'amb' }
    case 'RESUME':
      return { tone: 'ok', hue: 'grn' }
    case 'LOCK':
      return { tone: 'neg', hue: 'red' }
    case 'CLOSE':
      return { tone: 'neutral', hue: 'vio' }
    case 'MESSAGE':
      return { tone: 'info', hue: 'blu' }
    case 'SUSPEND_ADJUST':
      return { tone: 'info', hue: 'ind' }
    default:
      return { tone: 'neutral', hue: 'none' }
  }
}

/* ---------- operator controls ---------- */

export type OperatorAction = 'PAUSE' | 'RESUME' | 'LOCK' | 'CLOSE' | 'UNLOCK'

/** The confirmation title: "Confirm PAUSE" and so on ("Confirm " while it closes). */
export function operatorActionTitle(action: OperatorAction | null): string {
  return `Confirm ${action ?? ''}`
}

/** The suspend minutes as typed: parseInt, and 0 for anything that is not a number. */
export function parseSuspendMinutes(input: string): number {
  const m = parseInt(input || '0', 10)
  return Number.isFinite(m) ? m : 0
}

/** antd's required rule on the reason: empty fails; spaces pass. */
export function reasonError(reason: string): string | undefined {
  return reason === '' ? 'Please input a reason' : undefined
}

export function actionErrorText(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message
  return 'The action could not be completed. Please try again.'
}
