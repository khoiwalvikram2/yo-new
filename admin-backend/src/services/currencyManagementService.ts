import { CurrencyCode, Currency, SUPPORTED_CURRENCIES, BASE_CURRENCY, DEFAULT_CURRENCY } from '@src/types/currency.js'
import { currencyStore, type CurrencyStore } from './currencyStore.js'

/** How long a read of the store is trusted before it is read again (another process may have saved since). */
const RELOAD_AFTER_MS = 60_000
/** The list keeps the built-in order (INR, USD, EUR, ...); currencies added later follow by code. */
const BUILT_IN_ORDER: string[] = Object.keys(SUPPORTED_CURRENCIES)

function listOrder(a: Currency, b: Currency): number {
  const rank = (code: string) => {
    const index = BUILT_IN_ORDER.indexOf(code)
    return index === -1 ? BUILT_IN_ORDER.length : index
  }
  return rank(a.code) - rank(b.code) || a.code.localeCompare(b.code)
}

export interface CurrencyOperationResult {
  success: boolean
  message: string
  currency?: Currency
}

export interface ExchangeRateUpdateResult {
  success: boolean
  message: string
  updatedRates: Currency[]
}

/**
 * The platform's currencies: the Currency Management page edits them, and currencyService converts,
 * validates and formats with them. They are kept in the database (currencyStore); this holds the last read,
 * so the synchronous readers (wallet ledgers, chips, casino) never wait. Until the store first answers, and
 * while it has nothing saved, the built-in list stands.
 */
export class CurrencyManagementService {
  private currencies: Map<CurrencyCode, Currency> = new Map()
  private loadedAt = 0
  private loading: Promise<void> | null = null

  constructor(private readonly store: CurrencyStore = currencyStore) {
    this.initializeCurrencies()
  }

  private initializeCurrencies() {
    // Initialize with default supported currencies
    Object.entries(SUPPORTED_CURRENCIES).forEach(([code, currency]) => {
      this.currencies.set(code as CurrencyCode, { ...currency })
    })
  }

  /** The stored currencies, read again once RELOAD_AFTER_MS old. Callers that answer an admin wait for it. */
  async ready(): Promise<void> {
    if (this.loadedAt && Date.now() - this.loadedAt < RELOAD_AFTER_MS) return
    await this.load()
  }

  /** For the synchronous readers: reads the store again in the background once the last read is stale. */
  refreshIfStale(): void {
    if (this.loadedAt && Date.now() - this.loadedAt < RELOAD_AFTER_MS) return
    void this.load().catch(() => undefined)
  }

  /** One read of the store at a time. An unreadable store keeps the list as it is. */
  load(): Promise<void> {
    if (!this.loading) {
      const pending = this.readStore()
      this.loading = pending
      void pending.finally(() => {
        if (this.loading === pending) this.loading = null
      })
    }
    return this.loading
  }

  private async readStore(): Promise<void> {
    try {
      const stored = await this.store.load()
      this.replace(stored ?? Object.values(SUPPORTED_CURRENCIES))
    } catch {
      // No column yet, or the database is unreachable: the current list stands, and changes are refused
      // by the store itself when they are tried.
    } finally {
      this.loadedAt = Date.now()
    }
  }

  private replace(list: Currency[]) {
    this.currencies = new Map([...list].sort(listOrder).map((currency) => [currency.code, { ...currency }]))
  }

  /** Saves one currency and takes the stored list as current; the error text when it cannot be saved. */
  private async persist(currency: Currency): Promise<string | null> {
    try {
      this.replace(await this.store.save(currency, this.getAllCurrencies()))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Failed to save the currency'
    }
  }

  /**
   * Why `currency` must stay active and listed, or null. Wallet credits and debits refuse a currency that is
   * not active, so the base currency every rate is quoted against, the default currency and any currency
   * money is kept in are never switched off from this page.
   */
  private async keepActiveReason(currency: Currency): Promise<string | null> {
    if (currency.code === BASE_CURRENCY) return `${currency.code} is the base currency every exchange rate is quoted against`
    if (currency.code === DEFAULT_CURRENCY) return `${currency.code} is the platform's default currency`
    try {
      if (await this.store.inUse(currency.code)) return `${currency.code} is in use: wallets or whitelabels keep money in it`
    } catch {
      return `Could not check whether ${currency.code} is in use`
    }
    return null
  }

  /**
   * Get all currencies (active and inactive)
   */
  getAllCurrencies(): Currency[] {
    return Array.from(this.currencies.values())
  }

  /**
   * Get only active currencies
   */
  getActiveCurrencies(): Currency[] {
    return Array.from(this.currencies.values()).filter(c => c.isActive)
  }

  /**
   * Get currency by code
   */
  getCurrency(code: CurrencyCode): Currency | null {
    return this.currencies.get(code) || null
  }

  /**
   * Create a new currency
   */
  async createCurrency(currency: Omit<Currency, 'code'> & { code: string; isActive?: boolean }): Promise<CurrencyOperationResult> {
    await this.ready()
    const code = currency.code.toUpperCase() as CurrencyCode

    // Validate currency code format
    if (!/^[A-Z]{3}$/.test(code)) {
      return {
        success: false,
        message: 'Currency code must be exactly 3 uppercase letters',
        currency: undefined
      }
    }

    // Check if currency already exists
    if (this.currencies.has(code)) {
      return {
        success: false,
        message: `Currency ${code} already exists`,
        currency: undefined
      }
    }

    // Validate required fields
    if (!currency.name || !currency.symbol) {
      return {
        success: false,
        message: 'Currency name and symbol are required',
        currency: undefined
      }
    }

    // Validate decimals
    if (currency.decimals < 0 || currency.decimals > 8) {
      return {
        success: false,
        message: 'Decimals must be between 0 and 8',
        currency: undefined
      }
    }

    // Validate exchange rate
    if (currency.exchangeRate !== undefined && currency.exchangeRate <= 0) {
      return {
        success: false,
        message: 'Exchange rate must be positive',
        currency: undefined
      }
    }

    const newCurrency: Currency = {
      code,
      name: currency.name,
      symbol: currency.symbol,
      decimals: currency.decimals,
      isActive: currency.isActive ?? true,
      exchangeRate: currency.exchangeRate
    }

    const failure = await this.persist(newCurrency)
    if (failure) {
      return { success: false, message: failure, currency: undefined }
    }

    return {
      success: true,
      message: `Currency ${code} created successfully`,
      currency: this.currencies.get(code) ?? newCurrency
    }
  }

  /**
   * Update an existing currency
   */
  async updateCurrency(code: CurrencyCode, updates: Partial<Omit<Currency, 'code'>>): Promise<CurrencyOperationResult> {
    await this.ready()
    const existing = this.currencies.get(code)
    if (!existing) {
      return {
        success: false,
        message: `Currency ${code} not found`,
        currency: undefined
      }
    }

    // Validate updates
    if (updates.decimals !== undefined && (updates.decimals < 0 || updates.decimals > 8)) {
      return {
        success: false,
        message: 'Decimals must be between 0 and 8',
        currency: undefined
      }
    }

    if (updates.exchangeRate !== undefined && updates.exchangeRate <= 0) {
      return {
        success: false,
        message: 'Exchange rate must be positive',
        currency: undefined
      }
    }

    // Every rate is "per 1 USD": any other rate for USD itself would skew every conversion.
    if (code === BASE_CURRENCY && updates.exchangeRate !== undefined && updates.exchangeRate !== 1) {
      return {
        success: false,
        message: `${code} is the base currency: its exchange rate is always 1`,
        currency: undefined
      }
    }

    if (existing.isActive && updates.isActive === false) {
      const reason = await this.keepActiveReason(existing)
      if (reason) {
        return { success: false, message: `Cannot deactivate ${code}: ${reason}`, currency: undefined }
      }
    }

    const updatedCurrency: Currency = {
      ...existing,
      ...updates
    }

    const failure = await this.persist(updatedCurrency)
    if (failure) {
      return { success: false, message: failure, currency: undefined }
    }

    return {
      success: true,
      message: `Currency ${code} updated successfully`,
      currency: this.currencies.get(code) ?? updatedCurrency
    }
  }

  /**
   * Delete a currency
   */
  async deleteCurrency(code: CurrencyCode): Promise<CurrencyOperationResult> {
    await this.ready()
    const existing = this.currencies.get(code)
    if (!existing) {
      return {
        success: false,
        message: `Currency ${code} not found`,
        currency: undefined
      }
    }

    // Check if currency is in use (you might want to add more sophisticated checks)
    if (existing.isActive) {
      return {
        success: false,
        message: `Cannot delete active currency ${code}. Deactivate it first.`,
        currency: undefined
      }
    }

    const reason = await this.keepActiveReason(existing)
    if (reason) {
      return { success: false, message: `Cannot delete ${code}: ${reason}`, currency: undefined }
    }

    try {
      this.replace(await this.store.remove(code, this.getAllCurrencies()))
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete the currency',
        currency: undefined
      }
    }

    return {
      success: true,
      message: `Currency ${code} deleted successfully`
    }
  }

  /**
   * Activate a currency
   */
  activateCurrency(code: CurrencyCode): Promise<CurrencyOperationResult> {
    return this.updateCurrency(code, { isActive: true })
  }

  /**
   * Deactivate a currency
   */
  deactivateCurrency(code: CurrencyCode): Promise<CurrencyOperationResult> {
    return this.updateCurrency(code, { isActive: false })
  }

  /**
   * Update exchange rates for multiple currencies
   */
  async updateExchangeRates(rates: Array<{ currency: CurrencyCode; rate: number }>): Promise<ExchangeRateUpdateResult> {
    await this.ready()
    const updatedRates: Currency[] = []
    const errors: string[] = []

    for (const { currency, rate } of rates) {
      if (rate <= 0) {
        errors.push(`Invalid rate for ${currency}: ${rate}`)
        continue
      }

      const existing = this.currencies.get(currency)
      if (!existing) {
        errors.push(`Currency ${currency} not found`)
        continue
      }

      const updated = await this.updateCurrency(currency, { exchangeRate: rate })
      if (updated.success && updated.currency) {
        updatedRates.push(updated.currency)
      } else {
        errors.push(updated.message)
      }
    }

    return {
      success: errors.length === 0,
      message: errors.length === 0 
        ? `Updated ${updatedRates.length} exchange rates successfully`
        : `Updated ${updatedRates.length} rates, ${errors.length} errors: ${errors.join(', ')}`,
      updatedRates
    }
  }

  /**
   * Validate currency code
   */
  isValidCurrency(code: string): code is CurrencyCode {
    return this.currencies.has(code.toUpperCase() as CurrencyCode)
  }

  /**
   * Get currency statistics
   */
  getCurrencyStats() {
    const all = this.getAllCurrencies()
    const active = this.getActiveCurrencies()
    
    return {
      total: all.length,
      active: active.length,
      inactive: all.length - active.length,
      currencies: all.map(c => ({
        code: c.code,
        name: c.name,
        isActive: c.isActive,
        hasExchangeRate: c.exchangeRate !== undefined
      }))
    }
  }
}

// Singleton instance
export const currencyManagementService = new CurrencyManagementService()
// Read the stored currencies as soon as admin-backend loads, before currencyService is asked for a rate.
currencyManagementService.refreshIfStale()
