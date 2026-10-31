import {
  type CurrencyCode,
  type Currency,
  type CurrencyConversion,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  BASE_CURRENCY,
} from '../types/currency.js'

export class CurrencyService {
  private exchangeRates: Record<string, number> = {}

  constructor() {
    this.initializeExchangeRates()
  }

  private initializeExchangeRates() {
    Object.values(SUPPORTED_CURRENCIES).forEach((currency) => {
      if (currency.exchangeRate) {
        this.exchangeRates[currency.code] = currency.exchangeRate
      }
    })
  }

  getSupportedCurrencies(): Currency[] {
    return Object.values(SUPPORTED_CURRENCIES).filter((c) => c.isActive)
  }

  getCurrency(code: CurrencyCode): Currency | null {
    return SUPPORTED_CURRENCIES[code] || null
  }

  isValidCurrency(code: string): code is CurrencyCode {
    return code in SUPPORTED_CURRENCIES && SUPPORTED_CURRENCIES[code as CurrencyCode].isActive
  }

  getExchangeRate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1.0
    const fromRate = this.exchangeRates[from] || 1.0
    const toRate = this.exchangeRates[to] || 1.0
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
