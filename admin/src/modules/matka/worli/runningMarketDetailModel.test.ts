import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BET_TYPE_OPTIONS,
  BOOK_SORT_OPTIONS,
  actionErrorText,
  activityStyle,
  badgeCount,
  betStatusTone,
  bettingNote,
  bookBidTypes,
  canVoidBet,
  sessionControlEnabled,
  worliBetsCsv,
  worliBetsCsvName,
  clampPage,
  exposureLevel,
  exposureLevelTone,
  filterBets,
  filterBookGroups,
  formatRate,
  formatStatisticValue,
  instanceView,
  isBookSort,
  isSessionNotFound,
  isValidInstanceId,
  loadErrorText,
  operatorActionTitle,
  pageRows,
  parseSuspendMinutes,
  plSign,
  prependLiveBet,
  reasonError,
  sessionFigures,
  sessionStatusTone,
  shortId,
  shortUserId,
  statusCountdown,
  summaryStatusTone,
  topRiskSelections,
  type WorliBet,
  type WorliBook,
} from './runningMarketDetailModel'

const UUID = '3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f'

describe('the route id and the page state', () => {
  test('a session id is a UUID in either case; "running", blanks and other strings are not', () => {
    assert.equal(isValidInstanceId(UUID), true)
    assert.equal(isValidInstanceId(UUID.toUpperCase()), true)
    assert.equal(isValidInstanceId('running'), false)
    assert.equal(isValidInstanceId(''), false)
    assert.equal(isValidInstanceId(undefined), false)
    assert.equal(isValidInstanceId('123'), false)
    assert.equal(isValidInstanceId(`${UUID}0`), false)
  })

  test('the page is loading, failed, not found or ready', () => {
    const base = { isValidId: true, loading: false, hasError: false, hasData: false, hasInstance: false }
    assert.equal(instanceView({ ...base, loading: true }), 'loading')
    assert.equal(instanceView({ ...base, isValidId: false }), 'loading')
    assert.equal(instanceView({ ...base, hasError: true }), 'error')
    assert.equal(instanceView({ ...base, hasData: true }), 'not-found')
    assert.equal(instanceView({ ...base, loading: true, hasData: true }), 'loading')
    assert.equal(instanceView({ ...base, hasInstance: true, hasError: true }), 'ready')
    assert.equal(loadErrorText('Network down'), 'Failed to load market details: Network down')
    assert.equal(loadErrorText(undefined), 'Failed to load market details: Unknown error')
    assert.equal(shortId(UUID), '3f2b8c1e...')
  })

  test("the server's 'Market session not found' is a not-found, not a failure; any other error still fails", () => {
    // admin-backend answers an id with no session in this whitelabel with that error, not with null.
    const failed = { isValidId: true, loading: false, hasError: true, hasData: false, hasInstance: false }
    assert.equal(instanceView({ ...failed, errorMessage: 'Market session not found' }), 'not-found')
    assert.equal(instanceView({ ...failed, errorMessage: '  Market session not found ' }), 'not-found')
    assert.equal(instanceView({ ...failed, errorMessage: 'Network down' }), 'error')
    assert.equal(instanceView({ ...failed, errorMessage: 'Select a whitelabel to view and manage Worli sessions' }), 'error')
    assert.equal(instanceView({ ...failed, errorMessage: 'Forbidden' }), 'error')
    assert.equal(instanceView({ ...failed, errorMessage: 'Market session not found: lookup timed out' }), 'error')
    assert.equal(instanceView({ ...failed, errorMessage: undefined }), 'error')
    assert.equal(instanceView(failed), 'error')
    // A session that is there wins, and a bad id still waits for its redirect.
    assert.equal(instanceView({ ...failed, hasInstance: true, errorMessage: 'Market session not found' }), 'ready')
    assert.equal(instanceView({ ...failed, isValidId: false, errorMessage: 'Market session not found' }), 'loading')
    assert.equal(isSessionNotFound('Market session not found'), true)
    assert.equal(isSessionNotFound(null), false)
    assert.equal(isSessionNotFound(''), false)
  })
})

describe('figures', () => {
  test('counters become major units with the legacy fallbacks', () => {
    assert.deepEqual(
      sessionFigures({
        counters: {
          betCount: 4,
          totalStakeMinor: 123450,
          exposureTotalMinor: 6000000,
          worstOutcomeKey: '128',
          worstOutcomePlMinor: -250050,
        },
      }),
      {
        betCount: 4,
        totalStake: 1234.5,
        exposure: 60000,
        worstOutcome: '128',
        worstPL: -2500.5,
        level: 'warning',
        exposurePercent: 40,
        averageStake: 308.625,
      },
    )
    assert.deepEqual(sessionFigures({ counters: null }), {
      betCount: 0,
      totalStake: 0,
      exposure: 0,
      worstOutcome: '-',
      worstPL: 0,
      level: 'healthy',
      exposurePercent: 0,
      averageStake: 0,
    })
    assert.equal(sessionFigures({ counters: { exposureTotalMinor: 30000000 } }).exposurePercent, 100)
  })

  test('exposure levels and their tones keep the legacy thresholds', () => {
    assert.equal(exposureLevel(100000.01), 'critical')
    assert.equal(exposureLevel(100000), 'warning')
    assert.equal(exposureLevel(50000.01), 'warning')
    assert.equal(exposureLevel(50000), 'healthy')
    assert.deepEqual(exposureLevelTone('critical'), { pill: 'neg', meter: 'neg' })
    assert.deepEqual(exposureLevelTone('warning'), { pill: 'warn', meter: 'warn' })
    assert.deepEqual(exposureLevelTone('healthy'), { pill: 'ok', meter: 'acc' })
  })

  test('statistic values format exactly as antd Statistic did: groups, cut decimals, odd values as given', () => {
    assert.equal(formatStatisticValue(0), '0')
    assert.equal(formatStatisticValue(1234567), '1,234,567')
    assert.equal(formatStatisticValue(1234.5, 2), '1,234.50')
    assert.equal(formatStatisticValue(0.129, 2), '0.12')
    assert.equal(formatStatisticValue(12.9, 0), '12')
    assert.equal(formatStatisticValue(-1234.5), '-1,234.5')
    assert.equal(formatStatisticValue(1e21, 2), '1e+21')
    assert.equal(formatStatisticValue('-'), '-')
    assert.equal(plSign(-0.01), '-')
    assert.equal(plSign(0), '+')
    assert.equal(plSign(5), '+')
  })

  test('status tones follow each legacy tag', () => {
    const statuses = ['OPEN', 'LOCKED', 'PAUSED', 'SETTLED', null]
    assert.deepEqual(statuses.map(sessionStatusTone), ['ok', 'warn', 'neg', 'neutral', 'neutral'])
    assert.deepEqual(statuses.map(summaryStatusTone), ['ok', 'warn', 'neutral', 'neutral', 'neutral'])
    assert.deepEqual(['ACTIVE', 'VOID', 'WON', null].map(betStatusTone), ['ok', 'neg', 'neutral', 'neutral'])
    // The API sends bet statuses lower-case.
    assert.deepEqual(['active', 'void', 'won'].map(betStatusTone), ['ok', 'neg', 'neutral'])
  })
})

describe('the status countdown', () => {
  const NOW = Date.parse('2026-10-07T06:00:00.000Z')
  const at = (ms: number) => new Date(NOW + ms).toISOString()

  test('OPEN counts to the lock, LOCKED and OPENING_SOON to the close', () => {
    assert.deepEqual(statusCountdown('OPEN', at(3723000), at(1), NOW), { text: '01:02:03', urgent: false })
    assert.deepEqual(statusCountdown('LOCKED', at(1), at(299500), NOW), { text: '00:04:59', urgent: true })
    assert.deepEqual(statusCountdown('OPENING_SOON', null, at(600000), NOW), { text: '00:10:00', urgent: false })
    assert.deepEqual(statusCountdown('OPEN', at(360000000), null, NOW), { text: '100:00:00', urgent: false })
  })

  test('a passed time reads zero and is not urgent; other statuses, missing and broken times show none', () => {
    assert.deepEqual(statusCountdown('OPEN', at(-5000), null, NOW), { text: '00:00:00', urgent: false })
    assert.equal(statusCountdown('SETTLED', at(1000), at(1000), NOW), null)
    assert.equal(statusCountdown('OPEN', null, at(1000), NOW), null)
    assert.equal(statusCountdown('LOCKED', at(1000), 'not a date', NOW), null)
  })
})

describe('live bets, the book and the bets', () => {
  test('a new live bet goes first and the feed keeps ten', () => {
    const feed = Array.from({ length: 10 }, (_, index) => ({ id: `b${index}` }))
    const next = prependLiveBet(feed, { id: 'new' })
    assert.equal(next.length, 10)
    assert.equal(next[0].id, 'new')
    assert.equal(next[9].id, 'b8')
    assert.deepEqual(prependLiveBet([], { id: 'only' }).map((bet) => bet.id), ['only'])
  })

  const BOOK: WorliBook = {
    totalStakeMinor: 500000,
    groups: [
      {
        bidType: 'SINGLE',
        items: [
          { selection: '1', betCount: 2, plMinor: -5000 },
          { selection: '2', betCount: 9, plMinor: 300 },
          { selection: '12', betCount: 1, plMinor: -90000 },
        ],
      },
      {
        bidType: 'JODI',
        items: [
          { selection: '21', betCount: 4, plMinor: -100 },
          { selection: '33', betCount: 0, plMinor: 0 },
          { selection: '45', betCount: 3, plMinor: -700 },
          { selection: '67', betCount: 5, plMinor: -60000 },
        ],
      },
    ],
  }

  test('the book filters by type and selection text, then sorts', () => {
    const selections = (groups: ReturnType<typeof filterBookGroups>) =>
      groups.map((g) => [g.bidType, g.items.map((i) => i.selection)])
    assert.deepEqual(selections(filterBookGroups(BOOK, { query: '', sort: 'default', selectedType: 'all' })), [
      ['SINGLE', ['1', '2', '12']],
      ['JODI', ['21', '33', '45', '67']],
    ])
    assert.deepEqual(selections(filterBookGroups(BOOK, { query: ' 2 ', sort: 'default', selectedType: 'all' })), [
      ['SINGLE', ['2', '12']],
      ['JODI', ['21']],
    ])
    assert.deepEqual(selections(filterBookGroups(BOOK, { query: '', sort: 'pl:asc', selectedType: 'JODI' })), [
      ['JODI', ['67', '45', '21', '33']],
    ])
    assert.deepEqual(selections(filterBookGroups(BOOK, { query: '', sort: 'pl:desc', selectedType: 'SINGLE' })), [
      ['SINGLE', ['2', '1', '12']],
    ])
    assert.deepEqual(selections(filterBookGroups(BOOK, { query: '', sort: 'bets:desc', selectedType: 'SINGLE' })), [
      ['SINGLE', ['2', '1', '12']],
    ])
    assert.deepEqual(filterBookGroups(null, { query: '', sort: 'default', selectedType: 'all' }), [])
    assert.deepEqual(bookBidTypes(BOOK), ['SINGLE', 'JODI'])
    assert.deepEqual(bookBidTypes(undefined), [])
    // The source book is not reordered.
    assert.deepEqual(BOOK.groups[1].items.map((i) => i.selection), ['21', '33', '45', '67'])
  })

  test('the top risks are the five biggest losses, worst first, with their bid type', () => {
    assert.deepEqual(
      topRiskSelections(BOOK).map((i) => [i.bidType, i.selection, i.plMinor]),
      [
        ['SINGLE', '12', -90000],
        ['JODI', '67', -60000],
        ['SINGLE', '1', -5000],
        ['JODI', '45', -700],
        ['JODI', '21', -100],
      ],
    )
    assert.deepEqual(topRiskSelections(null), [])
  })

  test('sort options, bid types and the small badge are the legacy ones', () => {
    assert.deepEqual(BOOK_SORT_OPTIONS.map((o) => [o.value, o.label]), [
      ['default', 'Series Order'],
      ['bets:desc', 'Most Bets'],
      ['pl:desc', 'PL High → Low'],
      ['pl:asc', 'PL Low → High'],
    ])
    assert.equal(isBookSort('pl:asc'), true)
    assert.equal(isBookSort('name'), false)
    assert.deepEqual(BET_TYPE_OPTIONS.map((o) => o.value), ['', 'SINGLE', 'JODI', 'SP', 'DP', 'TP', 'HS', 'FS'])
    assert.equal(BET_TYPE_OPTIONS[3].label, 'Single Patti')
    assert.equal(badgeCount(0), '0')
    assert.equal(badgeCount(99), '99')
    assert.equal(badgeCount(100), '99+')
  })

  test('the bets search matches the user id, selection or bid type, case-insensitively', () => {
    const bets: WorliBet[] = [
      { id: '1', userId: 'ABCDEF12-x', betNumbers: '123', bidType: 'SP' },
      { id: '2', userId: 'zzz', betNumbers: '45', bidType: 'JODI' },
      { id: '3', userId: null, betNumbers: null, bidType: null },
    ]
    assert.deepEqual(filterBets(bets, '').map((b) => b.id), ['1', '2', '3'])
    assert.deepEqual(filterBets(bets, '   ').map((b) => b.id), ['1', '2', '3'])
    assert.deepEqual(filterBets(bets, 'abcdef').map((b) => b.id), ['1'])
    assert.deepEqual(filterBets(bets, 'jodi').map((b) => b.id), ['2'])
    assert.deepEqual(filterBets(bets, '4').map((b) => b.id), ['2'])
    // The query is not trimmed once it is not blank.
    assert.deepEqual(filterBets(bets, ' 45').map((b) => b.id), [])
  })

  test('rates, short ids and paging', () => {
    assert.equal(formatRate(9), '9.00x')
    assert.equal(formatRate('9.5'), '9.50x')
    assert.equal(shortUserId('abcdefghijkl'), 'abcdefgh...')
    assert.equal(shortUserId(null), '...')
    assert.equal(clampPage(9, 41, 20), 3)
    assert.deepEqual(pageRows([1, 2, 3], 2, 2), [3])
  })
})

describe('activity and operator controls', () => {
  test('each action keeps its legacy colour on a tone and a ramp step', () => {
    assert.deepEqual(
      ['PAUSE', 'RESUME', 'LOCK', 'CLOSE', 'MESSAGE', 'SUSPEND_ADJUST', 'OTHER'].map(activityStyle),
      [
        { tone: 'warn', hue: 'amb' },
        { tone: 'ok', hue: 'grn' },
        { tone: 'neg', hue: 'red' },
        { tone: 'neutral', hue: 'vio' },
        { tone: 'info', hue: 'blu' },
        { tone: 'info', hue: 'ind' },
        { tone: 'neutral', hue: 'none' },
      ],
    )
  })

  test('confirm titles, the suspend minutes parse and the required reason', () => {
    assert.equal(operatorActionTitle('PAUSE'), 'Confirm PAUSE')
    assert.equal(operatorActionTitle(null), 'Confirm ')
    assert.deepEqual(['5', '', 'abc', '7.9', '-3', ' 12', '12abc'].map(parseSuspendMinutes), [5, 0, 0, 7, -3, 12, 12])
    assert.equal(reasonError(''), 'Please input a reason')
    assert.equal(reasonError(' '), undefined)
    assert.equal(reasonError('ok'), undefined)
    assert.equal(actionErrorText(new Error('Not allowed')), 'Not allowed')
    assert.equal(actionErrorText('x'), 'The action could not be completed. Please try again.')
  })
})

describe('what the session allows', () => {
  test('the Total Bets note follows the status, not the bet count', () => {
    assert.deepEqual(bettingNote('OPEN', 3), { label: 'Live', tone: 'ok', text: 'Active betting', open: true })
    assert.deepEqual(bettingNote('OPEN', 0), { label: 'Idle', tone: 'neutral', text: 'Active betting', open: true })
    assert.deepEqual(bettingNote('PAUSED', 3), { label: 'Paused', tone: 'warn', text: 'Betting paused', open: false })
    assert.deepEqual(bettingNote('SCHEDULED', 0), { label: 'Upcoming', tone: 'neutral', text: 'Betting not open yet', open: false })
    for (const status of ['LOCKED', 'CLOSED', 'SETTLED']) assert.deepEqual(bettingNote(status, 3), { label: 'Closed', tone: 'neutral', text: 'Betting closed', open: false })
  })

  test('controls that can no longer change the session are off; an unknown status leaves them on', () => {
    const controls = ['PAUSE', 'RESUME', 'LOCK', 'CLOSE', 'MESSAGE', 'SUSPEND_ADJUST'] as const
    const row = (status: string | null) => controls.map((control) => sessionControlEnabled(status, control))
    assert.deepEqual(row('OPEN'), [true, false, true, true, true, true])
    assert.deepEqual(row('PAUSED'), [false, true, true, true, true, true])
    assert.deepEqual(row('LOCKED'), [false, false, false, true, true, true])
    assert.deepEqual(row('CLOSED'), [false, false, false, false, true, true])
    assert.deepEqual(row('SETTLED'), [false, false, false, false, false, false])
    assert.deepEqual(row(null), [true, true, true, true, true, true])
  })

  test('only pending and active bets can be voided, in either case', () => {
    assert.deepEqual(['pending', 'active', 'ACTIVE', 'won', 'lost', 'void', 'cancelled', null].map(canVoidBet), [true, true, true, false, false, false, false, false])
  })

  test('the bets CSV quotes every cell and keeps the API amounts', () => {
    const csv = worliBetsCsv([
      { id: 'b1', userId: '42', bidType: 'SINGLE', betNumbers: '5', betAmount: 10, payoutMultiplier: 9.5, potentialWin: 95, status: 'active', currency: 'INR', createdAt: '2026-11-03T00:00:00.000Z' },
      { id: 'b"2', userId: null, bidType: 'JODI', betNumbers: '05', betAmount: '20.50', payoutMultiplier: 90, potentialWin: null, status: 'void', currency: 'INR', createdAt: null },
    ])
    assert.deepEqual(csv.split('\n'), [
      '"Bet ID","User ID","Bid Type","Selection","Stake","Rate","Potential Win","Status","Currency","Placed At"',
      '"b1","42","SINGLE","5","10","9.5","95","active","INR","2026-11-03T00:00:00.000Z"',
      '"b""2","","JODI","05","20.50","90","","void","INR",""',
    ])
    assert.equal(worliBetsCsvName('3f2b8c1e-9a4d-4e6b-8c2f-1a2b3c4d5e6f'), 'worli-bets-3f2b8c1e.csv')
  })
})
