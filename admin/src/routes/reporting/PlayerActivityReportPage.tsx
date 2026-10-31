import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@apollo/client';
import {
  IconBallFootball,
  IconCash,
  IconChartBar,
  IconChartLine,
  IconDice5,
  IconRefresh,
  IconStack2,
  IconUsers,
} from '@tabler/icons-react';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useAuthStore } from '@/shared/core/authStore';
import { RBACGuard } from '@/shared/core/RBACGuard';
import { usePageEyebrow } from '@/shell/PageEyebrowContext';
import { useReportingDateFilter } from '@/modules/reporting/reportingDateFilter';
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
import { StatusPill } from '@/ui/components/StatusPill';
import { Tabs, type TabItem } from '@/ui/components/Tabs';
import { strokeFor } from '@/ui/components/icons';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import {
  PLAYER_ACTIVITY_DEFAULT_PAGE_SIZE,
  PLAYER_ACTIVITY_DOMAIN_LABELS,
  PLAYER_ACTIVITY_PAGE_SIZE_OPTIONS,
  collectBreakdownPlayerIds,
  collectPlayerActivityErrors,
  filterPlayerActivity,
  formatBettingFrequency,
  formatWinRate,
  isPlayerActivitySortKey,
  mergePlayerActivity,
  paginatePlayerActivity,
  playerActivityEmptyText,
  playerActivityFilterCount,
  playerActivitySkips,
  playerActivityTotals,
  playerCountLabel,
  playerStatusLabel,
  playerStatusTone,
  resolveAllowedDomains,
  sortPlayerActivityPage,
  visiblePlayerActivityDomains,
  withDepositWithdrawal,
  type PlayerActivityData,
  type PlayerActivityDomain,
  type PlayerActivityRow,
} from './playerActivityReportModel';
import {
  ACTIVE_PLAYERS_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_PLAYER_BREAKDOWN_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
  SPORTS_KPIS_QUERY,
  SPORTS_PLAYER_BREAKDOWN_QUERY,
  USERS_BY_IDS_QUERY,
} from './playerActivityReportQueries';
import styles from './PlayerActivityReportPage.module.css';

/* /reporting/players/activity on the kit (page migration C, W3 Task 123). The GraphQL documents live
   byte for byte in ./playerActivityReportQueries, the page logic in ./playerActivityReportModel; this
   file keeps the guard, the data hooks (moved verbatim) and the composition. */

const DOMAIN_TABS_ID = 'player-activity-domain';

/* The legacy tab glyphs (layer group, football, dice, bar chart) in Tabler, decorative: the label
   carries the meaning, and the legacy per-tab colours are not kept (tokens only). */
const DOMAIN_ICONS: Record<PlayerActivityDomain, ReactNode> = {
  all: <IconStack2 size={14} stroke={strokeFor(14)} />,
  sports: <IconBallFootball size={14} stroke={strokeFor(14)} />,
  casino: <IconDice5 size={14} stroke={strokeFor(14)} />,
  matka: <IconChartBar size={14} stroke={strokeFor(14)} />,
};

export default function PlayerActivityReportPage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.players-activity', actions: ['view'] }]} bypassForAgents>
      <PlayerActivityReportPageContent />
    </RBACGuard>
  );
}

function PlayerActivityReportPageContent() {
  const pageEyebrow = usePageEyebrow();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  const agent = useAuthStore((s) => s.agent);
  const isAgent = useAuthStore((s) => s.isAgent());
  const allowedDomains = useMemo(() => resolveAllowedDomains(agent?.allowedDomains), [agent?.allowedDomains]);

  const { dateFrom, dateTo, preset: datePreset, handleChange: handleDateChange, reset: resetDate } =
    useReportingDateFilter('allTime');
  const [activeTab, setActiveTab] = useState<PlayerActivityDomain>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PLAYER_ACTIVITY_DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sort, setSort] = useState<DataTableSort | null>(null);

  const filter = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);

  // Agent login: only request domains the agent has access to (allowedDomains)
  const { skipSports, skipCasino, skipMatka } = playerActivitySkips(activeTab, isAgent, allowedDomains);

  const { data: sportsData, loading: sportsLoading, error: sportsError, refetch: refetchSports } = useQuery(
    SPORTS_PLAYER_BREAKDOWN_QUERY,
    {
      variables: { filter },
      skip: skipSports,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const { data: casinoData, loading: casinoLoading, error: casinoError, refetch: refetchCasino } = useQuery(
    CASINO_PLAYER_BREAKDOWN_QUERY,
    {
      variables: { filter },
      skip: skipCasino,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const { data: matkaData, loading: matkaLoading, error: matkaError, refetch: refetchMatka } = useQuery(
    MATKA_PLAYER_BREAKDOWN_QUERY,
    {
      variables: { filter },
      skip: skipMatka,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const { data: sportsKPIData, loading: sportsKPILoading, refetch: refetchSportsKPI } = useQuery(
    SPORTS_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const { data: casinoKPIData, loading: casinoKPILoading, refetch: refetchCasinoKPI } = useQuery(
    CASINO_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const { data: matkaKPIData, loading: matkaKPILoading, refetch: refetchMatkaKPI } = useQuery(
    MATKA_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const { data: activePlayersData, loading: activePlayersLoading, refetch: refetchActivePlayers } = useQuery(
    ACTIVE_PLAYERS_QUERY,
    { variables: { dateRange: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );

  // Extract player IDs from breakdown data (sports, casino, matka)
  const breakdownPlayerIds = useMemo(
    () => collectBreakdownPlayerIds(
      sportsData?.sportsPlayerBreakdown || [],
      casinoData?.casinoPlayerBreakdown || [],
      matkaData?.matkaPlayerBreakdown || [],
    ),
    [sportsData, casinoData, matkaData],
  );

  // Fetch user details for the specific players in the breakdown
  const { data: usersData, loading: usersLoading, error: usersError, refetch: refetchUsers } = useQuery(USERS_BY_IDS_QUERY, {
    variables: { ids: breakdownPlayerIds },
    skip: breakdownPlayerIds.length === 0,
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  });

  const players = useMemo(
    (): PlayerActivityData[] => mergePlayerActivity(
      sportsData?.sportsPlayerBreakdown || [],
      casinoData?.casinoPlayerBreakdown || [],
      matkaData?.matkaPlayerBreakdown || [],
      usersData?.usersByIds || [],
      dateFrom,
      dateTo,
    ),
    [sportsData, casinoData, matkaData, usersData, dateFrom, dateTo],
  );

  const playerIds = useMemo(() => players.map((p) => String(p.playerId)), [players]);

  const { data: depositWithdrawalData, loading: depositWithdrawalLoading, error: depositWithdrawalError, refetch: refetchDepositWithdrawal } = useQuery(
    PLAYER_ACTIVITY_DEPOSIT_WITHDRAWAL_STATS_QUERY,
    {
      variables: { ids: playerIds, dateFrom, dateTo },
      skip: playerIds.length === 0,
      errorPolicy: 'all',
      fetchPolicy: 'network-only',
    }
  );

  const queryErrors = useMemo(
    () => collectPlayerActivityErrors(
      {
        sports: sportsError,
        casino: casinoError,
        matka: matkaError,
        users: usersError,
        depositWithdrawal: depositWithdrawalError,
      },
      { skipSports, skipCasino, skipMatka },
    ),
    [sportsError, casinoError, matkaError, usersError, depositWithdrawalError, skipSports, skipCasino, skipMatka],
  );

  const playersWithDepositWithdrawal = useMemo(
    (): PlayerActivityRow[] => withDepositWithdrawal(
      players,
      depositWithdrawalData?.playerActivityDepositWithdrawalStats ?? [],
    ),
    [players, depositWithdrawalData],
  );

  const isLoading = sportsLoading || casinoLoading || matkaLoading || usersLoading || depositWithdrawalLoading || sportsKPILoading || casinoKPILoading || matkaKPILoading || activePlayersLoading;

  // Filter players by search query
  const filteredPlayers = useMemo(
    () => filterPlayerActivity(playersWithDepositWithdrawal, searchQuery),
    [playersWithDepositWithdrawal, searchQuery],
  );

  const totals = useMemo(
    () => playerActivityTotals(
      {
        sports: sportsKPIData?.sportsKPIs,
        casino: casinoKPIData?.casinoKPIs,
        matka: matkaKPIData?.matkaKPIs,
      },
      filteredPlayers.length,
    ),
    [sportsKPIData, casinoKPIData, matkaKPIData, filteredPlayers.length],
  );

  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  /* Money in (deposits) reads green and money out (withdrawals) red, as on the Nth D/W report; a zero
     reads muted, so the rows that did move money stand out. The count in brackets stays the grey caption. */
  const amountWithCount = (amount: number, count: number, flow: 'in' | 'out') => (
    <span className={clsx(styles.amount, amount > 0 ? (flow === 'in' ? styles.moneyIn : styles.moneyOut) : styles.zero)}>
      {money(amount)}
      <span className={styles.count}>({count})</span>
    </span>
  );
  const soft = (content: ReactNode) => <span className={styles.soft}>{content}</span>;

  /* The legacy columns in their order, headers and cell copy; `sort: true` hands sorting to the page,
     which sorts only the rows on the current page, as the antd table did. */
  const columns: DataTableColumn<PlayerActivityRow>[] = [
    {
      key: 'playerUsername',
      header: 'Username',
      emphasis: 'key',
      sort: true,
      cell: (r) => r.playerUsername,
    },
    {
      key: 'name',
      header: 'Name',
      cell: (r) => r.name || '—',
    },
    {
      key: 'email',
      header: 'Email',
      sort: true,
      cell: (r) => <span className={styles.dim}>{r.email || '—'}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      sort: true,
      cell: (r) =>
        r.phone ? (
          <Link to={`/players/profile/${r.playerId}`} className={styles.playerLink}>
            {r.phone}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.status ? <StatusPill tone={playerStatusTone(r.status)}>{playerStatusLabel(r.status)}</StatusPill> : '—',
    },
    {
      key: 'directAgent',
      header: 'Direct Agent',
      cell: (r) => (r.directAgentName ? <span className={styles.agent}>{r.directAgentName}</span> : <span className={styles.dim}>—</span>),
    },
    {
      key: 'totalDeposit',
      header: 'Total Deposit (All-time)',
      align: 'right',
      sort: true,
      cell: (r) => amountWithCount(r.totalDepositAmount ?? 0, r.totalDepositCount ?? 0, 'in'),
    },
    {
      key: 'rangeDeposit',
      header: 'Range Deposit (Date filter)',
      align: 'right',
      sort: true,
      cell: (r) => amountWithCount(r.rangeDepositAmount ?? 0, r.rangeDepositCount ?? 0, 'in'),
    },
    {
      key: 'totalWithdraw',
      header: 'Total Withdraw (All-time)',
      align: 'right',
      sort: true,
      cell: (r) => amountWithCount(r.totalWithdrawalAmount ?? 0, r.totalWithdrawalCount ?? 0, 'out'),
    },
    {
      key: 'rangeWithdraw',
      header: 'Range Withdraw (Date filter)',
      align: 'right',
      sort: true,
      cell: (r) => amountWithCount(r.rangeWithdrawalAmount ?? 0, r.rangeWithdrawalCount ?? 0, 'out'),
    },
    {
      key: 'totalBets',
      header: 'Total Bets',
      align: 'right',
      sort: true,
      cell: (r) => <span className={styles.strong}>{r.totalBets.toLocaleString()}</span>,
    },
    {
      key: 'bettingFrequency',
      header: 'Betting Frequency',
      align: 'right',
      sort: true,
      cell: (r) => soft(formatBettingFrequency(r.bettingFrequency)),
    },
    {
      key: 'totalStakes',
      header: 'Total Stakes',
      align: 'right',
      sort: true,
      cell: (r) => <span className={styles.strong}>{money(r.totalStakes)}</span>,
    },
    {
      key: 'totalPayouts',
      header: 'Total Payouts',
      align: 'right',
      sort: true,
      cell: (r) => <span className={r.totalPayouts > 0 ? styles.payout : styles.zero}>{money(r.totalPayouts)}</span>,
    },
    {
      key: 'grossGamingRevenue',
      header: 'GGR',
      align: 'right',
      sort: true,
      // the house's result: a gain green, a loss red, the sign also in words for assistive tech
      cell: (r) => {
        const ggr = r.grossGamingRevenue ?? 0;
        return ggr === 0 ? <span className={styles.zero}>{money(0)}</span> : (
          <span className={ggr > 0 ? styles.gain : styles.loss}>
            <span className={styles.srOnly}>{ggr > 0 ? 'House gain ' : 'House loss '}</span>
            {money(ggr)}
          </span>
        );
      },
    },
    {
      key: 'avgStake',
      header: 'Avg Stake',
      align: 'right',
      sort: true,
      cell: (r) => soft(money(r.avgStake)),
    },
    {
      key: 'winRate',
      header: 'Win Rate',
      align: 'right',
      sort: true,
      // the figure with a short bar (full at 100%), so the rate reads at a glance down the column
      cell: (r) => (
        <span className={styles.rate}>
          <span className={styles.rateBar} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, Number(r.winRate) * 100))}%` }} /></span>
          {formatWinRate(r.winRate)}
        </span>
      ),
    },
    {
      key: 'activeDays',
      header: 'Period Days',
      align: 'right',
      sort: true,
      cell: (r) => soft(r.activeDays.toLocaleString()),
    },
    {
      key: 'lastBetInPeriod',
      header: 'Bets in Period',
      cell: (r) => (r.lastBetInPeriod ? <StatusPill tone="ok">Yes</StatusPill> : <StatusPill tone="neutral">No</StatusPill>),
    },
  ];

  const handleRefresh = () => {
    if (activeTab === 'sports' || activeTab === 'all') refetchSports();
    if (activeTab === 'casino' || activeTab === 'all') refetchCasino();
    if (activeTab === 'matka' || activeTab === 'all') refetchMatka();
    refetchSportsKPI();
    refetchCasinoKPI();
    refetchMatkaKPI();
    refetchActivePlayers();
    refetchUsers();
    refetchDepositWithdrawal();
  };

  // Paginate players, then sort the page (the antd table sorted only the slice it was given)
  const paginatedPlayers = useMemo(
    () => paginatePlayerActivity(filteredPlayers, currentPage, pageSize),
    [filteredPlayers, currentPage, pageSize],
  );
  const sortedPagePlayers = useMemo(
    () => sortPlayerActivityPage(
      paginatedPlayers,
      sort && isPlayerActivitySortKey(sort.key) ? { key: sort.key, dir: sort.dir } : null,
    ),
    [paginatedPlayers, sort],
  );

  const activeFiltersCount = playerActivityFilterCount(searchQuery, datePreset);

  // Filter domain tabs based on agent's allowedDomains
  const tabItems = useMemo(
    (): TabItem<PlayerActivityDomain>[] =>
      visiblePlayerActivityDomains(isAgent, allowedDomains).map((domain) => ({
        value: domain,
        label: PLAYER_ACTIVITY_DOMAIN_LABELS[domain],
        icon: DOMAIN_ICONS[domain],
      })),
    [isAgent, allowedDomains],
  );

  const handleClearFilters = () => {
    setSearchQuery('');
    resetDate();
    setCurrentPage(1);
  };

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Player Activity Report"
        sub="Analyze player betting activity across all domains"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <div className={styles.statsFrame}>
          <div className={styles.stats} role="group" aria-label="Player activity statistics">
            <Stat
              label="Active Players"
              value={activePlayersData?.overviewKPIs?.activePlayers ?? filteredPlayers.length}
              note={`${paginatedPlayers.length} showing`}
              icon={<IconUsers size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
            <Stat
              label="Total Bets"
              value={totals.totalBets.toLocaleString()}
              note={`Avg: ${totals.avgBetsPerPlayer.toFixed(1)}/player`}
              icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
              hue="grn"
            />
            <Stat
              label="Total Stakes"
              value={money(totals.totalStakes)}
              note={filteredPlayers.length > 0 ? `Avg: ${money(totals.totalStakes / filteredPlayers.length)}` : '—'}
              icon={<IconCash size={18} stroke={strokeFor(18)} />}
              hue="ind"
            />
            <Stat
              label="Avg Bets/Player"
              value={totals.avgBetsPerPlayer.toFixed(1)}
              note="Average per player"
              icon={<IconChartBar size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
          </div>
        </div>

        <FilterBar
          activeCount={activeFiltersCount}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label="Search players"
              placeholder="Search by username, name, email, phone, ID..."
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

        {queryErrors.length > 0 ? (
          <Notice tone="error" title="Failed to load some data" live="assertive">
            {queryErrors.join(' ')}
          </Notice>
        ) : null}

        <div className={styles.domainScroller}>
          <Tabs
            className={styles.domainTabs}
            label="Domain"
            idPrefix={DOMAIN_TABS_ID}
            size="sm"
            value={activeTab}
            items={tabItems}
            onChange={(value) => {
              setActiveTab(value);
              setCurrentPage(1);
            }}
          />
        </div>

        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(DOMAIN_TABS_ID, activeTab)}
          aria-labelledby={tabId(DOMAIN_TABS_ID, activeTab)}
        >
          <Card
            className={styles.tableCard}
            title="Player Activity"
            sub={playerCountLabel(filteredPlayers.length)}
            body="table"
          >
            <DataTable
              label="Player activity"
              rows={sortedPagePlayers}
              rowKey={(r) => String(r.playerId)}
              columns={columns}
              width="wide"
              state={isLoading ? 'loading' : 'ready'}
              empty={<EmptyState inset="none" title={playerActivityEmptyText(filteredPlayers.length, isLoading)} />}
              sort={sort}
              onSortChange={setSort}
              pagination={{
                current: currentPage,
                pageSize,
                total: filteredPlayers.length,
                onChange: setCurrentPage,
                onPageSizeChange: setPageSize,
                itemName: 'players',
                pageSizeOptions: PLAYER_ACTIVITY_PAGE_SIZE_OPTIONS,
                formatSummary: ({ total }) => `Total ${total} players`,
                variant: 'embedded',
              }}
            />
          </Card>
        </div>
      </div>
    </Page>
  );
}

