import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { computeReportingDateRange } from '@/modules/reporting/reportingDateFilter'
import type { DrillDownLevel } from '@/state/reportingStore'
import {
  MATKA_COMPARATORS,
  MATKA_FILTER_KEYS,
  clampMatkaPage,
  filterMatkaRows,
  matkaAllTimeRange,
  matkaClearableFilterCount,
  matkaColumns,
  matkaCurrentLevel,
  matkaDrillTarget,
  matkaKpiTiles,
  matkaLevelSource,
  matkaLevelsToRemove,
  matkaNextLevel,
  matkaPageRows,
  matkaPathFromOtherReport,
  matkaReportFilter,
  matkaRowKey,
  matkaRowsLevel,
  matkaSearchPlaceholder,
  matkaTotalText,
  sortMatkaPage,
  winRateText,
  winRateTone,
  type MatkaRow,
} from './matkaRiskReportModel'

function row(fields: Partial<MatkaRow>): MatkaRow {
  return {
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    betCount: 0,
    playerCount: 0,
    marketCount: 0,
    sessionCount: 0,
    commission: 0,
    avgStake: 0,
    winRate: 0,
    ...fields,
  }
}

const money = (value: number) => `₹${value.toFixed(2)}`

describe('matkaRiskReportModel', () => {
  test('All time runs from 2000-01-01 through the IST day, the legacy nowIST() day', () => {
    assert.deepStrictEqual(matkaAllTimeRange('2026-10-07'), { dateFrom: '2000-01-01', dateTo: '2026-10-07' })
    assert.deepStrictEqual(matkaAllTimeRange(), computeReportingDateRange('allTime'))
  })

  test('a path from another report is dropped on arrival; an empty or matka path is kept', () => {
    const matka: DrillDownLevel[] = [{ type: 'matkaType', id: 'Kalyan', name: 'Kalyan' }]
    const sports: DrillDownLevel[] = [{ type: 'sport', id: 4, name: 'Cricket' }]
    const mixed: DrillDownLevel[] = [...matka, { type: 'game', id: 'g1', name: 'Roulette' }]
    assert.equal(matkaPathFromOtherReport([]), false)
    assert.equal(matkaPathFromOtherReport(matka), false)
    assert.equal(matkaPathFromOtherReport(sports), true)
    assert.equal(matkaPathFromOtherReport(mixed), true)
  })

  test('levels: the last path level is current, and the hierarchy falls back to matkaType', () => {
    assert.equal(matkaCurrentLevel([]), 'all')
    assert.equal(matkaCurrentLevel([{ type: 'matkaType', name: 'A' }, { type: 'market', id: 3, name: 'M' }]), 'market')
    assert.equal(matkaNextLevel('all'), 'matkaType')
    assert.equal(matkaNextLevel('matkaType'), 'market')
    assert.equal(matkaNextLevel('market'), 'session')
    assert.equal(matkaNextLevel('session'), 'agent')
    assert.equal(matkaNextLevel('agent'), 'player')
    assert.equal(matkaNextLevel('player'), 'matkaType')
    assert.equal(matkaLevelsToRemove(4, 1), 2)
    assert.equal(matkaLevelsToRemove(4, 3), 0)
  })

  test('the query filter keeps only MatkaDrillDownFilter fields, then the path, then the allowed chips', () => {
    assert.deepStrictEqual([...MATKA_FILTER_KEYS], [
      'tenant', 'whitelabelId', 'dateFrom', 'dateTo', 'matkaType', 'matkaId', 'marketSession', 'agentId', 'playerId', 'currency',
    ])
    const filter = matkaReportFilter(
      {
        tenant: 'core',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
        currency: 'INR',
        schemeType: 'COMMISSION',
        domain: 'matka',
        agentId: 'store-agent',
      },
      [
        { type: 'matkaType', id: 'Kalyan', name: 'Kalyan' },
        { type: 'market', id: 12, name: 'Kalyan Day' },
        { type: 'session', id: 'OPEN', name: 'OPEN' },
        { type: 'agent', id: 'ag-1', name: 'Kiran' },
        { type: 'player', id: 99, name: 'p99' },
      ],
      {
        whitelabelId: { value: 'wl-7', label: 'Whitelabel' },
        campaignId: { value: 'c-1', label: 'Campaign' },
      },
      '2026-10-07',
    )
    assert.deepStrictEqual(filter, {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-05',
      currency: 'INR',
      tenant: 'core',
      agentId: 'ag-1',
      matkaType: 'Kalyan',
      matkaId: 12,
      marketSession: 'OPEN',
      playerId: 99,
      whitelabelId: 'wl-7',
    })
    assert.deepStrictEqual(Object.keys(filter), [
      'dateFrom', 'dateTo', 'currency', 'tenant', 'agentId', 'matkaType', 'matkaId', 'marketSession', 'playerId', 'whitelabelId',
    ])
  })

  test('an empty store asks for All time with an undefined currency key, as the legacy object did', () => {
    const filter = matkaReportFilter({}, [], {}, '2026-10-07')
    assert.deepStrictEqual(Object.keys(filter), ['dateFrom', 'dateTo', 'currency'])
    assert.equal(filter.dateFrom, '2000-01-01')
    assert.equal(filter.dateTo, '2026-10-07')
    assert.equal(filter.currency, undefined)
    assert.deepStrictEqual(matkaReportFilter(null, [], null, '2026-10-07'), filter)
  })

  test('each level reads the next level’s breakdown, and its rows are that level’s (F-REP-01)', () => {
    assert.equal(matkaLevelSource('all'), 'type')
    assert.equal(matkaLevelSource('matkaType'), 'market')
    assert.equal(matkaLevelSource('market'), 'session')
    assert.equal(matkaLevelSource('session'), 'agent')
    assert.equal(matkaLevelSource('agent'), 'player')
    assert.equal(matkaLevelSource('player'), 'player')
    assert.equal(matkaLevelSource('sport'), null)
    assert.deepStrictEqual(
      ['all', 'matkaType', 'market', 'session', 'agent', 'player'].map(matkaRowsLevel),
      ['matkaType', 'market', 'session', 'agent', 'player', 'player'],
    )
  })

  test('a row opens the next level only when it carries that level id, as the legacy click did', () => {
    assert.deepStrictEqual(matkaDrillTarget('all', row({ matkaType: 'Kalyan' })), {
      type: 'matkaType',
      id: 'Kalyan',
      name: 'Kalyan',
    })
    assert.equal(matkaDrillTarget('all', row({ matkaType: null })), null)
    // the matkaType level lists markets; a row without a market id opens nothing
    assert.equal(matkaDrillTarget('matkaType', row({ matkaType: 'Kalyan' })), null)
    assert.deepStrictEqual(matkaDrillTarget('matkaType', row({ matkaId: 12, marketName: 'Kalyan Day' })), {
      type: 'market',
      id: 12,
      name: 'Kalyan Day',
    })
    assert.equal(matkaDrillTarget('market', row({ matkaId: 12, marketName: 'Kalyan Day' })), null)
    assert.deepStrictEqual(matkaDrillTarget('market', row({ marketSession: 'OPEN' })), {
      type: 'session',
      id: 'OPEN',
      name: 'OPEN',
    })
    assert.deepStrictEqual(matkaDrillTarget('session', row({ agentId: 'ag-1' })), {
      type: 'agent',
      id: 'ag-1',
      name: 'Unknown',
    })
    assert.deepStrictEqual(matkaDrillTarget('agent', row({ playerId: 7, playerUsername: 'riya' })), {
      type: 'player',
      id: 7,
      name: 'riya',
    })
    assert.equal(matkaDrillTarget('agent', row({ playerId: 0 })), null)
    // the player level falls back to the matkaType hierarchy step, which a player row cannot fill
    assert.equal(matkaDrillTarget('player', row({ playerId: 7 })), null)
  })

  test('the search reads the level fields, lower-cased, and a blank query keeps every row', () => {
    const types = [row({ matkaType: 'Kalyan' }), row({ matkaType: 'Milan Day' }), row({ matkaType: null })]
    assert.equal(filterMatkaRows(types, 'all', '   ').length, 3)
    assert.deepStrictEqual(filterMatkaRows(types, 'all', 'MILAN').map((r) => r.matkaType), ['Milan Day'])
    assert.deepStrictEqual(filterMatkaRows(types, 'matkaType', 'kal').map((r) => r.matkaType), ['Kalyan'])

    const markets = [row({ marketName: 'Rajdhani Night', matkaType: 'Rajdhani' }), row({ marketName: 'Main', matkaType: 'Bazar' })]
    assert.equal(filterMatkaRows(markets, 'market', 'bazar').length, 1)
    assert.equal(filterMatkaRows(markets, 'market', 'night').length, 1)

    const sessions = [row({ marketSession: 'OPEN', marketName: 'Kalyan' }), row({ marketSession: 'CLOSE', marketName: 'Milan' })]
    assert.equal(filterMatkaRows(sessions, 'session', 'open').length, 1)
    assert.equal(filterMatkaRows(sessions, 'session', 'milan').length, 1)

    const agents = [row({ agentName: 'Kiran', agentId: 'AG-1042' }), row({ agentName: null, agentId: 1088 })]
    assert.equal(filterMatkaRows(agents, 'agent', 'kir').length, 1)
    assert.equal(filterMatkaRows(agents, 'agent', '1088').length, 1)
    // the id is matched as typed (lower-cased query against the raw id), as before
    assert.equal(filterMatkaRows(agents, 'agent', 'AG-1042').length, 0)

    const players = [row({ playerUsername: 'Riya', playerId: 41 }), row({ playerUsername: 'sam', playerId: 7 })]
    assert.equal(filterMatkaRows(players, 'player', 'RI').length, 1)
    assert.equal(filterMatkaRows(players, 'player', '7').length, 1)
    assert.equal(filterMatkaRows(players, 'sport', 'x').length, 2)
  })

  test('copy: the placeholders by level and the pager total', () => {
    assert.equal(matkaSearchPlaceholder('player'), 'Search by username, ID...')
    assert.equal(matkaSearchPlaceholder('agent'), 'Search by agent name, ID...')
    assert.equal(matkaSearchPlaceholder('session'), 'Search by session...')
    assert.equal(matkaSearchPlaceholder('market'), 'Search by market name...')
    assert.equal(matkaSearchPlaceholder('all'), 'Search by matka type...')
    assert.equal(matkaSearchPlaceholder('matkaType'), 'Search by matka type...')
    assert.equal(matkaTotalText(42), 'Total 42 items')
  })

  test('row keys follow the legacy rules, with the page index as the fallback', () => {
    assert.equal(matkaRowKey('all', row({ matkaType: 'Kalyan' }), 0), 'Kalyan')
    assert.equal(matkaRowKey('matkaType', row({}), 3), 'type-3')
    assert.equal(matkaRowKey('market', row({ matkaId: 12 }), 0), '12')
    assert.equal(matkaRowKey('market', row({}), 1), 'market-1')
    assert.equal(matkaRowKey('session', row({ marketSession: 'OPEN', matkaId: 12 }), 0), 'OPEN-12')
    assert.equal(matkaRowKey('session', row({}), 4), 'undefined-undefined')
    assert.equal(matkaRowKey('agent', row({ agentId: 'ag-1' }), 0), 'ag-1')
    assert.equal(matkaRowKey('agent', row({}), 2), 'agent-2')
    assert.equal(matkaRowKey('player', row({ playerId: 41 }), 0), '41')
    assert.equal(matkaRowKey('player', row({}), 5), 'player-5')
    assert.equal(matkaRowKey('sport', row({}), 6), 'row-6')
  })

  test('each level draws the legacy columns, titles, alignment and sorters', () => {
    const shape = (level: string) => matkaColumns(level).map((c) => `${c.key}:${c.title}:${c.align ?? 'left'}:${c.sortable}`)
    assert.deepStrictEqual(shape('all'), [
      'matkaType:Matka Type:left:false',
      'totalStakes:Total Stakes:right:true',
      'ggr:GGR:right:true',
      'betCount:Bets:right:true',
      'marketCount:Markets:right:true',
    ])
    assert.deepStrictEqual(shape('matkaType'), shape('all'))
    assert.deepStrictEqual(shape('market'), [
      'market:Market:left:false',
      'totalStakes:Total Stakes:right:true',
      'ggr:GGR:right:true',
      'sessionCount:Sessions:right:true',
    ])
    assert.deepStrictEqual(shape('session'), [
      'session:Session:left:false',
      'totalStakes:Total Stakes:right:true',
      'ggr:GGR:right:true',
      'betCount:Bets:right:true',
    ])
    assert.deepStrictEqual(shape('agent'), [
      'agent:Agent:left:false',
      'totalStakes:Total Stakes:right:true',
      'ggr:GGR:right:true',
      'commission:Commission:right:true',
    ])
    assert.deepStrictEqual(shape('player'), [
      'player:Player:left:false',
      'totalStakes:Total Stakes:right:true',
      'avgStake:Avg Stake:right:true',
      'winRate:Win Rate:right:true',
      'betCount:Bets:right:true',
    ])
    assert.deepStrictEqual(matkaColumns('sport'), [])
  })

  test('a sort orders the page it is given, ascending then descending, by the legacy comparators', () => {
    const rows = [
      row({ matkaType: 'B', totalStakes: 20, grossGamingRevenue: -5, betCount: 2 }),
      row({ matkaType: 'A', totalStakes: 30, grossGamingRevenue: 9, betCount: 1 }),
      row({ matkaType: 'C', totalStakes: 10, grossGamingRevenue: 0, betCount: 3 }),
    ]
    const names = (sorted: MatkaRow[]) => sorted.map((r) => r.matkaType).join('')
    assert.equal(names(sortMatkaPage(rows, null)), 'BAC')
    assert.equal(names(sortMatkaPage(rows, { key: 'totalStakes', dir: 'asc' })), 'CBA')
    assert.equal(names(sortMatkaPage(rows, { key: 'totalStakes', dir: 'desc' })), 'ABC')
    assert.equal(names(sortMatkaPage(rows, { key: 'ggr', dir: 'asc' })), 'BCA')
    assert.equal(names(sortMatkaPage(rows, { key: 'betCount', dir: 'desc' })), 'CBA')
    // a column with no sorter (the name) leaves the order alone
    assert.equal(names(sortMatkaPage(rows, { key: 'matkaType', dir: 'asc' })), 'BAC')
    assert.deepStrictEqual(Object.keys(MATKA_COMPARATORS).sort(), [
      'avgStake', 'betCount', 'commission', 'ggr', 'marketCount', 'sessionCount', 'totalStakes', 'winRate',
    ])
    assert.equal(rows[0].matkaType, 'B', 'the input is not reordered')
  })

  test('paging slices the filtered rows; a page past the end shows the last page', () => {
    const rows = Array.from({ length: 45 }, (_, index) => index)
    assert.deepStrictEqual(matkaPageRows(rows, 1, 20), rows.slice(0, 20))
    assert.deepStrictEqual(matkaPageRows(rows, 3, 20), [40, 41, 42, 43, 44])
    assert.equal(clampMatkaPage(3, 45, 20), 3)
    assert.equal(clampMatkaPage(3, 5, 20), 1)
    assert.equal(clampMatkaPage(4, 45, 20), 3)
    assert.equal(clampMatkaPage(2, 0, 20), 1)
    assert.equal(clampMatkaPage(0, 45, 20), 1)
  })

  test('the filter bar counts what Clear all clears: a typed search and a period other than All time', () => {
    assert.equal(matkaClearableFilterCount('', 'allTime'), 0)
    assert.equal(matkaClearableFilterCount(' ', 'allTime'), 1)
    assert.equal(matkaClearableFilterCount('kal', 'today'), 2)
    assert.equal(matkaClearableFilterCount('', 'custom'), 1)
  })

  test('win rate: two decimals, red over 50%, orange over 30%, green otherwise', () => {
    assert.equal(winRateText(0.4567), '45.67%')
    assert.equal(winRateText(0), '0.00%')
    assert.equal(winRateTone(0.51), 'neg')
    assert.equal(winRateTone(0.5), 'warn')
    assert.equal(winRateTone(0.31), 'warn')
    assert.equal(winRateTone(0.3), 'ok')
    assert.equal(winRateTone(0), 'ok')
  })

  test('the four figures keep the legacy values, notes and fallbacks', () => {
    const tiles = matkaKpiTiles(
      {
        grossGamingRevenue: 271600,
        holdPercentage: 0.14569,
        totalStakes: 1864200,
        totalPayouts: 1592600,
        betCount: 88420,
        playerCount: 4000,
        activePlayerCount: 1250,
      },
      money,
    )
    assert.deepStrictEqual(
      tiles.map(({ label, value, note, hue, icon }) => ({ label, value, note, hue, icon })),
      [
        { label: 'Total GGR', value: '₹271600.00', note: 'Hold: 14.57%', hue: 'blu', icon: 'chart' },
        { label: 'Total Stakes', value: '₹1864200.00', note: 'Payouts: ₹1592600.00', hue: 'grn', icon: 'cash' },
        { label: 'Total Bets', value: (88420).toLocaleString(), note: 'Avg: 22.1/player', hue: 'ind', icon: 'bars' },
        { label: 'Active Players', value: 1250, note: '4000 total', hue: 'red', icon: 'users' },
      ],
    )
    const empty = matkaKpiTiles({ grossGamingRevenue: null, playerCount: 0 }, money)
    assert.deepStrictEqual(empty.map((tile) => [tile.value, tile.note]), [
      ['₹0.00', 'Hold: 0.00%'],
      ['₹0.00', 'Payouts: ₹0.00'],
      ['0', '—'],
      [0, '0 total'],
    ])
  })
})
