import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  EARNINGS_PAGE_SIZE,
  EARNINGS_PAGE_SIZES,
  REFERRAL_DATE_PRESETS,
  SORTABLE_EARNING_COLUMNS,
  clampPage,
  compareCalculatedAt,
  compareNetAmount,
  compareTier,
  earningRowKey,
  maxDepthLabel,
  normalizeReferralRange,
  pageOf,
  referralDatePreset,
  referralRangeVariables,
  referralStatsFigures,
  ruleTypeLabel,
  sortEarnings,
  tierLabel,
  visibleEarnings,
  visibleRewardModes,
  type ReferralEarningRow,
} from './referralsOverviewModel'

describe('referralsOverviewModel — the period', () => {
  test('the legacy picker had two states: every date, or a custom range', () => {
    assert.deepEqual(REFERRAL_DATE_PRESETS.map((preset) => preset.value), ['all', 'custom'])
    assert.deepEqual(REFERRAL_DATE_PRESETS.map((preset) => preset.label), ['All dates', 'Custom range'])
  })

  test('only a whole, well-formed range filters; anything else is every date', () => {
    assert.deepEqual(normalizeReferralRange(null), {})
    assert.deepEqual(normalizeReferralRange(undefined), {})
    assert.deepEqual(normalizeReferralRange({ from: '2026-10-01' }), {})
    assert.deepEqual(normalizeReferralRange({ from: '2026-10-01', to: 'yesterday' }), {})
    assert.deepEqual(normalizeReferralRange({ from: '2026-10-01', to: '2026-10-05' }), { from: '2026-10-01', to: '2026-10-05' })
    assert.deepEqual(normalizeReferralRange({ from: '2026-10-05', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-05' })
    assert.equal(referralDatePreset(null), 'all')
    assert.equal(referralDatePreset({ to: '2026-10-05' }), 'all')
    assert.equal(referralDatePreset({ from: '2026-10-01', to: '2026-10-01' }), 'custom')
  })

  test('the documents get the first IST day start and the last IST day end, in that key order', () => {
    const variables = referralRangeVariables({ from: '2026-10-01', to: '2026-10-05' })
    assert.deepEqual(Object.keys(variables), ['fromDate', 'toDate'])
    assert.equal(variables.fromDate, '2026-09-30T18:30:00.000Z')
    assert.equal(variables.toDate, '2026-10-05T18:29:59.999Z')

    // A one-day range now covers that whole IST day (legacy sent the same browser midnight twice).
    assert.deepEqual(referralRangeVariables({ from: '2026-10-07', to: '2026-10-07' }), {
      fromDate: '2026-10-06T18:30:00.000Z',
      toDate: '2026-10-07T18:29:59.999Z',
    })
    assert.deepEqual(referralRangeVariables(null), { fromDate: undefined, toDate: undefined })
    assert.deepEqual(referralRangeVariables({ from: '2026-10-01' }), { fromDate: undefined, toDate: undefined })
  })
})

describe('referralsOverviewModel — rows and labels', () => {
  test('revenue share never shows, in the earnings or the reward modes; the server order stays', () => {
    const rows: ReferralEarningRow[] = [
      { id: '1', ruleType: 'SIGNUP_CPA' },
      { id: '2', ruleType: 'REVSHARE' },
      { id: '3', ruleType: 'LOSS_SHARE' },
      { id: '4' },
    ]
    assert.deepEqual(visibleEarnings(rows).map((row) => row.id), ['1', '3', '4'])
    assert.deepEqual(visibleEarnings(null), [])
    assert.deepEqual(visibleRewardModes(['REVSHARE', 'SIGNUP_CPA', 'FIRST_DEPOSIT_PCT']), ['SIGNUP_CPA', 'FIRST_DEPOSIT_PCT'])
    assert.deepEqual(visibleRewardModes(undefined), [])
    assert.deepEqual(visibleRewardModes(null), [])
  })

  test('labels print as the legacy tags did', () => {
    assert.equal(ruleTypeLabel('FIRST_DEPOSIT_PCT'), 'FIRST DEPOSIT PCT')
    assert.equal(ruleTypeLabel('SIGNUP_CPA'), 'SIGNUP CPA')
    assert.equal(ruleTypeLabel(undefined), '')
    assert.equal(tierLabel(2), 'L2')
    assert.equal(tierLabel(undefined), 'L')
    assert.equal(maxDepthLabel(4), '4 tiers')
    assert.equal(maxDepthLabel(1), '1 tiers')
    assert.equal(earningRowKey({ id: 'e-9' }), 'e-9')
    assert.equal(earningRowKey({}, 3), 'row-3')
  })
})

describe('referralsOverviewModel — sorting and paging', () => {
  const rows: ReferralEarningRow[] = [
    { id: 'a', tier: 2, netAmount: 150, calculatedAt: '2026-10-03T10:00:00.000Z' },
    { id: 'b', tier: 1, netAmount: '25.5', calculatedAt: '2026-10-05T10:00:00.000Z' },
    { id: 'c', netAmount: 900, calculatedAt: undefined },
    { id: 'd', tier: 2, netAmount: 40, calculatedAt: '2026-10-01T10:00:00.000Z' },
  ]

  test('the legacy sorters: a missing tier is 0, amounts compare as numbers, a missing date is the epoch', () => {
    assert.ok(compareTier(rows[2], rows[1]) < 0)
    assert.equal(compareTier(rows[0], rows[3]), 0)
    assert.ok(compareNetAmount(rows[1], rows[3]) < 0)
    assert.ok(compareCalculatedAt(rows[2], rows[3]) < 0)
    assert.deepEqual(SORTABLE_EARNING_COLUMNS, ['tier', 'netAmount', 'calculatedAt'])
  })

  test('ascending, descending and none; ties keep the server order', () => {
    assert.deepEqual(sortEarnings(rows, { key: 'tier', dir: 'asc' }).map((row) => row.id), ['c', 'b', 'a', 'd'])
    assert.deepEqual(sortEarnings(rows, { key: 'tier', dir: 'desc' }).map((row) => row.id), ['a', 'd', 'b', 'c'])
    assert.deepEqual(sortEarnings(rows, { key: 'netAmount', dir: 'asc' }).map((row) => row.id), ['b', 'd', 'a', 'c'])
    assert.deepEqual(sortEarnings(rows, { key: 'calculatedAt', dir: 'desc' }).map((row) => row.id), ['b', 'a', 'd', 'c'])
    assert.deepEqual(sortEarnings(rows, null).map((row) => row.id), ['a', 'b', 'c', 'd'])
    // An unsortable column leaves the server order, and the input is never mutated.
    assert.deepEqual(sortEarnings(rows, { key: 'ruleType', dir: 'asc' }).map((row) => row.id), ['a', 'b', 'c', 'd'])
    assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c', 'd'])
  })

  test('ten rows a page by default, and a page past the end shows the last page', () => {
    assert.equal(EARNINGS_PAGE_SIZE, 10)
    assert.deepEqual([...EARNINGS_PAGE_SIZES], [10, 20, 50, 100])
    const many = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.deepEqual(pageOf(many, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(pageOf(many, 3, 10), [21, 22, 23])
    assert.deepEqual(pageOf(many, 9, 10), [21, 22, 23])
    assert.equal(clampPage(9, 23, 10), 3)
    assert.equal(clampPage(0, 23, 10), 1)
    assert.equal(clampPage(4, 0, 10), 1)
    assert.deepEqual(pageOf([], 2, 10), [])
  })
})

describe('referralsOverviewModel — the six figures', () => {
  test('nothing loaded reads as zeros in INR with a 0.00% conversion', () => {
    assert.deepEqual(referralStatsFigures(undefined), {
      clicks: (0).toLocaleString(),
      signups: (0).toLocaleString(),
      earnings: 0,
      settled: 0,
      pending: 0,
      currency: 'INR',
      conversionRate: '0.00',
    })
  })

  test('counts in the browser format, amounts in the stats currency, signups over clicks', () => {
    const figures = referralStatsFigures({
      totalClicks: 12480,
      totalSignups: 312,
      totalEarnings: 482650.5,
      totalSettled: 300000,
      totalPending: null,
      currency: 'USD',
    })
    assert.equal(figures.clicks, (12480).toLocaleString())
    assert.equal(figures.signups, (312).toLocaleString())
    assert.equal(figures.earnings, 482650.5)
    assert.equal(figures.settled, 300000)
    assert.equal(figures.pending, 0)
    assert.equal(figures.currency, 'USD')
    assert.equal(figures.conversionRate, '2.50')
    assert.equal(referralStatsFigures({ totalClicks: 8, totalSignups: 3 }).conversionRate, '37.50')
    assert.equal(referralStatsFigures({ totalClicks: 0, totalSignups: 3 }).conversionRate, '0.00')
    assert.equal(referralStatsFigures({ totalClicks: 5, totalSignups: 0 }).conversionRate, '0.00')
  })
})
