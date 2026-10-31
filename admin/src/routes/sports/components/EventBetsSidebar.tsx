import { useState, useMemo, useEffect, useRef, useCallback, useId } from 'react';
import { useQuery, gql, useMutation, useApolloClient, NetworkStatus } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/shared/core/CurrencyContext';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels';
import { useAuthStore } from '@/shared/core/authStore';
import { useUIStore } from '@/shared/core/uiStore';
import { PatternBadge } from './PatternBadge';
import { PlayerFlagIndicator } from './PlayerFlagIndicator';
import { GET_BETTING_PATTERNS_QUERY } from '@/lib/graphql/bettingPatterns';
import { VOID_BET_MUTATION, CANCEL_BET_MUTATION } from '@/lib/graphql/playerIntelligence';
import { AGENT_ROOT_AGENTS_QUERY, AGENT_TREE_FOR_VIEW_QUERY, AGENT_DESCENDANT_IDS_QUERY } from '@/lib/graphql/agents';
import { IconAlertTriangle, IconCircleX, IconCopy, IconDots, IconFilter, IconLayoutSidebarRightCollapse, IconNetwork, IconUser } from '@tabler/icons-react';
import { copyToClipboard } from '@/shared/utils/clipboard';
import { Card } from '@/ui/components/Card';
import { Button } from '@/ui/components/Button';
import { IconButton } from '@/ui/components/IconButton';
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu';
import { strokeFor } from '@/ui/components/icons';
import { SearchField } from '@/ui/components/SearchField';
import { Select } from '@/ui/components/Select';
import { SegmentedControl } from '@/ui/components/SegmentedControl';
import { Switch } from '@/ui/components/Switch';
import { Dialog } from '@/ui/components/Dialog';
import { Textarea } from '@/ui/components/Textarea';
import { DescriptionList } from '@/ui/components/DescriptionList';
import { StatusPill } from '@/ui/components/StatusPill';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { toast } from '@/ui/components/toast';
import { sidebarCut, sidebarPotentialPayout, sidebarBetPnL, resolveSidebarMarket, resolveSidebarRunner, type SidebarBet, type ProcessedSidebarBet, type SidebarPattern, type SidebarMarket, type SidebarRunner, type SidebarAgent, type SidebarUserSummary } from '../live-analysis/sportsLiveModel';
import styles from './EventBetsSidebar.module.css';
const EVENT_BETS_QUERY = gql`
  query EventBets($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      eventId
      eventName
      sportId
      sportName
      leagueId
      leagueName
      marketId
      selectionId
      side
      price
      stake
      liability
      status
      result
      settledAt
      matchedAt
      currency
      createdAt
      ipAddress
      userAgent
      location
      country
      deviceInfo
      oddsSize
      userName
      userFlags
      agentInfo {
        agentId
        agentName
        schemeType
        rate
      }
    }
  }
`;

/** Used for batch Apollo client.query (no per-row hooks). */
const RUNNERS_BY_MARKET_QUERY = gql`
  query RunnersByMarket($marketId: ID!) {
    runnersByMarket(marketId: $marketId) {
      id
      name
      selectionCode
      sortPriority
      status
    }
  }
`;


const MAX_SIDEBAR_BETS_CACHE = 1500;
const EMPTY_PLACED_BET_BATCH: SidebarBet[] = [];
const EMPTY_ROLES: string[] = [];
interface EventBetsSidebarProps { eventId?: string | null; isCollapsed: boolean; setIsCollapsed: (value: boolean) => void; showSportsHierarchy?: boolean; mobileMode?: boolean; placedBetBatch?: SidebarBet[]; patternsByUserId?: Map<string, SidebarPattern[]> | null; isWide?: boolean; onToggleWide?: () => void }
interface BetActionResponse { voidBet?: { success?: boolean; message?: string }; cancelBet?: { success?: boolean; message?: string } }
type GroupingMode = 'none' | 'user' | 'agent';
const isOpenSidebarBet = (bet: SidebarBet) => { const status = String(bet?.status || '').toLowerCase(); return status === 'matched' || status === 'unmatched'; };
export function EventBetsSidebar({
  eventId,
  isCollapsed,
  setIsCollapsed,
  showSportsHierarchy = false,
  mobileMode = false,
  placedBetBatch,
  patternsByUserId: patternsByUserIdProp = null,
  isWide = false,
  onToggleWide,
}: EventBetsSidebarProps) {
  const placedBetBatchEffective = placedBetBatch ?? EMPTY_PLACED_BET_BATCH;
  const navigate = useNavigate();
  const { whitelabel } = useCurrentWhitelabel();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const isAgent = useAuthStore(s => s.isAgent());
  const loggedInAgent = useAuthStore(s => s.agent);
  const [playerSearch, setPlayerSearch] = useState("");
  const [voidInvalidFilter, setVoidInvalidFilter] = useState<'all' | 'void' | 'invalid'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'unmatched' | 'won' | 'lost'>('all');
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('none');
  /** Kit All / Back / Lay: which side of the book the list shows. Lay covers every non-back side (fancy No). */
  const [sideFilter, setSideFilter] = useState<'all' | 'back' | 'lay'>('all');
  /** The Filters disclosure (Void/Invalid, Status, Group by) under the side control. */
  const [showFilters, setShowFilters] = useState(false);
  const filtersId = useId();
  const [autoScroll, setAutoScroll] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const betsListRef = useRef<HTMLDivElement>(null);
  // Hide void/invalid for agents - only allow for super admin and whitelabel users
  const canVoidInvalid = !!whitelabel && !isAgent;

  const [modalAction, setModalAction] = useState<'void' | 'invalid' | null>(null);
  const [modalBetId, setModalBetId] = useState<string | null>(null);
  const [voidInvalidSubmitting, setVoidInvalidSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [voidBet] = useMutation<BetActionResponse>(VOID_BET_MUTATION, { context: { uiToast: 'notification' } });
  const [cancelBet] = useMutation<BetActionResponse>(CANCEL_BET_MUTATION, { context: { uiToast: 'notification' } });

  // Role checks for hierarchy view (same as EventSidebar / MarketCard)
  const storedRoles = useAuthStore(s => s.roles);
  const roles = useMemo(() => storedRoles ?? EMPTY_ROLES, [storedRoles]);
  const directorMode = useUIStore(s => s.directorMode);
  const isWhitelabelAdmin = useMemo(
    () =>
      roles.some(
        r =>
          r === "Whitelabel Admin" ||
          r.toLowerCase() === "whitelabel_admin" ||
          r.toLowerCase().includes("whitelabel"),
      ),
    [roles],
  );
  const isSuperAdmin = useMemo(
    () =>
      roles.some(
        r =>
          r === "Super Admin" ||
          r.toLowerCase() === "super_admin" ||
          (r.toLowerCase().includes("super") && r.toLowerCase().includes("admin")),
      ),
    [roles],
  );
  const isWhitelabelView = isWhitelabelAdmin || (isSuperAdmin && directorMode === "whitelabel");
  const isAgentLogin = isAgent && !!loggedInAgent?.id;

  const client = useApolloClient();
  const [descendantIdsMap, setDescendantIdsMap] = useState<Map<string, string[]>>(new Map());

  const { data: agentTreeData } = useQuery<{ agents: { agentTree: Array<{ id: string }> } }>(AGENT_TREE_FOR_VIEW_QUERY, {
    variables: { rootId: loggedInAgent?.id ?? "" },
    skip: !isAgentLogin || !loggedInAgent?.id,
    fetchPolicy: "cache-first",
  });

  const { data: agentRootAgentsData } = useQuery<{ agents: { agentRootAgents: SidebarAgent[] } }>(AGENT_ROOT_AGENTS_QUERY, {
    skip: isAgentLogin || !isWhitelabelView,
    fetchPolicy: "cache-first",
  });

  const agentInfoMap = useMemo(() => {
    const map = new Map<string, { username: string | null; schemeType: string; rate: number | null }>();
    if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
      (agentRootAgentsData.agents.agentRootAgents as SidebarAgent[]).forEach((a: SidebarAgent) => {
        map.set(a.id, {
          username: a.username,
          schemeType: a.schemeType,
          rate: a.rate,
        });
      });
    }
    return map;
  }, [isWhitelabelView, agentRootAgentsData?.agents?.agentRootAgents]);

  const directChildIds = useMemo(() => {
    if (isAgentLogin && loggedInAgent?.id) {
      const tree = (agentTreeData?.agents?.agentTree ?? []) as { id: string }[];
      return tree.map(c => c.id);
    }
    if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
      return (agentRootAgentsData.agents.agentRootAgents as { id: string }[]).map(a => a.id);
    }
    return [];
  }, [isAgentLogin, loggedInAgent?.id, agentTreeData?.agents?.agentTree, isWhitelabelView, agentRootAgentsData?.agents?.agentRootAgents]);

  useEffect(() => {
    if (directChildIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      directChildIds.map(id =>
        client.query({
          query: AGENT_DESCENDANT_IDS_QUERY,
          variables: { agentId: id },
        }),
      ),
    ).then(results => {
      if (cancelled) return;
      setDescendantIdsMap(prev => {
        const next = new Map(prev);
        directChildIds.forEach((id, i) => {
          const ids =
            (results[i]?.data as { agents?: { agentDescendantIds?: string[] } })?.agents
              ?.agentDescendantIds ?? [id];
          next.set(id, ids);
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [directChildIds, client]);

  const getDescendantsOf = useCallback(
    (agentId: string): string[] => descendantIdsMap.get(agentId) ?? [agentId],
    [descendantIdsMap],
  );

  const getDirectChildAgentId = useCallback(
    (agentId: string): string | null => {
      if (!directChildIds.length) return agentId;
      if (directChildIds.includes(agentId)) return agentId;
      for (const directChildId of directChildIds) {
        const descendants = getDescendantsOf(directChildId);
        if (descendants.includes(agentId)) return directChildId;
      }
      return null;
    },
    [directChildIds, getDescendantsOf],
  );

  const descendantsLoaded =
    directChildIds.length === 0 ||
    directChildIds.every(id => descendantIdsMap.has(id));

  // The row's ⋯ menu unmounts as an item is chosen, so the dialogs it opens return focus to (and take
  // their theme from) the ⋯ button rather than the menu item that was focused when they opened.
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const [connectionBet, setConnectionBet] = useState<ProcessedSidebarBet | null>(null);
  const openConnectionDetails = useCallback((bet: ProcessedSidebarBet, opener: HTMLElement | null) => {
    dialogOpenerRef.current = opener;
    setConnectionBet(bet);
  }, []);
  const openVoidModal = useCallback((betId: string, opener: HTMLElement | null = null) => {
    dialogOpenerRef.current = opener;
    setModalBetId(betId);
    setModalAction('void');
    setReason(""); setReasonError(undefined);
  }, []);
  const openInvalidModal = useCallback((betId: string, opener: HTMLElement | null = null) => {
    dialogOpenerRef.current = opener;
    setModalBetId(betId);
    setModalAction('invalid');
    setReason(""); setReasonError(undefined);
  }, []);
  const closeVoidInvalidModal = useCallback(() => {
    setModalAction(null);
    setModalBetId(null);
    setReason(""); setReasonError(undefined);
  }, []);
  
  // Fetch patterns for bets (skipped when parent passes shared patternsByUserId)
  const { data: patternsDataLocal } = useQuery<{ bettingPatterns: SidebarPattern[] }>(GET_BETTING_PATTERNS_QUERY, {
    variables: { eventId: eventId || undefined, limit: 1000 },
    skip: !eventId || patternsByUserIdProp != null,
    errorPolicy: "all",
    pollInterval: 60000,
  });

  const patternsMap = useMemo(() => {
    if (patternsByUserIdProp != null) return patternsByUserIdProp;
    const map = new Map<string, SidebarPattern[]>();
    if (patternsDataLocal?.bettingPatterns) {
      patternsDataLocal.bettingPatterns.forEach((pattern: SidebarPattern) => {
        const userId = String(pattern.userId);
        if (!map.has(userId)) {
          map.set(userId, []);
        }
        map.get(userId)!.push(pattern);
      });
    }
    return map;
  }, [patternsByUserIdProp, patternsDataLocal]);

  const BETS_PER_PAGE = 100; // Load 100 bets at a time
  
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  // This ensures proper filtering based on selected whitelabel in admin panel
  const { data, loading, fetchMore, networkStatus, refetch } = useQuery<{ sportsBets: SidebarBet[] }>(EVENT_BETS_QUERY, {
    variables: {
      query: {
        eventId: eventId || undefined,
        statuses: ['matched', 'unmatched'], // Only open/matched bets
        search: playerSearch.trim() || undefined,
        limit: BETS_PER_PAGE,
        offset: 0,
      },
    },
    skip: false, // Always fetch bets, even without eventId
    // Removed pollInterval - using subscription instead for real-time updates
    errorPolicy: "all",
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    // Bets are filtered by whitelabel on the backend via headers
    fetchPolicy: "network-only",
    notifyOnNetworkStatusChange: true, // Notify when loading more
  });

  // Check if we're currently refetching (for pagination)
  const isPolling = networkStatus === NetworkStatus.refetch || networkStatus === NetworkStatus.fetchMore;

  const handleVoidInvalidSubmit = useCallback(async () => {
    try {
      if (!reason) { setReasonError("Please input a reason"); return; }
      if (!modalBetId || !modalAction) return;
      setVoidInvalidSubmitting(true);
      const isVoid = modalAction === 'void';
      const mutate = isVoid ? voidBet : cancelBet;
      const res = await mutate({ variables: { betId: modalBetId, reason } });
      const payload = res.data?.voidBet ?? res.data?.cancelBet;
      if (payload?.success) {
        toast({ tone: "ok", duration: 4500, message: payload.message ?? (isVoid ? 'Bet voided' : 'Bet cancelled') });
        refetch();
        closeVoidInvalidModal();
      } else {
        toast({ tone: "error", duration: 4500, message: payload?.message ?? (isVoid ? 'Failed to void bet' : 'Failed to cancel bet') });
      }
    } catch (e: unknown) {
      toast({ tone: "error", duration: 4500, message: (e instanceof Error ? e.message : undefined) ?? (modalAction === 'void' ? 'Failed to void bet' : 'Failed to cancel bet') });
    } finally {
      setVoidInvalidSubmitting(false);
    }
  }, [modalBetId, modalAction, reason, voidBet, cancelBet, closeVoidInvalidModal, refetch]);

  // State to hold bets including subscription updates
  const [betsCache, setBetsCache] = useState<SidebarBet[]>([]);

  // Reset pagination and bets cache when eventId changes (run first)
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setIsLoadingMore(false);
    setBetsCache([]); // Clear bets cache when event changes
    // Reset previous bets count for auto-scroll
    previousBetsCount.current = 0;
    
    // Debug: Log eventId change
  }, [eventId]);

  // Initialize bets cache from query data (run after reset) - only open/matched bets
  const hasQueryData = !!data;
  useEffect(() => {
    if (data?.sportsBets && Array.isArray(data.sportsBets)) {
      const allBets = data.sportsBets.filter(isOpenSidebarBet);
      const filteredBets = eventId 
        ? allBets.filter((bet: SidebarBet) => String(bet.eventId || '') === String(eventId || ''))
        : allBets;
      setBetsCache(filteredBets.slice(0, MAX_SIDEBAR_BETS_CACHE));

      // Update hasMore based on initial data length
      if (filteredBets.length < BETS_PER_PAGE) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
    } else if (hasQueryData && !data?.sportsBets) {
      // Query completed but no bets - clear cache
      setBetsCache([]);
      setHasMore(false);
    }
  }, [data?.sportsBets, eventId, hasQueryData]);

  const processedPlacedBetIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    processedPlacedBetIdsRef.current = new Set();
  }, [eventId]);

  /** Merge real-time bets from EventDetailPage (single shared subscription). */
  useEffect(() => {
    if (!placedBetBatchEffective.length) return;
    const toAdd: SidebarBet[] = [];
    for (const newBet of placedBetBatchEffective) {
      if (!newBet?.id) continue;
      const s = String(newBet?.status || "").toLowerCase();
      if (s !== "matched" && s !== "unmatched") continue;
      if (eventId && String(newBet.eventId || "") !== String(eventId || "")) continue;
      const idStr = String(newBet.id);
      if (processedPlacedBetIdsRef.current.has(idStr)) continue;
      processedPlacedBetIdsRef.current.add(idStr);
      toAdd.push(newBet);
    }
    if (toAdd.length === 0) return;
    setBetsCache((prevBets) => {
      let next = [...prevBets];
      for (const newBet of toAdd) {
        if (next.some((bet: SidebarBet) => bet.id === newBet.id)) continue;
        next = [newBet, ...next];
      }
      return next.length > MAX_SIDEBAR_BETS_CACHE ? next.slice(0, MAX_SIDEBAR_BETS_CACHE) : next;
    });
  }, [placedBetBatchEffective, eventId]);

  // Get bets from cache
  const bets = useMemo(() => {
    return betsCache;
  }, [betsCache]);

  // Load more bets when scrolling near bottom
  const loadMoreBets = useCallback(async () => {
    if (isLoadingMore || !hasMore || !fetchMore || isPolling) return;
    
    setIsLoadingMore(true);
    try {
      const currentOffset = betsCache.length; // Use current bets cache count as offset
      // NOTE: Don't pass tenant - let backend derive it from context
      const result = await fetchMore({
        variables: {
          query: {
            eventId: eventId || undefined,
            statuses: ['matched', 'unmatched'],
            search: playerSearch.trim() || undefined,
            limit: BETS_PER_PAGE,
            offset: currentOffset,
          },
        },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult?.sportsBets) {
            return prev;
          }
          // Merge new bets with existing ones
          const existingBets = prev?.sportsBets || [];
          const newBets = fetchMoreResult.sportsBets || [];
          // Filter out duplicates by ID
          const existingIds = new Set(existingBets.map((b: SidebarBet) => b.id));
          const uniqueNewBets = newBets.filter((b: SidebarBet) => !existingIds.has(b.id));
          
          // Note: hasMore update is handled outside updateQuery to avoid side effects in Apollo callback
          
          return {
            ...prev,
            sportsBets: [...existingBets, ...uniqueNewBets],
          };
        },
      });
      
      // Update betsCache with new bets from fetchMore
      if (result.data?.sportsBets) {
        let newBetsCount = 0;
        setBetsCache((prevBets) => {
          const existingIds = new Set(prevBets.map((b: SidebarBet) => b.id));
          const newBets = result.data.sportsBets.filter((b: SidebarBet) => {
            // Filter by eventId and check for duplicates
            const matchesEvent = !eventId || String(b.eventId || '') === String(eventId || '');
            return matchesEvent && !existingIds.has(b.id);
          });
          
          newBetsCount = newBets.length;
          
          const merged = [...prevBets, ...newBets];
          return merged.length > MAX_SIDEBAR_BETS_CACHE ? merged.slice(0, MAX_SIDEBAR_BETS_CACHE) : merged;
        });
        
        // Update hasMore based on new bets count (outside setState callback)
        if (newBetsCount < BETS_PER_PAGE) {
          setHasMore(false);
        }
      } else {
        // No more bets available
        setHasMore(false);
      }
      
      setOffset(currentOffset);
    } catch {
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, fetchMore, betsCache.length, eventId, playerSearch, isPolling]);

  // Handle scroll to detect when near bottom
  useEffect(() => {
    const scrollContainer = betsListRef.current;
    if (!scrollContainer || autoScroll) return; // Don't load more if auto-scroll is enabled

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      
      // Load more when 80% scrolled (but not during polling)
      if (scrollPercentage > 0.8 && hasMore && !isLoadingMore && !isPolling) {
        loadMoreBets();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [hasMore, isLoadingMore, autoScroll, loadMoreBets, isPolling]);

  // Auto-scroll to top when new bets arrive (if auto-scroll is enabled)
  const previousBetsCount = useRef(0);
  useEffect(() => {
    if (autoScroll && betsListRef.current && Array.isArray(betsCache)) {
      const currentBetsCount = betsCache.length;
      if (currentBetsCount > previousBetsCount.current && previousBetsCount.current > 0) {
        // New bets arrived, scroll to top
        betsListRef.current.scrollTop = 0;
      }
      previousBetsCount.current = currentBetsCount;
    }
  }, [betsCache, autoScroll]);

  // Get unique marketIds from bets (for batch fetching when eventId is not available)
  const uniqueMarketIds = useMemo(() => {
    if (!Array.isArray(betsCache) || eventId) return []; // Only when eventId is null
    const marketIdSet = new Set<string>();
    betsCache.forEach((bet: SidebarBet) => {
      if (bet?.marketId) {
        marketIdSet.add(String(bet.marketId));
      }
    });
    return Array.from(marketIdSet).slice(0, 100); // Limit to 100 to avoid huge queries
  }, [betsCache, eventId]);

  // Fetch markets for this event (if eventId is available)
  const { data: eventMarketsData } = useQuery<{ marketsByEvent: SidebarMarket[] }>(
    gql`
      query MarketsByEvent($eventId: ID!) {
        marketsByEvent(eventId: $eventId) {
          id
          name
          type
        }
      }
    `,
    {
      variables: { eventId: eventId! },
      skip: !eventId,
      errorPolicy: "all",
    }
  );

  // Fetch markets by IDs when eventId is not available (for all bets view)
  const { data: marketsByIdsData } = useQuery<{ marketsByIds: SidebarMarket[] }>(
    gql`
      query MarketsByIds($marketIds: [ID!]!) {
        marketsByIds(marketIds: $marketIds) {
          id
          name
          type
        }
      }
    `,
    {
      variables: { marketIds: uniqueMarketIds },
      skip: !!eventId || uniqueMarketIds.length === 0,
      errorPolicy: "all",
    }
  );

  // Batch-fetch runners per unique market (avoids N× per-row GraphQL hooks)
  const runnerFetchMarketIds = useMemo(() => {
    if (!Array.isArray(betsCache)) return [] as string[];
    const set = new Set<string>();
    betsCache.forEach((bet: SidebarBet) => {
      if (bet?.marketId) set.add(String(bet.marketId));
    });
    return Array.from(set).slice(0, 120);
  }, [betsCache]);

  const runnerFetchKey = runnerFetchMarketIds.join("|");
  const runnerIdsRef = useRef(runnerFetchMarketIds);
  runnerIdsRef.current = runnerFetchMarketIds;
  const [runnersByMarketId, setRunnersByMarketId] = useState<Record<string, SidebarRunner[]>>({});

  useEffect(() => {
    const runnerIds = runnerIdsRef.current;
    if (runnerIds.length === 0) {
      setRunnersByMarketId({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      runnerIds.map((mid) =>
        client
          .query({
            query: RUNNERS_BY_MARKET_QUERY,
            variables: { marketId: mid },
            fetchPolicy: "cache-first",
            errorPolicy: "all",
          })
          .then((res) => ({
            mid,
            runners: (res.data as { runnersByMarket?: SidebarRunner[] })?.runnersByMarket,
          }))
          .catch(() => ({ mid, runners: undefined as SidebarRunner[] | undefined })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, SidebarRunner[]> = {};
      for (const row of results) {
        if (Array.isArray(row.runners)) next[String(row.mid)] = row.runners;
      }
      setRunnersByMarketId(next);
    });
    return () => {
      cancelled = true;
    };
  }, [runnerFetchKey, client]);

  // Create markets map from event markets or markets by IDs
  const marketsMap = useMemo(() => {
    const map: Record<string, SidebarMarket> = {};
    
    // If eventId is available, use eventMarketsData
    if (eventMarketsData?.marketsByEvent && Array.isArray(eventMarketsData.marketsByEvent)) {
      eventMarketsData.marketsByEvent.forEach((market: SidebarMarket) => {
        if (market && market.id) {
          // Store with both string and number keys to handle ID type mismatches
          const idStr = String(market.id);
          const marketData = {
            ...market,
            kind: market.type || market.kind, // Map type to kind for consistency
            type: market.type || market.kind, // Keep both for compatibility
          };
          map[idStr] = marketData;
          if (Number.isFinite(Number(market.id))) {
            map[Number(market.id)] = marketData;
          }
          // Also try with different ID formats
          if (market.id.toString() !== idStr) {
            map[market.id.toString()] = marketData;
          }
        }
      });
    }
    
    // If eventId is not available, use marketsByIdsData
    if (!eventId && marketsByIdsData?.marketsByIds && Array.isArray(marketsByIdsData.marketsByIds)) {
      marketsByIdsData.marketsByIds.forEach((market: SidebarMarket) => {
        if (market && market.id) {
          const idStr = String(market.id);
          const marketData = {
            ...market,
            kind: market.type || market.kind,
            type: market.type || market.kind,
          };
          map[idStr] = marketData;
          if (Number.isFinite(Number(market.id))) {
            map[Number(market.id)] = marketData;
          }
          if (market.id.toString() !== idStr) {
            map[market.id.toString()] = marketData;
          }
        }
      });
    }
    
    return map;
  }, [eventMarketsData, marketsByIdsData, eventId]);

  // Filter and process bets (no client-side search filtering - done server-side)
  const processedBets = useMemo<ProcessedSidebarBet[]>(() => {
    if (!Array.isArray(bets)) return [];
    return bets.map((bet: SidebarBet) => {
      if (!bet) return null;
      const cutInfo = sidebarCut(bet);
      const userPatterns = patternsMap.get(String(bet.userId)) || [];
      return {
        ...bet,
        cutInfo,
        displayPayout: cutInfo.netPayout || bet.liability || 0,
        patterns: userPatterns,
      };
    }).filter((bet): bet is ProcessedSidebarBet => bet !== null);
  }, [bets, patternsMap]);

  // Client-side filters: Void/Invalid and Status (applied to processedBets)
  // Also sort matched bets to the top
  const filteredProcessedBets = useMemo(() => {
    if (!Array.isArray(processedBets)) return [];
    
    // First filter
    const filtered = processedBets.filter((bet: ProcessedSidebarBet) => {
      const s = String(bet?.status || '').toLowerCase();
      if (voidInvalidFilter === 'void' && s !== 'void') return false;
      if (voidInvalidFilter === 'invalid' && s !== 'cancelled') return false;
      if (statusFilter !== 'all' && s !== statusFilter) return false;
      const isBack = String(bet?.side || '').toLowerCase() === 'back';
      if (sideFilter === 'back' && !isBack) return false;
      if (sideFilter === 'lay' && isBack) return false;
      return true;
    });
    
    // Then sort: matched bets first, then by createdAt (newest first) — copy to avoid mutating memo input
    return [...filtered].sort((a: ProcessedSidebarBet, b: ProcessedSidebarBet) => {
      const statusA = String(a?.status || "").toLowerCase();
      const statusB = String(b?.status || "").toLowerCase();

      if (statusA === "matched" && statusB !== "matched") return -1;
      if (statusA !== "matched" && statusB === "matched") return 1;

      const dateA = new Date(a?.createdAt || 0).getTime();
      const dateB = new Date(b?.createdAt || 0).getTime();
      return dateB - dateA;
    });
  }, [processedBets, voidInvalidFilter, statusFilter, sideFilter]);

  // Refetch when search changes (debounced)
  // NOTE: Don't pass tenant - let backend derive it from context
  useEffect(() => {
    if (!refetch) return;
    
    const timeoutId = setTimeout(() => {
      refetch({
        variables: {
          query: {
            eventId: eventId || undefined,
            statuses: ['matched', 'unmatched'],
            search: playerSearch.trim() || undefined,
            limit: BETS_PER_PAGE,
            offset: 0,
          },
        },
      });
    }, 300); // Debounce search by 300ms

    return () => clearTimeout(timeoutId);
  }, [playerSearch, eventId, refetch]);

  // Get unique user IDs for fetching attributions (from filtered list)
  const uniqueUserIds = useMemo(() => {
    if (!Array.isArray(filteredProcessedBets)) return [];
    const ids = new Set<string>();
    filteredProcessedBets.forEach((bet: ProcessedSidebarBet) => {
      if (bet?.userId) ids.add(String(bet.userId));
    });
    return Array.from(ids);
  }, [filteredProcessedBets]);

  // Fetch referral attributions for all users (to get their agents)
  const { data: attributionsData } = useQuery<{ batchReferralAttributions: Array<{ refereeId?: string; referrerId?: string }> }>(
    gql`
      query BatchReferralAttributions($refereeIds: [String!]!) {
        batchReferralAttributions(refereeIds: $refereeIds) {
          refereeId
          referrerId
        }
      }
    `,
    {
      variables: { refereeIds: uniqueUserIds },
      skip: groupingMode !== 'agent' || uniqueUserIds.length === 0,
      errorPolicy: "all",
    }
  );

  // Create user -> agent mapping
  // Priority: 1) agentInfo from bets (most reliable), 2) referral attributions query
  const userToAgentMap = useMemo(() => {
    const map: Record<string, string> = {};
    
    // First, use agentInfo from bets (most reliable source)
    if (Array.isArray(filteredProcessedBets)) {
      filteredProcessedBets.forEach((bet: ProcessedSidebarBet) => {
        if (bet?.userId && bet?.agentInfo?.agentId) {
          const userId = String(bet.userId);
          const agentId = String(bet.agentInfo.agentId);
          // Only set if not already set (bets are more reliable)
          if (!map[userId]) {
            map[userId] = agentId;
          }
        }
      });
    }
    
    // Then, fill in gaps from referral attributions query
    const attributions = attributionsData?.batchReferralAttributions || [];
    attributions.forEach((attr: { refereeId?: string; referrerId?: string }) => {
      if (attr?.refereeId && attr?.referrerId) {
        const userId = String(attr.refereeId);
        // Only use if not already set from bets
        if (!map[userId]) {
          map[userId] = String(attr.referrerId);
        }
      }
    });
    
    return map;
  }, [attributionsData, filteredProcessedBets]);

  // Group bets by user (from filtered list)
  const betsByUser = useMemo(() => {
    if (groupingMode !== 'user') return {};
    if (!Array.isArray(filteredProcessedBets)) return {};
    const grouped: Record<string, ProcessedSidebarBet[]> = {};
    filteredProcessedBets.forEach((bet: ProcessedSidebarBet) => {
      if (bet && bet.userId) {
        const key = String(bet.userId) || "no-user";
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(bet);
      }
    });
    return grouped;
  }, [filteredProcessedBets, groupingMode]);

  // Group bets by agent (from filtered list). When hierarchy is loaded, roll up by effective (root/direct) agent.
  const betsByAgentGroup = useMemo(() => {
    if (groupingMode !== 'agent') return {};
    if (!Array.isArray(filteredProcessedBets)) return {};
    const grouped: Record<string, ProcessedSidebarBet[]> = {};
    const loggedInAgentId = isAgent && loggedInAgent?.id ? String(loggedInAgent.id) : null;
    const useRollUp = (isAgentLogin || isWhitelabelView) && descendantsLoaded && directChildIds.length > 0;

    filteredProcessedBets.forEach((bet: ProcessedSidebarBet) => {
      if (bet && bet.userId) {
        const rawAgentId = userToAgentMap[String(bet.userId)] || bet?.agentInfo?.agentId;
        if (!rawAgentId || rawAgentId === 'unassigned') return;

        const effectiveAgentId = useRollUp
          ? (getDirectChildAgentId(String(rawAgentId)) ?? rawAgentId)
          : rawAgentId;
        if (!effectiveAgentId) return;
        if (loggedInAgentId && effectiveAgentId === loggedInAgentId) return;

        if (!grouped[effectiveAgentId]) {
          grouped[effectiveAgentId] = [];
        }
        grouped[effectiveAgentId].push(bet);
      }
    });
    return grouped;
  }, [
    filteredProcessedBets,
    groupingMode,
    userToAgentMap,
    isAgent,
    loggedInAgent?.id,
    isAgentLogin,
    isWhitelabelView,
    descendantsLoaded,
    directChildIds.length,
    getDirectChildAgentId,
  ]);

  // Calculate summary (from filtered list)
  const summary = useMemo(() => {
    const totalBets = filteredProcessedBets.length;
    const totalStake = filteredProcessedBets.reduce((sum: number, bet: ProcessedSidebarBet) => sum + (bet.liability ?? bet.stake ?? 0), 0);
    const totalPotentialPayout = filteredProcessedBets.reduce(
      (sum: number, bet: ProcessedSidebarBet) => sum + sidebarPotentialPayout(bet, marketsMap),
      0
    );
    const totalGrossPayout = filteredProcessedBets.reduce(
      (sum: number, bet: ProcessedSidebarBet) => sum + (bet.cutInfo.grossPayout || bet.liability || 0),
      0
    );
    const totalCuts = filteredProcessedBets.reduce(
      (sum: number, bet: ProcessedSidebarBet) => sum + (bet.cutInfo.cutAmount || 0),
      0
    );
    const totalNetPayout = filteredProcessedBets.reduce(
      (sum: number, bet: ProcessedSidebarBet) => sum + (bet.cutInfo.netPayout || 0),
      0
    );

    const userBreakdown: Record<string, SidebarUserSummary> = {};
    filteredProcessedBets.forEach((bet: ProcessedSidebarBet) => {
      const userId = bet.userId;
      if (userId) {
        if (!userBreakdown[userId]) {
          userBreakdown[userId] = {
            userId,
            bets: 0,
            totalStake: 0,
            totalPotentialPayout: 0,
            totalCut: 0,
          };
        }
        userBreakdown[userId].bets += 1;
        userBreakdown[userId].totalStake += bet.liability ?? bet.stake ?? 0;
        userBreakdown[userId].totalPotentialPayout += sidebarPotentialPayout(bet, marketsMap);
        userBreakdown[userId].totalCut += bet.cutInfo.cutAmount || 0;
      }
    });

    return {
      totalBets,
      totalStake,
      totalPotentialPayout,
      totalGrossPayout,
      totalCuts,
      totalNetPayout,
      userBreakdown,
    };
  }, [filteredProcessedBets, marketsMap]);

  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const renderBet = (bet: ProcessedSidebarBet) => <BetRow key={bet.id} bet={bet} marketsMap={marketsMap} runnersByMarketId={runnersByMarketId} showSportsHierarchy={showSportsHierarchy} onViewPlayer={() => navigate(`/players/profile/${bet.userId}`)} canVoidInvalid={canVoidInvalid} onVoidBet={openVoidModal} onInvalidBet={openInvalidModal} onShowConnection={openConnectionDetails} />;
  const renderTable = (rows: ProcessedSidebarBet[], caption: string) => <table className={styles.table}>
    <caption className={styles.srOnly}>{caption}</caption>
    <thead><tr><th scope="col">Bet</th><th scope="col" className={styles.num}>Odds</th><th scope="col" className={styles.num}>Stake</th><th scope="col" className={styles.num}>Liability</th><th scope="col" className={styles.num}>P&amp;L</th><th scope="col">Player</th><th scope="col">Status</th><th scope="col">Placed</th>{showSportsHierarchy && <th scope="col">Event</th>}<th scope="col" className={styles.num}>Actions</th></tr></thead>
    <tbody>{rows.map(renderBet)}</tbody>
  </table>;
  const agentEntries = Object.entries(betsByAgentGroup).filter(([agentId]) => agentId !== 'unassigned');
  // Kit head: "Bets", the count and Live, then Expand; folding the rail is the icon beside it.
  const headTools = !isCollapsed && <>
    {onToggleWide && !mobileMode && <Button size="xs" aria-pressed={isWide} onClick={onToggleWide}>{isWide ? 'Collapse' : 'Expand'}</Button>}
    <IconButton className={styles.headIcon} size="sm" label="Collapse Bets" icon={<IconLayoutSidebarRightCollapse size={16} stroke={strokeFor(16)} />} onClick={() => setIsCollapsed(true)} />
  </>;
  const activeFilters = (voidInvalidFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (groupingMode !== 'none' ? 1 : 0);
  return <aside className={mobileMode ? styles.mobile : [styles.sidebar, isCollapsed && styles.collapsed, isWide && !isCollapsed && styles.wide].filter(Boolean).join(' ')} aria-label="All Bets">
    {/* Live only where the page feeds placed bets in (EventDetailPage); LiveAnalysisPage passes no batch. */}
    <Card title={isCollapsed ? undefined : 'Bets'} sub={filteredProcessedBets.length.toLocaleString()} live={placedBetBatch !== undefined} body={isCollapsed ? 'padded' : 'flush'} tools={headTools}>
      {isCollapsed ? <Button size="sm" block onClick={() => setIsCollapsed(false)} aria-label="Expand Bets">Bets</Button> : <>
        <div className={styles.tools}>
          <SearchField label="Search event bets" placeholder="Player, market or odds" value={playerSearch} onChange={setPlayerSearch} size="sm" />
          <div className={styles.toolsRow}>
            <SegmentedControl label="Bet side" value={sideFilter} onChange={setSideFilter} size="sm" options={[{ value: 'all', label: 'All' }, { value: 'back', label: 'Back' }, { value: 'lay', label: 'Lay' }]} />
            <Button size="sm" icon={<IconFilter size={15} stroke={strokeFor(15)} />} aria-expanded={showFilters} aria-controls={filtersId} onClick={() => setShowFilters(value => !value)}>
              Filters{activeFilters > 0 && <><span className={styles.srOnly}>, </span><span className={styles.filterCount}>{activeFilters}<span className={styles.srOnly}> on</span></span></>}
            </Button>
          </div>
          {showFilters && <div id={filtersId} className={styles.filtersPanel} role="group" aria-label="Bet filters">
            <Select className={styles.field} label="Void/Invalid" size="sm" value={voidInvalidFilter} onChange={value => setVoidInvalidFilter(value as typeof voidInvalidFilter)} options={[{ value: 'all', label: 'All' }, { value: 'void', label: 'Void' }, { value: 'invalid', label: 'Invalid' }]} />
            <Select className={styles.field} label="Status" size="sm" value={statusFilter} onChange={value => setStatusFilter(value as typeof statusFilter)} options={[{ value: 'all', label: 'All' }, { value: 'matched', label: 'Matched' }, { value: 'unmatched', label: 'Unmatched' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />
            <div className={styles.groupBy}><span className={styles.groupByLabel} aria-hidden="true">Group by</span><SegmentedControl label="Group By" value={groupingMode} onChange={setGroupingMode} size="sm" options={[{ value: 'none', label: 'All' }, { value: 'user', label: 'User' }, { value: 'agent', label: 'Agent' }]} /></div>
          </div>}
          <Switch size="sm" label="Show new bets as they arrive" checked={autoScroll} onChange={setAutoScroll} />
        </div>
        <div ref={betsListRef} className={styles.list}>
          {loading && offset === 0 ? <LoadingState label="Loading bets..." /> : !filteredProcessedBets.length ? <EmptyState title="No bets found" /> : groupingMode === 'user' ? Object.entries(betsByUser).map(([userId, userBets]) => {
            const userSummary = summary.userBreakdown[userId] || { bets: userBets.length, totalStake: 0, totalPotentialPayout: 0, totalCut: 0 };
            const userName = userBets[0]?.userName || `User ${userId}`;
            return <details key={userId} className={styles.group}><summary className={styles.summary}><strong>{userName}</strong><span className={styles.muted}>{userBets.length} bet{userBets.length !== 1 ? 's' : ''}</span><span className={styles.muted}>Total Wagered: {fmt(userSummary.totalStake || 0)}</span><span className={styles.muted}>Potential Payout: {fmt(userSummary.totalPotentialPayout || 0)}</span></summary><div className={styles.groupScroll}>{renderTable(userBets, `Bets by ${userName}`)}</div></details>;
          }) : groupingMode === 'agent' ? !agentEntries.length ? <EmptyState title="No agent-assigned bets found" /> : agentEntries.map(([effectiveAgentId, agentBets]) => {
            const totalStake = agentBets.reduce((sum, bet) => sum + (bet.liability ?? bet.stake ?? 0), 0);
            const totalPotentialPayout = agentBets.reduce((sum, bet) => sum + sidebarPotentialPayout(bet, marketsMap), 0);
            const uniqueUsers = new Set(agentBets.map(bet => bet.userId)).size;
            const infoFromMap = agentInfoMap.get(effectiveAgentId);
            const agentInfoFromBet = agentBets.find(bet => bet.agentInfo?.agentId && String(bet.agentInfo.agentId) === effectiveAgentId)?.agentInfo;
            const agentName = infoFromMap?.username ?? agentInfoFromBet?.agentName ?? `Agent ${effectiveAgentId.slice(0, 8)}...`;
            const schemeType = infoFromMap?.schemeType ?? agentInfoFromBet?.schemeType;
            const agentRate = infoFromMap?.rate ?? agentInfoFromBet?.rate ?? 0;
            return <details key={effectiveAgentId} className={styles.group}><summary className={styles.summary}><strong>{agentName}</strong>{schemeType && agentRate > 0 && <span className={styles.muted}>{schemeType === 'SHARING' ? 'Sharing' : schemeType === 'CREDIT' ? 'Credit' : 'Commission'} ({agentRate}%)</span>}<span className={styles.muted}>{uniqueUsers} user{uniqueUsers !== 1 ? 's' : ''} • {agentBets.length} bet{agentBets.length !== 1 ? 's' : ''}</span><span className={styles.muted}>Total Wagered: {fmt(totalStake || 0)}</span><span className={styles.muted}>Potential Payout: {fmt(totalPotentialPayout || 0)}</span></summary><div className={styles.groupScroll}>{renderTable(agentBets, `Bets under ${agentName}`)}</div></details>;
          }) : renderTable(filteredProcessedBets, 'All bets')}
          {(isLoadingMore || (!hasMore && filteredProcessedBets.length > 0)) && <div className={styles.feedFoot}>
            {isLoadingMore && <LoadingState label="Loading more bets..." />}
            {!hasMore && filteredProcessedBets.length > 0 && <span className={styles.muted}>No more bets to load</span>}
          </div>}
        </div>
      </>}
    </Card>
    <Dialog open={modalAction !== null} onOpenChange={open => { if (!open && !voidInvalidSubmitting) closeVoidInvalidModal(); }} dismissible={!voidInvalidSubmitting} restoreFocusTo={dialogOpenerRef} themeFrom={dialogOpenerRef} title={modalAction === 'void' ? 'Confirm Void Bet' : 'Confirm Invalid (Cancel) Bet'} footer={<div className={styles.actions}><Button disabled={voidInvalidSubmitting} onClick={closeVoidInvalidModal}>Cancel</Button><Button variant="primary" loading={voidInvalidSubmitting} onClick={() => void handleVoidInvalidSubmit()}>Confirm</Button></div>}>
      <Textarea label="Reason" required rows={3} placeholder="Enter reason" value={reason} onChange={setReason} error={reasonError} />
    </Dialog>
    <Dialog open={connectionBet !== null} onOpenChange={open => { if (!open) setConnectionBet(null); }} size="sm" restoreFocusTo={dialogOpenerRef} themeFrom={dialogOpenerRef} title="Connection Details" description="IP & Device Info">
      {connectionBet && <div className={styles.stack}>
        <DescriptionList items={[{ term: 'IP Address', value: connectionBet.ipAddress || connectionBet.ip || 'Not captured' }, { term: 'User Agent', value: connectionBet.userAgent || connectionBet.user_agent || 'Not captured' }, { term: 'Device', value: connectionBet.deviceInfo || connectionBet.device_info || 'N/A' }, { term: 'Location', value: connectionBet.location || connectionBet.country || 'N/A' }]} />
        {!connectionBet.ipAddress && !connectionBet.ip && !connectionBet.userAgent && !connectionBet.user_agent && <span className={styles.muted}>IP tracking not enabled</span>}
      </div>}
    </Dialog>
  </aside>;
}
interface BetRowProps { bet: ProcessedSidebarBet; marketsMap?: Record<string, SidebarMarket>; runnersByMarketId: Record<string, SidebarRunner[]>; onViewPlayer: () => void; showSportsHierarchy?: boolean; canVoidInvalid?: boolean; onVoidBet: (betId: string, opener: HTMLElement | null) => void; onInvalidBet: (betId: string, opener: HTMLElement | null) => void; onShowConnection: (bet: ProcessedSidebarBet, opener: HTMLElement | null) => void }
function BetRow({ bet, marketsMap, runnersByMarketId, onViewPlayer, showSportsHierarchy = false, canVoidInvalid = false, onVoidBet, onInvalidBet, onShowConnection }: BetRowProps) {
  const actionsRef = useRef<HTMLButtonElement>(null);
  const { formatDate, formatTime } = useFormatDate();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  const market = resolveSidebarMarket(marketsMap, bet.marketId);
  const isFancy = market && (market.kind === 'fancy' || market.type === 'fancy');
  const oddsSize = bet.oddsSize ?? bet.odds_size ?? null;
  const odds = isFancy ? bet.price ? Math.round(Number(bet.price)) : '-' : bet.price ? Number(bet.price).toFixed(2) : '-';
  const status = String(bet.status || '').toLowerCase();
  const statusText = status === 'matched' ? 'OPEN' : status === 'unmatched' ? 'UNMATCHED' : status.toUpperCase() || 'UNKNOWN';
  const pnl = sidebarBetPnL(bet);
  const mid = bet.marketId != null ? String(bet.marketId) : '';
  const runnerName = !isFancy && bet.selectionId ? resolveSidebarRunner(runnersByMarketId[mid] || runnersByMarketId[Number(mid)], String(bet.selectionId)) : null;
  const marketName = market?.name || (mid ? `Market ${mid.slice(0, 8)}…` : 'Unknown');
  const marketKind = market?.kind || market?.type;
  // A fancy bet has no runner: its market names the selection and the market kind goes underneath.
  const selection = runnerName || marketName;
  const isLay = bet.side !== 'back';
  const userName = bet.userName && String(bet.userName).trim() || `User ${bet.userId}`;
  const morePatterns = bet.patterns.length - 1;
  const eventPath = [bet.sportName, bet.leagueName, bet.eventName].filter(Boolean).join(' • ') || '—';
  return <tr className={isLay ? styles.lay : undefined} data-bet-id={bet.id}>
    <td><div className={styles.bet}><span className={isLay ? `${styles.tag} ${styles.tagLay}` : styles.tag}>{isLay ? 'LAY' : 'BACK'}</span><span className={styles.sel}><b title={selection}>{selection}</b>{runnerName ? <small>{marketName}</small> : marketKind ? <small className={styles.kind}>{marketKind}</small> : null}</span></div></td>
    <td className={styles.num}><b className={styles.figure}>@{odds}{isFancy && oddsSize !== null && !isNaN(Number(oddsSize)) ? `/${Number(oddsSize).toFixed(0)}` : ''}</b></td>
    <td className={styles.num}>{fmt(bet.stake || 0)}</td>
    <td className={styles.num}>{fmt(bet.liability ?? 0)}</td>
    <td className={styles.num}>{['won', 'lost'].includes(status) ? <b className={pnl > 0 ? styles.positive : pnl < 0 ? styles.negative : styles.figure}>{pnl > 0 ? '+' : ''}{fmt(pnl)}</b> : <span className={styles.muted}>—</span>}</td>
    <td><div className={styles.player}><Button className={styles.playerLink} size="xs" variant="link" onClick={onViewPlayer}>{userName}</Button>{bet.userFlags?.length ? <PlayerFlagIndicator flags={bet.userFlags} userId={bet.userId} /> : null}{bet.patterns[0] && <PatternBadge patternType={bet.patterns[0].patternType} severity={bet.patterns[0].severity} metrics={bet.patterns[0].metrics} />}{morePatterns > 0 && <span className={styles.muted} title={`${morePatterns} more patterns detected`}>+{morePatterns}</span>}</div></td>
    <td><StatusPill status={status}>{statusText}</StatusPill></td>
    <td className={styles.muted}>{bet.createdAt ? <time dateTime={bet.createdAt}>{`${formatDate(bet.createdAt, 'MMM d')} ${formatTime(bet.createdAt, 'HH:mm:ss')}`}</time> : 'N/A'}</td>
    {showSportsHierarchy && <td className={styles.muted}><span className={styles.eventPath} title={eventPath}>{eventPath}</span></td>}
    <td className={styles.actionsCell}>
      <Menu trigger={<IconButton ref={actionsRef} size="sm" label={`Actions for ${userName}, ${selection}`} icon={<IconDots size={16} stroke={strokeFor(16)} />} />}>
        <MenuItem icon={<IconCopy size={15} stroke={strokeFor(15)} />} onSelect={() => void copyToClipboard(String(bet.id), 'Bet ID copied')}>Copy bet ID</MenuItem>
        <MenuItem icon={<IconNetwork size={15} stroke={strokeFor(15)} />} onSelect={() => onShowConnection(bet, actionsRef.current)}>IP details</MenuItem>
        <MenuItem icon={<IconUser size={15} stroke={strokeFor(15)} />} onSelect={onViewPlayer}>Open player</MenuItem>
        {canVoidInvalid && isOpenSidebarBet(bet) && <>
          <MenuSeparator />
          <MenuItem tone="danger" icon={<IconCircleX size={15} stroke={strokeFor(15)} />} onSelect={() => onVoidBet(bet.id, actionsRef.current)}>Void bet</MenuItem>
          <MenuItem tone="danger" icon={<IconAlertTriangle size={15} stroke={strokeFor(15)} />} onSelect={() => onInvalidBet(bet.id, actionsRef.current)}>Mark invalid</MenuItem>
        </>}
      </Menu>
    </td>
  </tr>;
}
