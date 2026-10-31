import { useQuery, gql } from '@apollo/client'
import {
  IconCash,
  IconClock,
  IconLink,
  IconTrendingUp,
  IconTrophy,
  IconUserPlus,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { strokeFor } from '@/ui/components/icons'
import { Stat } from '@/ui/components/Stat'
import { referralStatsFigures, type ReferralStatsData } from '../referralsOverviewModel'
import styles from '../ReferralsOverviewPage.module.css'

const REFERRAL_STATS_QUERY = gql`
  query ReferralStats($fromDate: String, $toDate: String) {
    referralStats(fromDate: $fromDate, toDate: $toDate) {
      totalClicks
      totalSignups
      totalAttributions
      totalEarnings
      totalSettled
      totalPending
      currency
      periodStart
      periodEnd
    }
  }
`

export function ReferralStatsCards({ dateRange }: { dateRange?: { from?: string; to?: string } }) {
  const { formatAmount } = useCurrency()
  const { data, loading } = useQuery(REFERRAL_STATS_QUERY, {
    variables: { fromDate: dateRange?.from, toDate: dateRange?.to },
    errorPolicy: 'all',
  })

  const figures = referralStatsFigures(data?.referralStats as ReferralStatsData | undefined)
  const pending = loading && !data

  // Legacy tile colours on the decorative ramp: blue, green, grey (indigo: the kit Stat has no grey),
  // blue, green, red.
  return (
    <div className={styles.stats} role="group" aria-label="Referral statistics" aria-busy={pending || undefined}>
      <Stat
        label="Total Clicks"
        value={figures.clicks}
        icon={<IconLink size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
      <Stat
        label="Total Signups"
        value={figures.signups}
        icon={<IconUserPlus size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Total Earnings"
        value={formatAmount(figures.earnings, figures.currency)}
        icon={<IconCash size={18} stroke={strokeFor(18)} />}
        hue="ind"
        loading={pending}
      />
      <Stat
        label="Total Settled"
        value={formatAmount(figures.settled, figures.currency)}
        icon={<IconTrophy size={18} stroke={strokeFor(18)} />}
        hue="blu"
        loading={pending}
      />
      <Stat
        label="Conversion Rate"
        value={`${figures.conversionRate}%`}
        icon={<IconTrendingUp size={18} stroke={strokeFor(18)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Pending"
        value={formatAmount(figures.pending, figures.currency)}
        icon={<IconClock size={18} stroke={strokeFor(18)} />}
        hue="red"
        loading={pending}
      />
    </div>
  )
}
