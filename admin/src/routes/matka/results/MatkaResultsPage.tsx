import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCoin, IconPlus } from '@tabler/icons-react'
import { useMatkaResults, useMatkaResultEvents } from '../../../modules/matka/results'
import { useMatkas } from '../../../modules/matka'
import { ResultsTable } from './components/ResultsTable'
import { FiltersBar } from './components/FiltersBar'
import { StatsCards } from './components/StatsCards'
import { DeclareResultDrawer } from './components/DeclareResultDrawer'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { strokeFor } from '@/ui/components/icons'
import type { MatkaResultFilters, MatkaResult } from '../../../modules/matka/results'
import {
  MATKA_RESULT_PAGE_SIZES,
  buildMatkaResultsVariables,
  defaultMatkaResultFilters,
  matkaOptionsFrom,
  pendingBetsAcross,
  pendingBetsDescription,
  pendingBetsTitle,
  summarizePendingBets,
} from './matkaResultsModel'
import styles from './MatkaResultsPage.module.css'

export default function MatkaResultsPage() {
  return (
    <RBACGuard required={[{ domain: 'matka.results', actions: ['view', 'create', 'rollback'] }]}>
      <MatkaResultsPageContent />
    </RBACGuard>
  )
}

function MatkaResultsPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filters, setFilters] = useState<MatkaResultFilters>(defaultMatkaResultFilters)
  const declareTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Subscribe to real-time events
  const { data: eventsData } = useMatkaResultEvents()

  // Memoize query variables
  const queryVariables = useMemo(() => buildMatkaResultsVariables(filters), [filters])

  const { data, loading, error, refetch } = useMatkaResults(queryVariables)
  const { data: matkasData } = useMatkas({ page: 1, limit: 1000 })
  const matkas = useMemo(() => matkaOptionsFrom(matkasData?.matkas?.items), [matkasData])

  // Auto-refresh table when events occur
  useEffect(() => {
    if (eventsData?.data?.matkaResultEvents) {
      refetch()
    }
  }, [eventsData, refetch])

  const results: MatkaResult[] = useMemo(() => data?.matkaResults?.items || [], [data])
  const total = data?.matkaResults?.total || 0

  // Calculate pending bets summary
  const pendingBetsSummary = useMemo(() => summarizePendingBets(results), [results])

  const handleClearFilters = () => {
    setFilters(defaultMatkaResultFilters())
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Matka Results"
        sub="Manage and declare Matka results"
        actions={(
          <>
          <Button onClick={() => navigate('/matka/running')}>Running Markets</Button>
          <Button
            ref={declareTriggerRef}
            variant="primary"
            icon={<IconPlus size={16} stroke={strokeFor(16)} />}
            onClick={() => setDrawerOpen(true)}
          >
            Declare Result
          </Button>
          </>
        )}
      />

      <div className={styles.content}>
        <StatsCards />

        {/* Pending Bets Alert */}
        {pendingBetsSummary.totalBets > 0 && (
          <Notice
            tone="warn"
            icon={<IconCoin size={17} stroke={strokeFor(17)} />}
            title={(
              <>
                {pendingBetsTitle(pendingBetsSummary.totalBets)}{' '}
                <span className={styles.noticeAside}>{pendingBetsAcross(pendingBetsSummary.count)}</span>
              </>
            )}
            action={(
              <Button size="sm" onClick={() => setFilters({ ...filters, rolledBack: false })}>
                View All
              </Button>
            )}
          >
            {pendingBetsDescription(pendingBetsSummary, matkas)}
          </Notice>
        )}

        <FiltersBar
          filters={filters}
          onChangeFilters={setFilters}
          onClearAll={handleClearFilters}
        />

        <ResultsTable
          results={results}
          fetching={loading}
          filters={filters}
          onFiltersChange={setFilters}
          onRefetch={refetch}
          error={error && results.length === 0 ? `Failed to load results: ${error.message}` : undefined}
          footer={(
            <Pagination loading={loading}
              current={filters.page || 1}
              pageSize={filters.limit || 20}
              total={total}
              // Functional updates: a page-size change also calls onChange(1) in the same event, and with
              // the render's `filters` that second update used to put the old page size back.
              onChange={(page) => setFilters((current) => ({ ...current, page }))}
              onPageSizeChange={(pageSize) => setFilters((current) => ({ ...current, page: 1, limit: pageSize }))}
              itemName="results"
              pageSizeOptions={MATKA_RESULT_PAGE_SIZES}
              variant="embedded"
            />
          )}
        />
      </div>

      {/* Declare Result Drawer */}
      <DeclareResultDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={() => refetch()}
        restoreFocusTo={declareTriggerRef}
      />
    </Page>
  )
}

