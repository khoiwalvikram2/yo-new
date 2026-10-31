import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client'
import {
  MY_WHITELABEL_CREDIT_QUERY,
  MY_WHITELABEL_SHARING_QUERY,
  WHITELABEL_SHARING_UPDATED_SUBSCRIPTION,
  WHITELABEL_CREDIT_UPDATED_SUBSCRIPTION,
} from '@/lib/graphql/whitelabel'
import { useUIStore } from '@/shared/core/uiStore'
import { toCreditFigures, toSharingSummary, isNoisyDisconnectError, type CreditFigures, type SharingSummary } from './walletData'

const SUBSCRIPTION_REFETCH_COALESCE_MS = 200

export interface WhitelabelCreditState {
  /** creditLoading || no credit payload: the trigger shows a placeholder (also after a credit error). */
  loading: boolean
  credit: CreditFigures | null
  /** null when the sharing payload is missing. */
  sharing: SharingSummary | null
  sharingLoading: boolean
}

/**
 * Whitelabel credit and sharing for the topbar wallet. The logic is WhitelabelCreditIndicator.tsx:16-102
 * and :129-141 unchanged. The credit subscription writes a recomputed usagePercentage/isNearLimit into the
 * MY_WHITELABEL_CREDIT_QUERY cache (other pages read it), then refetches after a coalesced 200 ms. The
 * sharing subscription only triggers a coalesced refetch. Status and totals are derived in walletData.ts.
 */
export function useWhitelabelCredit(): WhitelabelCreditState {
  const tenant = useUIStore((s) => s.tenant)
  const apolloClient = useApolloClient()
  const creditRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharingRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Polling is a fallback - subscription handles real-time updates
  // Using cache-and-network so subscription cache updates trigger immediate re-render
  const {
    data: creditData,
    loading: creditLoading,
    refetch: refetchCredit,
  } = useQuery(MY_WHITELABEL_CREDIT_QUERY, {
    pollInterval: 0, // Disable polling - subscription handles all updates (no 30s delay)
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network', // Check cache first, then network - subscription updates cache
    notifyOnNetworkStatusChange: false, // Don't trigger loading state on network changes
    nextFetchPolicy: 'cache-first', // After initial fetch, use cache (subscription updates it)
  })

  // Subscribe to real-time credit updates
  useSubscription(WHITELABEL_CREDIT_UPDATED_SUBSCRIPTION, {
    variables: { whitelabelId: tenant || '' },
    skip: !tenant,
    onData: useCallback(
      ({ data: subscriptionData }: { data?: { data?: { whitelabelCreditUpdated?: Record<string, unknown> } } }) => {
        if (!subscriptionData?.data?.whitelabelCreditUpdated) return
        const creditUpdate = subscriptionData.data.whitelabelCreditUpdated
        const creditLimit = Number(creditUpdate.creditLimit) || 0
        const creditUsed = Number(creditUpdate.creditUsed) || 0
        const usagePercentage = creditLimit > 0 ? (creditUsed / creditLimit) * 100 : 0
        const isNearLimit = usagePercentage >= (Number(creditUpdate.creditAlertThreshold) || 80)
        try {
          apolloClient.cache.writeQuery({
            query: MY_WHITELABEL_CREDIT_QUERY,
            data: {
              myWhitelabelCredit: {
                ...creditUpdate,
                usagePercentage,
                isNearLimit,
              },
            },
          })
        } catch {
          // ignore cache write
        }
        if (creditRefetchTimeoutRef.current) clearTimeout(creditRefetchTimeoutRef.current)
        creditRefetchTimeoutRef.current = setTimeout(() => {
          creditRefetchTimeoutRef.current = null
          refetchCredit().catch(() => {})
        }, SUBSCRIPTION_REFETCH_COALESCE_MS)
      },
      [refetchCredit, apolloClient],
    ),
    onError: useCallback((err: unknown) => {
      if (isNoisyDisconnectError(err)) return
    }, []),
    onComplete: useCallback(() => {}, []),
    fetchPolicy: 'no-cache', // Always get fresh data from subscription
  })

  useEffect(() => {
    return () => {
      if (creditRefetchTimeoutRef.current) clearTimeout(creditRefetchTimeoutRef.current)
      if (sharingRefetchTimeoutRef.current) clearTimeout(sharingRefetchTimeoutRef.current)
    }
  }, [])

  const {
    data: sharingData,
    loading: sharingLoading,
    refetch: refetchSharing,
  } = useQuery(MY_WHITELABEL_SHARING_QUERY, {
    errorPolicy: 'all',
    skip: !tenant,
  })

  useSubscription(WHITELABEL_SHARING_UPDATED_SUBSCRIPTION, {
    variables: { whitelabelId: tenant || '' },
    skip: !tenant,
    onData: useCallback(
      ({ data: subscriptionData }: { data?: { data?: { whitelabelSharingUpdated?: unknown } } }) => {
        if (!subscriptionData?.data?.whitelabelSharingUpdated) return
        if (sharingRefetchTimeoutRef.current) clearTimeout(sharingRefetchTimeoutRef.current)
        sharingRefetchTimeoutRef.current = setTimeout(() => {
          sharingRefetchTimeoutRef.current = null
          refetchSharing().catch(() => {})
        }, SUBSCRIPTION_REFETCH_COALESCE_MS)
      },
      [refetchSharing],
    ),
    onError: useCallback(() => {}, []),
  })

  const creditPayload = creditData?.myWhitelabelCredit
  const sharingPayload = sharingData?.myWhitelabelSharing

  const credit = useMemo(() => (creditPayload ? toCreditFigures(creditPayload) : null), [creditPayload])

  const sharing = useMemo(
    () =>
      sharingPayload
        ? toSharingSummary({
            rates: sharingPayload.sharingRates,
            allTimeTotals: sharingPayload.allTimeTotals,
            currentPeriodTotals: sharingPayload.currentPeriodTotals,
            currency: sharingPayload.currency,
          })
        : null,
    [sharingPayload],
  )

  return {
    loading: creditLoading || !creditPayload,
    credit,
    sharing,
    sharingLoading,
  }
}
