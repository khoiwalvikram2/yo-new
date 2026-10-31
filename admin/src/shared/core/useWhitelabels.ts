import { useQuery } from '@apollo/client'
import { gql } from '@apollo/client'
import { useAppConfig } from './AppConfigProvider'
import { useAuthStore } from './authStore'

const WHITELABELS_QUERY = gql`
  query Whitelabels {
    whitelabels {
      id
      name
      domain
      logoUrl
      faviconUrl
      baseCurrency
      timeZone
      theme {
        primary
        success
        warning
        danger
        dark { bgPage textPrimary textSecondary border }
        light { bgPage textPrimary textSecondary border }
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`

const CURRENT_WHITELABEL_QUERY = gql`
  query CurrentWhitelabel {
    whitelabelCurrent {
      id
      name
      domain
      logoUrl
      faviconUrl
      theme {
        primary
        success
        warning
        danger
        dark { bgPage textPrimary textSecondary border }
        light { bgPage textPrimary textSecondary border }
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`

export interface Whitelabel {
  id: string
  name: string
  domain: string
  logoUrl?: string
  faviconUrl?: string
  theme?: {
    primary: string
    success: string
    warning: string
    danger: string
    dark?: {
      bgPage: string
      textPrimary: string
      textSecondary: string
      border: string
    }
    light?: {
    bgPage: string
    textPrimary: string
    textSecondary: string
    border: string
    }
    bgPage?: string
    textPrimary?: string
    textSecondary?: string
    border?: string
  }
}

export interface WhitelabelWithCurrency extends Whitelabel {
  baseCurrency: string
  region: string
  timezone: string
}

export const useWhitelabels = () => {
  const token = useAuthStore(s => s.token)
  const { data, loading, error } = useQuery(WHITELABELS_QUERY, { skip: !token, errorPolicy: 'all' })
  
  const whitelabels: WhitelabelWithCurrency[] = (data?.whitelabels || []).map((wl: Whitelabel & { baseCurrency?: string | null; timeZone?: string | null }) => {
    const baseCurrency = wl.baseCurrency || 'INR'
    return {
      ...wl,
      baseCurrency,
      region: getRegionFromCurrency(baseCurrency),
      timezone: wl.timeZone || getTimezoneFromCurrency(baseCurrency),
    }
  })

  return {
    whitelabels,
    loading,
    error,
  }
}

export const useCurrentWhitelabel = () => {
  const { baseCurrency, timeZone } = useAppConfig()
  const token = useAuthStore(s => s.token)
  const { data, loading, error } = useQuery(CURRENT_WHITELABEL_QUERY, { 
    skip: !token,
    errorPolicy: 'all',
    fetchPolicy: 'network-only', // CRITICAL: Use network-only to ensure fresh whitelabel data when switching
  })
  
  const whitelabel: WhitelabelWithCurrency | null = data?.whitelabelCurrent ? {
    ...data.whitelabelCurrent,
    baseCurrency,
    region: getRegionFromCurrency(baseCurrency),
    timezone: timeZone,
  } : null

  return {
    whitelabel,
    loading,
    error,
  }
}

// Helper functions to get region and timezone from currency
const getRegionFromCurrency = (currency: string): string => {
  const mapping: Record<string, string> = {
    'INR': 'India',
    'USD': 'United States',
    'EUR': 'Europe',
    'GBP': 'United Kingdom',
    'JPY': 'Japan',
    'AUD': 'Australia',
    'CAD': 'Canada',
    'CHF': 'Switzerland',
    'CNY': 'China',
    'AED': 'UAE',
    'BTC': 'Global',
  }
  return mapping[currency] || 'Global'
}

const getTimezoneFromCurrency = (currency: string): string => {
  const mapping: Record<string, string> = {
    'INR': 'Asia/Kolkata',
    'USD': 'America/New_York',
    'EUR': 'Europe/Berlin',
    'GBP': 'Europe/London',
    'JPY': 'Asia/Tokyo',
    'AUD': 'Australia/Sydney',
    'CAD': 'America/Toronto',
    'CHF': 'Europe/Zurich',
    'CNY': 'Asia/Shanghai',
    'AED': 'Asia/Dubai',
    'BTC': 'UTC',
  }
  return mapping[currency] || 'UTC'
}
