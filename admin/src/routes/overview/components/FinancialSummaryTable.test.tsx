import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DASHBOARD_TRENDS_QUERY } from '../graphql';
import { FinancialSummaryTable } from './FinancialSummaryTable';
import styles from './tables.module.css';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  convert: vi.fn((value: number) => value * 10),
  formatAmount: vi.fn((value: number) => `AMT:${value}`),
  formatDate: vi.fn((value: string, pattern: string) => {
    void pattern;
    return value.slice(0, 10);
  }),
  handleExport: vi.fn(),
  exportConfig: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>();
  return { ...actual, useQuery: mocks.useQuery };
});

vi.mock('@/state/dashboardStore', () => ({
  useDashboardStore: () => ({ getDateRangeForQuery: () => mocks.dateRange }),
}));

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: mocks.formatAmount,
    convertFromWhitelabelCurrency: mocks.convert,
  }),
}));

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDate: mocks.formatDate }),
}));

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (config: Record<string, unknown>) => {
    mocks.exportConfig = config;
    return { exporting: false, handleExport: mocks.handleExport };
  },
}));

const TRENDS = Array.from({ length: 12 }, (_, index) => {
  const value = index + 1;
  return {
    date: `2026-09-${String(value).padStart(2, '0')}T00:00:00.000Z`,
    deposits: value * 100,
    withdrawals: value * 10,
    netDeposits: value === 1 ? -90 : value * 90,
    ggr: value,
    ngr: value * 2,
  };
});

const SORT_TRENDS = Array.from({ length: 12 }, (_, index) => {
  const value = index + 1;
  return {
    date: `2026-08-${String(value).padStart(2, '0')}T00:00:00.000Z`,
    deposits: (value * 5) % 13,
    withdrawals: (value * 7) % 13,
    netDeposits: ((value * 11) % 13) - 7,
    ggr: (value * 2) % 13,
    ngr: (value * 3) % 13,
  };
});

const SORT_CASES: ReadonlyArray<{
  header: string;
  clicks: number;
  value: (point: (typeof SORT_TRENDS)[number]) => number;
}> = [
  { header: 'Date', clicks: 2, value: (point) => new Date(point.date).getTime() },
  { header: 'Deposits', clicks: 1, value: (point) => point.deposits },
  { header: 'Withdrawals', clicks: 1, value: (point) => point.withdrawals },
  { header: 'Net Deposits', clicks: 1, value: (point) => point.netDeposits },
  { header: 'GGR', clicks: 1, value: (point) => point.ggr },
  { header: 'NGR', clicks: 1, value: (point) => point.ngr },
];

function renderTable() {
  return render(<FinancialSummaryTable />);
}

function bodyDates(): string[] {
  const table = screen.getByRole('table', { name: 'Financial summary' });
  return [...table.querySelectorAll('tbody tr')].map((row) => row.querySelector('td')?.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportConfig = undefined;
  mocks.useQuery.mockReturnValue({
    data: { dashboardTrends: TRENDS },
    loading: false,
    error: undefined,
  });
});

afterEach(cleanup);

describe('FinancialSummaryTable', () => {
  test('keeps the production query/options and converts only GGR/NGR before full-data totals', () => {
    renderTable();

    const [document, options] = mocks.useQuery.mock.calls[0];
    assert.equal(document, DASHBOARD_TRENDS_QUERY);
    assert.deepEqual(options, {
      variables: { dateRange: mocks.dateRange },
      pollInterval: 60000,
      errorPolicy: 'all',
    });
    assert.deepEqual(
      mocks.convert.mock.calls.map(([value]) => value),
      TRENDS.flatMap((point) => [point.ggr, point.ngr]),
    );
    assert.equal(mocks.formatDate.mock.calls.length, 12);
    assert.ok(mocks.formatDate.mock.calls.every(([, pattern]) => pattern === 'yyyy MMM d'));

    assert.deepEqual(bodyDates(), [
      '2026-09-12',
      '2026-09-11',
      '2026-09-10',
      '2026-09-09',
      '2026-09-08',
      '2026-09-07',
      '2026-09-06',
      '2026-09-05',
      '2026-09-04',
      '2026-09-03',
    ]);
    assert.ok(screen.getByText('AMT:1200'));
    assert.ok(screen.getAllByText('AMT:120').length >= 1);

    const table = screen.getByRole('table', { name: 'Financial summary' });
    const footer = table.querySelector('tfoot');
    assert.ok(footer);
    assert.deepEqual(within(footer).getAllByRole('cell').map((cell) => cell.textContent), [
      'Total',
      'AMT:7800',
      'AMT:780',
      'AMT:6840',
      'AMT:780',
      'AMT:1560',
    ]);
    assert.ok(within(footer).getByText('AMT:6840').classList.contains(styles.positive));
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /1-10 of 12 rows/);
  });

  test('sorts the full set before slicing and never resets the current page on sort', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    assert.deepEqual(bodyDates(), ['2026-09-02', '2026-09-01']);

    const deposits = () => screen.getByRole('button', { name: 'Deposits' });
    fireEvent.click(deposits());
    assert.equal(deposits().closest('th')?.getAttribute('aria-sort'), 'ascending');
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page');
    assert.deepEqual(bodyDates(), ['2026-09-11', '2026-09-12']);

    fireEvent.click(deposits());
    assert.equal(deposits().closest('th')?.getAttribute('aria-sort'), 'descending');
    assert.deepEqual(bodyDates(), ['2026-09-02', '2026-09-01']);

    fireEvent.click(deposits());
    assert.equal(deposits().closest('th')?.getAttribute('aria-sort'), 'none');
    assert.deepEqual(bodyDates(), ['2026-09-11', '2026-09-12']);
  });

  test.each(SORT_CASES)(
    '$header reaches ascending order across the full data set before page slicing',
    ({ header, clicks, value }) => {
      mocks.useQuery.mockReturnValue({
        data: { dashboardTrends: SORT_TRENDS },
        loading: false,
        error: undefined,
      });
      renderTable();
      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      for (let click = 0; click < clicks; click += 1) {
        fireEvent.click(screen.getByRole('button', { name: header }));
      }

      assert.equal(
        screen.getByRole('button', { name: header }).closest('th')?.getAttribute('aria-sort'),
        'ascending',
      );
      assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page');
      const expected = [...SORT_TRENDS]
        .sort((left, right) => value(left) - value(right))
        .slice(10)
        .map((point) => point.date.slice(0, 10));
      assert.deepEqual(bodyDates(), expected);
    },
  );

  test('resets to page one on the exact page-size choices without changing query variables', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

    const select = screen.getByRole('combobox', { name: 'Rows per page:' }) as HTMLSelectElement;
    assert.deepEqual([...select.options].map((option) => option.text), [
      '10 / page',
      '20 / page',
      '50 / page',
      '100 / page',
    ]);
    fireEvent.change(select, { target: { value: '20' } });

    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page');
    assert.equal(bodyDates().length, 12);
    assert.deepEqual(mocks.useQuery.mock.calls.at(-1)?.[1], {
      variables: { dateRange: mocks.dateRange },
      pollInterval: 60000,
      errorPolicy: 'all',
    });
  });

  test('keeps negative net ink and exports the complete converted data set', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    assert.ok(screen.getByText('AMT:-90').classList.contains(styles.negative));

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    assert.equal(mocks.handleExport.mock.calls.length, 1);
    assert.equal(mocks.exportConfig?.filename, 'Financial-Summary');
    assert.equal(mocks.exportConfig?.sheetName, 'Financial Summary');
    assert.equal(mocks.exportConfig?.title, 'Financial Summary — 12 row(s)');
    const exported = mocks.exportConfig?.data as Array<{ deposits: number; ggr: number; ngr: number }>;
    assert.equal(exported.length, 12);
    assert.deepEqual(exported[0], {
      key: '2026-09-01T00:00:00.000Z-0',
      date: '2026-09-01',
      deposits: 100,
      withdrawals: 10,
      netDeposits: -90,
      ggr: 10,
      ngr: 20,
    });
  });

  test('preserves initial loading/error fallbacks and hides the complete totals row when empty', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: true, error: undefined });
    const view = renderTable();
    assert.ok(screen.getByRole('status'));
    assert.match(screen.getByRole('status').textContent ?? '', /Loading financial summary/);
    assert.equal(screen.queryByRole('table'), null);

    view.unmount();
    mocks.useQuery.mockReturnValue({ data: undefined, loading: false, error: new Error('trend failure') });
    renderTable();
    assert.ok(screen.getByText('Failed to load financial summary: trend failure'));
    assert.equal(screen.queryByRole('table'), null);

    cleanup();
    mocks.useQuery.mockReturnValue({ data: { dashboardTrends: [] }, loading: false, error: undefined });
    renderTable();
    const table = screen.getByRole('table', { name: 'Financial summary' });
    assert.ok(within(table).getByRole('columnheader', { name: 'Date' }));
    assert.ok(screen.getByText('No data'));
    assert.equal(table.querySelector('tfoot'), null);
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /0-0 of 0 rows/);
    assert.equal((screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement).disabled, true);
  });
});
