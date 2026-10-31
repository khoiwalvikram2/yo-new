import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { IconArrowDown, IconArrowUp, IconRefresh, IconUsers, IconWallet } from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { useSearch } from '@/shared/hooks/useSearch';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { useReportingDateFilter, type ReportingDatePreset } from '@/modules/reporting/reportingDateFilter';
import { ReportingPeriodFilter } from '@/modules/reporting/ui/ReportingPeriodFilter';
import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { FilterBar } from '@/ui/components/FilterBar';
import { Notice } from '@/ui/components/Notice';
import { Page } from '@/ui/components/Page';
import { PageHeader } from '@/ui/components/PageHeader';
import { SearchField } from '@/ui/components/SearchField';
import { Stat } from '@/ui/components/Stat';
import { strokeFor } from '@/ui/components/icons';
import {
  OVERVIEW_KPIS_QUERY,
  PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
  USERS_PAGE_QUERY,
} from './nthDepositWithdrawalQueries';
import {
  NTH_DW_PAGE_SIZE_OPTIONS,
  buildNthDwRows,
  nthDwActiveFilterCount,
  nthDwPlayerIds,
  nthDwPlayerLabel,
  nthDwStatsMap,
  nthDwSummary,
  nthDwTotals,
  reportableNthDwError,
  sortNthDwPage,
  type NthDwRow,
  type NthDwStats,
  type NthDwUser,
} from './nthDepositWithdrawalModel';
import styles from './NthDepositWithdrawalReportPage.module.css';

/* /reporting/players/nth-dw on the kit (page migration C, W3 Task 125; mockup M:2522-2530). The three
   documents live in nthDepositWithdrawalQueries.ts and the row, total and sort rules in
   nthDepositWithdrawalModel.ts, both unchanged in substance; the queries below keep their legacy
   variables, skips and policies. The layout follows the sibling Player Activity report (Task 123):
   search and the reporting period control (M:1736-1746) in the FilterBar, then the table card. */

export default function NthDepositWithdrawalReportPage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.players-activity', actions: ['view'] }]} bypassForAgents>
      <NthDepositWithdrawalReportPageContent />
    </RBACGuard>
  );
}

function NthDepositWithdrawalReportPageContent() {
  const pageEyebrow = usePageEyebrow();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { dateFrom, dateTo, preset, handleChange: setReportingDates, reset: resetReportingDates } =
    useReportingDateFilter('allTime');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const { query: searchQuery, setQuery: setSearchQuery, debouncedQuery } = useSearch({
    minLength: 0,
    debounceMs: 300,
  });

  const offset = (currentPage - 1) * pageSize;

  const onReportingDateChange = (from: string, to: string, p: ReportingDatePreset) => {
    setReportingDates(from, to, p);
    setCurrentPage(1);
  };

  const { data: usersData, loading: usersLoading, error: usersError, refetch: refetchUsers } = useQuery(USERS_PAGE_QUERY, {
    variables: {
      query: debouncedQuery.trim() || undefined,
      offset,
      limit: pageSize,
    },
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  });

  const playerIds = useMemo(() => {
    const items = (usersData?.usersPage?.items ?? []) as NthDwUser[];
    return nthDwPlayerIds(items);
  }, [usersData]);

  const { data: dwData, loading: dwLoading, error: dwError, refetch: refetchDw } = useQuery(
    PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
    {
      variables: { ids: playerIds, dateFrom, dateTo },
      skip: playerIds.length === 0,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const { data: overviewData, loading: overviewLoading, error: overviewError, refetch: refetchOverview } = useQuery(
    OVERVIEW_KPIS_QUERY,
    {
      variables: { dateRange: { dateFrom, dateTo } },
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const statsMap = useMemo(
    () => nthDwStatsMap((dwData?.playerActivityDepositWithdrawalStats ?? []) as NthDwStats[]),
    [dwData],
  );

  const tableData: NthDwRow[] = useMemo(() => {
    const items = (usersData?.usersPage?.items ?? []) as NthDwUser[];
    return buildNthDwRows(items, statsMap);
  }, [usersData, statsMap]);

  /* The server pages the players; a sort orders the page on screen only, as the legacy table did. */
  const tableRows = useMemo(() => sortNthDwPage(tableData, sort), [tableData, sort]);

  const total = usersData?.usersPage?.total ?? 0;
  const isLoading = usersLoading || dwLoading || overviewLoading;

  const totals = useMemo(() => nthDwTotals(overviewData?.overviewKPIs), [overviewData]);

  /* errorPolicy 'all' keeps whatever arrived; the page now says when something failed (legacy: silent).
     A permission refusal stays silent as before: it comes back on every load for that caller. */
  const tableError = reportableNthDwError(usersError)
    ?? (playerIds.length === 0 ? undefined : reportableNthDwError(dwError));
  const totalsError = reportableNthDwError(overviewError);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedQuery]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchUsers(),
        refetchOverview(),
        playerIds.length > 0 ? refetchDw() : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const activeFiltersCount = nthDwActiveFilterCount(searchQuery, preset);
  const handleClearFilters = () => {
    setSearchQuery('');
    resetReportingDates();
    setCurrentPage(1);
  };

  const columns = useMemo<DataTableColumn<NthDwRow>[]>(() => [
    {
      key: 'player',
      header: 'Player',
      sort: true,
      width: 220,
      cell: (row) => (
        <div className={styles.playerCell}>
          <Link to={`/players/profile/${row.id}`} className={styles.playerLink}>
            {nthDwPlayerLabel(row)}
          </Link>
          {row.phone ? <span className={styles.playerPhone}>{row.phone}</span> : null}
        </div>
      ),
    },
    {
      key: 'agentName',
      header: 'Agent',
      sort: true,
      minWidth: 120,
      cell: (row) => row.agentName || '—',
    },
    {
      key: 'totalDepositAmount',
      header: 'Total Deposit',
      align: 'right',
      sort: true,
      minWidth: 130,
      cell: (row) => (
        <span className={clsx(styles.deposit, styles.lifetime)}>
          {formatAmount(convertFromWhitelabelCurrency(row.totalDepositAmount))}
        </span>
      ),
    },
    {
      key: 'rangeDepositAmount',
      header: 'Range Deposit',
      align: 'right',
      sort: true,
      minWidth: 130,
      cell: (row) => (
        <span className={styles.deposit}>
          {formatAmount(convertFromWhitelabelCurrency(row.rangeDepositAmount))}
        </span>
      ),
    },
    {
      key: 'totalWithdrawalAmount',
      header: 'Total Withdraw',
      align: 'right',
      sort: true,
      minWidth: 130,
      cell: (row) => (
        <span className={clsx(styles.withdrawal, styles.lifetime)}>
          {formatAmount(convertFromWhitelabelCurrency(row.totalWithdrawalAmount))}
        </span>
      ),
    },
    {
      key: 'rangeWithdrawalAmount',
      header: 'Range Withdraw',
      align: 'right',
      sort: true,
      minWidth: 130,
      cell: (row) => (
        <span className={styles.withdrawal}>
          {formatAmount(convertFromWhitelabelCurrency(row.rangeWithdrawalAmount))}
        </span>
      ),
    },
  ], [convertFromWhitelabelCurrency, formatAmount]);

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Nth D/W"
        sub="Player deposit and withdrawal totals — all-time and date range. Times in IST."
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => void handleRefresh()}
            loading={isRefreshing}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {/* Stats Cards */}
        <div className={styles.statsFrame}>
          <div className={styles.statGrid}>
            <Stat
              label="Players"
              value={total.toLocaleString()}
              note={`${tableData.length} on this page`}
              icon={<IconUsers size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
            <Stat
              label="Total Deposits"
              value={formatAmount(convertFromWhitelabelCurrency(totals.totalDeposit))}
              icon={<IconArrowDown size={18} stroke={strokeFor(18)} />}
              hue="grn"
            />
            <Stat
              label="Total Withdrawals"
              value={formatAmount(convertFromWhitelabelCurrency(totals.totalWithdraw))}
              icon={<IconArrowUp size={18} stroke={strokeFor(18)} />}
              hue="red"
            />
            <Stat
              label="Net Flow"
              value={formatAmount(convertFromWhitelabelCurrency(totals.netFlow))}
              icon={<IconWallet size={18} stroke={strokeFor(18)} />}
              hue="ind"
            />
          </div>
        </div>

        {totalsError ? (
          <Notice tone="warn" title="Some totals could not be loaded">
            The figures that did load are shown. Refresh to try again.
          </Notice>
        ) : null}

        {/* Filters Bar — same responsive pattern as Player Activity Report */}
        <FilterBar
          activeCount={activeFiltersCount}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label="Search players"
              placeholder="Search by username, name, phone, ID..."
              size="sm"
              value={searchQuery ?? ''}
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
            preset={preset}
            onChange={onReportingDateChange}
          />
        </FilterBar>

        {/* Data Table Card */}
        <Card
          className={styles.tableCard}
          title="Deposit & Withdrawal Summary"
          sub={nthDwSummary(total)}
          body="table"
        >
          <DataTable
            label="Deposit and withdrawal summary"
            rows={tableRows}
            rowKey={(row) => row.id}
            columns={columns}
            width="wide"
            state={tableError ? 'error' : isLoading ? 'loading' : 'ready'}
            error={tableError?.message ?? 'Unable to load players.'}
            onRetry={() => void handleRefresh()}
            empty={(
              <EmptyState
                inset="none"
                title="No players found"
                description="Try adjusting your search or date range."
              />
            )}
            sort={sort}
            onSortChange={setSort}
            pagination={{
              total,
              current: currentPage,
              pageSize,
              onChange: setCurrentPage,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setCurrentPage(1);
              },
              pageSizeOptions: NTH_DW_PAGE_SIZE_OPTIONS,
              variant: 'embedded',
            }}
          />
        </Card>
      </div>
    </Page>
  );
}
