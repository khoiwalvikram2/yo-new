import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useApolloClient } from "@apollo/client";
import styles from "./MarketPanel.module.css";
import { useAuthStore } from "@/shared/core/authStore";
import { MarketHeader } from "./MarketHeader";
import { MatchOddsLayout } from "./MatchOddsLayout";
import { StandardMarketLayout } from "./StandardMarketLayout";
import { MarketBookTable } from "./MarketBookTable";
import { useUIStore } from "@/shared/core/uiStore";
import {
  AGENT_TREE_FOR_VIEW_QUERY,
  AGENT_DESCENDANT_IDS_QUERY,
  AGENT_ROOT_AGENTS_QUERY,
} from "@/lib/graphql/agents";
import type { BookViewContext } from "../utils/bookCalculator";
import type { EventMarket, EventMarketBet } from './eventMarketTypes';

interface RootAgent { id: string; username: string | null; schemeType: string; rate: number | null }
interface MarketCardProps {
  market: EventMarket;
  event: { id?: string | number | null; [key: string]: unknown };
  isExpanded: boolean;
  onToggle: () => void;
  betCount?: number;
  exposure?: number;
  bets?: EventMarketBet[];
  /** Cheap deterministic signal for odds changes; when different, card re-renders. Avoids JSON.stringify hot path. */
  oddsSignature?: string;
  /**
   * When set (including `null`), skips per-card agent GraphQL queries and uses this book context from the parent.
   * Omit on other pages to keep legacy in-card fetching.
   */
  sharedBookViewContext?: BookViewContext | null;
}

export const MarketCard: React.FC<MarketCardProps> = React.memo(
  ({
    market,
    event,
    isExpanded,
    onToggle,
    betCount = 0,
    exposure = 0,
    bets = [],
    sharedBookViewContext,
  }) => {
    const [isBookTableExpanded, setIsBookTableExpanded] = useState(false);
    // Track expanded state per runner (runnerId -> boolean)
    const [fancyBookExpandedMap, setFancyBookExpandedMap] = useState<Map<string, boolean>>(new Map());
    // Track modal state per runner (runnerId -> boolean)
    const [fancyBookModalMap, setFancyBookModalMap] = useState<Map<string, boolean>>(new Map());
    const [descendantIdsMap, setDescendantIdsMap] = useState<Map<string, string[]>>(new Map());

    const useSharedBookView = sharedBookViewContext !== undefined;

    const isAgent = useAuthStore((s) => s.isAgent());
    const agent = useAuthStore((s) => s.agent);
    const roles = useAuthStore((s) => s.roles) ?? [];
    const directorMode = useUIStore((s) => s.directorMode);
    const client = useApolloClient();

    const isWhitelabelAdmin = roles.some(
      (r) =>
        r === "Whitelabel Admin" ||
        r.toLowerCase() === "whitelabel_admin" ||
        r.toLowerCase().includes("whitelabel")
    );
    const isSuperAdmin = roles.some(
      (r) =>
        r === "Super Admin" ||
        r.toLowerCase() === "super_admin" ||
        (r.toLowerCase().includes("super") && r.toLowerCase().includes("admin"))
    );
    const isSuperAdminInWhitelabelMode = isSuperAdmin && directorMode === "whitelabel";
    const isWhitelabelView = isWhitelabelAdmin || isSuperAdminInWhitelabelMode;

    const { data: agentTreeData } = useQuery(AGENT_TREE_FOR_VIEW_QUERY, {
      variables: { rootId: agent?.id ?? "" },
      skip: useSharedBookView || !isAgent || !agent?.id,
      fetchPolicy: "cache-first",
    });

    const { data: agentRootAgentsData } = useQuery(AGENT_ROOT_AGENTS_QUERY, {
      skip: useSharedBookView || isAgent || !isWhitelabelView,
      fetchPolicy: "cache-first",
    });

    // Build agent info map for whitelabel view (root agents with names)
    const agentInfoMap = useMemo(() => {
      const map = new Map<string, { username: string | null; schemeType: string; rate: number | null }>();
      if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
        (agentRootAgentsData.agents.agentRootAgents as RootAgent[]).forEach((agent) => {
          map.set(agent.id, {
            username: agent.username,
            schemeType: agent.schemeType,
            rate: agent.rate,
          });
        });
      }
      return map;
    }, [isWhitelabelView, agentRootAgentsData?.agents?.agentRootAgents]);

    const directChildIds = useMemo(() => {
      if (isAgent && agent?.id) {
        const tree = (agentTreeData?.agents?.agentTree ?? []) as { id: string }[];
        return tree.map((c) => c.id);
      }
      if (isWhitelabelView && agentRootAgentsData?.agents?.agentRootAgents) {
        return (agentRootAgentsData.agents.agentRootAgents as { id: string }[]).map((a) => a.id);
      }
      return [];
    }, [isAgent, agent?.id, agentTreeData?.agents?.agentTree, isWhitelabelView, agentRootAgentsData?.agents?.agentRootAgents]);

    useEffect(() => {
      if (useSharedBookView || directChildIds.length === 0) return;
      let cancelled = false;
      Promise.all(
        directChildIds.map((id) =>
          client.query({
            query: AGENT_DESCENDANT_IDS_QUERY,
            variables: { agentId: id },
          })
        )
      ).then((results) => {
        if (cancelled) return;
        setDescendantIdsMap((prev) => {
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
    }, [useSharedBookView, directChildIds, client]);

    const viewContext = useMemo<BookViewContext | null>(() => {
      if (useSharedBookView) return sharedBookViewContext ?? null;
      if (directChildIds.length === 0) return null;
      const allLoaded = directChildIds.every((id) => descendantIdsMap.has(id));
      if (!allLoaded) return null;
      return {
        directChildAgentIds: directChildIds,
        getDescendantsOf: (agentId: string) => descendantIdsMap.get(agentId) ?? [agentId],
        getAgentInfo: (agentId: string) => agentInfoMap.get(agentId) ?? null,
      };
    }, [useSharedBookView, sharedBookViewContext, directChildIds, descendantIdsMap, agentInfoMap]);

    // Reset fancy book state when market changes
    useEffect(() => {
      setFancyBookExpandedMap(new Map());
      setFancyBookModalMap(new Map());
    }, [market?.id]);

    // Check if it's a fancy market (should use StandardMarketLayout with single odds)
    const isFancy = market.kind === "fancy" || market.type === "fancy";

    // Match Odds uses 3-level depth layout, Fancy uses single odds layout
    const isMatchOdds =
      !isFancy &&
      (market.kind === "match-odds" ||
        market.type === "match-odds" ||
        market.kind === "exchange" ||
        market.type === "exchange" ||
        (market.odds && market.odds.length >= 2 && market.odds.length <= 3));

    // Show book table only for exchange and bookmaker markets
    const showBookTable =
      market.type === "exchange" ||
      market.type === "bookmaker" ||
      market.kind === "exchange" ||
      market.kind === "bookmaker";

    // Special layout for Fancy markets - uses same header as other markets
    if (isFancy) {
      return (
        <MarketHeader
          market={{ ...market, name: "Fancy" }}
          isExpanded={isExpanded}
          onToggle={onToggle}
          betCount={betCount}
          exposure={exposure}
          liquidity={0}
        >
          {/* Fancy Lines */}
          {isExpanded && (
            <div className={styles.body}>
              <StandardMarketLayout
                market={market}
                event={event}
                bets={bets}
                viewContext={viewContext}
                fancyBookExpandedMap={fancyBookExpandedMap}
                setFancyBookExpandedMap={setFancyBookExpandedMap}
                fancyBookModalMap={fancyBookModalMap}
                setFancyBookModalMap={setFancyBookModalMap}
              />
            </div>
          )}
        </MarketHeader>
      );
    }

    // Standard layout for other markets
    return (
      <MarketHeader
        market={market}
        isExpanded={isExpanded}
        onToggle={onToggle}
        betCount={betCount}
        exposure={exposure}
        liquidity={market.liquidity || 0}
      >
        {isExpanded && (
          <div className={styles.body}>
            {isMatchOdds ? (
              <MatchOddsLayout market={market} event={event} bets={bets} viewContext={viewContext} />
            ) : (
              <StandardMarketLayout
                market={market}
                event={event}
                bets={bets}
                viewContext={viewContext}
                fancyBookExpandedMap={fancyBookExpandedMap}
                setFancyBookExpandedMap={setFancyBookExpandedMap}
                fancyBookModalMap={fancyBookModalMap}
                setFancyBookModalMap={setFancyBookModalMap}
              />
            )}

            {/* Market Book Table - Only for exchange and bookmaker markets; the kit's flush bar under the prices */}
            {showBookTable && bets && bets.length > 0 && (
              <MarketBookTable
                market={market}
                bets={bets}
                isExpanded={isBookTableExpanded}
                onToggle={() => setIsBookTableExpanded(!isBookTableExpanded)}
                viewContext={viewContext}
              />
            )}
          </div>
        )}
      </MarketHeader>
    );
  },
  (prevProps, nextProps) => {
    // A price-only signature cannot represent new depth/status data or equal-count bet replacements.
    // Honor immutable input changes before using the cheap signature for otherwise identical props.
    if (prevProps.market !== nextProps.market) return false;
    if (prevProps.event !== nextProps.event) return false;
    if (prevProps.bets !== nextProps.bets) return false;
    if (prevProps.market?.id !== nextProps.market?.id) return false;
    if (prevProps.isExpanded !== nextProps.isExpanded) return false;
    if (prevProps.betCount !== nextProps.betCount) return false;
    if (prevProps.exposure !== nextProps.exposure) return false;
    if (prevProps.event?.id !== nextProps.event?.id) return false;
    if (prevProps.sharedBookViewContext !== nextProps.sharedBookViewContext) return false;
    const prevSig = prevProps.oddsSignature;
    const nextSig = nextProps.oddsSignature;
    // Require oddsSignature from parent; skip re-render only when both are defined and equal
    if (nextSig === undefined) return false;
    if (prevSig !== undefined && nextSig !== undefined) return prevSig === nextSig;
    return false;
  }
);
