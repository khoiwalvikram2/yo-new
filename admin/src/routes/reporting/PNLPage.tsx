import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import {
  IconArrowDown,
  IconArrowUp,
  IconChartBar,
  IconChartLine,
  IconCurrencyRupee,
  IconDownload,
  IconRefresh,
  IconTrophy,
} from '@tabler/icons-react';
import clsx from 'clsx';
import { useReportingDateFilter } from '@/modules/reporting/reportingDateFilter';
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useAuthStore } from '@/shared/core/authStore';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { useTableExport } from '@/shared/hooks/useTableExport';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { FilterBar } from '@/ui/components/FilterBar';
import { Grid } from '@/ui/components/LayoutPrimitives';
import { Notice } from '@/ui/components/Notice';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { SearchField } from '@/ui/components/SearchField';
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl';
import { Stat } from '@/ui/components/Stat';
import { StatusPill } from '@/ui/components/StatusPill';
import { strokeFor } from '@/ui/components/icons';
import {
  PNL_DEFAULT_PAGE_SIZE,
  PNL_DOMAIN_LABELS,
  PNL_PAGE_SIZE_OPTIONS,
  calculatePnlMetrics,
  calculateTotalPnl,
  filterPnlRows,
  formatPnlChange,
  formatSignedPnl,
  isCommissionAgent,
  paginatePnlRows,
  pnlActiveFilterCount,
  pnlCopy,
  pnlDomainTone,
  pnlExportColumns,
  pnlExportTitle,
  pnlRangeDays,
  pnlRefusedTotalsText,
  pnlStatusLabel,
  pnlTotalsIssues,
  sortPnlPage,
  visiblePnlDomains,
  type PnlDataPoint,
  type PnlDomain,
} from './pnlPageModel';
import { CASINO_KPIS_QUERY, MATKA_KPIS_QUERY, PNL_QUERY, SPORTS_KPIS_QUERY } from './pnlPageQueries';
import styles from './PNLPage.module.css';

/* /reporting/pnl on the kit (page migration C, W3 Task 122). The four queries, their variables and
   options, the agent branches and every piece of copy are the legacy page's; the rules live in
   pnlPageModel.ts and the documents in pnlPageQueries.ts. */

interface PnlTableRow extends PnlDataPoint {
  rowKey: string;
}

export default function PNLPage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.pnl', actions: ['view'] }]} bypassForAgents>
      <PNLPageContent />
    </RBACGuard>
  );
}

function PNLPageContent() {
  const pageEyebrow = usePageEyebrow();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();

  const agent = useAuthStore((s) => s.agent);
  const isAgent = useAuthStore((s) => s.isAgent());
  const commissionAgent = isCommissionAgent(isAgent, agent?.schemeType);
  const copy = pnlCopy(commissionAgent);

  const { dateFrom, dateTo, preset: datePreset, handleChange: handleDateChange, reset: resetDate } =
    useReportingDateFilter('allTime');
  const [selectedDomain, setSelectedDomain] = useState<PnlDomain>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PNL_DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort | null>(null);

  // The PNL operation's range: the whole days between the two applied days, as a string.
  const rangeDays = useMemo(() => pnlRangeDays(dateFrom, dateTo), [dateFrom, dateTo]);

  const { data: pnlData, loading: pnlLoading, error: pnlError, refetch: refetchPNL } = useQuery(PNL_QUERY, {
    variables: {
      range: rangeDays,
      dateFrom,
      dateTo,
    },
    errorPolicy: 'all',
    skip: false,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  });

  const { data: sportsKPIs, loading: sportsLoading, error: sportsError } = useQuery(SPORTS_KPIS_QUERY, {
    variables: {
      filter: {
        dateFrom,
        dateTo,
      },
    },
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
    skip: false,
    notifyOnNetworkStatusChange: true,
  });

  const { data: matkaKPIs, loading: matkaLoading, error: matkaError } = useQuery(MATKA_KPIS_QUERY, {
    variables: {
      filter: {
        dateFrom,
        dateTo,
      },
    },
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  });

  const { data: casinoKPIs, loading: casinoLoading, error: casinoError } = useQuery(CASINO_KPIS_QUERY, {
    variables: {
      filter: {
        dateFrom,
        dateTo,
      },
    },
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  });

  const pnlRows = useMemo<PnlDataPoint[]>(() => pnlData?.pnl || [], [pnlData]);
  const isLoading = pnlLoading || sportsLoading || matkaLoading || casinoLoading;

  // Domain and search filters, newest first (the legacy rules, pnlPageModel.filterPnlRows).
  const filteredPNLRows = useMemo(
    () => filterPnlRows(pnlRows, {
      domain: selectedDomain,
      search: searchQuery,
      formatAmount,
      convertAmount: convertFromWhitelabelCurrency,
    }),
    [pnlRows, selectedDomain, searchQuery, formatAmount, convertFromWhitelabelCurrency],
  );

  const paginatedPNLRows = useMemo(
    () => paginatePnlRows(filteredPNLRows, currentPage, pageSize),
    [filteredPNLRows, currentPage, pageSize],
  );

  // A column sort orders the current page only, as the antd table did with the slice it was given.
  const tableRows = useMemo<readonly PnlTableRow[]>(
    () => sortPnlPage(
      paginatedPNLRows.map((row, index) => ({ ...row, rowKey: `${row.date}-${row.dimension}-${index}` })),
      sort && (sort.key === 'date' || sort.key === 'value') ? { key: sort.key, dir: sort.dir } : null,
    ),
    [paginatedPNLRows, sort],
  );

  const totalPNL = useMemo(
    () => calculateTotalPnl(
      selectedDomain,
      sportsKPIs?.sportsKPIs?.netRevenue,
      matkaKPIs?.matkaKPIs?.netRevenue,
      casinoKPIs?.casinoKPIs?.netRevenue,
      convertFromWhitelabelCurrency,
    ),
    [sportsKPIs, matkaKPIs, casinoKPIs, selectedDomain, convertFromWhitelabelCurrency],
  );

  const metrics = useMemo(() => calculatePnlMetrics(pnlRows), [pnlRows]);
  // A total the caller may not view (a refusal) and one that failed get different notices; only the
  // totals that feed the Total card count.
  const totalsIssues = pnlTotalsIssues(selectedDomain, {
    sports: sportsError,
    casino: casinoError,
    matka: matkaError,
  });

  // Columns: the P&L column and the statuses read as commission for a COMMISSION agent.
  const columns = useMemo<DataTableColumn<PnlTableRow>[]>(() => [
    {
      key: 'date',
      header: 'Date',
      minWidth: 150,
      sort: true,
      cell: (row) => (row.date ? (
        <time className={styles.dateCell} dateTime={row.date}>
          {formatDateTime(row.date, 'yyyy-MM-dd HH:mm')}
        </time>
      ) : '—'),
    },
    {
      key: 'dimension',
      header: 'Domain',
      // The server's dimensions are the three domain names and All (pnlReportingRepo), so the pill shows in full.
      cell: (row) => <StatusPill tone={pnlDomainTone(row.dimension)}>{row.dimension}</StatusPill>,
    },
    {
      key: 'value',
      header: copy.valueHeader,
      align: 'right',
      minWidth: 150,
      sort: true,
      cell: (row) => (
        <span className={clsx(styles.amount, row.value >= 0 ? styles.gain : styles.loss)}>
          {formatSignedPnl(row.value, formatAmount(convertFromWhitelabelCurrency(row.value)))}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusPill
          tone={row.value >= 0 ? 'ok' : 'neg'}
          icon={row.value >= 0
            ? <IconArrowUp size={12} stroke={strokeFor(12)} />
            : <IconArrowDown size={12} stroke={strokeFor(12)} />}
        >
          {pnlStatusLabel(row.value, commissionAgent)}
        </StatusPill>
      ),
    },
  ], [commissionAgent, convertFromWhitelabelCurrency, copy.valueHeader, formatAmount, formatDateTime]);

  const handleRefresh = () => {
    // A failed refetch shows in the table's error state; the rejected promise needs no handler of its own.
    void refetchPNL().catch(() => undefined);
  };

  const exportColumns = useMemo(
    () => pnlExportColumns(commissionAgent, formatDateTime),
    [commissionAgent, formatDateTime],
  );
  const { exporting: exportingPNL, handleExport: handleExportPNL } = useTableExport({
    data: filteredPNLRows,
    columns: exportColumns,
    filename: copy.exportFilename,
    sheetName: copy.sheetName,
    title: pnlExportTitle(copy, filteredPNLRows.length),
  });

  const activeFiltersCount = pnlActiveFilterCount(searchQuery, selectedDomain, datePreset);

  // Domain tabs: All, then each domain an admin sees or the agent's allowedDomains lists.
  const domainOptions = useMemo<SegmentedOption<PnlDomain>[]>(
    () => visiblePnlDomains(isAgent, agent?.allowedDomains).map((domain) => ({
      value: domain,
      label: PNL_DOMAIN_LABELS[domain],
    })),
    [agent?.allowedDomains, isAgent],
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    resetDate();
    setSelectedDomain('all');
    setCurrentPage(1);
  };

  const recordCount = filteredPNLRows.length;

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title={copy.title}
        sub={copy.sub}
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <Grid cols={{ base: 1, md: 2 }} gap={16} role="group" aria-label={copy.statsLabel}>
          <Stat
            label={copy.totalLabel}
            value={formatAmount(totalPNL)}
            note={`Change: ${formatPnlChange(metrics.pnlChange)}`}
            icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
            hue={totalPNL >= 0 ? 'grn' : 'red'}
          />
          <Stat
            label={copy.avgLabel}
            value={formatAmount(convertFromWhitelabelCurrency(metrics.avgPnl))}
            note={`${pnlRows.length} days`}
            icon={<IconCurrencyRupee size={18} stroke={strokeFor(18)} />}
            hue={metrics.avgPnl >= 0 ? 'grn' : 'red'}
          />
          <Stat
            label={copy.rateLabel}
            value={`${metrics.winRate.toFixed(1)}%`}
            note={`${metrics.positiveDays} profitable, ${metrics.negativeDays} loss`}
            icon={<IconChartBar size={18} stroke={strokeFor(18)} />}
            hue={metrics.winRate >= 50 ? 'grn' : 'red'}
          />
          <Stat
            label={copy.bestLabel}
            value={metrics.positiveDays}
            note={`Best: ${formatAmount(convertFromWhitelabelCurrency(metrics.maxPnl))}`}
            icon={<IconTrophy size={18} stroke={strokeFor(18)} />}
            hue="blu"
          />
        </Grid>

        {totalsIssues.failed.length > 0 ? (
          <Notice tone="warn" live="polite" title="Some totals could not be loaded">
            The figures that did load and the rows below are still shown. Change the period to try again.
          </Notice>
        ) : null}

        {/* Not live: a refusal comes back on every load for this caller, so it is part of the page. */}
        {totalsIssues.refused.length > 0 ? (
          <Notice tone="info" title="Some totals are not included">
            {pnlRefusedTotalsText(copy, totalsIssues.refused)}
          </Notice>
        ) : null}

        <FilterBar
          activeCount={activeFiltersCount}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label={copy.searchLabel}
              placeholder="Search by domain, date, amount..."
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
            dateFrom={dateFrom}
            dateTo={dateTo}
            preset={datePreset}
            onChange={(f, t, p) => {
              handleDateChange(f, t, p);
              setCurrentPage(1);
            }}
          />
        </FilterBar>

        <div className={styles.domainScroller}>
          <SegmentedControl
            className={styles.domainControl}
            label="Domain filter"
            value={selectedDomain}
            options={domainOptions}
            size="sm"
            onChange={(domain) => {
              setSelectedDomain(domain);
              setCurrentPage(1);
            }}
          />
        </div>

        <Card
          title={copy.tableTitle}
          sub={`${recordCount} ${recordCount === 1 ? 'record' : 'records'}`}
          body="table"
          tools={(
            <Button
              size="sm"
              icon={<IconDownload size={15} stroke={strokeFor(15)} />}
              loading={exportingPNL}
              onClick={handleExportPNL}
              disabled={!recordCount || isLoading}
            >
              Export Excel
            </Button>
          )}
        >
          <DataTable
            label={copy.tableTitle}
            rows={tableRows}
            rowKey={(row) => row.rowKey}
            columns={columns}
            width="default"
            state={pnlError ? 'error' : isLoading ? 'loading' : 'ready'}
            error={pnlError?.message ?? 'Unable to load the report.'}
            onRetry={handleRefresh}
            empty={(
              <EmptyState
                inset="none"
                title={copy.emptyTitle}
                description="No records match the current domain, period and search filters."
              />
            )}
            sort={sort}
            onSortChange={setSort}
            pagination={{
              current: currentPage,
              pageSize,
              total: recordCount,
              onChange: setCurrentPage,
              onPageSizeChange: setPageSize,
              itemName: 'records',
              pageSizeOptions: PNL_PAGE_SIZE_OPTIONS,
              formatSummary: ({ total }) => `Total ${total} records`,
              variant: 'embedded',
            }}
          />
        </Card>
      </div>
    </Page>
  );
}
