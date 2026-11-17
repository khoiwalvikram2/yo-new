import { useMutation, useQuery } from '@apollo/client'
import {
  GET_CURRENCIES,
  GET_CURRENCY,
  CONVERT_CURRENCY,
  CREATE_CURRENCY,
  UPDATE_CURRENCY,
  DELETE_CURRENCY,
  UPDATE_EXCHANGE_RATES,
  ACTIVATE_CURRENCY,
  DEACTIVATE_CURRENCY,
} from '@/lib/graphql/currency'
import type {
  CreateCurrencyInput,
  UpdateCurrencyInput,
  UpdateExchangeRatesInput,
} from '@/shared/types/currency'

// Query hooks
export const useCurrencies = () => {
  return useQuery(GET_CURRENCIES, {
    errorPolicy: 'all',
  })
}

export const useCurrency = (code: string) => {
  return useQuery(GET_CURRENCY, {
    variables: { code },
    skip: !code,
    errorPolicy: 'all',
  })
}

export const useConvertCurrency = () => {
  return useQuery(CONVERT_CURRENCY, {
    skip: true, // Only run manually
    errorPolicy: 'all',
  })
}

/* Refetched after every currency change: the management page's list (GetCurrencies) and the panel's own
   currency list (Currencies, CurrencyContext), which drives the topbar's currency choice and every
   formatAmount / convertAmount. Without the second, the topbar list and the display rates stayed as they
   were until a reload. */
const CURRENCY_LISTS = ['GetCurrencies', 'Currencies']

// Mutation hooks
export const useCreateCurrency = () => {
  return useMutation(CREATE_CURRENCY, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after creation
  })
}

export const useUpdateCurrency = () => {
  return useMutation(UPDATE_CURRENCY, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after update
  })
}

export const useDeleteCurrency = () => {
  return useMutation(DELETE_CURRENCY, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after deletion
  })
}

export const useUpdateExchangeRates = () => {
  return useMutation(UPDATE_EXCHANGE_RATES, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after rate update
  })
}

export const useActivateCurrency = () => {
  return useMutation(ACTIVATE_CURRENCY, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after activation
  })
}

export const useDeactivateCurrency = () => {
  return useMutation(DEACTIVATE_CURRENCY, {
    refetchQueries: CURRENCY_LISTS, // Refetch currencies after deactivation
  })
}

// Utility functions
export const useCurrencyActions = () => {
  const [createCurrency, { loading: createLoading }] = useCreateCurrency()
  const [updateCurrency, { loading: updateLoading }] = useUpdateCurrency()
  const [deleteCurrency, { loading: deleteLoading }] = useDeleteCurrency()
  const [updateExchangeRates, { loading: updateRatesLoading }] = useUpdateExchangeRates()
  const [activateCurrency, { loading: activateLoading }] = useActivateCurrency()
  const [deactivateCurrency, { loading: deactivateLoading }] = useDeactivateCurrency()

  return {
    createCurrency: (input: CreateCurrencyInput) => 
      createCurrency({ variables: { input } }),
    updateCurrency: (input: UpdateCurrencyInput) => 
      updateCurrency({ variables: { input } }),
    deleteCurrency: (code: string) => 
      deleteCurrency({ variables: { code } }),
    updateExchangeRates: (input: UpdateExchangeRatesInput) => 
      updateExchangeRates({ variables: { input } }),
    activateCurrency: (code: string) => 
      activateCurrency({ variables: { code } }),
    deactivateCurrency: (code: string) => 
      deactivateCurrency({ variables: { code } }),
    loading: {
      create: createLoading,
      update: updateLoading,
      delete: deleteLoading,
      updateRates: updateRatesLoading,
      activate: activateLoading,
      deactivate: deactivateLoading,
    },
  }
}
