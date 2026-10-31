import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { computeReportingDateRange } from '@/modules/reporting/reportingDateFilter'
import {
  AGENT_PERF_ALL_DOMAINS,
  AGENT_PERF_COMPARATORS,
  AGENT_TYPE_OPTIONS,
  agentAllowedDomains,
  agentCut,
  agentDomainCut,
  agentPerfAllTimeRange,
  agentPerfClearableFilterCount,
  agentPerfColumns,
  agentPerfCountText,
  agentPerfCurrentLevel,
  agentPerfDomainOptions,
  agentPerfFilter,
  agentPerfKpiTiles,
  agentPerfLevelData,
  agentPerfLevelsToRemove,
  agentPerfPageRows,
  agentPerfRootLabel,
  agentPerfRowKey,
  agentPerfSearchPlaceholder,
  agentPerfShowDomainBreakdown,
  agentPerfTableTitle,
  agentPerfTotalText,
  agentPerfTotalsCells,
  clampAgentPerfPage,
  filterAgentPerfRows,
  sortAgentPerfPage,
  winRateText,
  winRateTone,
  type AgentPerfRow,
  type AgentPerfTotals,
} from './agentPerformanceReportModel'

function row(fields: Partial<AgentPerfRow>): AgentPerfRow {
  return {
    totalTurnover: 0,
    totalGGR: 0,
    commissionEarned: 0,
    shareEarned: 0,
    playerCount: 0,
    betCount: 0,
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    avgStake: 0,
    winRate: 0,
    ...fields,
  }
}

const money = (value: number) => `₹${value.toFixed(2)}`

const TOTALS: AgentPerfTotals = {
  totalTurnover: 900,
  totalGGR: 120,
  commissionEarned: 30,
  shareEarned: 12,
  agentCount: 3,
  playerCount: 1500,
  betCount: 22000,
}

describe('agentPerformanceReportModel', () => {
  test('All time runs from 2000-01-01 through the IST day', () => {
    assert.deepStrictEqual(agentPerfAllTimeRange('2026-10-07'), { dateFrom: '2000-01-01', dateTo: '2026-10-07' })
    assert.deepStrictEqual(agentPerfAllTimeRange(), computeReportingDateRange('allTime'))
  })

  test('levels and the crumb arithmetic', () => {
    assert.equal(agentPerfCurrentLevel([]), 'all')
    assert.equal(agentPerfCurrentLevel([{ type: 'agent', id: 'a', name: 'A' }, { type: 'player', id: 1, name: 'p' }]), 'player')
    assert.equal(agentPerfLevelsToRemove(3, 0), 2)
    assert.equal(agentPerfLevelsToRemove(3, 2), 0)
  })

  test('the filter: store fields, the period and currency defaults, domain and scheme, then the path and chips', () => {
    const filter = agentPerfFilter({
      filters: { tenant: 'core', dateFrom: '', currency: undefined, domain: 'casino', schemeType: 'CREDIT' },
      drillDownPath: [
        { type: 'sport', id: 4, name: 'Cricket' },
        { type: 'agent', id: 'ag-1', name: 'Kiran' },
        { type: 'player', id: 9, name: 'p9' },
      ],
      activeFilters: { campaignId: { value: 'c-1', label: 'Campaign' } },
      selectedDomain: 'sports',
      selectedAgentType: 'SHARING',
      isAgent: false,
      agentId: 'me',
      allowedDomains: AGENT_PERF_ALL_DOMAINS,
      todayDay: '2026-10-07',
    })
    assert.deepStrictEqual(filter, {
      tenant: 'core',
      dateFrom: '2000-01-01',
      currency: undefined,
      domain: 'sports',
      schemeType: 'SHARING',
      dateTo: '2026-10-07',
      agentId: 'ag-1',
      playerId: 9,
      campaignId: 'c-1',
    })
    assert.deepStrictEqual(Object.keys(filter), [
      'tenant', 'dateFrom', 'currency', 'domain', 'schemeType', 'dateTo', 'agentId', 'playerId', 'campaignId',
    ])
  })

  test('agent branches: one allowed domain scopes All Domains, and the agent sees their sub-agents', () => {
    const base = {
      filters: { dateFrom: '2026-10-01', dateTo: '2026-10-02' },
      drillDownPath: [],
      activeFilters: {},
      selectedDomain: 'all',
      selectedAgentType: 'COMMISSION',
      todayDay: '2026-10-07',
    }
    assert.deepStrictEqual(
      agentPerfFilter({ ...base, isAgent: true, agentId: 'ag-9', allowedDomains: ['casino'] }),
      {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-02',
        currency: undefined,
        domain: 'casino',
        schemeType: 'COMMISSION',
        parentAgentId: 'ag-9',
      },
    )
    const twoDomains = agentPerfFilter({ ...base, isAgent: true, agentId: 'ag-9', allowedDomains: ['casino', 'matka'] })
    assert.equal(twoDomains.domain, undefined)
    assert.ok('domain' in twoDomains)
    const admin = agentPerfFilter({ ...base, isAgent: false, agentId: 'ag-9', allowedDomains: ['casino'] })
    assert.equal(admin.domain, undefined)
    assert.equal('parentAgentId' in admin, false)
    const noId = agentPerfFilter({ ...base, isAgent: true, agentId: undefined, allowedDomains: ['casino'] })
    assert.equal('parentAgentId' in noId, false)
  })

  test('allowed domains fall back to all three, and the rail lists what the caller may see', () => {
    assert.deepStrictEqual([...agentAllowedDomains(undefined)], ['sports', 'casino', 'matka'])
    assert.deepStrictEqual([...agentAllowedDomains(['matka'])], ['matka'])
    assert.deepStrictEqual(agentPerfDomainOptions(false, ['matka']), ['all', 'sports', 'casino', 'matka'])
    assert.deepStrictEqual(agentPerfDomainOptions(true, ['matka', 'sports']), ['all', 'sports', 'matka'])
    assert.deepStrictEqual(agentPerfDomainOptions(true, []), ['all'])
    assert.deepStrictEqual(AGENT_TYPE_OPTIONS.map((option) => `${option.value}:${option.label}`), [
      'COMMISSION:Commission',
      'SHARING:Sharing',
      'CREDIT:Credit',
    ])
  })

  test('level data: agents with totals over the KPIs, players, and nothing for another report level', () => {
    const agents = [row({ agentId: 'a' })]
    const kpis = { totalTurnover: 1, agentCount: 9, playerCount: 4 }
    const top = agentPerfLevelData('all', { agents, totals: TOTALS }, [], kpis)
    assert.equal(top.data, agents)
    assert.equal(top.totals, TOTALS)
    assert.equal(top.source, 'performance')
    assert.deepStrictEqual(top.kpis, { ...kpis, ...TOTALS })
    const noTotals = agentPerfLevelData('agent', { agents }, [], kpis)
    assert.equal(noTotals.totals, null)
    assert.equal(noTotals.kpis, kpis)
    assert.deepStrictEqual(agentPerfLevelData('agent', undefined, undefined, undefined).data, [])
    const players = [row({ playerId: 1 })]
    const playerLevel = agentPerfLevelData('player', { agents, totals: TOTALS }, players, kpis)
    assert.equal(playerLevel.data, players)
    assert.equal(playerLevel.totals, null)
    assert.equal(playerLevel.kpis, kpis)
    assert.equal(playerLevel.source, 'players')
    assert.deepStrictEqual(agentPerfLevelData('sport', { agents }, players, kpis), {
      data: [],
      totals: null,
      source: null,
      kpis: null,
    })
    assert.equal(agentPerfShowDomainBreakdown(TOTALS, 'all'), true)
    assert.equal(agentPerfShowDomainBreakdown(TOTALS, 'player'), false)
    assert.equal(agentPerfShowDomainBreakdown(null, 'agent'), false)
  })

  test('the agent columns follow the agent type, with the domain cuts after Players as the legacy splice put them', () => {
    const keys = (type: string | undefined, breakdown: boolean) =>
      agentPerfColumns('all', breakdown, type).map((column) => column.key).join(',')
    assert.equal(keys('COMMISSION', false), 'agent,totalGGR,cut,commission,playerCount,betCount')
    assert.equal(keys('SHARING', false), 'agent,totalGGR,cut,playerCount,betCount')
    assert.equal(keys('CREDIT', false), 'agent,totalGGR,cut,commission,share,playerCount,betCount')
    assert.equal(keys('OTHER', false), 'agent,totalGGR,cut,commission,share,playerCount,betCount')
    assert.equal(keys('COMMISSION', true), 'agent,totalGGR,cut,commission,playerCount,sportsCut,casinoCut,matkaCut,betCount')
    assert.equal(keys('SHARING', true), 'agent,totalGGR,cut,playerCount,sportsCut,casinoCut,matkaCut,betCount')
    assert.equal(keys('CREDIT', true), 'agent,totalGGR,cut,commission,share,playerCount,sportsCut,casinoCut,matkaCut,betCount')
    assert.deepStrictEqual(
      agentPerfColumns('agent', true, 'CREDIT').map((c) => `${c.title}:${c.align ?? 'left'}:${c.sortable}`),
      [
        'Agent:left:false',
        'Total GGR:right:true',
        'Cut:right:true',
        'Commission:right:true',
        'Share:right:true',
        'Players:right:true',
        'Sports Cut:right:false',
        'Casino Cut:right:false',
        'Matka Cut:right:false',
        'Bets:right:true',
      ],
    )
    assert.deepStrictEqual(
      agentPerfColumns('player', true, 'CREDIT').map((c) => `${c.key}:${c.title}:${c.sortable}`),
      [
        'player:Player:false',
        'totalStakes:Total Stakes:true',
        'totalPayouts:Total Payouts:true',
        'ggr:GGR:true',
        'avgStake:Avg Stake:true',
        'winRate:Win Rate:true',
        'betCount:Bets:true',
      ],
    )
    assert.deepStrictEqual(agentPerfColumns('sport', true, 'CREDIT'), [])
  })

  test('cuts: commission plus share, and each domain cut with its percentage line when all three are sent', () => {
    assert.equal(agentCut({ commissionEarned: 30, shareEarned: 12 }), 42)
    assert.equal(agentCut({ commissionEarned: null as unknown as number, shareEarned: 5 }), 5)
    const record = {
      domainBreakdown: [
        { domain: 'sports', cut: 80, userCutPercent: 90, agentCutPercent: 85, cutPercent: 5 },
        { domain: 'casino', cut: 12.5, userCutPercent: 70, agentCutPercent: null, cutPercent: 2 },
      ],
    }
    assert.deepStrictEqual(agentDomainCut(record, 'sports'), { cut: 80, formula: '90.0% − 85.0% = 5.0%' })
    assert.deepStrictEqual(agentDomainCut(record, 'casino'), { cut: 12.5, formula: null })
    assert.deepStrictEqual(agentDomainCut(record, 'matka'), { cut: 0, formula: null })
    assert.deepStrictEqual(agentDomainCut({ domainBreakdown: null }, 'sports'), { cut: 0, formula: null })
  })

  test('the totals row puts each figure under its own column', () => {
    assert.deepStrictEqual(agentPerfTotalsCells(TOTALS, money), {
      agent: 'Total',
      totalGGR: '₹120.00',
      cut: '₹42.00',
      commission: '₹30.00',
      share: '₹12.00',
      sportsCut: '—',
      casinoCut: '—',
      matkaCut: '—',
      playerCount: (1500).toLocaleString(),
      betCount: (22000).toLocaleString(),
    })
  })

  test('search, placeholders, keys and copy', () => {
    const agents = [row({ agentName: 'Kiran D.', agentId: 'ag-1042' }), row({ agentName: null, agentId: 'AG-1088' })]
    assert.equal(filterAgentPerfRows(agents, 'all', '').length, 2)
    assert.equal(filterAgentPerfRows(agents, 'agent', 'KIR').length, 1)
    assert.equal(filterAgentPerfRows(agents, 'all', '1088').length, 1)
    const players = [row({ playerUsername: 'Riya', playerId: 41 }), row({ playerUsername: null, playerId: 7 })]
    assert.equal(filterAgentPerfRows(players, 'player', 'ri').length, 1)
    assert.equal(filterAgentPerfRows(players, 'player', '7').length, 1)
    assert.equal(filterAgentPerfRows(players, 'sport', 'zzz').length, 2)

    assert.equal(agentPerfSearchPlaceholder('player'), 'Search by username, ID...')
    assert.equal(agentPerfSearchPlaceholder('all'), 'Search by agent name, ID...')
    assert.equal(agentPerfRowKey('all', row({ agentId: 'ag-1' }), 0), 'ag-1')
    assert.equal(agentPerfRowKey('agent', row({}), 2), 'agent-2')
    assert.equal(agentPerfRowKey('player', row({ playerId: 41 }), 0), '41')
    assert.equal(agentPerfRowKey('player', row({}), 3), 'player-3')
    assert.equal(agentPerfRowKey('sport', row({}), 4), 'row-4')

    assert.equal(agentPerfTableTitle('all'), 'Agent Performance')
    assert.equal(agentPerfTableTitle('player'), 'Player Performance')
    assert.equal(agentPerfCountText(1, 'all'), '1 agent')
    assert.equal(agentPerfCountText(0, 'agent'), '0 agents')
    assert.equal(agentPerfCountText(1, 'player'), '1 player')
    assert.equal(agentPerfCountText(12, 'player'), '12 players')
    assert.equal(agentPerfRootLabel('agent'), 'All Agents')
    assert.equal(agentPerfRootLabel('player'), 'All Players')
    assert.equal(agentPerfTotalText(5, 'all'), 'Total 5 agents')
    assert.equal(agentPerfTotalText(5, 'player'), 'Total 5 players')
    assert.equal(agentPerfClearableFilterCount('', 'allTime'), 0)
    assert.equal(agentPerfClearableFilterCount('x', 'yesterday'), 2)
  })

  test('a sort orders the page by the legacy comparators, the cut as commission plus share', () => {
    const rows = [
      row({ agentId: 'b', commissionEarned: 5, shareEarned: 10, totalGGR: 3, playerCount: 2 }),
      row({ agentId: 'a', commissionEarned: 20, shareEarned: 0, totalGGR: 1, playerCount: 9 }),
      row({ agentId: 'c', commissionEarned: 1, shareEarned: 1, totalGGR: 2, playerCount: 5 }),
    ]
    const ids = (sorted: AgentPerfRow[]) => sorted.map((r) => r.agentId).join('')
    assert.equal(ids(sortAgentPerfPage(rows, null)), 'bac')
    assert.equal(ids(sortAgentPerfPage(rows, { key: 'cut', dir: 'asc' })), 'cba')
    assert.equal(ids(sortAgentPerfPage(rows, { key: 'cut', dir: 'desc' })), 'abc')
    assert.equal(ids(sortAgentPerfPage(rows, { key: 'totalGGR', dir: 'asc' })), 'acb')
    assert.equal(ids(sortAgentPerfPage(rows, { key: 'playerCount', dir: 'desc' })), 'acb')
    assert.equal(ids(sortAgentPerfPage(rows, { key: 'sportsCut', dir: 'asc' })), 'bac')
    assert.deepStrictEqual(Object.keys(AGENT_PERF_COMPARATORS).sort(), [
      'avgStake', 'betCount', 'commission', 'cut', 'ggr', 'playerCount', 'share', 'totalGGR', 'totalPayouts', 'totalStakes', 'winRate',
    ])
  })

  test('paging and the win-rate pill', () => {
    const rows = Array.from({ length: 25 }, (_, index) => index)
    assert.deepStrictEqual(agentPerfPageRows(rows, 2, 20), [20, 21, 22, 23, 24])
    assert.equal(clampAgentPerfPage(5, 25, 20), 2)
    assert.equal(clampAgentPerfPage(1, 0, 20), 1)
    assert.equal(winRateText(0.12345), '12.35%')
    assert.equal(winRateTone(0.6), 'neg')
    assert.equal(winRateTone(0.4), 'warn')
    assert.equal(winRateTone(0.2), 'ok')
  })

  test('the four figures keep the legacy values and notes', () => {
    assert.deepStrictEqual(
      agentPerfKpiTiles(
        { totalTurnover: 3421000, totalGGR: 812400, commissionEarned: 68420, shareEarned: 1000, agentCount: 4, playerCount: 1004, betCount: 42000 },
        money,
      ).map(({ label, value, note, hue, icon }) => ({ label, value, note, hue, icon })),
      [
        { label: 'Total Turnover', value: '₹3421000.00', note: '4 agents', hue: 'blu', icon: 'chart' },
        { label: 'Total GGR', value: '₹812400.00', note: `${(42000).toLocaleString()} bets`, hue: 'grn', icon: 'cash' },
        { label: 'Commission', value: '₹68420.00', note: 'Share: ₹1000.00', hue: 'ind', icon: 'percent' },
        { label: 'Active Agents', value: 4, note: '1004 players', hue: 'red', icon: 'users' },
      ],
    )
    assert.deepStrictEqual(agentPerfKpiTiles({}, money).map((tile) => [tile.value, tile.note]), [
      ['₹0.00', '0 agents'],
      ['₹0.00', '0 bets'],
      ['₹0.00', 'Share: ₹0.00'],
      [0, '0 players'],
    ])
  })
})
