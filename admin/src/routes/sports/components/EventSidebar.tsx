import { useState, useMemo, useEffect, useId, useCallback, Fragment } from "react";

import { useQuery, useApolloClient } from "@apollo/client";
import { useNavigate } from "react-router-dom";
import {
  AGENTS_PAGE_QUERY,
  AGENT_TREE_FOR_VIEW_QUERY,
  AGENT_DESCENDANT_IDS_QUERY,
  AGENT_ROOT_AGENTS_QUERY,
} from "@/lib/graphql/agents";
import { gql } from "@apollo/client";
import { useUIStore } from "@/shared/core/uiStore";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useCurrentWhitelabel } from "@/shared/core/useWhitelabels";
import { useAuthStore } from "@/shared/core/authStore";
import { hasPermissionWithNested } from "@/shared/core/nestedPermissionMapping";
import { GET_EVENT_RISK_CONFIG_QUERY } from "@/lib/graphql/riskConfig";
import { useRiskAlerts } from "./hooks/useRiskAlerts";
import { RiskAlertSidebarIndicator } from "./RiskAlertSidebarIndicator";
import { RiskAlertList } from "./RiskAlertList";
import type { RiskAlert } from "./types/riskAlerts";
import { PatternBadge, type BettingPatternType, type PatternSeverity } from "./PatternBadge";
import { PlayerProfileModal } from "./PlayerProfileModal";
import { GET_BETTING_PATTERNS_QUERY } from "@/lib/graphql/bettingPatterns";
import { PlayerFlagIndicator } from "./PlayerFlagIndicator";
import type { BookViewContext } from "../utils/bookCalculator";

import clsx from 'clsx';
import { Avatar } from '@/ui/components/Avatar';
import { Card } from '@/ui/components/Card';
import { EmptyState } from '@/ui/components/EmptyState';
import { LoadingState } from '@/ui/components/LoadingState';
import { SearchField } from '@/ui/components/SearchField';
import { StatusPill, type StatusPillProps } from '@/ui/components/StatusPill';
import { Tabs } from '@/ui/components/Tabs';
import { tabId, tabPanelId } from '@/ui/components/tabIds';
import styles from './EventSidebar.module.css';

interface SidebarBet {
  id: string; userId?: string | number; eventId?: string | number; userName?: string | null;
  stake?: number | null; liability?: number | null; price?: number | null; side?: string | null; status?: string;
  agentInfo?: { agentId?: string | number | null; agentName?: string | null; schemeType?: string | null; rate?: number | null } | null;
}
interface SidebarAgent { id: string; username?: string | null; phone?: string | null; schemeType?: string | null; rate?: number | null }
interface SidebarPlayer {
  id: string | number; name?: string | null; username?: string | null; phone?: string | null;
  status?: string | null; riskType?: string | null; flags?: string[] | null; agentId?: string | number | null;
  wallet?: { balance?: number | null; exposure?: number | null; currency?: string | null } | null;
}
interface SidebarPattern { id?: string; userId: string | number; patternType: BettingPatternType; severity: PatternSeverity; metrics?: Record<string, unknown> }
interface SidebarRiskConfig {
  percentiles?: Record<string, number | null> | null; weights?: Record<string, number | null> | null;
  riskLevelThresholds?: { high?: number | null; medium?: number | null; low?: number | null } | null;
  alerts?: { enabled?: boolean; triggerLevels?: string[]; notificationEnabled?: boolean; bannerEnabled?: boolean; sidebarIndicatorEnabled?: boolean; cooldownSeconds?: number } | null;
}
/* Kit Book rows: only HIGH and MEDIUM are tinted; LOW, MINIMAL and N/A take the muted outline tag. */
const sidebarRiskTone = (text: string): StatusPillProps['tone'] => text === 'HIGH' ? 'neg' : text === 'MEDIUM' ? 'warn' : 'muted';

/* Kit .ev-share: the row's exposure as a share of the largest one on show. It is red under the same rule
   as the exposure figure (above zero, the house loses). Decorative: the figure carries the value. */
function ShareBar({ value, largest }: { value: number; largest: number }) {
  const width = largest > 0 && Number.isFinite(value) ? Math.min(100, (Math.abs(value) / largest) * 100) : 0;
  return <span className={styles.share} aria-hidden="true"><span className={clsx(styles.shareFill, value > 0 && styles.loss)} style={{ width: `${width}%` }} /></span>;
}

/* Kit .lrow__sub: the parts that are present, joined by a middle dot that assistive tech skips. The rail
   truncates the line, so the title carries all of it. */
function MetaParts({ parts }: { parts: (string | false | null)[] }) {
  const shown = parts.filter((part): part is string => Boolean(part));
  return <span className={styles.meta} title={shown.join(' · ') || undefined}>{shown.map((part, index) => <Fragment key={index}>{index > 0 && <span aria-hidden="true"> · </span>}<span>{part}</span></Fragment>)}</span>;
}

const USERS_PAGE_QUERY = gql`
  query UsersPage(
    $query: String
    $status: PlayerStatus
    $balanceMin: Float
    $balanceMax: Float
    $registeredFrom: String
    $registeredTo: String
    $offset: Int
    $limit: Int
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
    ) {
      items {
        id
        name
        username
        phone
        status
        riskType
        flags
        agentId
        wallet {
          balance
          currency
          exposure
        }
      }
      total
    }
  }
`;

const EVENT_BETS_QUERY = gql`
  query EventBets($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      userName
      eventId
      stake
      liability
      side
      status
      price
      result
      settledAt
      matchedAt
      currency
      selectionId
      agentInfo {
        agentId
        agentName
        schemeType
        rate
      }
    }
  }
`;

interface EventSidebarProps {
  event: { id?: string | number } | null;
  onAlertsChange?: (alerts: RiskAlert[]) => void;
  mobileMode?: boolean;
  /** Shared betting patterns from EventDetailPage (avoids duplicate 60s poll). */
  patternsByUserId?: Map<string, SidebarPattern[]> | null;
  /**
   * When set (including `null` while loading), EventDetailPage owns agent tree/root/descendant fetches — skip duplicates here.
   */
  bookViewContextFromParent?: BookViewContext | null;
  /**
   * Logged-in agent subtree from EventDetailPage; when defined, skip local AGENT_DESCENDANT_IDS for agent.id.
   */
  agentSubtreeIdsFromParent?: string[] | null;
}

export const EventSidebar = ({
  event,
  onAlertsChange,
  mobileMode,
  patternsByUserId: patternsByUserIdProp = null,
  bookViewContextFromParent,
  agentSubtreeIdsFromParent,
}: EventSidebarProps) => {
  const useParentBookView = bookViewContextFromParent !== undefined;
  const sidebarTabsId = `event-people-${useId()}`;
  const navigate = useNavigate();
  useCurrentWhitelabel();
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency();
  // Use isAgent() helper to properly distinguish agent login from admin login
  const isAgentLogin = useAuthStore(s => s.isAgent());
  const agent = useAuthStore(s => s.agent);
  const permissions = useAuthStore(s => s.permissions);
  const canViewPlayerWallet = isAgentLogin || hasPermissionWithNested(permissions, 'players.wallet', 'view');
  const walletMask = '••••';
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // Fetch patterns for players
  // Note: Patterns don't change as frequently as bets, so we use a longer polling interval
  // or could be replaced with subscription in the future if real-time pattern updates are needed
  const { data: patternsDataLocal } = useQuery<{ bettingPatterns: SidebarPattern[] }>(GET_BETTING_PATTERNS_QUERY, {
    variables: { eventId: event?.id, limit: 1000 },
    skip: !event?.id || patternsByUserIdProp != null,
    errorPolicy: "all",
    pollInterval: 60000,
  });

  const patternsByUserId = useMemo(() => {
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
  const [activeTab, setActiveTab] = useState<"players" | "agents">("players");
  const [alertListOpen, setAlertListOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");

  // Fetch risk config - skip for agents (they don't have access)
  const { data: riskConfigData } = useQuery<{ eventRiskConfig: SidebarRiskConfig }>(GET_EVENT_RISK_CONFIG_QUERY, {
    variables: { eventId: event?.id ? String(event.id) : "" },
    skip: !event?.id || isAgentLogin,
    errorPolicy: "all",
    fetchPolicy: "cache-first",
  });

  const riskConfig = riskConfigData?.eventRiskConfig;

  // Fetch event bets to calculate counts
  // Note: status filter removed - GraphQL doesn't support array for enum, we filter client-side
  // Note: agentId filtering is handled automatically by backend based on logged-in agent context
  // NOTE: Don't pass tenant/whitelabelId from frontend - let backend derive from context (headers)
  // This ensures proper filtering based on selected whitelabel in admin panel top bar
  const { data: betsData } = useQuery<{ sportsBets: SidebarBet[] }>(EVENT_BETS_QUERY, {
    variables: {
      query: {
        eventId: event?.id ? String(event.id) : undefined,
        // Cap payload size: very busy events may exceed this; metrics are approximate past this point.
        limit: 2000,
      },
    },
    skip: !event?.id,
    errorPolicy: "all",
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    fetchPolicy: "network-only",
  });

  // Fetch agents (when agent is logged in, pass parentAgentId so backend returns direct children)
  const { data: agentsData, loading: agentsLoading } = useQuery<{ agents: { agentsPage: { items: SidebarAgent[] } } }>(
    AGENTS_PAGE_QUERY,
    {
      variables: {
        query: undefined,
        offset: 0,
        limit: 50,
        parentAgentId: isAgentLogin && agent?.id ? String(agent.id) : undefined,
      },
      skip: isAgentLogin && !agent?.id,
      errorPolicy: "all",
      // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
      // This ensures proper filtering based on selected whitelabel in admin panel
      fetchPolicy: "network-only",
    }
  );

  // Fetch players
  const { data: playersData, loading: playersLoading } = useQuery<{ usersPage: { items: SidebarPlayer[] } }>(
    USERS_PAGE_QUERY,
    {
      variables: {
        query: undefined,
        offset: 0,
        limit: 50,
      },
      errorPolicy: "all",
      // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
      // This ensures proper filtering based on selected whitelabel in admin panel
      fetchPolicy: "network-only",
    }
  );

  const allAgents = useMemo(() => agentsData?.agents?.agentsPage?.items || [], [agentsData?.agents?.agentsPage?.items]);
  const allPlayers = useMemo(() => playersData?.usersPage?.items || [], [playersData?.usersPage?.items]);

  // Role checks for hierarchy view (same as MarketCard)
  const roles = useAuthStore(s => s.roles) ?? [];
  const directorMode = useUIStore(s => s.directorMode);
  const isWhitelabelAdmin = roles.some(
    r =>
      r === "Whitelabel Admin" ||
      r.toLowerCase() === "whitelabel_admin" ||
      r.toLowerCase().includes("whitelabel"),
  );
  const isSuperAdmin = roles.some(
    r =>
      r === "Super Admin" ||
      r.toLowerCase() === "super_admin" ||
      (r.toLowerCase().includes("super") && r.toLowerCase().includes("admin")),
  );
  const isSuperAdminInWhitelabelMode = isSuperAdmin && directorMode === "whitelabel";
  const isWhitelabelView = isWhitelabelAdmin || isSuperAdminInWhitelabelMode;

  const client = useApolloClient();
  const [descendantIdsMap, setDescendantIdsMap] = useState<Map<string, string[]>>(new Map());
  const [agentDescendantIdsForTree, setAgentDescendantIdsForTree] = useState<string[] | null>(null);

  const { data: agentTreeData } = useQuery<{ agents: { agentTree: SidebarAgent[] } }>(AGENT_TREE_FOR_VIEW_QUERY, {
    variables: { rootId: agent?.id ?? "" },
    skip: useParentBookView || !isAgentLogin || !agent?.id,
    fetchPolicy: "cache-first",
  });

  const { data: agentRootAgentsData } = useQuery<{ agents: { agentRootAgents: SidebarAgent[] } }>(AGENT_ROOT_AGENTS_QUERY, {
    skip: useParentBookView || isAgentLogin || !isWhitelabelView,
    fetchPolicy: "cache-first",
  });

  const agentInfoMap = useMemo(() => {
    const map = new Map<string, { username: string | null; schemeType: string; rate: number | null }>();
    if (useParentBookView && bookViewContextFromParent && isWhitelabelView) {
      for (const id of bookViewContextFromParent.directChildAgentIds) {
        const info = bookViewContextFromParent.getAgentInfo?.(id);
        if (info) map.set(id, info);
      }
      return map;
    }
    if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
      (agentRootAgentsData.agents.agentRootAgents as SidebarAgent[]).forEach((a: SidebarAgent) => {
        map.set(a.id, {
          username: a.username ?? null,
          schemeType: a.schemeType || 'N/A',
          rate: a.rate ?? null,
        });
      });
    }
    return map;
  }, [
    useParentBookView,
    bookViewContextFromParent,
    isWhitelabelView,
    agentRootAgentsData?.agents?.agentRootAgents,
  ]);

  const directChildIds = useMemo(() => {
    if (useParentBookView) {
      return bookViewContextFromParent?.directChildAgentIds ?? [];
    }
    if (isAgentLogin && agent?.id) {
      const tree = (agentTreeData?.agents?.agentTree ?? []) as { id: string }[];
      return tree.map(c => c.id);
    }
    if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
      return (agentRootAgentsData.agents.agentRootAgents as { id: string }[]).map(a => a.id);
    }
    return [];
  }, [
    useParentBookView,
    bookViewContextFromParent?.directChildAgentIds,
    isAgentLogin,
    agent?.id,
    agentTreeData?.agents?.agentTree,
    isWhitelabelView,
    agentRootAgentsData?.agents?.agentRootAgents,
  ]);

  useEffect(() => {
    if (useParentBookView) return;
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
  }, [useParentBookView, directChildIds, client]);

  useEffect(() => {
    if (agentSubtreeIdsFromParent !== undefined) return;
    if (!isAgentLogin || !agent?.id) {
      setAgentDescendantIdsForTree(null);
      return;
    }
    let cancelled = false;
    client
      .query({
        query: AGENT_DESCENDANT_IDS_QUERY,
        variables: { agentId: String(agent.id) },
      })
      .then(result => {
        if (cancelled) return;
        const ids =
          (result?.data as { agents?: { agentDescendantIds?: string[] } })?.agents
            ?.agentDescendantIds ?? [String(agent.id)];
        setAgentDescendantIdsForTree([String(agent.id), ...ids]);
      })
      .catch(() => setAgentDescendantIdsForTree([String(agent.id)]));
    return () => {
      cancelled = true;
    };
  }, [agentSubtreeIdsFromParent, isAgentLogin, agent?.id, client]);

  const parentDerivedDescendantMap = useMemo(() => {
    const ctx = bookViewContextFromParent;
    if (!ctx) return new Map<string, string[]>();
    const next = new Map<string, string[]>();
    for (const id of ctx.directChildAgentIds) {
      next.set(id, ctx.getDescendantsOf(id));
    }
    return next;
  }, [bookViewContextFromParent]);

  const effectiveDescendantIdsMap = useParentBookView ? parentDerivedDescendantMap : descendantIdsMap;

  const getDescendantsOf = useCallback((agentId: string): string[] =>
    effectiveDescendantIdsMap.get(agentId) ?? [agentId], [effectiveDescendantIdsMap]);

  const getDirectChildAgentId = useCallback((agentId: string): string | null => {
    if (!isWhitelabelView || !directChildIds.length) return agentId;
    if (directChildIds.includes(agentId)) return agentId;
    for (const directChildId of directChildIds) {
      const descendants = getDescendantsOf(directChildId);
      if (descendants.includes(agentId)) return directChildId;
    }
    return null;
  }, [isWhitelabelView, directChildIds, getDescendantsOf]);

  const agentDescendantIdsResolved =
    agentSubtreeIdsFromParent !== undefined ? agentSubtreeIdsFromParent : agentDescendantIdsForTree;

  const agentDescendantIdSet = useMemo(() => {
    if (!isAgentLogin || !agentDescendantIdsResolved?.length) return null;
    return new Set(agentDescendantIdsResolved);
  }, [isAgentLogin, agentDescendantIdsResolved]);

  const descendantsLoaded = useParentBookView
    ? bookViewContextFromParent != null
      ? directChildIds.length === 0 || directChildIds.every(id => effectiveDescendantIdsMap.has(id))
      : true
    : directChildIds.length === 0 || directChildIds.every(id => descendantIdsMap.has(id));

  // Filter bets client-side to only include matched/unmatched (open bets) for current event
  const bets = useMemo(() => {
    if (!betsData?.sportsBets || !Array.isArray(betsData.sportsBets)) return [];
    const currentEventId = event?.id ? String(event.id) : "";

    return betsData.sportsBets.filter((bet: SidebarBet) => {
      // First filter by eventId (safety check in case cache has old data)
      if (currentEventId && String(bet.eventId || "") !== currentEventId) {
        return false;
      }
      // Filter to show all bets, not just matched/unmatched
      return true;
    });
  }, [betsData?.sportsBets, event?.id]);

  // Calculate bet counts per player and build agent mapping from bet data
  const playerBetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const playerAgentMap = new Map<string, string>(); // playerId -> agentId
    const metrics = new Map<
      string,
      {
        betCount: number;
        totalLiability: number;
        netExposure: number;
        avgOdds: number;
      }
    >();

    bets.forEach((bet: SidebarBet) => {
      if (bet.userId) {
        const userId = String(bet.userId);
        counts.set(userId, (counts.get(userId) || 0) + 1);

        // Map player to agent if available in bet data
        if (bet.agentInfo?.agentId) {
          playerAgentMap.set(userId, String(bet.agentInfo.agentId));
        }

        // Calculate metrics for each player
        const current = metrics.get(userId) || {
          betCount: 0,
          totalLiability: 0,
          netExposure: 0,
          avgOdds: 0,
        };

        const stake = Number(bet.stake) || 0;
        const liability = Number(bet.liability) || 0;
        const price = Number(bet.price) || 0;

        current.betCount += 1;
        current.totalLiability += liability;
        current.avgOdds += price;

        if (bet.side === "back") {
          current.netExposure += liability;
        } else if (bet.side === "lay") {
          current.netExposure -= stake;
        }

        metrics.set(userId, current);
      }
    });

    // Calculate average odds
    metrics.forEach((metric) => {
      if (metric.betCount > 0) {
        metric.avgOdds = metric.avgOdds / metric.betCount;
      }
    });

    return { counts, playerAgentMap, metrics };
  }, [bets]);

  // Calculate agent metrics from bets with agent info
  const agentMetrics = useMemo(() => {
    const metrics = new Map<
      string,
      {
        betCount: number;
        totalStake: number;
        totalLiability: number;
        netExposure: number;
        avgOdds: number;
        backBets: number;
        layBets: number;
      }
    >();
    const agentMap = new Map<string, SidebarAgent>();

    // Map agent IDs to agent data
    allAgents.forEach((agent: SidebarAgent) => {
      agentMap.set(String(agent.id), agent);
    });

    // Aggregate metrics by agent from bets
    bets.forEach((bet: SidebarBet) => {
      if (bet.agentInfo?.agentId) {
        const agentId = String(bet.agentInfo.agentId);
        const current = metrics.get(agentId) || {
          betCount: 0,
          totalStake: 0,
          totalLiability: 0,
          netExposure: 0,
          avgOdds: 0,
          backBets: 0,
          layBets: 0,
        };

        const stake = Number(bet.stake) || 0;
        const liability = Number(bet.liability) || 0;
        const price = Number(bet.price) || 0;

        current.betCount += 1;
        // Total wagered for sports = liability
        current.totalStake += liability || stake;
        current.totalLiability += liability;
        current.avgOdds += price;

        if (bet.side === "back") {
          current.backBets += 1;
          current.netExposure += liability;
        } else if (bet.side === "lay") {
          current.layBets += 1;
          current.netExposure -= stake;
        }

        metrics.set(agentId, current);
      }
    });

    // Calculate average odds
    metrics.forEach((metric) => {
      if (metric.betCount > 0) {
        metric.avgOdds = metric.avgOdds / metric.betCount;
      }
    });

    return { metrics, agentMap };
  }, [bets, allAgents]);

  // Create agent lookup map for player display
  const agentMap = useMemo(() => {
    const map = new Map<string, SidebarAgent>();
    allAgents.forEach((a: SidebarAgent) => {
      map.set(String(a.id), a);
    });
    return map;
  }, [allAgents]);

  type AgentMetricEntry = {
    betCount: number;
    totalStake: number;
    totalLiability: number;
    netExposure: number;
    avgOdds: number;
    backBets: number;
    layBets: number;
  };

  const emptyMetric = useCallback((): AgentMetricEntry => ({
    betCount: 0,
    totalStake: 0,
    totalLiability: 0,
    netExposure: 0,
    avgOdds: 0,
    backBets: 0,
    layBets: 0,
  }), []);

  const agentMetricsRolled = useMemo(() => {
    const metrics = new Map<string, AgentMetricEntry>();
    if (isWhitelabelView && directChildIds.length > 0) {
      bets.forEach((bet: SidebarBet) => {
        if (!bet.agentInfo?.agentId) return;
        const effectiveAgentId = getDirectChildAgentId(String(bet.agentInfo.agentId));
        if (!effectiveAgentId) return;
        const current = metrics.get(effectiveAgentId) ?? emptyMetric();
        const stake = Number(bet.stake) || 0;
        const liability = Number(bet.liability) || 0;
        const price = Number(bet.price) || 0;
        current.betCount += 1;
        current.totalStake += liability || stake;
        current.totalLiability += liability;
        current.avgOdds += price;
        if (bet.side === "back") {
          current.backBets += 1;
          current.netExposure += liability;
        } else if (bet.side === "lay") {
          current.layBets += 1;
          current.netExposure -= stake;
        }
        metrics.set(effectiveAgentId, current);
      });
    } else if (isAgentLogin && directChildIds.length > 0) {
      directChildIds.forEach((directChildId) => {
        const descendantIds = new Set(getDescendantsOf(directChildId));
        bets.forEach((bet: SidebarBet) => {
          if (!bet.agentInfo?.agentId) return;
          const agentId = String(bet.agentInfo.agentId);
          if (!descendantIds.has(agentId)) return;
          const current = metrics.get(directChildId) ?? emptyMetric();
          const stake = Number(bet.stake) || 0;
          const liability = Number(bet.liability) || 0;
          const price = Number(bet.price) || 0;
          current.betCount += 1;
          current.totalStake += liability || stake;
          current.totalLiability += liability;
          current.avgOdds += price;
          if (bet.side === "back") {
            current.backBets += 1;
            current.netExposure += liability;
          } else if (bet.side === "lay") {
            current.layBets += 1;
            current.netExposure -= stake;
          }
          metrics.set(directChildId, current);
        });
      });
    }
    metrics.forEach((metric) => {
      if (metric.betCount > 0) metric.avgOdds = metric.avgOdds / metric.betCount;
    });
    return metrics;
  }, [
    bets,
    isWhitelabelView,
    isAgentLogin,
    directChildIds,
    emptyMetric,
    getDescendantsOf,
    getDirectChildAgentId,
  ]);

  const hasActivityInSubtree = useMemo(() => {
    return (directChildId: string): boolean => {
      if (isWhitelabelView || isAgentLogin) {
        const rolled = agentMetricsRolled.get(directChildId);
        return (rolled?.betCount ?? 0) > 0;
      }
      return false;
    };
  }, [isWhitelabelView, isAgentLogin, agentMetricsRolled]);

  // Filter players - for agents show all players in tree (direct + nested); for admins show only those with bets
  const players = useMemo(() => {
    let filteredPlayers = allPlayers;

    if (isAgentLogin && agent?.id) {
      if (agentDescendantIdSet) {
        // Show all players in the agent's tree (direct + under sub-agents)
        filteredPlayers = allPlayers.filter((player: SidebarPlayer) => {
          const playerAgentId = playerBetCounts?.playerAgentMap?.get(String(player.id));
          if (playerAgentId && agentDescendantIdSet.has(playerAgentId)) return true;
          return player.agentId && agentDescendantIdSet.has(String(player.agentId));
        });
      } else {
        // Until descendant set is loaded, keep current behavior (only direct players)
        const agentId = String(agent.id);
        filteredPlayers = allPlayers.filter((player: SidebarPlayer) => {
          const playerAgentId = playerBetCounts?.playerAgentMap?.get(String(player.id));
          if (playerAgentId) return playerAgentId === agentId;
          return player.agentId && String(player.agentId) === agentId;
        });
      }
    } else {
      // For admins: only show players with bets in this event
      filteredPlayers = allPlayers.filter((player: SidebarPlayer) => {
        const betCount = playerBetCounts?.counts?.get(String(player.id)) || 0;
        return betCount > 0;
      });
    }

    // Then apply search filter
    if (!playerSearch.trim()) return filteredPlayers;
    const searchLower = playerSearch.toLowerCase().trim();
    return filteredPlayers.filter((player: SidebarPlayer) => {
      const name = (
        player.username ||
        player.name ||
        player.phone ||
        ""
      ).toLowerCase();
      return name.includes(searchLower);
    });
  }, [allPlayers, playerBetCounts, playerSearch, isAgentLogin, agent?.id, agentDescendantIdSet]);

  // Filter agents - direct child/root agents only, with bet activity in subtree (only when descendants loaded)
  const agents = useMemo(() => {
    let filteredAgents: SidebarAgent[];

    const useRolledAgents =
      descendantsLoaded &&
      directChildIds.length > 0 &&
      (isAgentLogin || isWhitelabelView);

    if (isAgentLogin && agent?.id && useRolledAgents) {
      filteredAgents = allAgents.filter(
        (a: SidebarAgent) =>
          directChildIds.includes(String(a.id)) && hasActivityInSubtree(String(a.id)),
      );
    } else if (isWhitelabelView && useRolledAgents) {
      filteredAgents = allAgents.filter(
        (a: SidebarAgent) =>
          directChildIds.includes(String(a.id)) && hasActivityInSubtree(String(a.id)),
      );
    } else {
      filteredAgents = allAgents.filter((agentItem: SidebarAgent) => {
        const agentId = String(agentItem.id);
        const hasDirectBets = agentMetrics?.metrics?.has(agentId);
        const hasPlayerBets = Array.from(
          playerBetCounts?.playerAgentMap?.values() || [],
        ).includes(agentId);
        return hasDirectBets || hasPlayerBets;
      });
    }

    if (!agentSearch.trim()) return filteredAgents;
    const searchLower = agentSearch.toLowerCase().trim();
    return filteredAgents.filter((a: SidebarAgent) => {
      const name = (a.username || a.phone || "").toLowerCase();
      return name.includes(searchLower);
    });
  }, [
    allAgents,
    agentMetrics,
    playerBetCounts,
    agentSearch,
    isAgentLogin,
    agent?.id,
    isWhitelabelView,
    directChildIds,
    hasActivityInSubtree,
    descendantsLoaded,
  ]);

  // Book exposure per agent: sum of wallet.exposure of all players under that agent.
  // Use same key as agents list: when rolled (whitelabel/agent with hierarchy), key by directChildId; else by raw agentId.
  const agentBookExposureMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!canViewPlayerWallet || !playerBetCounts?.playerAgentMap || !Array.isArray(players)) return map;

    const useRolledKeys =
      descendantsLoaded &&
      directChildIds.length > 0 &&
      (isWhitelabelView || isAgentLogin);

    const getEffectiveAgentKey = (rawAgentId: string): string | null => {
      if (!useRolledKeys) return rawAgentId;
      if (isWhitelabelView) return getDirectChildAgentId(rawAgentId);
      // Agent login: find directChildId that contains this rawAgentId
      if (directChildIds.includes(rawAgentId)) return rawAgentId;
      for (const dcid of directChildIds) {
        const descendants = getDescendantsOf(dcid);
        if (descendants.includes(rawAgentId)) return dcid;
      }
      return null;
    };

    players.forEach((player: SidebarPlayer) => {
      const rawAgentId = playerBetCounts.playerAgentMap.get(String(player.id));
      if (!rawAgentId) return;
      const effectiveKey = getEffectiveAgentKey(rawAgentId);
      if (!effectiveKey) return;
      const exp = player.wallet?.exposure != null ? Number(player.wallet.exposure) : 0;
      if (!Number.isFinite(exp)) return;
      map.set(effectiveKey, (map.get(effectiveKey) ?? 0) + exp);
    });
    return map;
  }, [
    players,
    playerBetCounts?.playerAgentMap,
    canViewPlayerWallet,
    descendantsLoaded,
    directChildIds,
    isWhitelabelView,
    isAgentLogin,
    getDescendantsOf,
    getDirectChildAgentId,
  ]);

  // Get risk indicator color
  const getRiskColor = (riskType?: string | null) => {
    if (!riskType) return "default";
    const risk = riskType.toUpperCase();
    if (risk === "HIGH") return "red";
    if (risk === "MEDIUM") return "orange";
    return "green";
  };

  // Calculate risk based on relative comparison (percentile-based)
  const calculateRelativeRisk = useMemo(() => {
    const useRolledForRisk =
      descendantsLoaded &&
      directChildIds.length > 0 &&
      (isAgentLogin || isWhitelabelView);
    const metricsSource = useRolledForRisk
      ? agentMetricsRolled
      : agentMetrics?.metrics;
    if (!metricsSource || metricsSource.size === 0) {
      return () => ({ color: "default", text: "N/A" });
    }
    const allAgentMetrics = Array.from(metricsSource.values());

    if (allAgentMetrics.length === 0) {
      return () => ({ color: "default", text: "N/A" });
    }

    // Extract values for percentile calculation
    const liabilities = allAgentMetrics
      .map((m) => m.totalLiability)
      .filter((v) => v > 0);
    const exposures = allAgentMetrics
      .map((m) => Math.abs(m.netExposure))
      .filter((v) => v > 0);
    const betCounts = allAgentMetrics
      .map((m) => m.betCount)
      .filter((v) => v > 0);
    const avgOdds = allAgentMetrics.map((m) => m.avgOdds).filter((v) => v > 0);

    // Calculate percentiles (75th, 90th, 95th)
    const getPercentile = (arr: number[], percentile: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.ceil((percentile / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)] || 0;
    };

    // Use config percentiles if available, otherwise calculate
    const p75Liability =
      riskConfig?.percentiles?.liability75 ?? getPercentile(liabilities, 75);
    const p90Liability =
      riskConfig?.percentiles?.liability90 ?? getPercentile(liabilities, 90);
    const p95Liability =
      riskConfig?.percentiles?.liability95 ?? getPercentile(liabilities, 95);

    const p75Exposure =
      riskConfig?.percentiles?.exposure75 ?? getPercentile(exposures, 75);
    const p90Exposure =
      riskConfig?.percentiles?.exposure90 ?? getPercentile(exposures, 90);

    const p75BetCount =
      riskConfig?.percentiles?.betCount75 ?? getPercentile(betCounts, 75);
    const p90BetCount =
      riskConfig?.percentiles?.betCount90 ?? getPercentile(betCounts, 90);

    const p75Odds =
      riskConfig?.percentiles?.odds75 ?? getPercentile(avgOdds, 75);
    const p90Odds =
      riskConfig?.percentiles?.odds90 ?? getPercentile(avgOdds, 90);

    // Get weights from config or use defaults
    const liabilityWeight = riskConfig?.weights?.liability ?? 40;
    const exposureWeight = riskConfig?.weights?.exposure ?? 30;
    const volumeWeight = riskConfig?.weights?.volume ?? 15;
    const oddsWeight = riskConfig?.weights?.odds ?? 15;

    return (metrics: {
      betCount: number;
      totalStake: number;
      totalLiability: number;
      netExposure: number;
      avgOdds: number;
      backBets: number;
      layBets: number;
    }) => {
      const { betCount, totalLiability, netExposure, avgOdds } = metrics;

      if (betCount === 0) return { color: "default", text: "N/A" };

      let riskScore = 0;

      // 1. Liability percentile (use configured weight)
      if (p95Liability > 0 && totalLiability >= p95Liability)
        riskScore += liabilityWeight;
      else if (p90Liability > 0 && totalLiability >= p90Liability)
        riskScore += Math.floor(liabilityWeight * 0.75);
      else if (p75Liability > 0 && totalLiability >= p75Liability)
        riskScore += Math.floor(liabilityWeight * 0.5);
      else if (totalLiability > 0)
        riskScore += Math.floor(liabilityWeight * 0.25);

      // 2. Exposure percentile (use configured weight)
      const absExposure = Math.abs(netExposure);
      if (p90Exposure > 0 && absExposure >= p90Exposure)
        riskScore += exposureWeight;
      else if (p75Exposure > 0 && absExposure >= p75Exposure)
        riskScore += Math.floor(exposureWeight * 0.67);
      else if (absExposure > 0) riskScore += Math.floor(exposureWeight * 0.33);

      // 3. Bet count percentile (use configured weight)
      if (p90BetCount > 0 && betCount >= p90BetCount) riskScore += volumeWeight;
      else if (p75BetCount > 0 && betCount >= p75BetCount)
        riskScore += Math.floor(volumeWeight * 0.67);
      else if (betCount > 0) riskScore += Math.floor(volumeWeight * 0.33);

      // 4. Odds percentile (use configured weight)
      if (p90Odds > 0 && avgOdds >= p90Odds) riskScore += oddsWeight;
      else if (p75Odds > 0 && avgOdds >= p75Odds)
        riskScore += Math.floor(oddsWeight * 0.67);
      else if (avgOdds > 0) riskScore += Math.floor(oddsWeight * 0.33);

      // Determine risk level based on score (configurable thresholds with defaults: 60, 35, 15)
      const riskLevelThresholds = riskConfig?.riskLevelThresholds || {};
      const highThreshold = riskLevelThresholds.high ?? 60;
      const mediumThreshold = riskLevelThresholds.medium ?? 35;
      const lowThreshold = riskLevelThresholds.low ?? 15;

      if (riskScore >= highThreshold) return { color: "red", text: "HIGH" };
      if (riskScore >= mediumThreshold)
        return { color: "orange", text: "MEDIUM" };
      if (riskScore >= lowThreshold) return { color: "yellow", text: "LOW" };
      return { color: "green", text: "MINIMAL" };
    };
  }, [
    isAgentLogin,
    isWhitelabelView,
    directChildIds,
    descendantsLoaded,
    agentMetricsRolled,
    agentMetrics?.metrics,
    riskConfig,
  ]);

  // Calculate player risk based on relative comparison
  const calculatePlayerRisk = useMemo(() => {
    // Use the metrics from playerBetCounts
    const allPlayerMetrics = playerBetCounts.metrics;
    const allMetrics = Array.from(allPlayerMetrics.values());

    if (allMetrics.length === 0) {
      return () => ({ color: "default", text: "N/A" });
    }

    const liabilities = allMetrics
      .map((m) => m.totalLiability)
      .filter((v) => v > 0);
    const exposures = allMetrics
      .map((m) => Math.abs(m.netExposure))
      .filter((v) => v > 0);
    const betCounts = allMetrics.map((m) => m.betCount).filter((v) => v > 0);

    const getPercentile = (arr: number[], percentile: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.ceil((percentile / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)] || 0;
    };

    // Use config percentiles if available, otherwise calculate
    const p75Liability =
      riskConfig?.percentiles?.liability75 ?? getPercentile(liabilities, 75);
    const p90Liability =
      riskConfig?.percentiles?.liability90 ?? getPercentile(liabilities, 90);
    const p95Liability =
      riskConfig?.percentiles?.liability95 ?? getPercentile(liabilities, 95);

    const p75Exposure =
      riskConfig?.percentiles?.exposure75 ?? getPercentile(exposures, 75);
    const p90Exposure =
      riskConfig?.percentiles?.exposure90 ?? getPercentile(exposures, 90);

    const p75BetCount =
      riskConfig?.percentiles?.betCount75 ?? getPercentile(betCounts, 75);
    const p90BetCount =
      riskConfig?.percentiles?.betCount90 ?? getPercentile(betCounts, 90);

    // Get weights from config or use defaults
    const liabilityWeight = riskConfig?.weights?.liability ?? 40;
    const exposureWeight = riskConfig?.weights?.exposure ?? 30;
    const volumeWeight = riskConfig?.weights?.volume ?? 15;

    return (playerId: string) => {
      const metrics = allPlayerMetrics.get(playerId);
      if (!metrics || metrics.betCount === 0) {
        return { color: "default", text: "N/A" };
      }

      let riskScore = 0;

      // Liability percentile (use configured weight)
      if (p95Liability > 0 && metrics.totalLiability >= p95Liability)
        riskScore += liabilityWeight;
      else if (p90Liability > 0 && metrics.totalLiability >= p90Liability)
        riskScore += Math.floor(liabilityWeight * 0.75);
      else if (p75Liability > 0 && metrics.totalLiability >= p75Liability)
        riskScore += Math.floor(liabilityWeight * 0.5);
      else if (metrics.totalLiability > 0)
        riskScore += Math.floor(liabilityWeight * 0.25);

      // Exposure percentile (use configured weight)
      const absExposure = Math.abs(metrics.netExposure);
      if (p90Exposure > 0 && absExposure >= p90Exposure)
        riskScore += exposureWeight;
      else if (p75Exposure > 0 && absExposure >= p75Exposure)
        riskScore += Math.floor(exposureWeight * 0.67);
      else if (absExposure > 0) riskScore += Math.floor(exposureWeight * 0.33);

      // Bet count percentile (use configured weight)
      if (p90BetCount > 0 && metrics.betCount >= p90BetCount)
        riskScore += volumeWeight;
      else if (p75BetCount > 0 && metrics.betCount >= p75BetCount)
        riskScore += Math.floor(volumeWeight * 0.67);
      else if (metrics.betCount > 0)
        riskScore += Math.floor(volumeWeight * 0.33);

      // Determine risk level based on score (configurable thresholds with defaults: 60, 35, 15)
      const riskLevelThresholds = riskConfig?.riskLevelThresholds || {};
      const highThreshold = riskLevelThresholds.high ?? 60;
      const mediumThreshold = riskLevelThresholds.medium ?? 35;
      const lowThreshold = riskLevelThresholds.low ?? 15;

      if (riskScore >= highThreshold) return { color: "red", text: "HIGH" };
      if (riskScore >= mediumThreshold)
        return { color: "orange", text: "MEDIUM" };
      if (riskScore >= lowThreshold) return { color: "yellow", text: "LOW" };
      return { color: "green", text: "MINIMAL" };
    };
  }, [riskConfig, playerBetCounts.metrics]);

  // Prepare entity risk data for alerts
  const playerEntities = useMemo(() => {
    if (!Array.isArray(players) || !playerBetCounts) return [];
    return players
      .filter((player: SidebarPlayer) => player && player.id)
      .map((player: SidebarPlayer) => {
        const betCount = playerBetCounts.counts?.get(String(player.id)) || 0;
        const playerName =
          player.username || player.name || player.phone || "Unknown";
        const relativeRisk = calculatePlayerRisk(String(player.id));

        // Ensure risk is valid
        if (!relativeRisk || !relativeRisk.text) {
          return null;
        }

        const dbRiskType = player.riskType?.toUpperCase();
        // Validate dbRiskType is a valid risk level
        const validRiskLevels = ["HIGH", "MEDIUM", "LOW", "MINIMAL", "N/A"];
        const safeDbRiskType =
          dbRiskType && validRiskLevels.includes(dbRiskType)
            ? (dbRiskType as "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A")
            : "N/A";
        
        // Normalize relativeRisk.text to match valid risk levels
        const normalizeRiskText = (text: string): "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A" => {
          const upper = text.toUpperCase();
          if (validRiskLevels.includes(upper)) {
            return upper as "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A";
          }
          return "N/A";
        };

        const finalRisk = betCount > 0
          ? { color: relativeRisk.color, text: normalizeRiskText(relativeRisk.text) }
            : { color: "default", text: safeDbRiskType };
        
        const metrics = playerBetCounts.metrics?.get(String(player.id)) || {
          betCount: 0,
          totalLiability: 0,
          netExposure: 0,
          avgOdds: 0,
        };

        return {
          id: String(player.id),
          name: playerName,
          type: "player" as const,
          risk: finalRisk,
          metrics,
        };
      })
      .filter(
        (entity): entity is NonNullable<typeof entity> => entity !== null
      );
  }, [players, playerBetCounts, calculatePlayerRisk]);

  const agentEntities = useMemo(() => {
    if (!Array.isArray(agents)) return [];

    const useRolledForEntities =
      descendantsLoaded &&
      directChildIds.length > 0 &&
      (isAgentLogin || isWhitelabelView);
    const metricsSource = useRolledForEntities
      ? agentMetricsRolled
      : agentMetrics?.metrics;

    if (!metricsSource) return [];

    const validRiskLevels = ["HIGH", "MEDIUM", "LOW", "MINIMAL", "N/A"];
    const normalizeRiskText = (text: string): "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A" => {
      const upper = text.toUpperCase();
      if (validRiskLevels.includes(upper)) {
        return upper as "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A";
      }
      return "N/A";
    };

    return agents
      .filter((agent: SidebarAgent) => agent && agent.id)
      .map((agent: SidebarAgent) => {
        const fullMetrics = metricsSource.get(String(agent.id)) ?? emptyMetric();
        const agentName = agent.username || agent.phone || "Unknown";
        const risk = calculateRelativeRisk(fullMetrics);

        // Ensure risk is valid
        if (!risk || !risk.text) {
          return null;
        }

        // Extract only the metrics needed for alerts
        const metrics = {
          betCount: fullMetrics.betCount || 0,
          totalLiability: fullMetrics.totalLiability || 0,
          netExposure: fullMetrics.netExposure || 0,
          avgOdds: fullMetrics.avgOdds || 0,
        };

        return {
          id: String(agent.id),
          name: agentName,
          type: "agent" as const,
          risk: { color: risk.color, text: normalizeRiskText(risk.text) },
          metrics,
        };
      })
      .filter(
        (entity): entity is NonNullable<typeof entity> => entity !== null
      );
  }, [
    agents,
    agentMetrics,
    agentMetricsRolled,
    descendantsLoaded,
    directChildIds,
    isAgentLogin,
    isWhitelabelView,
    calculateRelativeRisk,
    emptyMetric,
  ]);

  // Use risk alerts hook
  const { activeAlerts, sidebarIndicatorEnabled } =
    useRiskAlerts(playerEntities, agentEntities, riskConfig?.alerts || null);

  // Notify parent of alerts change
  useEffect(() => {
    if (onAlertsChange && Array.isArray(activeAlerts)) {
      onAlertsChange(activeAlerts);
    }
  }, [activeAlerts, onAlertsChange]);

  const formatCut = (raw: number) => {
    const n = convertFromWhitelabelCurrency(raw);
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    const sym = getCurrencySymbol();
    if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
    return formatAmount(n);
  };

  const useRolledMetrics = descendantsLoaded && directChildIds.length > 0 && (isAgentLogin || isWhitelabelView);
  const exposureOfPlayer = (player: SidebarPlayer) =>
    canViewPlayerWallet && player.wallet?.exposure != null ? Number(player.wallet.exposure) : playerBetCounts.metrics.get(String(player.id))?.netExposure ?? 0;
  const metricsOfAgent = (agentItem: SidebarAgent): AgentMetricEntry =>
    useRolledMetrics ? agentMetricsRolled.get(String(agentItem.id)) ?? emptyMetric() : agentMetrics.metrics.get(String(agentItem.id)) ?? emptyMetric();
  const exposureOfAgent = (agentItem: SidebarAgent, metrics: AgentMetricEntry) => {
    const agentBookExposure = agentBookExposureMap.get(String(agentItem.id));
    return canViewPlayerWallet && agentBookExposure != null ? agentBookExposure : metrics.netExposure || 0;
  };
  const largestExposure = Math.max(0, ...(activeTab === 'players'
    ? players.map(player => Math.abs(exposureOfPlayer(player)))
    : agents.map(agentItem => Math.abs(exposureOfAgent(agentItem, metricsOfAgent(agentItem))))
  ).filter(Number.isFinite));

  return <Card title="Book" sub="Exposure by player and agent" body="flush" className={clsx(styles.book, mobileMode && styles.mobile)}
    tools={sidebarIndicatorEnabled && activeAlerts.length > 0 ? <RiskAlertSidebarIndicator alerts={activeAlerts} onClick={() => setAlertListOpen(true)} /> : undefined}>
    <div className={styles.controls}><Tabs value={activeTab} onChange={setActiveTab} idPrefix={sidebarTabsId} label="Event people" size="sm" className={styles.tabs} items={[
      { value: 'players', label: 'Players', count: players.length },
      { value: 'agents', label: 'Agents', count: agents.length },
    ]} /></div>
    <div className={styles.panel} role="tabpanel" tabIndex={0} id={tabPanelId(sidebarTabsId, activeTab)} aria-labelledby={tabId(sidebarTabsId, activeTab)}>
      {activeTab === 'players' ? <>
        <div className={styles.find}><SearchField label="Search event players" placeholder="Search players..." value={playerSearch} onChange={setPlayerSearch} size="sm" /></div>
        <div className={styles.list}>{playersLoading ? <LoadingState label="Loading players..." /> : !players.length ? <EmptyState title="No players found" /> : players.map(player => {
          const playerId = String(player.id);
          const betCount = playerBetCounts.counts.get(playerId) || 0;
          const rawAgentId = playerBetCounts.playerAgentMap.get(playerId);
          const effectiveAgentId = isWhitelabelView && rawAgentId && descendantsLoaded ? getDirectChildAgentId(rawAgentId) : rawAgentId;
          const viewAgentInfo = effectiveAgentId && isWhitelabelView && descendantsLoaded ? agentInfoMap.get(effectiveAgentId) : null;
          const agentRecord = effectiveAgentId ? agentMap.get(effectiveAgentId) : rawAgentId ? agentMap.get(rawAgentId) : null;
          const agentName = viewAgentInfo?.username ?? agentRecord?.username ?? agentRecord?.phone ?? null;
          const playerName = player.username || player.name || player.phone || 'Unknown';
          const relativeRisk = calculatePlayerRisk(playerId);
          const dbRiskType = player.riskType?.toUpperCase();
          const finalRisk = betCount > 0 ? relativeRisk : dbRiskType ? { color: getRiskColor(dbRiskType), text: dbRiskType } : { color: 'default', text: 'N/A' };
          const playerPatterns = patternsByUserId.get(playerId) || [];
          const playerExposure = exposureOfPlayer(player);
          return <article key={playerId} className={styles.row} aria-label={`Player ${playerName}`}>
            <Avatar name={playerName} size={34} hue={1} className={clsx(styles.tile, finalRisk.text === 'HIGH' && styles.tileHigh)} />
            <div className={styles.main}>
              <div className={styles.line1}>
                <button type="button" className={styles.nameButton} title={playerName} onClick={() => setSelectedPlayerId(playerId)}>{playerName}</button>
                <StatusPill className={styles.pill} tone={sidebarRiskTone(finalRisk.text)}>{finalRisk.text}</StatusPill>
              </div>
              <div className={styles.line2}>
                <MetaParts parts={[agentName && `@${agentName}`, betCount > 0 && `${betCount} bets`]} />
                {player.flags && player.flags.length > 0 && <PlayerFlagIndicator flags={player.flags} userId={playerId} />}
                {playerPatterns.slice(0, 1).map((pattern, index) => <PatternBadge key={pattern.id || index} patternType={pattern.patternType} severity={pattern.severity} metrics={pattern.metrics} />)}
                {playerPatterns.length > 1 && <span>+{playerPatterns.length - 1}</span>}
              </div>
              {/* the bar would show the relative size of a masked figure */}
              {canViewPlayerWallet && <ShareBar value={playerExposure} largest={largestExposure} />}
            </div>
            <div className={styles.end}>
              {playerExposure !== 0 && <>
                <span className={clsx(styles.exposure, playerExposure > 0 ? styles.negative : styles.positive)} title={canViewPlayerWallet ? formatAmount(convertFromWhitelabelCurrency(Math.abs(playerExposure))) : undefined} aria-label="Player exposure">{playerExposure > 0 ? '−' : '+'}{canViewPlayerWallet ? formatCut(Math.abs(playerExposure)) : walletMask}</span>
                <small className={styles.endLabel}>exposure</small>
              </>}
              <small className={styles.wallet} title="Wallet balance" aria-label="Player wallet balance">{canViewPlayerWallet ? formatAmount(convertFromWhitelabelCurrency(player.wallet?.balance || 0)) : walletMask}</small>
            </div>
          </article>;
        })}</div>
      </> : <>
        <div className={styles.find}><SearchField label="Search event agents" placeholder="Search agents..." value={agentSearch} onChange={setAgentSearch} size="sm" /></div>
        <div className={styles.list}>{agentsLoading ? <LoadingState label="Loading agents..." /> : !agents.length ? <EmptyState title="No agents found" /> : agents.map(agentItem => {
          const metrics = metricsOfAgent(agentItem);
          const agentExposure = exposureOfAgent(agentItem, metrics);
          const agentName = agentItem.username || agentItem.phone || 'Unknown';
          const schemeType = agentItem.schemeType || 'N/A';
          const isSharing = schemeType === 'SHARING' || schemeType === 'CREDIT';
          const risk = calculateRelativeRisk(metrics);
          return <article key={agentItem.id} className={styles.row} aria-label={`Agent ${agentName}`}>
            <Avatar name={agentName} size={34} hue={1} className={clsx(styles.tile, risk.text === 'HIGH' && styles.tileHigh)} />
            <div className={styles.main}>
              <div className={styles.line1}>
                <button type="button" className={clsx(styles.nameButton, styles.profileLink)} title={agentName} onClick={() => navigate(`/agents/${agentItem.id}`)}>{agentName}</button>
                <StatusPill className={styles.pill} tone={sidebarRiskTone(risk.text)}>{risk.text}</StatusPill>
              </div>
              <div className={styles.line2}>
                <StatusPill className={styles.pill} tone={isSharing ? 'info' : 'neutral'}>{schemeType}</StatusPill>
                <MetaParts parts={[metrics.betCount > 0 && `${metrics.betCount} bets`, metrics.totalStake > 0 && `Vol ${formatAmount(convertFromWhitelabelCurrency(metrics.totalStake))}`]} />
              </div>
              <ShareBar value={agentExposure} largest={largestExposure} />
            </div>
            {agentExposure !== 0 && <div className={styles.end}>
              <span className={clsx(styles.exposure, agentExposure > 0 ? styles.negative : styles.positive)} title={formatAmount(convertFromWhitelabelCurrency(Math.abs(agentExposure)))} aria-label="Agent exposure">{agentExposure > 0 ? '−' : '+'}{formatCut(Math.abs(agentExposure))}</span>
              <small className={styles.endLabel}>exposure</small>
            </div>}
          </article>;
        })}</div>
      </>}
    </div>
    <RiskAlertList open={alertListOpen} onClose={() => setAlertListOpen(false)} alerts={activeAlerts} />
    {selectedPlayerId && <PlayerProfileModal open onClose={() => setSelectedPlayerId(null)} userId={selectedPlayerId} />}
  </Card>;
};

