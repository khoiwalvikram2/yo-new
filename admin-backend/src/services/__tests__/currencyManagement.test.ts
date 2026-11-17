import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Currency, CurrencyCode } from '@src/types/currency.js'
import { CurrencyManagementService } from '../currencyManagementService.js'
import { CurrencyService } from '../currencyService.js'
import { CurrencyStoreUnavailableError, type CurrencyStore } from '../currencyStore.js'
import { currencyResolvers } from '@src/domains/common/resolvers/currency.js'

// The Currency Management page against a stand-in for app_configs.currencies: what is saved survives a
// restart (a new service reading the same store), is what conversions use, and nothing is accepted that
// cannot be kept. The SQL itself is covered by currencyStore.integration.test.ts.

/** The store's semantics in memory: a first change starts from the seed, each change rewrites one key. */
function memoryStore(options: { unavailable?: boolean; inUse?: string[] } = {}) {
  let stored: Record<string, Currency> | null = null
  const fail = () => {
    if (options.unavailable) throw new CurrencyStoreUnavailableError()
  }
  const start = (seed: Currency[]) => stored ?? Object.fromEntries(seed.map((c) => [c.code, { ...c }]))
  const store: CurrencyStore = {
    async load() {
      fail()
      return stored ? Object.values(stored).map((c) => ({ ...c })) : null
    },
    async save(currency, seed) {
      fail()
      stored = { ...start(seed), [currency.code]: { ...currency } }
      return Object.values(stored).map((c) => ({ ...c }))
    },
    async remove(code, seed) {
      fail()
      const next = { ...start(seed) }
      delete next[code]
      stored = next
      return Object.values(stored).map((c) => ({ ...c }))
    },
    async inUse(code) {
      return (options.inUse ?? []).includes(code)
    },
  }
  return { store, saved: () => stored }
}

const VFY = { code: 'vfy', name: 'vfyfix Currency', symbol: 'V', decimals: 2, exchangeRate: 1.5 }
const code = (c: string) => c as CurrencyCode

describe('currencies are kept, and used', () => {
  it('keeps a created currency across a restart, and converts with it', async () => {
    const { store } = memoryStore()
    const page = new CurrencyManagementService(store)
    const created = await page.createCurrency(VFY)
    assert.equal(created.success, true)
    assert.equal(created.message, 'Currency VFY created successfully')

    const restarted = new CurrencyManagementService(store)
    await restarted.ready()
    assert.equal(restarted.getCurrency(code('VFY'))?.name, 'vfyfix Currency')
    assert.equal(restarted.getAllCurrencies().length, 13, 'the built-in twelve plus VFY')

    const conversions = new CurrencyService(restarted)
    assert.equal(conversions.isValidCurrency('VFY'), true)
    const converted = conversions.convertAmount(15, code('VFY'), code('USD'))
    assert.equal(converted.rate, 1 / 1.5)
    assert.equal(converted.convertedAmount, 10)
  })

  it('converts with a saved exchange rate, not the built-in one', async () => {
    const { store } = memoryStore()
    const page = new CurrencyManagementService(store)
    const saved = await page.updateCurrency(code('CHF'), { exchangeRate: 1.76 })
    assert.equal(saved.success, true)

    const restarted = new CurrencyManagementService(store)
    await restarted.ready()
    const converted = new CurrencyService(restarted).convertAmount(100, code('USD'), code('CHF'))
    assert.equal(converted.rate, 1.76)
    assert.equal(converted.convertedAmount, 176)
  })

  it('refuses every change, and changes nothing, while the store cannot keep it', async () => {
    const { store } = memoryStore({ unavailable: true })
    const page = new CurrencyManagementService(store)
    await page.ready()
    const created = await page.createCurrency(VFY)
    assert.equal(created.success, false)
    assert.match(created.message, /cannot be saved/)
    assert.equal(page.getCurrency(code('VFY')), null)

    const rate = await page.updateCurrency(code('CHF'), { exchangeRate: 1.76 })
    assert.equal(rate.success, false)
    assert.equal(page.getCurrency(code('CHF'))?.exchangeRate, 0.88)
    assert.equal((await page.deactivateCurrency(code('EUR'))).success, false)
    assert.equal(page.getCurrency(code('EUR'))?.isActive, true)
  })
})

describe('an inactive currency stays manageable', () => {
  it('is still listed, can be activated again, and can be deleted once inactive', async () => {
    const { store, saved } = memoryStore()
    const page = new CurrencyManagementService(store)
    assert.equal((await page.deactivateCurrency(code('EUR'))).success, true)
    assert.equal(page.getAllCurrencies().find((c) => c.code === 'EUR')?.isActive, false)
    assert.equal(page.getActiveCurrencies().some((c) => c.code === 'EUR'), false)

    assert.equal((await page.activateCurrency(code('EUR'))).success, true)
    assert.equal(page.getCurrency(code('EUR'))?.isActive, true)

    assert.equal((await page.deleteCurrency(code('EUR'))).success, false, 'an active currency is deactivated first')
    await page.deactivateCurrency(code('EUR'))
    const deleted = await page.deleteCurrency(code('EUR'))
    assert.equal(deleted.success, true)
    assert.equal(page.getCurrency(code('EUR')), null)
    assert.equal(saved()?.EUR, undefined, 'the deletion is kept')

    const restarted = new CurrencyManagementService(store)
    await restarted.ready()
    assert.equal(restarted.getCurrency(code('EUR')), null)
  })
})

describe('currencies money depends on stay active', () => {
  it('never deactivates or deletes the base or default currency, or one money is kept in', async () => {
    const { store, saved } = memoryStore({ inUse: ['GBP', 'BTC'] })
    const page = new CurrencyManagementService(store)
    const usd = await page.deactivateCurrency(code('USD'))
    assert.equal(usd.success, false)
    assert.match(usd.message, /USD is the base currency/)
    assert.match((await page.deactivateCurrency(code('INR'))).message, /INR is the platform's default currency/)
    assert.match((await page.deactivateCurrency(code('GBP'))).message, /GBP is in use/)
    const btc = await page.deleteCurrency(code('BTC'))
    assert.equal(btc.success, false, 'BTC is inactive but a wallet still holds it')
    assert.match(btc.message, /BTC is in use/)
    assert.equal(saved(), null, 'nothing was written')
    assert.equal((await page.deactivateCurrency(code('AUD'))).success, true)
  })

  it('keeps the base currency at a rate of 1', async () => {
    const { store } = memoryStore()
    const page = new CurrencyManagementService(store)
    const refused = await page.updateCurrency(code('USD'), { exchangeRate: 2 })
    assert.equal(refused.success, false)
    assert.match(refused.message, /always 1/)
    assert.equal((await page.updateCurrency(code('USD'), { exchangeRate: 1, name: 'US Dollar (base)' })).success, true)
  })

  it('validates with the managed list: a deactivated currency is no longer valid', async () => {
    const { store } = memoryStore()
    const managed = new CurrencyManagementService(store)
    const conversions = new CurrencyService(managed)
    assert.equal(conversions.isValidCurrency('CAD'), true)
    await managed.deactivateCurrency(code('CAD'))
    assert.equal(conversions.isValidCurrency('CAD'), false)
    assert.equal(conversions.isValidCurrency('BTC'), false, 'built in, but inactive')
  })
})

describe('Query.currencies', () => {
  const ctx = { permissions: [{ domain: 'currency.list', actions: ['view'] }] }

  it('lists inactive currencies only for the page that asks for them', async () => {
    const active = await currencyResolvers.Query.currencies(null, {}, ctx)
    const all = await currencyResolvers.Query.currencies(null, { includeInactive: true }, ctx)
    assert.ok(active.every((c: Currency) => c.isActive))
    assert.ok(all.some((c: Currency) => !c.isActive), 'BTC and ETH are built in as inactive')
    assert.equal(all.length - active.length, all.filter((c: Currency) => !c.isActive).length)
  })

  it('still requires the view permission', async () => {
    await assert.rejects(() => currencyResolvers.Query.currencies(null, { includeInactive: true }, { permissions: [] }), /Forbidden/)
  })
})
