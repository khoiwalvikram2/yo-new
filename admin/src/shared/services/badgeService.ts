import { create } from 'zustand'
import { gql } from '@apollo/client'
import { apolloClient } from '@/shared/core/api'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const PENDING_DEPOSITS_COUNT = gql`
  query PendingDepositsCount($input: ListDepositRequestsInput) {
    adminDepositRequests(input: $input) {
      total
    }
  }
`

const PENDING_WITHDRAWALS_COUNT = gql`
  query PendingWithdrawalsCount($input: AdminWithdrawalFilter) {
    adminWithdrawalRequests(input: $input) {
      total
    }
  }
`

export interface BadgeCounts {
  deposits: number
  withdrawals: number
  payments: number
  sportsEvents: number
  matkaDraws: number
  agentRequests: number
  alerts: number
}

interface BadgeState extends BadgeCounts {
  isLoading: boolean
  lastUpdated: number | null
  updateBadge: (key: keyof BadgeCounts, count: number) => void
  updateAll: (counts: Partial<BadgeCounts>) => void
  reset: () => void
}

const initialCounts: BadgeCounts = {
  deposits: 0,
  withdrawals: 0,
  payments: 0,
  sportsEvents: 0,
  matkaDraws: 0,
  agentRequests: 0,
  alerts: 0,
}

export const useBadgeStore = create<BadgeState>((set) => ({
  ...initialCounts,
  isLoading: false,
  lastUpdated: null,

  updateBadge: (key, count) =>
    set(() => ({
      [key]: count,
      lastUpdated: Date.now(),
    })),

  updateAll: (counts) =>
    set((state) => ({
      ...state,
      ...counts,
      lastUpdated: Date.now(),
    })),

  reset: () =>
    set({
      ...initialCounts,
      isLoading: false,
      lastUpdated: null,
    }),
}))

/**
 * Badge service for fetching and updating badge counts
 */
export class BadgeService {
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private readonly POLLING_INTERVAL = 30000 // 30 seconds

  /**
   * Start polling for badge counts
   */
  startPolling() {
    // Stop any existing polling first to prevent memory leaks
    this.stopPolling()
    
    // Initial fetch
    this.fetchBadgeCounts()

    // Set up polling
    this.pollingInterval = setInterval(() => {
      this.fetchBadgeCounts()
    }, this.POLLING_INTERVAL)
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  /**
   * Fetch all badge counts via GraphQL.
   * Only requests deposit/withdrawal counts when the user has the required permissions,
   * so support admins without payments access do not trigger permission errors.
   */
  private async fetchBadgeCounts() {
    try {
      // Skip until auth is hydrated (e.g. after refresh) so we have correct permissions
      if (!useAuthStore.getState()._hasHydrated) {
        return
      }

      useBadgeStore.setState({ isLoading: true })

      const permissions = useAuthStore.getState().permissions ?? []
      const canViewDeposits = hasPermissionWithNested(permissions, 'payments.deposits', 'view')
      const canViewWithdrawals = hasPermissionWithNested(permissions, 'payments.withdrawals', 'view')

      let deposits = 0
      let withdrawals = 0

      if (canViewDeposits && canViewWithdrawals) {
        const inputDeposits = { status: 'PENDING' as const, limit: 1, offset: 0 }
        const inputWithdrawals = { status: 'PENDING' as const, limit: 1, offset: 0 }
        const [depositsRes, withdrawalsRes] = await Promise.all([
          apolloClient.query({
            query: PENDING_DEPOSITS_COUNT,
            variables: { input: inputDeposits },
            fetchPolicy: 'network-only',
          }),
          apolloClient.query({
            query: PENDING_WITHDRAWALS_COUNT,
            variables: { input: inputWithdrawals },
            fetchPolicy: 'network-only',
          }),
        ])
        deposits = Math.max(0, depositsRes.data?.adminDepositRequests?.total ?? 0)
        withdrawals = Math.max(0, withdrawalsRes.data?.adminWithdrawalRequests?.total ?? 0)
      } else if (canViewDeposits) {
        const inputDeposits = { status: 'PENDING' as const, limit: 1, offset: 0 }
        const depositsRes = await apolloClient.query({
          query: PENDING_DEPOSITS_COUNT,
          variables: { input: inputDeposits },
          fetchPolicy: 'network-only',
        })
        deposits = Math.max(0, depositsRes.data?.adminDepositRequests?.total ?? 0)
      } else if (canViewWithdrawals) {
        const inputWithdrawals = { status: 'PENDING' as const, limit: 1, offset: 0 }
        const withdrawalsRes = await apolloClient.query({
          query: PENDING_WITHDRAWALS_COUNT,
          variables: { input: inputWithdrawals },
          fetchPolicy: 'network-only',
        })
        withdrawals = Math.max(0, withdrawalsRes.data?.adminWithdrawalRequests?.total ?? 0)
      }

      const payments = deposits + withdrawals
      const alerts = payments

      useBadgeStore.getState().updateAll({
        deposits,
        withdrawals,
        payments,
        alerts,
        sportsEvents: 0,
        matkaDraws: 0,
        agentRequests: 0,
      })
    } catch {
      // best-effort refresh; a failed poll just leaves the previous counts in place
    } finally {
      useBadgeStore.setState({ isLoading: false })
    }
  }

  /**
   * Manually refresh badge counts
   */
  async refresh() {
    await this.fetchBadgeCounts()
  }

  /**
   * Update a specific badge count manually
   */
  updateBadge(key: keyof BadgeCounts, count: number) {
    useBadgeStore.getState().updateBadge(key, count)
  }
}

// Export singleton instance
export const badgeService = new BadgeService()

/**
 * Get badge count for a specific key
 */
export function getBadgeCount(key: keyof BadgeCounts): number {
  return useBadgeStore.getState()[key]
}

/**
 * Get formatted badge text
 */
export function getBadgeText(key: keyof BadgeCounts): string | undefined {
  const count = useBadgeStore.getState()[key]
  if (count === 0) return undefined
  if (count > 99) return '99+'
  return count.toString()
}

/**
 * Hook to use badge counts in components
 */
export function useBadgeCount(key: keyof BadgeCounts) {
  return useBadgeStore((state) => state[key])
}

/**
 * Same as useBadgeCount, but for a caller that may or may not have a badge key at all
 * (e.g. a shell row/section that only sometimes owns a badge). Calls the underlying hook
 * unconditionally (rules of hooks) using a throwaway key when there is none, and returns 0
 * in that case instead of leaking the throwaway key's real count.
 */
export function useOptionalBadgeCount(key: (keyof BadgeCounts) | null): number {
  const raw = useBadgeCount(key ?? 'payments')
  return key ? raw : 0
}

/**
 * Hook to use all badge counts
 */
export function useAllBadgeCounts() {
  return useBadgeStore((state) => ({
    deposits: state.deposits,
    withdrawals: state.withdrawals,
    payments: state.payments,
    sportsEvents: state.sportsEvents,
    matkaDraws: state.matkaDraws,
    agentRequests: state.agentRequests,
    alerts: state.alerts,
  }))
}

