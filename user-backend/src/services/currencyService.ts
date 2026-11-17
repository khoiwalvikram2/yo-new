import { eq } from 'drizzle-orm'
import { appConfigs } from '@shared/db/schema.js'
import {
  type CurrencyCode,
  type Currency,
  type CurrencyConversion,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  BASE_CURRENCY,
} from '../types/currency.js'

/** How long a read of the admin's currency list is trusted before it is read again (the admin may have saved since). */
const RELOAD_AFTER_MS = 60_000
/** The admin Currency page keeps its list on this app_configs row (admin-backend/src/services/currencyStore.ts). */
const PLATFORM_ROW = 'default'

/** Reads the stored `app_configs.currencies` JSON of the platform row: null when nothing was ever saved. A test passes its own. */
export type CurrencyConfigLoader = () => Promise<unknown>

async function loadPlatformCurrencies(): Promise<unknown> {
  // Imported here, so a test that passes its own loader never opens the database.
  const { db } = await import('../db/client.js')
  const [row] = await db
    .select({ currencies: appConfigs.currencies })
    .from(appConfigs)
    .where(eq(appConfigs.whitelabelId, PLATFORM_ROW))
    .limit(1)
  return row?.currencies ?? null
}

/** One stored entry, or null when it is not a usable currency: the rules admin-backend's currencyStore reads it with. */
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

/** The admin page's order: the built-in order (INR, USD, EUR, ...), then currencies added later by code. */
const BUILT_IN_ORDER: string[] = Object.keys(SUPPORTED_CURRENCIES)
function listOrder(a: Currency, b: Currency): number {
  const rank = (code: string) => {
    const index = BUILT_IN_ORDER.indexOf(code)
    return index === -1 ? BUILT_IN_ORDER.length : index
  }
  return rank(a.code) - rank(b.code) || a.code.localeCompare(b.code)
}

/**
 * The currencies the admin Currency page saved, keyed by code, or null when the built-in list must stand: nothing
 * saved, a value that is not an object, or no usable entry. An unusable entry is skipped, as the admin page skips it.
 */
export function parseStoredCurrencies(stored: unknown): Map<string, Currency> | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null
  const list = Object.entries(stored as Record<string, unknown>).flatMap(([code, raw]) => toCurrency(code, raw) ?? [])
  return list.length > 0 ? new Map(list.sort(listOrder).map((currency) => [currency.code, currency])) : null
}

function builtInCurrencies(): Map<string, Currency> {
  return new Map(Object.values(SUPPORTED_CURRENCIES).map((currency) => [currency.code, { ...currency }]))
}

/**
 * Player-side currency validation and conversion. The list follows the admin Currency page (app_configs.currencies on
 * the platform row), read again at most once a minute; while that is missing, empty or invalid, the built-in
 * SUPPORTED_CURRENCIES stand. The synchronous readers never wait: they use the last read and refresh it in the
 * background once it is stale.
 */
export class CurrencyService {
  private currencies: Map<string, Currency> = builtInCurrencies()
  private loadedAt = 0
  private loading: Promise<void> | null = null

  constructor(private readonly loadConfig: CurrencyConfigLoader = loadPlatformCurrencies) {}

  /** The admin's list, read again once RELOAD_AFTER_MS old. Callers that can wait for a fresh list await this. */
  async ready(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt < RELOAD_AFTER_MS) return
    await this.load()
  }

  /** For the synchronous readers: reads the list again in the background once the last read is stale. */
  refreshIfStale(): void {
    if (this.loadedAt && Date.now() - this.loadedAt < RELOAD_AFTER_MS) return
    void this.load().catch(() => undefined)
  }

  /** One read at a time. */
  private load(): Promise<void> {
    if (!this.loading) {
      const pending = this.readConfig()
      this.loading = pending
      void pending.finally(() => {
        if (this.loading === pending) this.loading = null
      })
    }
    return this.loading
  }

  private async readConfig(): Promise<void> {
    try {
      this.currencies = parseStoredCurrencies(await this.loadConfig()) ?? builtInCurrencies()
    } catch {
      // The database is unreachable or has no currencies column yet: the current list stands until the next read.
    } finally {
      this.loadedAt = Date.now()
    }
  }

  private currency(code: string): Currency | null {
    this.refreshIfStale()
    return this.currencies.get(code) ?? null
  }

  getSupportedCurrencies(): Currency[] {
    this.refreshIfStale()
    return Array.from(this.currencies.values()).filter((c) => c.isActive)
  }

  getCurrency(code: CurrencyCode): Currency | null {
    return this.currency(code)
  }

  isValidCurrency(code: string): code is CurrencyCode {
    return Boolean(this.currency(code)?.isActive)
  }

  getExchangeRate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1.0
    const fromRate = this.currency(from)?.exchangeRate || 1.0
    const toRate = this.currency(to)?.exchangeRate || 1.0
    return toRate / fromRate
  }

  convertAmount(amount: number, from: CurrencyCode, to: CurrencyCode): CurrencyConversion {
    const rate = this.getExchangeRate(from, to)
    const convertedAmount = amount * rate
    return {
      from,
      to,
      rate,
      amount,
      convertedAmount: this.roundAmount(convertedAmount, to),
      timestamp: new Date().toISOString(),
    }
  }

  roundAmount(amount: number, currency: CurrencyCode): number {
    const currencyInfo = this.getCurrency(currency)
    const decimals = currencyInfo?.decimals || 2
    return Math.round(amount * Math.pow(10, decimals)) / Math.pow(10, decimals)
  }

  getDefaultCurrency(_tenant?: string): CurrencyCode {
    return DEFAULT_CURRENCY
  }

  getBaseCurrency(): CurrencyCode {
    return BASE_CURRENCY
  }

  toBaseCurrency(amount: number, from: CurrencyCode): number {
    return this.convertAmount(amount, from, BASE_CURRENCY).convertedAmount
  }

  fromBaseCurrency(amount: number, to: CurrencyCode): number {
    return this.convertAmount(amount, BASE_CURRENCY, to).convertedAmount
  }
}

export const currencyService = new CurrencyService()
