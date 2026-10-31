import { CurrencyCode, Currency, CurrencyConversion, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, BASE_CURRENCY } from '@src/types/currency'

export class CurrencyService {
  private exchangeRates: Record<string, number> = {}

  constructor() {
    this.initializeExchangeRates()
  }

  private initializeExchangeRates() {
    // Initialize with base rates from SUPPORTED_CURRENCIES
    Object.values(SUPPORTED_CURRENCIES).forEach(currency => {
      if (currency.exchangeRate) {
        this.exchangeRates[currency.code] = currency.exchangeRate
      }
    })
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): Currency[] {
    return Object.values(SUPPORTED_CURRENCIES).filter(c => c.isActive)
  }

  /**
   * Get currency details by code
   */
  getCurrency(code: CurrencyCode): Currency | null {
    return SUPPORTED_CURRENCIES[code] || null
  }

  /**
   * Validate if currency code is supported
   */
  isValidCurrency(code: string): code is CurrencyCode {
    return code in SUPPORTED_CURRENCIES && SUPPORTED_CURRENCIES[code as CurrencyCode].isActive
  }

  /**
   * Get exchange rate between two currencies
   */
  getExchangeRate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1.0

    const fromRate = this.exchangeRates[from] || 1.0
    const toRate = this.exchangeRates[to] || 1.0

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
   * Update exchange rates (for real-time rate updates)
   */
  updateExchangeRates(rates: Record<string, number>) {
    this.exchangeRates = { ...this.exchangeRates, ...rates }
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
