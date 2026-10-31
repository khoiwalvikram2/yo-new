import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useLazyQuery, gql } from "@apollo/client";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/ui/components/Button";
import { Page } from "@/ui/components/Page";
import { AccountListHeader, AccountListGroups } from "@/modules/account-lists/AccountList";
import listStyles from "@/modules/account-lists/AccountList.module.css";
import { buttonClassName } from "@/ui/components/buttonClassName";
import { Notice } from "@/ui/components/Notice";
import { IconMaximize, IconMinimize, IconPlus } from "@tabler/icons-react";
import { EMPTY_PLAYERS, playerQueryScope, playerTabOptions, type SearchPlayer, type SearchPlayerStats, type StatsRow } from "./playersSearchModel";
import styles from "./PlayersSearch.module.css";
// import { notify } from '../../shared/services/notification';
import { useCurrency } from "@/shared/core/CurrencyContext";
import { Pagination } from "@/ui/components/Pagination";
import { usePlayersUiStore } from "@/state/playersUiStore";
import { useAuthStore } from "@/shared/core/authStore";
import { useSearch } from "@/shared/hooks/useSearch";
import { useAgentSubtree } from "@/shared/hooks/useAgentSubtree";


import dayjs from "dayjs";
import { nowIST } from "@/shared/utils/date";
import { FiltersBar } from "./components/FiltersBar";
import { StatsCards } from "./components/StatsCards";
import { PlayersTable } from "./components/PlayersTable";
import { RecentActivity } from "./components/RecentActivity";
import { ActionsDrawer } from "./components/ActionsDrawer";
import { BalanceAdjustmentModal } from "./components/BalanceAdjustmentModal";
import { CreditAdjustmentModal } from "./components/CreditAdjustmentModal";
import { SpecialBonusModal } from "./components/SpecialBonusModal";
import type { Player } from "@/shared/types/player";
import { RBACGuard } from "@/shared/core/RBACGuard";

type FullscreenElement = HTMLDivElement & { webkitRequestFullscreen?: () => void; mozRequestFullScreen?: () => void; msRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitExitFullscreen?: () => void; mozCancelFullScreen?: () => void; msExitFullscreen?: () => void; webkitFullscreenElement?: Element; mozFullScreenElement?: Element; msFullscreenElement?: Element };



const UsersPageQuery = gql`
  query UsersPage(
    $query: String
    $status: PlayerStatus
    $balanceMin: Float
    $balanceMax: Float
    $registeredFrom: String
    $registeredTo: String
    $offset: Int
    $limit: Int
    $parentType: String
    $agentId: ID
    $onlyDirect: Boolean
    $playerType: String
  ) {
    usersPage(
      query: $query
      status: $status
      balanceMin: $balanceMin
      balanceMax: $balanceMax
      registeredFrom: $registeredFrom
      registeredTo: $registeredTo
      offset: $offset
      limit: $limit
      parentType: $parentType
      agentId: $agentId
      onlyDirect: $onlyDirect
      playerType: $playerType
    ) {
      items {
        id
        name
        email
        phone
        withdrawalLock
        vipTierId
        vipTierName
        username
        status
        wallet {
          userId
          currency
          balance
          bonus
          exposure
          updatedAt
        }
        sportsBetAllowed
        casinoBetAllowed
        matkaBetAllowed
        bonusAllowed
        sportsVisible
        casinoVisible
        matkaVisible
        riskType
        requirePasswordReset
        agentId
        playerType
        creditLimit
        creditUsed
        creditAvailable
        settlementBalance
        settlementBalanceSports
        settlementBalanceCasino
        settlementBalanceMatka
        parentAgent {
          id
          username
          schemeType
        }
        referredBy {
          id
          username
          name
          phone
        }
        remark
      }
      total
    }
  }
`;

const PlayerStatsByIdsQuery = gql`
  query PlayersStatsByIds($ids: [ID!]!) {
    playersStatsByIds(ids: $ids) {
      playerId
      stats {
        totalDeposits
        totalWithdrawals
        depositCount
        withdrawalCount
        manualDepositCount
        manualWithdrawalCount
        ggr
        profitLoss
        plTrend
        betCount
        totalExposure
        lastLogin
        lastActivityAt
        lastBetAt
        daysSinceLastBet
        turnover
        commissionEarned
        commissionTrend
      }
    }
  }
`;

// Query to fetch agents for the filter dropdown
const AGENTS_FOR_SELECTOR_QUERY = gql`
  query AgentsForPlayerFilter($schemeType: AgentScheme) {
    agents {
      agentsPage(schemeType: $schemeType, limit: 500, includeStats: false) {
        items {
          id
          username
          schemeType
        }
      }
    }
  }
`;

// Mutations moved into ActionsDrawer component

export default function PlayersListPage() {
  return (
    <RBACGuard required={[{ domain: 'players.list', actions: ['view'] }]} bypassForAgents>
      <PlayersListPageContent />
    </RBACGuard>
  );
}

function PlayersListPageContent() {
  const { convertFromWhitelabelCurrency } = useCurrency();
  const { open: drawerOpen } = usePlayersUiStore((s) => s.drawer);
  const openDrawer = usePlayersUiStore((s) => s.openDrawer);
  const closeDrawer = usePlayersUiStore((s) => s.closeDrawer);
  const selectedUser = usePlayersUiStore((s) => s.selectedUser);
  const setSelectedUser = usePlayersUiStore((s) => s.setSelectedUser);
  
  // Auth state for role-based tabs
  const agent = useAuthStore((s) => s.agent);
  const isAgentLoggedIn = !!agent;
  const agentSchemeType = agent?.schemeType;

  // URL params for tab persistence
  const [searchParams, setSearchParams] = useSearchParams();
  
  const tabOptions = playerTabOptions(isAgentLoggedIn ? agentSchemeType : undefined);
  const defaultTab = isAgentLoggedIn && agentSchemeType === 'COMMISSION' ? null : 'ALL';
  
  // Initialize parentType from URL or default
  const initialParentType = searchParams.get('playerType') || defaultTab || 'ALL';
  const [parentType, setParentType] = useState(initialParentType);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);

  const { query, setQuery, debouncedQuery } = useSearch({ minLength: 2 });
  const [mainLoaded, setMainLoaded] = useState(false);
  const [secondaryReady, setSecondaryReady] = useState(false);

  useEffect(() => {
    if (!mainLoaded) return;
    const t = setTimeout(() => setSecondaryReady(true), 300);
    return () => clearTimeout(t);
  }, [mainLoaded]);
  const [status, setStatus] = useState("");
  const [balanceRange, setBalanceRange] = useState("");
  const [registered, setRegistered] = useState("");
  const [playerTypeFilter, setPlayerTypeFilter] = useState<'' | 'REGULAR' | 'WHITELABEL_CREDIT'>("");
  const [registeredRange, setRegisteredRange] = useState<{
    from?: string;
    to?: string;
  }>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [compactMode, setCompactMode] = useState(false);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [selectedPlayerForBalance, setSelectedPlayerForBalance] = useState<Player | null>(null);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [selectedPlayerForCredit, setSelectedPlayerForCredit] = useState<Player | null>(null);
  const [creditModalInitialTab, setCreditModalInitialTab] = useState<'limit' | 'adjust' | 'settle'>('limit');
  const [specialBonusModalOpen, setSpecialBonusModalOpen] = useState(false);
  const [selectedPlayerForSpecialBonus, setSelectedPlayerForSpecialBonus] = useState<Player | null>(null);
  
  // Handle tab change with URL persistence
  const handleTabChange = (value: string | number) => {
    const newValue = String(value);
    setParentType(newValue);
    setAgentId(undefined); // Reset agent filter when tab changes
    if (newValue !== 'ALL' && newValue !== 'DIRECT') setPlayerTypeFilter(''); // Hide filter on other tabs
    setCurrentPage(1);
    setSearchParams({ playerType: newValue });
  };
  
  // Fetch agents for dropdown based on current parentType
  const getAgentSchemeTypeForSelector = () => {
    if (isAgentLoggedIn) {
      return agentSchemeType; // For agents, fetch their own sub-agents
    }
    // For admin, fetch agents matching the selected tab
    if (parentType === 'SHARING') return 'SHARING';
    if (parentType === 'CREDIT') return 'CREDIT';
    if (parentType === 'COMMISSION') return 'COMMISSION';
    return undefined; // For ALL/DIRECT, fetch all agents
  };
  
  // Admins list the tenant's agents. agentsPage answers an agent with only itself, so an agent's
  // filter lists its sub-agents at every level instead (read through the hierarchy).
  const { data: agentsForSelectorData } = useQuery(AGENTS_FOR_SELECTOR_QUERY, {
    variables: {
      schemeType: getAgentSchemeTypeForSelector(),
    },
    errorPolicy: 'all',
    skip: isAgentLoggedIn || parentType === 'DIRECT' || !secondaryReady,
  });
  const agentSubtree = useAgentSubtree(agent?.id, { skip: !isAgentLoggedIn || parentType === 'DIRECT' || !secondaryReady });
  const agentsForSelector = useMemo(() => isAgentLoggedIn
    ? agentSubtree.agents.map((subAgent) => ({ id: subAgent.id, username: subAgent.username, description: `L${subAgent.levelIndex ?? subAgent.depth + 1}${subAgent.status.toUpperCase() === 'ACTIVE' ? '' : ` · ${subAgent.status.toLowerCase()}`}` }))
    : (agentsForSelectorData?.agents?.agentsPage?.items ?? []), [isAgentLoggedIn, agentSubtree.agents, agentsForSelectorData]);

  // Compute registered date range once when filter changes to avoid refetch loops
  useEffect(() => {
    if (!registered) {
      setRegisteredRange({});
      return;
    }
    // Don't override custom range - it's managed by the date picker
    if (registered === "custom") {
      // Keep existing registeredRange if already set, otherwise do nothing
      return;
    }
    const now = nowIST();
    let from: dayjs.Dayjs | undefined;
    if (registered === "7days")
      from = now.subtract(7, 'day');
    else if (registered === "30days")
      from = now.subtract(30, 'day');
    else if (registered === "90days")
      from = now.subtract(90, 'day');
    else from = undefined;
    setRegisteredRange({
      from: from ? from.startOf('day').toISOString() : undefined,
      to: now.endOf('day').toISOString(),
    });
  }, [registered]);

  // Parse balance range once; memoize
  const { balanceMin, balanceMax } = useMemo(() => {
    if (!balanceRange)
      return {
        balanceMin: undefined as number | undefined,
        balanceMax: undefined as number | undefined,
      };
    if (balanceRange.includes("-")) {
      const [minStr, maxStr] = balanceRange.split("-");
      return { balanceMin: Number(minStr), balanceMax: Number(maxStr) };
    }
    if (balanceRange.endsWith("+")) {
      return {
        balanceMin: Number(balanceRange.replace("+", "")),
        balanceMax: undefined,
      };
    }
    return { balanceMin: undefined, balanceMax: undefined };
  }, [balanceRange]);

  // Agents use the backend's existing onlyDirect scope; admin uses parentType.
  // Only pass playerType filter when tab is ALL or DIRECT (where both types appear)
  const effectivePlayerTypeFilter = (parentType === 'ALL' || parentType === 'DIRECT') && playerTypeFilter
    ? playerTypeFilter
    : undefined;

  // Memoize variables to prevent identity change on every render
  const queryVariables = useMemo(
    () => ({
      query: debouncedQuery && debouncedQuery.trim().length >= 2 ? debouncedQuery : undefined,
      status: status
        ? status === "active"
          ? "ACTIVE"
          : status === "inactive"
          ? "INACTIVE"
          : status === "suspended"
          ? "SUSPENDED"
          : undefined
        : undefined,
      balanceMin,
      balanceMax,
      registeredFrom: registeredRange.from,
      registeredTo: registeredRange.to,
      ...playerQueryScope(parentType, isAgentLoggedIn),
      agentId: agentId || undefined,
      playerType: effectivePlayerTypeFilter || undefined,
    }),
    [
      debouncedQuery,
      status,
      balanceMin,
      balanceMax,
      registeredRange.from,
      registeredRange.to,
      parentType,
      agentId,
      isAgentLoggedIn,
      effectivePlayerTypeFilter,
    ]
  );

  const {
    data,
    loading: fetching,
    error: queryError,
    refetch,
  } = useQuery(UsersPageQuery, {
    variables: {
      ...queryVariables,
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
    },
    errorPolicy: "all",
    fetchPolicy: "network-only",
    nextFetchPolicy: "network-only",
    onCompleted: () => setMainLoaded(true),
    onError: () => setMainLoaded(true),
  });

  const items: SearchPlayer[] = data?.usersPage?.items ?? EMPTY_PLAYERS;
  const pagePlayerIds: string[] = useMemo(
    () => items.map((item: { id: string }) => item.id).filter(Boolean),
    [items]
  );

  const STATS_BATCH = 25;
  const firstBatchIds = useMemo(() => pagePlayerIds.slice(0, STATS_BATCH), [pagePlayerIds]);
  const remainingBatchIds = useMemo(() => {
    if (pagePlayerIds.length <= STATS_BATCH) return [] as string[][];
    const rest: string[][] = [];
    for (let i = STATS_BATCH; i < pagePlayerIds.length; i += STATS_BATCH) {
      rest.push(pagePlayerIds.slice(i, i + STATS_BATCH));
    }
    return rest;
  }, [pagePlayerIds]);

  const { data: statsData } = useQuery(PlayerStatsByIdsQuery, {
    variables: { ids: firstBatchIds },
    skip: firstBatchIds.length === 0,
    errorPolicy: "all",
    fetchPolicy: "cache-first",
    nextFetchPolicy: "cache-first",
  });

  const [fetchMoreStats] = useLazyQuery(PlayerStatsByIdsQuery, {
    errorPolicy: "all",
    fetchPolicy: "cache-first",
  });

  const [extraStats, setExtraStats] = useState<StatsRow[]>([]);
  const prevIdsRef = useRef<string>("");
  useEffect(() => {
    const key = pagePlayerIds.join(",");
    if (key === prevIdsRef.current) return;
    prevIdsRef.current = key;
    setExtraStats([]);
    if (remainingBatchIds.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const batch of remainingBatchIds) {
        if (cancelled) break;
        try {
          const { data: d } = await fetchMoreStats({ variables: { ids: batch } });
          if (!cancelled && d?.playersStatsByIds) {
            setExtraStats((prev) => [...prev, ...d.playersStatsByIds]);
          }
        } catch { /* Later stats batches are best-effort, as before. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [pagePlayerIds, remainingBatchIds, fetchMoreStats]);

  // Reset to first page when filters change (useQuery refetches automatically when variables change)
  useEffect(() => {
    setCurrentPage(1);
  }, [
    debouncedQuery,
    status,
    balanceMin,
    balanceMax,
    registered,
    registeredRange.from,
    registeredRange.to,
    parentType,
    agentId,
    playerTypeFilter,
  ]);

  const statsByPlayerId = useMemo(() => {
    const rows = [...(statsData?.playersStatsByIds ?? []), ...extraStats];
    const map = new Map<string, SearchPlayerStats | undefined>();
    for (const row of rows) {
      if (row?.playerId) map.set(String(row.playerId), row.stats ?? undefined);
    }
    return map;
  }, [statsData, extraStats]);

  // Merge async stats into already-loaded page players
  const players: SearchPlayer[] = useMemo(() => {
    return items.map((item: Player) => ({
      ...item,
      stats: statsByPlayerId.get(String(item.id)),
    }));
  }, [items, statsByPlayerId]);

  const paginatedPlayers = players; // server-side paginated
  const totalPlayers = data?.usersPage?.total ?? 0;

  // Fullscreen functionality
  const handleFullscreen = () => {
    if (!compactMode && pageContainerRef.current) {
      const element = pageContainerRef.current;
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if ((element as FullscreenElement).webkitRequestFullscreen) {
        (element as FullscreenElement).webkitRequestFullscreen?.();
      } else if ((element as FullscreenElement).mozRequestFullScreen) {
        (element as FullscreenElement).mozRequestFullScreen?.();
      } else if ((element as FullscreenElement).msRequestFullscreen) {
        (element as FullscreenElement).msRequestFullscreen?.();
      }
      setCompactMode(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as FullscreenDocument).webkitExitFullscreen) {
        (document as FullscreenDocument).webkitExitFullscreen?.();
      } else if ((document as FullscreenDocument).mozCancelFullScreen) {
        (document as FullscreenDocument).mozCancelFullScreen?.();
      } else if ((document as FullscreenDocument).msExitFullscreen) {
        (document as FullscreenDocument).msExitFullscreen?.();
      }
      setCompactMode(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement =
        document.fullscreenElement ||
        (document as FullscreenDocument).webkitFullscreenElement ||
        (document as FullscreenDocument).mozFullScreenElement ||
        (document as FullscreenDocument).msFullscreenElement;
      const isFullscreen = fullscreenElement === pageContainerRef.current;
      setCompactMode(isFullscreen);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  return (
    <div ref={pageContainerRef} className={styles.fullscreen}>
      <Page maxWidth="none" className={listStyles.page}>
        <AccountListHeader title="Players" eyebrow={null} actions={<div className={styles.actions}>
          <Button size="sm" aria-label={compactMode ? "Exit fullscreen" : "Enter fullscreen"} icon={compactMode ? <IconMinimize size={16} /> : <IconMaximize size={16} />} onClick={handleFullscreen}>{compactMode ? "Exit fullscreen" : "Fullscreen"}</Button>
          <Link to="/players/create" className={buttonClassName({ variant: "primary" })}><IconPlus size={16} aria-hidden="true" />Add Player</Link>
        </div>} />
        {queryError && <Notice tone="error" action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}>{queryError.message}</Notice>}
      <StatsCards parentType={parentType} defer={!mainLoaded} />

      <section className={listStyles.controls} aria-label="Player directory controls">
        {tabOptions.length > 0 && <AccountListGroups label="Player group" value={parentType} onChange={handleTabChange} options={tabOptions} />}
      <FiltersBar
        query={query}
        status={status}
        balanceRange={balanceRange}
        registered={registered}
        registeredRange={registeredRange}
        onChangeQuery={setQuery}
        onChangeStatus={setStatus}
        onChangeBalanceRange={setBalanceRange}
        onChangeRegistered={setRegistered}
        onChangeRegisteredRange={(range) => {
          setRegisteredRange(range)
        }}
        onClearAll={() => {
          setQuery('');
          setStatus("");
          setBalanceRange("");
          setRegistered("");
          setRegisteredRange({});
          setPlayerTypeFilter("");
          setAgentId(undefined);
          setCurrentPage(1);
          refetch();
        }}
        parentType={parentType}
        agentId={agentId}
        onChangeAgentId={setAgentId}
        agentsForSelector={agentsForSelector}
        showAgentFilter={parentType !== 'DIRECT' && parentType !== 'ALL'}
        showPlayerTypeFilter={parentType === 'ALL' || parentType === 'DIRECT'}
        playerTypeFilter={playerTypeFilter}
        onChangePlayerTypeFilter={setPlayerTypeFilter}
      />

      </section>

      <PlayersTable
        players={paginatedPlayers}
        fetching={fetching}
        total={totalPlayers}
        parentType={parentType}
        loggedInAgentSchemeType={isAgentLoggedIn ? agentSchemeType : undefined}
        convertFromWhitelabelCurrency={(n: number) =>
          Number(convertFromWhitelabelCurrency(Number(n)))
        }
        onOpenActions={(u) => {
          openDrawer(u);
        }}
        onRefetch={() => refetch()}
        onAdjustBalance={(u) => {
          setSelectedPlayerForBalance(u);
          setBalanceModalOpen(true);
        }}
        onAdjustCredit={(u) => {
          setSelectedPlayerForCredit(u);
          setCreditModalInitialTab('adjust');
          setCreditModalOpen(true);
        }}
        onSettleCredit={(u) => {
          setSelectedPlayerForCredit(u);
          setCreditModalInitialTab('settle');
          setCreditModalOpen(true);
        }}
        onSpecialBonus={(u) => {
          setSelectedPlayerForSpecialBonus(u);
          setSpecialBonusModalOpen(true);
        }}
        onView={(id) => {
          window.location.href = `/players/profile/${id}`;
        }}
        footer={
          <Pagination loading={fetching}
            current={currentPage}
            pageSize={pageSize}
            total={totalPlayers}
            onChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            itemName="players"
            pageSizeOptions={[10, 20, 50, 100]}
          />
        }
      />

      <RecentActivity defer={!secondaryReady} />

      {/* Actions Drawer */}
      <ActionsDrawer
        user={selectedUser}
        open={drawerOpen}
        onClose={() => {
          closeDrawer();
          setSelectedUser(null);
        }}
        onRefetch={() => refetch()}
      />

      {/* Balance Adjustment Modal */}
      <BalanceAdjustmentModal
        open={balanceModalOpen}
        player={selectedPlayerForBalance}
        onClose={() => {
          setBalanceModalOpen(false);
          setSelectedPlayerForBalance(null);
        }}
        onSuccess={() => {
          refetch();
        }}
      />

      {/* Special Bonus Modal */}
      <SpecialBonusModal
        open={specialBonusModalOpen}
        player={selectedPlayerForSpecialBonus}
        onClose={() => {
          setSpecialBonusModalOpen(false);
          setSelectedPlayerForSpecialBonus(null);
        }}
        onSuccess={() => {
          refetch();
        }}
      />

      {/* Credit Adjustment Modal */}
      <CreditAdjustmentModal
        open={creditModalOpen}
        player={selectedPlayerForCredit}
        initialTab={creditModalInitialTab}
        onClose={() => {
          setCreditModalOpen(false);
          setSelectedPlayerForCredit(null);
          setCreditModalInitialTab('limit');
        }}
        onSuccess={() => {
          refetch();
        }}
      />
      </Page>
    </div>
  );
}
