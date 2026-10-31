import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useApolloClient } from '@apollo/client'
import {
  IconAlertTriangle,
  IconBolt,
  IconClock,
  IconFlame,
  IconLayoutGrid,
  IconLayoutList,
  IconPlayerPlay,
  IconRefresh,
  IconStar,
  IconTable,
  IconTicket,
} from '@tabler/icons-react'
import { useWorliFilters } from '@/state/matkaWorli'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Card } from '@/ui/components/Card'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl'
import { Stat } from '@/ui/components/Stat'
import { Switch } from '@/ui/components/Switch'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { FiltersBar } from './components/FiltersBar'
import { RunningMarketsTable } from './components/RunningMarketsTable'
import { RunningMarketCards } from './components/RunningMarketCards'
import { WORLI_INSTANCES, WORLI_INSTANCE_UPDATED } from './gql'
import {
  PAGE_SUB,
  PAGE_TITLE,
  QUICK_FILTERS,
  activeFilterCount,
  applyQuickFilter,
  isQuickFilter,
  loadErrorText,
  marketStats,
  toggleQuickFilter,
  type QuickFilter,
  type WorliInstance,
  type WorliInstanceUpdatedData,
  type WorliInstancesData,
} from './runningMarketsModel'
import styles from './RunningMarketsPage.module.css'

type ViewMode = 'table' | 'cards'

// The legacy tags' glyphs: fire, bolt, clock and star.
const QUICK_ICONS: Record<QuickFilter, ReactNode> = {
  live: <IconFlame size={15} stroke={strokeFor(15)} />,
  'high-exposure': <IconBolt size={15} stroke={strokeFor(15)} />,
  'locking-soon': <IconClock size={15} stroke={strokeFor(15)} />,
  paused: <IconStar size={15} stroke={strokeFor(15)} />,
}

const QUICK_OPTIONS: readonly SegmentedOption<QuickFilter | ''>[] = QUICK_FILTERS.map((filter) => ({
  ...filter,
  icon: QUICK_ICONS[filter.value],
}))

/* The legacy icon-only segments, named by their tooltips. The legacy control was antd Segmented (native
   radios: one tab stop, arrows move the choice), and it switches the card body between the table and the
   tiles, so it is the kit Tabs (one tab stop, Arrow/Home/End) with the card body as its tab panel. */
const VIEW_TABS_ID = 'worli-view'
const VIEW_TABS: readonly TabItem<ViewMode>[] = [
  { value: 'table', label: 'Table View', icon: <IconTable size={15} stroke={strokeFor(15)} /> },
  { value: 'cards', label: 'Card View', icon: <IconLayoutGrid size={15} stroke={strokeFor(15)} /> },
]

export default function RunningMarketsPage() {
  return (
    <RBACGuard required={[{ domain: 'matka.worli', actions: ['view'] }]}>
      <RunningMarketsPageContent />
    </RBACGuard>
  )
}

function RunningMarketsPageContent() {
  const navigate = useNavigate()
  const client = useApolloClient()
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { date, marketId, status, search, hasResult, sort, setSearch, setStatus, setHasResult } = useWorliFilters()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null)
  const { data, refetch, loading, error } = useQuery<WorliInstancesData>(WORLI_INSTANCES, { variables: { date, marketId, status, search, hasResult, page: 1, limit: 50, sort }, fetchPolicy: 'cache-and-network', pollInterval: autoRefresh ? 5000 : 0 })
  const [rows, setRows] = useState<WorliInstance[]>([])
  const subsRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
  const items = data?.worliRunningInstances?.items || []
    setRows(items)
  }, [data])

  // Subscribe and merge updates (imperative to avoid hooks-in-loop)
  useEffect(() => {
    const activeSubs: Array<{ id: string; unsubscribe: () => void }> = []
    for (const row of rows) {
      const id = row.id
      if (subsRef.current[id]) continue
      subsRef.current[id] = true
      const obs = client.subscribe<WorliInstanceUpdatedData>({ query: WORLI_INSTANCE_UPDATED, variables: { id } })
      const sub = obs.subscribe({
        next: ({ data: payload }) => {
          const updated = payload?.worliInstanceUpdated
          if (!updated) return
          setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
        },
        error: () => {},
      })
      activeSubs.push({ id, unsubscribe: () => sub.unsubscribe() })
    }
    return () => {
      activeSubs.forEach(s => s.unsubscribe())
    }
  }, [rows, client])

  // Client-side quick filters and search are already server-backed for search; here, apply quick-only filters
  const filteredRows = useMemo(() => applyQuickFilter(rows, quickFilter, Date.now()), [rows, quickFilter])

  // Stats
  const stats = useMemo(() => marketStats(filteredRows), [filteredRows])

  const filterCount = activeFilterCount({ search, status, hasResult, quickFilter })

  /* Clear all empties every filter the count counts (search, statuses, Has result, the quick filter). The
     date and the sort are not counted and stay. */
  const clearAll = () => {
    setSearch('')
    setStatus([])
    setHasResult(undefined)
    setQuickFilter(null)
  }

  const loadError = error ? loadErrorText(error.message) : null

  const handleRowClick = (id: string) => navigate(`/matka/worli/${id}`)
  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />

      <div className={styles.content}>
        {/* The legacy compact stats bar, over the quick-filtered sessions; its columns follow its own width. */}
        <div className={styles.statsZone}>
          <div className={styles.stats} role="group" aria-label="Market statistics">
            <Stat
              label="Open"
              value={stats.openInstances}
              icon={<IconPlayerPlay size={18} stroke={strokeFor(18)} />}
              hue="red"
            />
            <Stat
              label="Markets"
              value={stats.totalInstances.toLocaleString()}
              icon={<IconLayoutList size={18} stroke={strokeFor(18)} />}
              hue="vio"
            />
            <Stat
              label="Exposure"
              value={formatAmount(convertFromWhitelabelCurrency(stats.totalExposure / 100))}
              icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
              hue="grn"
            />
            <Stat
              label="Bets"
              value={stats.totalBets.toLocaleString()}
              icon={<IconTicket size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
          </div>
        </div>

        <FilterBar
          label="Filters"
          activeCount={filterCount}
          onClearAll={clearAll}
          search={(
            <SearchField
              label="Search markets"
              placeholder="Search markets..."
              size="sm"
              value={search || ''}
              onChange={setSearch}
            />
          )}
        >
          <FiltersBar />
        </FilterBar>

        {/* The quick filters: picking the active one turns it off again, as the legacy tags did. */}
        <div className={styles.quickScroller}>
          <SegmentedControl<QuickFilter | ''>
            label="Quick filters"
            size="sm"
            className={styles.quickControl}
            value={quickFilter ?? ''}
            options={QUICK_OPTIONS}
            onChange={(value) => {
              if (isQuickFilter(value)) setQuickFilter(toggleQuickFilter(quickFilter, value))
            }}
          />
        </div>

        <Card
          className={styles.marketsCard}
          title={PAGE_TITLE}
          body={viewMode === 'table' ? 'table' : 'padded'}
          tools={(
            <>
              <Tooltip content={autoRefresh ? 'Auto-refresh ON (every 5s)' : 'Auto-refresh OFF'}>
                <Switch label="Auto-refresh" checked={autoRefresh} onChange={setAutoRefresh} />
              </Tooltip>
              <Tooltip content="Refresh data">
                <IconButton
                  variant="bordered"
                  label="Refresh data"
                  icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
                  onClick={() => void refetch()}
                />
              </Tooltip>
              <Tabs
                label="View"
                idPrefix={VIEW_TABS_ID}
                size="sm"
                value={viewMode}
                items={VIEW_TABS}
                onChange={setViewMode}
              />
            </>
          )}
        >
          <div
            role="tabpanel"
            id={tabPanelId(VIEW_TABS_ID, viewMode)}
            aria-labelledby={tabId(VIEW_TABS_ID, viewMode)}
          >
            {viewMode === 'table' ? (
              <RunningMarketsTable
                items={filteredRows}
                loading={loading}
                error={loadError}
                onRetry={() => void refetch()}
                onView={handleRowClick}
              />
            ) : (
              <RunningMarketCards
                items={filteredRows}
                loading={loading}
                error={loadError}
                onRetry={() => void refetch()}
                onView={handleRowClick}
              />
            )}
          </div>
        </Card>
      </div>
    </Page>
  )
}

