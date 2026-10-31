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
import { ADMIN_PAYOUT_ACCOUNT_STATS } from '@/lib/graphql/payoutAccounts'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { calculatePayoutAccountStats, type PayoutAccountStats } from '../payoutAccountApprovalsModel'

export function PayoutAccountsStatsCards({ revision = 0 }: { revision?: number }) {
  // Full-tenant aggregates are independent of the paginated table filters.
  const { data, loading, error, refetch } = useQuery<{ adminPayoutAccountStats: PayoutAccountStats }>(ADMIN_PAYOUT_ACCOUNT_STATS, {
    errorPolicy: 'all', fetchPolicy: 'cache-and-network', pollInterval: 15000,
  })
  useEffect(() => { if (revision > 0) void refetch().catch(() => {}) }, [revision, refetch])
  const stats = data?.adminPayoutAccountStats ?? calculatePayoutAccountStats([])
  if (error && !data?.adminPayoutAccountStats) return <Notice tone="error" title="Statistics unavailable" action={<Button onClick={() => void refetch()}>Retry stats</Button>}>{error.message}</Notice>
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} role="group" aria-label="Payout account statistics" aria-busy={pending || undefined}>
      <Stat
        label="Pending"
        value={stats.pending}
        note={stats.pending > 0 ? 'Awaiting review' : '—'}
        icon={<IconClock size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Approved"
        value={stats.approved}
        note={`${stats.approvalRate}% rate`}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Rejected"
        value={stats.rejected}
        note={stats.total > 0 ? `${stats.rejectionRate}%` : '—'}
        icon={<IconCircleX size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
      <Stat
        label="Approval Rate"
        value={`${stats.approvalRate}%`}
        note={`${stats.approved} of ${stats.total}`}
        icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}
