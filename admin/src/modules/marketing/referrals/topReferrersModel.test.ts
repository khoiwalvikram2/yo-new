import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DEFAULT_LIMIT,
  DEFAULT_SORT_BY,
  LIMIT_OPTIONS,
  SORTABLE_REFERRER_COLUMNS,
  SORT_BY_OPTIONS,
  TOP_REFERRERS_DATE_PRESETS,
  TOP_REFERRERS_PAGE_SIZE,
  TOP_REFERRERS_PAGE_SIZES,
  clampPage,
  conversionLevel,
  conversionText,
  countText,
  isTopReferrersSortBy,
  normalizeTopReferrersRange,
  pageOf,
  parseLimit,
  rankMedal,
  rankReferrers,
  referrerNameText,
  referrerPhoneText,
  referrerStatsPath,
  sortReferrers,
  topReferrerRowKey,
  topReferrerTotals,
  topReferrersDatePreset,
  topReferrersEmptyText,
  topReferrersFilterCount,
  topReferrersVariables,
  type TopReferrerRow,
} from './topReferrersModel'

describe('topReferrersModel — filters', () => {
  test('the legacy choices, defaults and their guards', () => {
    assert.deepEqual(SORT_BY_OPTIONS.map((option) => [option.value, option.label]), [
      ['earnings', 'Total Earnings'],
      ['referrals', 'Total Referrals'],
      ['conversion', 'Conversion Rate'],
    ])
    assert.deepEqual(LIMIT_OPTIONS.map((option) => [option.value, option.label]), [
      ['25', 'Top 25'],
      ['50', 'Top 50'],
      ['100', 'Top 100'],
    ])
    assert.equal(DEFAULT_SORT_BY, 'earnings')
    assert.equal(DEFAULT_LIMIT, 50)
    assert.equal(parseLimit('100'), 100)
    assert.equal(parseLimit('25'), 25)
    assert.equal(parseLimit('7'), 50)
    assert.equal(isTopReferrersSortBy('conversion'), true)
    assert.equal(isTopReferrersSortBy('clicks'), false)
    assert.deepEqual(TOP_REFERRERS_DATE_PRESETS.map((preset) => preset.label), ['All dates', 'Custom range'])
  })

  test('the variables keep the legacy key order and the IST day bounds', () => {
    const none = topReferrersVariables(50, 'earnings', null)
    assert.deepEqual(Object.keys(none), ['limit', 'sortBy', 'fromDate', 'toDate'])
    assert.deepEqual(none, { limit: 50, sortBy: 'earnings', fromDate: undefined, toDate: undefined })
    assert.deepEqual(topReferrersVariables(25, 'referrals', { from: '2026-10-01', to: '2026-10-05' }), {
      limit: 25,
      sortBy: 'referrals',
      fromDate: '2026-09-30T18:30:00.000Z',
      toDate: '2026-10-05T18:29:59.999Z',
    })
    assert.deepEqual(normalizeTopReferrersRange({ from: '2026-10-05', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-05' })
    assert.deepEqual(normalizeTopReferrersRange({ from: '2026-10-05' }), {})
    assert.equal(topReferrersDatePreset({ from: '2026-10-05', to: '2026-10-05' }), 'custom')
    assert.equal(topReferrersDatePreset(null), 'all')
  })

  test('each filter away from its default counts once', () => {
    assert.equal(topReferrersFilterCount('earnings', 50, null), 0)
    assert.equal(topReferrersFilterCount('conversion', 50, null), 1)
    assert.equal(topReferrersFilterCount('earnings', 100, null), 1)
    assert.equal(topReferrersFilterCount('earnings', 50, { from: '2026-10-01', to: '2026-10-02' }), 1)
    assert.equal(topReferrersFilterCount('referrals', 25, { from: '2026-10-01', to: '2026-10-02' }), 3)
    assert.equal(topReferrersEmptyText(true), 'No referrers match your filters')
    assert.equal(topReferrersEmptyText(false), 'No referrers data available')
  })
})

describe('topReferrersModel — rows', () => {
  const rows: TopReferrerRow[] = [
    { referrerId: 11, referrerName: 'Vijay', totalEarnings: 9300, totalReferrals: 42, conversionRate: 12.5 },
    { referrerId: 12, referrerName: 'arif', totalEarnings: '2400', totalReferrals: 11, conversionRate: 4 },
    { referrerId: 13, referrerName: null, totalEarnings: 6600, totalReferrals: 28, conversionRate: 7.25 },
  ]

  test('the rank is the place in the server answer and stays with its row', () => {
    const ranked = rankReferrers(rows)
    assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 3])
    const byEarnings = sortReferrers(ranked, { key: 'totalEarnings', dir: 'asc' })
    assert.deepEqual(byEarnings.map((row) => [row.referrerId, row.rank]), [[12, 2], [13, 3], [11, 1]])
    assert.deepEqual(rankReferrers(null), [])
  })

  test('the legacy sorters: names by localeCompare (missing as empty), numbers as numbers', () => {
    assert.deepEqual(SORTABLE_REFERRER_COLUMNS, ['referrer', 'totalReferrals', 'totalEarnings', 'conversionRate'])
    assert.deepEqual(sortReferrers(rows, { key: 'referrer', dir: 'asc' }).map((row) => row.referrerId), [13, 12, 11])
    assert.deepEqual(sortReferrers(rows, { key: 'totalReferrals', dir: 'desc' }).map((row) => row.referrerId), [11, 13, 12])
    assert.deepEqual(sortReferrers(rows, { key: 'conversionRate', dir: 'asc' }).map((row) => row.referrerId), [12, 13, 11])
    assert.deepEqual(sortReferrers(rows, null).map((row) => row.referrerId), [11, 12, 13])
    assert.deepEqual(sortReferrers(rows, { key: 'totalClicks', dir: 'asc' }).map((row) => row.referrerId), [11, 12, 13])
  })

  test('twenty a page by default; a page past the end shows the last one', () => {
    assert.equal(TOP_REFERRERS_PAGE_SIZE, 20)
    assert.deepEqual([...TOP_REFERRERS_PAGE_SIZES], [10, 20, 50, 100])
    const many = Array.from({ length: 45 }, (_, index) => index + 1)
    assert.deepEqual(pageOf(many, 3, 20), [41, 42, 43, 44, 45])
    assert.deepEqual(pageOf(many, 7, 20), [41, 42, 43, 44, 45])
    assert.equal(clampPage(7, 45, 20), 3)
    assert.equal(clampPage(2, 0, 20), 1)
  })

  test('the totals sum earnings and referrals, a missing value counting 0', () => {
    assert.deepEqual(topReferrerTotals(rows), { earnings: 18300, referrals: 81, referrers: 3 })
    assert.deepEqual(topReferrerTotals([{ referrerId: 1, totalEarnings: null, totalReferrals: null }]), {
      earnings: 0,
      referrals: 0,
      referrers: 1,
    })
    assert.deepEqual(topReferrerTotals([]), { earnings: 0, referrals: 0, referrers: 0 })
  })
})

describe('topReferrersModel — cells', () => {
  test('names and phones trimmed or a dash; the stats path and row key', () => {
    assert.equal(referrerNameText('  Vijay Kumar '), 'Vijay Kumar')
    assert.equal(referrerNameText('   '), '—')
    assert.equal(referrerNameText(null), '—')
    assert.equal(referrerPhoneText(' 9876543210'), '9876543210')
    assert.equal(referrerPhoneText(undefined), '—')
    assert.equal(referrerStatsPath(42), '/referrals/referrers/42')
    assert.equal(topReferrerRowKey({ referrerId: 42 }), '42')
  })

  test('counts in the browser format, rates to two decimals, dashes when missing', () => {
    assert.equal(countText(12480), (12480).toLocaleString())
    assert.equal(countText(0), '0')
    assert.equal(countText(null), '—')
    assert.equal(conversionText(7.5), '7.50%')
    assert.equal(conversionText(0), '0.00%')
    assert.equal(conversionText(null), '—')
  })

  test('the conversion emphasis and the medals keep the legacy thresholds', () => {
    assert.equal(conversionLevel(10), 'high')
    assert.equal(conversionLevel(9.99), 'mid')
    assert.equal(conversionLevel(5), 'mid')
    assert.equal(conversionLevel(4.99), 'plain')
    assert.equal(conversionLevel(null), 'plain')
    assert.deepEqual([1, 2, 3, 4, 21].map(rankMedal), ['gold', 'silver', 'bronze', null, null])
  })
})
