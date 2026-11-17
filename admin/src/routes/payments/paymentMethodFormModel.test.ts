import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  bankEntry,
  bankFormValues,
  buildCryptoMethodsInput,
  buildPaymentMethodsInput,
  createInitialValues,
  cryptoEntry,
  cryptoFormValues,
  cryptoLimitsNote,
  cryptoRateReviewRow,
  detailReviewRows,
  findStoredCrypto,
  isImageFile,
  limitReviewRows,
  limitsIntro,
  methodKindOf,
  pageSub,
  pageTitle,
  paymentMethodSchema,
  qrStatusText,
  resolveActiveType,
  resolveEditType,
  saveFailureMessage,
  stepFields,
  stepsFor,
  storedFormValues,
  submitLabel,
  upiEntry,
  upiFormValues,
  type PaymentMethodFormValues,
  type PaymentMethodKind,
  type StoredBank,
  type StoredCrypto,
  type StoredPaymentMethods,
  type StoredUpi,
} from './paymentMethodFormModel'

function values(overrides: Partial<PaymentMethodFormValues> = {}): PaymentMethodFormValues {
  return { ...createInitialValues(null), ...overrides }
}

function issues(kind: PaymentMethodKind, input: PaymentMethodFormValues): Record<string, string> {
  const result = paymentMethodSchema(kind).safeParse(input)
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
    assert.deepStrictEqual(stepsFor('bank').map((step) => [step.title, step.description, step.short]), [
      ['Bank Details', 'Account holder & routing', 'Bank Details'],
      ['Limits & Priority', 'Tiers, weight & status', 'Limits'],
      ['Review & Save', 'Confirm before publishing', 'Review'],
    ])
    assert.deepStrictEqual(stepsFor('upi')[0], { title: 'UPI Details', description: 'UPI handle & QR', short: 'UPI Details' })
    assert.deepStrictEqual(stepFields(0, 'bank'), ['accountName', 'accountNumber', 'ifsc', 'bankName', 'branch'])
    assert.deepStrictEqual(stepFields(0, 'upi'), ['upiId'])
    assert.deepStrictEqual(stepFields(1, 'bank'), ['minAmount', 'maxAmount', 'weight', 'enabled', 'vipTierIds'])
    assert.deepStrictEqual(stepFields(2, 'upi'), [])
  })

  test('a bank needs its five details, as entered; a UPI needs only its UPI ID', () => {
    assert.deepStrictEqual(issues('bank', values()), {
      accountName: 'Required', accountNumber: 'Required', ifsc: 'Required', bankName: 'Required', branch: 'Required',
    })
    assert.deepStrictEqual(issues('upi', values()), { upiId: 'Required' })
    assert.deepStrictEqual(issues('upi', values({ upiId: 'x@ybl' })), {})
    // antd's required rule let whitespace through and the save trimmed it; that is unchanged
    assert.deepStrictEqual(issues('upi', values({ upiId: '   ' })), {})
  })

  test('amounts and weight: non-negative, the legacy max-below-min rule, and a whole-number weight', () => {
    const base = values({ upiId: 'x@ybl' })
    assert.deepStrictEqual(issues('upi', { ...base, minAmount: -1, maxAmount: -5 }), {
      minAmount: 'Value must be at least 0',
      maxAmount: 'Value must be at least 0',
    })
    assert.deepStrictEqual(issues('upi', { ...base, minAmount: 500, maxAmount: 100 }), { maxAmount: 'Must be > min' })
    assert.deepStrictEqual(issues('upi', { ...base, minAmount: 500, maxAmount: 500 }), {}, 'equal is allowed')
    assert.deepStrictEqual(issues('upi', { ...base, minAmount: 0, maxAmount: 100 }), {}, 'a zero minimum is no minimum')
    assert.deepStrictEqual(issues('upi', { ...base, minAmount: null, maxAmount: 1 }), {})
    assert.deepStrictEqual(issues('upi', { ...base, weight: 2.5 }), { weight: 'Enter a whole number' })
    assert.deepStrictEqual(issues('upi', { ...base, weight: -1 }), { weight: 'Value must be at least 0' })
    assert.deepStrictEqual(issues('upi', { ...base, weight: null }), {})
  })
})

describe('initial values and types', () => {
  test('a new method is active with weight 0, and takes a numeric tier max from the link', () => {
    assert.deepStrictEqual(createInitialValues(null), {
      accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '', notes: '',
      upiId: '', network: 'TRC20', walletAddress: '', displayName: '', qrKey: null, minAmount: null, maxAmount: null,
      weight: 0, enabled: true, vipTierIds: null,
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
    assert.deepStrictEqual(detailReviewRows(values({ accountName: 'Vijay', ifsc: 'HDFC0001204' }), 'bank', false), [
      { label: 'Account Name', value: 'Vijay' },
      { label: 'Account No.', value: '—' },
      { label: 'IFSC', value: 'HDFC0001204' },
      { label: 'Bank', value: '—' },
      { label: 'Branch', value: '—' },
    ])
    assert.deepStrictEqual(detailReviewRows(values({ notes: 'IMPS only' }), 'bank', false).at(-1), { label: 'Notes', value: 'IMPS only' })
    assert.deepStrictEqual(detailReviewRows(values({ upiId: 'a@b' }), 'upi', true), [
      { label: 'UPI ID', value: 'a@b' },
      { label: 'Display Name', value: '—' },
      { label: 'QR Code', value: 'Attached' },
    ])
    assert.equal(detailReviewRows(values(), 'upi', false)[2]?.value, 'Not added')
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
    assert.equal(pageTitle(false, 'bank'), 'Add Payment Method')
    assert.equal(pageTitle(true, 'bank'), 'Edit Bank Account')
    assert.equal(pageTitle(true, 'upi'), 'Edit UPI Account')
    assert.equal(pageSub(false, 'upi'), 'Add a new bank account, UPI account or crypto wallet for deposits')
    assert.equal(pageSub(true, 'bank'), 'Update bank account details')
    assert.equal(pageSub(true, 'upi'), 'Update UPI account details')
    assert.equal(submitLabel(false, 'bank'), 'Create Bank Account')
    assert.equal(submitLabel(true, 'upi'), 'Update UPI Account')
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

describe('crypto wallets', () => {
  const TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
  const EVM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
  const TIER = '11111111-1111-4111-8111-111111111111'
  const WALLET: StoredCrypto = {
    __typename: 'CryptoDetails',
    id: 'c1',
    network: 'TRC20',
    walletAddress: TRON,
    displayName: null,
    qrKey: 'data:image/png;base64,CCCC',
    qrUrl: 'data:image/png;base64,CCCC',
    minAmount: 1000,
    maxAmount: null,
    weight: 2,
    enabled: true,
    vipTierIds: [TIER],
  } as StoredCrypto
  const format = (amount: number) => `INR ${amount.toFixed(2)}`

  test('a wallet is its own type: steps, the fields its Next checks, its copy and how it is found', () => {
    assert.deepStrictEqual(stepsFor('crypto')[0], {
      title: 'Wallet Details', description: 'Network, address & QR', short: 'Wallet Details',
    })
    assert.deepStrictEqual(stepFields(0, 'crypto'), ['network', 'walletAddress'])
    assert.deepStrictEqual(stepFields(1, 'crypto'), ['minAmount', 'maxAmount', 'weight', 'enabled', 'vipTierIds'])
    assert.deepStrictEqual(['bank', 'upi', 'crypto', null, 'other'].map(methodKindOf), ['bank', 'upi', 'crypto', 'upi', 'upi'])
    assert.equal(resolveEditType(stored({ cryptos: [WALLET] }), 'c1'), 'crypto')
    assert.equal(pageTitle(true, 'crypto'), 'Edit Crypto Wallet')
    assert.equal(pageSub(true, 'crypto'), 'Update crypto wallet details')
    assert.equal(submitLabel(false, 'crypto'), 'Create Crypto Wallet')
    assert.equal(submitLabel(true, 'crypto'), 'Update Crypto Wallet')
    assert.equal(cryptoLimitsNote('₹'), 'Limits are in the deposit currency (₹), not in USDT.')
  })

  test('the address is required and must be one on the chosen network', () => {
    assert.deepStrictEqual(issues('crypto', values()), { walletAddress: 'Required' })
    assert.deepStrictEqual(issues('crypto', values({ walletAddress: '   ' })), { walletAddress: 'Required' })
    assert.deepStrictEqual(issues('crypto', values({ walletAddress: TRON })), {})
    assert.deepStrictEqual(issues('crypto', values({ walletAddress: ` ${TRON} ` })), {}, 'checked as it is saved: trimmed')
    assert.deepStrictEqual(issues('crypto', values({ network: 'BEP20', walletAddress: TRON })), {
      walletAddress: 'A BEP20 address must start with 0x followed by 40 hex characters',
    })
    assert.deepStrictEqual(issues('crypto', values({ network: 'ERC20', walletAddress: EVM })), {})
    assert.deepStrictEqual(issues('crypto', values({ network: '', walletAddress: TRON })), { network: 'Required' })
    assert.deepStrictEqual(issues('crypto', values({ network: 'ARBITRUM', walletAddress: TRON })), {
      network: 'Choose a supported network',
    })
    assert.deepStrictEqual(issues('upi', values({ upiId: 'x@ybl', network: '' })), {}, 'other types ask for no wallet')
  })

  test('reads a stored wallet into the form, by the kind of the edited record', () => {
    assert.deepStrictEqual(cryptoFormValues(WALLET), {
      ...createInitialValues(null),
      network: 'TRC20', walletAddress: TRON, displayName: '', qrKey: 'data:image/png;base64,CCCC',
      minAmount: 1000, maxAmount: null, weight: 2, enabled: true, vipTierIds: [TIER],
    })
    const methods = stored({ cryptos: [WALLET] })
    assert.deepStrictEqual(storedFormValues(methods, 'c1', 'crypto'), cryptoFormValues(WALLET))
    assert.deepStrictEqual(storedFormValues(methods, 'b1', 'bank'), bankFormValues(BANK))
    assert.deepStrictEqual(storedFormValues(methods, 'u1', 'upi'), upiFormValues(UPI))
    assert.equal(storedFormValues(methods, 'b1', 'crypto'), null)
    assert.equal(findStoredCrypto(undefined, 'c1'), null)
  })

  test('a wallet entry trims its address and name and sends empty optional values as null', () => {
    assert.deepStrictEqual(
      cryptoEntry(values({ walletAddress: `  ${TRON} `, displayName: '  ', qrKey: '', weight: null }), 'crypto-1'),
      {
        id: 'crypto-1', network: 'TRC20', walletAddress: TRON, displayName: null, qrKey: null, minAmount: null,
        maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
      },
    )
    assert.equal(cryptoEntry(values({ displayName: ' Main Tron ' }), 'c').displayName, 'Main Tron')
  })

  test('saving a wallet sends the wallet list alone, the stored wallets without output-only fields', () => {
    const methods = stored({ cryptos: [WALLET], cryptoRate: 92.5 })
    const created = buildCryptoMethodsInput(methods, values({ network: 'ERC20', walletAddress: EVM }), { isEdit: false, now: 42 })
    assert.deepStrictEqual(Object.keys(created), ['cryptos'], 'banks, UPIs, limits and the rate are kept by the server')
    assert.deepStrictEqual(created.cryptos, [
      {
        id: 'c1', network: 'TRC20', walletAddress: TRON, displayName: null, qrKey: 'data:image/png;base64,CCCC',
        minAmount: 1000, maxAmount: null, weight: 2, enabled: true, vipTierIds: [TIER],
      },
      {
        id: 'crypto-42', network: 'ERC20', walletAddress: EVM, displayName: null, qrKey: null, minAmount: null,
        maxAmount: null, weight: 0, enabled: true, vipTierIds: null,
      },
    ])

    const edited = buildCryptoMethodsInput(
      methods,
      { ...cryptoFormValues(WALLET), displayName: 'Tron main' },
      { isEdit: true, editId: 'c1' },
    )
    assert.deepStrictEqual(edited.cryptos.map((wallet) => [wallet.id, wallet.displayName, wallet.vipTierIds]), [
      ['c1', 'Tron main', [TIER]],
    ])
    assert.deepStrictEqual(
      buildCryptoMethodsInput(undefined, values({ walletAddress: TRON }), { isEdit: false, now: 7 }).cryptos.map((wallet) => wallet.id),
      ['crypto-7'],
    )
  })

  test('the review lists the wallet, then the whitelabel rate every wallet uses', () => {
    assert.deepStrictEqual(detailReviewRows(values({ network: 'BEP20', walletAddress: ` ${EVM} ` }), 'crypto', true), [
      { label: 'Coin', value: 'USDT' },
      { label: 'Network', value: 'BEP20 (BNB Smart Chain)' },
      { label: 'Wallet Address', value: EVM },
      { label: 'Display Name', value: '—' },
      { label: 'QR Code', value: 'Attached' },
    ])
    assert.deepStrictEqual(cryptoRateReviewRow(92.5, format), { label: 'USDT Rate', value: '1 USDT = INR 92.50' })
    assert.deepStrictEqual(cryptoRateReviewRow(null, format), { label: 'USDT Rate', value: 'Not set' })
  })
})
