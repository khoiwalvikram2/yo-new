import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import {
  IconBolt,
  IconCircleCheck,
  IconClock,
  IconFileText,
  IconHistory,
  IconLock,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react'
import { useAuthStore } from '@/shared/core/authStore'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useReportingDateFilter } from '@/modules/reporting/reportingDateFilter'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Stat } from '@/ui/components/Stat'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { toast } from '@/ui/components/toast'
import { useCanAccessExportCenterContext } from './exportCenterAccess'
import { ExportsCreatePanel, type ExportTypeEstimateState } from './components/ExportsCreatePanel'
import { ExportsHistoryPanel } from './components/ExportsHistoryPanel'
import { ExportsJobDrawer } from './components/ExportsJobDrawer'
import { downloadExportFile } from './exportsPageDownload'
import { estimateExport } from './exportsPageEstimate'
import {
  DEFAULT_AGENT_DOMAINS,
  availableExportTypes,
  buildEstimateFilters,
  buildExportFiltersJson,
  buildExportJobInput,
  createFilterCount,
  errorMessageOf,
  exportAnalytics,
  exportDateRange,
  exportEstimateKey,
  exportFilterValue,
  exportJobFilename,
  groupExportTypes,
  templatePeriod,
  type ExportEstimate,
  type ExportFilterValues,
  type ExportFormat,
  type ExportJob,
  type ExportType,
  type ExportsTab,
  type ExportsViewMode,
  type SavedExportTemplate,
} from './exportsPageModel'
import {
  CREATE_EXPORT_JOB,
  DELETE_SAVED_REPORT,
  EXPORT_JOBS_QUERY,
  SAVED_REPORTS_QUERY,
} from './exportsPageQueries'
import styles from './ExportsPage.module.css'

/* /reporting/exports — the Export Center (mockup M:2531-2538, page migration C, W3 Task 128).
 *
 * The legacy 2,817-line antd page, rebuilt on the kit and split up: this entry keeps the guards, the
 * state, the data hooks and the handlers; the two tabs and the job drawer are page-owned components;
 * the catalogue and its rules are the React-free exportsPageModel; the documents, the row estimates
 * and the download moved to their own modules unchanged. Queries, variables, the 3-second History
 * poll, the mutations and their refetches, the toasts' copy and the agent branches are the legacy
 * ones; every change is named in the page-migration record (task 128). */

const TAB_ID_PREFIX = 'export-center'
const GLYPH = 14
const STAT_GLYPH = 18

/** antd's notification default, 4.5 s; the export job's own toasts kept their 4 s and 5 s. */
const NOTIFICATION_MS = 4500

/* A stable empty list, so the roles selector does not hand zustand a new array on every read. */
const NO_ROLES: readonly string[] = []

const TAB_ITEMS: readonly TabItem<ExportsTab>[] = [
  { value: 'create', label: 'Create Export', icon: <IconPlus size={GLYPH} stroke={strokeFor(GLYPH)} /> },
  { value: 'history', label: 'History', icon: <IconHistory size={GLYPH} stroke={strokeFor(GLYPH)} /> },
]

/** Export Center is only available in whitelabel context (Whitelabel Admin or Director in Whitelabel View).
 *  The rule itself lives in ./exportCenterAccess, so the dashboard's link here asks the same question. */
function ExportCenterWhitelabelGuard({ children }: { children: ReactNode }) {
  const canAccess = useCanAccessExportCenterContext()
  if (canAccess) return <>{children}</>
  return (
    <div className={styles.contextDenied}>
      <Notice
        tone="warn"
        icon={<IconLock size={18} stroke={strokeFor(18)} />}
        title="Export Center is only available in Whitelabel view"
        action={(
          <Link to="/" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
            Go to Dashboard
          </Link>
        )}
      >
        Switch to a whitelabel context to create and download exports.
      </Notice>
    </div>
  )
}

export default function ExportsPage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.exports', actions: ['view'] }]} bypassForAgents>
      <ExportCenterWhitelabelGuard>
        <ExportsPageContent />
      </ExportCenterWhitelabelGuard>
    </RBACGuard>
  )
}

function ExportsPageContent() {
  const { formatDateTime } = useFormatDate()
  const pageEyebrow = usePageEyebrow()
  const agent = useAuthStore((s) => s.agent)
  const isAgent = !!agent
  const userRoles = useAuthStore((s) => s.roles) || NO_ROLES
  const agentSchemeType = agent?.schemeType?.toLowerCase()
  const allowedDomains = agent?.allowedDomains || DEFAULT_AGENT_DOMAINS
  const client = useApolloClient()

  const { dateFrom, dateTo, preset, handleChange: setExportDates, reset: resetExportDates } =
    useReportingDateFilter('allTime')
  const [selectedExportType, setSelectedExportType] = useState<string | null>(null)
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('csv')
  const [activeFilters, setActiveFilters] = useState<ExportFilterValues>({})
  const [activeTab, setActiveTab] = useState<ExportsTab>('create')
  const [viewMode, setViewMode] = useState<ExportsViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined)
  const [previewDrawer, setPreviewDrawer] = useState(false)
  const [selectedJob, setSelectedJob] = useState<ExportJob | null>(null)
  const [exportEstimates, setExportEstimates] = useState<Record<string, ExportEstimate>>({})
  const [loadingEstimates, setLoadingEstimates] = useState<Record<string, boolean>>({})

  // Filter export types based on user role, agent type, domain, and search
  const availableTypes = useMemo(
    () => availableExportTypes({
      roles: userRoles,
      isAgent,
      agentSchemeType,
      allowedDomains,
      category: selectedCategory,
      search: searchQuery,
    }),
    [userRoles, searchQuery, selectedCategory, isAgent, agentSchemeType, allowedDomains],
  )

  // Group exports by category
  const groupedExports = useMemo(() => groupExportTypes(availableTypes), [availableTypes])

  const dateRangeParam = useMemo(() => exportDateRange(dateFrom, dateTo), [dateFrom, dateTo])

  const [createExportJob, { loading: creating }] = useMutation(CREATE_EXPORT_JOB, {
    refetchQueries: [{ query: EXPORT_JOBS_QUERY }],
    onCompleted: (data) => {
      if (data?.createExportJob) {
        toast({
          title: 'Export Job Created Successfully',
          message: 'Your export has been queued and will be processed shortly. Check the History tab for real-time updates.',
          tone: 'ok',
          duration: 4000,
        })
        setActiveTab('history')
        // Reset form
        setActiveFilters({})
        setSelectedExportType(null)
      }
    },
    onError: (error) => {
      toast({
        title: 'Export Creation Failed',
        message: error.message || 'Failed to create export job. Please try again.',
        tone: 'error',
        duration: 5000,
      })
    },
  })

  const { data: exportJobsData, loading: jobsLoading, error: jobsError, refetch: refetchJobs } = useQuery(
    EXPORT_JOBS_QUERY,
    {
      variables: { status: statusFilter, limit: historyPageSize, offset: (historyPage - 1) * historyPageSize },
      pollInterval: activeTab === 'history' ? 3000 : 0,
      errorPolicy: 'all',
    },
  )

  const { data: savedReportsData, refetch: refetchTemplates } = useQuery(SAVED_REPORTS_QUERY, {
    errorPolicy: 'all',
  })
  const savedReports: SavedExportTemplate[] = savedReportsData?.savedReports ?? []

  const [deleteSavedReport] = useMutation(DELETE_SAVED_REPORT, {
    refetchQueries: [{ query: SAVED_REPORTS_QUERY }],
    onCompleted: (data) => {
      if (data?.deleteSavedReport?.success) {
        toast({
          title: 'Template Deleted',
          message: data.deleteSavedReport.message || 'The export template has been deleted.',
          tone: 'ok',
          duration: NOTIFICATION_MS,
        })
      }
    },
    onError: (error) => {
      toast({
        title: 'Delete template failed',
        message: error.message || 'Failed to delete template.',
        tone: 'error',
        duration: NOTIFICATION_MS,
      })
    },
  })

  const exportJobs: ExportJob[] = useMemo(() => exportJobsData?.exportJobsPage?.items || [], [exportJobsData])

  // Analytics calculations
  const analytics = useMemo(() => exportJobsData?.exportJobsPage ?? exportAnalytics(exportJobs), [exportJobsData, exportJobs])

  // Recalculate estimates when filters or date range changes
  useEffect(() => {
    // Clear estimates when filters change to force recalculation
    setExportEstimates({})
  }, [activeFilters, dateRangeParam])

  // Calculate dynamic estimates using real data queries (on hover, and now on keyboard focus)
  const requestEstimate = (exportType: ExportType) => {
    const estimateKey = exportEstimateKey(exportType.id, activeFilters, dateRangeParam)
    if (exportEstimates[estimateKey] || loadingEstimates[exportType.id]) return

    setLoadingEstimates((prev) => ({ ...prev, [exportType.id]: true }))
    const filters = buildEstimateFilters({ activeFilters, dateRange: dateRangeParam, isAgent, agentId: agent?.id })
    void estimateExport(client, exportType.id, { filters, dateRange: dateRangeParam, isAgent, agentId: agent?.id })
      .then((estimate) => {
        setExportEstimates((prev) => ({ ...prev, [estimateKey]: estimate }))
      })
      .finally(() => {
        setLoadingEstimates((prev) => ({ ...prev, [exportType.id]: false }))
      })
  }

  const estimateFor = (exportType: ExportType): ExportTypeEstimateState => ({
    loading: Boolean(loadingEstimates[exportType.id]),
    estimate: exportEstimates[exportEstimateKey(exportType.id, activeFilters, dateRangeParam)],
  })

  const handleExport = async (type: string, format: ExportFormat) => {
    const exportType = availableTypes.find((t) => t.id === type)
    if (!exportType) return

    if (exportType.requiresDateRange && (!dateFrom || !dateTo)) {
      toast({
        title: 'Date Range Required',
        message: `${exportType.name} requires a date range to be selected.`,
        tone: 'warn',
        duration: NOTIFICATION_MS,
      })
      return
    }

    // The agent filter matters: the backend scopes an agent's export to its own players (credit,
    // commission or sharing). Whitelabel filtering is handled by the backend from context headers.
    const filtersJson = buildExportFiltersJson({
      activeFilters,
      dateRange: dateRangeParam,
      isAgent,
      agentId: agent?.id,
      tenantId: agent?.tenantId,
    })

    try {
      await createExportJob({
        variables: {
          input: buildExportJobInput(type, filtersJson, format),
        },
      })
      // Success notification and tab switch are handled by mutation onCompleted
    } catch (error: unknown) {
      toast({
        title: 'Export Failed',
        message: errorMessageOf(error) || 'Failed to create export job. Please try again.',
        tone: 'error',
        duration: NOTIFICATION_MS,
      })
    }
  }

  const startExport = (exportType: ExportType, format: ExportFormat) => {
    setSelectedExportType(exportType.id)
    setSelectedFormat(format)
    void handleExport(exportType.id, format)
  }

  const handleLoadTemplate = (template: SavedExportTemplate) => {
    setSelectedExportType(template.reportType)
    setActiveFilters(template.filtersJson || {})
    const period = templatePeriod(template.filtersJson)
    if (period) setExportDates(period.dateFrom, period.dateTo, 'custom')
  }

  // The legacy Popconfirm, now the modal confirmation (D5) with the same copy.
  const handleDeleteTemplate = (template: SavedExportTemplate) => {
    void confirm({
      title: 'Delete template?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        await deleteSavedReport({ variables: { id: template.id } })
      },
    })
  }

  const handleDownload = (job: ExportJob) => {
    void downloadExportFile(client, job.id, exportJobFilename(job))
  }

  const openDetails = (job: ExportJob) => {
    setSelectedJob(job)
    setPreviewDrawer(true)
  }

  const closeDetails = () => {
    setPreviewDrawer(false)
    setSelectedJob(null)
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Export Center"
        sub="Professional data export management with advanced filtering, scheduling, and analytics"
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => {
              void refetchJobs()
              void refetchTemplates()
            }}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {/* Quick Stats */}
        <div className={styles.statsZone}>
          <div className={styles.stats} role="group" aria-label="Export totals">
            <Stat
              label="Total Exports"
              value={analytics.total}
              note={`${analytics.completed} completed`}
              icon={<IconFileText size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />}
              hue="blu"
            />
            <Stat
              label="Success Rate"
              value={`${analytics.successRate}%`}
              note={`${analytics.failed} failed`}
              icon={<IconCircleCheck size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />}
              hue="grn"
            />
            <Stat
              label="In Progress"
              value={analytics.pending}
              note="Pending / processing"
              icon={<IconClock size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />}
              hue="ind"
            />
            <Stat
              label="Avg. Time"
              value={`${analytics.avgProcessingTime}min`}
              note="All time"
              icon={<IconBolt size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />}
              hue="red"
            />
          </div>
        </div>

        {/* Segmented Tabs */}
        <Tabs
          label="Export Center tabs selector"
          idPrefix={TAB_ID_PREFIX}
          items={TAB_ITEMS}
          value={activeTab}
          onChange={setActiveTab}
        />

        {/* Tab Content */}
        <div
          role="tabpanel"
          id={tabPanelId(TAB_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
          className={styles.tabPanel}
        >
          {activeTab === 'create' ? (
            <ExportsCreatePanel
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              category={selectedCategory}
              onCategoryChange={setSelectedCategory}
              dateFrom={dateFrom}
              dateTo={dateTo}
              preset={preset}
              onPeriodChange={setExportDates}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              filterCount={createFilterCount(searchQuery, selectedCategory, preset)}
              onClearAll={() => {
                setSearchQuery('')
                setSelectedCategory(undefined)
                resetExportDates()
              }}
              templates={savedReports}
              onLoadTemplate={handleLoadTemplate}
              onDeleteTemplate={handleDeleteTemplate}
              groups={groupedExports}
              activeFilters={activeFilters}
              onFilterChange={(key, value) => {
                setActiveFilters((prev) => ({
                  ...prev,
                  [key]: exportFilterValue(value),
                }))
              }}
              selectedExportType={selectedExportType}
              selectedFormat={selectedFormat}
              creating={creating}
              onExport={startExport}
              estimateFor={estimateFor}
              onRequestEstimate={requestEstimate}
            />
          ) : (
            <ExportsHistoryPanel
              jobs={exportJobs}
              total={exportJobsData?.exportJobsPage?.total ?? 0}
              page={historyPage}
              pageSize={historyPageSize}
              onPageChange={setHistoryPage}
              onPageSizeChange={size => { setHistoryPageSize(size); setHistoryPage(1) }}
              loading={jobsLoading}
              failed={Boolean(jobsError) && !jobsLoading && exportJobs.length === 0}
              statusFilter={statusFilter}
              onStatusChange={value => { setStatusFilter(value); setHistoryPage(1) }}
              onRefresh={() => void refetchJobs()}
              onDownload={handleDownload}
              onDetails={openDetails}
              formatDateTime={formatDateTime}
            />
          )}
        </div>
      </div>

      {/* Preview Drawer */}
      <ExportsJobDrawer
        open={previewDrawer}
        job={selectedJob}
        onClose={closeDetails}
        onDownload={handleDownload}
        formatDateTime={formatDateTime}
      />
    </Page>
  )
}
