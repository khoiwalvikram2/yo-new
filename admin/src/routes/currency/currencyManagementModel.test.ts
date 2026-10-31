/**
 * The pure logic of /currency: the legacy list filter and the clamped paging, the statistics, the table and
 * export copy, the form's rules and exact inputs, the converter's defaults, guards and figures, and the
 * default display currency in storage.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { Currency } from '@/shared/types/currency'
import {
  CURRENCY_EXPORT_COLUMNS,
  CURRENCY_STATUS_OPTIONS,
  CURRENCY_VIEWS,
  activeCurrenciesOf,
  buildCurrencyInput,
  canConvert,
  clampPage,
  conversionWarning,
  converterOptions,
  countActiveFilters,
  currencyCountLabel,
  currencyFormSchema,
  currencyFormValues,
  currencyStats,
  currencySymbol,
  defaultConversionPair,
  defaultCurrencyOptions,
  defaultCurrencySymbol,
  exportTitle,
  filterCurrencies,
  formatConvertedAmount,
  formatExchangeRate,
  inactiveCurrenciesOf,
  normaliseCurrencyCode,
  pageSlice,
  rateLine,
  readDefaultCurrency,
  storeDefaultCurrency,
  type CurrencyFormValues,
} from './currencyManagementModel'

const USD: Currency = { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isActive: true, exchangeRate: 1 }
const INR: Currency = { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 83.12 }
const EUR: Currency = { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isActive: true, exchangeRate: 0.92 }
const JPY: Currency = { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, isActive: false, exchangeRate: 149.5 }
const BTC: Currency = { code: 'BTC', name: 'Bitcoin', symbol: '₿', decimals: 8, isActive: false }
const ALL = [USD, INR, EUR, JPY, BTC]

async function errorsOf(values: CurrencyFormValues): Promise<Record<string, string>> {
  const result = await currencyFormSchema.safeParseAsync(values)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.')
    if (!(key in errors)) errors[key] = issue.message
  }
  return errors
}

const VALID: CurrencyFormValues = {
  code: 'GBP',
  name: 'Pound Sterling',
  symbol: '£',
  decimals: 2,
  exchangeRate: null,
  isActive: true,
}

describe('currency list', () => {
  test('filters by code, name or symbol in any case, then by status, as the legacy page', () => {
    assert.deepEqual(filterCurrencies(ALL, '', ''), ALL)
    assert.deepEqual(filterCurrencies(ALL, 'eur', ''), [EUR])
    assert.deepEqual(filterCurrencies(ALL, 'RUPEE', ''), [INR])
    assert.deepEqual(filterCurrencies(ALL, '¥', ''), [JPY])
    assert.deepEqual(filterCurrencies(ALL, '', 'active'), [USD, INR, EUR])
    assert.deepEqual(filterCurrencies(ALL, '', 'inactive'), [JPY, BTC])
    assert.deepEqual(filterCurrencies(ALL, 'b', 'inactive'), [BTC])
    assert.deepEqual(filterCurrencies(ALL, 'zzz', ''), [])
    assert.equal(countActiveFilters('', ''), 0)
    assert.equal(countActiveFilters('eu', ''), 1)
    assert.equal(countActiveFilters('eu', 'active'), 2)
    assert.deepEqual(CURRENCY_STATUS_OPTIONS.map((o) => [o.value, o.label]), [
      ['', 'All Status'],
      ['active', 'Active'],
      ['inactive', 'Inactive'],
    ])
    assert.deepEqual(CURRENCY_VIEWS.map((v) => v.label), ['Currencies', 'Currency Converter', 'Settings'])
  })

  test('pages a list and shows the last page when a filter leaves the page past the end', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index + 1)
    assert.deepEqual(pageSlice(rows, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(pageSlice(rows, 3, 10), [21, 22, 23])
    assert.equal(clampPage(5, 23, 10), 3)
    assert.equal(clampPage(0, 23, 10), 1)
    assert.equal(clampPage(Number.NaN, 23, 10), 1)
    assert.equal(clampPage(4, 0, 10), 1)
    assert.deepEqual(pageSlice(rows, 9, 10), [21, 22, 23])
    assert.deepEqual(pageSlice([], 2, 10), [])
  })

  test('labels the count and the rate as the legacy table did', () => {
    assert.equal(currencyCountLabel(0), '0 currencies')
    assert.equal(currencyCountLabel(1), '1 currency')
    assert.equal(currencyCountLabel(12), '12 currencies')
    assert.equal(formatExchangeRate(83.12), '83.120000')
    assert.equal(formatExchangeRate(0.0123456789), '0.012346')
    assert.equal(formatExchangeRate(0), 'N/A')
    assert.equal(formatExchangeRate(null), 'N/A')
    assert.equal(formatExchangeRate(undefined), 'N/A')
  })

  test('computes the four statistics over every currency', () => {
    const active = activeCurrenciesOf(ALL)
    const inactive = inactiveCurrenciesOf(ALL)
    assert.deepEqual(active, [USD, INR, EUR])
    assert.deepEqual(inactive, [JPY, BTC])
    assert.deepEqual(currencyStats(ALL, active, inactive), {
      total: 5,
      active: 3,
      inactive: 2,
      withRates: 4,
      missingRates: 1,
      activeWithRates: 3,
      activeRate: 60,
    })
    const zeroRate = { ...USD, exchangeRate: 0 }
    assert.equal(currencyStats([zeroRate], [zeroRate], []).withRates, 0)
    assert.deepEqual(currencyStats([], [], []), {
      total: 0,
      active: 0,
      inactive: 0,
      withRates: 0,
      missingRates: 0,
      activeWithRates: 0,
      activeRate: 0,
    })
    assert.equal(currencyStats([USD, INR, JPY], [USD, INR], [JPY]).activeRate, 67)
  })

  test('keeps the legacy export columns and title', () => {
    assert.deepEqual(
      CURRENCY_EXPORT_COLUMNS.map((c) => [c.header, c.key, c.width]),
      [
        ['Name', 'name', 20],
        ['Code', 'code', 12],
        ['Symbol', 'symbol', 10],
        ['Decimals', 'decimals', 10],
        ['Exchange Rate', 'exchangeRate', 14],
        ['Status', 'status', 10],
      ],
    )
    const getters = (currency: Currency) => CURRENCY_EXPORT_COLUMNS.map((c) => c.getter(currency))
    assert.deepEqual(getters(INR), ['Indian Rupee', 'INR', '₹', 2, 83.12, 'Active'])
    assert.deepEqual(getters(BTC), ['Bitcoin', 'BTC', '₿', 8, null, 'Inactive'])
    assert.equal(exportTitle(3), 'Currencies — 3 currency(ies)')
  })
})

describe('currency form', () => {
  test('applies the legacy rules, first failing rule per field', async () => {
    assert.deepEqual(await errorsOf(VALID), {})
    assert.deepEqual(
      await errorsOf({ ...VALID, code: '', name: '', symbol: '', decimals: null }),
      {
        code: 'Please enter currency code',
        name: 'Please enter currency name',
        symbol: 'Please enter currency symbol',
        decimals: 'Please enter decimal places',
      },
    )
    assert.deepEqual(await errorsOf({ ...VALID, code: 'GB' }), { code: 'Currency code must be exactly 3 characters' })
    assert.deepEqual(await errorsOf({ ...VALID, code: 'GBPX' }), { code: 'Currency code must be exactly 3 characters' })
    assert.deepEqual(await errorsOf({ ...VALID, code: 'G1P' }), { code: 'Currency code must be 3 uppercase letters' })
    assert.deepEqual(await errorsOf({ ...VALID, code: 'gbp' }), { code: 'Currency code must be 3 uppercase letters' })
    // Whitespace counts as a value (async-validator's `required` without `whitespace`).
    assert.deepEqual(await errorsOf({ ...VALID, name: '  ', symbol: ' ' }), {})
    assert.deepEqual(await errorsOf({ ...VALID, decimals: 9 }), { decimals: 'Decimal places must be between 0 and 8' })
    assert.deepEqual(await errorsOf({ ...VALID, decimals: -1 }), { decimals: 'Decimal places must be between 0 and 8' })
    assert.deepEqual(await errorsOf({ ...VALID, decimals: 2.5 }), { decimals: 'Enter a whole number' })
    assert.deepEqual(await errorsOf({ ...VALID, decimals: 0 }), {})
    assert.deepEqual(await errorsOf({ ...VALID, decimals: 8 }), {})
    assert.deepEqual(await errorsOf({ ...VALID, exchangeRate: 0.0000001 }), { exchangeRate: 'Exchange rate must be positive' })
    assert.deepEqual(await errorsOf({ ...VALID, exchangeRate: 0 }), { exchangeRate: 'Exchange rate must be positive' })
    assert.deepEqual(await errorsOf({ ...VALID, exchangeRate: 0.000001 }), {})
  })

  test('seeds the create defaults or the record, keeping a stored zero decimals', () => {
    assert.deepEqual(currencyFormValues(), {
      code: '',
      name: '',
      symbol: '',
      decimals: 2,
      exchangeRate: null,
      isActive: true,
    })
    assert.deepEqual(currencyFormValues(JPY), {
      code: 'JPY',
      name: 'Japanese Yen',
      symbol: '¥',
      decimals: 0,
      exchangeRate: 149.5,
      isActive: false,
    })
    assert.equal(currencyFormValues(BTC).exchangeRate, null)
    assert.equal(currencyFormValues({ ...USD, exchangeRate: 0 }).exchangeRate, null)
    assert.equal(normaliseCurrencyCode('gbp'), 'GBP')
  })

  test('builds the legacy create input: mounted fields in order, no status, an empty rate left out', () => {
    const create = buildCurrencyInput({ ...VALID, code: 'gbp' })
    assert.deepEqual(create, { code: 'GBP', name: 'Pound Sterling', symbol: '£', decimals: 2 })
    assert.deepEqual(Object.keys(create), ['code', 'name', 'symbol', 'decimals'])
    const withRate = buildCurrencyInput({ ...VALID, exchangeRate: 0.79 })
    assert.deepEqual(Object.keys(withRate), ['code', 'name', 'symbol', 'decimals', 'exchangeRate'])
    assert.equal((withRate as { exchangeRate?: number }).exchangeRate, 0.79)
  })

  test('builds the legacy update input with the status, and null only for a cleared stored rate', () => {
    const update = buildCurrencyInput({ ...currencyFormValues(EUR), name: 'Euro (EU)', isActive: false }, EUR)
    assert.deepEqual(update, {
      code: 'EUR',
      name: 'Euro (EU)',
      symbol: '€',
      decimals: 2,
      exchangeRate: 0.92,
      isActive: false,
    })
    assert.deepEqual(Object.keys(update), ['code', 'name', 'symbol', 'decimals', 'exchangeRate', 'isActive'])
    const cleared = buildCurrencyInput({ ...currencyFormValues(EUR), exchangeRate: null }, EUR)
    assert.equal((cleared as { exchangeRate?: number | null }).exchangeRate, null)
    assert.ok('exchangeRate' in cleared)
    const never = buildCurrencyInput(currencyFormValues(BTC), BTC)
    assert.equal('exchangeRate' in never, false)
    assert.deepEqual(buildCurrencyInput(currencyFormValues(JPY), JPY), {
      code: 'JPY',
      name: 'Japanese Yen',
      symbol: '¥',
      decimals: 0,
      exchangeRate: 149.5,
      isActive: false,
    })
  })

  test('sends the rate at six places, as the legacy InputNumber rounded it on Enter', () => {
    const rateOf = (input: object) => (input as { exchangeRate?: number | null }).exchangeRate
    assert.equal(rateOf(buildCurrencyInput({ ...VALID, exchangeRate: 1.1234567 })), 1.123457)
    assert.equal(rateOf(buildCurrencyInput({ ...VALID, exchangeRate: 83.1234564 })), 83.123456)
    assert.equal(rateOf(buildCurrencyInput({ ...VALID, exchangeRate: 0.0000014 })), 0.000001)
    assert.equal(rateOf(buildCurrencyInput({ ...currencyFormValues(EUR), exchangeRate: 0.9200004 }, EUR)), 0.92)
    // Six places or fewer pass through as typed.
    assert.equal(rateOf(buildCurrencyInput({ ...VALID, exchangeRate: 3.6725 })), 3.6725)
    assert.equal(rateOf(buildCurrencyInput({ ...VALID, exchangeRate: 0.000001 })), 0.000001)
  })
})

describe('currency converter', () => {
  test('defaults to USD to INR, else the first two currencies, else nothing', () => {
    assert.deepEqual(defaultConversionPair(ALL), { from: 'USD', to: 'INR' })
    assert.deepEqual(defaultConversionPair([EUR, JPY, USD]), { from: 'EUR', to: 'JPY' })
    assert.equal(defaultConversionPair([EUR]), null)
    assert.equal(defaultConversionPair([]), null)
    assert.deepEqual(converterOptions([USD, JPY]), [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'JPY', label: 'JPY - Japanese Yen' },
    ])
  })

  test('guards a conversion with the legacy warnings', () => {
    assert.equal(canConvert(1, 'USD', 'INR'), true)
    assert.equal(canConvert(0, 'USD', 'INR'), false)
    assert.equal(canConvert(1, '', 'INR'), false)
    assert.equal(canConvert(1, 'USD', 'USD'), false)
    assert.equal(conversionWarning(1, 'USD', 'INR'), null)
    assert.equal(conversionWarning(0, 'USD', 'INR'), 'Please enter amount and select both currencies')
    assert.equal(conversionWarning(1, 'USD', ''), 'Please enter amount and select both currencies')
    assert.equal(conversionWarning(1, 'USD', 'USD'), 'Please select different currencies for conversion')
  })

  test('formats each side in its own decimals, two for an unknown code, the rate to six places', () => {
    assert.equal(formatConvertedAmount(83.1234, 'INR', ALL), '83.12')
    assert.equal(formatConvertedAmount(149.56, 'JPY', ALL), '150')
    assert.equal(formatConvertedAmount(0.5, 'BTC', ALL), '0.50000000')
    assert.equal(formatConvertedAmount(1.005, 'XXX', ALL), (1.005).toFixed(2))
    assert.equal(currencySymbol('EUR', ALL), '€')
    assert.equal(currencySymbol('XXX', ALL), undefined)
    assert.equal(rateLine('USD', 83.12, 'INR'), '1 USD = 83.120000 INR')
  })
})

describe('default display currency', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      store,
    }
  }
  const failing = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }

  test('reads the stored code, else INR, and survives blocked storage', () => {
    assert.equal(readDefaultCurrency(memoryStorage({ defaultCurrency: 'EUR' })), 'EUR')
    assert.equal(readDefaultCurrency(memoryStorage()), 'INR')
    assert.equal(readDefaultCurrency(memoryStorage({ defaultCurrency: '' })), 'INR')
    assert.equal(readDefaultCurrency(failing), 'INR')
    assert.equal(readDefaultCurrency(null), 'INR')
  })

  test('stores under the key CurrencyContext reads, and reports a refusal', () => {
    const storage = memoryStorage()
    assert.equal(storeDefaultCurrency('USD', storage), true)
    assert.equal(storage.store.get('defaultCurrency'), 'USD')
    assert.equal(storeDefaultCurrency('USD', failing), false)
    assert.equal(storeDefaultCurrency('USD', null), false)
  })

  test('offers the active currencies, keeping an unmatched stored code as its own option', () => {
    assert.deepEqual(defaultCurrencyOptions([USD, INR], 'INR'), [
      { value: 'USD', label: '$ USD - US Dollar' },
      { value: 'INR', label: '₹ INR - Indian Rupee' },
    ])
    assert.deepEqual(defaultCurrencyOptions([USD], 'JPY'), [
      { value: 'JPY', label: 'JPY' },
      { value: 'USD', label: '$ USD - US Dollar' },
    ])
    assert.equal(defaultCurrencySymbol([USD, INR], 'INR'), '₹')
    assert.equal(defaultCurrencySymbol([USD], 'JPY'), undefined)
  })
})
