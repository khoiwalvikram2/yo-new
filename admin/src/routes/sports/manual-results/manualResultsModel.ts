/* Pure logic of /sports/manual-results, kept out of the components so it can be tested without React or
   Apollo. Every string here is the legacy page's copy, word for word, except the decorative emoji the
   legacy put in front of some of it (named in the record); every rule is the legacy rule, including the
   quirks the record reports (the exact-match settings lookup, the untrimmed filter count). Declaring and
   rolling back results moves money: the mutation inputs below keep the legacy keys, order and mapping. */
import type { SportsResult, SportsResultFilters } from '@/modules/sports/results'
import { DEFAULT_ADMIN_TZ, formatInTimeZone } from '@/shared/utils/date'

export type MarketType = 'exchange' | 'bookmaker' | 'fancy'

/** A selectable option, shaped for both the kit Select and the kit Combobox. */
export interface ChoiceOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
  group?: string
}

const MARKET_TYPES: readonly MarketType[] = ['exchange', 'bookmaker', 'fancy']

function isMarketType(value: unknown): value is MarketType {
  return typeof value === 'string' && (MARKET_TYPES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------------------------------
// Filters and the list query
// ---------------------------------------------------------------------------------------------------

export const MANUAL_RESULT_PAGE_SIZES = [10, 20, 50, 100] as const

/** The page's initial filters, and what Clear All returns to (page size included, as before). */
export function defaultManualResultFilters(): SportsResultFilters {
  return { page: 1, limit: 20, sort: 'createdAt:desc' }
}

/** The `query` variable of `SportsResults`, keys in the legacy order; search is sent from two trimmed
 *  characters, otherwise left out. */
export function buildSportsResultsVariables(filters: SportsResultFilters): SportsResultFilters {
  return {
    sportId: filters.sportId,
    leagueId: filters.leagueId,
    eventId: filters.eventId,
    marketId: filters.marketId,
    marketType: filters.marketType,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    search: filters.search && filters.search.trim().length >= 2 ? filters.search.trim() : undefined,
    rolledBack: filters.rolledBack,
    page: filters.page || 1,
    limit: filters.limit || 20,
    sort: filters.sort || 'createdAt:desc',
  }
}

/** Search, sport, league, event, type, date and status each count once; the search counts as soon as it
 *  has a character, though the query ignores it below two (legacy). */
export function countActiveManualResultFilters(filters: SportsResultFilters): number {
  return [
    filters.search,
    filters.sportId,
    filters.leagueId,
    filters.eventId,
    filters.marketType,
    filters.dateFrom,
    filters.rolledBack !== undefined,
  ].filter(Boolean).length
}

export function withSearch(filters: SportsResultFilters, search: string): SportsResultFilters {
  return { ...filters, search, page: 1 }
}

/** A new (or cleared) sport clears the league, event and market below it. */
export function withSport(filters: SportsResultFilters, sportId: string | undefined): SportsResultFilters {
  return { ...filters, sportId, leagueId: undefined, eventId: undefined, marketId: undefined, page: 1 }
}

/** A new (or cleared) league clears the event and market below it. */
export function withLeague(filters: SportsResultFilters, leagueId: string | undefined): SportsResultFilters {
  return { ...filters, leagueId, eventId: undefined, marketId: undefined, page: 1 }
}

/** A new (or cleared) event clears the market below it. */
export function withEvent(filters: SportsResultFilters, eventId: string | undefined): SportsResultFilters {
  return { ...filters, eventId, marketId: undefined, page: 1 }
}

export const MARKET_TYPE_FILTER_OPTIONS: readonly ChoiceOption[] = [
  { value: '', label: 'All Types' },
  { value: 'exchange', label: 'Exchange' },
  { value: 'bookmaker', label: 'Bookmaker' },
  { value: 'fancy', label: 'Fancy' },
]

export function withMarketType(filters: SportsResultFilters, value: string): SportsResultFilters {
  return { ...filters, marketType: isMarketType(value) ? value : undefined, page: 1 }
}

export const STATUS_FILTER_OPTIONS: readonly ChoiceOption[] = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'rolledBack', label: 'Rolled Back' },
]

export function statusFilterValue(rolledBack: boolean | undefined): '' | 'active' | 'rolledBack' {
  if (rolledBack === undefined) return ''
  return rolledBack ? 'rolledBack' : 'active'
}

/** Rolled Back sends `rolledBack: true`, Active `false`; All Status removes the key, as the legacy clear
 *  did. */
export function applyStatusFilter(filters: SportsResultFilters, value: string): SportsResultFilters {
  if (value === 'rolledBack') return { ...filters, rolledBack: true, page: 1 }
  if (value === 'active') return { ...filters, rolledBack: false, page: 1 }
  const rest: SportsResultFilters = { ...filters, page: 1 }
  delete rest.rolledBack
  return rest
}

/** The legacy date filter was a bare range picker whose cleared state meant every date; the kit field
 *  gives that state a name. */
export const MANUAL_RESULT_DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
] as const

export function manualResultDatePreset(filters: SportsResultFilters): 'all' | 'custom' {
  return filters.dateFrom && filters.dateTo ? 'custom' : 'all'
}

export type DateRangeApply = { kind: 'preset'; preset: string } | { kind: 'custom'; from: string; to: string }

/** A custom range sends its two calendar days as picked (`yyyy-MM-dd`); All dates clears both. */
export function applyManualResultDateRange(filters: SportsResultFilters, payload: DateRangeApply): SportsResultFilters {
  if (payload.kind === 'custom' && payload.from && payload.to) {
    return { ...filters, dateFrom: payload.from, dateTo: payload.to, page: 1 }
  }
  return { ...filters, dateFrom: undefined, dateTo: undefined, page: 1 }
}

/** Named entities from the shared sports lists, as options. */
export function namedOptions(items: unknown): ChoiceOption[] {
  if (!Array.isArray(items)) return []
  return (items as Array<{ id: string; name: string }>).map((item) => ({ value: item.id, label: item.name }))
}

// ---------------------------------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------------------------------

export const SPECIAL_SELECTIONS = ['VOID', 'CANCELLED', 'SUSPENDED'] as const

type ResultFields = Pick<SportsResult, 'selectionName' | 'marketType' | 'result' | 'runner'>

/** VOID, CANCELLED and SUSPENDED as declared; a fancy market as `name: value`; otherwise the runner. */
export function resultDisplay(result: ResultFields): string {
  if (result.selectionName && (SPECIAL_SELECTIONS as readonly string[]).includes(result.selectionName)) {
    return result.selectionName
  }
  if (result.marketType === 'fancy') {
    return `${result.selectionName || 'N/A'}: ${result.result || 'N/A'}`
  }
  return result.runner?.name || 'N/A'
}

/** The type badge's palette: an unknown type took the exchange colours (legacy `colors[type] || exchange`). */
export function typeBadgeKind(type: string): MarketType {
  return isMarketType(type) ? type : 'exchange'
}

/** The row tile and the result figure: exchange blue, bookmaker green, anything else orange (legacy). */
export function resultTintKind(type: string): MarketType {
  if (type === 'exchange') return 'exchange'
  if (type === 'bookmaker') return 'bookmaker'
  return 'fancy'
}

export function marketTypeLabel(type: string): string {
  return type.toUpperCase()
}

export function scopeLine(result: Pick<SportsResult, 'sport' | 'league' | 'event'>): string {
  return `${result.sport?.name || 'N/A'} / ${result.league?.name || 'N/A'} / ${result.event?.name || 'N/A'}`
}

export function marketCellLabel(result: Pick<SportsResult, 'market' | 'marketId'>): string {
  return result.market?.name || result.marketId
}

export function declaredByLabel(result: Pick<SportsResult, 'declaredByName' | 'declaredBy'>): string {
  return result.declaredByName || result.declaredBy
}

export type ResultTone = 'ok' | 'neg'

/** Rolled Back (was antd's red dot) or Active (green), on the approved tones. */
export function resultStatus(result: Pick<SportsResult, 'rolledBackAt'>): { label: string; tone: ResultTone } {
  return result.rolledBackAt ? { label: 'Rolled Back', tone: 'neg' } : { label: 'Active', tone: 'ok' }
}

/** Declared within the last hour (the legacy green dot); an unreadable time is never recent. */
export function isRecentDeclaration(declaredAt: string | null | undefined, nowMs: number): boolean {
  if (!declaredAt) return false
  const at = new Date(declaredAt).getTime()
  return Number.isFinite(at) && at > nowMs - 60 * 60 * 1000
}

export function rollbackActionLabel(result: Pick<SportsResult, 'event' | 'eventId' | 'market' | 'marketId'>): string {
  return `Rollback result for ${result.event?.name || result.eventId}, ${marketCellLabel(result)}`
}

export function resultCountLabel(fetching: boolean, count: number): string {
  if (fetching) return 'Loading...'
  return `${count} ${count === 1 ? 'result' : 'results'}`
}

export interface RollbackDetailLine {
  key: 'at' | 'by' | 'reason' | 'tag'
  label: string
  value: string
}

/** The legacy rollback tooltip: when (formatted by the caller), then by whom, why and the tag, each only
 *  when present. */
export function rollbackDetailLines(
  result: Pick<SportsResult, 'rolledBackByName' | 'rollbackReason' | 'rollbackTag'>,
  rolledBackAtText: string,
): RollbackDetailLine[] {
  const lines: RollbackDetailLine[] = [{ key: 'at', label: 'Rolled Back:', value: rolledBackAtText }]
  if (result.rolledBackByName) lines.push({ key: 'by', label: 'By:', value: result.rolledBackByName })
  if (result.rollbackReason) lines.push({ key: 'reason', label: 'Reason:', value: result.rollbackReason })
  if (result.rollbackTag) lines.push({ key: 'tag', label: 'Tag:', value: result.rollbackTag })
  return lines
}

export const COPY_RESULT_ID = {
  label: 'Copy Result ID',
  copiedLabel: 'Result ID copied to clipboard',
  errorLabel: 'Failed to copy',
} as const

// ---------------------------------------------------------------------------------------------------
// Statistics (the first 1,000 results, independent of the filters)
// ---------------------------------------------------------------------------------------------------

export interface ManualResultStats {
  total: number
  today: number
  exchange: number
  bookmaker: number
  fancy: number
  rolledBack: number
}

type StatsRow = { declaredAt?: string; marketType?: string; rolledBackAt?: string | null }

/** `todayIst` is today's `yyyy-MM-dd` in Asia/Kolkata; a result counts as today's by its declaration day
 *  there. The three market-type counts leave rolled-back results out; the total keeps them. */
export function computeManualResultStats(results: readonly StatsRow[], todayIst: string): ManualResultStats {
  const todayResults = results.filter((r) => {
    const declaredDate = r.declaredAt ? formatInTimeZone(new Date(r.declaredAt), 'yyyy-MM-dd', DEFAULT_ADMIN_TZ) : ''
    return declaredDate === todayIst
  })
  return {
    total: results.length,
    today: todayResults.length,
    exchange: results.filter((r) => r.marketType === 'exchange' && !r.rolledBackAt).length,
    bookmaker: results.filter((r) => r.marketType === 'bookmaker' && !r.rolledBackAt).length,
    fancy: results.filter((r) => r.marketType === 'fancy' && !r.rolledBackAt).length,
    rolledBack: results.filter((r) => r.rolledBackAt).length,
  }
}

export interface ManualResultStatCard {
  key: 'total' | 'exchange' | 'bookmaker' | 'rolledBack'
  label: string
  value: string | number
  note: string
}

export function manualResultStatCards(stats: ManualResultStats): ManualResultStatCard[] {
  const share = (count: number) => (stats.total > 0 ? `${Math.round((count / stats.total) * 100)}%` : '—')
  return [
    { key: 'total', label: 'Total Results', value: stats.total.toLocaleString(), note: `${stats.today} today` },
    { key: 'exchange', label: 'Exchange', value: stats.exchange, note: share(stats.exchange) },
    { key: 'bookmaker', label: 'Bookmaker', value: stats.bookmaker, note: `${stats.fancy} fancy` },
    { key: 'rolledBack', label: 'Rolled Back', value: stats.rolledBack, note: share(stats.rolledBack) },
  ]
}

// ---------------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------------

export const ROLLBACK_CONFIRM_WORD = 'ROLLBACK'

export const ROLLBACK_TAG_OPTIONS: readonly ChoiceOption[] = [
  { value: 'error', label: 'Error' },
  { value: 'correction', label: 'Correction' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'other', label: 'Other' },
]

/** antd's `required` rule: an empty reason fails; whitespace counts as a reason (no `whitespace` rule). */
export function rollbackReasonError(reason: string): string | undefined {
  return reason === '' ? 'Please provide a reason for rollback' : undefined
}

/** The typed word is case-sensitive. */
export function canConfirmRollback(confirmText: string): boolean {
  return confirmText === ROLLBACK_CONFIRM_WORD
}

/** `RollbackSportsResult`'s input, keys in the legacy order; an unchosen category is left undefined. */
export function buildRollbackInput(id: string, reason: string, tag?: string) {
  return { id, reason, tag }
}

/** The six facts above the rollback form: names, or the raw ids when a name was not resolved. */
export function rollbackFacts(
  result: Pick<
    SportsResult,
    | 'sport'
    | 'sportId'
    | 'league'
    | 'leagueId'
    | 'event'
    | 'eventId'
    | 'market'
    | 'marketId'
    | 'marketType'
    | 'selectionName'
    | 'result'
    | 'runner'
  >,
) {
  return [
    { key: 'sport', term: 'Sport', value: result.sport?.name || result.sportId },
    { key: 'league', term: 'League', value: result.league?.name || result.leagueId },
    { key: 'event', term: 'Event', value: result.event?.name || result.eventId },
    { key: 'market', term: 'Market', value: result.market?.name || result.marketId },
    { key: 'type', term: 'Type', value: result.marketType.toUpperCase() },
    { key: 'result', term: 'Result', value: resultDisplay(result) },
  ]
}

export const ROLLBACK_COMPLETE = {
  title: 'Rollback Complete',
  message: 'Result rolled back successfully. All bet settlements have been reversed.',
} as const

export const ROLLBACK_FAILED_TITLE = 'Rollback Failed'
export const ROLLBACK_ERROR_TITLE = 'Rollback Error'

/** The server's refusal, else the legacy fallback. */
export function rollbackFailureMessage(message: string | null | undefined): string {
  return message || 'Failed to rollback result'
}

/** A thrown rollback: its message, else the legacy fallback. */
export function rollbackErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return (typeof message === 'string' && message) || 'An error occurred while rolling back the result'
}

// ---------------------------------------------------------------------------------------------------
// Declare result: market type, markets and open bets
// ---------------------------------------------------------------------------------------------------

export const CRICKET_SPORT_CODE = '4'

export function isCricketCode(code: string | null | undefined): boolean {
  return code === CRICKET_SPORT_CODE
}

/** Bookmaker and Fancy are offered only for cricket (sport code 4); they stay listed, disabled. */
export function declareMarketTypeOptions(isCricket: boolean): ChoiceOption[] {
  return [
    { value: 'exchange', label: 'Exchange' },
    { value: 'bookmaker', label: 'Bookmaker', disabled: !isCricket },
    { value: 'fancy', label: 'Fancy', disabled: !isCricket },
  ]
}

export function marketTypeFromValue(value: string): MarketType | undefined {
  return isMarketType(value) ? value : undefined
}

export interface OpenBetsMarket {
  id: string
  name: string
  type?: string | null
}

/** The legacy name/type matching: bookmaker and fancy by substring; exchange is everything else. */
export function marketMatchesType(market: Pick<OpenBetsMarket, 'name' | 'type'>, type: MarketType): boolean {
  const marketTypeLower = (market.type || '').toLowerCase()
  const marketNameLower = (market.name || '').toLowerCase()
  if (type === 'bookmaker') {
    return marketTypeLower.includes('bookmaker') || marketTypeLower.includes('book') || marketNameLower.includes('bookmaker')
  }
  if (type === 'fancy') {
    return marketTypeLower.includes('fancy') || marketNameLower.includes('fancy')
  }
  return (
    !marketTypeLower.includes('bookmaker') &&
    !marketTypeLower.includes('book') &&
    !marketTypeLower.includes('fancy') &&
    !marketNameLower.includes('bookmaker') &&
    !marketNameLower.includes('fancy')
  )
}

/** Market ids that already have a live (not rolled back) result for the event. */
export function declaredMarketIdSet(items: unknown): Set<string> {
  if (!Array.isArray(items)) return new Set()
  return new Set(
    (items as Array<{ marketId?: string | null }>)
      .map((item) => item.marketId)
      .filter((id): id is string => Boolean(id)),
  )
}

/** The markets offered for the chosen type, without those already declared; none until a type is chosen. */
export function declarableMarkets(
  markets: readonly OpenBetsMarket[] | null | undefined,
  type: MarketType | undefined,
  declared: ReadonlySet<string>,
): OpenBetsMarket[] {
  if (!markets || !type) return []
  return markets.filter((market) => !declared.has(market.id) && marketMatchesType(market, type))
}

/** Markets of the chosen type before the declared ones are taken out (for the empty hint). */
export function marketsOfTypeCount(markets: readonly OpenBetsMarket[] | null | undefined, type: MarketType | undefined): number {
  if (!markets || !type) return 0
  return markets.filter((market) => marketMatchesType(market, type)).length
}

/** Under Market when the chosen type offers nothing. */
export function emptyMarketsHint(type: MarketType, allMarkets: number, ofType: number): string {
  if (!allMarkets) return 'No markets with open bets for this event.'
  if (ofType > 0) return `All ${type} markets with open bets already have results declared.`
  return `No ${type} markets with open bets for this event.`
}

export interface OpenBetsChip {
  marketId: string
  marketName: string
  openCount: number
}

/** Open (matched or unmatched) bets per market, across every whitelabel; markets with none are left out,
 *  the busiest first. */
export function openBetsChips(bets: unknown, markets: readonly OpenBetsMarket[] | null | undefined): OpenBetsChip[] {
  const countByMarketId = new Map<string, number>()
  for (const bet of Array.isArray(bets) ? (bets as Array<{ marketId?: string | null } | null>) : []) {
    const mid = bet?.marketId
    if (mid) countByMarketId.set(mid, (countByMarketId.get(mid) ?? 0) + 1)
  }
  return (markets ?? [])
    .filter((m) => (countByMarketId.get(m.id) ?? 0) > 0)
    .map((m) => ({ marketId: m.id, marketName: m.name, openCount: countByMarketId.get(m.id) ?? 0 }))
    .sort((a, b) => b.openCount - a.openCount)
}

// ---------------------------------------------------------------------------------------------------
// Declare result: quick search
// ---------------------------------------------------------------------------------------------------

export interface HierarchyHit {
  type: string
  sportId?: string | null
  sportName?: string | null
  leagueId?: string | null
  leagueName?: string | null
  eventId?: string | null
  eventName?: string | null
}

export interface HierarchyOption extends ChoiceOption {
  type: 'sport' | 'league' | 'event'
  sportId?: string | null
  sportName?: string | null
  leagueId?: string | null
  leagueName?: string | null
  eventId?: string | null
  eventName?: string | null
}

/** One option per sport, league or event hit, in the server's order, from two typed characters. The
 *  values are the legacy ones; the label drops the legacy emoji and the kind is said in words instead. */
export function buildHierarchySearchOptions(searchValue: string, hits: unknown): HierarchyOption[] {
  if (!searchValue || searchValue.length < 2) return []
  const options: HierarchyOption[] = []
  for (const result of Array.isArray(hits) ? (hits as HierarchyHit[]) : []) {
    if (result.type === 'sport') {
      options.push({
        value: `sport:${result.sportId}:${result.sportName}`,
        label: `${result.sportName}`,
        description: 'Sport',
        type: 'sport',
        sportId: result.sportId,
        sportName: result.sportName,
      })
    } else if (result.type === 'league') {
      options.push({
        value: `league:${result.leagueId}:${result.leagueName}`,
        label: `${result.leagueName} → ${result.sportName}`,
        description: 'League',
        type: 'league',
        sportId: result.sportId,
        sportName: result.sportName,
        leagueId: result.leagueId,
        leagueName: result.leagueName,
      })
    } else if (result.type === 'event') {
      options.push({
        value: `event:${result.eventId}:${result.eventName}`,
        label: `${result.eventName} → ${result.leagueName} → ${result.sportName}`,
        description: 'Event',
        type: 'event',
        sportId: result.sportId,
        sportName: result.sportName,
        leagueId: result.leagueId,
        leagueName: result.leagueName,
        eventId: result.eventId,
        eventName: result.eventName,
      })
    }
  }
  return options
}

/** The step hint above the search (legacy wording; the sport-and-league step really ends at "then"). */
export function searchStepHint(sportId: string | undefined, leagueId: string | undefined): string {
  if (!sportId) return 'Search sports first, then select to load more data'
  if (!leagueId) return 'Now search leagues, then'
  return 'Now search events'
}

export function searchPlaceholder(sportId: string | undefined, leagueId: string | undefined): string {
  if (!sportId) return 'Search sports (e.g., Cricket, Football)...'
  if (!leagueId) return 'Search leagues...'
  return 'Search events (e.g., Indonesia)...'
}

/** What the open list says when it has no option (antd `notFoundContent`). */
export function searchEmptyText(searchValue: string, loading: boolean): string {
  if (searchValue.length < 2) return 'Type at least 2 characters to search...'
  if (loading) return 'Searching...'
  return 'No results found'
}

export function searchFoundText(count: number): string {
  return `${count} result${count > 1 ? 's' : ''} found`
}

export function searchNoResultsHint(sportId: string | undefined, leagueId: string | undefined): string {
  if (!sportId) return 'No sports found. Try different keywords.'
  if (!leagueId) return 'No leagues with open bets. First select a sport from the dropdown below.'
  return 'No events with open bets for this league.'
}

/** The success toast after a search pick fills the hierarchy. */
export function searchSelectionMessage(option: HierarchyOption): string {
  if (option.type === 'sport') return `Selected sport: ${option.sportName}`
  if (option.type === 'league') return `Auto-filled: ${option.leagueName} → ${option.sportName}`
  return `Auto-filled: ${option.eventName} → ${option.leagueName} → ${option.sportName}`
}

export const LEAGUE_WITHOUT_OPEN_BETS = 'That league has no open bets. Selection cleared.'
export const EVENT_WITHOUT_OPEN_BETS = 'That event has no open bets. Selection cleared.'

// ---------------------------------------------------------------------------------------------------
// Declare result: the outcome and its submission
// ---------------------------------------------------------------------------------------------------

export const STATUS_PREFIX = 'STATUS:'

/** VOID, CANCELLED and SUSPENDED, stored with the legacy `STATUS:` prefix until submit. */
export const SPECIAL_STATUS_OPTIONS: readonly ChoiceOption[] = SPECIAL_SELECTIONS.map((status) => ({
  value: `${STATUS_PREFIX}${status}`,
  label: status,
}))

/** The heading over the three special statuses in the winner list (the legacy drew a bare rule). */
export const WINNER_STATUS_GROUP = 'Status'

/** The market's runners in the server's order, then the three special statuses as their own group. */
export function winnerOptions(runners: unknown): ChoiceOption[] {
  const runnerOptions = namedOptions(runners)
  return [...runnerOptions, ...SPECIAL_STATUS_OPTIONS.map((option) => ({ ...option, group: WINNER_STATUS_GROUP }))]
}

export function isStatusValue(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(STATUS_PREFIX))
}

export const WINNER_REQUIRED = 'Please select a winner or status'

/** The legacy Result Value rule: with a status the value must be empty; without one it is required and a
 *  whole number of at least zero. */
export function fancyResultError(fancyStatus: string | undefined, value: number | null): string | undefined {
  if (isStatusValue(fancyStatus)) {
    return value !== null ? 'Result value cannot be entered when status is selected' : undefined
  }
  if (value === null) return 'Please enter result value or select a status'
  if (!Number.isInteger(value) || value < 0) return 'Result value must be a whole number (digits only)'
  return undefined
}

export interface DeclareSelection {
  sportId?: string
  leagueId?: string
  eventId?: string
  marketId?: string
  marketType?: MarketType
  runnerId?: string
  fancyStatus?: string
  result: number | null
}

/** Whether Declare can be pressed: the hierarchy, the type and the market are all chosen. */
export function canDeclare(selection: Pick<DeclareSelection, 'sportId' | 'leagueId' | 'eventId' | 'marketId' | 'marketType'>): boolean {
  return Boolean(selection.sportId && selection.leagueId && selection.eventId && selection.marketId && selection.marketType)
}

/** The legacy submit's own checks, in order, as their error toasts (null: go ahead). */
export function declareSubmitBlocker(selection: DeclareSelection): string | null {
  if (!canDeclare(selection)) return 'Please fill in all required fields'
  if ((selection.marketType === 'exchange' || selection.marketType === 'bookmaker') && !selection.runnerId) {
    return WINNER_REQUIRED
  }
  if (selection.marketType === 'fancy') {
    if (isStatusValue(selection.fancyStatus)) {
      if (selection.result !== null) {
        return 'Result value cannot be entered when status is selected. Please clear the result field.'
      }
    } else if (selection.result === null) {
      return 'Please enter result value or select a status'
    }
  }
  return null
}

/** `CreateSportsResult`'s input, keys in the legacy order. A fancy market sends the market's name as the
 *  selection and its value as text, or the chosen status as the selection and no value; exchange and
 *  bookmaker send the runner, or a chosen status as the selection and no runner. */
export function buildCreateSportsResultInput(selection: DeclareSelection & { marketName?: string | null }) {
  const isSpecialStatus = selection.runnerId?.startsWith(STATUS_PREFIX)
  const statusValue = isSpecialStatus ? selection.runnerId?.replace(STATUS_PREFIX, '') : undefined
  const fancyStatusValue = selection.fancyStatus?.startsWith(STATUS_PREFIX)
    ? selection.fancyStatus.replace(STATUS_PREFIX, '')
    : undefined

  let selectionName: string | undefined
  let runnerId: string | undefined
  let result: string | undefined

  if (selection.marketType === 'fancy') {
    selectionName = selection.marketName || ''
    if (fancyStatusValue) {
      selectionName = fancyStatusValue
      result = undefined
    } else {
      result = selection.result !== undefined && selection.result !== null ? String(selection.result) : undefined
    }
  } else if (isSpecialStatus) {
    selectionName = statusValue
    runnerId = undefined
  } else {
    runnerId = selection.runnerId
  }

  return {
    sportId: selection.sportId,
    leagueId: selection.leagueId,
    eventId: selection.eventId,
    marketId: selection.marketId,
    marketType: selection.marketType,
    runnerId,
    selectionName,
    result,
  }
}

export type EventDisableStep = 'skip' | 'stillLoading' | 'otherMarketsOpen' | 'disable'

/** After a successful declaration with "Disable event" on: wait for nothing, but refuse while the open
 *  bets are still loading or another market of the event still has open bets. */
export function eventDisableStep(input: {
  disableEvent: boolean
  eventId: string | undefined
  openBetsLoading: boolean
  chips: readonly OpenBetsChip[]
  marketId: string | undefined
}): EventDisableStep {
  if (!input.disableEvent || !input.eventId) return 'skip'
  if (input.openBetsLoading) return 'stillLoading'
  if (input.chips.some((chip) => chip.marketId !== input.marketId)) return 'otherMarketsOpen'
  return 'disable'
}

export const EVENT_DISABLE_MESSAGES = {
  stillLoading:
    'Result declared successfully. Event was not disabled because open bets data was still loading. You can disable the event from Events configuration if needed.',
  otherMarketsOpen:
    'Result declared successfully. Event was not disabled because other markets in this event still have open bets.',
  disabled: 'Event disabled successfully',
  failed:
    'Result declared successfully, but event could not be disabled. You can disable it from Events configuration.',
} as const

/** The legacy error chain for a thrown declaration, first answer wins. */
export function declareErrorMessage(error: unknown): string {
  const e = error as
    | {
        networkError?: { message?: string } | null
        graphQLErrors?: Array<{ message?: string } | null> | null
        message?: string
      }
    | null
    | undefined
  return (
    e?.networkError?.message ??
    e?.graphQLErrors?.[0]?.message ??
    (Array.isArray(e?.graphQLErrors) && e.graphQLErrors.length > 0
      ? e.graphQLErrors.map((item) => item?.message).filter(Boolean).join('; ')
      : null) ??
    e?.message ??
    'Failed to declare result. Please try again.'
  )
}

// ---------------------------------------------------------------------------------------------------
// Auto results settings
// ---------------------------------------------------------------------------------------------------

export interface AutoResultsSetting {
  id: string
  sportId?: string | null
  leagueId?: string | null
  eventId?: string | null
  exchangeEnabled: boolean
  bookmakerEnabled: boolean
  fancyEnabled: boolean
  sport?: { id: string; name: string } | null
  league?: { id: string; name: string } | null
  event?: { id: string; name: string } | null
}

export interface MarketToggles {
  exchangeEnabled: boolean
  bookmakerEnabled: boolean
  fancyEnabled: boolean
}

export function offToggles(): MarketToggles {
  return { exchangeEnabled: false, bookmakerEnabled: false, fancyEnabled: false }
}

type SportRef = { id: string; sportCode?: string | null }
type LeagueRef = { id: string; sportId?: string | null }

/** The sport code of the chosen scope: the chosen sport, else the chosen league's sport. */
export function scopeSportCode(
  sports: readonly SportRef[] | null | undefined,
  leagues: readonly LeagueRef[] | null | undefined,
  sportId: string | undefined,
  leagueId: string | undefined,
): string | undefined {
  let sportIdToCheck = sportId
  if (!sportIdToCheck && leagueId && leagues) {
    const league = leagues.find((l) => l.id === leagueId)
    if (league?.sportId) sportIdToCheck = league.sportId
  }
  if (sportIdToCheck && sports) {
    const sport = sports.find((s) => s.id === sportIdToCheck)
    return sport ? (sport.sportCode ?? undefined) : undefined
  }
  return undefined
}

/** The saved setting for exactly this scope. Strict equality, as the legacy: a saved `null` league or
 *  event never equals an unchosen (`undefined`) one, so only a full sport/league/event scope finds its
 *  saved switches (reported, kept). */
export function findExactSetting(
  settings: readonly AutoResultsSetting[],
  sportId: string | undefined,
  leagueId: string | undefined,
  eventId: string | undefined,
): AutoResultsSetting | undefined {
  return settings.find((s) => s.sportId === sportId && s.leagueId === leagueId && s.eventId === eventId)
}

export function scopeDisplay(setting: Pick<AutoResultsSetting, 'sport' | 'league' | 'event'>): string {
  if (setting.event?.name) {
    return `${setting.sport?.name || 'N/A'} / ${setting.league?.name || 'N/A'} / ${setting.event.name}`
  }
  if (setting.league?.name) return `${setting.sport?.name || 'N/A'} / ${setting.league.name}`
  if (setting.sport?.name) return setting.sport.name
  return 'Global'
}

export function settingIsCricket(setting: Pick<AutoResultsSetting, 'sportId'>, sports: readonly SportRef[] | null | undefined): boolean {
  if (!setting.sportId || !sports) return false
  const sport = sports.find((s) => s.id === setting.sportId)
  return sport?.sportCode === CRICKET_SPORT_CODE
}

export const CRICKET_ONLY_TOGGLE = 'Bookmaker and Fancy market types are only available for cricket'

/** Turning Bookmaker or Fancy on for a saved scope whose sport is not cricket (or unknown) is refused. */
export function toggleRefused(
  settings: readonly AutoResultsSetting[],
  id: string,
  marketType: MarketType,
  enabled: boolean,
  sports: readonly SportRef[] | null | undefined,
): boolean {
  if (!((marketType === 'bookmaker' || marketType === 'fancy') && enabled)) return false
  const setting = settings.find((s) => s.id === id)
  if (!setting) return false
  if (setting.sportId && sports) {
    const sport = sports.find((s) => s.id === setting.sportId)
    return sport?.sportCode !== CRICKET_SPORT_CODE
  }
  return true
}

/** The legacy Save checks, in order, as their error toasts (null: go ahead). */
export function autoResultsSaveBlocker(input: {
  sportId?: string
  leagueId?: string
  eventId?: string
  isCricket: boolean
  toggles: MarketToggles
}): string | null {
  if (!input.sportId && !input.leagueId && !input.eventId) {
    return 'Please select at least one scope (Sport, League, or Event)'
  }
  const { exchangeEnabled, bookmakerEnabled, fancyEnabled } = input.toggles
  if (input.isCricket) {
    if (!exchangeEnabled && !bookmakerEnabled && !fancyEnabled) {
      return 'Please enable at least one market type (Exchange, Bookmaker, or Fancy)'
    }
  } else if (!exchangeEnabled) {
    return 'Please enable Exchange market type'
  }
  return null
}

/** `UpsertSportsAutoResultsSettings`'s input, keys in the legacy order; Bookmaker and Fancy are sent off
 *  for any sport but cricket. */
export function buildAutoResultsInput(input: {
  sportId?: string
  leagueId?: string
  eventId?: string
  isCricket: boolean
  toggles: MarketToggles
}) {
  return {
    sportId: input.sportId,
    leagueId: input.leagueId,
    eventId: input.eventId,
    exchangeEnabled: input.toggles.exchangeEnabled,
    bookmakerEnabled: input.isCricket ? input.toggles.bookmakerEnabled : false,
    fancyEnabled: input.isCricket ? input.toggles.fancyEnabled : false,
  }
}
