import { useCallback, useMemo } from 'react'
import { useQuery, useSubscription } from '@apollo/client'
import { MY_AGENT_COMMISSION_QUERY, AGENT_COMMISSION_UPDATED_SUBSCRIPTION } from '@/lib/graphql/agentCommission'
import { useAuthStore } from '@/shared/core/authStore'
import { toSharingSummary } from './walletData'
import type { SharingSummary } from './walletData'

/** Shape of `myAgentCommission` / `agentCommissionUpdated` (admin/src/lib/graphql/agentCommission.ts:3-41). */
interface AgentCommissionPayload {
  commissionRates?: ReadonlyArray<{ domain?: string | null; rate?: number | null } | null> | null
  allTimeTotals?: ReadonlyArray<{ domain?: string | null; totalAmount?: number | null } | null> | null
  currentPeriodTotals?: ReadonlyArray<{ domain?: string | null; totalAmount?: number | null } | null> | null
  currency?: string | null
}

interface MyAgentCommissionData {
  myAgentCommission?: AgentCommissionPayload | null
}

interface AgentCommissionUpdatedData {
  agentCommissionUpdated?: AgentCommissionPayload | null
}

interface AgentCommissionUpdatedVariables {
  agentId: string
}

export interface AgentCommissionState {
  /** false renders nothing: not a COMMISSION agent, no agent id, query error, or invalid arrays once loaded */
  visible: boolean
  /** query loading, or no payload yet */
  loading: boolean
  commission: SharingSummary | null
}

/**
 * Data logic of the old AgentCommissionIndicator (components/topbar/AgentCommissionIndicator.tsx:14-47, 50-76),
 * unchanged, returned as data instead of JSX.
 */
export function useAgentCommission(): AgentCommissionState {
  const agent = useAuthStore((s) => s.agent)

  // Only show commission indicator for COMMISSION scheme agents
  const isCommissionAgent = agent?.schemeType === 'COMMISSION'
  const agentId = agent?.id
  const skip = !isCommissionAgent || !agentId

  const { data, loading, error, refetch } = useQuery<MyAgentCommissionData>(MY_AGENT_COMMISSION_QUERY, {
    errorPolicy: 'all',
    skip,
  })

  const onData = useCallback(
    (opts: { data: { data?: AgentCommissionUpdatedData } }) => {
      if (opts?.data?.data?.agentCommissionUpdated) {
        refetch().catch(() => {})
      }
    },
    [refetch],
  )

  const onError = useCallback(() => {
    // Subscription errors are non-critical
  }, [])

  // Subscribe to real-time updates
  useSubscription<AgentCommissionUpdatedData, AgentCommissionUpdatedVariables>(AGENT_COMMISSION_UPDATED_SUBSCRIPTION, {
    variables: { agentId: agentId || '' },
    skip,
    onData,
    onError,
  })

  const payload = data?.myAgentCommission ?? null
  const arraysValid =
    payload !== null &&
    Array.isArray(payload.commissionRates) &&
    Array.isArray(payload.allTimeTotals) &&
    Array.isArray(payload.currentPeriodTotals)

  const commission = useMemo<SharingSummary | null>(() => {
    if (payload === null || !arraysValid) return null
    return toSharingSummary({
      rates: payload.commissionRates,
      allTimeTotals: payload.allTimeTotals,
      currentPeriodTotals: payload.currentPeriodTotals,
      currency: payload.currency,
    })
  }, [payload, arraysValid])

  const isLoading = loading || payload === null
  const visible = isCommissionAgent && Boolean(agentId) && !error && (isLoading || arraysValid)

  return {
    visible,
    loading: isLoading,
    commission,
  }
}
