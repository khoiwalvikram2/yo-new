import { sql } from 'drizzle-orm'
import { db } from '@/db/client.js'
import type { Currency, CurrencyCode } from '@src/types/currency.js'

/**
 * Where the Currency Management page's currencies are kept: `app_configs.currencies` on the platform row
 * (`default`), a JSON object keyed by currency code. They lived only in admin-backend's memory, so every
 * create, edit and deactivation was undone by the next restart.
 *
 * Every change rewrites one key in a single UPDATE (the row lock serialises them), so two admins editing
 * different currencies never overwrite each other. Until a first change, the column is null and the
 * built-in list (SUPPORTED_CURRENCIES) stands; the first change stores that list with the change applied.
 *
 * The column needs migration `ALTER TABLE app_configs ADD COLUMN IF NOT EXISTS currencies jsonb`. Before it
 * is applied every read and write throws CurrencyStoreUnavailableError, and the service refuses changes
 * rather than accept edits it cannot keep. Raw SQL on purpose: the drizzle schema gains the column with the
 * migration, and naming it there first would break every select of app_configs.
 */

const PLATFORM_ROW = 'default'
/** Postgres undefined_column: the migration adding app_configs.currencies is not applied yet. */
const UNDEFINED_COLUMN = '42703'

export class CurrencyStoreUnavailableError extends Error {
  constructor() {
    super('Currency changes cannot be saved: the database has no currency store yet (app_configs.currencies is missing)')
    this.name = 'CurrencyStoreUnavailableError'
  }
}

/** What the store reads and writes with: the shared client, or a transaction. */
type Executor = Pick<typeof db, 'execute'>

function unavailableOr(error: unknown): never {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code
  if (code === UNDEFINED_COLUMN) throw new CurrencyStoreUnavailableError()
  throw error
}

/** One stored entry, or null when it is not a usable currency (hand-edited JSON never breaks the list). */
function toCurrency(code: string, raw: unknown): Currency | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const decimals = Number(entry.decimals)
  const rate = entry.exchangeRate == null ? undefined : Number(entry.exchangeRate)
  if (!/^[A-Z]{3}$/.test(code) || typeof entry.name !== 'string' || typeof entry.symbol !== 'string') return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) return null
  if (rate !== undefined && !(Number.isFinite(rate) && rate > 0)) return null
  return {
    code: code as CurrencyCode,
    name: entry.name,
    symbol: entry.symbol,
    decimals,
    isActive: entry.isActive !== false,
    ...(rate !== undefined ? { exchangeRate: rate } : {}),
  }
}

function toCurrencies(stored: unknown): Currency[] {
  if (!stored || typeof stored !== 'object') return []
  return Object.entries(stored as Record<string, unknown>).flatMap(([code, raw]) => toCurrency(code, raw) ?? [])
}

function storedEntry(currency: Currency) {
  return {
    name: currency.name,
    symbol: currency.symbol,
    decimals: currency.decimals,
    isActive: currency.isActive,
    exchangeRate: currency.exchangeRate ?? null,
  }
}

function storedObject(currencies: Currency[]) {
  return Object.fromEntries(currencies.map((currency) => [currency.code, storedEntry(currency)]))
}

/** The stored currencies, or null when none were ever saved (the built-in list then stands). */
export async function loadStoredCurrencies(executor: Executor = db): Promise<Currency[] | null> {
  try {
    const result = await executor.execute(sql`SELECT currencies FROM app_configs WHERE whitelabel_id = ${PLATFORM_ROW}`)
    const stored = (result.rows[0] as { currencies?: unknown } | undefined)?.currencies
    return stored == null ? null : toCurrencies(stored)
  } catch (error) {
    return unavailableOr(error)
  }
}

/** Writes one currency (added or changed) and answers the whole stored list. `seed` is the list a first change starts from. */
export async function saveStoredCurrency(currency: Currency, seed: Currency[], executor: Executor = db): Promise<Currency[]> {
  const entry = JSON.stringify({ [currency.code]: storedEntry(currency) })
  const start = JSON.stringify(storedObject(seed))
  try {
    const result = await executor.execute(sql`
      INSERT INTO app_configs (whitelabel_id, currencies) VALUES (${PLATFORM_ROW}, ${start}::jsonb || ${entry}::jsonb)
      ON CONFLICT (whitelabel_id) DO UPDATE
        SET currencies = COALESCE(app_configs.currencies, ${start}::jsonb) || ${entry}::jsonb, updated_at = now()
      RETURNING currencies`)
    return toCurrencies((result.rows[0] as { currencies?: unknown } | undefined)?.currencies)
  } catch (error) {
    return unavailableOr(error)
  }
}

/** Removes one currency and answers the whole stored list. */
export async function deleteStoredCurrency(code: string, seed: Currency[], executor: Executor = db): Promise<Currency[]> {
  const start = JSON.stringify(storedObject(seed))
  try {
    const result = await executor.execute(sql`
      INSERT INTO app_configs (whitelabel_id, currencies) VALUES (${PLATFORM_ROW}, ${start}::jsonb - ${code}::text)
      ON CONFLICT (whitelabel_id) DO UPDATE
        SET currencies = COALESCE(app_configs.currencies, ${start}::jsonb) - ${code}::text, updated_at = now()
      RETURNING currencies`)
    return toCurrencies((result.rows[0] as { currencies?: unknown } | undefined)?.currencies)
  } catch (error) {
    return unavailableOr(error)
  }
}

/**
 * Whether money is kept in this currency: a wallet holds it, or a whitelabel counts in it. Such a currency
 * stays active, because wallet credits and debits refuse a currency that is not.
 */
export async function isCurrencyInUse(code: string, executor: Executor = db): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT EXISTS (SELECT 1 FROM wallets WHERE currency = ${code})
        OR EXISTS (SELECT 1 FROM app_configs WHERE upper(base_currency) = ${code}) AS in_use`)
  return Boolean((result.rows[0] as { in_use?: boolean } | undefined)?.in_use)
}

/** The store the service uses; a test passes its own. */
export interface CurrencyStore {
  load(): Promise<Currency[] | null>
  save(currency: Currency, seed: Currency[]): Promise<Currency[]>
  remove(code: string, seed: Currency[]): Promise<Currency[]>
  inUse(code: string): Promise<boolean>
}

export const currencyStore: CurrencyStore = {
  load: () => loadStoredCurrencies(),
  save: (currency, seed) => saveStoredCurrency(currency, seed),
  remove: (code, seed) => deleteStoredCurrency(code, seed),
  inUse: (code) => isCurrencyInUse(code),
}
