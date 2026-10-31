import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { useEffect } from 'react'
import { useQuery } from '@apollo/client'
import {
  IconChartLine,
  IconCircleCheck,
  IconCircleX,
  IconClock,
} from '@tabler/icons-react'
import { ADMIN_WITHDRAWAL_REQUEST_STATS } from '@/lib/graphql/withdrawals'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { calculateWithdrawalStats, type WithdrawalStats } from '../withdrawalRequestsModel'

export function WithdrawalRequestsStatsCards({ revision = 0 }: { revision?: number }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // Full-tenant aggregates are independent of the paginated table filters.
  const { data, loading, error, refetch } = useQuery<{ adminWithdrawalRequestStats: WithdrawalStats }>(ADMIN_WITHDRAWAL_REQUEST_STATS, {
    errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
  })
  useEffect(() => { if (revision > 0) void refetch().catch(() => {}) }, [revision, refetch])
  const stats = data?.adminWithdrawalRequestStats ?? calculateWithdrawalStats([])
  if (error && !data?.adminWithdrawalRequestStats) return <Notice tone="error" title="Statistics unavailable" action={<Button onClick={() => void refetch()}>Retry stats</Button>}>{error.message}</Notice>
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} aria-label="Withdrawal request statistics" aria-busy={pending || undefined}>
      <Stat
        label="Pending"
        value={stats.pending}
        note={`${stats.processing} processing`}
        icon={<IconClock size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Completed"
        value={stats.completed}
        note={formatAmount(convertFromWhitelabelCurrency(stats.totalAmount))}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Failed"
        value={stats.failed}
        note={stats.totalRequests > 0 ? `${stats.failureRate}% of total` : '—'}
        icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Completion Rate"
        value={`${stats.completionRate}%`}
        note={`${stats.completed} of ${stats.totalRequests}`}
        icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}
