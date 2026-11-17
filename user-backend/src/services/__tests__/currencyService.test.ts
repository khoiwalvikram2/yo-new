// user-backend/src/services/__tests__/currencyService.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUPPORTED_CURRENCIES } from '../../types/currency.js'
import { CurrencyService, parseStoredCurrencies } from '../currencyService.js'

// The shape admin-backend's currencyStore saves on app_configs.currencies (platform row 'default'), keyed by code.
const stored = {
  INR: { name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 90 },
  USD: { name: 'US Dollar', symbol: '$', decimals: 2, isActive: true, exchangeRate: 1 },
  EUR: { name: 'Euro', symbol: '€', decimals: 2, isActive: false, exchangeRate: 0.9 },
  SGD: { name: 'Singapore Dollar', symbol: 'S$', decimals: 2, isActive: true, exchangeRate: 1.35 },
}

async function serviceWith(config: unknown) {
  const service = new CurrencyService(async () => config)
  await service.ready()
  return service
}

test('config present: validation and conversion follow the admin Currency page', async () => {
  const service = await serviceWith(stored)
  // A rate saved on the page is the rate used: 900 INR at 90 per USD is 10 USD (the built-in rate is 83).
  assert.equal(service.toBaseCurrency(900, 'INR'), 10)
  assert.equal(service.fromBaseCurrency(10, 'INR'), 900)
  // A currency created on the page is valid; one switched off there is not, though the built-in list has it active.
  assert.equal(service.isValidCurrency('SGD'), true)
  assert.equal(service.isValidCurrency('EUR'), false)
  // A built-in currency the page does not list is not offered.
  assert.equal(service.isValidCurrency('GBP'), false)
  // Listed in the admin page's order: built-in order first, currencies added later after them.
  assert.deepEqual(service.getSupportedCurrencies().map((c) => c.code), ['INR', 'USD', 'SGD'])
  assert.equal(service.getCurrency('INR')?.exchangeRate, 90)
})

test('config missing: the built-in SUPPORTED_CURRENCIES stand', async () => {
  for (const missing of [null, undefined]) {
    const service = await serviceWith(missing)
    assert.equal(service.getExchangeRate('USD', 'INR'), SUPPORTED_CURRENCIES.INR.exchangeRate)
    assert.equal(service.isValidCurrency('GBP'), true)
    assert.equal(service.isValidCurrency('BTC'), false)
    assert.deepEqual(
      service.getSupportedCurrencies().map((c) => c.code),
      Object.values(SUPPORTED_CURRENCIES).filter((c) => c.isActive).map((c) => c.code),
    )
  }
})

test('an invalid entry is skipped; the valid ones still apply', async () => {
  const service = await serviceWith({
    ...stored,
    GBP: { name: 'British Pound', symbol: '£', decimals: 2, isActive: true, exchangeRate: -1 },
    JPY: { name: 'Japanese Yen', symbol: '¥', decimals: 'two', isActive: true, exchangeRate: 150 },
    usd: { name: 'lower-case code', symbol: '$', decimals: 2, isActive: true, exchangeRate: 2 },
    AUD: 'not an object',
  })
  for (const bad of ['GBP', 'JPY', 'usd', 'AUD']) assert.equal(service.isValidCurrency(bad), false, bad)
  assert.equal(service.toBaseCurrency(900, 'INR'), 10)
  assert.equal(service.isValidCurrency('SGD'), true)
})

test('an empty or unusable config falls back to the built-in list', async () => {
  for (const config of [{}, [], 'INR', 42, { XYZ: null, INR: { name: 'Indian Rupee' } }]) {
    assert.equal(parseStoredCurrencies(config), null, JSON.stringify(config))
    const service = await serviceWith(config)
    assert.equal(service.getExchangeRate('USD', 'INR'), SUPPORTED_CURRENCIES.INR.exchangeRate, JSON.stringify(config))
    assert.equal(service.isValidCurrency('GBP'), true)
  }
})

test('a failed read keeps the current list; reads are cached and shared', async () => {
  let calls = 0
  let fail = false
  const service = new CurrencyService(async () => {
    calls += 1
    if (fail) throw Object.assign(new Error('column "currencies" does not exist'), { code: '42703' })
    return stored
  })
  // Before the first read the built-in list stands, so a synchronous reader is never left without currencies.
  assert.equal(service.getCurrency('INR')?.exchangeRate, SUPPORTED_CURRENCIES.INR.exchangeRate)
  await Promise.all([service.ready(), service.ready()])
  assert.equal(service.getCurrency('INR')?.exchangeRate, 90)
  // Within a minute nothing is read again, whatever the readers do.
  const before = calls
  await service.ready()
  service.isValidCurrency('INR')
  assert.equal(calls, before)
  // A later read that fails leaves the last good list in place.
  fail = true
  ;(service as unknown as { loadedAt: number }).loadedAt = Date.now() - 61_000
  await service.ready()
  assert.equal(calls, before + 1)
  assert.equal(service.getCurrency('INR')?.exchangeRate, 90)
})
