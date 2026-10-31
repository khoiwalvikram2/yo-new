import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useSubscription, gql, useApolloClient } from "@apollo/client";
import { GET_EVENT_DETAIL, SUB_EVENT_LIVE } from "@/lib/graphql/sports";
import { BET_PLACED_SUBSCRIPTION } from "@/lib/graphql/playerIntelligence";
import { GET_BETTING_PATTERNS_QUERY } from "@/lib/graphql/bettingPatterns";
import {
  AGENT_TREE_FOR_VIEW_QUERY,
  AGENT_ROOT_AGENTS_QUERY,
  AGENT_DESCENDANT_IDS_QUERY,
} from "@/lib/graphql/agents";
import type { BookViewContext } from "./utils/bookCalculator";

const EVENT_BETS_QUERY = gql`
  query EventBets($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      userName
      userFlags
      eventId
      marketId
      selectionId
      side
      price
      stake
      liability
      status
      currency
      createdAt
      oddsSize
      agentInfo {
        agentId
        agentName
        schemeType
        rate
      }
    }
  }
`;
import { useOddsSocket } from "@/lib/hooks/useOddsSocket";
import { ProfitCalculator } from "./components/ProfitCalculator";
import { PriceAlertModal } from "./components/PriceAlertModal";
import { AnalyticsDrawer } from "./components/AnalyticsDrawer";
import { EventHeaderControls } from "./components/EventHeaderControls";
import { EventHeaderStatsSection } from "./components/EventHeaderStatsSection";
import { EventSidebar } from "./components/EventSidebar";
import { EventBetsSidebar } from "./components/EventBetsSidebar";
import { RiskConfigDrawer } from "./components/RiskConfigDrawer";
import { AutomationConfigDrawer } from "./components/AutomationConfigDrawer";
import { RiskAlertBanner } from "./components/RiskAlertBanner";
import { RiskAlertList } from "./components/RiskAlertList";
import { GET_EVENT_RISK_CONFIG_QUERY } from "@/lib/graphql/riskConfig";
import type { RiskAlert } from "./components/types/riskAlerts";
import { MarketTabs } from "./components/MarketTabs";
import { MarketCard } from "./components/MarketCard";
import { ErrorBoundary } from "./live-analysis/components/ErrorBoundary";
import { LoadingState } from "./live-analysis/components/LoadingState";
import { EmptyState } from "./live-analysis/components/EmptyState";
import { useAuthStore } from "@/shared/core/authStore";
import { useFormatDate } from "@/shared/core/useFormatDate";
import { useUIStore } from "@/shared/core/uiStore";
import { RBACGuard } from "@/shared/core/RBACGuard";

const MAX_EVENT_DETAIL_BETS = 1500;
/** The EventBets first read's row limit. */
const EVENT_BETS_LIMIT = 1000;
/** Id prefix shared by the side-rail tab bar and the two rails it switches. */
const SIDE_TABS = "event-side";

import clsx from "clsx";
import { IconChartBar, IconUsers, IconReceipt } from "@tabler/icons-react";
import { Button } from "@/ui/components/Button";
import { Page } from "@/ui/components/Page";
import { Tabs } from "@/ui/components/Tabs";
import { tabId, tabPanelId } from "@/ui/components/tabIds";
import styles from "./EventDetailPage.module.css";
import {
  getMergedMarketWithOdds, betsForMarketCard,
  type DetailMarket, type EventDetailBet, type EventDetailPattern, type EventLiveData,
  type EventDetailResponse, type PageAgentTreeResponse, type PageRiskConfigResponse,
  type OddsPayload, type FancyLine, type SocketPacket,
  type MergedMarketListItem, type MergedMarketsOddsOnlyItem,
} from "./eventDetailPageModel";

export default function EventDetailPage() {
  return (
    <RBACGuard required={[{ domain: 'sports.events', actions: ['view'] }]} bypassForAgents>
      <EventDetailPageContent />
    </RBACGuard>
  );
}

export function EventDetailPageContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const isAgent = useAuthStore(s => s.isAgent());
  const agent = useAuthStore(s => s.agent);
  const roles = useAuthStore(s => s.roles);
  const directorMode = useUIStore(s => s.directorMode);
  const client = useApolloClient();

  const isWhitelabelAdmin = useMemo(
    () =>
      roles.some(
        (r) =>
          r === "Whitelabel Admin" ||
          r.toLowerCase() === "whitelabel_admin" ||
          r.toLowerCase().includes("whitelabel"),
      ),
    [roles],
  );
  const isSuperAdmin = useMemo(
    () =>
      roles.some(
        (r) =>
          r === "Super Admin" ||
          r.toLowerCase() === "super_admin" ||
          (r.toLowerCase().includes("super") && r.toLowerCase().includes("admin")),
      ),
    [roles],
  );
  const isWhitelabelView = isWhitelabelAdmin || (isSuperAdmin && directorMode === "whitelabel");

  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [showCalculator, setShowCalculator] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showRiskConfig, setShowRiskConfig] = useState(false);
  const [showAutomationConfig, setShowAutomationConfig] = useState(false);
  const [liveData, setLiveData] = useState<EventLiveData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [isBetsSidebarCollapsed, setIsBetsSidebarCollapsed] = useState(false);
  /** Bets take the whole workspace (desktop only); collapsing the bets rail leaves it. */
  const [isBetsWide, setIsBetsWide] = useState(false);
  /** The one side rail shown beside the markets when the workspace has room for two columns only. */
  const [sideTab, setSideTab] = useState<'bets' | 'players'>('bets');
  /** The head's layers button (kit "Markets only"): the markets take the whole workspace (desktop only). */
  const [isMarketsOnly, setIsMarketsOnly] = useState(false);
  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set());
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [showAlertList, setShowAlertList] = useState(false);
  // Active bottom tab — 'markets' | 'players' | 'bets': the mobile mode's one mounted panel, and the one panel
  // shown when the desktop workspace is under 900px wide
  const [mobileTab, setMobileTab] = useState<'markets' | 'players' | 'bets'>('markets');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const autoRefreshNoteId = useId();
  const { formatTime } = useFormatDate();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Fetch bets for book calculation
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  // This ensures proper filtering based on selected whitelabel in admin panel
  const { data: betsData } = useQuery<{ sportsBets?: EventDetailBet[] }>(EVENT_BETS_QUERY, {
    variables: {
      query: {
        eventId: eventId,
        limit: EVENT_BETS_LIMIT,
      },
    },
    skip: !eventId,
    // Removed pollInterval - using subscription instead for real-time updates
    errorPolicy: "all",
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    // Bets are filtered by whitelabel on the backend
    fetchPolicy: "network-only",
  });

  // Subscribe to new bets in real-time
  const { data: betPlacedData } = useSubscription<{ betPlaced?: EventDetailBet }>(BET_PLACED_SUBSCRIPTION, {
    variables: { eventId: eventId || '' },
    skip: !eventId,
    errorPolicy: "all",
  });

  // State to hold bets including subscription updates
  const [betsCache, setBetsCache] = useState<EventDetailBet[]>([]);
  /** Batched bets from subscription for EventBetsSidebar (microtask-flushed for rapid-fire updates). */
  const [placedBetBatchForSidebar, setPlacedBetBatchForSidebar] = useState<EventDetailBet[]>([]);
  const pendingPlacedBetsRef = useRef<EventDetailBet[]>([]);
  const placedBetSidebarMicrotaskQueuedRef = useRef(false);

  // Reset bets cache when eventId changes (run first to clear old data)
  useEffect(() => {
    setBetsCache([]);
    pendingPlacedBetsRef.current = [];
    placedBetSidebarMicrotaskQueuedRef.current = false;
    setPlacedBetBatchForSidebar([]);
  }, [eventId]);

  // Initialize bets cache from query data (run after reset)
  useEffect(() => {
    if (!eventId) {
      setBetsCache([]);
      return;
    }
    
    if (betsData?.sportsBets && Array.isArray(betsData.sportsBets)) {
      // Filter by eventId as safety check (server already filters, but cache might have old data)
      const filteredBets = betsData.sportsBets.filter((bet: EventDetailBet) => String(bet.eventId || '') === String(eventId || ''));
      setBetsCache(filteredBets.slice(0, MAX_EVENT_DETAIL_BETS));
    }
  }, [betsData?.sportsBets, eventId]);

  // Merge new bet from subscription into cache
  useEffect(() => {
    if (betPlacedData?.betPlaced) {
      const newBet = betPlacedData.betPlaced;

      // Only add if it's for the current event
      if (eventId && String(newBet.eventId || '') !== String(eventId || '')) {
        return; // Skip bets from other events
      }

      pendingPlacedBetsRef.current.push(newBet);
      if (!placedBetSidebarMicrotaskQueuedRef.current) {
        placedBetSidebarMicrotaskQueuedRef.current = true;
        queueMicrotask(() => {
          placedBetSidebarMicrotaskQueuedRef.current = false;
          const batch = pendingPlacedBetsRef.current.splice(0);
          if (batch.length > 0) {
            setPlacedBetBatchForSidebar(batch);
          }
        });
      }

      // Check if bet already exists (avoid duplicates)
      setBetsCache((prevBets) => {
        const exists = prevBets.some((bet: EventDetailBet) => bet.id === newBet.id);
        if (exists) {
          return prevBets; // Bet already exists, don't add duplicate
        }

        const next = [...prevBets, newBet];
        return next.length > MAX_EVENT_DETAIL_BETS ? next.slice(-MAX_EVENT_DETAIL_BETS) : next;
      });
    }
  }, [betPlacedData?.betPlaced, eventId]);

  // Bets are already filtered by eventId on server, no need to filter client-side
  const bets = useMemo(() => {
    return betsCache;
  }, [betsCache]);

  // Fetch risk config for banner - skip for agents (they don't have access)
  const { data: riskConfigData } = useQuery<PageRiskConfigResponse>(GET_EVENT_RISK_CONFIG_QUERY, {
    variables: { eventId: eventId || "" },
    skip: !eventId || isAgent,
    errorPolicy: "all",
    fetchPolicy: "cache-first",
  });

  // Fetch event detail
  const { data, loading, error, refetch } = useQuery<EventDetailResponse>(GET_EVENT_DETAIL, {
    variables: { eventId },
    skip: !eventId,
    pollInterval: autoRefresh ? 10000 : 0, // Reduced from 5s to 10s for better performance
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    // Whitelabel context is sent via headers, not query variables, so Apollo cache
    // would otherwise serve stale data from the previous whitelabel selection
    fetchPolicy: "network-only",
  });

  // Keep GraphQL subscription as fallback (but prefer WebSocket)
  const { data: liveUpdate, error: subscriptionError, loading: subscriptionLoading } = useSubscription<{ eventLive?: EventLiveData }>(SUB_EVENT_LIVE, {
    variables: { eventId },
    skip: !eventId,
    onError: () => { /* Keep odds fallback independent of subscription failures. */ },
    onComplete: () => {
    },
  });

  // Debug subscription status
  useEffect(() => {
  }, [eventId, subscriptionLoading, subscriptionError, liveUpdate]);

  // Throttle live updates to prevent excessive re-renders
  const lastLiveUpdateRef = useRef<number>(0);
  const pendingLiveUpdateRef = useRef<boolean>(false);

  // Merge live updates with static data (throttled)
  useEffect(() => {
    if (liveUpdate?.eventLive) {
      const eventLive = liveUpdate.eventLive;
      const now = Date.now();
      const timeSinceLastUpdate = now - lastLiveUpdateRef.current;
      const throttleDelay = 1000; // Throttle to max 1 update per second
      
      // Skip if update is too soon or already pending
      if (timeSinceLastUpdate < throttleDelay || pendingLiveUpdateRef.current) {
        return;
      }
      
      
      pendingLiveUpdateRef.current = true;
      lastLiveUpdateRef.current = now;
      
      requestAnimationFrame(() => {
        setLiveData(eventLive);
        pendingLiveUpdateRef.current = false;
      });
    }
  }, [liveUpdate]);

  const event = data?.eventDetail?.event;
  const markets = useMemo(() => data?.eventDetail?.markets ?? [], [data?.eventDetail?.markets]);

  const { data: bettingPatternsData } = useQuery<{ bettingPatterns?: EventDetailPattern[] }>(GET_BETTING_PATTERNS_QUERY, {
    variables: { eventId: event?.id, limit: 1000 },
    skip: !event?.id,
    errorPolicy: "all",
    pollInterval: 60000,
  });

  const patternsByUserId = useMemo(() => {
    const map = new Map<string, EventDetailPattern[]>();
    if (bettingPatternsData?.bettingPatterns) {
      bettingPatternsData.bettingPatterns.forEach((pattern: EventDetailPattern) => {
        const userId = String(pattern.userId);
        if (!map.has(userId)) map.set(userId, []);
        map.get(userId)!.push(pattern);
      });
    }
    return map;
  }, [bettingPatternsData]);

  const { data: pageAgentTreeData } = useQuery<PageAgentTreeResponse>(AGENT_TREE_FOR_VIEW_QUERY, {
    variables: { rootId: agent?.id ?? "" },
    skip: !isAgent || !agent?.id,
    fetchPolicy: "cache-first",
  });

  const { data: pageAgentRootAgentsData } = useQuery<PageAgentTreeResponse>(AGENT_ROOT_AGENTS_QUERY, {
    skip: isAgent || !isWhitelabelView,
    fetchPolicy: "cache-first",
  });

  const pageAgentInfoMap = useMemo(() => {
    const map = new Map<string, { username: string | null; schemeType: string; rate: number | null }>();
    if (isWhitelabelView && pageAgentRootAgentsData?.agents?.agentRootAgents) {
      pageAgentRootAgentsData.agents.agentRootAgents.forEach((a) => {
        map.set(a.id, {
          username: a.username,
          schemeType: a.schemeType,
          rate: a.rate,
        });
      });
    }
    return map;
  }, [isWhitelabelView, pageAgentRootAgentsData?.agents?.agentRootAgents]);

  const pageDirectChildIds = useMemo(() => {
    if (isAgent && agent?.id) {
      const tree = (pageAgentTreeData?.agents?.agentTree ?? []) as { id: string }[];
      return tree.map((c) => c.id);
    }
    if (isWhitelabelView && pageAgentRootAgentsData?.agents?.agentRootAgents) {
      return (pageAgentRootAgentsData.agents.agentRootAgents as { id: string }[]).map((a) => a.id);
    }
    return [];
  }, [isAgent, agent?.id, pageAgentTreeData?.agents?.agentTree, isWhitelabelView, pageAgentRootAgentsData?.agents?.agentRootAgents]);

  const [pageDescendantIdsMap, setPageDescendantIdsMap] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (pageDirectChildIds.length === 0) {
      setPageDescendantIdsMap(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all(
      pageDirectChildIds.map((id) =>
        client.query({
          query: AGENT_DESCENDANT_IDS_QUERY,
          variables: { agentId: id },
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setPageDescendantIdsMap(() => {
        const next = new Map<string, string[]>();
        pageDirectChildIds.forEach((id, i) => {
          const ids =
            (results[i]?.data as { agents?: { agentDescendantIds?: string[] } })?.agents?.agentDescendantIds ?? [id];
          next.set(id, ids);
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pageDirectChildIds, client]);

  const sharedBookViewContext = useMemo<BookViewContext | null>(() => {
    if (pageDirectChildIds.length === 0) return null;
    const allLoaded = pageDirectChildIds.every((id) => pageDescendantIdsMap.has(id));
    if (!allLoaded) return null;
    return {
      directChildAgentIds: pageDirectChildIds,
      getDescendantsOf: (agentId: string) => pageDescendantIdsMap.get(agentId) ?? [agentId],
      getAgentInfo: (agentId: string) => pageAgentInfoMap.get(agentId) ?? null,
    };
  }, [pageDirectChildIds, pageDescendantIdsMap, pageAgentInfoMap]);

  /** Single agent-subtree fetch for EventSidebar (avoids duplicate query when embedded on event page). */
  const [eventPageAgentSubtreeIds, setEventPageAgentSubtreeIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!isAgent || !agent?.id) {
      setEventPageAgentSubtreeIds(null);
      return;
    }
    let cancelled = false;
    void client
      .query({
        query: AGENT_DESCENDANT_IDS_QUERY,
        variables: { agentId: String(agent.id) },
      })
      .then((result) => {
        if (cancelled) return;
        const ids =
          (result?.data as { agents?: { agentDescendantIds?: string[] } })?.agents?.agentDescendantIds ?? [
            String(agent.id),
          ];
        setEventPageAgentSubtreeIds([String(agent.id), ...ids]);
      })
      .catch(() => {
        if (!cancelled) setEventPageAgentSubtreeIds([String(agent.id)]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAgent, agent?.id, client]);

  // Use WebSocket for real-time odds (like user-side)
  const marketCodes = useMemo(() => {
    return markets
      .map((m) => m.marketCode)
      .filter((code): code is string => code != null);
  }, [markets]);

  const eventCode = event?.eventCode;
  const socketOddsDataRaw = useOddsSocket(
    marketCodes,
    eventCode ? { eventId: String(eventCode) } : undefined
  );
  
  // Always merge raw into a new object when socketOddsDataRaw reference changes so downstream
  // memos (fancyMarketData, etc.) and MarketCard get fresh data; avoid returning stale prev.
  const socketOddsData = useMemo(() => {
    const raw = socketOddsDataRaw;
    const merged: OddsPayload = {};
    for (const key of Object.keys(raw)) {
      if (raw[key] != null) {
        merged[key] = raw[key];
      }
    }
    return merged;
  }, [socketOddsDataRaw]);

  /** Throttle high-frequency odds merges to at most every 2s (latest snapshot). */
  const socketOddsLatestRef = useRef(socketOddsData);
  socketOddsLatestRef.current = socketOddsData;
  const [socketOddsThrottled, setSocketOddsThrottled] = useState<OddsPayload>(() => ({ ...socketOddsData }));
  /** When a new odds packet last reached this page (the market bar's "Prices live" time); null until one does. */
  const [pricesAt, setPricesAt] = useState<number | null>(null);
  const pricesSeenRef = useRef(socketOddsData);

  useEffect(() => {
    setSocketOddsThrottled({ ...socketOddsLatestRef.current });
    setPricesAt(null);
  }, [eventId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      const latest = socketOddsLatestRef.current;
      if (latest !== pricesSeenRef.current) {
        pricesSeenRef.current = latest;
        if (Object.keys(latest).length > 0) setPricesAt(Date.now());
      }
      setSocketOddsThrottled({ ...latest });
    }, 2000);
    return () => window.clearInterval(id);
  }, [eventId]);

  // Create synthetic fancy market from WebSocket data (like user-side)
  // Fancy markets are NOT stored in DB - they come from external odds provider
  const fancyMarketData = useMemo<DetailMarket | null>(() => {
    if (!eventCode) return null;
    
    const fancyKey = `fancy-${eventCode}`;
    const fancyBlob = socketOddsData[fancyKey] as SocketPacket | Array<FancyLine | string> | null;
    
    if (!fancyBlob) return null;
    
    // Parse fancy lines from various data formats
    let fancyLines: Array<FancyLine | string> = [];
    if (Array.isArray(fancyBlob)) {
      fancyLines = fancyBlob;
    } else if (fancyBlob?.payload && Array.isArray(fancyBlob.payload)) {
      fancyLines = fancyBlob.payload;
    } else if (Array.isArray(fancyBlob?.lines)) {
      fancyLines = fancyBlob.lines;
    } else if (Array.isArray(fancyBlob?.data)) {
      fancyLines = fancyBlob.data;
    } else if (typeof fancyBlob === 'object') {
      fancyLines = Object.values(fancyBlob).filter(
        (v: unknown) => v && typeof v === 'object' && ('name' in v || 'back' in v || 'b1' in v)
      ) as FancyLine[];
    }
    
    // Parse JSON strings if present (WebSocket sometimes sends JSON strings)
    const parsedFancyLines: FancyLine[] = fancyLines.map((fl) => {
      if (typeof fl === 'string') {
        try { return JSON.parse(fl); } catch { return null; }
      }
      return fl;
    }).filter(Boolean);
    
    // Filter valid fancy items - must have a name or runnerName
    const validFancyLines = parsedFancyLines.filter((fl) => 
      fl && typeof fl === 'object' && (fl.name || fl.runnerName || fl.selectionName)
    );
    
    // Sort by priority, then by name (like user-side)
    validFancyLines.sort((a, b) => {
      const pa = Number(a?.priority ?? 9999);
      const pb = Number(b?.priority ?? 9999);
      if (pa !== pb) return pa - pb;
      const na = String(a?.name || a?.runnerName || '');
      const nb = String(b?.name || b?.runnerName || '');
      return na.localeCompare(nb);
    });
    
    // Debug: Log all fancy lines count
    
    if (validFancyLines.length === 0) return null;
    
    // Create runners from fancy lines (like user-side structure)
    const runners = validFancyLines.map((fl, idx) => ({
      id: String(fl.id || `fancy-runner-${idx}`),
      name: String(fl.name || fl.runnerName || fl.selectionName || ''),
      sortOrder: fl.priority ?? idx,
      // Store original fancy data for display
      _fancyLine: fl,
    }));
    
    // If we have a DB fancy market record for this event, reuse its ID so bet.marketId matches.
    // This avoids a subtle bug where the synthetic market id (e.g. "fancy-<eventId>") does not
    // match persisted bet.marketId (uuid), causing fancy book to show empty even when bets exist.
    const dbFancyMarket = markets.find(
      (m: DetailMarket) =>
        (m?.kind === 'fancy' || m?.type === 'fancy') &&
        String(m?.eventId || '') === String(event?.id || '')
    );

    // Return synthetic fancy market (stable timestamps to avoid per-tick identity churn)
    const stableCutoff = event?.startTime ?? "";
    return {
      id: dbFancyMarket?.id ?? `fancy-${event?.id || eventCode}`,
      name: "Fancy",
      kind: "fancy",
      type: "fancy",
      state: "open",
      eventId: event?.id,
      marketCode: eventCode,
      liquidity: 0,
      unmatchedOrders: 0,
      cutoffAt: stableCutoff,
      tickSize: 1,
      createdBy: "system",
      updatedAt: event?.updatedAt ?? stableCutoff,
      runners,
      _isSynthetic: true,
    };
  }, [eventCode, socketOddsData, event?.id, event?.startTime, event?.updatedAt, markets]);
  
  // Combine DB markets with synthetic fancy market
  const allMarkets = useMemo<DetailMarket[]>(() => {
    // Keep DB fancy markets (don't filter them out!)
    const dbFancyMarkets = markets.filter(
      (m: DetailMarket) => m.kind === 'fancy' || m.type === 'fancy'
    );
    
    const nonFancyMarkets = markets.filter(
      (m: DetailMarket) => m.kind !== 'fancy' && m.type !== 'fancy'
    );
    
    // If we have DB fancy markets, merge them into ONE fancy market
    if (dbFancyMarkets.length > 0 && fancyMarketData) {
      // Merge all DB fancy market IDs for bet matching
      const allDbFancyMarketIds = dbFancyMarkets.map((m: DetailMarket) => String(m.id));
      
      // Create ONE merged fancy market with all DB market IDs
      const mergedFancyMarket = {
        ...fancyMarketData, // Use WebSocket market structure
        id: dbFancyMarkets[0].id, // Use first DB market's ID as primary
        _dbMarketIds: allDbFancyMarketIds, // Store all DB market IDs for bet matching
        _isSynthetic: true, // Mark as synthetic so odds display works
        _hasWebSocketData: true,
        _isDbBacked: true, // But remember it's backed by DB for bet matching
        name: dbFancyMarkets.length > 1 ? 'Fancy' : dbFancyMarkets[0].name, // Use "Fancy" if multiple markets
      };
      
      
      return [...nonFancyMarkets, mergedFancyMarket];
    }
    
    // If no DB fancy markets but WebSocket fancy exists, use synthetic one
    if (fancyMarketData) {
      return [...nonFancyMarkets, fancyMarketData];
    }
    
    // No fancy data at all
    return markets;
  }, [markets, fancyMarketData]);

  // Filter markets based on selected type
  const filteredMarkets = useMemo(() => {
    if (marketFilter === "all") return allMarkets;
    return allMarkets.filter((m: DetailMarket) => {
      const kind = m.kind || m.type || "";
      return kind.toLowerCase() === marketFilter.toLowerCase();
    });
  }, [allMarkets, marketFilter]);

  // Map marketId -> market for Potential Payout calculation (header stats)
  const marketsMap = useMemo(() => {
    const map: Record<string, DetailMarket> = {};
    allMarkets.forEach((m: DetailMarket) => {
      const id = m.id != null ? String(m.id) : "";
      if (id) map[id] = m;
      const dbIds = m._dbMarketIds as string[] | undefined;
      if (Array.isArray(dbIds)) {
        dbIds.forEach((mid: string) => {
          if (mid) map[String(mid)] = m;
        });
      }
    });
    return map;
  }, [allMarkets]);

  // Expand all markets by default only when the set of market IDs actually changes (not on every allMarkets reference change)
  const allMarketIdsRef = useRef<string[]>([]);
  allMarketIdsRef.current = allMarkets.map((m) => String(m.id || ''));
  const allMarketsCount = allMarkets.length;
  const allMarketIdsStr = useMemo(
    () => allMarkets.map((m: DetailMarket) => String(m.id || '')).sort().join(','),
    [allMarkets]
  );
  useEffect(() => {
    if (allMarketsCount > 0) {
      const nextIds = new Set<string>(allMarketIdsRef.current);
      setExpandedMarkets((prev) => {
        const prevStr = [...prev].sort().join(',');
        const nextStr = [...nextIds].sort().join(',');
        if (prevStr === nextStr && prev.size === nextIds.size) return prev;
        return nextIds;
      });
    }
  }, [allMarketIdsStr, allMarketsCount]);

  // Toggle market expansion
  const toggleMarket = (marketId: string) => {
    setExpandedMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(marketId)) {
        next.delete(marketId);
      } else {
        next.add(marketId);
      }
      return next;
    });
  };

  const refreshPendingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const handleRefresh = async () => {
    if (!eventId || refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await refetch();
      if (result.error || result.errors?.length) throw result.error ?? new Error("Event refresh failed");
    } catch {
      setRefreshError("Event details could not be refreshed. Existing data is kept; please retry.");
    } finally {
      refreshPendingRef.current = false;
      setRefreshing(false);
    }
  };

  /** Heavy odds merge only when throttled socket / live data changes — not on every bet tick. */
  const mergedMarketsOddsOnly = useMemo((): MergedMarketsOddsOnlyItem[] => {
    return filteredMarkets.map((market) => {
      const { mergedMarket, oddsSignature } = getMergedMarketWithOdds(
        market,
        socketOddsThrottled,
        liveData,
        eventCode,
      );
      return { marketId: String(market.id), mergedMarket, oddsSignature, market };
    });
  }, [filteredMarkets, socketOddsThrottled, liveData, eventCode]);

  /** Light per-market bet slices — only recomputes when `bets` or market list changes. */
  const perMarketBetsById = useMemo(() => {
    const map = new Map<string, EventDetailBet[]>();
    for (const market of filteredMarkets) {
      const id = market?.id != null ? String(market.id) : "";
      if (id) map.set(id, betsForMarketCard(market, bets));
    }
    return map;
  }, [filteredMarkets, bets]);

  const mergedMarketsList = useMemo((): MergedMarketListItem[] => {
    return mergedMarketsOddsOnly.map(({ marketId, mergedMarket, oddsSignature, market }) => {
      const marketBets = perMarketBetsById.get(marketId) ?? [];
      return {
        mergedMarket,
        oddsSignature,
        market,
        betCount: marketBets.length,
        exposure: 0,
        marketBets,
      };
    });
  }, [mergedMarketsOddsOnly, perMarketBetsById]);

  /** Panel tab counts from the page's own event bets: the open ones (all the bets rail lists) and the players
   *  behind any of them (whom the players rail lists). A list that reached its row limit may be short, so it
   *  shows no counts rather than low ones. */
  const panelCounts = useMemo(() => {
    if ((betsData?.sportsBets?.length ?? 0) >= EVENT_BETS_LIMIT || bets.length >= MAX_EVENT_DETAIL_BETS) {
      return { bets: undefined, players: undefined };
    }
    const openBets = bets.filter((bet) => {
      const status = String(bet.status || "").toLowerCase();
      return status === "matched" || status === "unmatched";
    });
    const players = new Set(bets.map((bet) => String(bet.userId ?? "")).filter(Boolean));
    return { bets: openBets.length, players: players.size };
  }, [bets, betsData?.sportsBets]);

  if (loading && !event) {
    return <div className={styles.state}><LoadingState type="spinner" message="Loading event details..." /></div>;
  }
  if (!event) {
    return <div className={styles.state}>
      <EmptyState description={error ? "Event details could not be loaded" : "Event not found"} />
      {error && <Button className={styles.retry} loading={refreshing} onClick={() => void handleRefresh()}>Retry event details</Button>}
    </div>;
  }

  // Feed prices count as live while a packet came in the last 30 seconds (the throttle re-renders every 2s).
  const pricesLive = pricesAt !== null && Date.now() - pricesAt < 30000;
  const marketPanel = <div className={styles.center} data-event-panel="markets">
    <div className={styles.filters}>
      <MarketTabs markets={allMarkets} activeTab={marketFilter} onTabChange={setMarketFilter} />
      {pricesAt !== null && <span className={clsx(styles.pricesAt, !pricesLive && styles.stale)}>
        <span className={styles.pricesDot} aria-hidden="true" />
        {pricesLive ? 'Prices live' : 'Last price'} · <time dateTime={new Date(pricesAt).toISOString()}>{formatTime(new Date(pricesAt), 'HH:mm:ss')}</time>
      </span>}
    </div>
    {/* the list is the Market type tabs' panel (MarketTabs points its selected tab here) */}
    <div role="tabpanel" id={tabPanelId("event-markets", marketFilter)} aria-labelledby={tabId("event-markets", marketFilter)}>
    <ErrorBoundary>
      {filteredMarkets.length === 0 ? <EmptyState description="No markets available for this filter" /> :
        <div className={styles.markets}>
          {mergedMarketsList.map(({ mergedMarket, oddsSignature, market, betCount, exposure, marketBets }) =>
            <section key={market.id} className={styles.market} role="region" aria-label={`${market.name || 'Market'} card`} tabIndex={isMobile ? undefined : 0}>
              <p className={styles.scrollHint}>Scroll horizontally to view all market prices and controls.</p>
              <div className={styles.marketSurface}>
              <MarketCard market={mergedMarket} event={event}
                isExpanded={expandedMarkets.has(market.id)} onToggle={() => toggleMarket(market.id)}
                betCount={betCount} exposure={exposure} bets={marketBets}
                oddsSignature={oddsSignature} sharedBookViewContext={sharedBookViewContext} />
              </div>
              {mergedMarket._hasProjectedDepth && <p className={styles.projected}>
                Projected depth: displayed sizes and additional prices are estimates from a single quote, not provider liquidity.
              </p>}
            </section>
          )}
        </div>}
    </ErrorBoundary>
    </div>
  </div>;
  const setBetsCollapsed = (value: boolean) => {
    setIsBetsSidebarCollapsed(value);
    if (value) setIsBetsWide(false);
  };
  const toggleBetsWide = () => {
    if (!isBetsWide) setIsBetsSidebarCollapsed(false);
    setIsBetsWide(!isBetsWide);
  };
  const playerPanel = <div className={styles.rail} id={tabPanelId(SIDE_TABS, "players")} data-event-panel="players">
    <EventSidebar event={event} onAlertsChange={setRiskAlerts} patternsByUserId={patternsByUserId}
      mobileMode={isMobile} bookViewContextFromParent={sharedBookViewContext}
      agentSubtreeIdsFromParent={isAgent ? eventPageAgentSubtreeIds : undefined} />
  </div>;
  const betsPanel = <div className={styles.rail} id={tabPanelId(SIDE_TABS, "bets")} data-event-panel="bets">
    <EventBetsSidebar eventId={eventId || ""} isCollapsed={isMobile ? false : isBetsSidebarCollapsed}
      setIsCollapsed={isMobile ? () => {} : setBetsCollapsed} mobileMode={isMobile}
      isWide={isMobile ? false : isBetsWide} onToggleWide={isMobile ? undefined : toggleBetsWide}
      placedBetBatch={placedBetBatchForSidebar} patternsByUserId={patternsByUserId} />
  </div>;
  // The players rail is the kit's "Book" panel (house position per player and agent).
  const panelTabs = [
    { key: "markets", label: "Markets", Icon: IconChartBar, count: allMarkets.length },
    { key: "bets", label: "Bets", Icon: IconReceipt, count: panelCounts.bets },
    { key: "players", label: "Book", Icon: IconUsers, count: panelCounts.players },
  ] as const;
  const bottomTabs = (className?: string) => <nav className={clsx(styles.bottomTabs, className)} aria-label="Event panels">
    {panelTabs.map(({ key, label, Icon, count }) =>
      <button key={key} type="button" className={styles.tab} aria-pressed={mobileTab === key}
        aria-label={count === undefined ? undefined : `${label}, ${count.toLocaleString()}`} onClick={() => setMobileTab(key)}>
        <Icon size={18} aria-hidden="true" /><span>{label}</span>
        {count !== undefined && <b className={styles.tabCount}>{count.toLocaleString()}</b>}
      </button>
    )}
  </nav>;

  return (
    <div ref={pageContainerRef} className={styles.workspace}>
      <Page maxWidth="none" className={styles.page}>
        <div ref={headerRef} className={styles.header}>
          <EventHeaderControls eventName={event.name} eventSport={event.sport}
            eventCompetition={event.competition} eventStartTime={event.startTime}
            isLive={event.inPlay || event.status === "active"} eventStatus={event.status} eventCode={event.eventCode}
            autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} handleRefresh={() => void handleRefresh()}
            autoRefreshNoteId={autoRefreshNoteId}
            marketsOnly={isMarketsOnly} onToggleMarketsOnly={isMobile ? undefined : () => setIsMarketsOnly(value => !value)}
            compactMode={compactMode} setCompactMode={setCompactMode} pageContainerRef={pageContainerRef}
            eventId={eventId} onRiskConfigClick={() => setShowRiskConfig(true)}
            onAutomationConfigClick={() => setShowAutomationConfig(true)} />
          <p id={autoRefreshNoteId} className={styles.scope}>Auto-refresh controls event details every 10 seconds only.
            Live odds, bet subscriptions and panel polling continue independently.</p>
          {refreshing && <div className={styles.feedback} role="status">Refreshing event details…</div>}
          {(refreshError || error) && <div className={clsx(styles.feedback, styles.error)} role="alert">
            {refreshError || "Event detail updates are unavailable. Existing data is shown; use Refresh to retry."}
          </div>}
          {riskConfigData?.eventRiskConfig?.alerts?.bannerEnabled && riskAlerts.length > 0 &&
            <RiskAlertBanner alerts={riskAlerts} onViewAll={() => setShowAlertList(true)} />}
          <EventHeaderStatsSection event={event} liveData={liveData ?? undefined} marketsMap={marketsMap} />
        </div>

        {isMobile ? <div className={styles.mobile}>
          <div className={styles.mobilePanel}>{mobileTab === "markets" ? marketPanel : mobileTab === "players" ? playerPanel : betsPanel}</div>
          {bottomTabs()}
        </div> : <div className={styles.ws} data-focus={isMarketsOnly || undefined}>
          <div className={clsx(styles.desktop, isBetsSidebarCollapsed && styles.collapsed)}
            data-view={isMarketsOnly ? "markets" : mobileTab} data-side={sideTab} data-wide={isBetsWide || undefined} data-focus={isMarketsOnly || undefined}>
            <Tabs className={styles.sideTabs} size="sm" label="Side panel" idPrefix={SIDE_TABS} value={sideTab} onChange={setSideTab}
              items={[{ value: "bets", label: "Bets", count: panelCounts.bets }, { value: "players", label: "Book", count: panelCounts.players }]} />
            {playerPanel}{marketPanel}{betsPanel}
          </div>
          {bottomTabs(styles.wsTabs)}
        </div>}
      </Page>

      {/* Modals and Drawers */}
      <ProfitCalculator
        visible={showCalculator}
        onClose={() => setShowCalculator(false)}
      />
      <PriceAlertModal
        visible={showAlerts}
        onClose={() => setShowAlerts(false)}
      />
      <AnalyticsDrawer
        visible={showAnalytics}
        onClose={() => setShowAnalytics(false)}
        eventData={event}
      />
      {eventId && (
        <>
          <RiskConfigDrawer
            open={showRiskConfig}
            onClose={() => setShowRiskConfig(false)}
            eventId={eventId || ""}
          />
          <AutomationConfigDrawer
            open={showAutomationConfig}
            onClose={() => setShowAutomationConfig(false)}
            eventId={eventId || ""}
          />
        </>
      )}
      
      {/* Risk Alert List Drawer */}
      <RiskAlertList
        open={showAlertList}
        onClose={() => setShowAlertList(false)}
        alerts={riskAlerts}
      />
    </div>
  );
}
