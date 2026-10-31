import React from 'react'
import { useQuery } from '@apollo/client'
import { IconApi, IconBuildingStore, IconChartLine, IconCoin } from '@tabler/icons-react'
import { PROVIDERS_WITH_VENDORS, PROVIDER_ANALYTICS } from '@/lib/graphql/casino'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { strokeFor } from '@/ui/components/icons'
import { Stat } from '@/ui/components/Stat'
import { providerStats, statsAnalyticsVariables, type ProviderStatsInput } from '../providersPageModel'
import styles from '../ProvidersPage.module.css'

/* The four provider figures (the KPI row, M:796-850). The queries are the legacy ones, verbatim; the legacy
   Active Rate bar never rendered (DashboardStatCard draws it only when `tight` is false, and it defaults to
   true), so no Meter replaces it. */
export const ProviderStatsCards: React.FC = () => {
  const { data: providersData, loading: providersLoading } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderStatsInput[] = React.useMemo(() => providersData?.providersWithVendors ?? [], [providersData])

  const { totalProviders, activeProviders, suspendedProviders, totalVendors, activeVendors, activeRate } =
    providerStats(providers)

  const today = React.useMemo(() => new Date(), [])
  const start = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const end = today.toISOString()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const providerIds = providers.map((p) => p.id).filter(Boolean) as string[]
  const { data: analyticsData, loading: analyticsLoading } = useQuery(PROVIDER_ANALYTICS, {
    variables: statsAnalyticsVariables(providerIds, start, end),
    skip: providerIds.length === 0,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })

  // Today's GGR is the first provider's only (legacy; listed for the owner, not changed here).
  const totalGgr = analyticsData?.providerAnalytics?.totalGGR ?? 0
  const formattedGgr = formatAmount(convertFromWhitelabelCurrency(Number(totalGgr)))

  // The GGR waits on both queries (the analytics one starts once the providers answer); the rest on the providers.
  const providersPending = providersLoading && !providersData
  const ggrPending = providersPending || (analyticsLoading && !analyticsData)

  return (
    <div className={styles.statsWrap}>
      <div className={styles.stats} role="group" aria-label="Provider statistics" aria-busy={ggrPending || undefined}>
        <Stat
          label="Total Providers"
          value={totalProviders}
          note={`${activeProviders} active, ${suspendedProviders} suspended`}
          icon={<IconApi size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={providersPending}
        />
        <Stat
          label="Vendors"
          value={totalVendors}
          note={`${activeVendors} with active games`}
          icon={<IconBuildingStore size={18} stroke={strokeFor(18)} />}
          hue="vio"
          loading={providersPending}
        />
        <Stat
          label="Today's GGR"
          value={formattedGgr}
          note={`${totalProviders} providers`}
          icon={<IconCoin size={18} stroke={strokeFor(18)} />}
          hue="grn"
          loading={ggrPending}
        />
        <Stat
          label="Active Rate"
          value={`${activeRate}%`}
          note={`${activeProviders} of ${totalProviders}`}
          icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
          hue="blu"
          loading={providersPending}
        />
      </div>
    </div>
  )
}

