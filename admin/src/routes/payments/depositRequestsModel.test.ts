import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  APPROVE_CONFIRM_DESCRIPTION,
  approveConfirmDescription,
  buildDepositRequestFilter,
  calculateDepositStats,
  canReviewDeposit,
  cryptoDepositSummary,
  depositMethodLabel,
  depositRowMethodLabel,
  depositRowStatusLabel,
  depositStatusLabel,
  gatewayDepositNotice,
  gatewayStatusLabel,
  getDepositPresetFromRange,
  isGatewayDeposit,
  getDepositRangeForPreset,
  depositProofImageSource,
  hasDepositProof,
  shortTxHash,
  type DepositRequest,
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
      includeGatewayOrders: true,
    })
  })

  test('the Payment Gateway choice filters by source, not by method', () => {
    assert.deepStrictEqual(buildDepositRequestFilter('PENDING', 'GATEWAY', '', {}), {
      status: 'PENDING',
      method: undefined,
      source: 'GATEWAY',
      query: undefined,
      fromDate: undefined,
      toDate: undefined,
      includeGatewayOrders: true,
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
        includeGatewayOrders: true,
      },
    )
  })
})

describe('gateway deposits', () => {
  const pending = { provider: 'WELIVEPAY', gateway: 'QPC', gatewayName: 'QuickPayCash', orderId: 'ORD_1', status: 'pending', txnRef: null, expiresAt: null }

  test('are never reviewed by hand; a pending player request is', () => {
    assert.equal(canReviewDeposit({ status: 'PENDING', gateway: pending }), false)
    assert.equal(canReviewDeposit({ status: 'PENDING', gateway: null }), true)
    assert.equal(canReviewDeposit({ status: 'APPROVED', gateway: null }), false)
    assert.equal(isGatewayDeposit({ gateway: pending }), true)
  })

  test('show the gateway and its payment state the player also sees', () => {
    assert.equal(depositRowMethodLabel({ method: 'UPI', gateway: pending }), 'Gateway · QuickPayCash')
    assert.equal(depositRowMethodLabel({ method: 'UPI', gateway: null }), 'UPI')
    assert.equal(depositRowStatusLabel({ status: 'PENDING', gateway: pending }), 'Awaiting payment')
    assert.equal(depositRowStatusLabel({ status: 'REJECTED', gateway: { ...pending, status: 'expired' } }), 'Expired')
    assert.equal(depositRowStatusLabel({ status: 'APPROVED', gateway: { ...pending, status: 'success' } }), 'Approved')
    assert.equal(gatewayStatusLabel('invalid'), 'Not started')
    assert.match(gatewayDepositNotice({ status: 'pending' }), /cannot be approved or rejected by hand/)
  })
})

describe('hasDepositProof', () => {
  test("follows the server's hasProof, whatever proofKey holds", () => {
    // An inline screenshot (proofKey 'inline') has one; the sentinels and the cleared S3 keys come with hasProof false.
    const matrix: Array<[request: Pick<DepositRequest, 'hasProof'> & { proofKey: string }, expected: boolean]> = [
      [{ proofKey: 'inline', hasProof: true }, true],
      [{ proofKey: 'manual', hasProof: true }, true], // a screenshot stored beside a manual request
      [{ proofKey: 'https://cdn.test/proof.png', hasProof: true }, true],
      [{ proofKey: 'proof-missing', hasProof: false }, false],
      [{ proofKey: 'manual', hasProof: false }, false],
      [{ proofKey: 'welivepay', hasProof: false }, false],
      [{ proofKey: 'deposits/request-1.png', hasProof: false }, false], // the S3 era's key
      [{ proofKey: 'inline', hasProof: false }, false],
    ]
    for (const [request, expected] of matrix) {
      assert.equal(hasDepositProof(request), expected, JSON.stringify(request))
    }
    assert.equal(hasDepositProof(null), false)
    assert.equal(hasDepositProof(undefined), false)
    assert.equal(hasDepositProof({ hasProof: 'true' as unknown as boolean }), false, 'only a real true')
  })
})

describe('depositProofImageSource', () => {
  test('shows a screenshot data URI or an http(s) link, and nothing else', () => {
    const screenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
    const matrix: Array<[answer: unknown, expected: string | null]> = [
      [screenshot, screenshot],
      ['data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo='],
      [' data:image/webp;base64,UklGRg== ', 'data:image/webp;base64,UklGRg=='],
      ['https://cdn.test/proof.png', 'https://cdn.test/proof.png'],
      ['http://cdn.test/proof.png', 'http://cdn.test/proof.png'],
      [null, null],
      [undefined, null],
      ['', null],
      ['   ', null],
      ['manual', null],
      ['proof-missing', null],
      ['welivepay', null],
      ['inline', null],
      ['deposits/1772039387176-a3333bb383159b53.jpg', null],
      ['data:application/pdf;base64,JVBERi0=', null],
      ['javascript:alert(1)', null],
      ['https://', null],
      [42, null],
    ]
    for (const [answer, expected] of matrix) {
      assert.equal(depositProofImageSource(answer), expected, JSON.stringify(answer))
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

describe('crypto deposits', () => {
  const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const format = (amount: number, currency?: string) => `${currency} ${amount.toFixed(2)}`

  function cryptoRequest(overrides: Partial<DepositRequest> = {}) {
    return {
      amount: 10000,
      currency: 'INR',
      method: 'CRYPTO' as const,
      status: 'PENDING' as const,
      utr: ` ${HASH} `,
      cryptoAmount: 108.11,
      cryptoRate: 92.5,
      cryptoNetwork: 'TRC20',
      cryptoBonusPercent: 5,
      cryptoBonusAmount: 500,
      ...overrides,
    }
  }

  test('labels the method as Crypto (USDT) and leaves the others as stored, spaced out', () => {
    assert.equal(depositMethodLabel('CRYPTO'), 'Crypto (USDT)')
    assert.equal(depositMethodLabel('BANK_TRANSFER'), 'BANK TRANSFER')
    assert.equal(depositMethodLabel('UPI'), 'UPI')
  })

  test('cuts a long TxID to its ends for a table cell', () => {
    assert.equal(shortTxHash(HASH), 'a1b2c3d4e5…7e8f90')
    assert.equal(shortTxHash(' 0xabc '), '0xabc')
  })

  test('summarises what to check on the chain: USDT, network, rate, TxID and its explorer link', () => {
    assert.deepStrictEqual(cryptoDepositSummary(cryptoRequest(), format), {
      usdt: '108.11 USDT',
      network: 'TRC20 (Tron)',
      rate: '1 USDT = INR 92.50',
      bonus: '5% · INR 500.00 paid on approval',
      txHash: HASH,
      explorerUrl: `https://tronscan.org/#/transaction/${HASH}`,
    })
  })

  test('says whether the bonus was credited, and shows none when there is no bonus', () => {
    assert.equal(cryptoDepositSummary(cryptoRequest({ status: 'APPROVED' }), format).bonus, '5% · INR 500.00 credited')
    assert.equal(cryptoDepositSummary(cryptoRequest({ status: 'REJECTED' }), format).bonus, '5% · INR 500.00 not paid')
    assert.equal(cryptoDepositSummary(cryptoRequest({ cryptoBonusAmount: 0, cryptoBonusPercent: null }), format).bonus, null)
    assert.equal(cryptoDepositSummary(cryptoRequest({ cryptoBonusAmount: null }), format).bonus, null)
  })

  test('shows a dash for a missing figure and no link without a TxID or a known network', () => {
    const bare = cryptoDepositSummary(
      cryptoRequest({ utr: null, cryptoAmount: null, cryptoRate: null, cryptoNetwork: null, cryptoBonusAmount: null }),
      format,
    )
    assert.deepStrictEqual(bare, { usdt: '—', network: '—', rate: '—', bonus: null, txHash: null, explorerUrl: null })
    assert.equal(cryptoDepositSummary(cryptoRequest({ cryptoNetwork: 'ARBITRUM' }), format).explorerUrl, null)
    assert.equal(cryptoDepositSummary(cryptoRequest({ cryptoNetwork: 'SOLANA' }), format).explorerUrl, `https://solscan.io/tx/${HASH}`)
  })

  test('the approval question names the crypto bonus approving pays; otherwise it is unchanged', () => {
    assert.equal(
      approveConfirmDescription(cryptoRequest(), format),
      "This will credit the player's wallet with the deposit and a INR 500.00 crypto bonus. Are you sure?",
    )
    assert.equal(approveConfirmDescription(cryptoRequest({ cryptoBonusAmount: 0 }), format), APPROVE_CONFIRM_DESCRIPTION)
    assert.equal(approveConfirmDescription({ method: 'UPI', currency: 'INR', cryptoBonusAmount: 500 }, format), APPROVE_CONFIRM_DESCRIPTION)
    assert.equal(APPROVE_CONFIRM_DESCRIPTION, "This will credit the player's wallet. Are you sure?")
  })
})
