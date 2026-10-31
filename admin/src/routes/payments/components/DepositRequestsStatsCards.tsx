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
import { ADMIN_DEPOSIT_REQUEST_STATS } from '@/lib/graphql/deposits'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { calculateDepositStats, type DepositStats } from '../depositRequestsModel'

export function DepositRequestsStatsCards({ revision = 0 }: { revision?: number }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const { data, loading, error, refetch } = useQuery<{ adminDepositRequestStats: DepositStats }>(ADMIN_DEPOSIT_REQUEST_STATS, {
    errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
  })
  useEffect(() => { if (revision > 0) void refetch().catch(() => {}) }, [revision, refetch])
  const stats = data?.adminDepositRequestStats ?? calculateDepositStats([])
  if (error && !data?.adminDepositRequestStats) return <Notice tone="error" title="Statistics unavailable" action={<Button onClick={() => void refetch()}>Retry stats</Button>}>{error.message}</Notice>
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} aria-label="Deposit request statistics" aria-busy={pending || undefined}>
      <Stat
        label="Pending"
        value={stats.pending}
        note={`${stats.totalRequests} total requests`}
        icon={<IconClock size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Approved"
        value={stats.approved}
        note={formatAmount(convertFromWhitelabelCurrency(stats.totalAmount))}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Rejected"
        value={stats.rejected}
        note={stats.totalRequests > 0 ? `${stats.rejectionRate}% of total` : '—'}
        icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Approval Rate"
        value={`${stats.approvalRate}%`}
        note={`${stats.approved} of ${stats.totalRequests}`}
        icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}
