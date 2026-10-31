import { CurrencyCode, Currency, SUPPORTED_CURRENCIES } from '@src/types/currency.js'

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

export class CurrencyManagementService {
  private currencies: Map<CurrencyCode, Currency> = new Map()

  constructor() {
    this.initializeCurrencies()
  }

  private initializeCurrencies() {
    // Initialize with default supported currencies
    Object.entries(SUPPORTED_CURRENCIES).forEach(([code, currency]) => {
      this.currencies.set(code as CurrencyCode, { ...currency })
    })
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
  createCurrency(currency: Omit<Currency, 'code'> & { code: string; isActive?: boolean }): CurrencyOperationResult {
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

    this.currencies.set(code, newCurrency)

    return {
      success: true,
      message: `Currency ${code} created successfully`,
      currency: newCurrency
    }
  }

  /**
   * Update an existing currency
   */
  updateCurrency(code: CurrencyCode, updates: Partial<Omit<Currency, 'code'>>): CurrencyOperationResult {
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

    const updatedCurrency: Currency = {
      ...existing,
      ...updates
    }

    this.currencies.set(code, updatedCurrency)

    return {
      success: true,
      message: `Currency ${code} updated successfully`,
      currency: updatedCurrency
    }
  }

  /**
   * Delete a currency
   */
  deleteCurrency(code: CurrencyCode): CurrencyOperationResult {
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

    this.currencies.delete(code)

    return {
      success: true,
      message: `Currency ${code} deleted successfully`
    }
  }

  /**
   * Activate a currency
   */
  activateCurrency(code: CurrencyCode): CurrencyOperationResult {
    return this.updateCurrency(code, { isActive: true })
  }

  /**
   * Deactivate a currency
   */
  deactivateCurrency(code: CurrencyCode): CurrencyOperationResult {
    return this.updateCurrency(code, { isActive: false })
  }

  /**
   * Update exchange rates for multiple currencies
   */
  updateExchangeRates(rates: Array<{ currency: CurrencyCode; rate: number }>): ExchangeRateUpdateResult {
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

      const updated = this.updateCurrency(currency, { exchangeRate: rate })
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
