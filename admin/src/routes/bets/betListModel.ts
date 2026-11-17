/* The Bet List's page logic, free of React: the filter payload, paging clamp, date presets, filter
 * options and counts, and every rule a table cell or export uses to turn a bet into text. Each function
 * keeps the legacy page's behaviour (BetListPage / BetListFiltersBar / BetListTable before Task 140). */
import type { BetDomain, BetsPageFilters as BetsPageQueryFilters } from '@/lib/graphql/bets'
import type { ListboxOption } from '@/ui/components/Combobox'
import { istDayOf } from '@/ui/components/istDate'
import type { SelectOption } from '@/ui/components/Select'
import type { StatusPillTone } from '@/ui/components/StatusPill'

/** The page's filters: the query's own plus `userId`, the one player picked from the Player list. */
export type BetsPageFilters = BetsPageQueryFilters & { userId?: string }

export type { BetDomain }

/** Backend caps `betsPage` limit at 500 — use for paged export fetches. */
export const BETS_EXPORT_BATCH = 500

export const BET_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export interface BetCampaign {
  id: string
  name: string
  type?: string | null
  distributionType?: string | null
  wageringReq?: number | null
  validTo?: string | null
  validFrom?: string | null
  domain?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
  amount?: number | null
  percentage?: number | null
  amountType?: string | null
}

interface BetBase {
  id: string
  userId?: string | null
  userName?: string | null
  userPhone?: string | null
  /** The domain status, copied from sportsStatus / casinoStatus / matkaStatus by normalizeBetPageItems. */
  status: string
  currency: string
  createdAt: string
  walletType?: string | null
  campaign?: BetCampaign | null
  /** Sports: the aliased sportsMarketName; Matka: its own market; Casino: null. */
  marketName?: string | null
}

export interface SportsBetItem extends BetBase {
  __typename: 'SportsBet'
  sportName?: string | null
  leagueName?: string | null
  eventName?: string | null
  selectionName?: string | null
  side?: string | null
  stake: number
  price?: number | null
  oddsSize?: number | null
  liability?: number | null
  pl?: number | null
  result?: string | null
  eventResult?: string | null
  ipAddress?: string | null
  deviceInfo?: string | null
  location?: string | null
  country?: string | null
}

export interface CasinoBetItem extends BetBase {
  __typename: 'CasinoBet'
  gameName?: string | null
  vendorName?: string | null
  tableId?: string | null
  stake: number
  payout?: number | null
  winAmount?: number | null
  netAmount?: number | null
  sessionId?: string | null
  gameRoundId?: string | null
  transactionId?: string | null
  settledAt?: string | null
  providerCode?: string | null
}

export interface MatkaBetItem extends BetBase {
  __typename: 'MatkaBet'
  matkaType?: string | null
  marketSession?: string | null
  bidType?: string | null
  betNumbers?: string | null
  betAmount: number
  payoutMultiplier?: number | null
  potentialWin?: number | null
  actualWin?: number | null
  result?: string | null
}

export type BetItem = SportsBetItem | CasinoBetItem | MatkaBetItem

/** One `betsPage.items` entry as the query returns it (aliased status and market fields). */
export type RawBetItem = { readonly [field: string]: unknown }

/** The status and market aliases collapse into `status` and `marketName`, exactly as before. */
export function normalizeBetPageItems(rawItems: readonly RawBetItem[]): BetItem[] {
  return rawItems.map((item) => ({
    ...item,
    status: item.sportsStatus ?? item.casinoStatus ?? item.matkaStatus ?? item.status ?? '',
    marketName: item.sportsMarketName ?? item.marketName ?? null,
  })) as unknown as BetItem[]
}

/** The `filters` variable of betsPage and betsPageTotals: empty values are left out, key order kept. */
export function buildBetsFiltersPayload(filters: BetsPageFilters): BetsPageFilters {
  return {
    status: filters.status?.length ? filters.status : undefined,
    dateFrom: filters.dateFrom ?? undefined,
    dateTo: filters.dateTo ?? undefined,
    agentUsername: filters.agentUsername ?? undefined,
    playerSearch: filters.playerSearch ?? undefined,
    search: filters.search ?? undefined,
    walletType: filters.walletType ?? undefined,
    userId: filters.userId ?? undefined,
  }
}

export function betsPageNumber(offset: number, limit: number): number {
  return limit > 0 ? Math.floor(offset / limit) + 1 : 1
}

/**
 * When the total shrinks (refresh, filter change) or the page size changes, the offset is pulled back to
 * the last page that exists. Returns the new offset, or null when the current one stands.
 */
export function clampBetsOffset(offset: number, total: number, limit: number): number | null {
  if (limit <= 0) return null
  if (total === 0) return offset !== 0 ? 0 : null
  const lastPageIndex = Math.max(0, Math.ceil(total / limit) - 1)
  const maxOffset = lastPageIndex * limit
  return offset > maxOffset ? maxOffset : null
}

/** The export pages through the full result until the server total is reached or a short batch ends it. */
export function isLastBetExportBatch(collected: number, reportedTotal: number, batchLength: number): boolean {
  return collected >= reportedTotal || batchLength === 0 || batchLength < BETS_EXPORT_BATCH
}

export function betExportCompleteMessage(count: number): string {
  return `Exported ${count.toLocaleString()} bet(s) matching the current filters.`
}

export function betCountLabel(total: number): string {
  return `${total.toLocaleString()} ${total === 1 ? 'bet' : 'bets'}`
}

/* ---------- date presets ---------- */

export type BetDatePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'custom'

/**
 * The date field's state: a preset, or 'any' when a link opened the list with no date bound. 'any' is not
 * offered in the panel; picking a preset or Reset leaves it.
 */
export type BetDateSelection = BetDatePreset | 'any'

export const ANY_DATE_LABEL = 'Any date'

export const BET_DATE_PRESETS: ReadonlyArray<{ value: BetDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
]

export function isBetDatePreset(value: string): value is BetDatePreset {
  return BET_DATE_PRESETS.some((preset) => preset.value === value)
}

/** Calendar arithmetic on a `yyyy-MM-dd` day, independent of the browser's zone and DST. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/**
 * The IST calendar window of a preset, as the legacy filter bar computed it: Last 7 Days is today and the
 * six days before it, Last 30 Days today and the 29 before. Custom starts on today.
 */
export function getBetRangeForPreset(
  preset: BetDatePreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = istDayOf(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const yesterday = shiftDay(today, -1)
      return { from: yesterday, to: yesterday }
    }
    case 'last7days':
      return { from: shiftDay(today, -6), to: today }
    case 'last30days':
      return { from: shiftDay(today, -29), to: today }
    case 'custom':
      return { from: today, to: today }
  }
}

/* ---------- filter options and counts ---------- */

export const BET_DOMAIN_OPTIONS: readonly (SelectOption & { value: BetDomain })[] = [
  { value: 'ALL', label: 'All' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'CASINO', label: 'Casino' },
  { value: 'MATKA', label: 'Matka' },
]

export function isBetDomain(value: string): value is BetDomain {
  return BET_DOMAIN_OPTIONS.some((option) => option.value === value)
}

// `matched` is the Open choice everywhere: the server reads it as pending+active for casino and matka, so an
// open (or stuck) casino round can be listed, which the casino and matka lists could not offer.
const STATUS_OPTIONS_ALL = ['matched', 'won', 'lost', 'void', 'cancelled', 'settled']
const STATUS_OPTIONS_SPORTS = ['matched', 'cancelled', 'settled', 'won', 'lost', 'void']
const STATUS_OPTIONS_CASINO = ['matched', 'won', 'lost', 'cancelled', 'void']
const STATUS_OPTIONS_MATKA = ['matched', 'won', 'lost', 'cancelled', 'void']

/** The statuses a domain offers, in the legacy order; `matched` reads `Open`, the rest keep the raw value. */
export function betStatusOptions(domain: BetDomain): ListboxOption[] {
  const statuses =
    domain === 'SPORTS' ? STATUS_OPTIONS_SPORTS
    : domain === 'CASINO' ? STATUS_OPTIONS_CASINO
    : domain === 'MATKA' ? STATUS_OPTIONS_MATKA
    : STATUS_OPTIONS_ALL
  return statuses.map((status) => ({ value: status, label: status === 'matched' ? 'Open' : status }))
}

const OPEN_STATUS_ALIASES = new Set(['open', 'active', 'pending', 'matched'])
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface BetListInitialState {
  domain: BetDomain
  filters: BetsPageFilters
  datePreset: BetDateSelection
}

/**
 * The page's opening state from its URL, so a link can open a filtered list. The page read no URL at all:
 * the stuck casino rounds alert (/bets?domain=casino&status=active) opened on Today across all domains, which
 * did not hold the rounds it warned about, and the global search's /bets?search= lost its text.
 *
 * - `domain`: sports, casino, matka or all, in any case.
 * - `status`: repeated or comma-separated; open, active, pending and matched all read Open. A status the
 *   domain does not offer is dropped.
 * - `dateFrom` (with `dateTo`, else today): a custom range.
 * - `search`: the search text.
 *
 * Without dates the list opens on Today, as a plain /bets always has, unless the link asks only for open bets
 * or carries a search: an open bet, or the one bet looked for, can be of any date, so those open with no date
 * bound.
 */
export function betListStateFromSearch(params: URLSearchParams, today: string): BetListInitialState {
  const rawDomain = (params.get('domain') ?? '').toUpperCase()
  const domain: BetDomain = isBetDomain(rawDomain) ? rawDomain : 'ALL'
  const offered = new Set(betStatusOptions(domain).map((option) => option.value))
  const requested = params.getAll('status').flatMap((value) => value.split(',')).map((value) => value.trim().toLowerCase()).filter(Boolean)
  const status = [...new Set(requested.map((value) => (OPEN_STATUS_ALIASES.has(value) ? 'matched' : value)))].filter((value) => offered.has(value))
  const search = params.get('search')?.trim() || undefined
  const dateFrom = params.get('dateFrom') ?? ''
  const dateTo = params.get('dateTo') ?? ''

  const filters: BetsPageFilters = { status: status.length ? status : undefined, search }
  if (DAY_PATTERN.test(dateFrom)) {
    return { domain, filters: { ...filters, dateFrom, dateTo: DAY_PATTERN.test(dateTo) && dateTo >= dateFrom ? dateTo : today }, datePreset: 'custom' }
  }
  const onlyOpen = status.length > 0 && status.every((value) => value === 'matched')
  if (onlyOpen || search) return { domain, filters, datePreset: 'any' }
  return { domain, filters: { ...filters, dateFrom: today, dateTo: today }, datePreset: 'today' }
}

export const BET_WALLET_OPTIONS: readonly ListboxOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'referralBonus', label: 'Referral Bonus' },
]

/** The wallet filter exists only where a wallet other than cash can place the bet. */
export function showsBetWalletFilter(domain: BetDomain): boolean {
  return domain === 'ALL' || domain === 'CASINO'
}

/**
 * Each chosen status counts, and so does every other set filter; the date counts only when its preset is
 * not the default Today (a custom range of today still counts, as before). The Player field is one filter,
 * whether it holds typed text or a picked player.
 */
export function countActiveBetFilters(filters: BetsPageFilters, datePreset: BetDateSelection): number {
  return (
    (filters.status?.length ?? 0) +
    (datePreset !== 'today' ? 1 : 0) +
    (filters.agentUsername ? 1 : 0) +
    (filters.playerSearch || filters.userId ? 1 : 0) +
    (filters.search ? 1 : 0) +
    (filters.walletType ? 1 : 0)
  )
}

/**
 * Agents see their own sub-agents (every scheme: COMMISSION agents have sub-agents too); admins search all
 * agents; an agent session without an id gets no agent filter at all.
 */
export type BetAgentFilterMode = 'subAgents' | 'search' | 'none'

export function betAgentFilterMode(isAgent: boolean, agentId: string | undefined): BetAgentFilterMode {
  if (isAgent && agentId) return 'subAgents'
  if (!isAgent) return 'search'
  return 'none'
}

export const ALL_MY_PLAYERS_OPTION: ListboxOption = { label: 'All my players', value: '' }

export interface BetAgentRow {
  id: string
  username: string
}

export function betAgentOptions(mode: BetAgentFilterMode, agents: readonly BetAgentRow[]): ListboxOption[] {
  const options = agents.map((agent) => ({ label: agent.username, value: agent.username }))
  return mode === 'subAgents' ? [ALL_MY_PLAYERS_OPTION, ...options] : options
}

export interface BetPlayerRow {
  id: number | string
  username?: string | null
  name?: string | null
  phone?: string | null
}

/**
 * Each option's value is the player's id: a pick filters by that one player (`userId`). The value was the
 * username, sent as the substring search, so picking ROHIT listed the bets of every player whose username,
 * name or phone contained it, and two players with one username shared an option.
 */
export function betPlayerOptions(players: readonly BetPlayerRow[]): ListboxOption[] {
  return players.map((player) => {
    const label = [player.username || player.name || `User ${player.id}`, player.phone ? `(${player.phone})` : '']
      .filter(Boolean)
      .join(' ')
    return { label, value: String(player.id) }
  })
}

export function betAgentEmptyText(mode: BetAgentFilterMode, loading: boolean, query: string): string {
  if (mode === 'subAgents') return loading ? 'Loading...' : 'No sub-agents'
  return loading ? 'Loading...' : query.trim().length < 2 ? 'Type 2+ chars' : 'No agents'
}

export function betPlayerEmptyText(loading: boolean, query: string): string {
  return loading ? 'Loading...' : query.trim().length < 2 ? 'Type 2+ chars' : 'No players'
}

/**
 * The Player field's text after an edit made while it shows a picked player's label. antd showed that
 * label beside an empty search box, so typing started a fresh search from the typed characters; here the
 * label is the input's text, so the search is what the edit inserted into it (appended, typed over a
 * selection or pasted mid-label). A pure deletion inserts nothing and leaves an empty search.
 */
export function betPlayerTextAfterPick(label: string, text: string): string {
  const shorter = Math.min(label.length, text.length)
  let start = 0
  while (start < shorter && label[start] === text[start]) start += 1
  let end = 0
  while (end < shorter - start && label[label.length - 1 - end] === text[text.length - 1 - end]) end += 1
  return text.slice(start, text.length - end)
}

/**
 * What a key does to an open server-searched list (Player; Agent for admins) beyond the kit's own
 * handling, so it ends as antd's did:
 * - 'pickFirst': Enter or Tab with no option active while typed text (or nothing) is shown and the list
 *   holds options. antd made the first option active whenever the server's options arrived, so these keys
 *   picked it; the kit highlights only as the text is typed, before the server answers.
 * - 'drop': the key closes the list without a pick (Escape, Alt+ArrowUp, Enter with nothing to pick).
 *   antd's single select emptied its search then; for Player the page's onSearch('') dropped the typed
 *   text and the playerSearch filter with it (the Agent field's uncontrolled search ends by itself).
 */
export type BetSearchKeyAction = 'pickFirst' | 'drop' | 'none'

export function betSearchKeyAction(
  key: string,
  altKey: boolean,
  state: { listOpen: boolean; optionActive: boolean; hasOptions: boolean; showingPick: boolean },
): BetSearchKeyAction {
  if (!state.listOpen) return 'none'
  if ((key === 'Enter' || key === 'Tab') && !state.optionActive && !state.showingPick && state.hasOptions) {
    return 'pickFirst'
  }
  if (key === 'Escape' || (key === 'ArrowUp' && altKey) || (key === 'Enter' && !state.optionActive)) return 'drop'
  return 'none'
}

/* ---------- statistics ---------- */

export interface BetsPageTotals {
  totalAll?: number | null
  totalSports?: number | null
  totalCasino?: number | null
  totalMatka?: number | null
  totalStake?: number | null
  totalStakeSports?: number | null
  totalStakeCasino?: number | null
  totalStakeMatka?: number | null
}

/** The headline count and stake follow the Domain filter, so they match the table's scope. */
export function betHeadline(totals: BetsPageTotals | null | undefined, domain: BetDomain) {
  if (domain === 'SPORTS') return { count: totals?.totalSports ?? 0, stake: totals?.totalStakeSports ?? 0 }
  if (domain === 'CASINO') return { count: totals?.totalCasino ?? 0, stake: totals?.totalStakeCasino ?? 0 }
  if (domain === 'MATKA') return { count: totals?.totalMatka ?? 0, stake: totals?.totalStakeMatka ?? 0 }
  return { count: totals?.totalAll ?? 0, stake: totals?.totalStake ?? 0 }
}

export function betHeadlineLabels(domain: BetDomain) {
  return domain === 'ALL'
    ? { count: 'Total Bets', stake: 'Total Stake' }
    : { count: 'Bets in list', stake: 'Stake in list' }
}

/* ---------- table ---------- */

export type BetColumnSet = 'ALL' | 'SPORTS' | 'CASINO' | 'MATKA'

/** The table's columns follow the rows on the page: one domain gets its own set, a mix (or none) the shared one. */
export function betColumnSet(items: readonly { __typename: string }[]): BetColumnSet {
  if (items.length === 0) return 'ALL'
  const types = new Set(items.map((item) => item.__typename))
  if (types.size !== 1) return 'ALL'
  const [typename] = [...types]
  if (typename === 'SportsBet') return 'SPORTS'
  if (typename === 'CasinoBet') return 'CASINO'
  if (typename === 'MatkaBet') return 'MATKA'
  return 'ALL'
}

export function betRowKey(item: { __typename: string; id: string }): string {
  return `${item.__typename}-${item.id}`
}

/** Anything that is not a sports or casino bet was labelled Matka by the legacy badge. */
export function betDomainLabel(typename: string): 'Sports' | 'Casino' | 'Matka' {
  if (typename === 'SportsBet') return 'Sports'
  if (typename === 'CasinoBet') return 'Casino'
  return 'Matka'
}

/** `matched` reads Open; every other status is shown with a capital first letter (as the export writes it). */
export function betStatusLabel(status: string): string {
  const value = String(status)
  if (value.toLowerCase() === 'matched') return 'Open'
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

/** The legacy tag colours: won green, lost red, void and cancelled grey, open and anything else blue. */
export function betStatusTone(status: string): StatusPillTone {
  const value = String(status).toLowerCase()
  if (value === 'won') return 'ok'
  if (value === 'lost') return 'neg'
  if (value === 'void' || value === 'cancelled') return 'muted'
  return 'info'
}

export function betWalletLabel(walletType?: string | null): 'Cash' | 'Bonus' | 'Referral' {
  if (!walletType) return 'Cash'
  const wallet = String(walletType).toLowerCase()
  if (wallet === 'bonus') return 'Bonus'
  if (wallet === 'referralbonus' || wallet === 'referral_bonus') return 'Referral'
  return 'Cash'
}

export function isBonusWalletLabel(label: string): boolean {
  return label === 'Bonus' || label === 'Referral'
}

export function isBackSide(side: string): boolean {
  return side.toLowerCase() === 'back'
}

export function formatDistributionType(value?: string | null): string {
  if (!value) return ''
  const labels: Record<string, string> = {
    instant_otp: 'Instant OTP',
    instant_cash: 'Instant Cash',
    roll_over: 'Roll Over',
  }
  return labels[value] ?? value.replace(/_/g, ' ')
}

export interface BetDetailLine {
  label: string
  value: string
}

/** The campaign tooltip's rows; a date that cannot be formatted is left out. */
export function campaignDetailLines(
  campaign: BetCampaign,
  formatDay: (value: string) => string,
): BetDetailLine[] {
  const day = (value: string | null | undefined): string => {
    if (!value) return ''
    try {
      return formatDay(value)
    } catch {
      return ''
    }
  }
  const lines: Array<BetDetailLine | false | '' | null | undefined> = [
    campaign.name && { label: 'Name', value: campaign.name },
    campaign.type && { label: 'Type', value: campaign.type },
    campaign.distributionType && {
      label: 'Payout type',
      value: formatDistributionType(campaign.distributionType),
    },
    campaign.domain && { label: 'Domain', value: campaign.domain },
    campaign.status && { label: 'Status', value: campaign.status },
    campaign.wageringReq != null && { label: 'Wagering', value: `${campaign.wageringReq}x` },
    campaign.amount != null && { label: 'Amount', value: String(campaign.amount) },
    campaign.percentage != null && { label: 'Percentage', value: `${campaign.percentage}%` },
    campaign.amountType && { label: 'Amount type', value: campaign.amountType },
    Boolean(campaign.validFrom && day(campaign.validFrom)) && { label: 'Valid from', value: day(campaign.validFrom) },
    Boolean(campaign.validTo && day(campaign.validTo)) && { label: 'Valid to', value: day(campaign.validTo) },
    Boolean(campaign.startDate && day(campaign.startDate)) && { label: 'Start date', value: day(campaign.startDate) },
    Boolean(campaign.endDate && day(campaign.endDate)) && { label: 'End date', value: day(campaign.endDate) },
  ]
  return lines.filter((line): line is BetDetailLine => Boolean(line))
}

export function sportsDetailLines(row: SportsBetItem): BetDetailLine[] {
  const lines: BetDetailLine[] = []
  if (row.ipAddress) lines.push({ label: 'IP', value: row.ipAddress })
  if (row.location) lines.push({ label: 'Location', value: row.location })
  if (row.country) lines.push({ label: 'Country', value: row.country })
  if (row.deviceInfo) lines.push({ label: 'Device', value: row.deviceInfo })
  return lines
}

export function casinoDetailLines(row: CasinoBetItem): BetDetailLine[] {
  const lines: BetDetailLine[] = []
  if (row.sessionId) lines.push({ label: 'Session', value: row.sessionId })
  if (row.gameRoundId) lines.push({ label: 'Round', value: row.gameRoundId })
  if (row.transactionId) lines.push({ label: 'Txn', value: row.transactionId })
  return lines
}

export function canOpenRoundDetail(row: CasinoBetItem): boolean {
  return Boolean(row.gameRoundId && row.settledAt && row.providerCode)
}

export function roundDetailVariables(row: CasinoBetItem) {
  return { roundId: row.gameRoundId as string, endTime: row.settledAt as string, providerCode: row.providerCode as string }
}

export function roundDetailErrorMessage(errors: readonly { message?: string }[]): string {
  return errors.map((error) => error.message).filter(Boolean).join(' ') || 'Request failed'
}

/** Sport › League › Event, the full path the legacy tooltip showed. */
export function sportsEventPath(row: SportsBetItem): string {
  return [row.sportName, row.leagueName, row.eventName].filter(Boolean).join(' › ')
}

/** Odds as the legacy cells wrote them: "size / price" in a sports-only list, "size/price" in the mixed one. */
export function sportsOddsLabel(row: SportsBetItem, spaced: boolean): string | null {
  if (row.price == null) return null
  if (row.oddsSize != null) {
    return `${Number(row.oddsSize).toFixed(0)}${spaced ? ' / ' : '/'}${Number(row.price).toFixed(2)}`
  }
  return Number(row.price).toFixed(2)
}

export function matkaMultiplierLabel(row: MatkaBetItem): string | null {
  return row.payoutMultiplier != null ? `${Number(row.payoutMultiplier).toFixed(1)}x` : null
}

export function betStake(row: BetItem): number {
  return row.__typename === 'MatkaBet' ? row.betAmount : row.stake
}

/** The shared list's Liability column: liability for sports, payout for casino, potential win for matka. */
export function betLiability(row: BetItem): number | null | undefined {
  if (row.__typename === 'SportsBet') return row.liability
  if (row.__typename === 'CasinoBet') return row.payout
  return row.potentialWin
}

/** Matka P/L: zero when void or cancelled, the win less the stake once settled, otherwise unknown. */
export function matkaPL(row: MatkaBetItem): number | null {
  const status = String(row.status).toLowerCase()
  if (status === 'void' || status === 'cancelled') return 0
  if (row.actualWin != null) return Number(row.actualWin) - Number(row.betAmount)
  return null
}

export function betPL(row: BetItem): number | null {
  if (row.__typename === 'SportsBet') return row.pl ?? null
  if (row.__typename === 'CasinoBet') return row.netAmount ?? null
  return matkaPL(row)
}

export type BetFigureTone = 'pos' | 'neg' | 'zero'

export function plTone(value: number): BetFigureTone {
  return value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero'
}

export function formatPL(value: number, currency: string, formatAmount: (value: number, currency: string) => string): string {
  return `${value > 0 ? '+' : ''}${formatAmount(value, currency)}`
}

export type BetOutcome = 'Won' | 'Lost' | 'Void' | 'Cancelled'

/** A settled outcome in words, or null; casino rows only ever say Won or Lost. */
export function betOutcome(status: string, includeVoid = true): BetOutcome | null {
  const value = String(status).toLowerCase()
  if (value === 'won') return 'Won'
  if (value === 'lost') return 'Lost'
  if (!includeVoid) return null
  if (value === 'void') return 'Void'
  if (value === 'cancelled') return 'Cancelled'
  return null
}

export function outcomeTone(outcome: BetOutcome): 'pos' | 'neg' | 'dim' {
  if (outcome === 'Won') return 'pos'
  if (outcome === 'Lost') return 'neg'
  return 'dim'
}
