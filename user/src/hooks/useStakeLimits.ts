import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { useRiskConfig } from './useAppSettings'
import { getMyStakeLimits } from '@/lib/api/user'
import { formatAmount } from '@/lib/currency'

export function useStakeLimits() {
  const { user } = useAuth()
  const { dailyStakeLimit, weeklyStakeLimit } = useRiskConfig()
  
  const { data: response, isLoading } = useQuery({
    queryKey: ['user-stakes', user?.id],
    queryFn: async () => {
      const res = await getMyStakeLimits()
      if (res.meta.code === 200 && res.data) {
        return res.data
      }
      // Fallback to zeros if API fails
      return {
        dailyTotal: 0,
        weeklyTotal: 0,
        dailyLimit: null,
        weeklyLimit: null,
        dailyRemaining: null,
        weeklyRemaining: null,
      }
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000, // 30 seconds
  })

  // Prefer API limits (player-specific when set by admin); fallback to app risk config
  const effectiveDailyLimit = response?.dailyLimit ?? dailyStakeLimit ?? null
  const effectiveWeeklyLimit = response?.weeklyLimit ?? weeklyStakeLimit ?? null
  const dailyTotal = response?.dailyTotal ?? 0
  const weeklyTotal = response?.weeklyTotal ?? 0
  const dailyRemaining =
    response?.dailyRemaining ??
    (effectiveDailyLimit != null ? Math.max(0, effectiveDailyLimit - dailyTotal) : null)
  const weeklyRemaining =
    response?.weeklyRemaining ??
    (effectiveWeeklyLimit != null ? Math.max(0, effectiveWeeklyLimit - weeklyTotal) : null)

  const canPlaceStake = (amount: number): { allowed: boolean; reason?: string } => {
    if (effectiveDailyLimit != null && dailyTotal + amount > effectiveDailyLimit) {
      return {
        allowed: false,
        reason: `Daily stake limit of ${formatAmount(effectiveDailyLimit)} would be exceeded. Remaining: ${dailyRemaining != null ? formatAmount(dailyRemaining) : '0.00'}`,
      }
    }
    if (effectiveWeeklyLimit != null && weeklyTotal + amount > effectiveWeeklyLimit) {
      return {
        allowed: false,
        reason: `Weekly stake limit of ${formatAmount(effectiveWeeklyLimit)} would be exceeded. Remaining: ${weeklyRemaining != null ? formatAmount(weeklyRemaining) : '0.00'}`,
      }
    }
    return { allowed: true }
  }

  return {
    dailyTotal,
    weeklyTotal,
    dailyLimit: effectiveDailyLimit,
    weeklyLimit: effectiveWeeklyLimit,
    dailyRemaining,
    weeklyRemaining,
    canPlaceStake,
    isLoading,
  }
}

