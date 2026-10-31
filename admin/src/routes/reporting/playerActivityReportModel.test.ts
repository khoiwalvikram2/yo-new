import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DEFAULT_ALLOWED_DOMAINS,
  PLAYER_ACTIVITY_SORTERS,
  collectBreakdownPlayerIds,
  collectPlayerActivityErrors,
  filterPlayerActivity,
  formatBettingFrequency,
  formatWinRate,
  isPlayerActivitySortKey,
  mergePlayerActivity,
  paginatePlayerActivity,
  playerActivityEmptyText,
  playerActivityFilterCount,
  playerActivityPeriodDays,
  playerActivitySkips,
  playerActivityTotals,
  playerCountLabel,
  playerStatusLabel,
  playerStatusTone,
  resolveAllowedDomains,
  sortPlayerActivityPage,
  visiblePlayerActivityDomains,
  withDepositWithdrawal,
  type PlayerActivityData,
  type PlayerActivityRow,
  type PlayerBreakdownRow,
} from './playerActivityReportModel'

function row(overrides: Partial<PlayerActivityRow> & { playerId: number }): PlayerActivityRow {
  return {
    playerUsername: `user${overrides.playerId}`,
    totalBets: 0,
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    avgStake: 0,
    winRate: 0,
    activeDays: 1,
    bettingFrequency: 0,
    lastBetInPeriod: false,
    totalDepositAmount: 0,
    totalDepositCount: 0,
    rangeDepositAmount: 0,
    rangeDepositCount: 0,
    totalWithdrawalAmount: 0,
    totalWithdrawalCount: 0,
    rangeWithdrawalAmount: 0,
    rangeWithdrawalCount: 0,
    ...overrides,
  }
}

describe('agent domain rules', () => {
  test('skips the other domains on a domain tab and the forbidden domains of an agent on All', () => {
    const all = ['sports', 'casino', 'matka']
    assert.deepStrictEqual(playerActivitySkips('all', false, all), {
      skipSports: false,
      skipCasino: false,
      skipMatka: false,
    })
    assert.deepStrictEqual(playerActivitySkips('sports', false, all), {
      skipSports: false,
      skipCasino: true,
      skipMatka: true,
    })
    assert.deepStrictEqual(playerActivitySkips('casino', false, all), {
      skipSports: true,
      skipCasino: false,
      skipMatka: true,
    })
    assert.deepStrictEqual(playerActivitySkips('matka', false, all), {
      skipSports: true,
      skipCasino: true,
      skipMatka: false,
    })
    // An admin is never limited by a domain list; an agent on All asks only for its own domains.
    assert.deepStrictEqual(playerActivitySkips('all', false, ['sports']), {
      skipSports: false,
      skipCasino: false,
      skipMatka: false,
    })
    assert.deepStrictEqual(playerActivitySkips('all', true, ['sports']), {
      skipSports: false,
      skipCasino: true,
      skipMatka: true,
    })
    assert.deepStrictEqual(playerActivitySkips('all', true, ['casino', 'matka']), {
      skipSports: true,
      skipCasino: false,
      skipMatka: false,
    })
    // On its own tab an agent's list is not consulted (the tab is only shown when allowed).
    assert.deepStrictEqual(playerActivitySkips('matka', true, ['sports']), {
      skipSports: true,
      skipCasino: true,
      skipMatka: false,
    })
  })

  test('shows every tab to an admin and only the allowed ones to an agent', () => {
    assert.deepStrictEqual(visiblePlayerActivityDomains(false, ['sports']), ['all', 'sports', 'casino', 'matka'])
    assert.deepStrictEqual(visiblePlayerActivityDomains(true, ['casino']), ['all', 'casino'])
    assert.deepStrictEqual(visiblePlayerActivityDomains(true, ['matka', 'sports']), ['all', 'sports', 'matka'])
    assert.deepStrictEqual(
      visiblePlayerActivityDomains(true, resolveAllowedDomains(undefined)),
      ['all', 'sports', 'casino', 'matka'],
    )
  })

  test('falls back to every domain only when the agent has no list at all', () => {
    assert.equal(resolveAllowedDomains(undefined), DEFAULT_ALLOWED_DOMAINS)
    assert.equal(resolveAllowedDomains(null), DEFAULT_ALLOWED_DOMAINS)
    const empty: string[] = []
    assert.equal(resolveAllowedDomains(empty), empty)
    assert.deepStrictEqual(visiblePlayerActivityDomains(true, empty), ['all'])
  })
})

describe('player ids and the period', () => {
  test('collects distinct numeric ids in order of first appearance', () => {
    const ids = collectBreakdownPlayerIds(
      [{ playerId: '7' }, { playerId: 3 }],
      [{ playerId: 7 }, { playerId: 'x' }, { playerId: '007' }],
      [{ playerId: null }, { playerId: 12 }],
    )
    // Number(null) is 0, which the legacy code kept as an id; 'x' is dropped.
    assert.deepStrictEqual(ids, ['7', '3', '0', '12'])
  })

  test('counts the period inclusively, as dayjs did, whatever the zone', () => {
    // The same pairs were run through the legacy dayjs expression in eight zones (UTC, Kolkata,
    // New York, Los Angeles, London, Tokyo, Lord Howe, Kiritimati) with these results.
    assert.equal(playerActivityPeriodDays('2000-01-01', '2026-10-07'), 9777)
    assert.equal(playerActivityPeriodDays('2026-10-07', '2026-10-07'), 1)
    assert.equal(playerActivityPeriodDays('2026-09-07', '2026-10-07'), 31)
    assert.equal(playerActivityPeriodDays('2024-02-28', '2024-03-01'), 3)
    assert.equal(playerActivityPeriodDays('2025-12-31', '2026-01-01'), 2)
    assert.equal(playerActivityPeriodDays('2026-03-07', '2026-03-09'), 3)
    assert.equal(playerActivityPeriodDays('2026-03-28', '2026-03-30'), 3)
    assert.equal(playerActivityPeriodDays('2026-10-31', '2026-11-02'), 3)
    assert.equal(playerActivityPeriodDays('2026-10-08', '2026-10-07'), 0)
    assert.ok(Number.isNaN(playerActivityPeriodDays('', '2026-10-07')))
  })
})

describe('mergePlayerActivity', () => {
  const sports: PlayerBreakdownRow[] = [
    {
      playerId: '1',
      playerUsername: 'alice',
      playerPhone: '9000000001',
      directAgentId: null,
      directAgentName: 'Unknown',
      totalStakes: '1000',
      totalPayouts: 400,
      grossGamingRevenue: 600,
      betCount: 0,
      avgStake: 999,
      winRate: 9,
    },
    {
      playerId: 2,
      playerUsername: null,
      playerPhone: null,
      directAgentId: 'ag-2',
      directAgentName: 'Ravi',
      totalStakes: 50,
      totalPayouts: 100,
      grossGamingRevenue: null,
      betCount: 5,
    },
  ]
  const casino: PlayerBreakdownRow[] = [
    {
      playerId: 1,
      playerUsername: 'alice-casino',
      playerPhone: '9000000099',
      directAgentId: 'ag-9',
      directAgentName: 'Meena',
      totalStakes: 500,
      totalPayouts: 100,
      grossGamingRevenue: 400,
      betCount: 10,
    },
  ]
  const matka: PlayerBreakdownRow[] = [
    { playerId: 3, playerUsername: 'carol', totalStakes: 10, totalPayouts: 0, betCount: 2 },
  ]
  const users = [
    { id: '1', name: 'Alice A', email: 'alice@example.test', phone: null, status: 'active' },
    { id: 2, name: null, email: null, phone: '9111111111', status: 'inactive' },
  ]

  test('merges the domains per player with the legacy identity, agent and phone rules', () => {
    const players = mergePlayerActivity(sports, casino, matka, users, '2026-10-01', '2026-10-10')
    assert.deepStrictEqual(
      players.map((player) => player.playerId),
      [1, 2, 3],
    )
    const [alice, two, carol] = players

    // First row sets identity and lastBetInPeriod; later rows only add.
    assert.equal(alice.playerUsername, 'alice')
    assert.equal(alice.name, 'Alice A')
    assert.equal(alice.email, 'alice@example.test')
    assert.equal(alice.status, 'active')
    assert.equal(alice.phone, '9000000001')
    assert.equal(alice.lastBetInPeriod, false)
    assert.equal(alice.totalBets, 10)
    assert.equal(alice.totalStakes, 1500)
    assert.equal(alice.totalPayouts, 500)
    assert.equal(alice.grossGamingRevenue, 1000)
    // An `Unknown` agent is replaced by a named one, with its id.
    assert.equal(alice.directAgentName, 'Meena')
    assert.equal(alice.directAgentId, 'ag-9')
    // Derived figures come from the sums, not the rows.
    assert.equal(alice.avgStake, 150)
    assert.equal(alice.winRate, 500 / 1500)
    assert.equal(alice.activeDays, 10)
    assert.equal(alice.bettingFrequency, 1)

    // A missing username reads Unknown; the user's phone wins over the row's; a null GGR counts 0.
    assert.equal(two.playerUsername, 'Unknown')
    assert.equal(two.phone, '9111111111')
    assert.equal(two.grossGamingRevenue, 0)
    assert.equal(two.winRate, 2)
    assert.equal(two.lastBetInPeriod, true)

    // No user row: the details stay undefined and an absent GGR stays NaN, as before.
    assert.equal(carol.name, undefined)
    assert.equal(carol.status, undefined)
    assert.equal(carol.phone, undefined)
    assert.ok(Number.isNaN(carol.grossGamingRevenue))
    assert.equal(carol.avgStake, 5)
  })

  test('keeps a named agent, fills a missing agent id and a missing phone from later rows', () => {
    const players = mergePlayerActivity(
      [{ playerId: 4, playerUsername: 'dev', directAgentName: 'Kiran', betCount: 1 }],
      [{ playerId: 4, directAgentId: 'ag-4', directAgentName: 'Other', playerPhone: '9222' }],
      [{ playerId: 4, directAgentId: 'ag-5', directAgentName: 'Third' }],
      [],
      '2026-10-07',
      '2026-10-07',
    )
    assert.equal(players.length, 1)
    assert.equal(players[0].directAgentName, 'Kiran')
    assert.equal(players[0].directAgentId, 'ag-4')
    assert.equal(players[0].phone, '9222')
    assert.equal(players[0].bettingFrequency, 1)
  })

  test('reads frequency 0 for an empty or reversed period', () => {
    const [player] = mergePlayerActivity([{ playerId: 5, betCount: 8 }], [], [], [], '2026-10-08', '2026-10-07')
    assert.equal(player.activeDays, 0)
    assert.equal(player.bettingFrequency, 0)
    const [none] = mergePlayerActivity([{ playerId: 5, betCount: 8 }], [], [], [], '', '2026-10-07')
    assert.ok(Number.isNaN(none.activeDays))
    assert.equal(none.bettingFrequency, 0)
  })
})

describe('deposit/withdrawal join and errors', () => {
  test('joins stats by id and reads 0 for a missing row or field', () => {
    const players: PlayerActivityData[] = [
      { ...row({ playerId: 1 }) },
      { ...row({ playerId: 2 }) },
    ]
    const joined = withDepositWithdrawal(players, [
      null,
      { playerId: 0, totalDepositAmount: 999 },
      {
        playerId: '1',
        totalDepositAmount: 1200,
        totalDepositCount: 3,
        rangeDepositAmount: null,
        rangeDepositCount: 1,
        totalWithdrawalAmount: 500,
        totalWithdrawalCount: 2,
        rangeWithdrawalAmount: 100,
        rangeWithdrawalCount: null,
      },
    ])
    assert.deepStrictEqual(
      [joined[0].totalDepositAmount, joined[0].totalDepositCount, joined[0].rangeDepositAmount],
      [1200, 3, 0],
    )
    assert.deepStrictEqual(
      [joined[0].totalWithdrawalAmount, joined[0].rangeWithdrawalAmount, joined[0].rangeWithdrawalCount],
      [500, 100, 0],
    )
    assert.equal(joined[1].totalDepositAmount, 0)
    assert.equal(joined[1].rangeWithdrawalCount, 0)
  })

  test('lists failures in the legacy order and wording, without skipped domains', () => {
    const errors = {
      sports: { message: 'a' },
      casino: { message: 'b' },
      matka: { message: 'c' },
      users: { message: 'd' },
      depositWithdrawal: { message: 'e' },
    }
    assert.deepStrictEqual(
      collectPlayerActivityErrors(errors, { skipSports: false, skipCasino: false, skipMatka: false }),
      ['Sports: a', 'Casino: b', 'Matka: c', 'Users: d', 'Deposit/Withdrawal: e'],
    )
    assert.deepStrictEqual(
      collectPlayerActivityErrors(errors, { skipSports: true, skipCasino: false, skipMatka: true }),
      ['Casino: b', 'Users: d', 'Deposit/Withdrawal: e'],
    )
    assert.deepStrictEqual(
      collectPlayerActivityErrors({}, { skipSports: false, skipCasino: false, skipMatka: false }),
      [],
    )
  })
})

describe('search, totals, paging and sorting', () => {
  const rows = [
    row({ playerId: 11, playerUsername: 'Alice', name: 'Alice A', email: 'a@x.test', phone: '98100' }),
    row({ playerId: 22, playerUsername: 'bob', name: null, email: null, phone: null }),
    row({ playerId: 33, playerUsername: 'carol', name: 'Carol C', email: 'c@x.test', phone: '97733' }),
  ]

  test('searches username, name, email, phone and id; trims only to decide there is a query', () => {
    assert.equal(filterPlayerActivity(rows, '   ').length, 3)
    assert.deepStrictEqual(filterPlayerActivity(rows, 'ALI').map((r) => r.playerId), [11])
    assert.deepStrictEqual(filterPlayerActivity(rows, 'carol c').map((r) => r.playerId), [33])
    assert.deepStrictEqual(filterPlayerActivity(rows, 'c@x').map((r) => r.playerId), [33])
    assert.deepStrictEqual(filterPlayerActivity(rows, '733').map((r) => r.playerId), [33])
    assert.deepStrictEqual(filterPlayerActivity(rows, '22').map((r) => r.playerId), [22])
    // The query is matched as typed: a trailing space finds nothing in "bob".
    assert.deepStrictEqual(filterPlayerActivity(rows, 'bob ').map((r) => r.playerId), [])
  })

  test('totals the three domain KPIs and averages over the searched players', () => {
    assert.deepStrictEqual(
      playerActivityTotals(
        {
          sports: { betCount: '10', totalStakes: 1000 },
          casino: { betCount: null, totalStakes: '250.5' },
          matka: undefined,
        },
        4,
      ),
      { totalBets: 10, totalStakes: 1250.5, totalPlayers: 4, avgBetsPerPlayer: 2.5 },
    )
    assert.deepStrictEqual(playerActivityTotals({}, 0), {
      totalBets: 0,
      totalStakes: 0,
      totalPlayers: 0,
      avgBetsPerPlayer: 0,
    })
  })

  test('slices the page, then sorts only that page, stably in both directions', () => {
    const list = [
      row({ playerId: 1, totalBets: 5 }),
      row({ playerId: 2, totalBets: 1 }),
      row({ playerId: 3, totalBets: 9 }),
      row({ playerId: 4, totalBets: 1 }),
      row({ playerId: 5, totalBets: 0 }),
    ]
    const page2 = paginatePlayerActivity(list, 2, 2)
    assert.deepStrictEqual(page2.map((r) => r.playerId), [3, 4])
    assert.deepStrictEqual(paginatePlayerActivity(list, 4, 2), [])

    const firstPage = paginatePlayerActivity(list, 1, 4)
    assert.deepStrictEqual(
      sortPlayerActivityPage(firstPage, { key: 'totalBets', dir: 'asc' }).map((r) => r.playerId),
      [2, 4, 1, 3],
    )
    assert.deepStrictEqual(
      sortPlayerActivityPage(firstPage, { key: 'totalBets', dir: 'desc' }).map((r) => r.playerId),
      [3, 1, 2, 4],
    )
    const cleared = sortPlayerActivityPage(firstPage, null)
    assert.deepStrictEqual(cleared.map((r) => r.playerId), [1, 2, 3, 4])
    assert.notEqual(cleared, firstPage)
  })

  test('compares text with localeCompare and missing values as empty or zero', () => {
    const a = row({ playerId: 1, playerUsername: 'b', email: null, phone: '2', grossGamingRevenue: 5 })
    const b = row({ playerId: 2, playerUsername: 'a', email: 'z', phone: null, grossGamingRevenue: -1 })
    assert.ok(PLAYER_ACTIVITY_SORTERS.playerUsername(a, b) > 0)
    assert.ok(PLAYER_ACTIVITY_SORTERS.email(a, b) < 0)
    assert.ok(PLAYER_ACTIVITY_SORTERS.phone(a, b) > 0)
    assert.equal(PLAYER_ACTIVITY_SORTERS.grossGamingRevenue(a, b), 6)
    assert.equal(Object.keys(PLAYER_ACTIVITY_SORTERS).length, 15)
    assert.equal(isPlayerActivitySortKey('winRate'), true)
    assert.equal(isPlayerActivitySortKey('name'), false)
    assert.equal(isPlayerActivitySortKey('toString'), false)
  })
})

describe('labels and counts', () => {
  test('counts a search (even blank) and a period other than All time', () => {
    assert.equal(playerActivityFilterCount('', 'allTime'), 0)
    assert.equal(playerActivityFilterCount(' ', 'allTime'), 1)
    assert.equal(playerActivityFilterCount('ali', 'today'), 2)
    assert.equal(playerActivityFilterCount('', 'custom'), 1)
  })

  test('formats status, frequency, win rate, the count and the empty text as before', () => {
    assert.equal(playerStatusTone('Active'), 'ok')
    assert.equal(playerStatusTone('INACTIVE'), 'warn')
    assert.equal(playerStatusTone('suspended'), 'neutral')
    assert.equal(playerStatusLabel('active'), 'ACTIVE')
    assert.equal(formatBettingFrequency(1 / 3), '0.33 bets/day')
    assert.equal(formatWinRate(0.4567), '45.7%')
    assert.equal(playerCountLabel(1), '1 player')
    assert.equal(playerCountLabel(0), '0 players')
    assert.equal(
      playerActivityEmptyText(0, false),
      'No players found for the selected period. Try adjusting the date range or search.',
    )
    assert.equal(playerActivityEmptyText(0, true), 'No data')
    assert.equal(playerActivityEmptyText(5, false), 'No data')
  })
})
