import { useMemo, useState, type ReactNode } from 'react'
import {
  IconBallFootball,
  IconCash,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconDice,
  IconDownload,
  IconPercentage,
  IconRefresh,
  IconShare,
  IconStack2,
  IconUsers,
} from '@tabler/icons-react'
import { useExport } from '@/shared/hooks/useExport'
import { useAgentKPIs, useAgentTrends, useAgentPerformance, useAgentPlayerBreakdown } from '@/modules/reporting/hooks'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { EmptyState } from '@/ui/components/EmptyState'
import { Menu, MenuItem } from '@/ui/components/Menu'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import type { PaginationProps } from '@/ui/components/Pagination'
import { RadioGroup, type RadioOption } from '@/ui/components/RadioGroup'
import { Stat } from '@/ui/components/Stat'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  AGENT_OVERVIEW_DEFAULT_PRESET,
  AGENT_OVERVIEW_DOMAIN_LABELS,
  AGENT_OVERVIEW_PAGE_SIZE_OPTIONS,
  AGENT_OVERVIEW_PRESETS,
  AGENT_OVERVIEW_TABS,
  PERFORMANCE_PAGE_SIZE,
  TOP_PLAYERS_PAGE_SIZE,
  TRENDS_PAGE_SIZE,
  agentOverviewCustomPeriod,
  agentOverviewErrorLines,
  agentOverviewExportRange,
  agentOverviewFilter,
  agentOverviewFilterChanged,
  agentOverviewPeriodNote,
  agentOverviewPresetPeriod,
  clampPage,
  formatCount,
  initialAgentOverviewPeriod,
  isAgentOverviewPreset,
  pageRows,
  shortAgentId,
  topPlayerRows,
  visibleAgentOverviewDomains,
  type AgentKpis,
  type AgentOverviewDomain,
  type AgentOverviewPeriod,
  type AgentOverviewTab,
  type AgentPerformanceRow,
  type AgentPlayerRow,
  type AgentTrendRow,
} from './agentOverviewReportModel'
import styles from './AgentOverviewReport.module.css'

/* /reporting/agent-overview (no mockup page). The legacy antd page, rebuilt on the kit: the period
 * moves into the page head where the mockup draws its range control (M:1736-1746, O5), the four views
 * are a real tab strip, the domain choice keeps antd Segmented's native-radio keyboard model, and each
 * view is a card with the kit table. Queries, variables, the export job and the legacy copy are kept;
 * what changed is named in the page-migration record (task 127). */

const TAB_ID_PREFIX = 'agent-overview'
const GLYPH = 14

const TAB_ICONS: Record<AgentOverviewTab, ReactNode> = {
  ggr: <IconChartPie size={GLYPH} stroke={strokeFor(GLYPH)} />,
  activity: <IconChartLine size={GLYPH} stroke={strokeFor(GLYPH)} />,
  'top-players': <IconUsers size={GLYPH} stroke={strokeFor(GLYPH)} />,
}

const DOMAIN_ICONS: Record<AgentOverviewDomain, ReactNode> = {
  all: <IconStack2 size={GLYPH} stroke={strokeFor(GLYPH)} />,
  sports: <IconBallFootball size={GLYPH} stroke={strokeFor(GLYPH)} />,
  casino: <IconDice size={GLYPH} stroke={strokeFor(GLYPH)} />,
  matka: <IconChartBar size={GLYPH} stroke={strokeFor(GLYPH)} />,
}

const TAB_ITEMS: readonly TabItem<AgentOverviewTab>[] = AGENT_OVERVIEW_TABS.map((tab) => ({
  value: tab.value,
  label: tab.label,
  icon: TAB_ICONS[tab.value],
}))

export default function AgentOverviewReport() {
  return (
    <RBACGuard required={[{ domain: 'reporting.agent-overview', actions: ['view'] }]} bypassForAgents>
      <AgentOverviewReportContent />
    </RBACGuard>
  )
}

function AgentOverviewReportContent() {
  const { exportCSV, exportExcel, loading } = useExport()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const pageEyebrow = usePageEyebrow()

  const agent = useAuthStore((s) => s.agent)
  const isAgent = useAuthStore((s) => s.isAgent())

  const [activeTab, setActiveTab] = useState<AgentOverviewTab>('ggr')
  const [selectedDomain, setSelectedDomain] = useState<AgentOverviewDomain>('all')

  // Applied state - this is what's actually used for queries and for the export
  const [period, setPeriod] = useState<AgentOverviewPeriod>(() => initialAgentOverviewPeriod())

  const [performancePage, setPerformancePage] = useState(1)
  const [performancePageSize, setPerformancePageSize] = useState(PERFORMANCE_PAGE_SIZE)
  const [trendsPage, setTrendsPage] = useState(1)
  const [trendsPageSize, setTrendsPageSize] = useState(TRENDS_PAGE_SIZE)
  const [playersPage, setPlayersPage] = useState(1)
  const [playersPageSize, setPlayersPageSize] = useState(TOP_PLAYERS_PAGE_SIZE)

  // Prepare filter for queries (the domain only when it is not 'all')
  const filter = useMemo(() => agentOverviewFilter(period, selectedDomain), [period, selectedDomain])

  // Fetch data using hooks
  const { data: kpisData, loading: kpisLoading, refetch: refetchKPIs, error: kpisError } = useAgentKPIs(filter)
  const { data: trendsData, loading: trendsLoading, error: trendsError } = useAgentTrends(filter)
  const { data: performanceData, loading: performanceLoading, error: performanceError } = useAgentPerformance(50, filter)
  const { data: playerData, loading: playerLoading, error: playerError } = useAgentPlayerBreakdown({
    ...filter,
    // AgentDrillDownFilter format
  })

  const isLoading = kpisLoading || trendsLoading || performanceLoading || playerLoading

  const kpis: AgentKpis | null | undefined = kpisData?.agentKPIs
  // Until the first answer the KPI cards hold their own height with placeholders.
  const kpisPending = kpisLoading && !kpis
  const trends: AgentTrendRow[] = trendsData?.agentTrends || []
  const performance: AgentPerformanceRow[] = performanceData?.agentPerformance?.agents || []
  const players: AgentPlayerRow[] = playerData?.agentPlayerBreakdown || []
  const topPlayers = topPlayerRows(players)

  const errorLines = agentOverviewErrorLines({
    kpis: kpisError,
    trends: trendsError,
    performance: performanceError,
    players: playerError,
  })

  // Filter domain options based on agent's allowedDomains (presentation only; the server scopes data)
  const domainOptions = useMemo<RadioOption<AgentOverviewDomain>[]>(
    () => visibleAgentOverviewDomains(isAgent, agent?.allowedDomains).map((domain) => ({
      value: domain,
      label: (
        <span className={styles.optionLabel}>
          <span className={styles.optionIcon} aria-hidden="true">{DOMAIN_ICONS[domain]}</span>
          {AGENT_OVERVIEW_DOMAIN_LABELS[domain]}
        </span>
      ),
    })),
    [agent?.allowedDomains, isAgent],
  )

  const performanceColumns = useMemo<DataTableColumn<AgentPerformanceRow>[]>(() => [
    {
      key: 'agent',
      header: 'Agent',
      cell: (record) => (
        <span className={styles.entity}>
          <span className={styles.entityName}>{record.agentName || 'N/A'}</span>
          <span className={styles.entityId}>{shortAgentId(record.agentId)}</span>
        </span>
      ),
    },
    {
      key: 'totalTurnover',
      header: 'Turnover',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.totalTurnover)),
    },
    {
      key: 'totalGGR',
      header: 'GGR',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.totalGGR)),
    },
    {
      key: 'commissionEarned',
      header: 'Commission',
      align: 'right',
      cell: (record) => (
        <span className={styles.commission}>
          {formatAmount(convertFromWhitelabelCurrency(record.commissionEarned))}
        </span>
      ),
    },
    {
      key: 'playerCount',
      header: 'Players',
      align: 'right',
      cell: (record) => formatCount(record.playerCount),
    },
  ], [convertFromWhitelabelCurrency, formatAmount])

  const trendColumns = useMemo<DataTableColumn<AgentTrendRow>[]>(() => [
    { key: 'date', header: 'Date', cell: (record) => record.date },
    {
      key: 'turnover',
      header: 'Turnover',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.turnover)),
    },
    {
      key: 'ggr',
      header: 'GGR',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.ggr)),
    },
    {
      key: 'commission',
      header: 'Commission',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.commission)),
    },
    { key: 'playerCount', header: 'Players', align: 'right', cell: (record) => record.playerCount },
  ], [convertFromWhitelabelCurrency, formatAmount])

  const playerColumns = useMemo<DataTableColumn<AgentPlayerRow>[]>(() => [
    {
      key: 'player',
      header: 'Player',
      cell: (record) => (
        <span className={styles.entity}>
          <span className={styles.entityName}>{record.playerUsername || 'N/A'}</span>
          <span className={styles.entityId}>ID: {record.playerId}</span>
        </span>
      ),
    },
    {
      key: 'totalStakes',
      header: 'Total Stakes',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.totalStakes)),
    },
    {
      key: 'grossGamingRevenue',
      header: 'GGR',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.grossGamingRevenue)),
    },
    {
      key: 'betCount',
      header: 'Bets',
      align: 'right',
      cell: (record) => formatCount(record.betCount),
    },
    {
      key: 'avgStake',
      header: 'Avg Stake',
      align: 'right',
      cell: (record) => formatAmount(convertFromWhitelabelCurrency(record.avgStake)),
    },
  ], [convertFromWhitelabelCurrency, formatAmount])

  // The legacy tables were remounted on page 1 whenever their view was left or new query variables
  // loaded; the controlled pages follow suit (each table keeps its page size).
  const resetPages = () => {
    setPerformancePage(1)
    setTrendsPage(1)
    setPlayersPage(1)
  }

  const applyFilter = (nextPeriod: AgentOverviewPeriod, nextDomain: AgentOverviewDomain) => {
    if (agentOverviewFilterChanged(filter, agentOverviewFilter(nextPeriod, nextDomain))) resetPages()
    setPeriod(nextPeriod)
    setSelectedDomain(nextDomain)
  }

  const handleTabChange = (tab: AgentOverviewTab) => {
    if (tab !== activeTab) resetPages()
    setActiveTab(tab)
  }

  const handleDomainChange = (domain: AgentOverviewDomain) => {
    applyFilter(period, domain)
  }

  // A preset is resolved when it is applied, as the legacy Apply did; Custom applies the two days.
  const handleApply = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      applyFilter(agentOverviewCustomPeriod(payload.from, payload.to), selectedDomain)
      return
    }
    if (isAgentOverviewPreset(payload.preset) && payload.preset !== 'custom') {
      applyFilter(agentOverviewPresetPeriod(payload.preset), selectedDomain)
    }
  }

  // The legacy Clear All: back to Last 30 Days (the panel's Reset)
  const handleClearFilters = () => {
    applyFilter(agentOverviewPresetPeriod(AGENT_OVERVIEW_DEFAULT_PRESET), selectedDomain)
  }

  // Use applied date range for export
  const handleExport = async (format: 'csv' | 'xlsx') => {
    const dateRangeParam = agentOverviewExportRange(period)
    if (format === 'csv') {
      await exportCSV('ggr', {}, dateRangeParam)
    } else {
      await exportExcel('ggr', {}, dateRangeParam)
    }
  }

  const tablePagination = (
    current: number,
    pageSize: number,
    total: number,
    setCurrent: (page: number) => void,
    setPageSize: (size: number) => void,
    itemName: string,
  ): PaginationProps => ({
    current: clampPage(current, total, pageSize),
    pageSize,
    total,
    onChange: setCurrent,
    onPageSizeChange: (size) => {
      setPageSize(size)
      setCurrent(1)
    },
    itemName,
    pageSizeOptions: AGENT_OVERVIEW_PAGE_SIZE_OPTIONS,
    variant: 'embedded',
  })

  const headerActions = (
    <>
      <DateRangeField
        label="Date Range"
        size="md"
        presets={AGENT_OVERVIEW_PRESETS}
        appliedPreset={period.preset}
        appliedFrom={period.dateFrom}
        appliedTo={period.dateTo}
        customValue="custom"
        onApply={handleApply}
        onReset={handleClearFilters}
      />
      <Button
        icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
        onClick={() => void refetchKPIs()}
        loading={isLoading}
      >
        Refresh
      </Button>
      <Menu
        trigger={(
          <Button
            variant="primary"
            icon={<IconDownload size={16} stroke={strokeFor(16)} />}
            loading={loading}
          >
            Export Report
          </Button>
        )}
      >
        <MenuItem onSelect={() => void handleExport('csv')}>Export as CSV</MenuItem>
        <MenuItem onSelect={() => void handleExport('xlsx')}>Export as Excel</MenuItem>
      </Menu>
    </>
  )

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Agent Overview Report"
        sub="View comprehensive reports and analytics for your agent performance"
        actions={headerActions}
      />

      <div className={styles.content}>
        {/* Segmented Tabs */}
        <div className={styles.scroller}>
          <Tabs
            className={styles.rail}
            label="Agent Overview Report tabs selector"
            idPrefix={TAB_ID_PREFIX}
            items={TAB_ITEMS}
            value={activeTab}
            onChange={handleTabChange}
          />
        </div>

        {/* Domain Filter */}
        <div className={styles.scroller}>
          <RadioGroup
            className={styles.rail}
            label="Domain"
            hideLabel
            variant="segmented"
            options={domainOptions}
            value={selectedDomain}
            onChange={handleDomainChange}
          />
        </div>

        {/* Error Display */}
        {errorLines.length > 0 ? (
          <Notice tone="error" title="Error Loading Data" live="assertive">
            {errorLines.map((line) => (
              <span key={line} className={styles.errorLine}>{line}</span>
            ))}
          </Notice>
        ) : null}

        {/* Tab Content */}
        <div
          role="tabpanel"
          id={tabPanelId(TAB_ID_PREFIX, activeTab)}
          aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
          className={styles.panel}
        >
          {activeTab === 'ggr' ? (
            kpis || kpisPending ? (
              <>
                {/* KPI Cards */}
                <div className={styles.statsZone}>
                  <div className={styles.stats} role="group" aria-label="Agent overview totals" aria-busy={kpisPending || undefined}>
                    <Stat
                      label="Total Turnover"
                      value={formatAmount(convertFromWhitelabelCurrency(kpis?.totalTurnover || 0))}
                      note={agentOverviewPeriodNote(period)}
                      icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
                      hue="blu"
                      loading={kpisPending}
                    />
                    <Stat
                      label="Total GGR"
                      value={formatAmount(convertFromWhitelabelCurrency(kpis?.totalGGR || 0))}
                      note="Gross gaming revenue"
                      icon={<IconCash size={18} stroke={strokeFor(18)} />}
                      hue="grn"
                      loading={kpisPending}
                    />
                    <Stat
                      label="Commission Earned"
                      value={formatAmount(convertFromWhitelabelCurrency(kpis?.commissionEarned || 0))}
                      note="All commissions"
                      icon={<IconPercentage size={18} stroke={strokeFor(18)} />}
                      hue="ind"
                      loading={kpisPending}
                    />
                    <Stat
                      label="Share Earned"
                      value={formatAmount(convertFromWhitelabelCurrency(kpis?.shareEarned || 0))}
                      note="All shares"
                      icon={<IconShare size={18} stroke={strokeFor(18)} />}
                      hue="red"
                      loading={kpisPending}
                    />
                  </div>
                </div>

                {/* Performance Table */}
                {kpis && performance.length > 0 ? (
                  <Card title="Agent Performance" body="table">
                    <DataTable
                      label="Agent performance"
                      columns={performanceColumns}
                      rows={pageRows(performance, performancePage, performancePageSize)}
                      rowKey={(record) => String(record.agentId)}
                      width="wide"
                      state={performanceLoading ? 'loading' : 'ready'}
                      pagination={tablePagination(
                        performancePage,
                        performancePageSize,
                        performance.length,
                        setPerformancePage,
                        setPerformancePageSize,
                        'agents',
                      )}
                    />
                  </Card>
                ) : null}
              </>
            ) : (
              <Card as="div" body="flush">
                <EmptyState title="No data available for the selected date range" />
              </Card>
            )
          ) : null}

          {activeTab === 'activity' ? (
            <Card title="Activity Trends" body="table">
              <DataTable
                label="Activity trends"
                columns={trendColumns}
                rows={pageRows(trends, trendsPage, trendsPageSize)}
                rowKey={(record) => String(record.date)}
                state={trendsLoading ? 'loading' : 'ready'}
                empty={(
                  <EmptyState inset="none" title="No activity data available for the selected date range" />
                )}
                pagination={tablePagination(
                  trendsPage,
                  trendsPageSize,
                  trends.length,
                  setTrendsPage,
                  setTrendsPageSize,
                  'days',
                )}
              />
            </Card>
          ) : null}

          {activeTab === 'top-players' ? (
            <Card title="Top Players" body="table">
              <DataTable
                label="Top players"
                columns={playerColumns}
                rows={pageRows(topPlayers, playersPage, playersPageSize)}
                rowKey={(record) => String(record.playerId)}
                width="wide"
                state={playerLoading ? 'loading' : 'ready'}
                empty={(
                  <EmptyState inset="none" title="No player data available for the selected date range" />
                )}
                pagination={tablePagination(
                  playersPage,
                  playersPageSize,
                  topPlayers.length,
                  setPlayersPage,
                  setPlayersPageSize,
                  'players',
                )}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  )
}
