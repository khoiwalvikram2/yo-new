import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IconBallFootball,
  IconCash,
  IconChartBar,
  IconChartLine,
  IconDice,
  IconPercentage,
  IconRefresh,
  IconStack2,
  IconUsers,
} from '@tabler/icons-react';
import clsx from 'clsx';
import {
  useAgentKPIs,
  useAgentPerformance,
  useAgentPlayerBreakdown,
} from '@/modules/reporting/hooks';
import { REPORTING_ALL_TIME_FROM, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter';
import { FilterChips } from '@/modules/reporting/ui/FilterChips';
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useAuthStore } from '@/shared/core/authStore';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { useReportingStore, type ReportingFilters } from '@/state/reportingStore';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { FilterBar } from '@/ui/components/FilterBar';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { RadioGroup, type RadioOption } from '@/ui/components/RadioGroup';
import { SearchField } from '@/ui/components/SearchField';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { strokeFor } from '@/ui/components/icons';
import { istToday } from '@/ui/components/istDate';
import {
  AGENT_PERF_DOMAIN_CUTS,
  AGENT_PERF_DOMAIN_LABELS,
  AGENT_PERF_PAGE_SIZE,
  AGENT_PERF_PAGE_SIZE_OPTIONS,
  AGENT_TYPE_OPTIONS,
  agentAllowedDomains,
  agentCut,
  agentDomainCut,
  agentPerfAllTimeRange,
  agentPerfClearableFilterCount,
  agentPerfColumns,
  agentPerfCountText,
  agentPerfCurrentLevel,
  agentPerfDomainOptions,
  agentPerfFilter,
  agentPerfKpiTiles,
  agentPerfLevelData,
  agentPerfLevelsToRemove,
  agentPerfPageRows,
  agentPerfRootLabel,
  agentPerfRowKey,
  agentPerfSearchPlaceholder,
  agentPerfShowDomainBreakdown,
  agentPerfTableTitle,
  agentPerfTotalText,
  agentPerfTotalsCells,
  clampAgentPerfPage,
  filterAgentPerfRows,
  isAgentLevel,
  sortAgentPerfPage,
  winRateText,
  winRateTone,
  type AgentPerfColumnKey,
  type AgentPerfDomain,
  type AgentPerfKpiIcon,
  type AgentPerfRow,
} from './agentPerformanceReportModel';
import styles from './AgentPerformanceReport.module.css';

/* /reporting/agents/performance on the kit (page migration C, W3 Task 132). The three agent queries run
   through the shared reporting hooks with the legacy filter; the period, agent type and domain still
   write the shared reporting store, and the drill-down path and filter chips are read from it, as
   before. The rules are in agentPerformanceReportModel.ts. */

interface AgentPerfTableRow extends AgentPerfRow {
  rowKey: string;
}

const TILE_ICON = 18;
const GLYPH = 14;

const KPI_ICONS: Record<AgentPerfKpiIcon, ReactNode> = {
  chart: <IconChartLine size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  cash: <IconCash size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  percent: <IconPercentage size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  users: <IconUsers size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
};

const DOMAIN_ICONS: Record<AgentPerfDomain, ReactNode> = {
  all: <IconStack2 size={GLYPH} stroke={strokeFor(GLYPH)} />,
  sports: <IconBallFootball size={GLYPH} stroke={strokeFor(GLYPH)} />,
  casino: <IconDice size={GLYPH} stroke={strokeFor(GLYPH)} />,
  matka: <IconChartBar size={GLYPH} stroke={strokeFor(GLYPH)} />,
};

/** A name in the key cell's weight over an optional caption line. */
function entityCell(name: ReactNode, caption?: ReactNode) {
  return (
    <span className={styles.entity}>
      <span className={styles.entityName}>{name}</span>
      {caption ? <span className={styles.entityCaption}>{caption}</span> : null}
    </span>
  );
}

/** One cell, as the legacy column's render drew it (amounts through the whitelabel conversion). */
function agentPerfCell(key: AgentPerfColumnKey, row: AgentPerfRow, money: (value: number) => string): ReactNode {
  switch (key) {
    case 'agent':
      return entityCell(
        row.agentName || 'N/A',
        row.schemeType ? <StatusPill tone="info">{row.schemeType}</StatusPill> : null,
      );
    case 'totalGGR':
      return money(row.totalGGR);
    case 'cut':
      return <span className={clsx(styles.amount, styles.gain)}>{money(agentCut(row))}</span>;
    case 'commission':
      return money(row.commissionEarned);
    case 'share':
      return money(row.shareEarned);
    case 'sportsCut':
    case 'casinoCut':
    case 'matkaCut': {
      const domain = AGENT_PERF_DOMAIN_CUTS.find((candidate) => candidate.key === key)?.domain ?? '';
      const { cut, formula } = agentDomainCut(row, domain);
      return (
        <span className={styles.domainCut}>
          <span>{money(cut)}</span>
          {formula ? <span className={styles.entityCaption}>{formula}</span> : null}
        </span>
      );
    }
    case 'playerCount':
      return row.playerCount.toLocaleString();
    case 'betCount':
      return row.betCount.toLocaleString();
    case 'player':
      return entityCell(row.playerUsername || 'N/A', <>ID: {row.playerId}</>);
    case 'totalStakes':
      return money(row.totalStakes);
    case 'totalPayouts':
      return money(row.totalPayouts);
    case 'ggr':
      return (
        <span className={clsx(styles.amount, row.grossGamingRevenue >= 0 ? styles.gain : styles.loss)}>
          {money(row.grossGamingRevenue)}
        </span>
      );
    case 'avgStake':
      return money(row.avgStake);
    case 'winRate':
      return <StatusPill tone={winRateTone(row.winRate)}>{winRateText(row.winRate)}</StatusPill>;
    default:
      return null;
  }
}

export default function AgentPerformanceReport() {
  return (
    <RBACGuard required={[{ domain: 'reporting.agents-performance', actions: ['view'] }]} bypassForAgents>
      <AgentPerformanceReportContent />
    </RBACGuard>
  );
}

function AgentPerformanceReportContent() {
  const pageEyebrow = usePageEyebrow();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  const agent = useAuthStore((s) => s.agent);
  const isAgent = useAuthStore((s) => s.isAgent());
  const allowedDomains = agentAllowedDomains(agent?.allowedDomains);

  const {
    filters,
    setFilters,
    drillDownPath,
    activeFilters,
    popDrillDownLevel,
    resetDrillDownPath,
    removeFilter,
    clearAllFilters,
  } = useReportingStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(AGENT_PERF_PAGE_SIZE);
  const [datePreset, setDatePreset] = useState<ReportingDatePreset>('allTime');
  const [selectedDomain, setSelectedDomain] = useState<string>(filters.domain || 'all');
  const [selectedAgentType, setSelectedAgentType] = useState<string>(filters.schemeType || 'COMMISSION');
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const hasSetAgentSchemeRef = useRef(false);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const currentCrumbRef = useRef<HTMLSpanElement>(null);
  const pendingCrumbFocusRef = useRef(false);

  // On arrival the shared store's period becomes All time, as the legacy page set it on mount.
  useEffect(() => {
    setFilters(agentPerfAllTimeRange());
  }, [setFilters]);

  // When an agent signs in, the agent type starts on their own scheme (COMMISSION/SHARING/CREDIT).
  useEffect(() => {
    if (hasSetAgentSchemeRef.current) return;
    if (isAgent && agent?.schemeType) {
      setSelectedAgentType(agent.schemeType);
      hasSetAgentSchemeRef.current = true;
    }
  }, [isAgent, agent?.schemeType]);

  const currentLevel = agentPerfCurrentLevel(drillDownPath);

  // An agent on All Domains with one allowed domain is scoped to it; an agent sees their direct sub-agents.
  const filter = useMemo(
    () => agentPerfFilter({
      filters,
      drillDownPath,
      activeFilters,
      selectedDomain,
      selectedAgentType,
      isAgent,
      agentId: agent?.id,
      allowedDomains,
    }),
    [filters, drillDownPath, activeFilters, selectedDomain, selectedAgentType, isAgent, agent?.id, allowedDomains],
  );

  const {
    data: performanceData,
    loading: performanceLoading,
    error: performanceError,
    refetch: refetchPerformance,
  } = useAgentPerformance(50, filter, { skip: !isAgentLevel(currentLevel) });
  // Agent-level totals already contain every visible KPI. Fetch the separate
  // KPI summary only for player drill-down or when the report has no totals.
  const needKpis = currentLevel === 'player' || (isAgentLevel(currentLevel) && !performanceLoading && !performanceData?.agentPerformance?.totals);
  const { data: kpisData, loading: kpisLoading, refetch: refetchKpis } = useAgentKPIs(filter, { skip: !needKpis });
  const {
    data: playerData,
    loading: playerLoading,
    error: playerError,
    refetch: refetchPlayers,
  } = useAgentPlayerBreakdown(filter, { skip: currentLevel !== 'player' });

  const currentLevelData = useMemo(
    () => agentPerfLevelData(
      currentLevel,
      performanceData?.agentPerformance,
      playerData?.agentPlayerBreakdown,
      kpisData?.agentKPIs,
    ),
    [currentLevel, performanceData, playerData, kpisData],
  );
  const levelQuery = currentLevelData.source === 'performance'
    ? { loading: performanceLoading, error: performanceError, refetch: refetchPerformance }
    : currentLevelData.source === 'players'
      ? { loading: playerLoading, error: playerError, refetch: refetchPlayers }
      : null;

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));

  const filteredData = useMemo(
    () => filterAgentPerfRows(currentLevelData.data, currentLevel, searchQuery),
    [currentLevelData.data, searchQuery, currentLevel],
  );
  const total = filteredData.length;
  // A page past the last one (a narrower search on page 3, a shorter level) shows the last page.
  const page = clampAgentPerfPage(currentPage, total, pageSize);

  const tableRows = useMemo<AgentPerfTableRow[]>(
    () => sortAgentPerfPage(
      agentPerfPageRows(filteredData, page, pageSize).map((row, index) => ({
        ...row,
        rowKey: agentPerfRowKey(currentLevel, row, index),
      })),
      sort,
    ),
    [currentLevel, filteredData, page, pageSize, sort],
  );

  // Keep the four cards mounted while filters change: removing this row moves
  // the controls under the pointer. Pending cards hide the previous scheme's figures.
  const kpisPending = Boolean(levelQuery?.loading || (needKpis && kpisLoading));
  const kpis = kpisPending ? undefined : currentLevelData.kpis;
  const totals = currentLevelData.totals;
  const showDomainBreakdown = agentPerfShowDomainBreakdown(totals, currentLevel);

  // The totals row: each figure under its own column (see the record's behaviour changes).
  const columns = useMemo<DataTableColumn<AgentPerfTableRow>[]>(() => {
    const amount = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
    const footers = totals && isAgentLevel(currentLevel) ? agentPerfTotalsCells(totals, amount) : null;
    return agentPerfColumns(currentLevel, showDomainBreakdown, selectedAgentType).map((spec) => ({
      key: spec.key,
      header: spec.title,
      align: spec.align,
      sort: spec.sortable ? true : undefined,
      cell: (row: AgentPerfTableRow) => agentPerfCell(spec.key, row, amount),
      footer: footers ? footers[spec.key] : undefined,
    }));
  }, [convertFromWhitelabelCurrency, currentLevel, formatAmount, selectedAgentType, showDomainBreakdown, totals]);

  // A crumb that is pressed usually leaves the DOM; focus then moves to the new current crumb, or to
  // the table when the path is gone.
  useLayoutEffect(() => {
    if (!pendingCrumbFocusRef.current) return;
    pendingCrumbFocusRef.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (currentCrumbRef.current ?? tableHostRef.current)?.focus();
  }, [drillDownPath]);

  const handleBreadcrumbClick = (index: number) => {
    pendingCrumbFocusRef.current = true;
    if (index === -1) {
      resetDrillDownPath();
    } else {
      const levelsToRemove = agentPerfLevelsToRemove(drillDownPath.length, index);
      for (let i = 0; i < levelsToRemove; i++) {
        popDrillDownLevel();
      }
    }
  };

  const breadcrumbLevels = drillDownPath.map((pathLevel, index) => ({
    label: pathLevel.name,
    key: pathLevel.type,
    value: pathLevel.id,
    onClick: () => handleBreadcrumbClick(index),
  }));

  const filterChips = Object.entries(activeFilters).map(([key, { value, label }]) => ({
    key,
    label,
    value,
    onRemove: () => removeFilter(key),
  }));

  // Domain rail: All Domains, then each domain an admin sees or the agent's allowedDomains include.
  const domainOptions = useMemo<RadioOption<string>[]>(
    () => agentPerfDomainOptions(isAgent, allowedDomains).map((domain) => ({
      value: domain,
      label: (
        <span className={styles.optionLabel}>
          <span className={styles.optionIcon} aria-hidden="true">{DOMAIN_ICONS[domain]}</span>
          {AGENT_PERF_DOMAIN_LABELS[domain]}
        </span>
      ),
    })),
    [isAgent, allowedDomains],
  );

  const handleRefresh = () => {
    // A failed refetch shows in the table's error state (and the hook's toast); the promise needs no handler.
    if (needKpis) void refetchKpis().catch(() => undefined);
    void levelQuery?.refetch().catch(() => undefined);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters(agentPerfAllTimeRange());
    setDatePreset('allTime');
    setCurrentPage(1);
  };

  const drillPath = drillDownPath.length > 0 ? (
    <nav className={styles.drillPath} aria-label="Drill-down path">
      <ol className={styles.crumbs}>
        <li className={styles.crumbItem}>
          <button
            type="button"
            className={clsx(styles.crumb, styles.crumbLink)}
            onClick={() => {
              pendingCrumbFocusRef.current = true;
              resetDrillDownPath();
              setCurrentPage(1);
            }}
          >
            {agentPerfRootLabel(currentLevel)}
          </button>
        </li>
        {breadcrumbLevels.map((crumb, index) => (
          <li key={`${crumb.key}-${index}`} className={styles.crumbItem}>
            <span className={styles.separator} aria-hidden="true">/</span>
            {index === breadcrumbLevels.length - 1 ? (
              <span
                ref={currentCrumbRef}
                className={clsx(styles.crumb, styles.current)}
                aria-current="location"
                tabIndex={-1}
              >
                {crumb.label}
              </span>
            ) : (
              <button type="button" className={clsx(styles.crumb, styles.crumbLink)} onClick={crumb.onClick}>
                {crumb.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  ) : null;

  const tableTitle = agentPerfTableTitle(currentLevel);

  return (
    <Page maxWidth="wide" className={styles.page}>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Agent Performance Report"
        sub="Analyze agent performance, turnover, and earnings across all domains"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {isAgentLevel(currentLevel) || currentLevel === 'player' ? (
          <div className={styles.statsZone}>
            <div className={styles.stats} role="group" aria-label="Agent performance statistics" aria-busy={kpisPending || undefined}>
              {agentPerfKpiTiles(kpis ?? {}, money).map((tile) => (
                <Stat
                  key={tile.key}
                  label={tile.label}
                  value={kpis ? tile.value : '—'}
                  note={kpis ? tile.note : '—'}
                  loading={kpisPending}
                  icon={KPI_ICONS[tile.icon]}
                  hue={tile.hue}
                />
              ))}
            </div>
          </div>
        ) : null}

        <FilterBar
          activeCount={agentPerfClearableFilterCount(searchQuery, datePreset)}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label="Search the agent performance report"
              placeholder={agentPerfSearchPlaceholder(currentLevel)}
              size="sm"
              value={searchQuery}
              onChange={(value) => {
                setSearchQuery(value);
                setCurrentPage(1);
              }}
            />
          )}
        >
          <ReportingPeriodFilter
            dateFrom={filters.dateFrom || REPORTING_ALL_TIME_FROM}
            dateTo={filters.dateTo || istToday()}
            preset={datePreset}
            onChange={(f, t, p) => {
              setFilters({ dateFrom: f, dateTo: t });
              setDatePreset(p);
              setCurrentPage(1);
            }}
          />
        </FilterBar>

        {/* Agent type (whitelabel only) */}
        {!isAgent && drillDownPath.length === 0 ? (
          <div className={styles.scroller}>
            <RadioGroup
              className={styles.rail}
              label="Agent type"
              hideLabel
              variant="segmented"
              options={AGENT_TYPE_OPTIONS}
              value={selectedAgentType}
              onChange={(scheme) => {
                setSelectedAgentType(scheme);
                setFilters({ schemeType: scheme as ReportingFilters['schemeType'] });
                setCurrentPage(1);
              }}
            />
          </div>
        ) : null}

        {drillDownPath.length === 0 ? (
          <div className={styles.scroller}>
            <RadioGroup
              className={styles.rail}
              label="Domain"
              hideLabel
              variant="segmented"
              options={domainOptions}
              value={selectedDomain}
              onChange={(domain) => {
                setSelectedDomain(domain);
                setFilters({ domain: domain === 'all' ? undefined : (domain as ReportingFilters['domain']) });
                setCurrentPage(1);
              }}
            />
          </div>
        ) : null}

        {filterChips.length > 0 ? <FilterChips chips={filterChips} onClearAll={clearAllFilters} /> : null}

        <Card title={tableTitle} sub={agentPerfCountText(total, currentLevel)} body="table">
          <div ref={tableHostRef} className={styles.tableHost} tabIndex={-1}>
            <DataTable
              label={tableTitle}
              rows={tableRows}
              rowKey={(row) => row.rowKey}
              columns={columns}
              width="wide"
              toolbar={drillPath}
              state={levelQuery?.loading ? 'loading' : levelQuery?.error ? 'error' : 'ready'}
              error={levelQuery?.error?.message}
              onRetry={() => {
                void levelQuery?.refetch().catch(() => undefined);
              }}
              empty={<EmptyState inset="none" title="No data" />}
              sort={sort}
              onSortChange={setSort}
              pagination={{
                current: page,
                pageSize,
                total,
                onChange: setCurrentPage,
                onPageSizeChange: setPageSize,
                itemName: currentLevel === 'player' ? 'players' : 'agents',
                pageSizeOptions: AGENT_PERF_PAGE_SIZE_OPTIONS,
                formatSummary: (summary) => agentPerfTotalText(summary.total, currentLevel),
                variant: 'embedded',
              }}
            />
          </div>
        </Card>
      </div>
    </Page>
  );
}
