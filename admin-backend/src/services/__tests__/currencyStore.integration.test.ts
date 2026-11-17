import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { SUPPORTED_CURRENCIES, type Currency, type CurrencyCode } from '@src/types/currency.js'
import {
  CurrencyStoreUnavailableError,
  deleteStoredCurrency,
  isCurrencyInUse,
  loadStoredCurrencies,
  saveStoredCurrency,
} from '../currencyStore.js'

// The SQL behind the Currency Management page, on the local database. Until the migration adding
// app_configs.currencies is applied, the store must say so instead of failing obscurely; once it is, a
// change is checked inside a transaction that is always rolled back, so the platform row is never altered.

const seed: Currency[] = Object.values(SUPPORTED_CURRENCIES)
const VFX: Currency = { code: 'VFX' as CurrencyCode, name: 'vfyfix Store', symbol: 'X', decimals: 2, isActive: false, exchangeRate: 2.5 }
const ROLLBACK = new Error('vfyfix rollback')
let hasColumn = false

before(async () => {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_configs' AND column_name = 'currencies'`)
  hasColumn = result.rows.length > 0
})

describe('currency store', () => {
  it('reports a database without the currencies column as unavailable', async (t) => {
    if (hasColumn) return t.skip('app_configs.currencies exists')
    await assert.rejects(() => loadStoredCurrencies(), CurrencyStoreUnavailableError)
    await assert.rejects(() => saveStoredCurrency(VFX, seed), CurrencyStoreUnavailableError)
    await assert.rejects(() => deleteStoredCurrency('VFX', seed), CurrencyStoreUnavailableError)
  })

  it('saves one currency over the stored list, reads it back and removes it, leaving the rest', async (t) => {
    if (!hasColumn) return t.skip('needs the migration adding app_configs.currencies')
    await assert.rejects(() => db.transaction(async (tx) => {
      const before = await loadStoredCurrencies(tx)
      const afterSave = await saveStoredCurrency(VFX, seed, tx)
      assert.deepEqual(afterSave.find((c) => c.code === 'VFX'), VFX)
      const expectedOthers = (before ?? seed).map((c) => c.code).sort()
      assert.deepEqual(afterSave.filter((c) => c.code !== 'VFX').map((c) => c.code).sort(), expectedOthers.filter((c) => c !== 'VFX'))
      assert.deepEqual((await loadStoredCurrencies(tx))?.find((c) => c.code === 'VFX'), VFX)

      const changed = await saveStoredCurrency({ ...VFX, exchangeRate: 3 }, seed, tx)
      assert.equal(changed.find((c) => c.code === 'VFX')?.exchangeRate, 3, 'a second save rewrites the key')

      const afterDelete = await deleteStoredCurrency('VFX', seed, tx)
      assert.equal(afterDelete.some((c) => c.code === 'VFX'), false)
      assert.equal(afterDelete.length, afterSave.length - 1)
      throw ROLLBACK
    }), (error: unknown) => error === ROLLBACK || (error as { cause?: unknown })?.cause === ROLLBACK)
  })

  it('knows the currency wallets hold', async () => {
    const [{ currency } = { currency: null }] = (await db.execute(sql`SELECT currency FROM wallets LIMIT 1`)).rows as Array<{ currency: string | null }>
    if (currency) assert.equal(await isCurrencyInUse(currency), true)
    assert.equal(await isCurrencyInUse('QQQ'), false)
  })
})
