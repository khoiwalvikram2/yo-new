import { CurrencyCode, Currency, CurrencyConversion, DEFAULT_CURRENCY, BASE_CURRENCY } from '@src/types/currency'
import { currencyManagementService, type CurrencyManagementService } from './currencyManagementService.js'

/**
 * Conversions, validation and formatting for the whole backend (wallet ledgers, chips, casino, marketing,
 * referrals and Query.convertCurrency). It reads the currencies the Currency Management page keeps
 * (currencyManagementService). It used to read its own copy of the built-in list, so a currency created on
 * the page could not be converted and a rate saved there was never used.
 */
export class CurrencyService {
  constructor(private readonly currencies: CurrencyManagementService = currencyManagementService) {}

  private currency(code: string): Currency | null {
    this.currencies.refreshIfStale()
    return this.currencies.getCurrency(code as CurrencyCode)
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): Currency[] {
    this.currencies.refreshIfStale()
    return this.currencies.getActiveCurrencies()
  }

  /**
   * Get currency details by code
   */
  getCurrency(code: CurrencyCode): Currency | null {
    return this.currency(code)
  }

  /**
   * Validate if currency code is supported
   */
  isValidCurrency(code: string): code is CurrencyCode {
    return Boolean(this.currency(code)?.isActive)
  }

  /**
   * Get exchange rate between two currencies
   */
  getExchangeRate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1.0

    const fromRate = this.currency(from)?.exchangeRate || 1.0
    const toRate = this.currency(to)?.exchangeRate || 1.0

    // Convert from -> USD -> to
    return toRate / fromRate
  }

  /**
   * Convert amount from one currency to another
   */
  convertAmount(amount: number, from: CurrencyCode, to: CurrencyCode): CurrencyConversion {
    const rate = this.getExchangeRate(from, to)
    const convertedAmount = amount * rate

    return {
      from,
      to,
      rate,
      amount,
      convertedAmount: this.roundAmount(convertedAmount, to),
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Round amount based on currency decimal places
   */
  roundAmount(amount: number, currency: CurrencyCode): number {
    const currencyInfo = this.getCurrency(currency)
    const decimals = currencyInfo?.decimals || 2
    return Math.round(amount * Math.pow(10, decimals)) / Math.pow(10, decimals)
  }

  /**
   * Format amount with currency symbol and proper decimals
   */
  formatAmount(amount: number, currency: CurrencyCode): string {
    const currencyInfo = this.getCurrency(currency)
    if (!currencyInfo) return `${amount} ${currency}`

    const roundedAmount = this.roundAmount(amount, currency)
    const decimals = currencyInfo.decimals

    return `${currencyInfo.symbol}${roundedAmount.toFixed(decimals)}`
  }

  /**
   * Update exchange rates (for real-time rate updates); saved like a change made on the page
   */
  updateExchangeRates(rates: Record<string, number>) {
    return this.currencies.updateExchangeRates(
      Object.entries(rates).map(([currency, rate]) => ({ currency: currency as CurrencyCode, rate }))
    )
  }

  /**
   * Get default currency for a tenant/region
   */
  getDefaultCurrency(tenant?: string): CurrencyCode {
    // In a real app, this could be tenant-specific
    // For now, return the global default
    return DEFAULT_CURRENCY
  }

  /**
   * Get base currency for calculations
   */
  getBaseCurrency(): CurrencyCode {
    return BASE_CURRENCY
  }

  /**
   * Convert to base currency (USD) for calculations
   */
  toBaseCurrency(amount: number, from: CurrencyCode): number {
    return this.convertAmount(amount, from, BASE_CURRENCY).convertedAmount
  }

  /**
   * Convert from base currency (USD) to target currency
   */
  fromBaseCurrency(amount: number, to: CurrencyCode): number {
    return this.convertAmount(amount, BASE_CURRENCY, to).convertedAmount
  }
}

// Singleton instance
export const currencyService = new CurrencyService()
