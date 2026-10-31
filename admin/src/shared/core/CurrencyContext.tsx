import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { gql } from '@apollo/client'
import type { Currency } from '@/shared/types/currency'
import { useAuthStore } from './authStore'
import { useAppConfig } from './AppConfigProvider'
import { getFormatLocale } from '@/shared/utils/locale'
import { hasPermissionWithNested } from './nestedPermissionMapping'

const CURRENCIES_QUERY = gql`
  query Currencies {
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

/** Per-call overrides for formatAmount. */
export interface FormatAmountOptions {
  /** Fraction digits to print instead of the currency's own `decimals`; 0 prints whole units. */
  fractionDigits?: number
}

interface CurrencyContextType {
  selectedCurrency: string
  setSelectedCurrency: (currency: string) => void
  currencies: Currency[]
  loading: boolean
  formatAmount: (amount: number, currencyCode?: string, options?: FormatAmountOptions) => string
  getCurrencySymbol: (currencyCode?: string) => string
  convertAmount: (amount: number, fromCurrency: string, toCurrency?: string) => number
  getDefaultCurrency: () => string
  getWhitelabelBaseCurrencyCode: () => string
  convertFromWhitelabelCurrency: (amount: number) => number
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined)

interface CurrencyProviderProps {
  children: ReactNode
}

export const CurrencyProvider: React.FC<CurrencyProviderProps> = ({ children }) => {
  const [selectedCurrency, setSelectedCurrencyState] = useState<string>('INR')
  const permissions = useAuthStore(s => s.permissions)
  const roles = useAuthStore(s => s.roles)
  const user = useAuthStore(s => s.user)
  const { baseCurrency: whitelabelBaseCurrency, defaultLocale } = useAppConfig()
  const formatLocale = getFormatLocale(defaultLocale)

  // Check if user is authenticated and has currency.read permission
  const hasCurrencyReadPermission = useMemo(() => {
    // Don't query if user is not authenticated
    if (!user) return false
    
    // Check if Super Admin or Whitelabel Admin - they have currency permissions
    const isSuperAdmin = roles.some(role => 
      role === 'Super Admin' || role.toLowerCase() === 'super_admin' || 
      (role.toLowerCase().includes('super') && role.toLowerCase().includes('admin'))
    )
    const isWhitelabelAdmin = roles.some(role => 
      role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel')
    )
    
    // Wait for permissions to be loaded (empty array means not loaded yet, undefined means no permissions)
    // If permissions is empty array and roles exist, user just logged in - allow query (backend will handle permission check)
    if (permissions.length === 0 && roles.length > 0) {
      // Super Admin and Whitelabel Admin have currency permissions - backend allows them to access currencies
      if (isSuperAdmin || isWhitelabelAdmin) return true
      // For other users, wait for permissions to load
      return false
    }
    
    // If we have permissions loaded, use hasPermissionWithNested for proper flat+nested support
    if (permissions.length > 0) {
      // Works for all user types: Super Admin (all.*), WL Admin (currency.read via flat),
      // and Support Admin (currency.list:view via nested exact match)
      return hasPermissionWithNested(permissions, 'currency.list', 'view')
    }
    
    // Super Admin and Whitelabel Admin fallback when permissions haven't loaded yet
    if (isSuperAdmin || isWhitelabelAdmin) return true
    
    return false
  }, [user, permissions, roles])
  
  const { data, loading } = useQuery(CURRENCIES_QUERY, { 
    errorPolicy: 'all',
    skip: !hasCurrencyReadPermission, // Skip query if user doesn't have permission or is not authenticated
    fetchPolicy: 'network-only', // Always fetch fresh data when query runs
  })

  // Use fallback currencies if query fails or user doesn't have permission
  const currencies = useMemo(() => {
    if (data?.currencies && data.currencies.length > 0) {
      return data.currencies
    }
    // Fallback to default INR currency if query fails or no permission
    return [{
      code: 'INR',
      name: 'Indian Rupee',
      symbol: '₹',
      decimals: 2,
      isActive: true,
      exchangeRate: 1,
    }] as Currency[]
  }, [data?.currencies])

  // Load selected currency from localStorage on mount
  useEffect(() => {
    const savedCurrency = localStorage.getItem('selectedCurrency')
    const defaultCurrency = localStorage.getItem('defaultCurrency') || 'INR'
    
    if (savedCurrency && currencies.some((c: Currency) => c.code === savedCurrency)) {
      setSelectedCurrencyState(savedCurrency)
    } else if (currencies.some((c: Currency) => c.code === defaultCurrency)) {
      setSelectedCurrencyState(defaultCurrency)
    } else if (currencies.length > 0) {
      // Fallback to first available currency
      setSelectedCurrencyState(currencies[0].code)
    }
  }, [currencies])

  // Save selected currency to localStorage
  const setSelectedCurrency = (currency: string) => {
    setSelectedCurrencyState(currency)
    localStorage.setItem('selectedCurrency', currency)
  }

  // Get currency info by code
  const getCurrencyInfo = (currencyCode?: string): Currency | undefined => {
    const code = currencyCode || selectedCurrency
    return currencies.find((c: Currency) => c.code === code)
  }

  // Format amount with currency symbol and proper decimals. options.fractionDigits, when given,
  // replaces the decimals in every branch below (0 prints whole units); without it nothing changes.
  const formatAmount = (
    amount: number | null | undefined,
    currencyCode?: string,
    options?: FormatAmountOptions
  ): string => {
    const fractionDigits = options?.fractionDigits
    // Handle null, undefined, or NaN values
    if (amount === null || amount === undefined || isNaN(amount)) {
      const currency = getCurrencyInfo(currencyCode)
      const symbol = currency?.symbol || getCurrencyInfo(whitelabelBaseCurrency)?.symbol || '₹'
      return `${symbol}${(0).toFixed(fractionDigits ?? 2)}`
    }

    const currency = getCurrencyInfo(currencyCode)
    if (!currency) {
      const digits = fractionDigits ?? 2
      return amount.toLocaleString(formatLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    }

    const decimals = fractionDigits ?? currency.decimals
    const symbol = currency.symbol
    const formattedAmount = amount.toLocaleString(formatLocale, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    })
    
    return `${symbol}${formattedAmount}`
  }

  // Get currency symbol
  const getCurrencySymbol = (currencyCode?: string): string => {
    const currency = getCurrencyInfo(currencyCode)
    if (currency) return currency.symbol
    
    // Fallback to whitelabel base currency symbol or first active
    const baseInfo = getCurrencyInfo(whitelabelBaseCurrency)
    const firstCurrency = currencies.find((c: Currency) => c.isActive)
    return baseInfo?.symbol || firstCurrency?.symbol || '₹'
  }

  // Convert amount between currencies
  const convertAmount = (amount: number, fromCurrency: string, toCurrency?: string): number => {
    const targetCurrency = toCurrency || selectedCurrency
    if (fromCurrency === targetCurrency) return amount

    const fromCurrencyInfo = currencies.find((c: Currency) => c.code === fromCurrency)
    const toCurrencyInfo = currencies.find((c: Currency) => c.code === targetCurrency)

    if (!fromCurrencyInfo || !toCurrencyInfo) return amount

    // Convert to base currency (USD) first, then to target currency
    const baseAmount = amount / (fromCurrencyInfo.exchangeRate || 1)
    const convertedAmount = baseAmount * (toCurrencyInfo.exchangeRate || 1)

    return convertedAmount
  }

  // Get default currency from settings (fallback to whitelabel base currency)
  const getDefaultCurrency = (): string => {
    return localStorage.getItem('defaultCurrency') || whitelabelBaseCurrency
  }

  // Get whitelabel base currency (from AppConfig / backend)
  const getWhitelabelBaseCurrencyCode = (): string => {
    return whitelabelBaseCurrency
  }

  // Convert amount from whitelabel's base currency to selected display currency
  const convertFromWhitelabelCurrency = (amount: number): number => {
    const displayCurrency = selectedCurrency
    
    return convertAmount(amount, whitelabelBaseCurrency, displayCurrency)
  }

  const value: CurrencyContextType = {
    selectedCurrency,
    setSelectedCurrency,
    currencies,
    loading,
    formatAmount,
    getCurrencySymbol,
    convertAmount,
    getDefaultCurrency,
    getWhitelabelBaseCurrencyCode,
    convertFromWhitelabelCurrency,
  }

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  )
}

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext)
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider')
  }
  return context
}
