/**
 * The Sports Events page's rules, moved verbatim out of the legacy page and its components: search, status
 * and quick filters, the header figures, the K/M amounts, the countdowns and tags, the cell rules, paging,
 * and the staged Advanced Filters form (IST date-times, the range check, Apply's payload and the presets).
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DEFAULT_EVENT_PAGE_SIZE,
  EMPTY_STAGED_FILTERS,
  EVENT_COMPETITION_OPTIONS,
  EVENT_FILTER_PRESETS,
  EVENT_PAGE_SIZES,
  EVENT_SPORT_OPTIONS,
  EVENT_STATUS_OPTIONS,
  HOUR_MS,
  QUICK_FILTERS,
  cardStartTag,
  cardStatusPill,
  cardTimeUntil,
  clampEventsPage,
  computeEventsStats,
  countActiveEventFilters,
  eventBetsLabel,
  eventCountLabel,
  eventDetailPath,
  eventFilterPreset,
  eventStartTag,
  eventStatusBadge,
  eventTimeUntil,
  filterEvents,
  filtersFromStaged,
  formatCompactAmount,
  formatCountdown,
  formatTimeSince,
  isQuickFilter,
  istDateTimeOf,
  liquidityHealth,
  marketLevel,
  matchesEventSearch,
  matchesEventStatus,
  matchesQuickFilter,
  pageOfEvents,
  sportIconMapFrom,
  sportImageSrc,
  stagedFromFilters,
  stagedRangeErrors,
  type SportsEvent,
} from './eventsPageModel'

// 2026-10-07 17:30 IST
const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000

function sportsEvent(overrides: Partial<SportsEvent> = {}): SportsEvent {
  return {
    id: 'e1',
    sport: 'Cricket',
    competition: 'IPL',
    name: 'India vs Australia',
    startTime: new Date(NOW + 2 * HOUR_MS).toISOString(),
    status: 'active',
    marketCount: 12,
    totalLiquidity: 50_000,
    matchedVolume: 20_000,
    betsCount: 40,
    inPlay: false,
    updatedAt: new Date(NOW - HOUR_MS).toISOString(),
    lastBetAt: null,
    ...overrides,
  }
}

const never = () => false
const formatAmount = (amount: number, currency?: string) => `fmt(${amount},${String(currency)})`

describe('filters', () => {
  test('search matches the name or the competition, ignoring case', () => {
    const event = sportsEvent()
    assert.equal(matchesEventSearch(event, ''), true)
    assert.equal(matchesEventSearch(event, 'australia'), true)
    assert.equal(matchesEventSearch(event, 'ipl'), true)
    assert.equal(matchesEventSearch(event, 'Football'), false, 'the sport is not searched')
  })

  test('status: In-Play, Upcoming (active, not in play) or the raw status', () => {
    const live = sportsEvent({ inPlay: true })
    const upcoming = sportsEvent()
    const suspended = sportsEvent({ status: 'suspended' })
    const closed = sportsEvent({ status: 'closed' })
    assert.equal(matchesEventStatus(suspended, undefined), true)
    assert.deepEqual([live, upcoming, suspended, closed].map((e) => matchesEventStatus(e, 'inplay')), [true, false, false, false])
    assert.deepEqual([live, upcoming, suspended, closed].map((e) => matchesEventStatus(e, 'upcoming')), [false, true, false, false])
    assert.deepEqual([live, upcoming, suspended, closed].map((e) => matchesEventStatus(e, 'suspended')), [false, false, true, false])
    assert.deepEqual([live, upcoming, suspended, closed].map((e) => matchesEventStatus(e, 'closed')), [false, false, false, true])
  })

  test('quick filters: live, more than 100,000 liability, favourites, and a start within the hour', () => {
    assert.equal(matchesQuickFilter(sportsEvent(), null, never, NOW), true)
    assert.equal(matchesQuickFilter(sportsEvent({ inPlay: true }), 'live', never, NOW), true)
    assert.equal(matchesQuickFilter(sportsEvent(), 'live', never, NOW), false)
    assert.equal(matchesQuickFilter(sportsEvent({ totalLiquidity: 100_000 }), 'high-liquidity', never, NOW), false)
    assert.equal(matchesQuickFilter(sportsEvent({ totalLiquidity: 100_001 }), 'high-liquidity', never, NOW), true)
    assert.equal(matchesQuickFilter(sportsEvent({ id: 'fav' }), 'favorite', (id) => id === 'fav', NOW), true)
    assert.equal(matchesQuickFilter(sportsEvent(), 'favorite', never, NOW), false)
    const startingIn = (ms: number, overrides: Partial<SportsEvent> = {}) =>
      sportsEvent({ startTime: new Date(NOW + ms).toISOString(), ...overrides })
    assert.equal(matchesQuickFilter(startingIn(59 * MINUTE), 'starting-soon', never, NOW), true)
    assert.equal(matchesQuickFilter(startingIn(HOUR_MS), 'starting-soon', never, NOW), false)
    assert.equal(matchesQuickFilter(startingIn(0), 'starting-soon', never, NOW), false)
    assert.equal(matchesQuickFilter(startingIn(10 * MINUTE, { inPlay: true }), 'starting-soon', never, NOW), false)
    assert.equal(matchesQuickFilter(startingIn(10 * MINUTE, { status: 'finished' }), 'starting-soon', never, NOW), false)
  })

  test('filterEvents keeps the order and needs every rule to pass', () => {
    const events = [
      sportsEvent({ id: 'a', competition: 'IPL', inPlay: true }),
      sportsEvent({ id: 'b', competition: 'EPL', name: 'Man City vs Arsenal', inPlay: true }),
      sportsEvent({ id: 'c', competition: 'IPL' }),
    ]
    const ids = (list: SportsEvent[]) => list.map((e) => e.id)
    const base = { searchQuery: '', filters: {}, quickFilter: null, isFavorite: never, now: NOW }
    assert.deepEqual(ids(filterEvents(events, base)), ['a', 'b', 'c'])
    assert.deepEqual(ids(filterEvents(events, { ...base, filters: { competition: 'IPL' } })), ['a', 'c'])
    assert.deepEqual(ids(filterEvents(events, { ...base, filters: { competition: 'IPL' }, quickFilter: 'live' })), ['a'])
    assert.deepEqual(ids(filterEvents(events, { ...base, searchQuery: 'city' })), ['b'])
    assert.deepEqual(ids(filterEvents(events, { ...base, filters: { status: 'upcoming' } })), ['c'])
  })

  test('the active count takes each set filter, the search and the quick filter once', () => {
    assert.equal(countActiveEventFilters({}, '', null), 0)
    const range: [Date, Date] = [new Date(NOW), new Date(NOW + HOUR_MS)]
    assert.equal(
      countActiveEventFilters({ sport: 'Cricket', status: 'inplay', competition: 'IPL', timeRange: range }, 'ind', 'live'),
      6,
    )
    assert.equal(countActiveEventFilters({ sport: undefined, timeRange: null }, '', null), 0)
  })

  test('quick filter and option lists keep the legacy labels and order', () => {
    assert.deepEqual(QUICK_FILTERS.map((f) => f.label), ['Live', 'High Liquidity', 'Favorite', 'Starting Soon'])
    assert.equal(isQuickFilter('favorite'), true)
    assert.equal(isQuickFilter('none'), false)
    assert.deepEqual(EVENT_SPORT_OPTIONS.map((o) => o.value), ['Cricket', 'Football', 'Tennis', 'Basketball', 'Horse Racing'])
    assert.deepEqual(EVENT_STATUS_OPTIONS.map((o) => [o.value, o.label]), [
      ['inplay', 'In-Play'],
      ['upcoming', 'Upcoming'],
      ['suspended', 'Suspended'],
      ['closed', 'Closed'],
    ])
    assert.deepEqual(EVENT_COMPETITION_OPTIONS.map((o) => [o.value, o.label]), [
      ['IPL', 'IPL - Indian Premier League'],
      ['EPL', 'EPL - English Premier League'],
      ['Wimbledon', 'Wimbledon Championships'],
      ['NBA', 'NBA - National Basketball'],
    ])
  })
})

describe('figures', () => {
  test('the header figures over the filtered events', () => {
    const events = [
      sportsEvent({ inPlay: true, totalLiquidity: 1000, matchedVolume: 10, marketCount: 3, betsCount: 7, lastBetAt: new Date(NOW - 5 * MINUTE).toISOString() }),
      sportsEvent({ totalLiquidity: 500, matchedVolume: 5, marketCount: 2, betsCount: 1, lastBetAt: new Date(NOW - HOUR_MS).toISOString() }),
      sportsEvent({ totalLiquidity: 0, matchedVolume: 0, marketCount: 0, betsCount: 0 }),
    ]
    assert.deepEqual(computeEventsStats(events, NOW), {
      liveEvents: 1,
      totalLiquidity: 1500,
      totalMatched: 15,
      totalMarkets: 5,
      totalBets: 8,
      recentActivity: 1,
    })
    assert.deepEqual(computeEventsStats([], NOW), {
      liveEvents: 0,
      totalLiquidity: 0,
      totalMatched: 0,
      totalMarkets: 0,
      totalBets: 0,
      recentActivity: 0,
    })
  })

  test('amounts shorten to K and M, with one decimal, and fall back to formatAmount below 1,000', () => {
    assert.equal(formatCompactAmount(999, '₹', formatAmount), 'fmt(999,undefined)')
    assert.equal(formatCompactAmount(1000, '₹', formatAmount), '₹1.0K')
    assert.equal(formatCompactAmount(150_000, '₹', formatAmount), '₹150.0K')
    assert.equal(formatCompactAmount(999_999, '₹', formatAmount), '₹1000.0K', 'the legacy boundary, kept')
    assert.equal(formatCompactAmount(1_240_000, 'AED ', formatAmount), 'AED 1.2M')
  })

  test('counts and labels', () => {
    assert.equal(eventCountLabel(0), '0 events')
    assert.equal(eventCountLabel(1), '1 event')
    assert.equal(eventCountLabel(25), '25 events')
    assert.equal(eventBetsLabel(1234), '1,234 bets')
    assert.equal(eventBetsLabel(0), '0 bets')
    assert.equal(eventBetsLabel(null), '0 bets')
    assert.deepEqual([20, 21, 50, 51].map(marketLevel), ['Low', 'Medium', 'Medium', 'High'])
    assert.equal(eventDetailPath('evt-9'), '/sports/event/evt-9')
  })
})

describe('times', () => {
  test('time since: Just now, minutes, hours, days, then the short date', () => {
    const at = (ms: number) => new Date(NOW - ms).toISOString()
    const shortDate = (instant: string) => `short(${instant})`
    assert.equal(formatTimeSince(at(-MINUTE), NOW, shortDate), 'Just now', 'a time in the future')
    assert.equal(formatTimeSince(at(30_000), NOW, shortDate), 'Just now')
    assert.equal(formatTimeSince(at(5 * MINUTE), NOW, shortDate), '5m ago')
    assert.equal(formatTimeSince(at(3 * HOUR_MS), NOW, shortDate), '3h ago')
    assert.equal(formatTimeSince(at(50 * HOUR_MS), NOW, shortDate), '2d ago')
    assert.equal(formatTimeSince(at(8 * 24 * HOUR_MS), NOW, shortDate), `short(${at(8 * 24 * HOUR_MS)})`)
  })

  test('countdowns: minutes, hours and minutes, then days and hours past a whole day', () => {
    assert.equal(formatCountdown(30 * MINUTE), '30m')
    assert.equal(formatCountdown(2 * HOUR_MS + 5 * MINUTE), '2h 5m')
    assert.equal(formatCountdown(24 * HOUR_MS), '24h 0m', 'a whole day still reads in hours, as before')
    assert.equal(formatCountdown(25 * HOUR_MS), '1d 1h')
    assert.equal(formatCountdown(49 * HOUR_MS + 30 * MINUTE), '2d 1h')
  })

  test('the table start tag: Finished first, then LIVE NOW, Started, or a countdown flagged inside the hour', () => {
    const start = (ms: number) => new Date(NOW + ms).toISOString()
    const finishedLive = sportsEvent({ status: 'finished', inPlay: true })
    assert.equal(eventTimeUntil(finishedLive, NOW), 'Finished')
    assert.deepEqual(eventStartTag(finishedLive, NOW), { label: 'Finished', kind: 'finished' })
    assert.deepEqual(eventStartTag(sportsEvent({ inPlay: true }), NOW), { label: 'LIVE NOW', kind: 'live' })
    assert.deepEqual(eventStartTag(sportsEvent({ startTime: start(-MINUTE) }), NOW), { label: 'Started', kind: 'plain' })
    assert.deepEqual(eventStartTag(sportsEvent({ startTime: start(30 * MINUTE) }), NOW), { label: '30m', kind: 'soon' })
    assert.deepEqual(eventStartTag(sportsEvent({ startTime: start(HOUR_MS) }), NOW), { label: '1h 0m', kind: 'plain' })
    assert.deepEqual(eventStartTag(sportsEvent({ startTime: start(26 * HOUR_MS) }), NOW), { label: '1d 2h', kind: 'plain' })
  })

  test('the card start tag: IN PLAY, or its own countdown (no Finished), flagged inside the hour', () => {
    const start = (ms: number) => new Date(NOW + ms).toISOString()
    assert.equal(cardTimeUntil(start(-MINUTE), NOW), 'Started')
    assert.deepEqual(cardStartTag(sportsEvent({ inPlay: true, startTime: start(10 * MINUTE) }), NOW), { label: 'IN PLAY', soon: false })
    assert.deepEqual(cardStartTag(sportsEvent({ startTime: start(-MINUTE) }), NOW), { label: 'Started', soon: false })
    assert.deepEqual(cardStartTag(sportsEvent({ startTime: start(20 * MINUTE) }), NOW), { label: '20m', soon: true })
    assert.deepEqual(
      cardStartTag(sportsEvent({ status: 'finished', startTime: start(20 * MINUTE) }), NOW),
      { label: '20m', soon: true },
      'the cards never looked at the finished status',
    )
    assert.deepEqual(cardStartTag(sportsEvent({ startTime: start(2 * HOUR_MS) }), NOW), { label: '2h 0m', soon: false })
  })
})

describe('cells', () => {
  test('the table status pill, toned as the legacy badge was coloured', () => {
    assert.deepEqual(eventStatusBadge(sportsEvent({ status: 'in_play' })), { label: 'Live', tone: 'ok' })
    assert.deepEqual(eventStatusBadge(sportsEvent({ inPlay: true, status: 'suspended' })), { label: 'Live', tone: 'ok' })
    assert.deepEqual(eventStatusBadge(sportsEvent({ status: 'suspended' })), { label: 'Suspended', tone: 'warn' })
    assert.deepEqual(eventStatusBadge(sportsEvent({ status: 'finished' })), { label: 'Finished', tone: 'muted' })
    assert.deepEqual(eventStatusBadge(sportsEvent({ status: 'active' })), { label: 'Upcoming', tone: 'info' })
    assert.deepEqual(eventStatusBadge(sportsEvent({ status: 'closed' })), { label: 'Upcoming', tone: 'info' })
  })

  test('the card status pill: the raw status upper-cased', () => {
    assert.deepEqual(cardStatusPill('active'), { label: 'ACTIVE', tone: 'ok' })
    assert.deepEqual(cardStatusPill('suspended'), { label: 'SUSPENDED', tone: 'warn' })
    assert.deepEqual(cardStatusPill('finished'), { label: 'FINISHED', tone: 'neutral' })
  })

  test('liquidity health: the matched share in four steps', () => {
    assert.deepEqual(liquidityHealth(0, 100), { percent: 25, tone: 'neg' })
    assert.deepEqual(liquidityHealth(100, 80), { percent: 100, tone: 'acc' })
    assert.deepEqual(liquidityHealth(100, 70), { percent: 75, tone: 'acc' })
    assert.deepEqual(liquidityHealth(100, 51), { percent: 75, tone: 'acc' })
    assert.deepEqual(liquidityHealth(100, 50), { percent: 50, tone: 'warn' })
    assert.deepEqual(liquidityHealth(100, 30), { percent: 25, tone: 'neg' })
  })

  test('sport images: keyed by file name, then the live image, then nothing', () => {
    const map = sportIconMapFrom({
      '/src/assets/images/sports/Cricket.PNG': '/assets/cricket.png',
      '/src/assets/images/sports/horse-racing.webp': '/assets/horse.webp',
      '/src/assets/images/sports/live.svg': '/assets/live.svg',
    })
    assert.deepEqual(map, { cricket: '/assets/cricket.png', 'horse-racing': '/assets/horse.webp', live: '/assets/live.svg' })
    assert.equal(sportImageSrc(map, 'Cricket'), '/assets/cricket.png')
    assert.equal(sportImageSrc(map, 'Horse  Racing'), '/assets/horse.webp')
    assert.equal(sportImageSrc(map, 'Kabaddi'), '/assets/live.svg')
    assert.equal(sportImageSrc({}, 'Kabaddi'), '')
  })
})

describe('paging', () => {
  test('25 a page by default, the legacy sizes, and a page past the end reads as the last page', () => {
    assert.equal(DEFAULT_EVENT_PAGE_SIZE, 25)
    assert.deepEqual(EVENT_PAGE_SIZES, [10, 25, 50, 100])
    assert.equal(clampEventsPage(3, 60, 25), 3)
    assert.equal(clampEventsPage(3, 30, 25), 2)
    assert.equal(clampEventsPage(4, 0, 25), 1)
    assert.equal(clampEventsPage(0, 30, 25), 1)
    const events = Array.from({ length: 30 }, (_, index) => sportsEvent({ id: String(index + 1) }))
    assert.deepEqual(pageOfEvents(events, 2, 25).map((e) => e.id), ['26', '27', '28', '29', '30'])
  })
})

describe('the staged Advanced Filters form', () => {
  test('an instant shows as its IST minute, across IST midnight too', () => {
    assert.equal(istDateTimeOf(new Date('2026-10-07T12:00:30.500Z')), '2026-10-07T17:30')
    assert.equal(istDateTimeOf(new Date('2026-10-07T18:45:00.000Z')), '2026-10-08T00:15')
    assert.equal(istDateTimeOf(new Date('2026-12-31T18:30:00.000Z')), '2027-01-01T00:00')
  })

  test('the form opens on the filters in force', () => {
    assert.deepEqual(stagedFromFilters(undefined), EMPTY_STAGED_FILTERS)
    assert.deepEqual(stagedFromFilters({}), EMPTY_STAGED_FILTERS)
    assert.deepEqual(
      stagedFromFilters({
        sport: 'Tennis',
        status: 'suspended',
        competition: 'Wimbledon',
        timeRange: [new Date('2026-10-07T12:00:00.000Z'), new Date('2026-10-08T12:00:00.000Z')],
      }),
      { sport: 'Tennis', status: 'suspended', competition: 'Wimbledon', start: '2026-10-07T17:30', end: '2026-10-08T17:30' },
    )
  })

  test('the range applies whole and in order, or not at all', () => {
    assert.deepEqual(stagedRangeErrors({ start: '', end: '' }), {})
    assert.deepEqual(stagedRangeErrors({ start: '2026-10-07T10:00', end: '' }), { end: 'Choose an end date' })
    assert.deepEqual(stagedRangeErrors({ start: '', end: '2026-10-07T10:00' }), { start: 'Choose a start date' })
    assert.deepEqual(stagedRangeErrors({ start: '2026-10-07T10:00', end: '2026-10-07T09:59' }), {
      end: 'The end date is before the start date',
    })
    assert.deepEqual(stagedRangeErrors({ start: '2026-10-07T10:00', end: '2026-10-07T10:00' }), {}, 'equal ends are allowed')
    assert.deepEqual(stagedRangeErrors({ start: '2026-02-30T10:00', end: '2026-10-07T10:00' }), {
      start: 'Enter a valid start date',
    })
  })

  test('Apply sends every field, empty ones as undefined, the range as IST instants', () => {
    const empty = filtersFromStaged(EMPTY_STAGED_FILTERS)
    assert.deepEqual(Object.keys(empty), ['sport', 'status', 'timeRange', 'competition'])
    assert.deepEqual(empty, { sport: undefined, status: undefined, timeRange: undefined, competition: undefined })
    const full = filtersFromStaged({
      sport: 'Cricket',
      status: 'inplay',
      competition: 'IPL',
      start: '2026-10-07T17:30',
      end: '2026-10-08T00:15',
    })
    assert.equal(full.sport, 'Cricket')
    assert.equal(full.status, 'inplay')
    assert.equal(full.competition, 'IPL')
    assert.deepEqual(full.timeRange?.map((d) => d.toISOString()), ['2026-10-07T12:00:00.000Z', '2026-10-07T18:45:00.000Z'])
  })

  test('each preset applies its one filter alone and stages just that filter', () => {
    assert.deepEqual(EVENT_FILTER_PRESETS.map((p) => p.label), ['Live Now', 'Next 24h', 'Cricket Only'])
    assert.deepEqual(eventFilterPreset('live-now', NOW), {
      applied: { status: 'inplay' },
      staged: { ...EMPTY_STAGED_FILTERS, status: 'inplay' },
    })
    assert.deepEqual(eventFilterPreset('cricket-only', NOW), {
      applied: { sport: 'Cricket' },
      staged: { ...EMPTY_STAGED_FILTERS, sport: 'Cricket' },
    })
    const next = eventFilterPreset('next-24h', NOW + 45_123)
    assert.deepEqual(Object.keys(next.applied), ['timeRange'])
    assert.deepEqual(next.applied.timeRange?.map((d) => d.toISOString()), [
      '2026-10-07T12:00:45.123Z',
      '2026-10-08T12:00:45.123Z',
    ])
    assert.deepEqual(next.staged, { ...EMPTY_STAGED_FILTERS, start: '2026-10-07T17:30', end: '2026-10-08T17:30' })
  })
})
