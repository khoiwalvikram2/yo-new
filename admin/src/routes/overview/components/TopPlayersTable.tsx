import { useMemo, useState } from 'react';
import { IconDownload, IconInbox } from '@tabler/icons-react';
import { gql, useQuery } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useAuthStore } from '@/shared/core/authStore';
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping';
import { useTableExport } from '@/shared/hooks/useTableExport';
import type { TableExportColumn } from '@/shared/utils/tableExport';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { Avatar } from '@/ui/components/Avatar';
import { Button } from '@/ui/components/Button';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/ui/components/DataTable';
import { EmptyState } from '@/ui/components/EmptyState';
import { Inline } from '@/ui/components/LayoutPrimitives';
import { LoadingState } from '@/ui/components/LoadingState';
import { Notice } from '@/ui/components/Notice';
import { StatusPill } from '@/ui/components/StatusPill';
import styles from './tables.module.css';

const USERS_QUERY = gql`
  query Users($query: String, $status: PlayerStatus, $limit: Int, $offset: Int, $sortBy: String, $sortOrder: String) {
    usersPage(query: $query, status: $status, limit: $limit, offset: $offset, sortBy: $sortBy, sortOrder: $sortOrder) {
      items {
        id
        name
        phone
        username
        status
        createdAt
        wallet {
          balance
          currency
          bonus
          referralBonusBalance
        }
      }
      total
    }
  }
`;

interface TopPlayerRow {
  key: string;
  id: string;
  name: string;
  phone?: string;
  username?: string;
  status: string;
  balance: number;
  currency: string;
  registeredAt: string | null;
  bonus: number;
  referralBonus: number;
}

interface UsersQueryUser {
  id: string;
  name?: string | null;
  phone?: string | null;
  username?: string | null;
  status: string;
  createdAt?: string | null;
  wallet?: {
    balance?: number | string | null;
    currency?: string | null;
    bonus?: number | string | null;
    referralBonusBalance?: number | string | null;
  } | null;
}

interface UsersQueryData {
  usersPage?: {
    items?: UsersQueryUser[] | null;
    total?: number | null;
  } | null;
}

type AvatarHue = 1 | 2 | 3 | 4 | 5;

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const MASKED_AMOUNT = '••••';

function avatarHue(id: string): AvatarHue {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return ((hash % 5) + 1) as AvatarHue;
}

export function TopPlayersTable() {
  const navigate = useNavigate();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();
  const permissions = useAuthStore((state) => state.permissions);
  const agent = useAuthStore((state) => state.agent);
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view');

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sort, setSort] = useState<DataTableSort | null>({ key: 'balance', dir: 'desc' });
  const offset = (currentPage - 1) * pageSize;

  const { data, loading, error } = useQuery<UsersQueryData>(USERS_QUERY, {
    variables: {
      limit: pageSize,
      offset,
      sortBy: 'balance',
      sortOrder: 'desc',
    },
    pollInterval: 60000,
    errorPolicy: 'all',
  });

  const total = data?.usersPage?.total ?? 0;

  const tableData = useMemo<TopPlayerRow[]>(() => {
    if (!data?.usersPage?.items) return [];

    return data.usersPage.items
      .map((user): TopPlayerRow => ({
        key: user.id,
        id: user.id,
        name: user.name || user.username || `User #${user.id}`,
        phone: user.phone ?? undefined,
        username: user.username ?? undefined,
        status: user.status,
        balance: convertFromWhitelabelCurrency(Number(user.wallet?.balance || 0)),
        currency: user.wallet?.currency || 'USD',
        registeredAt: user.createdAt ?? null,
        bonus: convertFromWhitelabelCurrency(Number(user.wallet?.bonus ?? 0)),
        referralBonus: convertFromWhitelabelCurrency(Number(user.wallet?.referralBonusBalance ?? 0)),
      }))
      .sort((a: TopPlayerRow, b: TopPlayerRow) => b.balance - a.balance);
  }, [data, convertFromWhitelabelCurrency]);

  const columns = useMemo<DataTableColumn<TopPlayerRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (row) => (
          <Inline gap={8}>
            <Avatar name={row.name.charAt(0)} size={22} hue={avatarHue(row.id)} />
            <Button variant="link" onClick={() => navigate(`/players/profile/${row.id}`)}>
              {row.name}
            </Button>
          </Inline>
        ),
      },
      {
        key: 'username',
        header: 'Username',
        cell: (row) => row.username || '—',
      },
      {
        key: 'phone',
        header: 'Phone',
        cell: (row) => row.phone || '—',
      },
      {
        key: 'registeredAt',
        header: 'Registered Date',
        cell: (row) => (row.registeredAt ? formatDateTime(row.registeredAt) : '—'),
      },
      {
        key: 'balance',
        header: 'Balance',
        cell: (row) => (canViewWallet ? formatAmount(row.balance) : MASKED_AMOUNT),
        align: 'right',
        emphasis: 'key',
        sort: (a, b) => a.balance - b.balance,
      },
      {
        key: 'bonus',
        header: 'Bonus',
        cell: (row) => (canViewWallet ? formatAmount(row.bonus) : MASKED_AMOUNT),
        align: 'right',
      },
      {
        key: 'referralBonus',
        header: 'Referral Bonus',
        cell: (row) => (canViewWallet ? formatAmount(row.referralBonus) : MASKED_AMOUNT),
        align: 'right',
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => <StatusPill status={row.status}>{row.status}</StatusPill>,
      },
    ],
    [canViewWallet, formatAmount, formatDateTime, navigate],
  );

  const exportColumns = useMemo<TableExportColumn<TopPlayerRow>[]>(
    () => [
      { header: 'Name', key: 'name', width: 18, getter: (row) => row.name },
      { header: 'Username', key: 'username', width: 14, getter: (row) => row.username ?? '' },
      { header: 'Phone', key: 'phone', width: 14, getter: (row) => row.phone ?? '' },
      {
        header: 'Registered Date',
        key: 'registeredAt',
        width: 22,
        getter: (row) => (row.registeredAt ? formatDateTime(row.registeredAt) : ''),
      },
      { header: 'Balance', key: 'balance', width: 14, getter: (row) => row.balance },
      { header: 'Bonus', key: 'bonus', width: 14, getter: (row) => row.bonus },
      { header: 'Referral Bonus', key: 'referralBonus', width: 14, getter: (row) => row.referralBonus },
      { header: 'Status', key: 'status', width: 10, getter: (row) => row.status },
    ],
    [formatDateTime],
  );

  const { exporting, handleExport } = useTableExport({
    data: tableData,
    columns: exportColumns,
    filename: 'Overview-Top-Players',
    sheetName: 'Top Players',
    title: `Top Players by Balance — ${tableData.length} player(s)`,
  });

  if (loading && !data) {
    return <LoadingState label="Loading top players" minHeight={192} />;
  }

  if (error && !data) {
    return (
      <div className={styles.feedback}>
        <Notice tone="error">Failed to load top players: {error.message}</Notice>
      </div>
    );
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, lastPage);

  const handlePage = (next: number) => {
    setCurrentPage(Math.min(Math.max(1, next), lastPage));
  };

  const handlePageSize = (next: number) => {
    if (next === pageSize) return;
    setPageSize(next || DEFAULT_PAGE_SIZE);
    setCurrentPage(1);
  };

  return (
    <DataTable
      columns={columns}
      rows={tableData}
      rowKey={(row) => row.key}
      label="Top players by balance"
      width="wide"
      sort={sort}
      onSortChange={setSort}
      empty={<EmptyState title="No data" icon={<IconInbox size={20} stroke={1.45} />} />}
      toolbar={
        <>
          <Button
            size="sm"
            icon={<IconDownload size={15} stroke={1.75} />}
            loading={exporting}
            onClick={handleExport}
            disabled={!tableData.length || loading}
          >
            Export
          </Button>
          <Button variant="link" onClick={() => navigate('/players')}>
            View All
          </Button>
        </>
      }
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: handlePage,
        onPageSizeChange: handlePageSize,
        itemName: 'players',
        pageSizeOptions: PAGE_SIZE_OPTIONS,
        formatSummary: ({ start, end, total: playerTotal }) => (
          <>{start}-{end} of {playerTotal} players</>
        ),
        hidePageSizeLabel: true,
        formatPageSizeOption: (option) => `${option} / page`,
        variant: 'embedded',
      }}
    />
  );
}
