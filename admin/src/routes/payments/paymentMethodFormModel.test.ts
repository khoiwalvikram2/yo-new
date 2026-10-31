import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  bankEntry,
  bankFormValues,
  buildPaymentMethodsInput,
  createInitialValues,
  detailReviewRows,
  isImageFile,
  limitReviewRows,
  limitsIntro,
  pageSub,
  pageTitle,
  paymentMethodSchema,
  qrStatusText,
  resolveActiveType,
  resolveEditType,
  saveFailureMessage,
  stepFields,
  stepsFor,
  submitLabel,
  upiEntry,
  upiFormValues,
  type PaymentMethodFormValues,
  type StoredBank,
  type StoredPaymentMethods,
  type StoredUpi,
} from './paymentMethodFormModel'

function values(overrides: Partial<PaymentMethodFormValues> = {}): PaymentMethodFormValues {
  return { ...createInitialValues(null), ...overrides }
}

function issues(isBank: boolean, input: PaymentMethodFormValues): Record<string, string> {
  const result = paymentMethodSchema(isBank).safeParse(input)
  if (result.success) return {}
  const found: Record<string, string> = {}
  for (const issue of result.error.issues) found[issue.path.join('.')] ??= issue.message
  return found
}

const BANK: StoredBank = {
  __typename: 'BankDetails',
  id: 'b1',
  accountName: 'Vijay Kumar',
  accountNumber: '50100234567812',
  ifsc: 'HDFC0001204',
  bankName: 'HDFC Bank',
  branch: 'Andheri East',
  notes: null,
  minAmount: 100,
  maxAmount: 200000,
  weight: 3,
  enabled: false, vipTierIds: null,
} as StoredBank

const UPI: StoredUpi = {
  __typename: 'UpiDetails',
  id: 'u1',
  upiId: 'floxi@okaxis',
  displayName: null,
  qrKey: 'data:image/png;base64,AAAA',
  qrUrl: 'data:image/png;base64,AAAA',
  minAmount: null,
  maxAmount: 50000,
  weight: 1,
  enabled: true, vipTierIds: null,
} as StoredUpi

function stored(overrides: Partial<StoredPaymentMethods> = {}): StoredPaymentMethods {
  return {
    enabledMethods: ['BANK_TRANSFER', 'UPI'],
    banks: [BANK, { ...BANK, id: 'b2', accountName: 'Sunita Rathi' } as StoredBank],
    upis: [UPI],
    limits: { __typename: 'DepositLimits', min: 200, max: 250000 } as StoredPaymentMethods['limits'],
    ...overrides,
  }
}

describe('steps and rules', () => {
  test('keeps the legacy step copy and the fields each Next validates', () => {
    assert.deepStrictEqual(stepsFor(true).map((step) => [step.title, step.description, step.short]), [
      ['Bank Details', 'Account holder & routing', 'Bank Details'],
      ['Limits & Priority', 'Tiers, weight & status', 'Limits'],
      ['Review & Save', 'Confirm before publishing', 'Review'],
    ])
    assert.deepStrictEqual(stepsFor(false)[0], { title: 'UPI Details', description: 'UPI handle & QR', short: 'UPI Details' })
    assert.deepStrictEqual(stepFields(0, true), ['accountName', 'accountNumber', 'ifsc', 'bankName', 'branch'])
    assert.deepStrictEqual(stepFields(0, false), ['upiId'])
    assert.deepStrictEqual(stepFields(1, true), ['minAmount', 'maxAmount', 'weight', 'enabled', 'vipTierIds'])
    assert.deepStrictEqual(stepFields(2, false), [])
  })

  test('a bank needs its five details, as entered; a UPI needs only its UPI ID', () => {
    assert.deepStrictEqual(issues(true, values()), {
      accountName: 'Required', accountNumber: 'Required', ifsc: 'Required', bankName: 'Required', branch: 'Required',
    })
    assert.deepStrictEqual(issues(false, values()), { upiId: 'Required' })
    assert.deepStrictEqual(issues(false, values({ upiId: 'x@ybl' })), {})
    // antd's required rule let whitespace through and the save trimmed it; that is unchanged
    assert.deepStrictEqual(issues(false, values({ upiId: '   ' })), {})
  })

  test('amounts and weight: non-negative, the legacy max-below-min rule, and a whole-number weight', () => {
    const base = values({ upiId: 'x@ybl' })
    assert.deepStrictEqual(issues(false, { ...base, minAmount: -1, maxAmount: -5 }), {
      minAmount: 'Value must be at least 0',
      maxAmount: 'Value must be at least 0',
    })
    assert.deepStrictEqual(issues(false, { ...base, minAmount: 500, maxAmount: 100 }), { maxAmount: 'Must be > min' })
    assert.deepStrictEqual(issues(false, { ...base, minAmount: 500, maxAmount: 500 }), {}, 'equal is allowed')
    assert.deepStrictEqual(issues(false, { ...base, minAmount: 0, maxAmount: 100 }), {}, 'a zero minimum is no minimum')
    assert.deepStrictEqual(issues(false, { ...base, minAmount: null, maxAmount: 1 }), {})
    assert.deepStrictEqual(issues(false, { ...base, weight: 2.5 }), { weight: 'Enter a whole number' })
    assert.deepStrictEqual(issues(false, { ...base, weight: -1 }), { weight: 'Value must be at least 0' })
    assert.deepStrictEqual(issues(false, { ...base, weight: null }), {})
  })
})

describe('initial values and types', () => {
  test('a new method is active with weight 0, and takes a numeric tier max from the link', () => {
    assert.deepStrictEqual(createInitialValues(null), {
      accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '', notes: '',
      upiId: '', displayName: '', qrKey: null, minAmount: null, maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
    })
    assert.equal(createInitialValues('50000').maxAmount, 50000)
    assert.equal(createInitialValues('2500.5').maxAmount, 2500.5)
    assert.equal(createInitialValues('abc').maxAmount, null)
  })

  test('edit follows the list the id is in; create follows the choice, then the link', () => {
    assert.equal(resolveEditType(stored(), 'b2'), 'bank')
    assert.equal(resolveEditType(stored(), 'u1'), 'upi')
    assert.equal(resolveEditType(stored(), 'zz'), null)
    assert.equal(resolveEditType(undefined, 'b1'), null)
    assert.equal(resolveActiveType(true, 'bank', 'upi', 'upi'), 'bank')
    assert.equal(resolveActiveType(true, null, null, 'bank'), null)
    assert.equal(resolveActiveType(false, null, 'upi', 'bank'), 'upi')
    assert.equal(resolveActiveType(false, null, null, 'bank'), 'bank')
    assert.equal(resolveActiveType(false, null, null, null), null)
  })

  test('reads an edited record into the form, a missing enabled as active', () => {
    assert.deepStrictEqual(bankFormValues(BANK), {
      ...createInitialValues(null),
      accountName: 'Vijay Kumar', accountNumber: '50100234567812', ifsc: 'HDFC0001204', bankName: 'HDFC Bank',
      branch: 'Andheri East', notes: '', minAmount: 100, maxAmount: 200000, weight: 3, enabled: false, vipTierIds: null,
    })
    const noEnabled = { ...UPI } as StoredUpi
    delete noEnabled.enabled
    assert.deepStrictEqual(upiFormValues(noEnabled), {
      ...createInitialValues(null),
      upiId: 'floxi@okaxis', displayName: '', qrKey: 'data:image/png;base64,AAAA', minAmount: null, maxAmount: 50000,
      weight: 1, enabled: true, vipTierIds: null,
    })
  })
})

describe('the saved input', () => {
  const bankValues = values({
    accountName: '  Meena Patel ', accountNumber: ' 3221004567', ifsc: 'SBIN0001234 ', bankName: 'State Bank of India',
    branch: ' Navrangpura ', notes: '', minAmount: 0, maxAmount: 50000, weight: null, enabled: true, vipTierIds: null,
  })

  test('a bank entry trims its text and sends empty notes and amounts as null', () => {
    assert.deepStrictEqual(bankEntry(bankValues, 'bank-1'), {
      id: 'bank-1', accountName: 'Meena Patel', accountNumber: '3221004567', ifsc: 'SBIN0001234',
      bankName: 'State Bank of India', branch: 'Navrangpura', notes: null, minAmount: null, maxAmount: 50000,
      weight: 0, enabled: true, vipTierIds: null,
    })
  })

  test('a UPI entry keeps the UPI ID as typed and sends empty optional values as null', () => {
    assert.deepStrictEqual(upiEntry(values({ upiId: ' desk@ybl', displayName: '', qrKey: '', weight: 4, enabled: false, vipTierIds: null }), 'upi-1'), {
      id: 'upi-1', upiId: ' desk@ybl', displayName: null, qrKey: null, minAmount: null, maxAmount: null, weight: 4, enabled: false, vipTierIds: null,
    })
  })

  test('creating a bank appends it and sends the rest as stored, in the legacy key order', () => {
    const input = buildPaymentMethodsInput(stored(), bankValues, { isBank: true, isEdit: false, now: 1767225600000 })
    assert.deepStrictEqual(Object.keys(input), ['enabledMethods', 'banks', 'upis', 'limits'])
    assert.deepStrictEqual(input.banks.map((bank) => bank.id), ['b1', 'b2', 'bank-1767225600000'])
    assert.ok(input.banks.every((bank) => !('__typename' in bank)))
    assert.deepStrictEqual(input.upis, [{
      id: 'u1', upiId: 'floxi@okaxis', displayName: null, qrKey: 'data:image/png;base64,AAAA', minAmount: null,
      maxAmount: 50000, weight: 1, enabled: true, vipTierIds: null,
    }])
    assert.deepStrictEqual(input.limits, { min: 200, max: 250000 })
    assert.deepStrictEqual(input.enabledMethods, ['BANK_TRANSFER', 'UPI'])
  })

  test('the stored list is cleaned only of __typename: a missing enabled stays missing', () => {
    const noEnabled = { ...BANK } as StoredBank
    delete noEnabled.enabled
    const input = buildPaymentMethodsInput(stored({ banks: [noEnabled] }), bankValues, { isBank: true, isEdit: false, now: 1 })
    assert.equal('enabled' in input.banks[0], false)
  })

  test('editing replaces the entry in place and keeps its id', () => {
    const input = buildPaymentMethodsInput(stored(), bankValues, { isBank: true, isEdit: true, editId: 'b1' })
    assert.deepStrictEqual(input.banks.map((bank) => [bank.id, bank.accountName]), [['b1', 'Meena Patel'], ['b2', 'Sunita Rathi']])
  })

  test('a UPI is appended or replaced, the other list and limits fall back as before', () => {
    const upiValues = values({ upiId: 'desk@ybl', qrKey: 'data:image/png;base64,BBBB' })
    const created = buildPaymentMethodsInput(
      stored({ enabledMethods: null, limits: null }),
      upiValues,
      { isBank: false, isEdit: false, now: 42 },
    )
    assert.deepStrictEqual(created.enabledMethods, [])
    assert.deepStrictEqual(created.limits, { min: 100, max: 500000 })
    assert.deepStrictEqual(created.upis.map((upi) => [upi.id, upi.qrKey]), [
      ['u1', 'data:image/png;base64,AAAA'],
      ['upi-42', 'data:image/png;base64,BBBB'],
    ])
    assert.ok(created.upis.every((upi) => !('qrUrl' in upi)))
    assert.deepStrictEqual(created.banks.map((bank) => bank.id), ['b1', 'b2'])

    const edited = buildPaymentMethodsInput(stored(), upiValues, { isBank: false, isEdit: true, editId: 'u1' })
    assert.deepStrictEqual(edited.upis.map((upi) => [upi.id, upi.upiId]), [['u1', 'desk@ybl']])
  })

  test('an empty method set still produces a complete input', () => {
    const input = buildPaymentMethodsInput(undefined, values({ upiId: 'a@b' }), { isBank: false, isEdit: false, now: 7 })
    assert.deepStrictEqual(input, {
      enabledMethods: [],
      banks: [],
      upis: [{ id: 'upi-7', upiId: 'a@b', displayName: null, qrKey: null, minAmount: null, maxAmount: null, weight: 0, enabled: true, vipTierIds: null }],
      limits: { min: 100, max: 500000 },
    })
  })
})

describe('review and copy', () => {
  const format = (amount: number) => `INR ${amount.toFixed(2)}`

  test('lists the legacy review rows with dashes for empty values', () => {
    assert.deepStrictEqual(detailReviewRows(values({ accountName: 'Vijay', ifsc: 'HDFC0001204' }), true, false), [
      { label: 'Account Name', value: 'Vijay' },
      { label: 'Account No.', value: '—' },
      { label: 'IFSC', value: 'HDFC0001204' },
      { label: 'Bank', value: '—' },
      { label: 'Branch', value: '—' },
    ])
    assert.deepStrictEqual(detailReviewRows(values({ notes: 'IMPS only' }), true, false).at(-1), { label: 'Notes', value: 'IMPS only' })
    assert.deepStrictEqual(detailReviewRows(values({ upiId: 'a@b' }), false, true), [
      { label: 'UPI ID', value: 'a@b' },
      { label: 'Display Name', value: '—' },
      { label: 'QR Code', value: 'Attached' },
    ])
    assert.equal(detailReviewRows(values(), false, false)[2]?.value, 'Not added')
  })

  test('prints limits the legacy way, a zero minimum as no minimum', () => {
    assert.deepStrictEqual(limitReviewRows(values({ minAmount: 0, maxAmount: null, weight: null, enabled: true, vipTierIds: null }), format), [
      { label: 'Min Amount', value: 'No minimum' },
      { label: 'Max Amount', value: 'Unlimited' },
      { label: 'Weight', value: '0' },
      { label: 'Status', value: 'Active' },
    ])
    assert.deepStrictEqual(limitReviewRows(values({ minAmount: 500, maxAmount: 99999, weight: 4, enabled: false, vipTierIds: null }), format).map((row) => row.value), [
      'INR 500.00', 'INR 99999.00', '4', 'Inactive',
    ])
  })

  test('keeps the titles, labels and messages', () => {
    assert.equal(pageTitle(false, true), 'Add Payment Method')
    assert.equal(pageTitle(true, true), 'Edit Bank Account')
    assert.equal(pageTitle(true, false), 'Edit UPI Account')
    assert.equal(pageSub(false, false), 'Add a new bank account or UPI account for deposits')
    assert.equal(pageSub(true, true), 'Update bank account details')
    assert.equal(pageSub(true, false), 'Update UPI account details')
    assert.equal(submitLabel(false, true), 'Create Bank Account')
    assert.equal(submitLabel(true, false), 'Update UPI Account')
    assert.equal(limitsIntro(false), 'Set account amount limits, VIP access and display priority.')
    assert.equal(limitsIntro(true), 'Update account amount limits, VIP access and display priority.')
    assert.equal(saveFailureMessage(new Error('Network down'), false), 'Network down')
    assert.equal(saveFailureMessage(new Error(''), true), 'Failed to update payment method')
    assert.equal(saveFailureMessage('boom', false), 'Failed to create payment method')
    assert.equal(qrStatusText(true, true), 'Preview — ready to save')
    assert.equal(qrStatusText(false, true), 'Current QR code')
    assert.equal(qrStatusText(false, false), 'Saved')
    assert.equal(isImageFile({ type: 'image/png' }), true)
    assert.equal(isImageFile({ type: 'application/pdf' }), false)
  })
})
