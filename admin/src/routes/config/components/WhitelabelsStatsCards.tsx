import { gql, useQuery } from '@apollo/client'
import { IconChartBar, IconCreditCard, IconLink, IconWorld } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Meter } from '@/ui/components/Meter'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  creditUsageHue,
  whitelabelStats,
  type WhitelabelStatsItem,
} from '../whitelabelsListModel'
import styles from '../WhitelabelsListPage.module.css'

const WL_QUERY = gql`
  query Whitelabels {
    whitelabels {
      id
      name
      domain
      sharingRates {
        domain
        rate
      }
      status
      creditLimit
      creditUsed
      creditAvailable
    }
  }
`

interface WhitelabelStatsData {
  whitelabels: WhitelabelStatsItem[]
}

const ICON_SIZE = 18

export function WhitelabelsStatsCards() {
  const { formatAmount } = useCurrency()
  const { data, loading } = useQuery<WhitelabelStatsData>(WL_QUERY, { errorPolicy: 'all' })
  const stats = whitelabelStats(data?.whitelabels ?? [])
  // A refetch keeps the figures on screen; only the first answer shows placeholders.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} aria-busy={pending || undefined}>
      <Stat
        label="Total Whitelabels"
        value={stats.totalWhitelabels}
        note={`${stats.activeWhitelabels} active, ${stats.inactiveWhitelabels} inactive`}
        icon={<IconWorld size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="blu"
        loading={pending}
      />
      <Stat
        label="Total Domains"
        value={stats.totalDomains}
        note={`${stats.primaryDomains} primary, ${stats.extraDomains} extra`}
        icon={<IconLink size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Credit Usage"
        value={`${stats.creditUtilization}%`}
        note={(
          <span className={styles.statNote}>
            <span>{formatAmount(stats.totalCreditUsed)} / {formatAmount(stats.totalCreditLimit)}</span>
            <Meter value={stats.creditUtilization} tone={stats.creditUtilization > 60 ? 'neg' : 'acc'} />
          </span>
        )}
        icon={<IconCreditCard size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue={creditUsageHue(stats.creditUtilization)}
        loading={pending}
      />
      <Stat
        label="Active Rate"
        value={`${stats.activeRate}%`}
        note={`${stats.activeWhitelabels} of ${stats.totalWhitelabels}`}
        icon={<IconChartBar size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="grn"
        loading={pending}
      />
    </Grid>
  )
}
