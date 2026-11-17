import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  accountCountLabel,
  addMethodLabel,
  addMethodPath,
  bankDetailLines,
  buildDeleteBankInput,
  buildDeleteUpiInput,
  buildToggleBankInput,
  buildToggleUpiInput,
  clampPage,
  cleanBankForInput,
  cleanUpiForInput,
  deleteConfirmTitle,
  editMethodPath,
  hasQrCode,
  limitsForInput,
  maxLimitLabel,
  methodName,
  minLimitLabel,
  pageSlice,
  paymentMethodStats,
  priorityStarCount,
  statusSwitchLabel,
  tabEmptyTitle,
  tabItemName,
  tabMethodType,
  tabTitle,
  upiTitle,
  buildCryptoBonusInput,
  buildCryptoRateInput,
  buildDeleteCryptoInput,
  buildToggleCryptoInput,
  canSaveCryptoBonus,
  canSaveCryptoRate,
  cleanCryptoForInput,
  cryptoBonusDraftError,
  cryptoBonusExample,
  cryptoBonusPreview,
  cryptoRateDraftError,
  cryptoRateExample,
  cryptoRatePreview,
  tabCountLabel,
  type BankDetail,
  type CryptoDetail,
  type UpiDetail,
  type WhitelabelPaymentMethodsData,
} from './paymentMethodsListModel'

/** Rows as Apollo returns them: with `__typename`, and for a UPI the displayable `qrUrl`. */
function bank(id: string, overrides: Partial<BankDetail> = {}): BankDetail {
  return {
    __typename: 'BankDetails',
    id,
    accountName: `Account ${id}`,
    accountNumber: `5010${id}`,
    ifsc: 'HDFC0001204',
    bankName: 'HDFC Bank',
    branch: 'Andheri East',
    notes: null,
    minAmount: 100,
    maxAmount: 50000,
    weight: 2,
    enabled: true,
    ...overrides,
  } as BankDetail
}

function upi(id: string, overrides: Partial<UpiDetail> = {}): UpiDetail {
  return {
    __typename: 'UpiDetails',
    id,
    upiId: `${id}@okaxis`,
    displayName: null,
    qrKey: `qr/${id}.png`,
    qrUrl: `https://bucket.example.test/qr/${id}.png?sig=1`,
    minAmount: null,
    maxAmount: null,
    weight: 0,
    enabled: true,
    ...overrides,
  } as UpiDetail
}

function crypto(id: string, overrides: Partial<CryptoDetail> = {}): CryptoDetail {
  return {
    __typename: 'CryptoDetails',
    id,
    network: 'TRC20',
    walletAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    displayName: null,
    qrKey: `data:image/png;base64,${id}`,
    qrUrl: `data:image/png;base64,${id}`,
    minAmount: null,
    maxAmount: null,
    weight: 1,
    enabled: true,
    vipTierIds: null,
    ...overrides,
  } as CryptoDetail
}

function methods(overrides: Partial<WhitelabelPaymentMethodsData> = {}): WhitelabelPaymentMethodsData {
  return {
    enabledMethods: ['BANK_TRANSFER', 'UPI'],
    banks: [bank('b1'), bank('b2', { enabled: false })],
    upis: [upi('u1'), upi('u2', { enabled: false })],
    limits: { __typename: 'DepositLimits', min: 200, max: 250000 } as WhitelabelPaymentMethodsData['limits'],
    ...overrides,
  }
}

describe('input cleaning', () => {
  test('a bank loses only __typename, keeps its key order, and a missing enabled is sent as true', () => {
    const cleaned = cleanBankForInput(bank('b1'))
    assert.deepStrictEqual(Object.keys(cleaned), [
      'id', 'accountName', 'accountNumber', 'ifsc', 'bankName', 'branch', 'notes', 'minAmount', 'maxAmount',
      'weight', 'enabled',
    ])
    assert.equal('__typename' in cleaned, false)

    const missing = bank('b3')
    delete missing.enabled
    assert.equal(cleanBankForInput(missing).enabled, true)
    assert.equal(cleanBankForInput(bank('b4', { enabled: false })).enabled, false)
  })

  test('a UPI loses __typename and the output-only qrUrl but keeps its stored qrKey', () => {
    const cleaned = cleanUpiForInput(upi('u1'))
    assert.deepStrictEqual(cleaned, {
      id: 'u1',
      upiId: 'u1@okaxis',
      displayName: null,
      qrKey: 'qr/u1.png',
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: true,
    })
    const missing = upi('u3')
    delete missing.enabled
    assert.equal(cleanUpiForInput(missing).enabled, true)
  })

  test('limits copy only min and max, and fall back to the legacy defaults', () => {
    assert.deepStrictEqual(limitsForInput(methods()), { min: 200, max: 250000 })
    assert.deepStrictEqual(limitsForInput(methods({ limits: null })), { min: 100, max: 500000 })
    assert.deepStrictEqual(limitsForInput(undefined), { min: 100, max: 500000 })
  })
})

describe('upsert payloads', () => {
  test('deleting a bank sends every other method, in the legacy key order', () => {
    const input = buildDeleteBankInput(methods(), 'b1')
    assert.deepStrictEqual(Object.keys(input), ['enabledMethods', 'banks', 'upis', 'limits'])
    assert.deepStrictEqual(input.enabledMethods, ['BANK_TRANSFER', 'UPI'])
    assert.deepStrictEqual(input.banks.map((row) => row.id), ['b2'])
    assert.deepStrictEqual(input.upis.map((row) => row.id), ['u1', 'u2'])
    assert.ok(input.upis.every((row) => !('qrUrl' in row) && !('__typename' in row)))
    assert.deepStrictEqual(input.limits, { min: 200, max: 250000 })
  })

  test('deleting the last bank or UPI sends an empty list, and no enabled methods sends []', () => {
    const lone = methods({ banks: [bank('b1')], upis: [upi('u1')], enabledMethods: null })
    assert.deepStrictEqual(buildDeleteBankInput(lone, 'b1').banks, [])
    assert.deepStrictEqual(buildDeleteUpiInput(lone, 'u1').upis, [])
    assert.deepStrictEqual(buildDeleteUpiInput(lone, 'u1').enabledMethods, [])
    assert.deepStrictEqual(buildDeleteUpiInput(lone, 'u1').banks.map((row) => row.id), ['b1'])
  })

  test('toggling changes only the target row and leaves the other list untouched', () => {
    const bankInput = buildToggleBankInput(methods(), 'b2', true)
    assert.deepStrictEqual(bankInput.banks.map((row) => [row.id, row.enabled]), [['b1', true], ['b2', true]])
    assert.deepStrictEqual(bankInput.upis.map((row) => [row.id, row.enabled]), [['u1', true], ['u2', false]])

    const upiInput = buildToggleUpiInput(methods(), 'u1', false)
    assert.deepStrictEqual(upiInput.upis.map((row) => [row.id, row.enabled]), [['u1', false], ['u2', false]])
    assert.deepStrictEqual(upiInput.banks.map((row) => [row.id, row.enabled]), [['b1', true], ['b2', false]])
    assert.deepStrictEqual(Object.keys(upiInput), ['enabledMethods', 'banks', 'upis', 'limits'])
  })

  test('an empty or missing method set still produces a complete input', () => {
    assert.deepStrictEqual(buildToggleBankInput(undefined, 'x', true), {
      enabledMethods: [],
      banks: [],
      upis: [],
      limits: { min: 100, max: 500000 },
    })
  })
})

describe('stats', () => {
  test('counts active and inactive per list, treating a missing enabled as inactive', () => {
    const missing = bank('b3')
    delete missing.enabled
    const stats = paymentMethodStats([bank('b1'), bank('b2', { enabled: false }), missing], [upi('u1')])
    assert.deepStrictEqual(stats, {
      banks: { total: 3, active: 1, inactive: 2 },
      upis: { total: 1, active: 1, inactive: 0 },
      cryptos: { total: 0, active: 0, inactive: 0 },
      total: 4,
      active: 2,
      activeRate: 50,
    })
  })

  test('counts crypto wallets in their own card and in the totals', () => {
    const stats = paymentMethodStats([bank('b1')], [upi('u1', { enabled: false })], [crypto('c1'), crypto('c2', { enabled: false })])
    assert.deepStrictEqual(stats.cryptos, { total: 2, active: 1, inactive: 1 })
    assert.equal(stats.total, 4)
    assert.equal(stats.active, 2)
    assert.equal(stats.activeRate, 50)
  })

  test('rounds the active rate to a whole percent and is 0 with no methods', () => {
    assert.equal(paymentMethodStats([bank('b1'), bank('b2'), bank('b3', { enabled: false })], []).activeRate, 67)
    assert.equal(paymentMethodStats([], []).activeRate, 0)
  })
})

describe('paging', () => {
  const rows = Array.from({ length: 23 }, (_, index) => index + 1)

  test('slices the client-side page', () => {
    assert.deepStrictEqual(pageSlice(rows, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepStrictEqual(pageSlice(rows, 3, 10), [21, 22, 23])
    assert.deepStrictEqual(pageSlice(rows, 2, 20), [21, 22, 23])
  })

  test('shows the last page instead of nothing when the page is past the end', () => {
    assert.equal(clampPage(4, 23, 10), 3)
    assert.deepStrictEqual(pageSlice(rows.slice(0, 10), 2, 10), rows.slice(0, 10))
    assert.equal(clampPage(0, 23, 10), 1)
    assert.equal(clampPage(2, 0, 10), 1)
    assert.deepStrictEqual(pageSlice([], 1, 10), [])
  })
})

describe('copy and paths', () => {
  test('keeps the legacy tab copy, counts and links', () => {
    assert.equal(accountCountLabel(1), '1 account')
    assert.equal(accountCountLabel(0), '0 accounts')
    assert.equal(accountCountLabel(12), '12 accounts')
    assert.deepStrictEqual(
      (['banks', 'upis'] as const).map((tab) => [
        tabTitle(tab), tabEmptyTitle(tab), tabItemName(tab), tabMethodType(tab), addMethodLabel(tab), addMethodPath(tab),
      ]),
      [
        ['Bank Accounts', 'No bank accounts found', 'bank accounts', 'bank', 'Add Bank', '/payments/methods/create?type=bank'],
        ['UPI Accounts', 'No UPI accounts found', 'UPI accounts', 'upi', 'Add UPI', '/payments/methods/create?type=upi'],
      ],
    )
    assert.equal(editMethodPath('bank', 'b1'), '/payments/methods/edit/bank/b1')
    assert.equal(editMethodPath('upi', 'u-7'), '/payments/methods/edit/upi/u-7')
    assert.equal(deleteConfirmTitle('bank'), 'Delete Bank Account')
    assert.equal(deleteConfirmTitle('upi'), 'Delete UPI Account')
  })

  test('prints a dash for no minimum, infinity for no maximum, and formats a zero', () => {
    const format = (amount: number) => `INR ${amount.toFixed(2)}`
    assert.equal(minLimitLabel(null, format), '—')
    assert.equal(minLimitLabel(undefined, format), '—')
    assert.equal(minLimitLabel(0, format), 'INR 0.00')
    assert.equal(maxLimitLabel(null, format), '∞')
    assert.equal(maxLimitLabel(9999999, format), 'INR 9999999.00')
  })

  test('fills a star for each whole step of the weight, at most five', () => {
    assert.deepStrictEqual([0, 1, 2.5, 5, 9, -3, Number.NaN].map(priorityStarCount), [0, 1, 2, 5, 5, 0, 0])
  })

  test('lists the bank detail lines in the legacy order, empty values as empty strings', () => {
    assert.deepStrictEqual(bankDetailLines({ accountNumber: '50100234567812', ifsc: 'HDFC0001204', bankName: 'HDFC Bank', branch: '' }), [
      { key: 'accountNumber', label: 'A/C No', value: '50100234567812', mono: true },
      { key: 'ifsc', label: 'IFSC', value: 'HDFC0001204', mono: true },
      { key: 'bankName', label: 'Bank', value: 'HDFC Bank', mono: false },
      { key: 'branch', label: 'Branch', value: '', mono: false },
    ])
  })

  test('titles a UPI by its display name, then its VPA, and reads its QR state', () => {
    assert.equal(upiTitle({ displayName: 'Floxi Collections', upiId: 'floxi@okaxis' }), 'Floxi Collections')
    assert.equal(upiTitle({ displayName: null, upiId: 'floxi@okaxis' }), 'floxi@okaxis')
    assert.equal(hasQrCode({ qrUrl: null, qrKey: 'qr/a.png' }), true)
    assert.equal(hasQrCode({ qrUrl: 'https://x.test/a.png', qrKey: null }), true)
    assert.equal(hasQrCode({ qrUrl: null, qrKey: null }), false)
  })

  test('names a row control by its title, or by its kind when the title is empty', () => {
    assert.equal(methodName('Vijay Kumar', 'bank'), 'Vijay Kumar')
    assert.equal(methodName('', 'bank'), 'Bank account')
    assert.equal(methodName(null, 'upi'), 'UPI account')
    assert.equal(statusSwitchLabel('Vijay Kumar', 'bank'), 'Vijay Kumar active')
    assert.equal(statusSwitchLabel('', 'upi'), 'UPI account active')
  })
})

describe('crypto wallets', () => {
  test('the third tab has its own copy, links and a wallet count', () => {
    assert.deepStrictEqual(
      [tabTitle('cryptos'), tabEmptyTitle('cryptos'), tabItemName('cryptos'), tabMethodType('cryptos'), addMethodLabel('cryptos'), addMethodPath('cryptos')],
      ['Crypto Wallets', 'No crypto wallets found', 'crypto wallets', 'crypto', 'Add Crypto', '/payments/methods/create?type=crypto'],
    )
    assert.equal(editMethodPath('crypto', 'crypto-17'), '/payments/methods/edit/crypto/crypto-17')
    assert.equal(deleteConfirmTitle('crypto'), 'Delete Crypto Wallet')
    assert.equal(methodName('', 'crypto'), 'Crypto wallet')
    assert.equal(tabCountLabel('cryptos', 1), '1 wallet')
    assert.equal(tabCountLabel('cryptos', 3), '3 wallets')
    assert.equal(tabCountLabel('banks', 3), '3 accounts')
  })

  test('a wallet loses __typename and the output-only qrUrl; its VIP tiers and QR key go back as stored', () => {
    assert.deepStrictEqual(cleanCryptoForInput(crypto('c1', { vipTierIds: ['tier-1'] })), {
      id: 'c1',
      network: 'TRC20',
      walletAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      displayName: null,
      qrKey: 'data:image/png;base64,c1',
      minAmount: null,
      maxAmount: null,
      weight: 1,
      enabled: true,
      vipTierIds: ['tier-1'],
    })
    const missing = crypto('c2')
    delete missing.enabled
    assert.equal(cleanCryptoForInput(missing).enabled, true)
  })

  test('a wallet toggle or delete sends only the wallet list; banks, UPIs and limits are left to the server', () => {
    const stored = methods({ cryptos: [crypto('c1'), crypto('c2', { enabled: false })], cryptoRate: 92.5 })
    const toggled = buildToggleCryptoInput(stored, 'c2', true)
    assert.deepStrictEqual(Object.keys(toggled), ['cryptos'])
    assert.deepStrictEqual(toggled.cryptos.map((row) => [row.id, row.enabled]), [['c1', true], ['c2', true]])
    assert.ok(toggled.cryptos.every((row) => !('qrUrl' in row) && !('__typename' in row)))

    assert.deepStrictEqual(buildDeleteCryptoInput(stored, 'c1'), { cryptos: [cleanCryptoForInput(crypto('c2', { enabled: false }))] })
    assert.deepStrictEqual(buildDeleteCryptoInput(methods({ cryptos: [crypto('c1')] }), 'c1'), { cryptos: [] }, 'the last wallet goes as []')
    assert.deepStrictEqual(buildToggleCryptoInput(undefined, 'x', true), { cryptos: [] })
  })

  test('the rate and the bonus each save alone; an empty bonus switches it off', () => {
    assert.deepStrictEqual(buildCryptoRateInput(92.5), { cryptoRate: 92.5 })
    assert.deepStrictEqual(buildCryptoBonusInput(5), { cryptoBonusPercent: 5 })
    assert.deepStrictEqual(buildCryptoBonusInput(null), { cryptoBonusPercent: 0 })
  })

  test('a rate saves when it is above 0, at most 1,000,000 and new; the field cannot clear it', () => {
    assert.equal(cryptoRateDraftError(null), null)
    assert.equal(cryptoRateDraftError(92.5), null)
    assert.equal(cryptoRateDraftError(0), 'The USDT rate must be above 0')
    assert.equal(cryptoRateDraftError(-4), 'The USDT rate must be above 0')
    assert.equal(cryptoRateDraftError(1_000_001), 'The USDT rate can be at most 10,00,000')
    assert.equal(canSaveCryptoRate(92.5, null), true)
    assert.equal(canSaveCryptoRate(92.5, 88), true)
    assert.equal(canSaveCryptoRate(88, 88), false, 'unchanged')
    assert.equal(canSaveCryptoRate(null, 88), false, 'a rate can only be replaced')
    assert.equal(canSaveCryptoRate(0, null), false)
  })

  test('a bonus saves when it is 0-50% and new; empty and 0 both mean none', () => {
    assert.equal(cryptoBonusDraftError(null), null)
    assert.equal(cryptoBonusDraftError(0), null)
    assert.equal(cryptoBonusDraftError(50), null)
    assert.equal(cryptoBonusDraftError(50.5), 'Crypto bonus can be at most 50%')
    assert.equal(cryptoBonusDraftError(-1), 'Crypto bonus cannot be negative')
    assert.equal(canSaveCryptoBonus(5, null), true)
    assert.equal(canSaveCryptoBonus(0, 5), true, 'switching it off')
    assert.equal(canSaveCryptoBonus(null, 5), true)
    assert.equal(canSaveCryptoBonus(0, null), false, 'already none')
    assert.equal(canSaveCryptoBonus(5, 5), false)
    assert.equal(canSaveCryptoBonus(60, null), false)
  })

  test('the examples follow the typed value while it is valid, else the stored one', () => {
    assert.equal(cryptoRatePreview(92.5, 88), 92.5)
    assert.equal(cryptoRatePreview(-1, 88), 88)
    assert.equal(cryptoRatePreview(null, 88), 88)
    assert.equal(cryptoRatePreview(null, null), null)
    assert.equal(cryptoBonusPreview(5, 2), 5)
    assert.equal(cryptoBonusPreview(null, 2), null, 'an emptied field previews no bonus')
    assert.equal(cryptoBonusPreview(70, 2), 2)
  })

  test('works the examples on a ₹10,000 deposit: USDT rounded up, the bonus rounded down', () => {
    const format = (amount: number, wholeUnits?: boolean) => `₹${amount.toLocaleString('en-IN', {
      minimumFractionDigits: wholeUnits ? 0 : 2,
      maximumFractionDigits: wholeUnits ? 0 : 2,
    })}`
    assert.equal(cryptoRateExample(92.5, format), 'A ₹10,000 deposit asks the player for 108.11 USDT')
    assert.equal(cryptoRateExample(100, format), 'A ₹10,000 deposit asks the player for 100.00 USDT')
    assert.equal(cryptoRateExample(null, format), 'No rate saved yet')
    assert.equal(
      cryptoBonusExample(5, format),
      'On approval a ₹10,000 crypto deposit also gets ₹500.00 bonus in the cash wallet (₹10,500.00 in all)',
    )
    assert.equal(
      cryptoBonusExample(0.333, format),
      'On approval a ₹10,000 crypto deposit also gets ₹33.30 bonus in the cash wallet (₹10,033.30 in all)',
    )
    assert.equal(cryptoBonusExample(null, format), 'No bonus. Set up to 50% to add an extra % to every approved crypto deposit.')
    assert.equal(cryptoBonusExample(0, format), 'No bonus. Set up to 50% to add an extra % to every approved crypto deposit.')
  })
})
