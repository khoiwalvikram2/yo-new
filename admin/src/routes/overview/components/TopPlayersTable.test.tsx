import { afterEach, beforeEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TopPlayersTable } from './TopPlayersTable';
import avatarStyles from '@/ui/components/Avatar.module.css';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  permission: true,
  auth: { permissions: [] as unknown[], agent: null as unknown },
  convert: vi.fn((value: number) => value * 10),
  formatAmount: vi.fn((value: number) => `AMT:${value}`),
  formatDateTime: vi.fn((value: string) => `DATE:${value}`),
  handleExport: vi.fn(),
  exportConfig: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>();
  return { ...actual, useQuery: mocks.useQuery };
});

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: mocks.formatAmount,
    convertFromWhitelabelCurrency: mocks.convert,
  }),
}));

vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: mocks.formatDateTime }),
}));

vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),
}));

vi.mock('@/shared/core/nestedPermissionMapping', () => ({
  hasPermissionWithNested: () => mocks.permission,
}));

vi.mock('@/shared/hooks/useTableExport', () => ({
  useTableExport: (config: Record<string, unknown>) => {
    mocks.exportConfig = config;
    return { exporting: false, handleExport: mocks.handleExport };
  },
}));

const DATA = {
  usersPage: {
    total: 25,
    items: [
      {
        id: 'low',
        name: 'Low',
        phone: '111',
        username: 'low-user',
        status: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
        wallet: { balance: 2, currency: 'INR', bonus: 1, referralBonusBalance: 0.5 },
      },
      {
        id: 'high',
        name: 'High',
        phone: undefined,
        username: 'high-user',
        status: 'SUSPENDED',
        createdAt: null,
        wallet: { balance: 9, currency: 'INR', bonus: 3, referralBonusBalance: 1 },
      },
      {
        id: 'middle',
        name: '',
        phone: '333',
        username: 'fallback-user',
        status: 'PENDING',
        createdAt: '2026-09-03T00:00:00.000Z',
        wallet: { balance: 4, currency: 'INR', bonus: 2, referralBonusBalance: 0 },
      },
    ],
  },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={['/overview']}>
      <TopPlayersTable />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function namesInTable(): string[] {
  const table = screen.getByRole('table', { name: 'Top players by balance' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByRole('button').textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission = true;
  mocks.auth.permissions = [];
  mocks.auth.agent = null;
  mocks.exportConfig = undefined;
  mocks.useQuery.mockReturnValue({ data: DATA, loading: false, error: undefined });
});

afterEach(cleanup);

describe('TopPlayersTable', () => {
  test('keeps the Users document options, conversions, fallbacks, statuses and export contract', () => {
    renderTable();

    const [document, options] = mocks.useQuery.mock.calls[0];
    assert.equal(document.definitions[0].name.value, 'Users');
    assert.deepEqual(options, {
      variables: { limit: 10, offset: 0, sortBy: 'balance', sortOrder: 'desc' },
      pollInterval: 60000,
      errorPolicy: 'all',
    });
    assert.deepEqual(mocks.convert.mock.calls.map(([value]) => value), [2, 1, 0.5, 9, 3, 1, 4, 2, 0]);

    assert.deepEqual(namesInTable(), ['High', 'fallback-user', 'Low']);
    assert.ok(screen.getByText('ACTIVE'));
    assert.ok(screen.getByText('SUSPENDED'));
    assert.ok(screen.getByText('PENDING'));
    assert.equal(screen.getAllByText('—').length, 2);
    assert.ok(screen.getByText('DATE:2026-09-01T00:00:00.000Z'));
    assert.ok(screen.getByText('AMT:90'));
    const avatars = [...screen.getByRole('table', { name: 'Top players by balance' }).querySelectorAll('tbody span[aria-hidden="true"]')];
    assert.equal(avatars.length, 3);
    assert.ok(avatars.every((avatar) => avatar.classList.contains(avatarStyles.size22)));
    assert.deepEqual(
      avatars.map((avatar) => [avatar.textContent, avatar.classList.contains(avatarStyles.hue2), avatar.classList.contains(avatarStyles.hue4)]),
      [
        ['H', true, false],
        ['F', false, true],
        ['L', false, true],
      ],
    );
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /1-10 of 25 players/);

    const select = screen.getByRole('combobox', { name: 'Rows per page:' }) as HTMLSelectElement;
    assert.deepEqual([...select.options].map((option) => option.text), ['10 / page', '20 / page', '50 / page']);

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    assert.equal(mocks.handleExport.mock.calls.length, 1);
    assert.equal(mocks.exportConfig?.filename, 'Overview-Top-Players');
    assert.equal(mocks.exportConfig?.sheetName, 'Top Players');
    assert.equal(mocks.exportConfig?.title, 'Top Players by Balance — 3 player(s)');
    assert.deepEqual((mocks.exportConfig?.data as Array<{ name: string }>).map((row) => row.name), [
      'High',
      'fallback-user',
      'Low',
    ]);
  });

  test('cycles Balance descending to none to ascending to descending on the returned server page', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 10);
    const balance = screen.getByRole('button', { name: 'Balance' });
    const header = balance.closest('th');

    assert.equal(header?.getAttribute('aria-sort'), 'descending');
    assert.deepEqual(namesInTable(), ['High', 'fallback-user', 'Low']);

    fireEvent.click(balance);
    assert.equal(header?.getAttribute('aria-sort'), 'none');
    assert.deepEqual(namesInTable(), ['High', 'fallback-user', 'Low']);
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 10);

    fireEvent.click(balance);
    assert.equal(header?.getAttribute('aria-sort'), 'ascending');
    assert.deepEqual(namesInTable(), ['Low', 'fallback-user', 'High']);
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 10);

    fireEvent.click(balance);
    assert.equal(header?.getAttribute('aria-sort'), 'descending');
    assert.deepEqual(namesInTable(), ['High', 'fallback-user', 'Low']);
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 10);
  });

  test('clamps the displayed range when total shrinks without silently changing the raw server offset', () => {
    let result = { data: DATA, loading: false, error: undefined };
    mocks.useQuery.mockImplementation(() => result);
    const view = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 20);

    result = {
      data: { usersPage: { total: 12, items: [] } },
      loading: false,
      error: undefined,
    };
    view.rerender(
      <MemoryRouter initialEntries={['/overview']}>
        <TopPlayersTable />
        <LocationProbe />
      </MemoryRouter>,
    );

    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /11-12 of 12 players/);
    assert.equal(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current'), 'page');
    assert.equal(mocks.useQuery.mock.calls.at(-1)?.[1].variables.offset, 20);
  });

  test('pages on the server, resets on page-size changes and preserves both navigation targets', () => {
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    assert.deepEqual(mocks.useQuery.mock.calls.at(-1)?.[1].variables, {
      limit: 10,
      offset: 10,
      sortBy: 'balance',
      sortOrder: 'desc',
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page:' }), { target: { value: '20' } });
    assert.deepEqual(mocks.useQuery.mock.calls.at(-1)?.[1].variables, {
      limit: 20,
      offset: 0,
      sortBy: 'balance',
      sortOrder: 'desc',
    });
    assert.equal(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current'), 'page');

    fireEvent.click(screen.getByRole('button', { name: 'High' }));
    assert.equal(screen.getByTestId('location').textContent, '/players/profile/high');
    fireEvent.click(screen.getByRole('button', { name: 'View All' }));
    assert.equal(screen.getByTestId('location').textContent, '/players');
  });

  test('reveals wallets for either permission path and masks all three balances otherwise', () => {
    mocks.permission = false;
    const view = renderTable();
    assert.equal(screen.getAllByText('••••').length, 9);
    assert.equal(screen.queryByText('AMT:90'), null);

    cleanup();
    mocks.auth.agent = { id: 'agent-1' };
    view.unmount();
    renderTable();
    assert.ok(screen.getByText('AMT:90'));
    assert.equal(screen.queryByText('••••'), null);
  });

  test('preserves initial loading/error fallbacks and keeps headers and pagination for no data', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, loading: true, error: undefined });
    const view = renderTable();
    assert.match(screen.getByRole('status').textContent ?? '', /Loading top players/);
    assert.equal(screen.queryByRole('table'), null);

    view.unmount();
    mocks.useQuery.mockReturnValue({ data: undefined, loading: false, error: new Error('gateway down') });
    renderTable();
    assert.ok(screen.getByText('Failed to load top players: gateway down'));
    assert.equal(screen.queryByRole('table'), null);

    cleanup();
    mocks.useQuery.mockReturnValue({
      data: { usersPage: { total: 0, items: [] } },
      loading: false,
      error: undefined,
    });
    renderTable();
    assert.ok(screen.getByRole('table', { name: 'Top players by balance' }));
    assert.ok(screen.getByRole('columnheader', { name: 'Name' }));
    assert.ok(screen.getByText('No data'));
    assert.match(screen.getByRole('navigation', { name: 'Pagination' }).textContent ?? '', /0-0 of 0 players/);
    assert.equal((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled, true);
  });
});
