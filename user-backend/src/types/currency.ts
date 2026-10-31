export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CHF' | 'CNY' | 'AED' | 'BTC' | 'ETH'

export interface Currency {
  code: CurrencyCode
  name: string
  symbol: string
  decimals: number
  isActive: boolean
  exchangeRate?: number
}

export interface CurrencyConversion {
  from: CurrencyCode
  to: CurrencyCode
  rate: number
  amount: number
  convertedAmount: number
  timestamp: string
}

export const SUPPORTED_CURRENCIES: Record<CurrencyCode, Currency> = {
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 83.0 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2, isActive: true, exchangeRate: 1.0 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, isActive: true, exchangeRate: 0.92 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2, isActive: true, exchangeRate: 0.79 },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0, isActive: true, exchangeRate: 150.0 },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2, isActive: true, exchangeRate: 1.52 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2, isActive: true, exchangeRate: 1.36 },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', decimals: 2, isActive: true, exchangeRate: 0.88 },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2, isActive: true, exchangeRate: 7.2 },
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2, isActive: true, exchangeRate: 3.67 },
  BTC: { code: 'BTC', name: 'Bitcoin', symbol: '₿', decimals: 8, isActive: false, exchangeRate: 0.000023 },
  ETH: { code: 'ETH', name: 'Ethereum', symbol: 'Ξ', decimals: 8, isActive: false, exchangeRate: 0.0004 },
}

export const DEFAULT_CURRENCY: CurrencyCode = 'INR'
export const BASE_CURRENCY: CurrencyCode = 'USD'
