/* Sports Events (/sports/events): the page's logic, moved out of EventsPage.tsx, EventsTable.tsx,
   EventCards.tsx and EventsFilters.tsx so it can be tested without React. Every rule below is the legacy
   page's rule unless its comment says otherwise. The page's only GraphQL document stays in
   lib/graphql/sports.ts and its hook stays in EventsPage.tsx. */
import { TZDate } from '@date-fns/tz'
import { ADMIN_TZ, isDateTimeString, istDateTimeToIso } from '@/ui/components/istDate'

/** One row of the RunningEvents answer (lib/graphql/sports.ts). */
export interface SportsEvent {
  id: string
  sport: string
  competition: string
  name: string
  startTime: string
  status: string
  marketCount: number
  totalLiquidity: number
  matchedVolume: number
  betsCount: number
  inPlay: boolean
  updatedAt: string
  lastBetAt?: string | null
}

/**
 * The filters in force. `sport` and `timeRange` travel to the server as the query's `sport`, `from` and
 * `to`; `status` and `competition` filter the answer here. The range is a pair of instants, so the
 * query keeps reading `timeRange[i].toISOString()` exactly as it did when these were dayjs values.
 */
export interface EventsFiltersValues {
  sport?: string
  status?: string
  timeRange?: [Date, Date] | null
  competition?: string
}

export type QuickFilter = 'live' | 'high-liquidity' | 'favorite' | 'starting-soon'

export interface EventOption {
  value: string
  label: string
}

export const HOUR_MS = 3_600_000
/** "High Liquidity" means more than this much liability on the event. */
export const HIGH_LIQUIDITY_ABOVE = 100_000

export const QUICK_FILTERS: readonly { value: QuickFilter; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'high-liquidity', label: 'High Liquidity' },
  { value: 'favorite', label: 'Favorite' },
  { value: 'starting-soon', label: 'Starting Soon' },
]

export function isQuickFilter(value: unknown): value is QuickFilter {
  return QUICK_FILTERS.some((filter) => filter.value === value)
}

export const EVENT_SPORT_OPTIONS: readonly EventOption[] = [
  { label: 'Cricket', value: 'Cricket' },
  { label: 'Football', value: 'Football' },
  { label: 'Tennis', value: 'Tennis' },
  { label: 'Basketball', value: 'Basketball' },
  { label: 'Horse Racing', value: 'Horse Racing' },
]

/* The statuses runningEvents reports: upcoming, in_play or finished (admin-backend sportsRepo). The list
 * offered Suspended and Closed, which no event ever has, so either one emptied the table while the table
 * itself showed FINISHED events. */
export const EVENT_STATUS_OPTIONS: readonly EventOption[] = [
  { label: 'In-Play', value: 'inplay' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Finished', value: 'finished' },
]

/**
 * The competitions of the loaded events, each once, by name. The filter compares an event's competition
 * (its league name) with the choice, and the list was a fixed IPL / EPL / Wimbledon / NBA whose codes
 * matched no league, so any choice emptied the table.
 */
export function eventCompetitionOptions(events: readonly Pick<SportsEvent, 'competition'>[]): EventOption[] {
  const names = [...new Set(events.map((event) => event.competition).filter(Boolean))]
  return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ label: name, value: name }))
}

/* ---------- filtering and figures ---------- */

export function matchesEventSearch(event: SportsEvent, searchQuery: string): boolean {
  return (
    !searchQuery ||
    event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    event.competition.toLowerCase().includes(searchQuery.toLowerCase())
  )
}

/** In-Play means in play; Upcoming means active and not in play; anything else matches the raw status. */
export function matchesEventStatus(event: SportsEvent, status: string | undefined): boolean {
  return (
    !status ||
    (status === 'inplay' && event.inPlay) ||
    (status === 'upcoming' && !event.inPlay && event.status === 'active') ||
    event.status === status
  )
}

export function matchesQuickFilter(
  event: SportsEvent,
  quickFilter: QuickFilter | null,
  isFavorite: (eventId: string) => boolean,
  now: number,
): boolean {
  if (!quickFilter) return true
  switch (quickFilter) {
    case 'live':
      return event.inPlay
    case 'high-liquidity':
      return event.totalLiquidity > HIGH_LIQUIDITY_ABOVE
    case 'favorite':
      return isFavorite(event.id)
    case 'starting-soon': {
      const timeUntilStart = new Date(event.startTime).getTime() - now
      return !event.inPlay && event.status !== 'finished' && timeUntilStart > 0 && timeUntilStart < HOUR_MS
    }
    default:
      return true
  }
}

export interface EventsFilterInput {
  searchQuery: string
  filters: EventsFiltersValues
  quickFilter: QuickFilter | null
  isFavorite: (eventId: string) => boolean
  now: number
}

export function filterEvents(events: readonly SportsEvent[], input: EventsFilterInput): SportsEvent[] {
  const { searchQuery, filters, quickFilter, isFavorite, now } = input
  return events.filter(
    (event) =>
      matchesEventSearch(event, searchQuery) &&
      matchesEventStatus(event, filters.status) &&
      (!filters.competition || event.competition === filters.competition) &&
      matchesQuickFilter(event, quickFilter, isFavorite, now),
  )
}

export interface EventsStats {
  liveEvents: number
  totalLiquidity: number
  totalMatched: number
  totalMarkets: number
  totalBets: number
  /** Events with a bet in the last hour. */
  recentActivity: number
}

export function computeEventsStats(events: readonly SportsEvent[], now: number): EventsStats {
  return {
    liveEvents: events.filter((event) => event.inPlay).length,
    totalLiquidity: events.reduce((sum, event) => sum + (event.totalLiquidity || 0), 0),
    totalMatched: events.reduce((sum, event) => sum + (event.matchedVolume || 0), 0),
    totalMarkets: events.reduce((sum, event) => sum + (event.marketCount || 0), 0),
    totalBets: events.reduce((sum, event) => sum + (event.betsCount || 0), 0),
    recentActivity: events.filter((event) => {
      if (!event.lastBetAt) return false
      return now - new Date(event.lastBetAt).getTime() < HOUR_MS
    }).length,
  }
}

/** Sport, status, competition, range, search and the quick filter, each counted once when set. */
export function countActiveEventFilters(
  filters: EventsFiltersValues,
  searchQuery: string,
  quickFilter: QuickFilter | null,
): number {
  return [
    filters.sport,
    filters.status,
    filters.competition,
    filters.timeRange,
    searchQuery,
    quickFilter,
  ].filter(Boolean).length
}

export type FormatAmount = (amount: number, currencyCode?: string) => string

/** An amount already converted to the display currency, with the legacy K and M short forms. */
export function formatCompactAmount(converted: number, symbol: string, formatAmount: FormatAmount): string {
  if (converted >= 1_000_000) return `${symbol}${(converted / 1_000_000).toFixed(1)}M`
  if (converted >= 1000) return `${symbol}${(converted / 1000).toFixed(1)}K`
  return formatAmount(converted, undefined)
}

export function eventCountLabel(count: number): string {
  return `${count} event${count !== 1 ? 's' : ''}`
}

/* ---------- times ---------- */

/** "Just now", "Nm ago", "Nh ago", "Nd ago", then the short date the caller formats. */
export function formatTimeSince(instant: string, now: number, formatShortDate: (instant: string) => string): string {
  const diff = now - new Date(instant).getTime()
  if (diff < 0) return 'Just now'
  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatShortDate(instant)
}

/** Time left before a start that is still ahead: "Nd Nh" past a day, "Nh Nm", or "Nm". */
export function formatCountdown(diff: number): string {
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** The table's start line: Finished, LIVE NOW, Started, or the countdown. */
export function eventTimeUntil(event: SportsEvent, now: number): string {
  if (event.status === 'finished') return 'Finished'
  if (event.inPlay) return 'LIVE NOW'
  const diff = new Date(event.startTime).getTime() - now
  if (diff < 0) return 'Started'
  return formatCountdown(diff)
}

export type EventStartTagKind = 'finished' | 'live' | 'soon' | 'plain'

/** The tag under the table's start time; "soon" is a countdown under an hour (the legacy orange tag). */
export function eventStartTag(event: SportsEvent, now: number): { label: string; kind: EventStartTagKind } {
  if (event.status === 'finished') return { label: 'Finished', kind: 'finished' }
  if (event.inPlay) return { label: 'LIVE NOW', kind: 'live' }
  const label = eventTimeUntil(event, now)
  const start = new Date(event.startTime).getTime()
  const soon = label !== 'Started' && start - now < HOUR_MS && start > now
  return { label, kind: soon ? 'soon' : 'plain' }
}

/** The card's countdown: it has no Finished or LIVE NOW wording of its own. */
export function cardTimeUntil(startTime: string, now: number): string {
  const diff = new Date(startTime).getTime() - now
  if (diff < 0) return 'Started'
  return formatCountdown(diff)
}

/** The card's tag: IN PLAY, or its countdown, flagged under an hour. */
export function cardStartTag(event: SportsEvent, now: number): { label: string; soon: boolean } {
  const timeUntil = cardTimeUntil(event.startTime, now)
  const soon = !event.inPlay && timeUntil !== 'Started' && new Date(event.startTime).getTime() - now < HOUR_MS
  return { label: event.inPlay ? 'IN PLAY' : timeUntil, soon }
}

/* ---------- cells ---------- */

/** Every name, View and View Details control opens the event page. */
export function eventDetailPath(eventId: string): string {
  return `/sports/event/${eventId}`
}

export function marketLevel(marketCount: number): 'High' | 'Medium' | 'Low' {
  if (marketCount > 50) return 'High'
  if (marketCount > 20) return 'Medium'
  return 'Low'
}

export function eventBetsLabel(betsCount: number | null | undefined): string {
  return `${betsCount?.toLocaleString() || 0} bets`
}

export type EventPillTone = 'ok' | 'warn' | 'muted' | 'info' | 'neutral'

/** The table's status pill, toned as the legacy badge was coloured (green, yellow, grey, blue). */
export function eventStatusBadge(event: SportsEvent): { label: string; tone: EventPillTone } {
  if (event.status === 'in_play' || event.inPlay) return { label: 'Live', tone: 'ok' }
  if (event.status === 'suspended') return { label: 'Suspended', tone: 'warn' }
  if (event.status === 'finished') return { label: 'Finished', tone: 'muted' }
  return { label: 'Upcoming', tone: 'info' }
}

/** The card's status pill: the raw status upper-cased, green when active, yellow when suspended. */
export function cardStatusPill(status: string): { label: string; tone: EventPillTone } {
  const tone: EventPillTone = status === 'active' ? 'ok' : status === 'suspended' ? 'warn' : 'neutral'
  return { label: status.toUpperCase(), tone }
}

/** The card's liquidity bar: the matched share of the liability, in four steps. */
export function liquidityHealth(liquidity: number, matched: number): { percent: number; tone: 'acc' | 'warn' | 'neg' } {
  const ratio = liquidity > 0 ? (matched / liquidity) * 100 : 0
  if (ratio > 70) return { percent: 100, tone: 'acc' }
  if (ratio > 50) return { percent: 75, tone: 'acc' }
  if (ratio > 30) return { percent: 50, tone: 'warn' }
  return { percent: 25, tone: 'neg' }
}

/** Sport images keyed by their file name without its extension, lower-cased. */
export function sportIconMapFrom(images: Readonly<Record<string, string>>): Record<string, string> {
  return Object.entries(images).reduce<Record<string, string>>((acc, [path, url]) => {
    const file = path.split('/').pop() || ''
    const base = file.replace(/\.(png|jpg|jpeg|svg|webp)$/i, '').toLowerCase()
    acc[base] = url
    return acc
  }, {})
}

/** "Horse Racing" looks for horse-racing.*, then the generic live image, then nothing. */
export function sportImageSrc(map: Readonly<Record<string, string>>, sport: string): string {
  const sportKey = sport.toLowerCase().replace(/\s+/g, '-')
  return map[sportKey] || map['live'] || ''
}

/* ---------- paging ---------- */

export const EVENT_PAGE_SIZES: readonly number[] = [10, 25, 50, 100]
export const DEFAULT_EVENT_PAGE_SIZE = 25

/** A page past the end (the list shrank under it) reads as the last page. */
export function clampEventsPage(page: number, total: number, pageSize: number): number {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

export function pageOfEvents(events: readonly SportsEvent[], page: number, pageSize: number): SportsEvent[] {
  const start = (page - 1) * pageSize
  return events.slice(start, start + pageSize)
}

/* ---------- the staged Advanced Filters form ---------- */

/** What the form shows before Apply. The two dates are IST `yyyy-MM-ddTHH:mm` calendar values. */
export interface StagedEventFilters {
  sport: string | null
  status: string | null
  competition: string | null
  start: string
  end: string
}

export const EMPTY_STAGED_FILTERS: StagedEventFilters = {
  sport: null,
  status: null,
  competition: null,
  start: '',
  end: '',
}

/** An instant as the IST minute a `datetime-local` field shows. */
export function istDateTimeOf(instant: Date): string {
  const ist = new TZDate(instant, ADMIN_TZ)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}T${pad(ist.getHours())}:${pad(ist.getMinutes())}`
}

/** The form opens on the filters in force. */
export function stagedFromFilters(filters: EventsFiltersValues | undefined): StagedEventFilters {
  const range = filters?.timeRange
  return {
    sport: filters?.sport ?? null,
    status: filters?.status ?? null,
    competition: filters?.competition ?? null,
    start: range ? istDateTimeOf(range[0]) : '',
    end: range ? istDateTimeOf(range[1]) : '',
  }
}

export interface StagedRangeErrors {
  start?: string
  end?: string
}

/** The range applies whole or not at all, and never backwards (the antd range picker could not hold either). */
export function stagedRangeErrors(staged: Pick<StagedEventFilters, 'start' | 'end'>): StagedRangeErrors {
  const { start, end } = staged
  if (!start && !end) return {}
  const errors: StagedRangeErrors = {}
  if (start && !isDateTimeString(start)) errors.start = 'Enter a valid start date'
  if (end && !isDateTimeString(end)) errors.end = 'Enter a valid end date'
  if (errors.start || errors.end) return errors
  if (!start) return { start: 'Choose a start date' }
  if (!end) return { end: 'Choose an end date' }
  if (end < start) return { end: 'The end date is before the start date' }
  return {}
}

/**
 * Apply sends every field, an empty one as undefined, in the legacy form's field order (antd onFinish
 * passed all four). Call only when stagedRangeErrors finds nothing.
 */
export function filtersFromStaged(staged: StagedEventFilters): EventsFiltersValues {
  return {
    sport: staged.sport || undefined,
    status: staged.status || undefined,
    timeRange:
      staged.start && staged.end
        ? [new Date(istDateTimeToIso(staged.start)), new Date(istDateTimeToIso(staged.end))]
        : undefined,
    competition: staged.competition || undefined,
  }
}

export type EventFilterPreset = 'live-now' | 'next-24h' | 'cricket-only'

export const EVENT_FILTER_PRESETS: readonly { value: EventFilterPreset; label: string }[] = [
  { value: 'live-now', label: 'Live Now' },
  { value: 'next-24h', label: 'Next 24h' },
  { value: 'cricket-only', label: 'Cricket Only' },
]

/**
 * A preset applies its one filter on its own, replacing every other filter in force, exactly as before;
 * the form now shows just that filter too (it used to keep showing fields the preset had dropped).
 */
export function eventFilterPreset(
  preset: EventFilterPreset,
  now: number,
): { applied: EventsFiltersValues; staged: StagedEventFilters } {
  if (preset === 'live-now') {
    return { applied: { status: 'inplay' }, staged: { ...EMPTY_STAGED_FILTERS, status: 'inplay' } }
  }
  if (preset === 'cricket-only') {
    return { applied: { sport: 'Cricket' }, staged: { ...EMPTY_STAGED_FILTERS, sport: 'Cricket' } }
  }
  const range: [Date, Date] = [new Date(now), new Date(now + 24 * HOUR_MS)]
  return {
    applied: { timeRange: range },
    staged: { ...EMPTY_STAGED_FILTERS, start: istDateTimeOf(range[0]), end: istDateTimeOf(range[1]) },
  }
}
