export interface Currency {
  code: string
  name: string
  symbol: string
  decimals: number
  isActive: boolean
  exchangeRate?: number
}

export interface CurrencyConversion {
  from: string
  to: string
  rate: number
  amount: number
  convertedAmount: number
  timestamp: string
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

export interface CreateCurrencyInput {
  code: string
  name: string
  symbol: string
  decimals: number
  exchangeRate?: number
}

export interface UpdateCurrencyInput {
  code: string
  name?: string
  symbol?: string
  decimals?: number
  isActive?: boolean
  exchangeRate?: number
}

export interface UpdateExchangeRatesInput {
  rates: Array<{
    currency: string
    rate: number
  }>
}
