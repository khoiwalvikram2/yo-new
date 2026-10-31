import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconPlus, IconSettings } from '@tabler/icons-react'
import { useNavigate } from 'react-router-dom'
import { useSportsResults } from '../../modules/sports/results'
import { ResultsTable } from './manual-results/components/ResultsTable'
import { FiltersBar } from './manual-results/components/FiltersBar'
import { StatsCards } from './manual-results/components/StatsCards'
import { DeclareResultDrawer } from './manual-results/components/DeclareResultDrawer'
import { AutoResultsSettingsDrawer } from './manual-results/components/AutoResultsSettingsDrawer'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { strokeFor } from '@/ui/components/icons'
import type { SportsResultFilters } from '../../modules/sports/results'
import {
  MANUAL_RESULT_PAGE_SIZES,
  buildSportsResultsVariables,
  defaultManualResultFilters,
} from './manual-results/manualResultsModel'
import styles from './manual-results/ManualResultsPage.module.css'

export default function ManualResultsPage() {
  return (
    <RBACGuard required={[{ domain: 'sports.results', actions: ['view'] }]}>
      <ManualResultsPageContent />
    </RBACGuard>
  )
}

function ManualResultsPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const roles = useAuthStore((state) => state.roles)
  const directorMode = useUIStore((state) => state.directorMode)
  const isSuperAdmin = useMemo(
    () => (roles ?? []).some((role) => {
      const normalised = String(role).toLowerCase()
      return role === 'Super Admin' || normalised === 'super_admin' || (normalised.includes('super') && normalised.includes('admin'))
    }),
    [roles],
  )
  const isSuperAdminWhitelabelMode = isSuperAdmin && directorMode === 'whitelabel'

  useEffect(() => {
    if (isSuperAdminWhitelabelMode) navigate('/sports/events', { replace: true })
  }, [isSuperAdminWhitelabelMode, navigate])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [filters, setFilters] = useState<SportsResultFilters>(defaultManualResultFilters)
  const declareTriggerRef = useRef<HTMLButtonElement | null>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const queryVariables = useMemo(() => buildSportsResultsVariables(filters), [filters])
  const [statsRevision, setStatsRevision] = useState(0)
  const { data, loading, error, refetch: refetchList } = useSportsResults(queryVariables)
  const refetch = useCallback(() => { setStatsRevision(value => value + 1); return refetchList() }, [refetchList])
  const results = data?.sportsResults?.items || []
  const total = data?.sportsResults?.total || 0

  if (isSuperAdminWhitelabelMode) return null

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Sports Results"
        sub="Manage results and auto result settings for sports markets"
        actions={(
          <div className={styles.headerActions}>
            <Button
              ref={settingsTriggerRef}
              icon={<IconSettings size={16} stroke={strokeFor(16)} />}
              onClick={() => setSettingsDrawerOpen(true)}
            >
              Auto Results Settings
            </Button>
            <Button
              ref={declareTriggerRef}
              variant="primary"
              icon={<IconPlus size={16} stroke={strokeFor(16)} />}
              onClick={() => setDrawerOpen(true)}
            >
              Declare Result
            </Button>
          </div>
        )}
      />

      <div className={styles.content}>
        <StatsCards revision={statsRevision} />
        <FiltersBar
          filters={filters}
          onChangeFilters={setFilters}
          onClearAll={() => setFilters(defaultManualResultFilters())}
        />
        <ResultsTable
          results={results}
          fetching={loading}
          onRefetch={() => void refetch()}
          error={error && results.length === 0 ? `Failed to load results: ${error.message}` : undefined}
          footer={(
            <Pagination loading={loading}
              current={filters.page || 1}
              pageSize={filters.limit || 20}
              total={total}
              onChange={(page) => setFilters((current) => ({ ...current, page }))}
              onPageSizeChange={(pageSize) => setFilters((current) => ({ ...current, page: 1, limit: pageSize }))}
              itemName="results"
              pageSizeOptions={MANUAL_RESULT_PAGE_SIZES}
              variant="embedded"
            />
          )}
        />
      </div>

      <DeclareResultDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSuccess={() => void refetch()}
        restoreFocusTo={declareTriggerRef}
      />
      <AutoResultsSettingsDrawer
        open={settingsDrawerOpen}
        onClose={() => setSettingsDrawerOpen(false)}
        onSuccess={() => void refetch()}
        restoreFocusTo={settingsTriggerRef}
      />
    </Page>
  )
}
