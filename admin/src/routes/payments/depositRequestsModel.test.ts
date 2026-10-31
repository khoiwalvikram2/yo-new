import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  buildDepositRequestFilter,
  calculateDepositStats,
  depositStatusLabel,
  getDepositPresetFromRange,
  getDepositRangeForPreset,
  hasValidDepositProof,
} from './depositRequestsModel'

const NOW = new Date('2026-01-02T20:00:00.000Z') // 03 Jan in IST

describe('deposit date presets', () => {
  test('uses IST calendar dates and keeps the legacy inclusive 7/30-day windows', () => {
    assert.deepStrictEqual(getDepositRangeForPreset('today', NOW), {
      from: '2026-01-03',
      to: '2026-01-03',
    })
    assert.deepStrictEqual(getDepositRangeForPreset('yesterday', NOW), {
      from: '2026-01-02',
      to: '2026-01-02',
    })
    assert.deepStrictEqual(getDepositRangeForPreset('last7days', NOW), {
      from: '2025-12-27',
      to: '2026-01-03',
    })
    assert.deepStrictEqual(getDepositRangeForPreset('last30days', NOW), {
      from: '2025-12-04',
      to: '2026-01-03',
    })
    assert.equal(getDepositRangeForPreset('custom', NOW), null)
  })

  test('recognises every preset and treats incomplete ranges as the Today default', () => {
    for (const preset of ['today', 'yesterday', 'last7days', 'last30days'] as const) {
      assert.equal(
        getDepositPresetFromRange(getDepositRangeForPreset(preset, NOW), NOW),
        preset,
      )
    }
    assert.equal(
      getDepositPresetFromRange({ from: '2025-12-01', to: '2025-12-31' }, NOW),
      'custom',
    )
    assert.equal(getDepositPresetFromRange({}, NOW), 'today')
    assert.equal(getDepositPresetFromRange(null, NOW), 'today')
  })
})

describe('buildDepositRequestFilter', () => {
  test('omits empty values and search terms shorter than two trimmed characters', () => {
    assert.deepStrictEqual(buildDepositRequestFilter('', '', ' x ', {}), {
      status: undefined,
      method: undefined,
      query: undefined,
      fromDate: undefined,
      toDate: undefined,
    })
  })

  test('trims a valid debounced query and preserves the other server filter values', () => {
    assert.deepStrictEqual(
      buildDepositRequestFilter(
        'PENDING',
        'UPI',
        '  UT  ',
        { from: '2026-01-01', to: '2026-01-03' },
      ),
      {
        status: 'PENDING',
        method: 'UPI',
        query: 'UT',
        fromDate: '2026-01-01',
        toDate: '2026-01-03',
      },
    )
  })
})

describe('hasValidDepositProof', () => {
  test('accepts only real persisted deposit paths paired with a usable URL', () => {
    const matrix: Array<[
      request: { proofKey: string; proofUrl: string | null },
      expected: boolean,
    ]> = [
      [{ proofKey: 'deposits/request-1.png', proofUrl: 'https://cdn.test/proof.png' }, true],
      [{ proofKey: ' deposits/request-2.jpeg ', proofUrl: ' https://cdn.test/proof.jpeg ' }, true],
      [{ proofKey: 'manual', proofUrl: 'https://cdn.test/proof.png' }, false],
      [{ proofKey: 'proof-missing', proofUrl: 'https://cdn.test/proof.png' }, false],
      [{ proofKey: 'deposits/no-extension', proofUrl: 'https://cdn.test/proof' }, false],
      [{ proofKey: 'other/request.png', proofUrl: 'https://cdn.test/proof.png' }, false],
      [{ proofKey: 'deposits/request.png', proofUrl: null }, false],
      [{ proofKey: 'deposits/request.png', proofUrl: '   ' }, false],
      [{ proofKey: 'deposits/request.png', proofUrl: 'null' }, false],
      [{ proofKey: 'deposits/request.png', proofUrl: 'undefined' }, false],
    ]

    for (const [request, expected] of matrix) {
      assert.equal(hasValidDepositProof(request), expected, JSON.stringify(request))
    }
  })
})

describe('calculateDepositStats', () => {
  test('returns stable zero values for an empty result', () => {
    assert.deepStrictEqual(calculateDepositStats([]), {
      totalRequests: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      totalAmount: 0,
      approvalRate: 0,
      rejectionRate: 0,
    })
  })

  test('counts statuses, rounds rates and sums only finite approved amounts', () => {
    assert.deepStrictEqual(
      calculateDepositStats([
        { status: 'PENDING', amount: 500 },
        { status: 'APPROVED', amount: '100.25' },
        { status: 'APPROVED', amount: 'not-a-number' },
        { status: 'REJECTED', amount: 900 },
        { status: 'CANCELLED', amount: 700 },
        { status: null, amount: null },
      ]),
      {
        totalRequests: 6,
        pending: 1,
        approved: 2,
        rejected: 1,
        totalAmount: 100.25,
        approvalRate: 33,
        rejectionRate: 17,
      },
    )
  })
})

test('depositStatusLabel uses readable known labels and preserves unknown server values', () => {
  assert.equal(depositStatusLabel('PENDING'), 'Pending')
  assert.equal(depositStatusLabel('APPROVED'), 'Approved')
  assert.equal(depositStatusLabel('REJECTED'), 'Rejected')
  assert.equal(depositStatusLabel('CANCELLED'), 'Cancelled')
  assert.equal(depositStatusLabel('ON_HOLD'), 'ON_HOLD')
})
