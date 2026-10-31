import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { DrillDownLevel } from '@/state/reportingStore'
import {
  CASINO_DEFAULT_PAGE_SIZE,
  CASINO_FILTER_KEYS,
  CASINO_PAGE_SIZE_OPTIONS,
  CASINO_SORTERS,
  CASINO_TREND_LINES,
  CASINO_VIEWS,
  casinoActiveFilterCount,
  casinoCount,
  casinoCrumbs,
  casinoCurrentLevel,
  casinoFilterChips,
  casinoGgrTone,
  casinoKpiTiles,
  casinoNextLevel,
  casinoPageCount,
  casinoPageRows,
  casinoReportFilter,
  casinoRowAction,
  casinoRowKey,
  casinoRtpPercent,
  casinoRtpText,
  casinoRtpTone,
  casinoSearchLabel,
  casinoSearchPlaceholder,
  casinoSidebarFilter,
  casinoSortKeys,
  casinoSummary,
  casinoTableLabel,
  casinoTrendRows,
  clampCasinoPage,
  filterCasinoRows,
  isPathFromOtherReport,
  levelsToPop,
  selectedCasinoRowKey,
  type CasinoBreakdownRecord,
} from './casinoOverviewReportModel'

const vendor = (id: string | number, name: string): DrillDownLevel => ({ type: 'vendor', id, name })

describe('levels', () => {
  test('all -> vendor -> game, nothing after a game', () => {
    assert.equal(casinoNextLevel('all'), 'vendor')
    assert.equal(casinoNextLevel('vendor'), 'game')
    assert.equal(casinoNextLevel('game'), null)
    assert.equal(casinoNextLevel('sport'), null)
  })

  test('the current level is the last pushed one, else all', () => {
    assert.equal(casinoCurrentLevel([]), 'all')
    assert.equal(casinoCurrentLevel([vendor('v1', 'Evolution')]), 'vendor')
    assert.equal(casinoCurrentLevel([vendor('v1', 'Evolution'), { type: 'game', id: 'g', name: 'G' }]), 'game')
  })

  test('only a path holding another report level counts as foreign', () => {
    assert.equal(isPathFromOtherReport([]), false)
    assert.equal(isPathFromOtherReport([vendor('v1', 'Evolution')]), false)
    assert.equal(isPathFromOtherReport([vendor('v1', 'Evolution'), { type: 'game', id: 'g', name: 'G' }]), false)
    assert.equal(isPathFromOtherReport([{ type: 'sport', id: 4, name: 'Cricket' }]), true)
    assert.equal(isPathFromOtherReport([vendor('v1', 'Evolution'), { type: 'league', id: 1, name: 'IPL' }]), true)
  })

  test('a crumb pops the levels after it; crumbs carry name, type and id', () => {
    assert.equal(levelsToPop(3, 0), 2)
    assert.equal(levelsToPop(2, 1), 0)
    assert.deepEqual(casinoCrumbs([vendor(7, 'Ezugi')]), [{ label: 'Ezugi', key: 'vendor', value: 7 }])
  })
})

describe('query filter', () => {
  test('dates fall back to all time through today; currency is always a key', () => {
    const filter = casinoReportFilter({}, [], {}, '2026-10-07')
    assert.deepEqual(filter, { dateFrom: '2000-01-01', dateTo: '2026-10-07', currency: undefined })
    assert.deepEqual(Object.keys(filter), ['dateFrom', 'dateTo', 'currency'])
    assert.deepEqual(casinoReportFilter(null, [], null, '2026-10-07'), filter)
  })

  test('only CasinoDrillDownFilter fields pass from the store, in the legacy key order', () => {
    const filter = casinoReportFilter(
      {
        tenant: 'core',
        whitelabelId: 'wl-1',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
        currency: 'INR',
        agentId: 'a-9',
        sportId: 's-1',
        domain: 'sports',
        schemeType: 'CREDIT',
      },
      [],
      {},
      '2026-10-07',
    )
    assert.deepEqual(filter, {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      currency: 'INR',
      tenant: 'core',
      whitelabelId: 'wl-1',
      agentId: 'a-9',
    })
    assert.deepEqual(Object.keys(filter), ['dateFrom', 'dateTo', 'currency', 'tenant', 'whitelabelId', 'agentId'])
  })

  test('a missing store field is skipped, an empty one is copied over the fallback (as before), the drilled vendor and allowed chip filters override', () => {
    const filter = casinoReportFilter(
      { dateFrom: '2026-09-01', dateTo: '', agentId: undefined, currency: undefined },
      [vendor('v-77', 'Spribe')],
      {
        agentId: { value: 'a-1', label: 'Agent' },
        domain: { value: 'casino', label: 'Domain' },
        playerId: { value: 42, label: 'Player' },
      },
      '2026-10-07',
    )
    assert.deepEqual(filter, {
      dateFrom: '2026-09-01',
      dateTo: '',
      currency: undefined,
      vendorId: 'v-77',
      agentId: 'a-1',
      playerId: 42,
    })
    assert.ok(CASINO_FILTER_KEYS.includes('vendorId'))
  })

  test('the contributors filter adds the vendor, the selected game and the refresh key', () => {
    const base = { dateFrom: '2000-01-01', dateTo: '2026-10-07', currency: undefined, tenant: 'core' }
    assert.deepEqual(casinoSidebarFilter(base, [vendor('v1', 'Evolution')], 'g-3', 2), {
      ...base,
      vendorId: 'v1',
      gameId: 'g-3',
      _refreshKey: 2,
    })
    const top = casinoSidebarFilter(base, [], null, 0)
    assert.equal(top.vendorId, undefined)
    assert.equal(top.gameId, undefined)
    assert.ok('vendorId' in top && 'gameId' in top)
    assert.equal(top._refreshKey, 0)
  })

  test('chips read the label, else the key, and the value, else an empty string', () => {
    assert.deepEqual(
      casinoFilterChips({
        agentId: { value: 'a-1', label: 'Agent' },
        playerId: { value: undefined as unknown as string, label: undefined as unknown as string },
        gone: undefined,
      }),
      [
        { key: 'agentId', label: 'Agent', value: 'a-1' },
        { key: 'playerId', label: 'playerId', value: '' },
      ],
    )
    assert.deepEqual(casinoFilterChips(null), [])
  })
})

describe('rows', () => {
  const vendors: CasinoBreakdownRecord[] = [
    { vendorId: 'v1', vendorName: 'Evolution' },
    { vendorId: 'v2', vendorName: 'Ezugi' },
    { vendorId: 'v3', vendorName: null },
  ]
  const games: CasinoBreakdownRecord[] = [
    { gameId: 'g1', gameName: 'Lightning Roulette', vendorName: 'Evolution' },
    { gameId: 'g2', gameName: 'Aviator', vendorName: 'Spribe' },
  ]

  test('search: spaces alone do not filter; vendors by name; games by name or vendor; any case', () => {
    assert.equal(filterCasinoRows(vendors, '   ', 'all').length, 3)
    assert.deepEqual(filterCasinoRows(vendors, 'EZU', 'all'), [vendors[1]])
    assert.deepEqual(filterCasinoRows(games, 'aviator', 'vendor'), [games[1]])
    assert.deepEqual(filterCasinoRows(games, 'evolution', 'vendor'), [games[0]])
    assert.equal(filterCasinoRows(games, 'x', 'game').length, 2)
    // the legacy lowered the query but did not trim it
    assert.deepEqual(filterCasinoRows(vendors, ' evo', 'all'), [])
  })

  test('paging: 20 by default, 10/20/50/100, a page past the end clamps to the last one', () => {
    assert.equal(CASINO_DEFAULT_PAGE_SIZE, 20)
    assert.deepEqual([...CASINO_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
    assert.equal(casinoPageCount(0, 20), 1)
    assert.equal(casinoPageCount(41, 20), 3)
    assert.equal(clampCasinoPage(5, 41, 20), 3)
    assert.equal(clampCasinoPage(0, 41, 20), 1)
    assert.equal(clampCasinoPage(Number.NaN, 41, 20), 1)
    const rows = Array.from({ length: 41 }, (_, index) => index)
    assert.deepEqual(casinoPageRows(rows, 3, 20), [40])
    assert.deepEqual(casinoPageRows(rows, 9, 20), [40])
    assert.deepEqual(casinoPageRows(rows, 2, 10), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    assert.equal(casinoSummary(41), 'Total 41 items')
  })

  test('row keys: the vendor or game id, else a positional key', () => {
    assert.equal(casinoRowKey('all', { vendorId: 12 }, 0), '12')
    assert.equal(casinoRowKey('all', { vendorId: 0 }, 4), '0')
    assert.equal(casinoRowKey('all', {}, 4), 'vendor-4')
    assert.equal(casinoRowKey('vendor', { gameId: 'g9' }, 1), 'g9')
    assert.equal(casinoRowKey('vendor', { gameId: null }, 1), 'game-1')
    assert.equal(casinoRowKey('game', {}, 2), 'row-2')
  })

  test('the selected game is drawn only at the vendor level', () => {
    assert.equal(selectedCasinoRowKey('vendor', 'g1'), 'g1')
    assert.equal(selectedCasinoRowKey('vendor', null), undefined)
    assert.equal(selectedCasinoRowKey('all', 'g1'), undefined)
  })

  test('a game click selects it, the same game clears it, a game with no id clears', () => {
    assert.deepEqual(casinoRowAction('vendor', { gameId: 5 }, null), { kind: 'select', gameId: '5' })
    assert.deepEqual(casinoRowAction('vendor', { gameId: 5 }, '5'), { kind: 'select', gameId: null })
    assert.deepEqual(casinoRowAction('vendor', { gameId: 6 }, '5'), { kind: 'select', gameId: '6' })
    assert.deepEqual(casinoRowAction('vendor', { gameId: null }, '5'), { kind: 'select', gameId: null })
  })

  test('a vendor click drills in with its id and name; a vendor without a truthy id pushes nothing', () => {
    assert.deepEqual(casinoRowAction('all', { vendorId: 'v1', vendorName: 'Evolution' }, 'g1'), {
      kind: 'drill',
      level: { type: 'vendor', id: 'v1', name: 'Evolution' },
    })
    assert.deepEqual(casinoRowAction('all', { vendorId: null, vendorName: 'X' }, null), { kind: 'drill', level: null })
    assert.deepEqual(casinoRowAction('all', { vendorId: 0, vendorName: 'Zero' }, null), { kind: 'drill', level: null })
    assert.deepEqual(casinoRowAction('game', { gameId: 1 }, null), { kind: 'none' })
  })
})

describe('cells', () => {
  test('counts use the browser grouping; missing counts read 0', () => {
    assert.equal(casinoCount(1234567), (1234567).toLocaleString())
    assert.equal(casinoCount(null), '0')
    assert.equal(casinoCount(undefined), '0')
  })

  test('GGR ink follows the legacy `v >= 0` test', () => {
    assert.equal(casinoGgrTone(0), 'gain')
    assert.equal(casinoGgrTone(10), 'gain')
    assert.equal(casinoGgrTone(-0.01), 'loss')
    assert.equal(casinoGgrTone(null), 'gain')
    assert.equal(casinoGgrTone(undefined), 'loss')
  })

  test('RTP reads a fraction or a percentage; tones above 95 red, above 90 orange, else green', () => {
    assert.equal(casinoRtpPercent(0.962), 96.2)
    assert.equal(casinoRtpPercent(1), 100)
    assert.equal(casinoRtpPercent(96), 96)
    assert.equal(casinoRtpPercent(0), 0)
    assert.equal(casinoRtpPercent('95.5'), 95.5)
    assert.equal(casinoRtpPercent(null), null)
    assert.equal(casinoRtpPercent(undefined), null)
    assert.equal(casinoRtpPercent('abc'), null)
    assert.equal(casinoRtpTone(96.2), 'neg')
    assert.equal(casinoRtpTone(95), 'warn')
    assert.equal(casinoRtpTone(90.01), 'warn')
    assert.equal(casinoRtpTone(90), 'ok')
    assert.equal(casinoRtpTone(null), 'neutral')
    assert.equal(casinoRtpText(96.2), '96.20%')
    assert.equal(casinoRtpText(null), 'N/A')
  })

  test('sorters keep the legacy comparisons', () => {
    const a: CasinoBreakdownRecord = { totalStakes: 10, totalPayouts: null, grossGamingRevenue: -5, betCount: 3, playerCount: null, gameCount: 4, rtp: 0.97 }
    const b: CasinoBreakdownRecord = { totalStakes: 20, totalPayouts: 7, grossGamingRevenue: 5, betCount: null, playerCount: 2, gameCount: null, rtp: 96 }
    assert.equal(CASINO_SORTERS.totalStakes(a, b), -10)
    assert.equal(CASINO_SORTERS.totalPayouts(a, b), -7)
    assert.equal(CASINO_SORTERS.ggr(a, b), -10)
    assert.equal(CASINO_SORTERS.betCount(a, b), 3)
    assert.equal(CASINO_SORTERS.playerCount(a, b), -2)
    assert.equal(CASINO_SORTERS.gameCount(a, b), 4)
    assert.ok(Math.abs(CASINO_SORTERS.rtp(a, b) - 1) < 1e-9)
    assert.equal(CASINO_SORTERS.rtp({ rtp: null }, { rtp: 0.5 }), -50)
    // no null guard on stakes, as before
    assert.ok(Number.isNaN(CASINO_SORTERS.totalStakes({ totalStakes: undefined }, b)))
  })

  test('each level sorts its own columns', () => {
    assert.deepEqual(casinoSortKeys('all'), ['totalStakes', 'totalPayouts', 'ggr', 'betCount', 'playerCount', 'gameCount'])
    assert.deepEqual(casinoSortKeys('vendor'), ['totalStakes', 'totalPayouts', 'ggr', 'betCount', 'playerCount', 'rtp'])
    assert.deepEqual(casinoSortKeys('game'), [])
  })
})

describe('filters and copy', () => {
  test('the count holds what Clear all clears: a typed search and a period other than All time', () => {
    assert.equal(casinoActiveFilterCount('', 'allTime'), 0)
    assert.equal(casinoActiveFilterCount(' ', 'allTime'), 1)
    assert.equal(casinoActiveFilterCount('evo', 'today'), 2)
    assert.equal(casinoActiveFilterCount('', 'custom'), 1)
  })

  test('search and table names follow the level', () => {
    assert.equal(casinoSearchPlaceholder('all'), 'Search by vendor name...')
    assert.equal(casinoSearchPlaceholder('vendor'), 'Search by game name...')
    assert.equal(casinoSearchLabel('all'), 'Search vendors')
    assert.equal(casinoSearchLabel('vendor'), 'Search games')
    assert.equal(casinoTableLabel('all'), 'Vendor breakdown')
    assert.equal(casinoTableLabel('vendor'), 'Game breakdown')
  })
})

describe('KPIs and trends', () => {
  const formatAmount = (value: number) => `₹${value.toFixed(2)}`
  const double = (value: number) => value * 2

  test('the four tiles keep the legacy figures and lines', () => {
    const tiles = casinoKpiTiles(
      {
        grossGamingRevenue: 100,
        holdPercentage: 0.0532,
        totalStakes: 1000,
        totalPayouts: 900,
        betCount: 12345,
        playerCount: 40,
        activePlayerCount: 12345,
      },
      formatAmount,
      double,
    )
    assert.deepEqual(tiles, [
      { key: 'ggr', label: 'Total GGR', value: '₹200.00', note: 'Hold: 5.32%' },
      { key: 'stakes', label: 'Total Stakes', value: '₹2000.00', note: 'Payouts: ₹1800.00' },
      { key: 'bets', label: 'Total Bets', value: (12345).toLocaleString(), note: 'Avg: 308.6/player' },
      { key: 'players', label: 'Active Players', value: '12345', note: '40 total' },
    ])
  })

  test('missing figures read zero and no players reads a dash', () => {
    const tiles = casinoKpiTiles({}, formatAmount, double)
    assert.deepEqual(
      tiles.map((tile) => [tile.value, tile.note]),
      [
        ['₹0.00', 'Hold: 0.00%'],
        ['₹0.00', 'Payouts: ₹0.00'],
        ['0', '—'],
        ['0', '0 total'],
      ],
    )
  })

  test('trend amounts are converted, bets are not', () => {
    assert.deepEqual(
      casinoTrendRows([{ date: '2026-10-01', stakes: 10, payouts: 6, ggr: 4, betCount: 3 }], double),
      [{ date: '2026-10-01', stakes: 20, payouts: 12, ggr: 8, betCount: 3 }],
    )
    assert.deepEqual(casinoTrendRows(null, double), [])
  })

  test('series and views keep their order and names; no series names a colour', () => {
    assert.deepEqual(CASINO_TREND_LINES.map((line) => line.name), ['Stakes', 'Payouts', 'GGR'])
    assert.ok(CASINO_TREND_LINES.every((line) => !('color' in line)))
    assert.deepEqual(CASINO_VIEWS.map((view) => view.label), ['Breakdown', 'Overview', 'Trends'])
  })
})
