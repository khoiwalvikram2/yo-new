import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  buildSetWithdrawalStatusInput,
  buildWithdrawalRequestFilter,
  calculateWithdrawalStats,
  canUpdateWithdrawalStatus,
  getWithdrawalPresetFromRange,
  getWithdrawalRangeForPreset,
  WITHDRAWAL_UPDATE_STATUSES,
  withdrawalAccountNumberLabel,
  withdrawalStatusLabel,
} from './withdrawalRequestsModel'

const NOW = new Date('2026-01-02T20:00:00.000Z') // 03 Jan in IST

describe('withdrawal date presets', () => {
  test('uses IST calendar dates and keeps the legacy inclusive 7/30-day windows', () => {
    assert.deepStrictEqual(getWithdrawalRangeForPreset('today', NOW), {
      from: '2026-01-03',
      to: '2026-01-03',
    })
    assert.deepStrictEqual(getWithdrawalRangeForPreset('yesterday', NOW), {
      from: '2026-01-02',
      to: '2026-01-02',
    })
    assert.deepStrictEqual(getWithdrawalRangeForPreset('last7days', NOW), {
      from: '2025-12-27',
      to: '2026-01-03',
    })
    assert.deepStrictEqual(getWithdrawalRangeForPreset('last30days', NOW), {
      from: '2025-12-04',
      to: '2026-01-03',
    })
    assert.equal(getWithdrawalRangeForPreset('custom', NOW), null)
  })

  test('keeps the IST day when the browser-visible UTC date is still the previous day', () => {
    const justAfterIstMidnight = new Date('2026-03-31T18:31:00.000Z') // 01 Apr 00:01 IST
    assert.deepStrictEqual(getWithdrawalRangeForPreset('today', justAfterIstMidnight), {
      from: '2026-04-01',
      to: '2026-04-01',
    })
    const justBeforeIstMidnight = new Date('2026-03-31T18:29:00.000Z') // 31 Mar 23:59 IST
    assert.deepStrictEqual(getWithdrawalRangeForPreset('yesterday', justBeforeIstMidnight), {
      from: '2026-03-30',
      to: '2026-03-30',
    })
  })

  test('recognises every preset and treats incomplete ranges as the Today default', () => {
    for (const preset of ['today', 'yesterday', 'last7days', 'last30days'] as const) {
      assert.equal(
        getWithdrawalPresetFromRange(getWithdrawalRangeForPreset(preset, NOW), NOW),
        preset,
      )
    }
    assert.equal(
      getWithdrawalPresetFromRange({ from: '2025-12-01', to: '2025-12-31' }, NOW),
      'custom',
    )
    assert.equal(getWithdrawalPresetFromRange({ from: '2026-01-03' }, NOW), 'today')
    assert.equal(getWithdrawalPresetFromRange({}, NOW), 'today')
    assert.equal(getWithdrawalPresetFromRange(null, NOW), 'today')
  })
})

describe('buildWithdrawalRequestFilter', () => {
  test('omits empty values and search terms shorter than two trimmed characters, in the legacy key order', () => {
    const filter = buildWithdrawalRequestFilter('', ' x ', {})
    assert.deepStrictEqual(filter, {
      status: undefined,
      query: undefined,
      fromDate: undefined,
      toDate: undefined,
    })
    assert.deepStrictEqual(Object.keys(filter), ['status', 'query', 'fromDate', 'toDate'])
  })

  test('trims a valid debounced query and preserves the other server filter values', () => {
    assert.deepStrictEqual(
      buildWithdrawalRequestFilter('PENDING', '  9876  ', { from: '2026-01-01', to: '2026-01-03' }),
      {
        status: 'PENDING',
        query: '9876',
        fromDate: '2026-01-01',
        toDate: '2026-01-03',
      },
    )
  })
})

describe('status update rules', () => {
  test('only Pending and Processing requests stay open for a status change', () => {
    assert.equal(canUpdateWithdrawalStatus('PENDING'), true)
    assert.equal(canUpdateWithdrawalStatus('PROCESSING'), true)
    for (const settled of ['COMPLETED', 'FAILED', 'CANCELLED', 'ON_HOLD', '', null, undefined]) {
      assert.equal(canUpdateWithdrawalStatus(settled), false, String(settled))
    }
  })

  test('offers the four legacy target statuses in their legacy order', () => {
    assert.deepStrictEqual([...WITHDRAWAL_UPDATE_STATUSES], ['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  })

  test('trims the optional note and omits it when blank', () => {
    assert.deepStrictEqual(buildSetWithdrawalStatusInput('wd-1', 'COMPLETED', '  paid out  '), {
      id: 'wd-1',
      status: 'COMPLETED',
      note: 'paid out',
    })
    const blank = buildSetWithdrawalStatusInput('wd-2', 'FAILED', '   ')
    assert.deepStrictEqual(blank, { id: 'wd-2', status: 'FAILED', note: undefined })
    assert.deepStrictEqual(Object.keys(blank), ['id', 'status', 'note'])
  })

  test('names the account number by method', () => {
    assert.equal(withdrawalAccountNumberLabel('UPI'), 'UPI ID')
    assert.equal(withdrawalAccountNumberLabel('BANK'), 'Account Number')
    assert.equal(withdrawalAccountNumberLabel(undefined), 'Account Number')
  })
})

describe('calculateWithdrawalStats', () => {
  test('returns stable zero values for an empty result', () => {
    assert.deepStrictEqual(calculateWithdrawalStats([]), {
      totalRequests: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      totalAmount: 0,
      completionRate: 0,
      failureRate: 0,
    })
  })

  test('counts statuses, rounds rates and sums only finite completed amounts', () => {
    assert.deepStrictEqual(
      calculateWithdrawalStats([
        { status: 'PENDING', amount: 500 },
        { status: 'PROCESSING', amount: 250 },
        { status: 'COMPLETED', amount: '100.25' },
        { status: 'COMPLETED', amount: 'not-a-number' },
        { status: 'FAILED', amount: 900 },
        { status: 'CANCELLED', amount: 700 },
        { status: null, amount: null },
      ]),
      {
        totalRequests: 7,
        pending: 1,
        processing: 1,
        completed: 2,
        failed: 1,
        totalAmount: 100.25,
        completionRate: 29,
        failureRate: 14,
      },
    )
  })
})

test('withdrawalStatusLabel uses readable known labels and preserves unknown server values', () => {
  assert.equal(withdrawalStatusLabel('PENDING'), 'Pending')
  assert.equal(withdrawalStatusLabel('PROCESSING'), 'Processing')
  assert.equal(withdrawalStatusLabel('COMPLETED'), 'Completed')
  assert.equal(withdrawalStatusLabel('FAILED'), 'Failed')
  assert.equal(withdrawalStatusLabel('CANCELLED'), 'Cancelled')
  assert.equal(withdrawalStatusLabel('ON_HOLD'), 'ON_HOLD')
})
