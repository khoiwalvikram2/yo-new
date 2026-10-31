import { useMemo, useState } from 'react';
import { IconDownload, IconInbox } from '@tabler/icons-react';
import { useQuery } from '@apollo/client';
import { DASHBOARD_TRENDS_QUERY } from '../graphql';
import { useDashboardStore } from '@/state/dashboardStore';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { Button } from '@/ui/components/Button';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
  type DataTableSortDirection,
} from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import styles from './tables.module.css';

interface FinancialSummaryRow {
  key: string;
  date: string;
  deposits: number;
  withdrawals: number;
  netDeposits: number;
  ggr: number;
  ngr: number;
}

interface FinancialTotals {
  deposits: number;
  withdrawals: number;
  netDeposits: number;
  ggr: number;
  ngr: number;
}

interface DashboardTrendPoint {
  date: string;
  deposits?: number | null;
  withdrawals?: number | null;
  netDeposits?: number | null;
  ggr?: number | null;
  ngr?: number | null;
}

interface DashboardTrendsData {
  dashboardTrends?: DashboardTrendPoint[] | null;
}

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

type SortKey = 'date' | 'deposits' | 'withdrawals' | 'netDeposits' | 'ggr' | 'ngr';
interface SortState {
  key: SortKey;
  dir: DataTableSortDirection;
}

const COMPARATORS: Record<SortKey, (a: FinancialSummaryRow, b: FinancialSummaryRow) => number> = {
  date: (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  deposits: (a, b) => a.deposits - b.deposits,
  withdrawals: (a, b) => a.withdrawals - b.withdrawals,
  netDeposits: (a, b) => a.netDeposits - b.netDeposits,
  ggr: (a, b) => a.ggr - b.ggr,
  ngr: (a, b) => a.ngr - b.ngr,
};

const EMPTY_TOTALS: FinancialTotals = {
  deposits: 0,
  withdrawals: 0,
  netDeposits: 0,
  ggr: 0,
  ngr: 0,
};

export function FinancialSummaryTable() {
  const { getDateRangeForQuery } = useDashboardStore();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDate } = useFormatDate();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<SortState | null>({ key: 'date', dir: 'desc' });

  const dateRange = getDateRangeForQuery();

  const { data, loading, error } = useQuery<DashboardTrendsData>(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange },
    pollInterval: 60000,
    errorPolicy: 'all',
  });

  const tableData = useMemo<FinancialSummaryRow[]>(() => {
    if (!data?.dashboardTrends) return [];

    return data.dashboardTrends.map((point, index) => ({
      key: `${point.date}-${index}`,
      date: formatDate(point.date, 'yyyy MMM d'),
      // The backend already returns these three fields in local currency.
      deposits: point.deposits || 0,
      withdrawals: point.withdrawals || 0,
      netDeposits: point.netDeposits || 0,
      // GGR/NGR still come from bet tables and keep the whitelabel conversion.
      ggr: convertFromWhitelabelCurrency(point.ggr || 0),
      ngr: convertFromWhitelabelCurrency(point.ngr || 0),
    }));
  }, [data, convertFromWhitelabelCurrency, formatDate]);

  const totals = useMemo<FinancialTotals>(
    () =>
      tableData.reduce(
        (acc, row) => ({
          deposits: acc.deposits + row.deposits,
          withdrawals: acc.withdrawals + row.withdrawals,
          netDeposits: acc.netDeposits + row.netDeposits,
          ggr: acc.ggr + row.ggr,
          ngr: acc.ngr + row.ngr,
        }),
        EMPTY_TOTALS,
      ),
    [tableData],
  );

  const sortedData = useMemo<FinancialSummaryRow[]>(() => {
    if (!sort) return tableData;
    const compare = COMPARATORS[sort.key];
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...tableData].sort((a, b) => factor * compare(a, b));
  }, [tableData, sort]);

  const total = sortedData.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, lastPage);
  const start = (page - 1) * pageSize;
  const pageRows = sortedData.slice(start, start + pageSize);

  const columns = useMemo<DataTableColumn<FinancialSummaryRow>[]>(
    () => [
      {
        key: 'date',
        header: 'Date',
        cell: (row) => row.date,
        sort: true,
        footer: total ? 'Total' : undefined,
      },
      {
        key: 'deposits',
        header: 'Deposits',
        cell: (row) => formatAmount(row.deposits),
        align: 'right',
        sort: true,
        footer: total ? formatAmount(totals.deposits) : undefined,
      },
      {
        key: 'withdrawals',
        header: 'Withdrawals',
        cell: (row) => formatAmount(row.withdrawals),
        align: 'right',
        sort: true,
        footer: total ? formatAmount(totals.withdrawals) : undefined,
      },
      {
        key: 'netDeposits',
        header: 'Net Deposits',
        cell: (row) => (
          <span className={row.netDeposits >= 0 ? styles.positive : styles.negative}>
            {formatAmount(row.netDeposits)}
          </span>
        ),
        align: 'right',
        sort: true,
        footer: total ? (
          <span className={totals.netDeposits >= 0 ? styles.positive : styles.negative}>
            {formatAmount(totals.netDeposits)}
          </span>
        ) : undefined,
      },
      {
        key: 'ggr',
        header: 'GGR',
        cell: (row) => formatAmount(row.ggr),
        align: 'right',
        sort: true,
        footer: total ? formatAmount(totals.ggr) : undefined,
      },
      {
        key: 'ngr',
        header: 'NGR',
        cell: (row) => formatAmount(row.ngr),
        align: 'right',
        sort: true,
        footer: total ? formatAmount(totals.ngr) : undefined,
      },
    ],
    [formatAmount, total, totals],
  );

  const financialExportColumns = useMemo<TableExportColumn<FinancialSummaryRow>[]>(
    () => [
      { header: 'Date', key: 'date', width: 14, getter: (row) => row.date },
      { header: 'Deposits', key: 'deposits', width: 14, getter: (row) => row.deposits },
      { header: 'Withdrawals', key: 'withdrawals', width: 14, getter: (row) => row.withdrawals },
      { header: 'Net Deposits', key: 'netDeposits', width: 14, getter: (row) => row.netDeposits },
      { header: 'GGR', key: 'ggr', width: 14, getter: (row) => row.ggr },
      { header: 'NGR', key: 'ngr', width: 14, getter: (row) => row.ngr },
    ],
    [],
  );

  const { exporting, handleExport } = useTableExport({
    data: tableData,
    columns: financialExportColumns,
    filename: 'Financial-Summary',
    sheetName: 'Financial Summary',
    title: `Financial Summary — ${tableData.length} row(s)`,
  });

  if (loading && !data) {
    return <LoadingState label="Loading financial summary" minHeight={256} />;
  }

  if (error && !data) {
    return (
      <div className={styles.feedback}>
        <Notice tone="error">Failed to load financial summary: {error.message}</Notice>
      </div>
    );
  }

  const handlePage = (next: number) => {
    setCurrentPage(Math.min(Math.max(1, next), lastPage));
  };

  const handlePageSize = (next: number) => {
    if (next === pageSize) return;
    setPageSize(next || DEFAULT_PAGE_SIZE);
    setCurrentPage(1);
  };

  const handleSort = (next: DataTableSort | null) => {
    setSort(next ? { key: next.key as SortKey, dir: next.dir } : null);
  };

  return (
    <DataTable
      columns={columns}
      rows={pageRows}
      rowKey={(row) => row.key}
      label="Financial summary"
      sort={sort}
      onSortChange={handleSort}
      empty={<EmptyState title="No data" icon={<IconInbox size={20} stroke={1.45} />} />}
      toolbar={
        <Button
          size="sm"
          icon={<IconDownload size={15} stroke={1.75} />}
          onClick={handleExport}
          loading={exporting}
          disabled={!tableData.length || loading}
        >
          Export Excel
        </Button>
      }
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: handlePage,
        onPageSizeChange: handlePageSize,
        itemName: 'rows',
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        formatSummary: ({ start: rangeStart, end, total: rowTotal }) => (
          <>{rangeStart}-{end} of {rowTotal} rows</>
        ),
        hidePageSizeLabel: true,
        formatPageSizeOption: (option) => `${option} / page`,
        variant: 'embedded',
      }}
    />
  );
}
