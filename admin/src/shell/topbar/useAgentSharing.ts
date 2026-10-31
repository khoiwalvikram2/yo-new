import { useCallback, useMemo } from 'react'
import { useQuery, useSubscription } from '@apollo/client'
import { MY_AGENT_SHARING_QUERY, AGENT_SHARING_UPDATED_SUBSCRIPTION } from '@/lib/graphql/agentSharing'
import { useAuthStore } from '@/shared/core/authStore'
import { toSharingSummary } from './walletData'
import type { SharingSummary } from './walletData'

export interface AgentSharingState {
  visible: boolean
  loading: boolean
  sharing: SharingSummary | null
  subtitle: 'Credit Agent Sharing' | 'Agent Sharing'
}

export function useAgentSharing(): AgentSharingState {
  const agent = useAuthStore(s => s.agent)
  const isSharingOrCreditAgent = agent?.schemeType === 'SHARING' || agent?.schemeType === 'CREDIT'
  const agentId = agent?.id
  const subtitle: 'Credit Agent Sharing' | 'Agent Sharing' =
    agent?.schemeType === 'CREDIT' ? 'Credit Agent Sharing' : 'Agent Sharing'

  const { data, loading, error, refetch } = useQuery(MY_AGENT_SHARING_QUERY, {
    errorPolicy: 'all',
    skip: !isSharingOrCreditAgent || !agentId,
  })

  useSubscription(AGENT_SHARING_UPDATED_SUBSCRIPTION, {
    variables: { agentId: agentId || '' },
    skip: !isSharingOrCreditAgent || !agentId,
    onData: useCallback((opts: { data?: { data?: { agentSharingUpdated?: unknown } } }) => {
      if (opts?.data?.data?.agentSharingUpdated) {
        refetch().catch(() => { /* refetch best-effort */ })
      }
    }, [refetch]),
    onError: useCallback(() => {
      // Subscription errors are non-critical
    }, []),
  })

  const sharing = data?.myAgentSharing

  return useMemo(() => {
    if (!isSharingOrCreditAgent || !agentId || error) {
      return { visible: false, loading: false, sharing: null, subtitle }
    }
    if (loading || !sharing) {
      return { visible: true, loading: true, sharing: null, subtitle }
    }
    if (
      !Array.isArray(sharing.sharingRates) ||
      !Array.isArray(sharing.allTimeTotals) ||
      !Array.isArray(sharing.currentPeriodTotals)
    ) {
      return { visible: false, loading: false, sharing: null, subtitle }
    }
    const summary = toSharingSummary({
      rates: sharing.sharingRates,
      allTimeTotals: sharing.allTimeTotals,
      currentPeriodTotals: sharing.currentPeriodTotals,
      currency: sharing.currency,
    })
    return { visible: true, loading: false, sharing: summary, subtitle }
  }, [isSharingOrCreditAgent, agentId, error, loading, sharing, subtitle])
}
