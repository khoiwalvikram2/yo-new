import React from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  IconAlertCircle,
  IconArrowRight,
  IconBuildingStore,
  IconChartLine,
  IconInbox,
  IconPercentage,
  IconPlug,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { PROVIDERS_WITH_VENDORS, PROVIDER_ANALYTICS, UPDATE_CASINO_PROVIDER } from '@/lib/graphql/casino'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { ProviderWithVendors } from '@/modules/casino/types'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { toast } from '@/ui/components/toast'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  MESSAGE_DURATION_MS,
  PROVIDER_COMPARATORS,
  PROVIDER_STATUS_ERROR,
  ggrTrend,
  legacySortCycle,
  normaliseProviderStatus,
  providerCountLabel,
  providerPerformance,
  providerStatusLabel,
  providerStatusMessage,
  providerStatusOptions,
  statusUpdateVariables,
  sumTransactions,
  toProviderRows,
  vendorsSummary,
  withProviderStatus,
  type ProviderRow,
  type Trend,
  type VendorBreakdownEntry,
} from '../providersPageModel'
import styles from '../ProvidersPage.module.css'

/* Neutral keeps the plain dot (the --ink-3 ground of .dot). */
const DOT_CLASS: Record<Trend, string | undefined> = {
  up: styles.dotUp,
  down: styles.dotDown,
  neutral: undefined,
}

/**
 * Today's figure with its coloured dot (the sign of the GGR; the amount carries the sign in text). Shared with the
 * vendors table. Its legacy "N% vs yesterday" line was today's figure divided by a constant, not a comparison, and
 * no previous day is queried, so it is gone rather than kept.
 */
export function TodayFigure({
  amount,
  trend,
  children,
}: {
  amount: string
  trend: Trend
  children?: React.ReactNode
}) {
  return (
    <div className={styles.figureCell}>
      <span className={styles.figureLine}>
        <span className={clsx(styles.dot, DOT_CLASS[trend])} aria-hidden="true" />
        <span className={styles.figure}>{amount}</span>
      </span>
      {children}
    </div>
  )
}

const ProviderAnalyticsCell: React.FC<{ providerId: string }> = ({ providerId }) => {
  const today = React.useMemo(() => new Date(), [])
  const start = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const end = today.toISOString()
  const { data, loading } = useQuery(PROVIDER_ANALYTICS, {
    variables: { providerId, start, end },
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
  })
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const analytics = data?.providerAnalytics
  const totalGGR = Number(analytics?.totalGGR ?? 0)
  const vendorBreakdown: VendorBreakdownEntry[] = analytics?.vendorBreakdown ?? []
  const formattedGGR = formatAmount(convertFromWhitelabelCurrency(Number(totalGGR)))

  if (loading) {
    return <span className={styles.figureCell}>Loading…</span>
  }

  return (
    <TodayFigure amount={formattedGGR} trend={ggrTrend(totalGGR)}>
      <span>Vendors: {vendorBreakdown.length} active</span>
      <span>Txns: {sumTransactions(vendorBreakdown)}</span>
    </TodayFigure>
  )
}

const VendorsSummaryCell: React.FC<{ vendors: Array<{ id: string; name: string }> }> = ({ vendors }) => {
  const { countLabel, top, remaining } = vendorsSummary(vendors)

  return (
    <div className={styles.figureCell}>
      <span className={styles.figure}>{countLabel}</span>
      {top.length > 0 && (
        <ul className={styles.miniList}>
          {top.map((v) => (
            <li key={v.id} className={styles.miniItem}>
              <span className={styles.miniIcon} aria-hidden="true">
                <IconBuildingStore size={11} stroke={strokeFor(11)} />
              </span>
              <span className={styles.truncate} title={v.name}>{v.name}</span>
            </li>
          ))}
          {remaining > 0 && <li className={styles.more}>+{remaining} more</li>}
        </ul>
      )}
      {top.length === 0 && <span>No vendors</span>}
    </div>
  )
}

const ProviderPerformanceCell: React.FC<{ providerId: string }> = ({ providerId }) => {
  const { data: providersData } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderWithVendors[] = providersData?.providersWithVendors ?? []
  const provider = providers.find((p) => p.id === providerId)
  const { totalGames, activeGames, vendorCount } = providerPerformance(provider)

  return (
    <div className={styles.figureCell}>
      <span className={styles.figureLine}>
        <span className={clsx(styles.dot, styles.dotUp)} aria-hidden="true" />
        <span className={styles.figure}>{vendorCount}</span>
      </span>
      <span>Vendors: {vendorCount}</span>
      <span>Games: {totalGames}</span>
      <span>Active: {activeGames}</span>
    </div>
  )
}

/* The provider's name opens its vendors (the legacy name button), over its key. */
function ProviderNameCell({ row, onNavigateToVendors }: { row: ProviderRow; onNavigateToVendors: () => void }) {
  return (
    <div className={styles.entity}>
      <span className={clsx(styles.tile, styles.tileProvider)} aria-hidden="true">
        <IconPlug size={16} stroke={strokeFor(16)} />
      </span>
      <div className={styles.entityBody}>
        <button
          type="button"
          className={styles.nameButton}
          onClick={(e) => {
            e.stopPropagation()
            onNavigateToVendors()
          }}
        >
          <span className={styles.nameText}>{row.name || row.key}</span>
          <span className={styles.nameArrow} aria-hidden="true">
            <IconArrowRight size={12} stroke={strokeFor(12)} />
          </span>
        </button>
        <span className={styles.entitySub}>{row.key}</span>
      </div>
    </div>
  )
}

/* The status select with its optimistic update, cache write and toasts, moved verbatim from the legacy row.
   Its state lives per row, so a re-sort keeps each provider's pending status. The provider record is the
   platform catalogue every whitelabel shares, and the server lets only the platform administrator change it,
   so anyone else reads the status instead of being offered a select that writes it for every whitelabel. */
function ProviderStatusCell({ row }: { row: ProviderRow }) {
  const { formatDateTime } = useFormatDate()
  const permissions = useAuthStore((state) => state.permissions)
  const canEdit = hasPermissionWithNested(permissions ?? [], 'all', '*')
  const [localStatus, setLocalStatus] = React.useState<string>(normaliseProviderStatus(row.status))
  const [updateProvider, { loading: updating }] = useMutation(UPDATE_CASINO_PROVIDER, {
    refetchQueries: [{ query: PROVIDERS_WITH_VENDORS }],
    awaitRefetchQueries: true,
  })

  // Sync local status with row status when it changes from parent
  React.useEffect(() => {
    setLocalStatus(normaliseProviderStatus(row.status))
  }, [row.status])

  const handleStatusChange = async (newStatus: string) => {
    // Optimistically update UI immediately
    setLocalStatus(newStatus)

    try {
      await updateProvider({
        variables: statusUpdateVariables(row.id, newStatus),
        update: (cache) => {
          // Update cache immediately for instant UI feedback
          try {
            const existingData = cache.readQuery<{ providersWithVendors: ProviderWithVendors[] }>({
              query: PROVIDERS_WITH_VENDORS,
            })
            if (existingData) {
              cache.writeQuery({
                query: PROVIDERS_WITH_VENDORS,
                data: {
                  providersWithVendors: withProviderStatus(existingData.providersWithVendors, row.id, newStatus),
                },
              })
            }
          } catch {
            // Ignore cache errors
          }
        },
      })

      toast({ message: providerStatusMessage(row.name, newStatus), tone: 'ok', duration: MESSAGE_DURATION_MS })
    } catch (err) {
      // Revert optimistic update on error
      setLocalStatus(normaliseProviderStatus(row.status))
      toast({
        message: (err as { message?: string } | null | undefined)?.message || PROVIDER_STATUS_ERROR,
        tone: 'error',
        duration: MESSAGE_DURATION_MS,
      })
    }
  }

  return (
    <div className={styles.statusCell}>
      {canEdit ? (
        <Select
          label={`Status of ${row.name || row.key}`}
          hideLabel
          size="sm"
          value={localStatus}
          options={providerStatusOptions(localStatus)}
          onChange={(value) => void handleStatusChange(value)}
          loading={updating}
        />
      ) : (
        <span>
          <StatusPill status={localStatus}>{providerStatusLabel(localStatus)}</StatusPill>
        </span>
      )}
      <div className={styles.syncNote}>
        {row.lastSyncAt ? (
          <>
            <span>Last sync:</span>
            <span className={styles.syncTime}>{formatDateTime(row.lastSyncAt)}</span>
          </>
        ) : (
          <span>Never synced</span>
        )}
      </div>
    </div>
  )
}

export const ProvidersDashboard: React.FC<{
  onManageShares: (provider: ProviderWithVendors) => void
  onViewAnalytics: (provider: ProviderWithVendors) => void
  onNavigateToVendors: (provider: ProviderWithVendors) => void
}> = ({ onManageShares, onViewAnalytics, onNavigateToVendors }) => {
  const { data, loading, error } = useQuery(PROVIDERS_WITH_VENDORS, { errorPolicy: 'all', fetchPolicy: 'cache-and-network' })
  const providers: ProviderWithVendors[] = React.useMemo(() => data?.providersWithVendors ?? [], [data])

  // No sort until a header is pressed; then ascending, flipping on each press (legacy).
  const [sort, setSort] = React.useState<DataTableSort | null>(null)

  const rows = React.useMemo(() => toProviderRows(providers), [providers])
  const providerOf = (row: ProviderRow) => providers.find((p) => p.id === row.id)

  const columns: DataTableColumn<ProviderRow>[] = [
    {
      key: 'name',
      header: 'Provider Details',
      sort: PROVIDER_COMPARATORS.name,
      cell: (row) => (
        <ProviderNameCell
          row={row}
          onNavigateToVendors={() => {
            const provider = providerOf(row)
            if (provider) onNavigateToVendors(provider)
          }}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status & Sync',
      sort: PROVIDER_COMPARATORS.status,
      cell: (row) => <ProviderStatusCell row={row} />,
    },
    {
      key: 'vendorCount',
      header: 'Vendors & Games',
      sort: PROVIDER_COMPARATORS.vendorCount,
      cell: (row) => <VendorsSummaryCell vendors={row.vendors} />,
    },
    {
      key: 'revenue',
      header: "Today's Revenue",
      cell: (row) => <ProviderAnalyticsCell providerId={row.id} />,
    },
    {
      key: 'performance',
      header: 'Performance',
      cell: (row) => <ProviderPerformanceCell providerId={row.id} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (row) => {
        const name = row.name || row.key
        return (
          <div className={styles.rowActions}>
            <Tooltip content="Manage Vendor Shares">
              <IconButton
                size="sm"
                label={`Manage Vendor Shares for ${name}`}
                icon={<IconPercentage size={15} stroke={strokeFor(15)} />}
                onClick={() => {
                  const provider = providerOf(row)
                  if (provider) onManageShares(provider)
                }}
              />
            </Tooltip>
            <Tooltip content="View Analytics">
              <IconButton
                size="sm"
                label={`View Analytics for ${name}`}
                icon={<IconChartLine size={15} stroke={strokeFor(15)} />}
                onClick={() => {
                  const provider = providerOf(row)
                  if (provider) onViewAnalytics(provider)
                }}
              />
            </Tooltip>
          </div>
        )
      },
    },
  ]

  return (
    <Card title="Providers" sub={providerCountLabel(rows.length)} body="table">
      {error && (
        <div className={styles.cardNotice}>
          <Notice
            tone="error"
            live="assertive"
            icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
            title="Failed to load providers"
          >
            {String(error.message || '')}
          </Notice>
        </div>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        label="Providers"
        state={loading ? 'loading' : 'ready'}
        width="wide"
        sort={sort}
        onSortChange={(next) => setSort((current) => legacySortCycle(current, next))}
        empty={<EmptyState title="No providers found" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />}
      />
    </Card>
  )
}
