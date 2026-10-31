import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import {
  IconBallFootball,
  IconCash,
  IconChartBar,
  IconChartLine,
  IconCoins,
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
  ACTIVE_PLAYERS_QUERY,
  CASINO_KPIS_QUERY,
  CASINO_PLAYER_BREAKDOWN_QUERY,
  MATKA_KPIS_QUERY,
  MATKA_PLAYER_BREAKDOWN_QUERY,
  SPORTS_KPIS_QUERY,
  SPORTS_PLAYER_BREAKDOWN_QUERY,
} from './playerProfitabilityQueries';
import {
  PROFITABILITY_DOMAIN_LABELS,
  PROFITABILITY_PAGE_SIZE_OPTIONS,
  agentChainLabel,
  filterProfitabilityPlayers,
  ggrTone,
  isReportableProfitabilityError,
  payoutShareNote,
  playerCountLabel,
  profitabilityActiveFilterCount,
  profitabilityPage,
  profitabilityPlayers,
  profitabilityTotals,
  sortProfitabilityPage,
  visibleProfitabilityDomains,
  winRateLabel,
  winRateTone,
  type PlayerBreakdownData,
  type PlayerBreakdownSource,
  type ProfitabilityDomain,
} from './playerProfitabilityModel';
import styles from './PlayerProfitabilityPage.module.css';

/* /reporting/players/profitability on the kit (page migration C, W3 Task 124; mockup M:2513-2521).
   The seven documents live in playerProfitabilityQueries.ts and the row, filter, sort and total rules in
   playerProfitabilityModel.ts, both unchanged in substance; the queries below keep their legacy
   variables, skips and policies. The layout follows its sibling Player Activity report (Task 123):
   search and period in the FilterBar, the domain switch as a tab strip over the table. */

const DOMAIN_TABS_ID = 'player-profitability-domain';

/* The legacy tab glyphs (layer group, football, dice, bar chart) in Tabler, decorative: the label
   carries the meaning, and the legacy per-tab colours are not kept (tokens only). */
const DOMAIN_ICONS: Record<ProfitabilityDomain, ReactNode> = {
  all: <IconStack2 size={14} stroke={strokeFor(14)} />,
  sports: <IconBallFootball size={14} stroke={strokeFor(14)} />,
  casino: <IconDice5 size={14} stroke={strokeFor(14)} />,
  matka: <IconChartBar size={14} stroke={strokeFor(14)} />,
};

export default function PlayerProfitabilityPage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.players-profitability', actions: ['view'] }]} bypassForAgents>
      <PlayerProfitabilityPageContent />
    </RBACGuard>
  );
}

function PlayerProfitabilityPageContent() {
  const pageEyebrow = usePageEyebrow();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();

  const agent = useAuthStore((s) => s.agent);
  const isAgent = useAuthStore((s) => s.isAgent());
  const allowedDomains = useMemo(
    () => agent?.allowedDomains || ['sports', 'casino', 'matka'],
    [agent?.allowedDomains],
  );

  const { dateFrom, dateTo, preset: datePreset, handleChange: handleDateChange, reset: resetDate } =
    useReportingDateFilter('allTime');
  const [activeTab, setActiveTab] = useState<ProfitabilityDomain>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sort, setSort] = useState<DataTableSort | null>(null);

  const filter = useMemo(() => ({ dateFrom, dateTo }), [dateFrom, dateTo]);

  // Agent login: only request domains the agent has access to (allowedDomains)
  const skipSports = activeTab === 'casino' || activeTab === 'matka' || (isAgent && activeTab === 'all' && !allowedDomains.includes('sports'));
  const skipCasino = activeTab === 'sports' || activeTab === 'matka' || (isAgent && activeTab === 'all' && !allowedDomains.includes('casino'));
  const skipMatka = activeTab === 'sports' || activeTab === 'casino' || (isAgent && activeTab === 'all' && !allowedDomains.includes('matka'));

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

  const { data: sportsKPIData, loading: sportsKPILoading, error: sportsKPIError, refetch: refetchSportsKPI } = useQuery(
    SPORTS_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const { data: casinoKPIData, loading: casinoKPILoading, error: casinoKPIError, refetch: refetchCasinoKPI } = useQuery(
    CASINO_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const { data: matkaKPIData, loading: matkaKPILoading, error: matkaKPIError, refetch: refetchMatkaKPI } = useQuery(
    MATKA_KPIS_QUERY,
    { variables: { filter: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );
  const {
    data: activePlayersData,
    loading: activePlayersLoading,
    error: activePlayersError,
    refetch: refetchActivePlayers,
  } = useQuery(
    ACTIVE_PLAYERS_QUERY,
    { variables: { dateRange: { dateFrom, dateTo } }, errorPolicy: 'all', fetchPolicy: 'network-only' }
  );

  const isLoading = sportsLoading || casinoLoading || matkaLoading || sportsKPILoading || casinoKPILoading || matkaKPILoading || activePlayersLoading;

  // Merge all domains by playerId (fully dynamic from backend); one domain's tab shows its own rows.
  const players = useMemo(
    () => profitabilityPlayers(
      activeTab,
      (sportsData?.sportsPlayerBreakdown || []) as PlayerBreakdownSource[],
      (casinoData?.casinoPlayerBreakdown || []) as PlayerBreakdownSource[],
      (matkaData?.matkaPlayerBreakdown || []) as PlayerBreakdownSource[],
    ),
    [activeTab, casinoData, matkaData, sportsData],
  );

  // Filter players by search query
  const filteredPlayers = useMemo(
    () => filterProfitabilityPlayers(players, searchQuery),
    [players, searchQuery],
  );

  const totals = useMemo(
    () => profitabilityTotals(sportsKPIData?.sportsKPIs, casinoKPIData?.casinoKPIs, matkaKPIData?.matkaKPIs),
    [sportsKPIData, casinoKPIData, matkaKPIData],
  );

  // Paginate players; a sort orders the page on screen only, as the legacy table did.
  const paginatedPlayers = useMemo(
    () => profitabilityPage(filteredPlayers, currentPage, pageSize),
    [filteredPlayers, currentPage, pageSize],
  );
  const tableRows = useMemo(() => sortProfitabilityPage(paginatedPlayers, sort), [paginatedPlayers, sort]);

  /* errorPolicy 'all' keeps whatever arrived; the page now says when something failed (legacy: silent).
     A permission refusal stays silent as before: it comes back on every load for that caller. */
  const breakdownError = [
    skipSports ? undefined : sportsError,
    skipCasino ? undefined : casinoError,
    skipMatka ? undefined : matkaError,
  ].find(isReportableProfitabilityError);
  const kpiErrors = [sportsKPIError, casinoKPIError, matkaKPIError, activePlayersError]
    .filter(isReportableProfitabilityError);

  const columns = useMemo<DataTableColumn<PlayerBreakdownData>[]>(() => [
    {
      key: 'playerUsername',
      header: 'Player',
      sort: true,
      minWidth: 160,
      cell: (r) => (
        <Link to={`/players/profile/${r.playerId}`} className={styles.playerLink}>
          <span>{r.playerUsername || 'Unknown'}</span>
          {/* the space keeps the link's spoken name "name phone" rather than one run-together word */}
          {r.playerPhone ? <>{' '}<span className={styles.playerPhone}>{r.playerPhone}</span></> : null}
        </Link>
      ),
    },
    {
      key: 'agentChain',
      header: 'Agent Chain',
      cell: (r) => <span className={styles.agentChain}>{agentChainLabel(r)}</span>,
    },
    {
      key: 'totalStakes',
      header: 'Total Stakes',
      align: 'right',
      sort: true,
      cell: (r) => formatAmount(convertFromWhitelabelCurrency(r.totalStakes)),
    },
    {
      key: 'totalPayouts',
      header: 'Total Payouts',
      align: 'right',
      sort: true,
      cell: (r) => formatAmount(convertFromWhitelabelCurrency(r.totalPayouts)),
    },
    {
      key: 'grossGamingRevenue',
      header: 'GGR (Revenue)',
      align: 'right',
      sort: true,
      cell: (r) => (
        <span className={ggrTone(r.grossGamingRevenue) === 'pos' ? styles.ggrPos : styles.ggrNeg}>
          {formatAmount(convertFromWhitelabelCurrency(r.grossGamingRevenue ?? 0))}
        </span>
      ),
    },
    {
      key: 'betCount',
      header: 'Bets',
      align: 'right',
      sort: true,
      cell: (r) => r.betCount.toLocaleString(),
    },
    {
      key: 'avgStake',
      header: 'Avg Stake',
      align: 'right',
      sort: true,
      cell: (r) => formatAmount(convertFromWhitelabelCurrency(r.avgStake)),
    },
    {
      key: 'winRate',
      header: 'Win Rate',
      align: 'right',
      sort: true,
      cell: (r) => <StatusPill tone={winRateTone(r.winRate)}>{winRateLabel(r.winRate)}</StatusPill>,
    },
  ], [convertFromWhitelabelCurrency, formatAmount]);

  const handleRefresh = () => {
    if (activeTab === 'sports' || activeTab === 'all') refetchSports();
    if (activeTab === 'casino' || activeTab === 'all') refetchCasino();
    if (activeTab === 'matka' || activeTab === 'all') refetchMatka();
    refetchSportsKPI();
    refetchCasinoKPI();
    refetchMatkaKPI();
    refetchActivePlayers();
  };

  const activeFiltersCount = profitabilityActiveFilterCount(searchQuery, datePreset);

  // Filter domain tabs based on agent's allowedDomains
  const tabItems = useMemo<TabItem<ProfitabilityDomain>[]>(
    () => visibleProfitabilityDomains(isAgent, allowedDomains).map((domain) => ({
      value: domain,
      label: PROFITABILITY_DOMAIN_LABELS[domain],
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
        title="Player Profitability Report"
        sub="Analyze player profitability and revenue across all domains"
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {/* Stats Cards */}
        <div className={styles.statsFrame}>
          <div className={styles.statGrid}>
            <Stat
              label="Total GGR"
              value={formatAmount(convertFromWhitelabelCurrency(totals.totalGGR))}
              note={`${filteredPlayers.length} players`}
              icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
              hue={totals.totalGGR >= 0 ? 'grn' : 'red'}
            />
            <Stat
              label="Total Stakes"
              value={formatAmount(convertFromWhitelabelCurrency(totals.totalStakes))}
              note={`${totals.totalBets.toLocaleString()} bets`}
              icon={<IconCoins size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
            <Stat
              label="Total Payouts"
              value={formatAmount(convertFromWhitelabelCurrency(totals.totalPayouts))}
              note={payoutShareNote(totals)}
              icon={<IconCash size={18} stroke={strokeFor(18)} />}
              hue="ind"
            />
            <Stat
              label="Active Players"
              value={activePlayersData?.overviewKPIs?.activePlayers ?? filteredPlayers.length}
              note={`${paginatedPlayers.length} showing`}
              icon={<IconUsers size={18} stroke={strokeFor(18)} />}
              hue="red"
            />
          </div>
        </div>

        {kpiErrors.length > 0 ? (
          <Notice tone="warn" title="Some totals could not be loaded">
            The figures that did load are shown. Refresh to try again.
          </Notice>
        ) : null}

        {/* Filters Bar — same UI as Player Activity Report */}
        <FilterBar
          activeCount={activeFiltersCount}
          onClearAll={handleClearFilters}
          search={(
            <SearchField
              label="Search players"
              placeholder="Search by username, phone, ID..."
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

        {/* Domain Tabs — same UI as Player Activity Report */}
        <div className={styles.domainScroller}>
          <Tabs
            className={styles.domainTabs}
            label="Domain"
            idPrefix={DOMAIN_TABS_ID}
            size="sm"
            value={activeTab}
            items={tabItems}
            onChange={(value) => {
              // The kit tab fires on every press; the legacy radio fired only on a change, so a press on
              // the selected tab keeps the page.
              if (value === activeTab) return;
              setActiveTab(value);
              setCurrentPage(1);
            }}
          />
        </div>

        {/* Table */}
        <div
          className={styles.panel}
          role="tabpanel"
          id={tabPanelId(DOMAIN_TABS_ID, activeTab)}
          aria-labelledby={tabId(DOMAIN_TABS_ID, activeTab)}
        >
          <Card
            className={styles.tableCard}
            title="Player Profitability"
            sub={playerCountLabel(filteredPlayers.length)}
            body="table"
          >
            <DataTable
              label="Player profitability"
              rows={tableRows}
              rowKey={(row) => String(row.playerId)}
              columns={columns}
              width="wide"
              state={breakdownError ? 'error' : isLoading ? 'loading' : 'ready'}
              error={breakdownError?.message ?? 'Unable to load player profitability.'}
              onRetry={handleRefresh}
              sort={sort}
              onSortChange={setSort}
              pagination={{
                current: currentPage,
                pageSize,
                total: filteredPlayers.length,
                onChange: setCurrentPage,
                onPageSizeChange: setPageSize,
                itemName: 'players',
                pageSizeOptions: PROFITABILITY_PAGE_SIZE_OPTIONS,
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

