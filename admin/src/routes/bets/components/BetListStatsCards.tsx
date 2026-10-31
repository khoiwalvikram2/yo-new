import { useMemo } from 'react'
import { useQuery, gql } from '@apollo/client'
import { IconChartLine, IconCoins, IconLayoutGrid, IconList, IconTrophy } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import type { BetDomain, BetsPageFilters } from '@/lib/graphql/bets'
import { strokeFor } from '@/ui/components/icons'
import { Stat } from '@/ui/components/Stat'
import { betHeadline, betHeadlineLabels, type BetsPageTotals } from '../betListModel'
import styles from '../BetListPage.module.css'

const BETS_PAGE_TOTALS_QUERY = gql`
  query BetsPageTotals($filters: BetsPageFilters) {
    betsPageTotals(filters: $filters) {
      totalAll
      totalSports
      totalCasino
      totalMatka
      totalStake
      totalStakeSports
      totalStakeCasino
      totalStakeMatka
    }
  }
`

export type BetListStatsCardsProps = {
  /** Same payload as `betsPage` — stats match the filter bar + table. */
  filters: BetsPageFilters
  /** Domain dropdown: headline count + stake match the table scope. */
  domain: BetDomain
}

export function BetListStatsCards({ filters, domain }: BetListStatsCardsProps) {
  const { formatAmount } = useCurrency()
  const variables = useMemo(() => ({ filters }), [filters])
  const { data, loading } = useQuery(BETS_PAGE_TOTALS_QUERY, {
    variables,
    fetchPolicy: 'cache-and-network',
  })

  const totalsData: BetsPageTotals | undefined = data?.betsPageTotals
  const headline = betHeadline(totalsData, domain)
  const labels = betHeadlineLabels(domain)
  // A refetch keeps the figures on screen; only the first answer for these filters shows placeholders.
  const pending = loading && !data

  return (
    <div className={styles.statsFrame}>
      <div className={styles.stats} role="group" aria-label="Bet statistics" aria-busy={pending || undefined}>
        <Stat
          label={labels.count}
          value={headline.count.toLocaleString()}
          icon={<IconList size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={pending}
        />
        <Stat
          label="Sports"
          value={(totalsData?.totalSports ?? 0).toLocaleString()}
          icon={<IconTrophy size={18} stroke={strokeFor(18)} />}
          hue="grn"
          loading={pending}
        />
        <Stat
          label="Casino"
          value={(totalsData?.totalCasino ?? 0).toLocaleString()}
          icon={<IconLayoutGrid size={18} stroke={strokeFor(18)} />}
          hue="red"
          loading={pending}
        />
        <Stat
          label="Matka"
          value={(totalsData?.totalMatka ?? 0).toLocaleString()}
          icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
          hue="ind"
          loading={pending}
        />
        <Stat
          className={styles.stakeStat}
          label={labels.stake}
          value={formatAmount(headline.stake)}
          icon={<IconCoins size={18} stroke={strokeFor(18)} />}
          hue="vio"
          loading={pending}
        />
      </div>
    </div>
  )
}
