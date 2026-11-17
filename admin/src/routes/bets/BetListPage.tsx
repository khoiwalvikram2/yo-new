import { useState, useMemo, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useApolloClient } from '@apollo/client'
import { IconRefresh } from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { todayISTString } from '@/shared/utils/date'
import { BETS_PAGE_QUERY } from '@/lib/graphql/bets'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { usePaymentWhitelabelScope } from '@/routes/payments/usePaymentWhitelabelScope'
import { SELECT_WHITELABEL_TITLE } from '@/routes/payments/paymentWhitelabelScope'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { BetListStatsCards } from './components/BetListStatsCards'
import { BetListFiltersBar } from './components/BetListFiltersBar'
import { BetListTable } from './components/BetListTable'
import { exportBetListToExcel } from './utils/exportBetList'
import {
  BETS_EXPORT_BATCH,
  BET_PAGE_SIZE_OPTIONS,
  betExportCompleteMessage,
  betListStateFromSearch,
  betsPageNumber,
  buildBetsFiltersPayload,
  clampBetsOffset,
  isLastBetExportBatch,
  normalizeBetPageItems,
  type BetDomain,
  type BetsPageFilters,
  type RawBetItem,
} from './betListModel'
import styles from './BetListPage.module.css'

export type { BetDomain, BetsPageFilters }

// Sports, casino or matka bet viewing is enough (requireAny); agents pass on their own scoping.
const BET_LIST_ACCESS = [
  { domain: 'sports.bets', actions: ['view'] },
  { domain: 'casino.bets', actions: ['view'] },
  { domain: 'matka.bets', actions: ['view'] },
]

// antd's notification stayed 4.5 seconds; the kit toast keeps that timing.
const NOTIFICATION_DURATION_MS = 4500

const SELECT_WHITELABEL_FOR_BETS =
  'Bets belong to one whitelabel. Switch to Whitelabel mode in the top bar and select the site whose bets you want to see.'

export default function BetListPage() {
  // A link with other filters (an alert, the global search) opens a fresh list even from the Bet List itself.
  const { search } = useLocation()
  // Bets belong to one whitelabel; a Super Admin with none selected read the platform's own tenant, which
  // holds no bets, and saw every count at 0 as if the platform had none. No list query starts then.
  const { selectionRequired } = usePaymentWhitelabelScope()
  return (
    <RBACGuard required={BET_LIST_ACCESS} requireAny bypassForAgents>
      {selectionRequired ? <SelectWhitelabelNotice /> : <BetListContent key={search} search={search} />}
    </RBACGuard>
  )
}

function SelectWhitelabelNotice() {
  const pageEyebrow = usePageEyebrow()
  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title="Bet List" sub="View and filter all bets across Sports, Casino, Matka" />
      <Notice tone="info" title={SELECT_WHITELABEL_TITLE}>{SELECT_WHITELABEL_FOR_BETS}</Notice>
    </Page>
  )
}

function BetListContent({ search }: { search: string }) {
  const agent = useAuthStore((s) => s.agent)
  const pageEyebrow = usePageEyebrow()
  // The URL sets the opening filters; a plain /bets opens on Today across every domain, as before.
  const [initial] = useState(() => betListStateFromSearch(new URLSearchParams(search), todayISTString()))
  const [domain, setDomain] = useState<BetDomain>(initial.domain)
  const [filters, setFilters] = useState<BetsPageFilters>(initial.filters)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)
  const [exportLoading, setExportLoading] = useState(false)
  const page = betsPageNumber(offset, limit)
  const isAgent = !!agent

  const filtersPayload = useMemo(() => buildBetsFiltersPayload(filters), [filters])

  // Reset to first page when domain or filters change so we don't show empty results
  useEffect(() => {
    setOffset(0)
  }, [domain, filters])

  const variables = useMemo(
    () => ({
      domain,
      filters: filtersPayload,
      offset,
      limit,
    }),
    [domain, filtersPayload, offset, limit]
  )

  const client = useApolloClient()
  const { data, loading, error, refetch } = useQuery(BETS_PAGE_QUERY, {
    variables,
    fetchPolicy: 'cache-and-network',
  })

  const handleRefresh = useCallback(() => {
    void refetch()
    void client.refetchQueries({ include: ['BetsPageTotals'] })
  }, [refetch, client])

  useEffect(() => {
    if (error) {
      toast({
        title: 'Bet List Error',
        message: error.message,
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    }
  }, [error])

  const pageData = data?.betsPage ?? { items: [], total: 0 }
  const rawItems: RawBetItem[] = pageData.items ?? []
  const items = normalizeBetPageItems(rawItems)
  // While a page is loading, keep the last known total so the pagination controls
  // don't flicker to 0 and the offset-clamp effect doesn't snap back to page 1.
  const total = pageData.total ?? 0
  const [committedTotal, setCommittedTotal] = useState(0)
  useEffect(() => {
    // Only advance committedTotal once we have a real response (not mid-flight).
    if (!loading && data?.betsPage != null) {
      setCommittedTotal(total)
    }
  }, [loading, data, total])
  const displayTotal = committedTotal

  // If total shrinks (refresh/filter change) or page size changes, clamp offset to valid range.
  // Guard: only run when data has settled (not while fetching the new page).
  useEffect(() => {
    if (limit <= 0 || loading || data?.betsPage == null) return
    const clamped = clampBetsOffset(offset, total, limit)
    if (clamped !== null) setOffset(clamped)
  }, [total, limit, offset, loading, data])

  const handleExportAll = useCallback(async () => {
    if (total === 0) {
      toast({
        title: 'No Data',
        message: 'There are no bets to export for the current filters.',
        tone: 'warn',
        duration: NOTIFICATION_DURATION_MS,
      })
      return
    }
    setExportLoading(true)
    try {
      const allRaw: RawBetItem[] = []
      let reportedTotal = 0
      let fetchOffset = 0
      while (true) {
        const { data: exportData } = await client.query({
          query: BETS_PAGE_QUERY,
          variables: {
            domain,
            filters: filtersPayload,
            offset: fetchOffset,
            limit: BETS_EXPORT_BATCH,
          },
          fetchPolicy: 'network-only',
        })
        const page = exportData?.betsPage
        if (!page) break
        reportedTotal = page.total ?? 0
        const batch: RawBetItem[] = page.items ?? []
        allRaw.push(...batch)
        if (isLastBetExportBatch(allRaw.length, reportedTotal, batch.length)) {
          break
        }
        fetchOffset += BETS_EXPORT_BATCH
      }
      const exportItems = normalizeBetPageItems(allRaw)
      await exportBetListToExcel(exportItems, reportedTotal)
      toast({
        title: 'Export Complete',
        message: betExportCompleteMessage(exportItems.length),
        tone: 'ok',
        duration: NOTIFICATION_DURATION_MS,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong during export.'
      toast({ title: 'Export Failed', message, tone: 'error', duration: NOTIFICATION_DURATION_MS })
    } finally {
      setExportLoading(false)
    }
  }, [client, domain, filtersPayload, total])

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Bet List"
        sub="View and filter all bets across Sports, Casino, Matka"
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            loading={loading}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <BetListStatsCards filters={filtersPayload} domain={domain} />

        <BetListFiltersBar
          domain={domain}
          filters={filters}
          initialDatePreset={initial.datePreset}
          onDomainChange={setDomain}
          onFiltersChange={setFilters}
          onClear={() => setFilters({ dateFrom: todayISTString(), dateTo: todayISTString() })}
          isAgent={isAgent}
          agentId={agent?.id}
        />

        <BetListTable
          items={items}
          total={displayTotal}
          loading={loading}
          error={error?.message}
          onRetry={handleRefresh}
          exportLoading={exportLoading}
          onExportAll={handleExportAll}
          footer={(
            <Pagination loading={loading}
              current={page}
              pageSize={limit}
              total={displayTotal}
              onChange={(p) => setOffset((p - 1) * limit)}
              onPageSizeChange={(size) => {
                setLimit(size)
                setOffset(0)
              }}
              itemName="bets"
              pageSizeOptions={BET_PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          )}
        />
      </div>
    </Page>
  )
}
