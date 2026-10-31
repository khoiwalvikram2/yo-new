import React, { createContext, useContext, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { APP_DISPLAY_CONFIG } from '@/lib/graphql/appConfig'
import { useUIStore } from './uiStore'
import { useAuthStore } from './authStore'

export interface AppConfigContextValue {
  baseCurrency: string
  timeZone: string
  defaultLocale: string
  loading: boolean
  appConfig: Record<string, unknown> | null
}

const AppConfigContext = createContext<AppConfigContextValue | undefined>(undefined)

const DEFAULT_BASE_CURRENCY = 'INR'
const DEFAULT_TIMEZONE = 'Asia/Kolkata'
const DEFAULT_LOCALE = 'en_US'

interface AppConfigProviderProps {
  children: ReactNode
}

export const AppConfigProvider: React.FC<AppConfigProviderProps> = ({ children }) => {
  const tenant = useUIStore(s => s.tenant)
  const token = useAuthStore(s => s.token)
  const isAuthenticated = !!token
  const { data, loading, refetch } = useQuery(APP_DISPLAY_CONFIG, {
    skip: !isAuthenticated,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const previousTenantRef = useRef<string | null>(null)

  useEffect(() => {
    // Re-fetch only when tenant actually changes after authentication.
    // The tenant guard also prevents a repeat if Apollo changes refetch's identity.
    if (!isAuthenticated) return
    if (previousTenantRef.current === tenant) return
    previousTenantRef.current = tenant
    void refetch()
  }, [tenant, isAuthenticated, refetch])

  const appConfig = data?.appDisplayConfig ?? null
  const baseCurrency = appConfig?.baseCurrency ?? DEFAULT_BASE_CURRENCY
  const timeZone = appConfig?.timeZone ?? DEFAULT_TIMEZONE
  const defaultLocale = appConfig?.defaultLocale ?? DEFAULT_LOCALE

  const value: AppConfigContextValue = {
    baseCurrency: typeof baseCurrency === 'string' ? baseCurrency : DEFAULT_BASE_CURRENCY,
    timeZone: typeof timeZone === 'string' ? timeZone : DEFAULT_TIMEZONE,
    defaultLocale: typeof defaultLocale === 'string' ? defaultLocale : DEFAULT_LOCALE,
    loading,
    appConfig: appConfig as Record<string, unknown> | null,
  }

  return (
    <AppConfigContext.Provider value={value}>
      {children}
    </AppConfigContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- This context intentionally exposes its hook alongside its provider.
export function useAppConfig(): AppConfigContextValue {
  const ctx = useContext(AppConfigContext)
  if (ctx === undefined) {
    return {
      baseCurrency: DEFAULT_BASE_CURRENCY,
      timeZone: DEFAULT_TIMEZONE,
      defaultLocale: DEFAULT_LOCALE,
      loading: false,
      appConfig: null,
    }
  }
  return ctx
}
