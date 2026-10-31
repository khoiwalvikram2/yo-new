import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  IconCash,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconEye,
  IconRefresh,
  IconTable,
  IconUsers,
} from '@tabler/icons-react';
import clsx from 'clsx';
import {
  useSportsKPIs,
  useSportsTrends,
  useSportsBreakdown,
  useSportsLeagueBreakdown,
  useSportsEventBreakdown,
  useSportsMarketBreakdown,
} from '@/modules/reporting/hooks';
import {
  REPORTING_ALL_TIME_FROM,
  computeReportingDateRange,
  type ReportingDatePreset,
} from '@/modules/reporting/reportingDateFilter';
import { ContextCharts } from '@/modules/reporting/ui/ContextCharts';
import { DrillDownBreadcrumbs } from '@/modules/reporting/ui/DrillDownBreadcrumbs';
import { FilterChips } from '@/modules/reporting/ui/FilterChips';
import { ReportDetailDrawer } from '@/modules/reporting/ui/ReportDetailDrawer';
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter';
import { TrendCard } from '@/modules/reporting/ui/TrendCard';
import type { DetailFilter } from '@/modules/reporting/ui/drillDownModel';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { useReportingStore } from '@/state/reportingStore';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { FilterBar } from '@/ui/components/FilterBar';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { SearchField } from '@/ui/components/SearchField';
import { Stat, type StatHue } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { Tabs } from '@/ui/components/Tabs';
import { strokeFor } from '@/ui/components/icons';
import { istToday } from '@/ui/components/istDate';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import {
  SPORTS_PAGE_SIZE,
  SPORTS_PAGE_SIZES,
  SPORTS_REPORT_COPY,
  SPORTS_TREND_LINES,
  SPORTS_VIEW_TABS,
  currentSportsLevel,
  drillDownStep,
  entityName,
  entitySub,
  filterSportsRows,
  isPathFromOtherReport,
  levelDrills,
  levelHasDetails,
  levelSource,
  levelView,
  searchLabel,
  searchPlaceholder,
  sortSportsRows,
  sportsActiveFilterCount,
  sportsColumns,
  sportsFilterChips,
  sportsKpiFigures,
  sportsPageRows,
  sportsReportFilter,
  sportsRowKey,
  sportsTableSummary,
  sportsTrendRows,
  winRateText,
  winRateTone,
  type SportsBreakdownRow,
  type SportsColumn,
  type SportsKpiFigure,
  type SportsViewTab,
} from './sportsOverviewReportModel';
import styles from './SportsOverviewReport.module.css';

/* /reporting/sports on the kit (page migration C, W3 Task 129). The six data hooks, the filter they
   receive, the drill-down levels, the agent bypass and every piece of copy are the legacy page's; the
   rules live in sportsOverviewReportModel.ts. The drill-down pieces are Task 121's
   (modules/reporting/ui) and the period control is Task 120's. */

/** A row on the current page with the key the legacy table gave it (its id, else its page index). */
interface KeyedRow {
  key: string;
  row: SportsBreakdownRow;
}

const VIEW_TABS_ID = 'sports-report-view';
const STAT_GLYPH = 18;
const TAB_GLYPH = 14;

const TAB_ICONS: Record<SportsViewTab, ReactNode> = {
  breakdown: <IconTable size={TAB_GLYPH} stroke={strokeFor(TAB_GLYPH)} />,
  overview: <IconChartPie size={TAB_GLYPH} stroke={strokeFor(TAB_GLYPH)} />,
  trends: <IconChartLine size={TAB_GLYPH} stroke={strokeFor(TAB_GLYPH)} />,
};

const TAB_ITEMS = SPORTS_VIEW_TABS.map((tab) => ({ ...tab, icon: TAB_ICONS[tab.value] }));

/* The legacy stat cards' glyphs (line chart, money, bar chart, team) and tile colours (blue, green,
   grey, blue) on the kit's decorative ramp; no tile hue carries meaning. */
const STAT_LOOK: Record<SportsKpiFigure['key'], { icon: ReactNode; hue: StatHue }> = {
  ggr: { icon: <IconChartLine size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />, hue: 'blu' },
  stakes: { icon: <IconCash size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />, hue: 'grn' },
  bets: { icon: <IconChartBar size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />, hue: 'ind' },
  players: { icon: <IconUsers size={STAT_GLYPH} stroke={strokeFor(STAT_GLYPH)} />, hue: 'blu' },
};

/** What a click inside a row may land on that is a control of its own, not the row. */
const ROW_CONTROLS = 'a[href], button, input, select, textarea, [contenteditable="true"]';

export default function SportsOverviewReport() {
  return (
    <RBACGuard required={[{ domain: 'reporting.sports', actions: ['view'] }]} bypassForAgents>
      <SportsOverviewReportContent />
    </RBACGuard>
  );
}

function SportsOverviewReportContent() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const {
    filters,
    setFilters,
    drillDownPath,
    activeFilters,
    pushDrillDownLevel,
    popDrillDownLevel,
    resetDrillDownPath,
    removeFilter,
    clearAllFilters,
  } = useReportingStore();

  const pageEyebrow = usePageEyebrow();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(SPORTS_PAGE_SIZE);
  const [activeViewTab, setActiveViewTab] = useState<SportsViewTab>('breakdown');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<ReportingDatePreset>('allTime');
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const activatedRef = useRef(false);
  const initialPath = useRef(drillDownPath);

  // Every visit opens on all time: 2000-01-01 through today (IST).
  useEffect(() => {
    setFilters(computeReportingDateRange('allTime'));
  }, [setFilters]);

  // Reset drill-down when the path the page opened on is from another report (e.g. Casino vendor/game)
  useEffect(() => {
    if (isPathFromOtherReport(initialPath.current)) resetDrillDownPath();
  }, [resetDrillDownPath]);

  // Determine current level
  const currentLevel = currentSportsLevel(drillDownPath);

  // Only fields allowed by SportsDrillDownFilter, then the drill-down ids and the active filters
  const filter = useMemo(
    () => sportsReportFilter(filters, drillDownPath, activeFilters, istToday()),
    [filters, drillDownPath, activeFilters],
  );

  // Fetch data based on current level (the same six hooks, in the same order, with the same filter)
  const kpisQuery = useSportsKPIs(filter);
  const trendsQuery = useSportsTrends(filter);
  const breakdownQuery = useSportsBreakdown('sport', filter);
  const leagueQuery = useSportsLeagueBreakdown(filter);
  const eventQuery = useSportsEventBreakdown(filter);
  const marketQuery = useSportsMarketBreakdown(filter);

  // The root shows sports, a sport its leagues, a league its events, an event its markets
  const currentLevelData = levelView(
    currentLevel,
    {
      sports: { rows: breakdownQuery.data?.sportsBreakdown, loading: breakdownQuery.loading },
      league: { rows: leagueQuery.data?.sportsLeagueBreakdown, loading: leagueQuery.loading },
      event: { rows: eventQuery.data?.sportsEventBreakdown, loading: eventQuery.loading },
      market: { rows: marketQuery.data?.sportsMarketBreakdown, loading: marketQuery.loading },
    },
    kpisQuery.data?.sportsKPIs,
  );
  const levelQueries = { sports: breakdownQuery, league: leagueQuery, event: eventQuery, market: marketQuery };
  const source = levelSource(currentLevel);
  const levelQuery = source ? levelQueries[source] : null;
  const tableError = levelQuery?.error;

  // Handle row click to drill down (event is leaf — markets displayed, no further drill)
  const handleDrillDown = (record: SportsBreakdownRow) => {
    const step = drillDownStep(currentLevel, record);
    if (!step) return;
    pushDrillDownLevel(step);
    setCurrentPage(1);
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      resetDrillDownPath();
      setSelectedPlayerId(null);
      setSelectedAgentId(null);
    } else {
      const levelsToRemove = drillDownPath.length - index - 1;
      for (let i = 0; i < levelsToRemove; i++) {
        popDrillDownLevel();
      }
    }
  };

  // Build breadcrumb levels
  const breadcrumbLevels = drillDownPath.map((level, index) => ({
    label: level.name,
    key: level.type,
    value: level.id,
    onClick: () => handleBreadcrumbClick(index),
  }));

  // Build filter chips (guard against undefined or malformed entries from persist rehydration)
  const filterChips = sportsFilterChips(activeFilters).map((chip) => ({
    ...chip,
    onRemove: () => removeFilter(chip.key),
  }));

  const trendsDataFormatted = sportsTrendRows(trendsQuery.data?.sportsTrends, convertFromWhitelabelCurrency);

  // Filter data by search query, then page it (a page past the end shows the last one)
  const filteredData = filterSportsRows(currentLevelData.data, currentLevel, searchQuery);
  const total = filteredData.length;
  const shownPage = Math.min(currentPage, Math.max(1, Math.ceil(total / pageSize)));
  const columns = sportsColumns(currentLevel);
  const pageRows: KeyedRow[] = sportsPageRows(filteredData, shownPage, pageSize).map((row, index) => ({
    key: sportsRowKey(currentLevel, row, index),
    row,
  }));
  // The column sorters order the rows on this page, as antd sorted the slice it was given
  const shownRows = sortSportsRows(pageRows, sort, columns, (item) => item.row);

  const kpis = currentLevelData.kpis;
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const activeFiltersCount = sportsActiveFilterCount(searchQuery, datePreset);
  const drills = levelDrills(currentLevel);

  // The totals, the trend and the table this level shows; a failed table load shows in the table.
  const handleRefresh = () => {
    [kpisQuery, trendsQuery, levelQuery].forEach((query) => {
      if (query) void query.refetch().catch(() => undefined);
    });
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters(computeReportingDateRange('allTime'));
    setDatePreset('allTime');
    setCurrentPage(1);
  };

  const handlePeriodChange = (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => {
    setFilters({ dateFrom, dateTo });
    setDatePreset(preset);
    setCurrentPage(1);
  };

  const openDetails = (record: SportsBreakdownRow) => {
    if (currentLevel === 'agent') {
      setSelectedAgentId(record.agentId ?? null);
      setSelectedPlayerId(null);
    } else {
      // passed on as the row holds it, as before (the contributors panel does not read it)
      setSelectedPlayerId((record.playerId ?? null) as string | null);
      setSelectedAgentId(null);
    }
  };

  const renderCell = (column: SportsColumn, record: SportsBreakdownRow): ReactNode => {
    if (column.kind === 'entity') {
      const sub = entitySub(record, column);
      return (
        <span className={styles.entity}>
          <span className={styles.entityName}>{entityName(record, column)}</span>
          {sub !== null ? <span className={styles.entitySub}>{sub}</span> : null}
        </span>
      );
    }
    if (column.kind === 'text') {
      const value = column.nameField ? record[column.nameField] : undefined;
      return value === null || value === undefined ? '' : String(value);
    }
    const value = column.field ? record[column.field] : undefined;
    if (column.kind === 'amount') {
      return <span className={styles.amount}>{money(value as number)}</span>;
    }
    if (column.kind === 'ggr') {
      return (
        <span className={clsx(styles.ggr, Number(value) >= 0 ? styles.gain : styles.loss)}>
          {money(value as number)}
        </span>
      );
    }
    if (column.kind === 'winRate') {
      return <StatusPill tone={winRateTone(Number(value))}>{winRateText(Number(value))}</StatusPill>;
    }
    return <span className={styles.amount}>{(value ?? 0).toLocaleString()}</span>;
  };

  const tableColumns: DataTableColumn<KeyedRow>[] = columns.map((column) => ({
    key: column.key,
    header: column.title,
    align: column.align,
    sort: column.sortable ? true : undefined,
    cell: (item: KeyedRow) => renderCell(column, item.row),
  }));
  if (levelHasDetails(currentLevel)) {
    tableColumns.push({
      key: 'actions',
      header: <span className={styles.visuallyHidden}>Actions</span>,
      width: 120,
      cell: (item: KeyedRow) => (
        <Button
          variant="link"
          size="sm"
          icon={<IconEye size={15} stroke={strokeFor(15)} />}
          onClick={(event) => {
            event.stopPropagation();
            openDetails(item.row);
          }}
        >
          View details
        </Button>
      ),
    });
  }

  /*
   * The kit DataTable activates a row from a click only when the click is not inside a focusable
   * element, and tests that with closest(), which also matches the row itself once it is a keyboard
   * stop (tabindex 0) and the table's scroller once it overflows, so a mouse click never reaches
   * onRowActivate there (Task 121's kit gap; DrillDownTable works around it the same way). The legacy
   * rows drilled down on click, so the click is handled here, once: activatedRef says whether the kit
   * already activated the row during this click, so a fixed kit does not drill twice. Enter and Space
   * on a focused row stay the kit's.
   */
  const activateFromClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!drills || activatedRef.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest('tr');
    const body = tr?.parentElement;
    const table = tableRef.current?.querySelector('table');
    if (!tr || !body || !table || tr.closest('table') !== table || body.tagName !== 'TBODY') return;
    const control = target.closest(ROW_CONTROLS);
    if (control && tr.contains(control)) return;
    const item = shownRows[Array.from(body.children).indexOf(tr)];
    if (item) handleDrillDown(item.row);
  };

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title={SPORTS_REPORT_COPY.title}
        sub={SPORTS_REPORT_COPY.sub}
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.layout}>
        <div className={styles.columns}>
          <div className={styles.main}>
            {/* Stats Cards */}
            {kpis ? (
              <div className={styles.statsFrame}>
                <div className={styles.stats} role="group" aria-label="Sports totals">
                  {sportsKpiFigures(kpis, money).map((figure) => (
                    <Stat
                      key={figure.key}
                      label={figure.label}
                      value={figure.value}
                      note={figure.note}
                      icon={STAT_LOOK[figure.key].icon}
                      hue={STAT_LOOK[figure.key].hue}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Breadcrumbs — always visible; shows "All Sports" when at root */}
            <DrillDownBreadcrumbs
              levels={breadcrumbLevels}
              currentLevel={currentLevel}
              domain="sports"
              onLevelClick={handleBreadcrumbClick}
            />

            {/* Filters Bar */}
            <FilterBar
              activeCount={activeFiltersCount}
              onClearAll={handleClearFilters}
              search={(
                <SearchField
                  label={searchLabel(currentLevel)}
                  placeholder={searchPlaceholder(currentLevel)}
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
                dateFrom={filters?.dateFrom || REPORTING_ALL_TIME_FROM}
                dateTo={filters?.dateTo || istToday()}
                preset={datePreset}
                onChange={handlePeriodChange}
              />
            </FilterBar>

            {/* Filter Chips */}
            {filterChips.length > 0 ? <FilterChips chips={filterChips} onClearAll={clearAllFilters} /> : null}

            {/* View Tabs */}
            <div className={styles.scroller}>
              <Tabs
                className={styles.rail}
                label="View mode"
                idPrefix={VIEW_TABS_ID}
                items={TAB_ITEMS}
                value={activeViewTab}
                onChange={setActiveViewTab}
              />
            </div>

            <div
              role="tabpanel"
              id={tabPanelId(VIEW_TABS_ID, activeViewTab)}
              aria-labelledby={tabId(VIEW_TABS_ID, activeViewTab)}
              className={styles.panel}
            >
              {activeViewTab === 'breakdown' ? (
                <Card title="Breakdown" body="table">
                  {/* The wrapper only delegates row clicks (see activateFromClick); the rows carry the keyboard model. */}
                  <div
                    ref={tableRef}
                    className={styles.tableFrame}
                    data-drillable={drills || undefined}
                    onClickCapture={() => {
                      activatedRef.current = false;
                    }}
                    onClick={activateFromClick}
                  >
                    <DataTable<KeyedRow>
                      label="Sports breakdown"
                      columns={tableColumns}
                      rows={shownRows}
                      rowKey={(item) => item.key}
                      state={tableError ? 'error' : currentLevelData.loading ? 'loading' : 'ready'}
                      error={tableError?.message}
                      onRetry={handleRefresh}
                      sort={sort}
                      onSortChange={setSort}
                      onRowActivate={
                        drills
                          ? (item) => {
                              activatedRef.current = true;
                              handleDrillDown(item.row);
                            }
                          : undefined
                      }
                      pagination={{
                        current: shownPage,
                        pageSize,
                        total,
                        onChange: setCurrentPage,
                        onPageSizeChange: setPageSize,
                        pageSizeOptions: SPORTS_PAGE_SIZES,
                        formatSummary: (summary) => sportsTableSummary(summary.total),
                        variant: 'embedded',
                      }}
                    />
                  </div>
                </Card>
              ) : activeViewTab === 'overview' ? (
                <ContextCharts
                  level={currentLevel === 'campaign' ? 'all' : currentLevel}
                  domain="sports"
                  data={{
                    trends: trendsDataFormatted,
                    breakdown: currentLevelData.data,
                  }}
                  loading={trendsQuery.loading || currentLevelData.loading}
                  formatAmount={formatAmount}
                />
              ) : (
                <TrendCard
                  title={SPORTS_REPORT_COPY.trendsTitle}
                  data={trendsDataFormatted}
                  loading={trendsQuery.loading}
                  lines={SPORTS_TREND_LINES.map((line) => ({ ...line }))}
                />
              )}
            </div>
          </div>

          <div className={styles.aside}>
            <ReportDetailDrawer
              domain="sports"
              // the same filter object the legacy sidebar received (its ids are the drill-down steps' ids)
              filter={filter as DetailFilter}
              selectedPlayerId={selectedPlayerId}
              selectedAgentId={selectedAgentId}
            />
          </div>
        </div>
      </div>
    </Page>
  );
}
