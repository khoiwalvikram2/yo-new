import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  REFERRER_STATS_DATE_PRESETS,
  activeReferralsNote,
  clicksNote,
  conversionRateText,
  normalizeReferrerStatsRange,
  referrerFacts,
  referrerStatsDatePreset,
  referrerStatsPeriod,
  referrerStatsSub,
  ruleCountText,
  ruleTypeLabel,
  signupsOverClicksNote,
  visibleRuleEarnings,
} from './referrerStatsModel'

describe('referrerStatsModel — the period', () => {
  test('two states, every date or a custom range; only a whole range filters', () => {
    assert.deepEqual(REFERRER_STATS_DATE_PRESETS.map((preset) => [preset.value, preset.label]), [
      ['all', 'All dates'],
      ['custom', 'Custom range'],
    ])
    assert.deepEqual(normalizeReferrerStatsRange(null), {})
    assert.deepEqual(normalizeReferrerStatsRange({ to: '2026-10-05' }), {})
    assert.deepEqual(normalizeReferrerStatsRange({ from: '2026-10-05', to: '2026-10-01' }), { from: '2026-10-01', to: '2026-10-05' })
    assert.equal(referrerStatsDatePreset({ from: '2026-10-01', to: '2026-10-01' }), 'custom')
    assert.equal(referrerStatsDatePreset(undefined), 'all')
  })

  test('the document gets the first IST day start and the last IST day end, or nothing', () => {
    assert.deepEqual(referrerStatsPeriod({ from: '2026-10-01', to: '2026-10-05' }), {
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-05T18:29:59.999Z',
    })
    // A one-day range now covers that whole day (legacy sent the same browser midnight twice).
    assert.deepEqual(referrerStatsPeriod({ from: '2026-10-07', to: '2026-10-07' }), {
      from: '2026-10-06T18:30:00.000Z',
      to: '2026-10-07T18:29:59.999Z',
    })
    assert.deepEqual(referrerStatsPeriod(null), {})
    assert.deepEqual(referrerStatsPeriod({ from: 'nope', to: '2026-10-07' }), {})
  })
})

describe('referrerStatsModel — the page copy', () => {
  test('the facts: ID, name, email and phone with N/A, the username only when present', () => {
    assert.deepEqual(
      referrerFacts('42', { id: '42', name: 'Vijay', email: null, phone: '', username: null })
        .map((fact) => [fact.term, fact.value]),
      [['Referrer ID', '42'], ['Name', 'Vijay'], ['Email', 'N/A'], ['Phone', 'N/A']],
    )
    const withUsername = referrerFacts('42', { id: '42', name: null, email: 'v@example.com', phone: '9876543210', username: 'vjy_2401' })
    assert.deepEqual(withUsername.map((fact) => fact.value), ['42', 'N/A', 'v@example.com', '9876543210', 'vjy_2401'])
    assert.equal(withUsername.at(-1)?.code, true)
    assert.equal(referrerFacts(undefined, { id: 'x' })[0].value, '')
  })

  test('the figures read as the legacy cards did', () => {
    assert.equal(conversionRateText(12.5), '12.50%')
    assert.equal(conversionRateText(0), '0.00%')
    assert.equal(activeReferralsNote(18), '18 active')
    assert.equal(signupsOverClicksNote(31, 420), '31 / 420 signups/clicks')
    assert.equal(clicksNote(420), '420 clicks')
    assert.equal(referrerStatsSub('42'), 'Detailed performance metrics for referrer #42')
    assert.equal(referrerStatsSub(undefined), 'Detailed performance metrics for referrer #')
  })

  test('rule types: revenue share left out in server order, labels spaced, the count singular or plural', () => {
    const rows = [
      { ruleType: 'SIGNUP_CPA', totalEarnings: 300, count: 2 },
      { ruleType: 'REVSHARE', totalEarnings: 50, count: 1 },
      { ruleType: 'FIRST_DEPOSIT_PCT', totalEarnings: 1250, count: 5 },
    ]
    assert.deepEqual(visibleRuleEarnings(rows).map((row) => row.ruleType), ['SIGNUP_CPA', 'FIRST_DEPOSIT_PCT'])
    assert.deepEqual(visibleRuleEarnings(null), [])
    assert.equal(ruleTypeLabel('FIRST_DEPOSIT_PCT'), 'FIRST DEPOSIT PCT')
    assert.equal(ruleCountText(1), '1 rule')
    assert.equal(ruleCountText(0), '0 rules')
    assert.equal(ruleCountText(3), '3 rules')
  })
})
