import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { DrillDownLevel } from '@/state/reportingStore'
import {
  SPORTS_FILTER_KEYS,
  SPORTS_TREND_LINES,
  SPORTS_VIEW_TABS,
  currentSportsLevel,
  drillDownStep,
  entityName,
  entitySub,
  filterSportsRows,
  isPathFromOtherReport,
  levelDrills,
  levelHasDetails,
  levelSource,
  levelView,
  nextSportsLevel,
  searchLabel,
  searchPlaceholder,
  sortSportsRows,
  sportsActiveFilterCount,
  sportsColumns,
  sportsFilterChips,
  sportsKpiFigures,
  sportsPageRows,
  sportsReportFilter,
  sportsRowKey,
  sportsTableSummary,
  sportsTrendRows,
  winRateText,
  winRateTone,
  type SportsBreakdownRow,
  type SourceResult,
  type SportsSource,
} from './sportsOverviewReportModel'

const TODAY = '2026-10-07'
const CRICKET: DrillDownLevel = { type: 'sport', id: 'sp-1', name: 'Cricket' }
const IPL: DrillDownLevel = { type: 'league', id: 'lg-1', name: 'IPL' }
const MATCH: DrillDownLevel = { type: 'event', id: 'ev-1', name: 'MI vs CSK' }

describe('levels', () => {
  test('the hierarchy stops at event, and the current level is the last step or the root', () => {
    assert.equal(nextSportsLevel('all'), 'sport')
    assert.equal(nextSportsLevel('sport'), 'league')
    assert.equal(nextSportsLevel('league'), 'event')
    assert.equal(nextSportsLevel('event'), null)
    assert.equal(nextSportsLevel('agent'), null)
    assert.equal(currentSportsLevel([]), 'all')
    assert.equal(currentSportsLevel([CRICKET, IPL]), 'league')
  })

  test('a path with a step this report never pushes came from another report', () => {
    assert.equal(isPathFromOtherReport([]), false)
    assert.equal(isPathFromOtherReport([CRICKET, IPL, MATCH]), false)
    assert.equal(isPathFromOtherReport([{ type: 'market', id: 'm', name: 'M' }]), false)
    assert.equal(isPathFromOtherReport([{ type: 'vendor', id: 'v', name: 'Evolution' }]), true)
    assert.equal(isPathFromOtherReport([CRICKET, { type: 'player', id: 'p', name: 'P' }]), true)
  })

  test('each level reads its own query; event rows list markets and do not drill', () => {
    assert.deepStrictEqual(
      ['all', 'sport', 'league', 'event', 'market', 'agent'].map(levelSource),
      ['sports', 'league', 'event', 'market', null, null],
    )
    assert.deepStrictEqual(['all', 'sport', 'league', 'event', 'agent'].map(levelDrills), [true, true, true, false, false])
    assert.deepStrictEqual(['agent', 'player', 'all', 'event'].map(levelHasDetails), [true, true, false, false])
  })
})

describe('sportsReportFilter', () => {
  test('the root sends the store range, the currency and only the allowed store fields', () => {
    const filter = sportsReportFilter(
      {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        currency: 'INR',
        tenant: 't-1',
        domain: 'casino',
        schemeType: 'CREDIT',
        campaignId: 'c-1',
      },
      [],
      {},
      TODAY,
    )
    assert.deepStrictEqual(filter, {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      currency: 'INR',
      tenant: 't-1',
    })
    assert.deepStrictEqual(Object.keys(filter), ['dateFrom', 'dateTo', 'currency', 'tenant'])
  })

  test('an empty store falls back to all time through today, with the currency key left undefined', () => {
    const filter = sportsReportFilter(undefined, [], undefined, TODAY)
    assert.deepStrictEqual(Object.keys(filter), ['dateFrom', 'dateTo', 'currency'])
    assert.equal(filter.dateFrom, '2000-01-01')
    assert.equal(filter.dateTo, TODAY)
    assert.equal(filter.currency, undefined)
  })

  test('drill-down steps add their ids, and allowed active filters override, malformed ones are skipped', () => {
    const filter = sportsReportFilter(
      { dateFrom: '2000-01-01', dateTo: TODAY, sportId: 'stale' },
      [CRICKET, IPL, MATCH, { type: 'agent', id: 'ag-1', name: 'A' }, { type: 'player', id: 7, name: 'P' }],
      {
        agentId: { value: 'ag-9', label: 'Agent' },
        domain: { value: 'casino', label: 'Domain' },
        broken: null,
      },
      TODAY,
    )
    assert.equal(filter.sportId, 'sp-1')
    assert.equal(filter.leagueId, 'lg-1')
    assert.equal(filter.eventId, 'ev-1')
    assert.equal(filter.agentId, 'ag-9')
    assert.equal(filter.playerId, 7)
    assert.equal('domain' in filter, false)
    assert.ok(SPORTS_FILTER_KEYS.includes('playerId'))
  })
})

describe('rows', () => {
  const sources = (overrides: Partial<Record<SportsSource, SourceResult>> = {}): Record<SportsSource, SourceResult> => ({
    sports: { rows: [{ name: 'Cricket' }], loading: false },
    league: { rows: [{ leagueName: 'IPL' }], loading: true },
    event: { rows: undefined, loading: false },
    market: { rows: [{ marketName: 'Match Odds' }], loading: false },
    ...overrides,
  })
  const kpis = { totalStakes: 1 }

  test('levelView picks the level query with the KPIs; an unknown level shows nothing', () => {
    assert.deepStrictEqual(levelView('all', sources(), kpis), { data: [{ name: 'Cricket' }], loading: false, kpis })
    assert.deepStrictEqual(levelView('sport', sources(), kpis), { data: [{ leagueName: 'IPL' }], loading: true, kpis })
    assert.deepStrictEqual(levelView('league', sources(), kpis), { data: [], loading: false, kpis })
    assert.deepStrictEqual(levelView('event', sources(), kpis).data, [{ marketName: 'Match Odds' }])
    assert.deepStrictEqual(levelView('market', sources(), kpis), { data: [], loading: false, kpis: null })
  })

  test('drillDownStep pushes the next level with the row id and name, and nothing without an id', () => {
    assert.deepStrictEqual(drillDownStep('all', { id: 'sp-1', name: 'Cricket' }), CRICKET)
    assert.deepStrictEqual(drillDownStep('sport', { leagueId: 'lg-1', leagueName: 'IPL' }), IPL)
    assert.deepStrictEqual(drillDownStep('league', { eventId: 'ev-1', eventName: 'MI vs CSK' }), MATCH)
    assert.equal(drillDownStep('event', { marketId: 'mk-1' }), null)
    assert.equal(drillDownStep('all', { name: 'No id' }), null)
    assert.equal(drillDownStep('all', { id: 0, name: 'Zero' }), null)
    assert.equal(drillDownStep('agent', { agentId: 'a' }), null)
    // the name is carried as the row has it, as before
    assert.deepStrictEqual(drillDownStep('all', { id: 'sp-9' }), { type: 'sport', id: 'sp-9', name: undefined })
  })

  test('row keys follow the level id, else the page index', () => {
    assert.equal(sportsRowKey('all', { id: 'sp-1' }, 3), 'sp-1')
    assert.equal(sportsRowKey('all', {}, 3), 'sport-3')
    assert.equal(sportsRowKey('sport', {}, 0), 'league-0')
    assert.equal(sportsRowKey('league', { eventId: 'ev-1' }, 0), 'ev-1')
    assert.equal(sportsRowKey('event', {}, 1), 'market-1')
    assert.equal(sportsRowKey('agent', { agentId: 'ag' }, 1), 'ag')
    assert.equal(sportsRowKey('player', { playerId: 42 }, 1), '42')
    assert.equal(sportsRowKey('vendor', {}, 2), 'row-2')
  })

  test('search matches each level on its own fields, case-insensitively; a blank query keeps all', () => {
    const rows: SportsBreakdownRow[] = [
      { name: 'Cricket', leagueName: 'IPL', sportName: 'Cricket', eventName: 'MI vs CSK', marketName: 'Match Odds' },
      { name: 'Football', leagueName: 'EPL', sportName: 'Football', eventName: 'ARS vs CHE', marketName: 'Over/Under' },
      { agentName: 'Kiran', agentId: 'AG-1042', playerUsername: 'rahul', playerId: 991 },
    ]
    assert.equal(filterSportsRows(rows, 'all', '   ').length, 3)
    assert.deepStrictEqual(filterSportsRows(rows, 'all', 'FOOT').map((row) => row.name), ['Football'])
    assert.deepStrictEqual(filterSportsRows(rows, 'sport', 'cricket').map((row) => row.leagueName), ['IPL'])
    assert.deepStrictEqual(filterSportsRows(rows, 'league', 'ars').map((row) => row.eventName), ['ARS vs CHE'])
    assert.deepStrictEqual(filterSportsRows(rows, 'event', 'ipl').map((row) => row.marketName), ['Match Odds'])
    assert.deepStrictEqual(filterSportsRows(rows, 'event', 'over').map((row) => row.marketName), ['Over/Under'])
    assert.equal(filterSportsRows(rows, 'agent', 'ag-10').length, 1)
    assert.equal(filterSportsRows(rows, 'player', '99').length, 1)
    assert.equal(filterSportsRows(rows, 'vendor', 'anything').length, 3)
  })

  test('pages slice the filtered rows; the summary is the legacy text', () => {
    const rows = Array.from({ length: 25 }, (_, index) => index)
    assert.deepStrictEqual(sportsPageRows(rows, 1, 20), rows.slice(0, 20))
    assert.deepStrictEqual(sportsPageRows(rows, 2, 20), [20, 21, 22, 23, 24])
    assert.deepStrictEqual(sportsPageRows(rows, 4, 10), [])
    assert.equal(sportsTableSummary(25), 'Total 25 items')
  })
})

describe('columns', () => {
  const titles = (level: string) => sportsColumns(level).map((column) => column.title)

  test('each level keeps the legacy headers, keys and sortable figures', () => {
    const figures = ['Total Stakes', 'Total Payouts', 'GGR', 'Bets', 'Players']
    assert.deepStrictEqual(titles('all'), ['Sport', ...figures])
    assert.deepStrictEqual(titles('sport'), ['League', ...figures])
    assert.deepStrictEqual(titles('league'), ['Event', ...figures])
    assert.deepStrictEqual(titles('event'), ['Market', ...figures])
    assert.deepStrictEqual(titles('agent'), ['Agent', 'Total Stakes', 'GGR', 'Commission', 'Players'])
    assert.deepStrictEqual(titles('player'), ['Player', 'Total Stakes', 'Total Payouts', 'Avg Stake', 'Win Rate', 'Bets'])
    assert.deepStrictEqual(titles('market'), [])

    const root = sportsColumns('all')
    assert.deepStrictEqual(root.map((column) => column.key), ['sport', 'totalStakes', 'totalPayouts', 'ggr', 'betCount', 'playerCount'])
    assert.deepStrictEqual(root.map((column) => column.sortable), [false, true, true, true, true, true])
    assert.deepStrictEqual(root.map((column) => column.align), [undefined, 'right', 'right', 'right', 'right', 'right'])
    assert.equal(root[3].kind, 'ggr')
    // the agent columns were neither sortable nor aligned, and GGR was a plain amount there
    const agent = sportsColumns('agent')
    assert.ok(agent.every((column) => !column.sortable && column.align === undefined))
    assert.equal(agent[2].kind, 'amount')
  })

  test('entity cells print the name (N/A when missing) over the dim line', () => {
    const [sport] = sportsColumns('all')
    const [league] = sportsColumns('sport')
    const [player] = sportsColumns('player')
    assert.equal(entityName({ name: 'Cricket' }, sport), 'Cricket')
    assert.equal(entityName({}, sport), 'N/A')
    assert.equal(entitySub({}, sport), null)
    assert.equal(entitySub({ sportName: 'Cricket' }, league), 'Cricket')
    assert.equal(entitySub({}, league), '')
    assert.equal(entitySub({ playerId: 42 }, player), 'ID: 42')
  })

  test('sorting orders the given rows by the column figure, missing as 0, stable, and ignores unsortable keys', () => {
    const columns = sportsColumns('all')
    const rows = [
      { key: 'a', row: { name: 'A', totalStakes: 30 } },
      { key: 'b', row: { name: 'B', totalStakes: null } },
      { key: 'c', row: { name: 'C', totalStakes: 30 } },
      { key: 'd', row: { name: 'D', totalStakes: 10 } },
    ]
    const order = (sort: Parameters<typeof sortSportsRows>[1]) =>
      sortSportsRows(rows, sort, columns, (item) => item.row).map((item) => item.key).join('')
    assert.equal(order({ key: 'totalStakes', dir: 'asc' }), 'bdac')
    assert.equal(order({ key: 'totalStakes', dir: 'desc' }), 'acdb')
    assert.equal(order(null), 'abcd')
    assert.equal(order({ key: 'sport', dir: 'asc' }), 'abcd')
    assert.equal(order({ key: 'avgStake', dir: 'asc' }), 'abcd')
  })

  test('win rate reads as a percentage on the legacy tag colours', () => {
    assert.equal(winRateText(0.4567), '45.67%')
    assert.equal(winRateTone(0.51), 'neg')
    assert.equal(winRateTone(0.5), 'warn')
    assert.equal(winRateTone(0.31), 'warn')
    assert.equal(winRateTone(0.3), 'ok')
  })
})

describe('KPIs, filters and copy', () => {
  const money = (value: number) => `₹${value * 2}`

  test('the four cards keep their figures and notes', () => {
    assert.deepStrictEqual(
      sportsKpiFigures(
        { grossGamingRevenue: 900, holdPercentage: 0.1234, totalStakes: 9000, totalPayouts: 8100, betCount: 2300, playerCount: 75, activePlayerCount: 60 },
        money,
      ).map(({ label, value, note }) => [label, value, note]),
      [
        ['Total GGR', '₹1800', 'Hold: 12.34%'],
        ['Total Stakes', '₹18000', 'Payouts: ₹16200'],
        ['Total Bets', (2300).toLocaleString(), 'Avg: 30.7/player'],
        ['Active Players', '60', '75 total'],
      ],
    )
    const empty = sportsKpiFigures({}, money)
    assert.deepStrictEqual(empty.map((figure) => figure.note), ['Hold: 0.00%', 'Payouts: ₹0', '—', '0 total'])
    assert.deepStrictEqual(empty.map((figure) => figure.value), ['₹0', '₹0', '0', '0'])
  })

  test('the filter count is what Clear all resets: a search and a period other than All time', () => {
    assert.equal(sportsActiveFilterCount('', 'allTime'), 0)
    assert.equal(sportsActiveFilterCount('x', 'allTime'), 1)
    assert.equal(sportsActiveFilterCount('', 'today'), 1)
    assert.equal(sportsActiveFilterCount(' ', 'custom'), 2)
  })

  test('chips come from well-formed active filters, labelled by the key when unlabelled', () => {
    assert.deepStrictEqual(
      sportsFilterChips({
        agentId: { value: 'ag-9', label: 'Agent' },
        nameless: { value: 5 } as unknown as { value: number; label: string },
        broken: null,
        empty: undefined,
      }),
      [
        { key: 'agentId', label: 'Agent', value: 'ag-9' },
        { key: 'nameless', label: 'nameless', value: 5 },
      ],
    )
    assert.deepStrictEqual(sportsFilterChips(undefined), [])
  })

  test('search copy follows the level; the label is the placeholder without its ellipsis', () => {
    assert.deepStrictEqual(
      ['all', 'sport', 'league', 'event', 'agent', 'player'].map(searchPlaceholder),
      [
        'Search by sport name...',
        'Search by league name...',
        'Search by event name...',
        'Search by market name...',
        'Search by agent name, ID...',
        'Search by username, ID...',
      ],
    )
    assert.equal(searchLabel('event'), 'Search by market name')
  })

  test('trend points convert the three amounts and keep the bet count', () => {
    assert.deepStrictEqual(
      sportsTrendRows([{ date: '2026-10-01', stakes: 100, payouts: 60, ggr: 40, betCount: 5 }], (value) => value * 2),
      [{ date: '2026-10-01', stakes: 200, payouts: 120, ggr: 80, betCount: 5 }],
    )
    assert.deepStrictEqual(sportsTrendRows(null, (value) => value), [])
    assert.deepStrictEqual(SPORTS_TREND_LINES.map((line) => line.name), ['Stakes', 'Payouts', 'GGR'])
    assert.deepStrictEqual(SPORTS_VIEW_TABS.map((tab) => tab.label), ['Breakdown', 'Overview', 'Trends'])
  })
})
