import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  buildApprovePayoutAccountInput,
  buildPayoutAccountFilter,
  buildRejectPayoutAccountInput,
  calculatePayoutAccountStats,
  countPayoutFilters,
  exportFailureMessage,
  getPayoutDatePreset,
  isPendingPayoutAccount,
  normalizePayoutDateRange,
  payoutAccountDetailLines,
  payoutAccountNumberLabel,
  payoutAccountSummaryLines,
  payoutDrawerContact,
  payoutMethodLabel,
  payoutMethodTone,
  payoutStatusLabel,
  payoutTableContact,
} from './payoutAccountApprovalsModel'

const BANK = {
  method: 'BANK',
  accountHolderName: 'Vijay Kumar',
  accountNumber: '50100234567812',
  ifscCode: 'HDFC0001204',
  bankName: 'HDFC Bank',
}

const UPI = {
  method: 'UPI',
  accountHolderName: 'Arif Khan',
  accountNumber: 'arif@okaxis',
  ifscCode: null,
  bankName: null,
}

describe('date filter', () => {
  test('keeps a complete range and treats anything else as the unfiltered legacy default', () => {
    assert.deepStrictEqual(normalizePayoutDateRange({ from: '2026-09-01', to: '2026-09-30' }), {
      from: '2026-09-01',
      to: '2026-09-30',
    })
    assert.deepStrictEqual(normalizePayoutDateRange({ from: '2026-09-01' }), {})
    assert.deepStrictEqual(normalizePayoutDateRange({ to: '2026-09-30' }), {})
    assert.deepStrictEqual(normalizePayoutDateRange(null), {})
    assert.deepStrictEqual(normalizePayoutDateRange(undefined), {})
  })

  test('names a complete range custom and every other state all dates', () => {
    assert.equal(getPayoutDatePreset({ from: '2026-09-01', to: '2026-09-30' }), 'custom')
    assert.equal(getPayoutDatePreset({ from: '2026-09-01' }), 'all')
    assert.equal(getPayoutDatePreset({}), 'all')
    assert.equal(getPayoutDatePreset(null), 'all')
  })
})

describe('buildPayoutAccountFilter', () => {
  test('omits an empty status, a short search and missing dates, in the legacy key order', () => {
    const filter = buildPayoutAccountFilter('', 'x', {})
    assert.deepStrictEqual(filter, {
      status: undefined,
      query: undefined,
      fromDate: undefined,
      toDate: undefined,
    })
    assert.deepStrictEqual(Object.keys(filter), ['status', 'query', 'fromDate', 'toDate'])
  })

  test('sends the debounced search as given once it has two trimmed characters', () => {
    assert.equal(buildPayoutAccountFilter('', ' a ', {}).query, undefined)
    assert.equal(buildPayoutAccountFilter('', ' ab ', {}).query, ' ab ')
    assert.deepStrictEqual(
      buildPayoutAccountFilter('PENDING', '98765', { from: '2026-09-01', to: '2026-09-30' }),
      { status: 'PENDING', query: '98765', fromDate: '2026-09-01', toDate: '2026-09-30' },
    )
  })
})

test('countPayoutFilters counts search, status and an applied date range once each', () => {
  assert.equal(countPayoutFilters('', '', {}), 0)
  assert.equal(countPayoutFilters('a', '', {}), 1, 'the raw search text counts, as before')
  assert.equal(countPayoutFilters('', 'APPROVED', {}), 1)
  assert.equal(countPayoutFilters('', '', { from: '2026-09-01', to: '2026-09-30' }), 1)
  assert.equal(countPayoutFilters('asha', 'PENDING', { from: '2026-09-01', to: '2026-09-30' }), 3)
  assert.equal(countPayoutFilters('', '', { from: '2026-09-01' }), 0)
})

describe('labels and tones', () => {
  test('only a Pending account is reviewable', () => {
    assert.equal(isPendingPayoutAccount('PENDING'), true)
    for (const status of ['APPROVED', 'REJECTED', '', null, undefined]) {
      assert.equal(isPendingPayoutAccount(status), false, String(status))
    }
  })

  test('labels UPI as UPI and every other method as Bank, with the matching tone and number label', () => {
    assert.equal(payoutMethodLabel('UPI'), 'UPI')
    assert.equal(payoutMethodLabel('BANK'), 'Bank')
    assert.equal(payoutMethodLabel('WALLET'), 'Bank')
    assert.equal(payoutMethodTone('UPI'), 'info')
    assert.equal(payoutMethodTone('BANK'), 'neutral')
    assert.equal(payoutAccountNumberLabel('UPI'), 'UPI ID')
    assert.equal(payoutAccountNumberLabel('BANK'), 'Account Number')
    assert.equal(payoutAccountNumberLabel(undefined), 'Account Number')
  })

  test('reads the three approval states and keeps any other server value', () => {
    assert.equal(payoutStatusLabel('PENDING'), 'Pending')
    assert.equal(payoutStatusLabel('APPROVED'), 'Approved')
    assert.equal(payoutStatusLabel('REJECTED'), 'Rejected')
    assert.equal(payoutStatusLabel('ON_HOLD'), 'ON_HOLD')
  })

  test('the table prefers the phone and the drawer the email, each with its legacy fallback', () => {
    const both = { id: 'u1', name: 'Asha', phone: '9000000001', email: 'asha@example.test' }
    assert.equal(payoutTableContact(both), '9000000001')
    assert.equal(payoutDrawerContact(both), 'asha@example.test')
    assert.equal(payoutTableContact({ ...both, phone: null }), 'asha@example.test')
    assert.equal(payoutDrawerContact({ ...both, email: '' }), '9000000001')
    assert.equal(payoutTableContact(null), '—')
    assert.equal(payoutDrawerContact(null), 'No contact info')
  })
})

describe('account lines', () => {
  test('a BANK account summarises holder, number, IFSC and bank; any other method holder and UPI ID', () => {
    assert.deepStrictEqual(payoutAccountSummaryLines(BANK), [
      { key: 'holder', label: 'Holder', value: 'Vijay Kumar', mono: false },
      { key: 'number', label: 'Account No', value: '50100234567812', mono: true },
      { key: 'ifsc', label: 'IFSC', value: 'HDFC0001204', mono: true },
      { key: 'bank', label: 'Bank', value: 'HDFC Bank', mono: false },
    ])
    assert.deepStrictEqual(payoutAccountSummaryLines(UPI), [
      { key: 'holder', label: 'Holder', value: 'Arif Khan', mono: false },
      { key: 'number', label: 'UPI ID', value: 'arif@okaxis', mono: true },
    ])
    // A method that is neither keeps the UPI-shaped summary: the legacy cell branched on BANK alone.
    assert.deepStrictEqual(
      payoutAccountSummaryLines({ ...UPI, method: 'WALLET' }).map((line) => line.label),
      ['Holder', 'UPI ID'],
    )
  })

  test('leaves out missing and empty values', () => {
    assert.deepStrictEqual(
      payoutAccountSummaryLines({ ...BANK, ifscCode: '', bankName: null }).map((line) => line.key),
      ['holder', 'number'],
    )
    assert.deepStrictEqual(payoutAccountSummaryLines({ ...UPI, accountHolderName: '', accountNumber: '' }), [])
  })

  test('the drawer names every row in full, labels the number by method and drops empty rows', () => {
    assert.deepStrictEqual(payoutAccountDetailLines(BANK).map((line) => [line.label, line.mono]), [
      ['Account Holder Name', false],
      ['Account Number', true],
      ['IFSC', true],
      ['Bank Name', false],
    ])
    assert.deepStrictEqual(payoutAccountDetailLines(UPI).map((line) => [line.label, line.value]), [
      ['Account Holder Name', 'Arif Khan'],
      ['UPI ID', 'arif@okaxis'],
    ])
  })
})

describe('calculatePayoutAccountStats', () => {
  test('returns stable zeros for an empty result', () => {
    assert.deepStrictEqual(calculatePayoutAccountStats([]), {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      approvalRate: 0,
      rejectionRate: 0,
    })
  })

  test('counts each state over every returned row and rounds both rates', () => {
    assert.deepStrictEqual(
      calculatePayoutAccountStats([
        { approvalStatus: 'PENDING' },
        { approvalStatus: 'PENDING' },
        { approvalStatus: 'APPROVED' },
        { approvalStatus: 'APPROVED' },
        { approvalStatus: 'REJECTED' },
        { approvalStatus: null },
      ]),
      {
        total: 6,
        pending: 2,
        approved: 2,
        rejected: 1,
        approvalRate: 33,
        rejectionRate: 17,
      },
    )
  })
})

describe('mutation inputs and export copy', () => {
  test('approve sends only the id', () => {
    assert.deepStrictEqual(buildApprovePayoutAccountInput('pa-1'), { id: 'pa-1' })
  })

  test('reject trims the reason and omits it when blank', () => {
    assert.deepStrictEqual(buildRejectPayoutAccountInput('pa-1', '  name mismatch  '), {
      id: 'pa-1',
      reason: 'name mismatch',
    })
    const blank = buildRejectPayoutAccountInput('pa-2', '   ')
    assert.deepStrictEqual(blank, { id: 'pa-2', reason: undefined })
    assert.deepStrictEqual(Object.keys(blank), ['id', 'reason'])
  })

  test('an export failure shows its message or the legacy fallback', () => {
    assert.equal(exportFailureMessage(new Error('Workbook save failed')), 'Workbook save failed')
    assert.equal(exportFailureMessage({ message: 'Plain object failure' }), 'Plain object failure')
    assert.equal(exportFailureMessage(new Error('')), 'Something went wrong during export.')
    assert.equal(exportFailureMessage('offline'), 'Something went wrong during export.')
    assert.equal(exportFailureMessage(null), 'Something went wrong during export.')
  })
})
