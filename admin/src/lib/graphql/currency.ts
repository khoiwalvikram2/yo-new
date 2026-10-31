import { gql } from '@apollo/client'

// Queries
export const GET_CURRENCIES = gql`
  query GetCurrencies {
    currencies {
      code
      name
      symbol
      decimals
      isActive
      exchangeRate
    }
  }
`

export const GET_CURRENCY = gql`
  query GetCurrency($code: String!) {
    currency(code: $code) {
      code
      name
      symbol
      decimals
      isActive
      exchangeRate
    }
  }
`

export const CONVERT_CURRENCY = gql`
  query ConvertCurrency($input: CurrencyConversionInput!) {
    convertCurrency(input: $input) {
      convertedAmount
      rate
      timestamp
    }
  }
`

// Mutations
export const CREATE_CURRENCY = gql`
  mutation CreateCurrency($input: CreateCurrencyInput!) {
    createCurrency(input: $input) {
      success
      message
      currency {
        code
        name
        symbol
        decimals
        isActive
        exchangeRate
      }
    }
  }
`

export const UPDATE_CURRENCY = gql`
  mutation UpdateCurrency($input: UpdateCurrencyInput!) {
    updateCurrency(input: $input) {
      success
      message
      currency {
        code
        name
        symbol
        decimals
        isActive
        exchangeRate
      }
    }
  }
`

export const DELETE_CURRENCY = gql`
  mutation DeleteCurrency($code: String!) {
    deleteCurrency(code: $code) {
      success
      message
    }
  }
`

export const UPDATE_EXCHANGE_RATES = gql`
  mutation UpdateExchangeRates($input: UpdateExchangeRatesInput!) {
    updateExchangeRates(input: $input) {
      success
      message
      updatedRates {
        code
        name
        exchangeRate
      }
    }
  }
`

export const ACTIVATE_CURRENCY = gql`
  mutation ActivateCurrency($code: String!) {
    activateCurrency(code: $code) {
      success
      message
      currency {
        code
        isActive
      }
    }
  }
`

export const DEACTIVATE_CURRENCY = gql`
  mutation DeactivateCurrency($code: String!) {
    deactivateCurrency(code: $code) {
      success
      message
      currency {
        code
        isActive
      }
    }
  }
`
