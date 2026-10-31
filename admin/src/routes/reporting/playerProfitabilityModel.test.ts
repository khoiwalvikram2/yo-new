import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  PROFITABILITY_DOMAIN_LABELS,
  PROFITABILITY_PAGE_SIZE_OPTIONS,
  agentChainLabel,
  filterProfitabilityPlayers,
  ggrTone,
  isProfitabilityPermissionRefusal,
  isReportableProfitabilityError,
  normalizeProfitabilityRow,
  payoutShareNote,
  playerCountLabel,
  profitabilityActiveFilterCount,
  profitabilityPage,
  profitabilityPlayers,
  profitabilityTotals,
  sortProfitabilityPage,
  visibleProfitabilityDomains,
  winRateLabel,
  winRateTone,
  type PlayerBreakdownData,
  type PlayerBreakdownSource,
} from './playerProfitabilityModel'

function source(playerId: number | string, patch: Partial<PlayerBreakdownSource> = {}): PlayerBreakdownSource {
  return {
    playerId,
    playerUsername: `player_${playerId}`,
    playerPhone: null,
    directAgentId: null,
    directAgentName: null,
    agentChain: [],
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    betCount: 0,
    avgStake: 0,
    winRate: 0,
    ...patch,
  }
}

function row(playerId: number, patch: Partial<PlayerBreakdownData> = {}): PlayerBreakdownData {
  return {
    playerId,
    playerUsername: `player_${playerId}`,
    playerPhone: null,
    agentChain: [],
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    betCount: 0,
    avgStake: 0,
    winRate: 0,
    ...patch,
  }
}

describe('domains and labels', () => {
  test('an admin sees every tab; an agent sees All Domains and its allowed domains in legacy order', () => {
    assert.deepEqual(visibleProfitabilityDomains(false, []), ['all', 'sports', 'casino', 'matka'])
    assert.deepEqual(visibleProfitabilityDomains(true, ['sports']), ['all', 'sports'])
    assert.deepEqual(visibleProfitabilityDomains(true, ['matka', 'casino']), ['all', 'casino', 'matka'])
    assert.deepEqual(visibleProfitabilityDomains(true, []), ['all'])
    assert.deepEqual(visibleProfitabilityDomains(true, ['sports', 'casino', 'matka']), ['all', 'sports', 'casino', 'matka'])
    assert.deepEqual(PROFITABILITY_DOMAIN_LABELS, {
      all: 'All Domains',
      sports: 'Sports',
      casino: 'Casino',
      matka: 'Matka',
    })
    assert.deepEqual([...PROFITABILITY_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
  })
})

describe('normalizeProfitabilityRow', () => {
  test('reads numeric strings, derives average stake and win rate, and keeps the legacy fallbacks', () => {
    assert.deepEqual(
      normalizeProfitabilityRow(source('42', {
        playerUsername: '',
        playerPhone: undefined,
        directAgentId: 'a1',
        directAgentName: 'north',
        agentChain: undefined,
        totalStakes: '1000',
        totalPayouts: '400',
        grossGamingRevenue: '600',
        betCount: '4',
      })),
      {
        playerId: 42,
        playerUsername: 'Unknown',
        playerPhone: null,
        directAgentId: 'a1',
        directAgentName: 'north',
        agentChain: [],
        totalStakes: 1000,
        totalPayouts: 400,
        grossGamingRevenue: 600,
        betCount: 4,
        avgStake: 250,
        winRate: 0.4,
      },
    )
  })

  test('falls back to the reported average stake and win rate when there are no bets or stakes', () => {
    const normalised = normalizeProfitabilityRow(source(7, {
      totalStakes: 0,
      betCount: 0,
      avgStake: '12.5',
      winRate: '0.25',
    }))
    assert.equal(normalised.avgStake, 12.5)
    assert.equal(normalised.winRate, 0.25)
    const empty = normalizeProfitabilityRow(source(8, { avgStake: null, winRate: undefined }))
    assert.equal(empty.avgStake, 0)
    assert.equal(empty.winRate, 0)
  })

  test('a missing GGR stays NaN, as the legacy dead `??` fallback left it; null reads as zero', () => {
    assert.ok(Number.isNaN(normalizeProfitabilityRow(source(1, { grossGamingRevenue: undefined })).grossGamingRevenue))
    assert.equal(normalizeProfitabilityRow(source(1, { grossGamingRevenue: null })).grossGamingRevenue, 0)
  })
})

describe('profitabilityPlayers', () => {
  const sports = [
    source(1, {
      playerUsername: 'asha',
      directAgentName: 'Unknown',
      totalStakes: 1000,
      totalPayouts: 600,
      grossGamingRevenue: 400,
      betCount: 10,
    }),
    source(2, { playerUsername: 'bilal', totalStakes: 50, totalPayouts: 0, grossGamingRevenue: 50, betCount: 1 }),
  ]
  const casino = [
    source(1, {
      playerUsername: 'asha',
      playerPhone: '9800000001',
      directAgentId: 'ag-9',
      directAgentName: 'east_desk',
      agentChain: ['master', 'east_desk'],
      totalStakes: '500',
      totalPayouts: '900',
      grossGamingRevenue: '-400',
      betCount: '5',
    }),
  ]
  const matka = [source(3, { playerUsername: 'chen', totalStakes: 20, betCount: 2, grossGamingRevenue: 20 })]

  test('a single domain tab shows that domain only, row by row', () => {
    assert.deepEqual(profitabilityPlayers('sports', sports, casino, matka).map((p) => p.playerId), [1, 2])
    assert.deepEqual(profitabilityPlayers('casino', sports, casino, matka).map((p) => p.playerId), [1])
    assert.deepEqual(profitabilityPlayers('matka', sports, casino, matka).map((p) => p.playerId), [3])
    assert.equal(profitabilityPlayers('casino', sports, casino, matka)[0]?.totalStakes, 500)
  })

  test('All Domains merges by player id, sums the figures and recomputes the ratios', () => {
    const merged = profitabilityPlayers('all', sports, casino, matka)
    assert.deepEqual(merged.map((p) => p.playerId), [1, 2, 3])
    const asha = merged[0]
    assert.ok(asha)
    assert.equal(asha.totalStakes, 1500)
    assert.equal(asha.totalPayouts, 1500)
    assert.equal(asha.grossGamingRevenue, 0)
    assert.equal(asha.betCount, 15)
    assert.equal(asha.avgStake, 100)
    assert.equal(asha.winRate, 1)
    // an "Unknown" sports agent label gives way to the casino row's real one, with its id
    assert.equal(asha.directAgentName, 'east_desk')
    assert.equal(asha.directAgentId, 'ag-9')
    assert.deepEqual(asha.agentChain, ['master', 'east_desk'])
    assert.equal(asha.playerPhone, '9800000001')
    const chen = merged[2]
    assert.ok(chen)
    assert.equal(chen.avgStake, 10)
    assert.equal(chen.winRate, 0)
  })

  test('a known agent label is never replaced, and an id alone fills an empty label', () => {
    const first = [source(5, { directAgentId: null, directAgentName: 'kept_desk' })]
    const second = [source(5, { directAgentId: 'ag-2', directAgentName: 'other_desk', agentChain: ['x'] })]
    const merged = profitabilityPlayers('all', first, second, [])[0]
    assert.ok(merged)
    assert.equal(merged.directAgentName, 'kept_desk')
    assert.equal(merged.directAgentId, 'ag-2')
    assert.deepEqual(merged.agentChain, ['x'])

    const idOnly = profitabilityPlayers(
      'all',
      [source(6, { directAgentName: null })],
      [source(6, { directAgentId: 'ag-3', directAgentName: 'Unknown' })],
      [],
    )[0]
    assert.ok(idOnly)
    assert.equal(idOnly.directAgentId, 'ag-3')
    assert.equal(idOnly.directAgentName, 'Unknown')
  })
})

describe('search, paging and sorting', () => {
  const players = [
    row(101, { playerUsername: 'Ravi_K', playerPhone: '98450 11111' }),
    row(202, { playerUsername: 'meena', playerPhone: null }),
    row(303, { playerUsername: 'Arif' }),
  ]

  test('search matches username or phone case-insensitively, or the id, and ignores blank text', () => {
    assert.equal(filterProfitabilityPlayers(players, ''), players)
    assert.equal(filterProfitabilityPlayers(players, '   '), players)
    assert.deepEqual(filterProfitabilityPlayers(players, 'ravi').map((p) => p.playerId), [101])
    assert.deepEqual(filterProfitabilityPlayers(players, '11111').map((p) => p.playerId), [101])
    assert.deepEqual(filterProfitabilityPlayers(players, '20').map((p) => p.playerId), [202])
    assert.deepEqual(filterProfitabilityPlayers(players, 'A').map((p) => p.playerId), [101, 202, 303])
    // the typed text is not trimmed before matching, as before
    assert.deepEqual(filterProfitabilityPlayers(players, ' arif').map((p) => p.playerId), [])
  })

  test('pages slice the filtered list', () => {
    const many = Array.from({ length: 45 }, (_, index) => row(index + 1))
    assert.deepEqual(profitabilityPage(many, 1, 20).map((p) => p.playerId).slice(0, 2), [1, 2])
    assert.deepEqual(profitabilityPage(many, 3, 20).map((p) => p.playerId), [41, 42, 43, 44, 45])
    assert.deepEqual(profitabilityPage(many, 4, 20), [])
  })

  test('a sort orders the given page by the legacy comparators, both ways, ties in place', () => {
    const page = [
      row(1, { playerUsername: 'beta', totalStakes: 30, grossGamingRevenue: -5, winRate: 0.2 }),
      row(2, { playerUsername: 'alpha', totalStakes: 10, grossGamingRevenue: 50, winRate: 0.2 }),
      row(3, { playerUsername: '', totalStakes: 20, grossGamingRevenue: 0, winRate: 0.9 }),
    ]
    const ids = (rows: PlayerBreakdownData[]) => rows.map((p) => p.playerId)
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'playerUsername', dir: 'asc' })), [3, 2, 1])
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'totalStakes', dir: 'desc' })), [1, 3, 2])
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'grossGamingRevenue', dir: 'asc' })), [1, 3, 2])
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'winRate', dir: 'asc' })), [1, 2, 3])
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'winRate', dir: 'desc' })), [3, 1, 2])
    assert.deepEqual(ids(sortProfitabilityPage(page, null)), [1, 2, 3])
    assert.deepEqual(ids(sortProfitabilityPage(page, { key: 'agentChain', dir: 'asc' })), [1, 2, 3])
    assert.notEqual(sortProfitabilityPage(page, null), page, 'a new array, never the caller’s')
  })
})

describe('totals and cell readings', () => {
  test('the KPI totals add the three domains, reading strings and treating gaps as zero', () => {
    assert.deepEqual(
      profitabilityTotals(
        { totalStakes: '1000', totalPayouts: 400, grossGamingRevenue: '600', betCount: 10 },
        { totalStakes: 500, totalPayouts: null, grossGamingRevenue: -50, betCount: '5' },
        undefined,
      ),
      { totalStakes: 1500, totalPayouts: 400, totalGGR: 550, totalBets: 15 },
    )
    assert.deepEqual(profitabilityTotals(null, null, null), {
      totalStakes: 0,
      totalPayouts: 0,
      totalGGR: 0,
      totalBets: 0,
    })
  })

  test('the payout note states the payout share of stakes to one decimal, or a dash', () => {
    assert.equal(payoutShareNote({ totalStakes: 3000, totalPayouts: 1000, totalGGR: 0, totalBets: 0 }), 'Payout: 33.3%')
    assert.equal(payoutShareNote({ totalStakes: 0, totalPayouts: 10, totalGGR: 0, totalBets: 0 }), '—')
  })

  test('win rate prints one decimal and keeps the red above 50%, orange above 30%, green otherwise', () => {
    assert.equal(winRateLabel(0.5234), '52.3%')
    assert.equal(winRateLabel(0), '0.0%')
    assert.equal(winRateTone(0.51), 'neg')
    assert.equal(winRateTone(0.5), 'warn')
    assert.equal(winRateTone(0.31), 'warn')
    assert.equal(winRateTone(0.29), 'ok')
    assert.equal(winRateTone(0.3), 'ok')
    assert.equal(winRateTone(0), 'ok')
  })

  test('GGR is positive at zero or above; the agent chain falls back to the direct agent, then a dash', () => {
    assert.equal(ggrTone(0), 'pos')
    assert.equal(ggrTone(12), 'pos')
    assert.equal(ggrTone(-0.01), 'neg')
    assert.equal(ggrTone(Number.NaN), 'neg')
    assert.equal(agentChainLabel({ agentChain: ['master', 'desk'], directAgentName: 'desk' }), 'master > desk')
    assert.equal(agentChainLabel({ agentChain: [], directAgentName: 'desk' }), 'desk')
    assert.equal(agentChainLabel({ agentChain: [], directAgentName: null }), '—')
  })

  test('counts and the active-filter count', () => {
    assert.equal(playerCountLabel(1), '1 player')
    assert.equal(playerCountLabel(0), '0 players')
    assert.equal(playerCountLabel(12), '12 players')
    assert.equal(profitabilityActiveFilterCount('', 'allTime'), 0)
    assert.equal(profitabilityActiveFilterCount(' ', 'allTime'), 1)
    assert.equal(profitabilityActiveFilterCount('', 'today'), 1)
    assert.equal(profitabilityActiveFilterCount('asha', 'custom'), 2)
  })

  test('a permission refusal is not reported; any other failure is', () => {
    const refusal = { networkError: null, graphQLErrors: [{ message: 'Forbidden: insufficient permissions for reporting.matka:view' }] }
    const dashboardRefusal = { graphQLErrors: [{ message: 'Forbidden: insufficient permissions to view dashboard' }] }
    const serverFailure = { networkError: null, graphQLErrors: [{ message: 'Database timeout' }] }
    const networkFailure = { networkError: new Error('Failed to fetch'), graphQLErrors: [] }

    assert.equal(isProfitabilityPermissionRefusal(refusal), true)
    assert.equal(isProfitabilityPermissionRefusal(dashboardRefusal), true)
    assert.equal(isProfitabilityPermissionRefusal(serverFailure), false)
    assert.equal(isProfitabilityPermissionRefusal(networkFailure), false)
    // a refusal that also failed on the wire, or came with another error, is a failure
    assert.equal(isProfitabilityPermissionRefusal({ ...refusal, networkError: new Error('x') }), false)
    assert.equal(
      isProfitabilityPermissionRefusal({ graphQLErrors: [...refusal.graphQLErrors, { message: 'Database timeout' }] }),
      false,
    )
    assert.equal(isProfitabilityPermissionRefusal({ graphQLErrors: [] }), false)

    assert.equal(isReportableProfitabilityError(refusal), false)
    assert.equal(isReportableProfitabilityError(dashboardRefusal), false)
    assert.equal(isReportableProfitabilityError(serverFailure), true)
    assert.equal(isReportableProfitabilityError(networkFailure), true)
    assert.equal(isReportableProfitabilityError(undefined), false)
    assert.equal(isReportableProfitabilityError(null), false)
  })
})
