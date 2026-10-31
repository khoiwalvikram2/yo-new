import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ApolloProvider } from '@apollo/client'
import { queryClient } from '../../lib/queryClient'
import { apolloClient } from '../../shared/core/api'
import { WhitelabelProvider } from '../../shared/core/WhitelabelProvider'
import { AppConfigProvider } from '../../shared/core/AppConfigProvider'
import { SyncLocaleFromAppConfig } from '../../shared/core/SyncLocaleFromAppConfig'
import { CurrencyProvider } from '../../shared/core/CurrencyContext'
import { ErrorBoundary } from '../../shared/core/ErrorBoundary'
import { Toaster } from '../../ui/components/Toaster'
import { ConfirmHost } from '../../ui/components/ConfirmHost'

interface AppProvidersProps {
  children: React.ReactNode
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  const content = children ?? null
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ApolloProvider client={apolloClient}>
            <AppConfigProvider>
              <SyncLocaleFromAppConfig />
              <CurrencyProvider>
                <WhitelabelProvider>
                  {content}
                  {/* One toast stack for the whole app. It sits beside the routed content rather than
                      inside it, so a toast raised just before a redirect to /login still shows. */}
                  <Toaster />
                  <ConfirmHost />
                </WhitelabelProvider>
              </CurrencyProvider>
            </AppConfigProvider>
        </ApolloProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
