import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  IconCash,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconRefresh,
  IconTable,
  IconUsers,
} from '@tabler/icons-react';
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
import {
  useCasinoKPIs,
  useCasinoTrends,
  useCasinoVendorBreakdown,
  useCasinoGameBreakdown,
} from '@/modules/reporting/hooks';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useReportingStore } from '@/state/reportingStore';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
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
  CASINO_DEFAULT_PAGE_SIZE,
  CASINO_PAGE_SIZE_OPTIONS,
  CASINO_SORTERS,
  CASINO_TREND_LINES,
  CASINO_VIEWS,
  casinoActiveFilterCount,
  casinoCount,
  casinoCrumbs,
  casinoCurrentLevel,
  casinoFilterChips,
  casinoGgrTone,
  casinoKpiTiles,
  casinoPageRows,
  casinoReportFilter,
  casinoRowAction,
  casinoRowKey,
  casinoRtpPercent,
  casinoRtpText,
  casinoRtpTone,
  casinoSearchLabel,
  casinoSearchPlaceholder,
  casinoSidebarFilter,
  casinoSortKeys,
  casinoSummary,
  casinoTableLabel,
  casinoTrendRows,
  clampCasinoPage,
  filterCasinoRows,
  isPathFromOtherReport,
  levelsToPop,
  selectedCasinoRowKey,
  type CasinoBreakdownRecord,
  type CasinoKpis,
  type CasinoKpiTile,
  type CasinoLevel,
  type CasinoSortKey,
  type CasinoView,
} from './casinoOverviewReportModel';
import styles from './CasinoOverviewReport.module.css';

/* /reporting/casino on the kit (page migration C, W3 Task 130). The four data hooks, their filter, the
   drill-down (all -> vendor -> game, a game selected in place), the RBAC guard and every piece of copy
   are the legacy page's; the rules live in casinoOverviewReportModel.ts, and the drill-down pieces are
   the kit versions in modules/reporting/ui (Tasks 120 and 121). */

const VIEW_TABS_ID = 'casino-report-view';
const TAB_ICON = 14;
const STAT_ICON = 18;

/* Decorative glyphs; the labels carry the meaning. */
const VIEW_ICONS: Readonly<Record<CasinoView, ReactNode>> = {
  breakdown: <IconTable size={TAB_ICON} stroke={strokeFor(TAB_ICON)} />,
  overview: <IconChartPie size={TAB_ICON} stroke={strokeFor(TAB_ICON)} />,
  trends: <IconChartLine size={TAB_ICON} stroke={strokeFor(TAB_ICON)} />,
};

/* The legacy cards' glyphs and colours on the kit's decorative ramp (blue, green, grey, blue; the kit
   has no grey, so the bets tile takes indigo). No hue carries meaning. */
const KPI_LOOK: Readonly<Record<CasinoKpiTile['key'], { icon: ReactNode; hue: StatHue }>> = {
  ggr: { icon: <IconChartLine size={STAT_ICON} stroke={strokeFor(STAT_ICON)} />, hue: 'blu' },
  stakes: { icon: <IconCash size={STAT_ICON} stroke={strokeFor(STAT_ICON)} />, hue: 'grn' },
  bets: { icon: <IconChartBar size={STAT_ICON} stroke={strokeFor(STAT_ICON)} />, hue: 'ind' },
  players: { icon: <IconUsers size={STAT_ICON} stroke={strokeFor(STAT_ICON)} />, hue: 'blu' },
};

/** What a click inside a row may land on that is a control of its own, not the row. */
const ROW_CONTROLS = 'a[href], button, input, select, textarea, [contenteditable="true"]';

interface BreakdownRow {
  key: string;
  record: CasinoBreakdownRecord;
}

function sortBy(key: CasinoSortKey) {
  return (a: BreakdownRow, b: BreakdownRow) => CASINO_SORTERS[key](a.record, b.record);
}

/**
 * The legacy columns per level, cell for cell. A name cell carries its row key for click lookup. A
 * column's key is its sort key, and casinoSortKeys(level) names the columns that sort.
 */
function breakdownColumns(
  level: CasinoLevel,
  money: (value: number) => string,
  selectedKey: string | undefined,
): DataTableColumn<BreakdownRow>[] {
  const sortable: readonly string[] = casinoSortKeys(level);
  const withSort = (columns: DataTableColumn<BreakdownRow>[]) =>
    columns.map((column) =>
      sortable.includes(column.key) ? { ...column, sort: sortBy(column.key as CasinoSortKey) } : column,
    );

  const figures: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'totalStakes',
      header: 'Total Stakes',
      align: 'right',
      cell: (row) => money(row.record.totalStakes as number),
    },
    {
      key: 'totalPayouts',
      header: 'Total Payouts',
      align: 'right',
      cell: (row) => money(row.record.totalPayouts ?? 0),
    },
    {
      key: 'ggr',
      header: 'GGR',
      align: 'right',
      cell: (row) => (
        <span className={casinoGgrTone(row.record.grossGamingRevenue) === 'gain' ? styles.gain : styles.loss}>
          {money(row.record.grossGamingRevenue as number)}
        </span>
      ),
    },
    {
      key: 'betCount',
      header: 'Bets',
      align: 'right',
      cell: (row) => casinoCount(row.record.betCount),
    },
    {
      key: 'playerCount',
      header: 'Players',
      align: 'right',
      cell: (row) => casinoCount(row.record.playerCount),
    },
  ];

  if (level === 'all') {
    return withSort([
      {
        key: 'vendor',
        header: 'Vendor',
        emphasis: 'key',
        cell: (row) => (
          <span className={styles.nameCell} data-row-key={row.key}>
            <span>{row.record.vendorName || 'N/A'}</span>
          </span>
        ),
      },
      ...figures,
      {
        key: 'gameCount',
        header: 'Games',
        align: 'right',
        cell: (row) => casinoCount(row.record.gameCount),
      },
    ]);
  }
  if (level === 'vendor') {
    return withSort([
      {
        key: 'game',
        header: 'Game',
        emphasis: 'key',
        cell: (row) => (
          <span className={styles.nameCell} data-row-key={row.key}>
            <span>{row.record.gameName || 'N/A'}</span>
            {row.record.vendorName ? <span className={styles.subLine}>{row.record.vendorName}</span> : null}
            {row.key === selectedKey ? <span className={styles.srOnly}>Selected</span> : null}
          </span>
        ),
      },
      ...figures,
      {
        key: 'rtp',
        header: 'RTP',
        align: 'right',
        cell: (row) => {
          const percent = casinoRtpPercent(row.record.rtp);
          return <StatusPill tone={casinoRtpTone(percent)}>{casinoRtpText(percent)}</StatusPill>;
        },
      },
    ]);
  }
  return [];
}

interface BreakdownTableProps {
  level: CasinoLevel;
  rows: BreakdownRow[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  selectedKey?: string;
  /** A row clicked with the mouse (delegated here, see below). */
  onRowClick: (record: CasinoBreakdownRecord) => void;
  /** A row the kit activated: Enter or Space on the focused row (or a click, once the kit gap is fixed). */
  onRowActivate: (record: CasinoBreakdownRecord) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  money: (value: number) => string;
}

/**
 * The breakdown table. It mounts only while its tab is shown, so its sort resets when the tab is left,
 * as the legacy antd table's did, and a sort orders the rows of the current page, as antd's did.
 *
 * Rows open on click, and on Enter or Space. The kit DataTable activates a clicked row only when the
 * click is inside no focusable element, and its closest() test also matches the row itself once the
 * row is a keyboard stop (tabindex 0), and the table's scroller once it overflows, so a mouse click on
 * a plain cell never reaches onRowActivate (Task 121's kit gap; a page task does not edit kit files).
 * The click is handled here instead, once: activatedRef records whether the kit already activated the
 * row during this click, so a fixed kit does not open it twice.
 */
function BreakdownTable({
  level,
  rows,
  total,
  page,
  pageSize,
  loading,
  error,
  onRetry,
  selectedKey,
  onRowClick,
  onRowActivate,
  onPageChange,
  onPageSizeChange,
  money,
}: BreakdownTableProps) {
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const activatedRef = useRef(false);

  const activateFromClick = (event: MouseEvent<HTMLDivElement>) => {
    if (activatedRef.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest('tr');
    if (!tr || tr.parentElement?.tagName !== 'TBODY') return;
    const control = target.closest(ROW_CONTROLS);
    if (control && tr.contains(control)) return;
    const key = tr.querySelector('[data-row-key]')?.getAttribute('data-row-key');
    const row = rows.find((candidate) => candidate.key === key);
    if (row) onRowClick(row.record);
  };

  return (
    // The wrapper only delegates row clicks (see above); the rows carry the keyboard model.
    <div
      onClickCapture={() => {
        activatedRef.current = false;
      }}
      onClick={activateFromClick}
    >
      <DataTable<BreakdownRow>
        columns={breakdownColumns(level, money, selectedKey)}
        rows={rows}
        rowKey={(row) => row.key}
        label={casinoTableLabel(level)}
        state={loading ? 'loading' : error ? 'error' : 'ready'}
        error={error}
        onRetry={onRetry}
        sort={sort}
        onSortChange={setSort}
        onRowActivate={(row) => {
          activatedRef.current = true;
          onRowActivate(row.record);
        }}
        openRowKey={selectedKey}
        width="wide"
        pagination={{
          variant: 'embedded',
          current: page,
          pageSize,
          total,
          onChange: onPageChange,
          onPageSizeChange,
          pageSizeOptions: CASINO_PAGE_SIZE_OPTIONS,
          formatSummary: (summary) => casinoSummary(summary.total),
        }}
      />
    </div>
  );
}

export default function CasinoOverviewReport() {
  return (
    <RBACGuard required={[{ domain: 'reporting.casino', actions: ['view'] }]} bypassForAgents>
      <CasinoOverviewReportContent />
    </RBACGuard>
  );
}

function CasinoOverviewReportContent() {
  const pageEyebrow = usePageEyebrow();
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

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(CASINO_DEFAULT_PAGE_SIZE);
  const [activeViewTab, setActiveViewTab] = useState<CasinoView>('breakdown');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [datePreset, setDatePreset] = useState<ReportingDatePreset>('allTime');
  // The path as the page found it: the reset below reads it once, on mount, as the legacy effect did.
  const pathOnMount = useRef(drillDownPath);
  const mainRef = useRef<HTMLDivElement>(null);
  // Set when a row activation will replace the focused row (see handleRowActivate).
  const restoreRowFocus = useRef(false);

  // Every visit opens on All time (the shared store keeps the period another report left).
  useEffect(() => {
    setFilters(computeReportingDateRange('allTime'));
  }, [setFilters]);

  // Reset drill-down when path is from another report (e.g. Sports sport/league/event)
  useEffect(() => {
    if (isPathFromOtherReport(pathOnMount.current)) {
      resetDrillDownPath();
    }
  }, [resetDrillDownPath]);

  const currentLevel = casinoCurrentLevel(drillDownPath);

  // Only fields allowed by CasinoDrillDownFilter pass (no schemeType, domain, etc. from the shared store)
  const filter = useMemo(
    () => casinoReportFilter(filters, drillDownPath, activeFilters, istToday()),
    [filters, drillDownPath, activeFilters],
  );

  const { data: kpisData, refetch: refetchKPIs } = useCasinoKPIs(filter);
  const { data: trendsData, loading: trendsLoading, refetch: refetchTrends } = useCasinoTrends(filter);
  const {
    data: vendorData,
    loading: vendorLoading,
    error: vendorError,
    refetch: refetchVendor,
  } = useCasinoVendorBreakdown(filter);
  const {
    data: gameData,
    loading: gameLoading,
    error: gameError,
    refetch: refetchGame,
  } = useCasinoGameBreakdown(filter);

  const currentLevelData = useMemo(() => {
    if (currentLevel === 'all') {
      return {
        data: (vendorData?.casinoVendorBreakdown || []) as CasinoBreakdownRecord[],
        loading: vendorLoading,
        error: vendorError,
        kpis: kpisData?.casinoKPIs as CasinoKpis | null | undefined,
      };
    }
    if (currentLevel === 'vendor') {
      return {
        data: (gameData?.casinoGameBreakdown || []) as CasinoBreakdownRecord[],
        loading: gameLoading,
        error: gameError,
        kpis: kpisData?.casinoKPIs as CasinoKpis | null | undefined,
      };
    }
    return { data: [] as CasinoBreakdownRecord[], loading: false, error: undefined, kpis: null };
  }, [currentLevel, vendorData, gameData, vendorLoading, gameLoading, vendorError, gameError, kpisData]);

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));

  const handleRowClick = (record: CasinoBreakdownRecord) => {
    const action = casinoRowAction(currentLevel, record, selectedGameId);
    if (action.kind === 'select') {
      // At vendor level we show games; clicking a game selects it (no drill). Click same game again to deselect.
      setSelectedGameId(action.gameId);
      setCurrentPage(1);
      return;
    }
    if (action.kind === 'drill') {
      setSelectedGameId(null);
      if (action.level) pushDrillDownLevel(action.level);
    }
    setCurrentPage(1);
  };

  /*
   * A row the kit activated (Enter or Space on the focused row). A drill, or a game picked on a page past
   * the first, replaces the rows and unmounts the focused one, which would drop focus to the document;
   * the commit that does so moves focus to the current crumb instead (the layout effect below). Picking
   * a game on page 1 keeps its row, and focus stays on it.
   */
  const handleRowActivate = (record: CasinoBreakdownRecord) => {
    const action = casinoRowAction(currentLevel, record, selectedGameId);
    restoreRowFocus.current = (action.kind === 'drill' && action.level !== null) || currentPage !== 1;
    handleRowClick(record);
  };

  // No dependency list: the flag is read once, in the commit that follows the activation.
  useLayoutEffect(() => {
    if (!restoreRowFocus.current) return;
    restoreRowFocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    mainRef.current?.querySelector<HTMLElement>('nav[aria-label="Drill-down path"] [aria-current]')?.focus();
  });

  const handleBreadcrumbClick = (index: number) => {
    setSelectedGameId(null);
    if (index === -1) {
      resetDrillDownPath();
    } else {
      const levelsToRemove = levelsToPop(drillDownPath.length, index);
      for (let i = 0; i < levelsToRemove; i++) {
        popDrillDownLevel();
      }
    }
  };

  const breadcrumbLevels = casinoCrumbs(drillDownPath).map((crumb, index) => ({
    ...crumb,
    onClick: () => handleBreadcrumbClick(index),
  }));

  const sidebarFilter = useMemo(
    () => casinoSidebarFilter(filter, drillDownPath, selectedGameId, refreshKey),
    [filter, drillDownPath, selectedGameId, refreshKey],
  );

  const filterChips = casinoFilterChips(activeFilters).map((chip) => ({
    ...chip,
    onRemove: () => removeFilter(chip.key),
  }));

  const trendsDataFormatted = casinoTrendRows(trendsData?.casinoTrends, convertFromWhitelabelCurrency);

  // Filter data by search query
  const filteredData = useMemo(
    () => filterCasinoRows(currentLevelData.data, searchQuery, currentLevel),
    [currentLevelData.data, searchQuery, currentLevel],
  );

  // Paginate data; a page past the end is clamped into range first
  const page = clampCasinoPage(currentPage, filteredData.length, pageSize);
  const paginatedRows = useMemo(
    () =>
      casinoPageRows(filteredData, currentPage, pageSize).map((record, index) => ({
        key: casinoRowKey(currentLevel, record, index),
        record,
      })),
    [filteredData, currentPage, pageSize, currentLevel],
  );

  const kpis = currentLevelData.kpis;
  const activeFiltersCount = casinoActiveFilterCount(searchQuery, datePreset);

  // A failed refetch shows through the queries' own error state and toasts; the promise is not left unhandled.
  const ignoreFailure = () => undefined;

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    void refetchKPIs().catch(ignoreFailure);
    void refetchTrends().catch(ignoreFailure);
    void refetchVendor().catch(ignoreFailure);
    void refetchGame().catch(ignoreFailure);
  };

  const retryBreakdown = () => {
    const retry = currentLevel === 'vendor' ? refetchGame : refetchVendor;
    void retry().catch(ignoreFailure);
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

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Casino Overview Report"
        sub="Analyze casino gaming performance and revenue across all vendors"
        actions={
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        }
      />

      <div className={styles.layout}>
        <div className={styles.columns}>
          <div ref={mainRef} className={styles.main}>
            {/* Stats Cards */}
            {kpis ? (
              <div className={styles.statsZone}>
                <div className={styles.stats} role="group" aria-label="Casino totals">
                  {casinoKpiTiles(kpis, formatAmount, convertFromWhitelabelCurrency).map((tile) => (
                    <Stat
                      key={tile.key}
                      label={tile.label}
                      value={tile.value}
                      note={tile.note}
                      icon={KPI_LOOK[tile.key].icon}
                      hue={KPI_LOOK[tile.key].hue}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Breadcrumbs */}
            <DrillDownBreadcrumbs
              levels={breadcrumbLevels}
              currentLevel={currentLevel}
              domain="casino"
              onLevelClick={handleBreadcrumbClick}
            />

            {/* Filters Bar — under 1024px of its own width the period moves into the kit Filters popover */}
            <FilterBar
              activeCount={activeFiltersCount}
              onClearAll={handleClearFilters}
              search={
                <SearchField
                  label={casinoSearchLabel(currentLevel)}
                  placeholder={casinoSearchPlaceholder(currentLevel)}
                  size="sm"
                  value={searchQuery}
                  onChange={(value) => {
                    setSearchQuery(value);
                    setCurrentPage(1);
                  }}
                />
              }
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
              <Tabs<CasinoView>
                className={styles.rail}
                label="View mode"
                idPrefix={VIEW_TABS_ID}
                value={activeViewTab}
                onChange={setActiveViewTab}
                items={CASINO_VIEWS.map((view) => ({ ...view, icon: VIEW_ICONS[view.value] }))}
              />
            </div>

            <div
              role="tabpanel"
              id={tabPanelId(VIEW_TABS_ID, activeViewTab)}
              aria-labelledby={tabId(VIEW_TABS_ID, activeViewTab)}
              className={styles.panel}
            >
              {/* Breakdown Tab */}
              {activeViewTab === 'breakdown' ? (
                <Card title="Casino Overview Report" body="table">
                  <BreakdownTable
                    level={currentLevel}
                    rows={paginatedRows}
                    total={filteredData.length}
                    page={page}
                    pageSize={pageSize}
                    loading={currentLevelData.loading}
                    error={currentLevelData.error?.message}
                    onRetry={retryBreakdown}
                    selectedKey={selectedCasinoRowKey(currentLevel, selectedGameId)}
                    onRowClick={handleRowClick}
                    onRowActivate={handleRowActivate}
                    onPageChange={setCurrentPage}
                    onPageSizeChange={setPageSize}
                    money={money}
                  />
                </Card>
              ) : null}

              {/* Overview Tab */}
              {activeViewTab === 'overview' ? (
                <ContextCharts
                  level={currentLevel}
                  domain="casino"
                  data={{
                    trends: trendsDataFormatted,
                    breakdown: currentLevelData.data,
                  }}
                  loading={trendsLoading || currentLevelData.loading}
                  formatAmount={formatAmount}
                />
              ) : null}

              {/* Trends Tab */}
              {activeViewTab === 'trends' ? (
                <TrendCard
                  title="Performance Trends"
                  data={trendsDataFormatted}
                  loading={trendsLoading}
                  lines={[...CASINO_TREND_LINES]}
                />
              ) : null}
            </div>
          </div>

          {/* Contributors (the legacy sidebar) */}
          <div className={styles.aside}>
            <ReportDetailDrawer domain="casino" filter={sidebarFilter} />
          </div>
        </div>
      </div>
    </Page>
  );
}
