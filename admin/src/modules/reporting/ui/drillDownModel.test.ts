import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  activeFilterCount,
  agentEmptyText,
  agentOptionsFrom,
  agentSearchSkipped,
  betStatusTone,
  campaignEmptyText,
  campaignOptionsFrom,
  casinoBetPnl,
  categorySlot,
  cellValue,
  clearableOptions,
  clearedFilters,
  compactAxisValue,
  contextChartCopy,
  contextLabel,
  distributionData,
  domainRootLabel,
  drillDownSummary,
  filterRangePreset,
  formatKpiValue,
  formatTrendAxisDate,
  hasCasinoContext,
  hasSportsContext,
  kpiDisplayValue,
  kpiHue,
  kpiSecondaryNote,
  kpiTrendDelta,
  levelKpis,
  lineSlots,
  noSelectionMessage,
  pieLabelText,
  plainCell,
  resolveRowKey,
  seriesLegend,
  seriesSlots,
  signedAmount,
  sportsBetPnl,
  trendTooltipValue,
  type FilterVisibility,
} from './drillDownModel'

const ALL_VISIBLE: FilterVisibility = {
  showDomainFilter: true,
  showCurrencyFilter: true,
  showAgentFilter: true,
  showCampaignFilter: true,
}
const NONE_VISIBLE: FilterVisibility = {
  showDomainFilter: false,
  showCurrencyFilter: false,
  showAgentFilter: false,
  showCampaignFilter: false,
}

describe('KPI values', () => {
  test('a string passes through, then the formatter, the precision, else two decimals', () => {
    assert.equal(formatKpiValue({ title: 'A', value: 'n/a', formatter: () => 'x' }, 'en-IN'), 'n/a')
    assert.equal(formatKpiValue({ title: 'A', value: 5, formatter: (v) => `F${v}`, precision: 0 }, 'en-IN'), 'F5')
    assert.equal(formatKpiValue({ title: 'A', value: 1234567.891, precision: 1 }, 'en-IN'), '12,34,567.9')
    assert.equal(formatKpiValue({ title: 'A', value: 1234567.891 }, 'en-US'), '1,234,567.89')
  })

  test('the suffix is appended and the prefix is ignored, as the legacy grid did', () => {
    assert.equal(kpiDisplayValue({ title: 'ROI', value: 12.5, suffix: '%', precision: 2, prefix: '₹' }, 'en-US'), '12.50%')
  })

  test('tile hues cycle through the seven legacy slots', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(kpiHue), ['grn', 'blu', 'amb', 'ind', 'vio', 'amb', 'grn', 'grn'])
  })

  test('a trend states its direction in words with the magnitude', () => {
    assert.deepEqual(kpiTrendDelta({ value: 4.256, isPositive: true }), { value: '4.26%', dir: 'up', note: 'vs previous' })
    assert.deepEqual(kpiTrendDelta({ value: -3, isPositive: false }), { value: '3.00%', dir: 'down', note: 'vs previous' })
  })

  test('the secondary row shows only without a trend', () => {
    assert.equal(kpiSecondaryNote({ title: 'A', value: 1, secondaryLabel: 'Avg', secondaryValue: 3 }), 'Avg: 3')
    assert.equal(kpiSecondaryNote({ title: 'A', value: 1, secondaryLabel: 'Avg' }), 'Avg: ')
    assert.equal(
      kpiSecondaryNote({ title: 'A', value: 1, secondaryLabel: 'Avg', trend: { value: 1, isPositive: true } }),
      undefined,
    )
    assert.equal(kpiSecondaryNote({ title: 'A', value: 1 }), undefined)
  })
})

describe('level KPIs', () => {
  const fmt = (v: number) => `₹${v}`
  const half = (v: number) => v / 2
  const titles = (level: string, domain: string, data: unknown) =>
    levelKpis(level, domain, data, fmt, half).map((k) => k.title)

  test('no data gives no figures', () => {
    assert.deepEqual(levelKpis('all', 'sports', null, fmt, half), [])
  })

  test('each level and domain keeps its legacy figures in order', () => {
    assert.deepEqual(titles('all', 'bonuses', {}), [
      'Total Issued', 'Total Redeemed', 'Outstanding Liability', 'Total Revenue', 'ROI', 'Awards', 'Players',
    ])
    assert.deepEqual(titles('campaign', 'sports', {}), titles('all', 'bonuses', {}))
    for (const level of ['all', 'sport', 'league', 'event']) {
      assert.deepEqual(titles(level, 'sports', {}), [
        'Total Stakes', 'Total Payouts', 'Gross Gaming Revenue', 'Hold Percentage', 'Total Bets', 'Active Players',
      ])
    }
    assert.deepEqual(titles('agent', 'sports', {}), ['Total Turnover', 'Total GGR', 'Commission Earned', 'Player Count'])
    assert.deepEqual(titles('player', 'bonuses', {}), [
      'Total Issued', 'Total Redeemed', 'Total Expired', 'Avg Amount', 'Redemption Rate', 'Awards',
    ])
    assert.deepEqual(titles('player', 'casino', {}), ['Total Stakes', 'Total Payouts', 'Average Stake', 'Win Rate', 'Total Bets'])
    assert.deepEqual(titles('market', 'matka', {}), [])
  })

  test('amounts are converted and formatted, rates become percentages, counts use the default locale', () => {
    const kpis = levelKpis('sport', 'sports', { totalStakes: 200, holdPercentage: 0.1234, betCount: 1500, playerCount: 7 }, fmt, half)
    assert.equal(kpis[0].value, 100)
    assert.equal(kpis[0].formatter?.(100), '₹100')
    assert.equal(kpis[3].value, 12.34)
    assert.equal(kpis[3].suffix, '%')
    assert.equal(kpis[3].precision, 2)
    assert.equal(kpis[4].formatter?.(1500), (1500).toLocaleString())
    assert.equal(kpis[5].value, 7, 'active players fall back to player count')
  })

  test('the agent level falls back field by field', () => {
    const kpis = levelKpis('agent', 'sports', { totalStakes: 10, grossGamingRevenue: 4, commission: 2, playerCount: 3 }, fmt, half)
    assert.deepEqual(kpis.map((k) => k.value), [5, 2, 1, 3])
  })
})

describe('filters bar', () => {
  test('a whole date range counts once; other filters count only when shown', () => {
    const filters = { dateFrom: '2026-01-01', dateTo: '2026-01-31', currency: 'INR', domain: 'casino' as const, agentId: 'a1', campaignId: 'c1' }
    assert.equal(activeFilterCount(filters, ALL_VISIBLE), 5)
    assert.equal(activeFilterCount(filters, NONE_VISIBLE), 1)
    assert.equal(activeFilterCount({ dateFrom: '2026-01-01' }, ALL_VISIBLE), 0, 'half a range is not a filter')
  })

  test('clear all keeps a hidden currency', () => {
    const filters = { dateFrom: '2026-01-01', dateTo: '2026-01-31', currency: 'INR' }
    assert.deepEqual(clearedFilters(filters, NONE_VISIBLE), {
      dateFrom: undefined, dateTo: undefined, currency: 'INR', domain: undefined, agentId: undefined, campaignId: undefined,
    })
    assert.equal(clearedFilters(filters, ALL_VISIBLE).currency, undefined)
  })

  test('the date field reads custom only for a whole range', () => {
    assert.equal(filterRangePreset({ dateFrom: '2000-01-01', dateTo: '2026-10-07' }), 'custom')
    assert.equal(filterRangePreset({ dateFrom: '2000-01-01' }), 'all')
    assert.equal(filterRangePreset({}), 'all')
  })

  test('the agent search is skipped while hidden or one character long', () => {
    assert.equal(agentSearchSkipped(false, ''), true)
    assert.equal(agentSearchSkipped(true, ''), false)
    assert.equal(agentSearchSkipped(true, ' a '), true)
    assert.equal(agentSearchSkipped(true, 'ab'), false)
  })

  test('agent and campaign options keep the legacy labels', () => {
    assert.deepEqual(
      agentOptionsFrom({ agents: { agentsPage: { items: [{ id: 7, username: 'raj', phone: '98' }, { id: 'a2', username: 'lee', phone: null }] } } }),
      [{ label: 'raj (98)', value: '7' }, { label: 'lee', value: 'a2' }],
    )
    assert.deepEqual(agentOptionsFrom(undefined), [])
    assert.deepEqual(
      campaignOptionsFrom({ bonusCampaigns: [{ id: 'c1', name: 'Diwali', status: 'active' }, { id: 'c2', name: 'Plain', status: null }] }),
      [{ label: 'Diwali (active)', value: 'c1' }, { label: 'Plain', value: 'c2' }],
    )
  })

  test('the empty-list text follows the legacy notFoundContent', () => {
    assert.equal(agentEmptyText(true, ''), 'Loading agents')
    assert.equal(agentEmptyText(false, 'a'), 'Type at least 2 characters')
    assert.equal(agentEmptyText(false, 'ab'), 'No agents found')
    assert.equal(agentEmptyText(false, ''), 'No agents found')
    assert.equal(campaignEmptyText(false), 'No campaigns found')
    assert.equal(campaignEmptyText(true), 'Loading campaigns')
  })

  test('a clearable select offers All, keeps a retained value and says why it is empty', () => {
    assert.deepEqual(clearableOptions('All agents', [{ label: 'raj', value: '7' }], '7', 'No agents found'), [
      { label: 'All agents', value: '' },
      { label: 'raj', value: '7' },
    ])
    assert.deepEqual(clearableOptions('All agents', [], 'gone', 'No agents found'), [
      { label: 'All agents', value: '' },
      { label: 'gone', value: 'gone' },
      { label: 'No agents found', value: '__empty__', disabled: true },
    ])
  })
})

describe('charts', () => {
  const formatDate = (value: string, pattern: string) => `${pattern}|${value}`

  test('axis dates format only when they parse', () => {
    assert.equal(formatTrendAxisDate('2026-09-22', formatDate), 'MMM d|2026-09-22')
    assert.equal(formatTrendAxisDate('n/a', formatDate), 'n/a')
    assert.equal(
      formatTrendAxisDate('2026-09-22', () => {
        throw new Error('bad')
      }),
      '2026-09-22',
    )
  })

  test('the Y axis compacts thousands and millions', () => {
    assert.equal(compactAxisValue(2500000), '2.5M')
    assert.equal(compactAxisValue(1000), '1.0K')
    assert.equal(compactAxisValue(999), '999')
    assert.equal(compactAxisValue(-5000), '-5000')
  })

  test('tooltip figures use the line formatter, else two decimals', () => {
    assert.equal(trendTooltipValue(3, 'en-US', (v) => `#${v}`), '#3')
    assert.equal(trendTooltipValue(1234.5, 'en-US'), '1,234.50')
  })

  test('three or fewer series take the ramp; more take the hue ramp', () => {
    assert.deepEqual(seriesSlots(3), ['s1', 's2', 's3'])
    assert.deepEqual(seriesSlots(1), ['s1'])
    assert.deepEqual(seriesSlots(4), ['hInd', 'hRed', 'hGrn', 'hVio'])
    assert.deepEqual(seriesSlots(0), [])
    assert.deepEqual([0, 5, 6].map(categorySlot), ['hInd', 'hAmb', 'hInd'])
  })

  test('a line keeps a slot it names; the rest take their place on the ramp', () => {
    assert.deepEqual(lineSlots([{}, {}, {}]), ['s1', 's2', 's3'])
    assert.deepEqual(lineSlots([{}, { slot: 'hRed' }, {}, {}]), ['hInd', 'hRed', 'hGrn', 'hVio'])
    assert.deepEqual(lineSlots([]), [])
  })

  test('the legend lists the series in their own order, not by name, each on its line slot', () => {
    // recharts 3 would sort these by name (GGR, Payouts, Stakes) and colour by position
    assert.deepEqual(
      seriesLegend([
        { key: 'stakes', name: 'Stakes' },
        { key: 'payouts', name: 'Payouts' },
        { key: 'ggr', name: 'GGR' },
      ]),
      [
        { key: 'stakes', name: 'Stakes', slot: 's1' },
        { key: 'payouts', name: 'Payouts', slot: 's2' },
        { key: 'ggr', name: 'GGR', slot: 's3' },
      ],
    )
  })

  test('the bonus trend keeps the legacy reading: redeemed green, expired red', () => {
    assert.deepEqual(
      seriesLegend(contextChartCopy('bonuses').lines).map((item) => `${item.name}:${item.slot}`),
      ['Issued:hInd', 'Redeemed:hGrn', 'Expired:hRed', 'Revenue:hAmb'],
    )
    assert.deepEqual(
      seriesLegend(contextChartCopy('sports').lines).map((item) => `${item.name}:${item.slot}`),
      ['Stakes:s1', 'Payouts:s2', 'GGR:s3'],
    )
  })

  test('distribution rows keep the top ten and rename per domain', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, totalStakes: i, grossGamingRevenue: i * 2 }))
    assert.equal(distributionData('sports', rows).length, 10)
    assert.equal(distributionData('sports', rows)[0], rows[0], 'sports rows pass through untouched')
    assert.deepEqual(distributionData('bonuses', [{ campaignName: null, totalIssued: 5, totalRedeemed: 2 }]), [
      { name: 'Unknown', totalStakes: 5, grossGamingRevenue: 2 },
    ])
    assert.deepEqual(distributionData('casino', [{ vendorName: 'Evo', totalStakes: 9 }]), [
      { name: 'Evo', totalStakes: 9, grossGamingRevenue: 0 },
    ])
    assert.deepEqual(distributionData('casino', undefined), [])
  })

  test('chart copy follows the domain', () => {
    assert.equal(contextChartCopy('bonuses').trendTitle, 'Bonus Trends')
    assert.deepEqual(contextChartCopy('bonuses').lines.map((l) => l.name), ['Issued', 'Redeemed', 'Expired', 'Revenue'])
    assert.equal(contextChartCopy('matka').barTitle, 'Top Performers (Stakes)')
    assert.equal(contextChartCopy('casino').pieTitle, 'Distribution (GGR)')
    assert.equal(pieLabelText('Cricket', 0.426), 'Cricket: 43%')
  })
})

describe('table and breadcrumbs', () => {
  test('cells read a key or a path, and print scalars only', () => {
    assert.equal(cellValue({ a: { b: 3 } }, ['a', 'b']), 3)
    assert.equal(cellValue({ a: 1 }, 'a'), 1)
    assert.equal(cellValue({ a: null }, ['a', 'b']), undefined)
    assert.equal(cellValue({ a: { b: 3 } }, ['a', 'b', 'c']), undefined)
    assert.equal(plainCell(0), '0')
    assert.equal(plainCell(null), '')
    assert.equal(plainCell({}), '')
  })

  test('a column with no dataIndex hands render the record itself, as rc-table does', () => {
    const row = { id: 7, name: 'Cricket' }
    assert.equal(cellValue(row, undefined), row)
    assert.equal(cellValue(row, null), row)
    assert.equal(cellValue(row, ''), row)
    assert.equal(cellValue(row, []), row)
    // a legacy `render: (record) => record.name` column
    const render = (record: typeof row) => record.name
    assert.equal(render(cellValue(row, undefined) as typeof row), 'Cricket')
    // printed without a render, the record is not a scalar and the cell stays blank
    assert.equal(plainCell(cellValue(row, undefined)), '')
  })

  test('row keys come from a field or a function', () => {
    assert.equal(resolveRowKey('id', { id: 12 }), '12')
    assert.equal(resolveRowKey((r: { id: number }) => `k${r.id}`, { id: 12 }), 'k12')
    assert.equal(drillDownSummary(42), 'Total 42 items')
  })

  test('the root crumb names the domain', () => {
    assert.equal(domainRootLabel('sports'), 'All Sports')
    assert.equal(domainRootLabel('bonuses'), 'All Bonuses')
  })
})

describe('detail drawer', () => {
  test('a context needs a drilled level of its own domain', () => {
    assert.equal(hasSportsContext('sports', { leagueId: 'l1' }), true)
    assert.equal(hasSportsContext('sports', { dateFrom: '2026-01-01' }), false)
    assert.equal(hasSportsContext('casino', { sportId: 's1' }), false)
    assert.equal(hasCasinoContext('casino', { vendorId: 0 }), true, 'vendor id 0 is a real vendor')
    assert.equal(hasCasinoContext('casino', {}), false)
    assert.equal(hasCasinoContext('casino', undefined), false)
  })

  test('the context tag names the deepest level', () => {
    assert.equal(contextLabel('sports', { sportId: 's', leagueId: 'l', eventId: 'e' }), 'Event')
    assert.equal(contextLabel('sports', { sportId: 's', leagueId: 'l' }), 'League')
    assert.equal(contextLabel('sports', { sportId: 's' }), 'Sport')
    assert.equal(contextLabel('casino', { vendorId: 3, gameId: 9 }), 'Game')
    assert.equal(contextLabel('casino', { vendorId: 3 }), 'Vendor')
    assert.equal(contextLabel('matka', {}), 'All')
    assert.match(noSelectionMessage('casino'), /^Drill into a vendor/)
    assert.match(noSelectionMessage('sports'), /^Drill into a sport/)
  })

  test('sports P/L: unsettled is blank; odds, fancy back and fancy lay', () => {
    assert.equal(sportsBetPnl({ id: '1', status: 'matched', stake: 10 }), null)
    assert.equal(sportsBetPnl({ id: '1', status: 'won', stake: 100, price: 2.5 }), 150)
    assert.equal(sportsBetPnl({ id: '1', status: 'lost', stake: 100, price: 2.5 }), -100)
    assert.equal(sportsBetPnl({ id: '1', status: 'won', side: 'back', oddsSize: 90, result: ' 45 ' }), 45)
    assert.equal(sportsBetPnl({ id: '1', status: 'won', side: 'lay', oddsSize: 90, result: '45', liability: 30 }), 15)
    assert.equal(sportsBetPnl({ id: '1', status: 'won', side: 'back', oddsSize: 90, result: '' }), 0)
    assert.equal(sportsBetPnl({ id: '1', status: 'lost', side: 'back', oddsSize: 90, stake: 20 }), -20)
    assert.equal(sportsBetPnl({ id: '1', status: 'lost', side: 'lay', oddsSize: 90, liability: 70 }), -70)
  })

  test('casino P/L is payout (or win amount) less stake', () => {
    assert.equal(casinoBetPnl({ id: '1', stake: 10, payout: 25 }), 15)
    assert.equal(casinoBetPnl({ id: '1', stake: '10', payout: 0, winAmount: 4 }), -6)
    assert.equal(casinoBetPnl({ id: '1' }), 0)
  })

  test('status tones follow the legacy tag colours per domain', () => {
    assert.equal(betStatusTone('sports', 'won'), 'ok')
    assert.equal(betStatusTone('sports', 'settled'), 'info')
    assert.equal(betStatusTone('sports', 'unmatched'), 'warn')
    assert.equal(betStatusTone('sports', 'void'), 'neutral')
    assert.equal(betStatusTone('casino', 'active'), 'info')
    assert.equal(betStatusTone('casino', 'settled'), 'neutral')
    assert.equal(betStatusTone('casino', null), 'neutral')
  })

  test('a gain carries a plus sign before the formatted amount', () => {
    const fmt = (v: number) => `₹${v.toFixed(2)}`
    assert.equal(signedAmount(15, fmt), '+₹15.00')
    assert.equal(signedAmount(0, fmt), '+₹0.00')
    assert.equal(signedAmount(-6, fmt), '₹-6.00')
  })
})
