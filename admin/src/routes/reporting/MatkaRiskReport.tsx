import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconCash, IconChartBar, IconChartLine, IconRefresh, IconUsers } from '@tabler/icons-react';
import clsx from 'clsx';
import {
  useMatkaKPIs,
  useMatkaTypeBreakdown,
  useMatkaMarketBreakdown,
  useMatkaSessionBreakdown,
  useMatkaAgentBreakdown,
  useMatkaPlayerBreakdown,
} from '@/modules/reporting/hooks';
import { REPORTING_ALL_TIME_FROM, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter';
import { DrillDownBreadcrumbs } from '@/modules/reporting/ui/DrillDownBreadcrumbs';
import { FilterChips } from '@/modules/reporting/ui/FilterChips';
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { useReportingStore } from '@/state/reportingStore';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { FilterBar } from '@/ui/components/FilterBar';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { SearchField } from '@/ui/components/SearchField';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { strokeFor } from '@/ui/components/icons';
import { istToday } from '@/ui/components/istDate';
import {
  MATKA_PAGE_SIZE,
  MATKA_PAGE_SIZE_OPTIONS,
  clampMatkaPage,
  filterMatkaRows,
  matkaAllTimeRange,
  matkaClearableFilterCount,
  matkaColumns,
  matkaCurrentLevel,
  matkaDrillTarget,
  matkaKpiTiles,
  matkaLevelSource,
  matkaLevelsToRemove,
  matkaPageRows,
  matkaPathFromOtherReport,
  matkaReportFilter,
  matkaRowKey,
  matkaSearchPlaceholder,
  matkaTotalText,
  sortMatkaPage,
  winRateText,
  winRateTone,
  type MatkaColumnKey,
  type MatkaKpiIcon,
  type MatkaKpis,
  type MatkaRow,
} from './matkaRiskReportModel';
import styles from './MatkaRiskReport.module.css';

/* /reporting/matka on the kit (page migration C, W3 Task 131). The six matka queries run through the
   shared reporting hooks with the legacy filter; the drill-down path, the active-filter chips and the
   period live in the shared reporting store, as before. The rules are in matkaRiskReportModel.ts. */

interface MatkaTableRow extends MatkaRow {
  rowKey: string;
}

const EMPTY_ROWS: MatkaRow[] = [];

const TILE_ICON = 18;

const KPI_ICONS: Record<MatkaKpiIcon, ReactNode> = {
  chart: <IconChartLine size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  cash: <IconCash size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  bars: <IconChartBar size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
  users: <IconUsers size={TILE_ICON} stroke={strokeFor(TILE_ICON)} />,
};

/** What a click inside a row may land on that is a control of its own, not the row. */
const ROW_CONTROLS = 'a[href], button, input, select, textarea, [contenteditable="true"]';

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
function matkaCell(key: MatkaColumnKey, row: MatkaRow, money: (value: number) => string): ReactNode {
  switch (key) {
    case 'matkaType':
      return entityCell(row.matkaType || 'N/A');
    case 'market':
      return entityCell(row.marketName || 'N/A', row.matkaType || '');
    case 'session':
      return entityCell(row.marketSession || 'N/A', row.marketName || '');
    case 'agent':
      return entityCell(row.agentName || 'N/A');
    case 'player':
      return entityCell(row.playerUsername || 'N/A', <>ID: {row.playerId}</>);
    case 'totalStakes':
      return money(row.totalStakes);
    case 'ggr':
      return (
        <span className={clsx(styles.amount, row.grossGamingRevenue >= 0 ? styles.gain : styles.loss)}>
          {money(row.grossGamingRevenue)}
        </span>
      );
    case 'betCount':
      return row.betCount.toLocaleString();
    case 'marketCount':
      return row.marketCount.toLocaleString();
    case 'sessionCount':
      return row.sessionCount.toLocaleString();
    case 'commission':
      return money(row.commission);
    case 'avgStake':
      return money(row.avgStake);
    case 'winRate':
      return <StatusPill tone={winRateTone(row.winRate)}>{winRateText(row.winRate)}</StatusPill>;
    default:
      return null;
  }
}

export default function MatkaRiskReport() {
  return (
    <RBACGuard required={[{ domain: 'reporting.matka', actions: ['view'] }]} bypassForAgents>
      <MatkaRiskReportContent />
    </RBACGuard>
  );
}

function MatkaRiskReportContent() {
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
  const [pageSize, setPageSize] = useState(MATKA_PAGE_SIZE);
  const [datePreset, setDatePreset] = useState<ReportingDatePreset>('allTime');
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const activatedRef = useRef(false);

  // On arrival the shared store's period becomes All time, as the legacy page set it on mount.
  useEffect(() => {
    setFilters(matkaAllTimeRange());
  }, [setFilters]);

  // On arrival a path left by another report (casino vendor/game, sports sport/league/event) is dropped.
  useEffect(() => {
    if (matkaPathFromOtherReport(useReportingStore.getState().drillDownPath)) {
      resetDrillDownPath();
    }
  }, [resetDrillDownPath]);

  const currentLevel = matkaCurrentLevel(drillDownPath);

  // Only the fields MatkaDrillDownFilter allows (the store's schemeType, domain etc. are left out).
  const filter = useMemo(
    () => matkaReportFilter(filters, drillDownPath, activeFilters),
    [filters, drillDownPath, activeFilters],
  );

  const { data: kpisData, refetch: refetchKpis } = useMatkaKPIs(filter);
  const { data: typeData, loading: typeLoading, error: typeError, refetch: refetchType } = useMatkaTypeBreakdown(filter);
  const { data: marketData, loading: marketLoading, error: marketError, refetch: refetchMarket } = useMatkaMarketBreakdown(filter);
  const { data: sessionData, loading: sessionLoading, error: sessionError, refetch: refetchSession } = useMatkaSessionBreakdown(filter);
  const { data: agentData, loading: agentLoading, error: agentError, refetch: refetchAgent } = useMatkaAgentBreakdown(filter);
  const { data: playerData, loading: playerLoading, error: playerError, refetch: refetchPlayer } = useMatkaPlayerBreakdown(filter);

  // Each level shows its own breakdown, filtered by the path; the figures are the KPI query's.
  const source = matkaLevelSource(currentLevel);
  const levelQueries = {
    type: { rows: typeData?.matkaTypeBreakdown, loading: typeLoading, error: typeError, refetch: refetchType },
    market: { rows: marketData?.matkaMarketBreakdown, loading: marketLoading, error: marketError, refetch: refetchMarket },
    session: { rows: sessionData?.matkaSessionBreakdown, loading: sessionLoading, error: sessionError, refetch: refetchSession },
    agent: { rows: agentData?.matkaAgentBreakdown, loading: agentLoading, error: agentError, refetch: refetchAgent },
    player: { rows: playerData?.matkaPlayerBreakdown, loading: playerLoading, error: playerError, refetch: refetchPlayer },
  };
  const level = source ? levelQueries[source] : null;
  const levelRows = (level?.rows as MatkaRow[] | null | undefined) || EMPTY_ROWS;
  const kpis = source ? (kpisData?.matkaKPIs as MatkaKpis | null | undefined) : null;

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));

  const filteredData = useMemo(
    () => filterMatkaRows(levelRows, currentLevel, searchQuery),
    [levelRows, currentLevel, searchQuery],
  );
  const total = filteredData.length;
  // A page past the last one (a drill-down from page 3 to a shorter level) shows the last page.
  const page = clampMatkaPage(currentPage, total, pageSize);

  const tableRows = useMemo<MatkaTableRow[]>(
    () => sortMatkaPage(
      matkaPageRows(filteredData, page, pageSize).map((row, index) => ({
        ...row,
        rowKey: matkaRowKey(currentLevel, row, index),
      })),
      sort,
    ),
    [currentLevel, filteredData, page, pageSize, sort],
  );

  const columns = useMemo<DataTableColumn<MatkaTableRow>[]>(() => {
    const amount = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
    return matkaColumns(currentLevel).map((spec) => ({
      key: spec.key,
      header: spec.title,
      align: spec.align,
      sort: spec.sortable ? true : undefined,
      cell: (row: MatkaTableRow) => matkaCell(spec.key, row, amount),
    }));
  }, [convertFromWhitelabelCurrency, currentLevel, formatAmount]);

  const handleDrillDown = (record: MatkaRow) => {
    const target = matkaDrillTarget(currentLevel, record);
    if (target) {
      pushDrillDownLevel(target);
    }
  };

  // Rows open only where a row carries the next level's id (the legacy click did nothing otherwise).
  const drillable = tableRows.some((row) => matkaDrillTarget(currentLevel, row) !== null);

  const activateRow = (row: MatkaTableRow) => {
    activatedRef.current = true;
    handleDrillDown(row);
  };

  /* The kit DataTable activates a row from a click only outside every focusable element, and it tests
     that with closest(), which also matches the row itself once the row is a keyboard stop (and the
     scroller once the table overflows), so a mouse click on a plain cell never reaches onRowActivate
     (kit gap, reported; modules/reporting/ui/DrillDownTable works around it the same way). The legacy
     rows opened on click, so the click is handled here, once: activatedRef records whether the kit
     already opened the row during this click. Enter and Space on a focused row stay the kit's. */
  const activateFromClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!drillable || activatedRef.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest('tr');
    const control = target.closest(ROW_CONTROLS);
    if (!tr || (control && tr.contains(control))) return;
    const table = tableHostRef.current?.querySelector('table');
    const body = tr.parentElement;
    if (!table || tr.closest('table') !== table || !body || body.tagName !== 'TBODY') return;
    const row = tableRows[Array.from(body.children).indexOf(tr)];
    if (row) handleDrillDown(row);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      resetDrillDownPath();
    } else {
      const levelsToRemove = matkaLevelsToRemove(drillDownPath.length, index);
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

  const handleRefresh = () => {
    // A failed refetch shows in the table's error state (and the hook's toast); the promise needs no handler.
    void refetchKpis().catch(() => undefined);
    void level?.refetch().catch(() => undefined);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters(matkaAllTimeRange());
    setDatePreset('allTime');
    setCurrentPage(1);
  };

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Matka Risk Report"
        sub="Analyze matka betting performance and risk exposure across all markets"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {kpis ? (
          <div className={styles.statsZone}>
            <div className={styles.stats} role="group" aria-label="Matka statistics">
              {matkaKpiTiles(kpis, money).map((tile) => (
                <Stat
                  key={tile.key}
                  label={tile.label}
                  value={tile.value}
                  note={tile.note}
                  icon={KPI_ICONS[tile.icon]}
                  hue={tile.hue}
                />
              ))}
            </div>
          </div>
        ) : null}

        {drillDownPath.length > 0 ? (
          <div className={styles.path}>
            <DrillDownBreadcrumbs
              levels={breadcrumbLevels}
              currentLevel={currentLevel}
              domain="matka"
              onLevelClick={handleBreadcrumbClick}
            />
          </div>
        ) : null}

        <FilterBar
          activeCount={matkaClearableFilterCount(searchQuery, datePreset)}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label="Search the matka report"
              placeholder={matkaSearchPlaceholder(currentLevel)}
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
            onChange={(f, t, p) => {
              setFilters({ dateFrom: f, dateTo: t });
              setDatePreset(p);
              setCurrentPage(1);
            }}
          />
        </FilterBar>

        {filterChips.length > 0 ? <FilterChips chips={filterChips} onClearAll={clearAllFilters} /> : null}

        <Card title="Matka Risk Report" body="table">
          {/* The wrapper only delegates row clicks (activateFromClick); the rows carry the keyboard model. */}
          <div
            ref={tableHostRef}
            className={styles.tableHost}
            data-drillable={drillable || undefined}
            onClickCapture={() => {
              activatedRef.current = false;
            }}
            onClick={activateFromClick}
          >
            <DataTable
              label="Matka breakdown"
              rows={tableRows}
              rowKey={(row) => row.rowKey}
              columns={columns}
              state={level?.loading ? 'loading' : level?.error ? 'error' : 'ready'}
              error={level?.error?.message}
              onRetry={() => {
                void level?.refetch().catch(() => undefined);
              }}
              empty={<EmptyState inset="none" title="No data" />}
              sort={sort}
              onSortChange={setSort}
              onRowActivate={drillable ? activateRow : undefined}
              pagination={{
                current: page,
                pageSize,
                total,
                onChange: setCurrentPage,
                onPageSizeChange: setPageSize,
                itemName: 'items',
                pageSizeOptions: MATKA_PAGE_SIZE_OPTIONS,
                formatSummary: (summary) => matkaTotalText(summary.total),
                variant: 'embedded',
              }}
            />
          </div>
        </Card>
      </div>
    </Page>
  );
}
