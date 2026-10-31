/**
 * walletData.ts turns raw wallet/credit/sharing/settlement GraphQL payloads into the plain shapes
 * the wallet views render. Most of these pure functions are ported from four near-duplicate
 * topbar components (WhitelabelCreditIndicator, AgentCreditIndicator, AgentSharingIndicator,
 * AgentCommissionIndicator) — a regression here silently breaks every wallet popover's numbers.
 * Two things are NOT a like-for-like port, so do not assume test parity with old behavior implies
 * zero visible change: (1) toDomainRows hides an explicit `{ domain, rate: 0 }` entry with zero
 * totals, where the old components' `!rateEntry` check kept it visible (see toDomainRows's own
 * comment, R2 §4 — intentional); (2) toSettlementSummary has no working legacy renderer to compare
 * against at all (see toSettlementSummary's own comment) and is derived from the GraphQL schema.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  DOMAIN_KEYS,
  toDomainRows,
  sumCurrentPeriod,
  toSharingSummary,
  toCreditFigures,
  CREDIT_STATUS_LABEL,
  toSettlementSummary,
  amountSign,
  creditAlertText,
} from './walletData'

describe('DOMAIN_KEYS', () => {
  test('lists the three domains in order', () => {
    assert.deepEqual(DOMAIN_KEYS, ['sports', 'casino', 'matka'])
  })
})

describe('toDomainRows', () => {
  test('hides a domain with no rate and both totals zero', () => {
    const rows = toDomainRows({
      rates: [{ domain: 'sports', rate: 0 }],
      allTimeTotals: [{ domain: 'sports', totalAmount: 0 }],
      currentPeriodTotals: [{ domain: 'sports', totalAmount: 0 }],
    })
    assert.deepEqual(rows, [])
  })

  test('an explicit zero-rate entry and a missing rate entry are hidden identically (intentional, see toDomainRows comment)', () => {
    const noEntry = toDomainRows({
      rates: [],
      allTimeTotals: [{ domain: 'sports', totalAmount: 0 }],
      currentPeriodTotals: [{ domain: 'sports', totalAmount: 0 }],
    })
    const explicitZero = toDomainRows({
      rates: [{ domain: 'sports', rate: 0 }],
      allTimeTotals: [{ domain: 'sports', totalAmount: 0 }],
      currentPeriodTotals: [{ domain: 'sports', totalAmount: 0 }],
    })
    assert.deepEqual(noEntry, [])
    assert.deepEqual(explicitZero, [])
  })

  test('keeps a domain when a rate entry exists even if totals are zero', () => {
    const rows = toDomainRows({
      rates: [{ domain: 'casino', rate: 2.5 }],
      allTimeTotals: [],
      currentPeriodTotals: [],
    })
    assert.deepEqual(rows, [{ domain: 'casino', rate: 2.5, allTime: 0, currentPeriod: 0 }])
  })

  test('keeps a domain when totals are non-zero even with no rate entry', () => {
    const rows = toDomainRows({
      rates: [],
      allTimeTotals: [{ domain: 'matka', totalAmount: 40 }],
      currentPeriodTotals: [{ domain: 'matka', totalAmount: 10 }],
    })
    assert.deepEqual(rows, [{ domain: 'matka', rate: 0, allTime: 40, currentPeriod: 10 }])
  })

  test('defaults missing rate/amount fields to 0 and preserves domain order', () => {
    const rows = toDomainRows({
      rates: [
        { domain: 'sports', rate: 1 },
        { domain: 'matka', rate: null },
      ],
      allTimeTotals: [{ domain: 'matka', totalAmount: 5 }],
      currentPeriodTotals: null,
    })
    assert.deepEqual(rows, [
      { domain: 'sports', rate: 1, allTime: 0, currentPeriod: 0 },
      { domain: 'matka', rate: 0, allTime: 5, currentPeriod: 0 },
    ])
  })

  test('tolerates null entries and missing arrays', () => {
    const rows = toDomainRows({ rates: [null], allTimeTotals: undefined, currentPeriodTotals: undefined })
    assert.deepEqual(rows, [])
  })
})

describe('sumCurrentPeriod', () => {
  test('sums totalAmount across entries', () => {
    assert.equal(
      sumCurrentPeriod([
        { domain: 'sports', totalAmount: 10 },
        { domain: 'casino', totalAmount: 5 },
      ]),
      15,
    )
  })

  test('treats a missing totalAmount as 0', () => {
    assert.equal(sumCurrentPeriod([{ domain: 'sports' }, { domain: 'casino', totalAmount: 3 }]), 3)
  })

  test('returns 0 for null or undefined', () => {
    assert.equal(sumCurrentPeriod(null), 0)
    assert.equal(sumCurrentPeriod(undefined), 0)
  })
})

describe('toSharingSummary', () => {
  test('defaults currency to INR and rows/total to empty/zero', () => {
    const summary = toSharingSummary({})
    assert.equal(summary.currency, 'INR')
    assert.equal(summary.currentPeriodTotal, 0)
    assert.deepEqual(summary.rows, [])
  })

  test('carries the payload currency, total and domain rows', () => {
    const summary = toSharingSummary({
      currency: 'USD',
      rates: [{ domain: 'sports', rate: 5 }],
      allTimeTotals: [{ domain: 'sports', totalAmount: 100 }],
      currentPeriodTotals: [{ domain: 'sports', totalAmount: 20 }],
    })
    assert.equal(summary.currency, 'USD')
    assert.equal(summary.currentPeriodTotal, 20)
    assert.deepEqual(summary.rows, [{ domain: 'sports', rate: 5, allTime: 100, currentPeriod: 20 }])
  })
})

describe('toCreditFigures', () => {
  test('is healthy when under the near-limit threshold', () => {
    const figures = toCreditFigures({
      creditLimit: 1000,
      creditUsed: 100,
      creditAvailable: 900,
      usagePercentage: 10,
      isNearLimit: false,
    })
    assert.equal(figures.isNearLimit, false)
    assert.equal(figures.isCritical, false)
    assert.equal(figures.status, 'healthy')
  })

  test('is warning when isNearLimit is true and usage is under 90', () => {
    const figures = toCreditFigures({ usagePercentage: 85, isNearLimit: true })
    assert.equal(figures.isCritical, false)
    assert.equal(figures.status, 'warning')
  })

  test('is critical at exactly 90% usage, taking priority over warning', () => {
    const figures = toCreditFigures({ usagePercentage: 90, isNearLimit: true })
    assert.equal(figures.isCritical, true)
    assert.equal(figures.status, 'critical')
  })

  test('defaults missing numeric and boolean fields to 0 / false', () => {
    const figures = toCreditFigures({})
    assert.deepEqual(figures, {
      creditAvailable: 0,
      creditLimit: 0,
      creditUsed: 0,
      usagePercentage: 0,
      isNearLimit: false,
      isCritical: false,
      status: 'healthy',
    })
  })
})

describe('CREDIT_STATUS_LABEL', () => {
  test('maps each status to its display label', () => {
    assert.deepEqual(CREDIT_STATUS_LABEL, { healthy: 'Healthy', warning: 'Warning', critical: 'Critical' })
  })
})

describe('toSettlementSummary', () => {
  test('always returns all three domains in Sports, Casino, Matka order', () => {
    const summary = toSettlementSummary({
      settlementBalance: 50,
      settlementBalanceSports: 20,
      settlementBalanceCasino: -5,
      settlementBalanceMatka: 0,
    })
    assert.equal(summary.balance, 50)
    assert.deepEqual(summary.rows, [
      { domain: 'Sports', amount: 20 },
      { domain: 'Casino', amount: -5 },
      { domain: 'Matka', amount: 0 },
    ])
  })

  test('defaults every missing field to 0', () => {
    const summary = toSettlementSummary({})
    assert.equal(summary.balance, 0)
    assert.deepEqual(summary.rows, [
      { domain: 'Sports', amount: 0 },
      { domain: 'Casino', amount: 0 },
      { domain: 'Matka', amount: 0 },
    ])
  })
})

describe('amountSign', () => {
  test('classifies positive, negative and zero amounts', () => {
    assert.equal(amountSign(10), 'positive')
    assert.equal(amountSign(-3), 'negative')
    assert.equal(amountSign(0), 'zero')
  })
})

describe('creditAlertText', () => {
  test('is null when neither near limit nor critical', () => {
    const credit = toCreditFigures({ usagePercentage: 10, isNearLimit: false })
    assert.equal(creditAlertText(credit), null)
  })

  test('reports the exhausted message when critical', () => {
    const credit = toCreditFigures({ usagePercentage: 95, isNearLimit: true })
    assert.equal(creditAlertText(credit), 'Credit limit nearly exhausted')
  })

  test('reports the rounded percentage when only near the limit', () => {
    const credit = toCreditFigures({ usagePercentage: 82.4, isNearLimit: true })
    assert.equal(creditAlertText(credit), '82% of limit reached')
  })
})
