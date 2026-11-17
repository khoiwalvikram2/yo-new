import React from 'react'
import { useQuery } from '@apollo/client'
import { IconAlertCircle, IconBuildingStore, IconChartLine, IconInbox, IconPlug } from '@tabler/icons-react'
import clsx from 'clsx'
import { PROVIDERS_WITH_VENDORS, PROVIDERS_ANALYTICS, VENDOR_ANALYTICS } from '@/lib/graphql/casino'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useCasinoScopeStore } from '@/state/casinoScopeStore'
import { startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { ProviderWithVendors } from '@/modules/casino/types'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  EMPTY_VENDOR_ANALYTICS,
  VENDOR_COMPARATORS,
  analyticsProviderIds,
  avgBet,
  gamesLabel,
  ggrTrend,
  legacySortCycle,
  toVendorRows,
  vendorAnalyticsKey,
  vendorAnalyticsMap,
  vendorRowKey,
  vendorStatsFor,
  vendorsCardSub,
  vendorsEmptyText,
  type ProviderAnalyticsEntry,
  type VendorAnalyticsData,
  type VendorRow,
} from '../providersPageModel'
import styles from '../ProvidersPage.module.css'
import { TodayFigure } from './ProvidersDashboard'

/* The per-vendor analytics query is skipped whenever the table passes the vendor's figures, which it always
   does (a vendor missing from the batch gets zeros), so only the batched PROVIDERS_ANALYTICS query runs.
   Both are kept as they were. */
const VendorAnalyticsCell: React.FC<{
  vendorId: string
  providerId: string
  analytics?: VendorAnalyticsData | null
}> = ({ vendorId, providerId, analytics: analyticsFromProps }) => {
  const today = React.useMemo(() => new Date(), [])
  const start = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const end = today.toISOString()
  const { data, loading } = useQuery(VENDOR_ANALYTICS, {
    variables: { vendorId, providerId, start, end },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    skip: analyticsFromProps !== undefined,
  })
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const analytics: VendorAnalyticsData | null | undefined = analyticsFromProps ?? data?.vendorAnalytics
  const ggr = analytics?.ggr ?? 0
  const shareAmount = analytics?.shareAmount ?? 0
  const transactionCount = analytics?.transactionCount ?? 0
  const formattedGgr = formatAmount(convertFromWhitelabelCurrency(Number(ggr)))
  const formattedShare = formatAmount(convertFromWhitelabelCurrency(Number(shareAmount)))

  if (analyticsFromProps === undefined && loading) {
    return <span className={styles.figureCell}>Loading…</span>
  }

  return (
    <TodayFigure amount={formattedGgr} trend={ggrTrend(ggr)}>
      <span>Share: {formattedShare}</span>
      <span>Txns: {transactionCount.toLocaleString()}</span>
    </TodayFigure>
  )
}

const VendorGamesCell: React.FC<{ vendorId: string; providerId: string }> = ({ vendorId, providerId }) => {
  const { data: providersData } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderWithVendors[] = React.useMemo(() => providersData?.providersWithVendors ?? [], [providersData])

  // Find vendor stats from provider data
  const vendorStats = React.useMemo(
    () => vendorStatsFor(providers, providerId, vendorId),
    [providers, vendorId, providerId],
  )

  const gamesCount = vendorStats?.totalGames ?? 0
  const activeGames = vendorStats?.activeGames ?? 0

  return (
    <div className={styles.figureCell}>
      <span className={styles.figure}>{gamesLabel(gamesCount)}</span>
      <span>Active: {activeGames}</span>
    </div>
  )
}

const VendorPerformanceCell: React.FC<{
  vendorId: string
  providerId: string
  analytics?: VendorAnalyticsData | null
}> = ({ vendorId, providerId, analytics: analyticsFromProps }) => {
  const today = React.useMemo(() => new Date(), [])
  const start = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const end = today.toISOString()
  const { data, loading } = useQuery(VENDOR_ANALYTICS, {
    variables: { vendorId, providerId, start, end },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    skip: analyticsFromProps !== undefined,
  })
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const analytics: VendorAnalyticsData | null | undefined = analyticsFromProps ?? data?.vendorAnalytics
  const transactionCount = analytics?.transactionCount ?? 0
  // Stake per settled bet; not shown when the figures came without the stakes.
  const average = avgBet(analytics?.totalStake, transactionCount)

  if (analyticsFromProps === undefined && loading) {
    return <span className={styles.figureCell}>Loading…</span>
  }

  return (
    <div className={styles.figureCell}>
      <span className={styles.figureLine}>
        <span className={clsx(styles.dot, styles.dotInfo)} aria-hidden="true" />
        <span className={styles.figure}>{transactionCount}</span>
      </span>
      <span>Txns: {transactionCount}</span>
      {average != null && average > 0 && <span>Avg: {formatAmount(convertFromWhitelabelCurrency(average))}</span>}
    </div>
  )
}

function VendorNameCell({ row }: { row: VendorRow }) {
  return (
    <div className={styles.entity}>
      <span className={clsx(styles.tile, styles.tileVendor)} aria-hidden="true">
        <IconBuildingStore size={16} stroke={strokeFor(16)} />
      </span>
      <div className={styles.entityBody}>
        <span className={styles.entityName} title={row.name}>{row.name}</span>
        <span className={styles.entitySub}>{row.slug}</span>
      </div>
    </div>
  )
}

/* The provider over the legacy "Integration active" note (static copy, not a health check). */
function VendorProviderCell({ row }: { row: VendorRow }) {
  return (
    <div className={styles.figureCell}>
      <span className={styles.figure}>{row.providerName}</span>
      <span className={styles.figureLine}>
        <span className={styles.plugIcon} aria-hidden="true">
          <IconPlug size={11} stroke={strokeFor(11)} />
        </span>
        <span>Integration active</span>
      </span>
    </div>
  )
}

export const VendorsDashboard: React.FC<{
  onViewAnalytics: (vendorId: string, providerId: string, vendorName: string) => void
}> = ({ onViewAnalytics }) => {
  const { selectedProviderId } = useCasinoScopeStore()
  const { data, loading, error } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderWithVendors[] = React.useMemo(() => data?.providersWithVendors ?? [], [data])

  // No sort until a header is pressed; then ascending, flipping on each press (legacy).
  const [sort, setSort] = React.useState<DataTableSort | null>(null)

  // Filter vendors by selected provider
  const baseVendors: VendorRow[] = React.useMemo(
    () => toVendorRows(providers, selectedProviderId),
    [providers, selectedProviderId],
  )

  const providerIdsForAnalytics = React.useMemo(() => analyticsProviderIds(baseVendors), [baseVendors])
  const today = React.useMemo(() => new Date(), [])
  const analyticsStart = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const analyticsEnd = today.toISOString()
  const { data: analyticsData } = useQuery(PROVIDERS_ANALYTICS, {
    variables: { providerIds: providerIdsForAnalytics, start: analyticsStart, end: analyticsEnd },
    skip: providerIdsForAnalytics.length === 0,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const analyticsMap = React.useMemo(
    () => vendorAnalyticsMap((analyticsData?.providersAnalytics ?? []) as ProviderAnalyticsEntry[]),
    [analyticsData],
  )

  const selectedProvider = providers.find((p) => p.id === selectedProviderId)
  const analyticsFor = (row: VendorRow) =>
    analyticsMap.get(vendorAnalyticsKey(row.providerId, row.id)) ?? EMPTY_VENDOR_ANALYTICS

  const columns: DataTableColumn<VendorRow>[] = [
    {
      key: 'name',
      header: 'Vendor Details',
      sort: VENDOR_COMPARATORS.name,
      cell: (row) => <VendorNameCell row={row} />,
    },
    {
      key: 'providerName',
      header: 'Provider',
      sort: VENDOR_COMPARATORS.providerName,
      cell: (row) => <VendorProviderCell row={row} />,
    },
    {
      key: 'games',
      header: 'Games & Content',
      cell: (row) => <VendorGamesCell vendorId={row.id} providerId={row.providerId} />,
    },
    {
      key: 'revenue',
      header: "Today's Revenue",
      cell: (row) => <VendorAnalyticsCell vendorId={row.id} providerId={row.providerId} analytics={analyticsFor(row)} />,
    },
    {
      key: 'performance',
      header: 'Performance',
      cell: (row) => <VendorPerformanceCell vendorId={row.id} providerId={row.providerId} analytics={analyticsFor(row)} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (row) => (
        <div className={styles.rowActions}>
          <Tooltip content="View Analytics">
            <IconButton
              size="sm"
              label={`View Analytics for ${row.name}`}
              icon={<IconChartLine size={15} stroke={strokeFor(15)} />}
              onClick={() => onViewAnalytics(row.id, row.providerId, row.name)}
            />
          </Tooltip>
        </div>
      ),
    },
  ]

  return (
    <Card
      title="Vendors"
      sub={vendorsCardSub(baseVendors.length, selectedProviderId, selectedProvider?.name)}
      body="table"
    >
      {error && (
        <div className={styles.cardNotice}>
          <Notice
            tone="error"
            live="assertive"
            icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
            title="Failed to load vendors"
          >
            {String(error.message || '')}
          </Notice>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={baseVendors}
        rowKey={vendorRowKey}
        label="Vendors"
        state={loading ? 'loading' : 'ready'}
        width="wide"
        sort={sort}
        onSortChange={(next) => setSort((current) => legacySortCycle(current, next))}
        empty={(
          <EmptyState
            title={vendorsEmptyText(selectedProviderId)}
            icon={<IconInbox size={20} stroke={strokeFor(20)} />}
          />
        )}
      />
    </Card>
  )
}
