import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useSubscription } from '@apollo/client'
import { MY_AGENT_CREDIT_QUERY, AGENT_CREDIT_UPDATED_SUBSCRIPTION } from '@/lib/graphql/agentCredit'
import { MY_AGENT_SHARING_QUERY, AGENT_SHARING_UPDATED_SUBSCRIPTION } from '@/lib/graphql/agentSharing'
import { useAuthStore } from '@/shared/core/authStore'
import {
  toCreditFigures,
  toSettlementSummary,
  toSharingSummary,
  isNoisyDisconnectError,
  type CreditFigures,
  type SettlementSummary,
  type SharingSummary,
} from './walletData'

const SUBSCRIPTION_REFETCH_COALESCE_MS = 200

export interface AgentCreditState {
  visible: boolean
  loading: boolean
  credit: CreditFigures | null
  settlement: SettlementSummary | null
  sharing: SharingSummary | null
  sharingLoading: boolean
}

export function useAgentCredit(): AgentCreditState {
  const agent = useAuthStore(s => s.agent)
  const isCreditAgent = agent?.schemeType === 'CREDIT'
  const agentId = agent?.id
  const creditRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharingRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data, loading, error, refetch } = useQuery(MY_AGENT_CREDIT_QUERY, {
    errorPolicy: 'all',
    skip: !isCreditAgent,
    pollInterval: 60000,
  })

  useSubscription(AGENT_CREDIT_UPDATED_SUBSCRIPTION, {
    variables: { agentId: agentId || '' },
    skip: !isCreditAgent || !agentId,
    onData: useCallback(
      ({ data: subscriptionData }: { data?: { data?: { agentCreditUpdated?: unknown } } }) => {
        if (!subscriptionData?.data?.agentCreditUpdated) return
        if (creditRefetchTimeoutRef.current) clearTimeout(creditRefetchTimeoutRef.current)
        creditRefetchTimeoutRef.current = setTimeout(() => {
          creditRefetchTimeoutRef.current = null
          refetch().catch(() => {
            // The 60s poll and the next subscription event will retry; nothing else to do here.
          })
        }, SUBSCRIPTION_REFETCH_COALESCE_MS)
      },
      [refetch]
    ),
    onError: useCallback((err: unknown) => {
      if (isNoisyDisconnectError(err)) return
    }, []),
    fetchPolicy: 'no-cache',
  })

  const { data: sharingData, loading: sharingLoading, refetch: refetchSharing } = useQuery(MY_AGENT_SHARING_QUERY, {
    errorPolicy: 'all',
    skip: !isCreditAgent || !agentId,
  })

  useSubscription(AGENT_SHARING_UPDATED_SUBSCRIPTION, {
    variables: { agentId: agentId || '' },
    skip: !isCreditAgent || !agentId,
    onData: useCallback(
      ({ data: subscriptionData }: { data?: { data?: { agentSharingUpdated?: unknown } } }) => {
        if (!subscriptionData?.data?.agentSharingUpdated) return
        if (sharingRefetchTimeoutRef.current) clearTimeout(sharingRefetchTimeoutRef.current)
        sharingRefetchTimeoutRef.current = setTimeout(() => {
          sharingRefetchTimeoutRef.current = null
          refetchSharing().catch(() => {
            // The next subscription event will retry; nothing else to do here.
          })
        }, SUBSCRIPTION_REFETCH_COALESCE_MS)
      },
      [refetchSharing]
    ),
    onError: useCallback((err: unknown) => {
      if (isNoisyDisconnectError(err)) return
    }, []),
  })

  useEffect(() => {
    return () => {
      if (creditRefetchTimeoutRef.current) clearTimeout(creditRefetchTimeoutRef.current)
      if (sharingRefetchTimeoutRef.current) clearTimeout(sharingRefetchTimeoutRef.current)
    }
  }, [])

  if (!isCreditAgent || error) {
    return { visible: false, loading: false, credit: null, settlement: null, sharing: null, sharingLoading: false }
  }

  if (loading || !data?.myAgentCredit) {
    return { visible: true, loading: true, credit: null, settlement: null, sharing: null, sharingLoading }
  }

  const sharingPayload = sharingData?.myAgentSharing
  const sharing = sharingPayload
    ? toSharingSummary({
        rates: sharingPayload.sharingRates,
        allTimeTotals: sharingPayload.allTimeTotals,
        currentPeriodTotals: sharingPayload.currentPeriodTotals,
        currency: sharingPayload.currency,
      })
    : null

  return {
    visible: true,
    loading: false,
    credit: toCreditFigures(data.myAgentCredit),
    settlement: toSettlementSummary(data.myAgentCredit),
    sharing,
    sharingLoading,
  }
}
