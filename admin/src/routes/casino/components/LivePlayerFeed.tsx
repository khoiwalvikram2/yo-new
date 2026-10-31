import clsx from 'clsx'
import React, { useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/ui/components/Button";
import { Dialog } from "@/ui/components/Dialog";
import { SearchField } from "@/ui/components/SearchField";
import { StatusPill } from "@/ui/components/StatusPill";
import { EmptyState } from "@/ui/components/EmptyState";
import { Notice } from "@/ui/components/Notice";
import styles from "../live-analysis/CasinoLive.module.css";
import type { CasinoBet } from '../live-analysis/casinoLiveModel';
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useFormatDate } from "@/shared/core/useFormatDate";
import { gql, useQuery } from "@apollo/client";
import { nowIST } from "@/shared/utils/date";

interface PlayerEvent {
  id: string;
  userId: string;
  userName?: string | null;
  gameId: string;
  gameName?: string | null;
  vendorName?: string | null;
  status: string;
  stake: number;
  payout?: number | null;
  at: string;
}

interface Props {
  latestEvent?: PlayerEvent;
  windowMins?: number;
  onBetsCountChange?: (count: number) => void;
}

const RECENT_BETS_QUERY = gql`
  query RecentCasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
      userId
      userName
      gameId
      gameName
      vendorName
      stake
      payout
      status
      createdAt
    }
  }
`;

export const LivePlayerFeed: React.FC<Props> = ({
  latestEvent,
  windowMins = 60,
  onBetsCountChange,
}) => {
  const { formatTime: formatTimeTz } = useFormatDate();
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const [items, setItems] = useState<PlayerEvent[]>([]);
  const [playerFilter, setPlayerFilter] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Track last processed event ID to avoid duplicates
  const lastEventIdRef = useRef<string | null>(null);

  // Stable dateFrom to avoid refetch loops
  const dateFrom = useMemo(
    () => nowIST().subtract(windowMins, "minute").toISOString(),
    [windowMins]
  );

  // Reset items when windowMins changes to allow refetch
  useEffect(() => {
    setItems([]);
    lastEventIdRef.current = null;
  }, [windowMins]);

  // Initial load: fetch recent bets to prefill feed
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: recentData, refetch: refetchRecent, loading: recentLoading, error: recentError } = useQuery(RECENT_BETS_QUERY, {
    variables: { query: { dateFrom, limit: 50 } },
    fetchPolicy: "network-only", // Always fetch fresh data
    notifyOnNetworkStatusChange: false,
    skip: !dateFrom, // Skip only if dateFrom is not ready
  });

  // Refetch when windowMins changes
  useEffect(() => {
    if (dateFrom) {
      // Ensure query runs when variables become available
      if (!recentData && !recentLoading) {
        refetchRecent({ query: { dateFrom, limit: 50 } });
      }
    }
  }, [dateFrom, recentData, recentLoading, refetchRecent]);

  useEffect(() => {
    if (recentData?.casinoBets?.length) {
      const recentEvents: PlayerEvent[] = recentData.casinoBets
        .map((b: CasinoBet) => ({
          id: String(b.id),
          userId: String(b.userId),
          userName: b.userName || null,
          gameId: String(b.gameId),
          gameName: b.gameName || null,
          vendorName: b.vendorName || null,
          status: String(b.status || "PENDING").toUpperCase(),
          stake: Number(b.stake || 0),
          payout: b.payout != null ? Number(b.payout) : null,
          at: b.createdAt || new Date().toISOString(),
        }))
        .sort((a: PlayerEvent, b: PlayerEvent) => (a.at < b.at ? 1 : -1))
        .slice(0, 50);
      setItems(recentEvents);
    } else if (recentData?.casinoBets && recentData.casinoBets.length === 0) {
      // Explicitly handle empty results
      setItems([]);
    }
  }, [recentData]);

  // Append live events as they arrive from subscription
  useEffect(() => {
    if (!latestEvent) {
      return;
    }

    // Generate stable ID if missing
    const eventId = latestEvent.id || `${latestEvent.userId}-${latestEvent.gameId}-${Date.now()}`;
    
    // Skip if this is the same event we just processed
    if (lastEventIdRef.current === eventId) {
      return;
    }
    
    lastEventIdRef.current = eventId;
    
    setItems((prev) => {
      // Check if event already exists in the list
      const exists = prev.some(item => item.id === eventId);
      if (exists) {
        return prev;
      }
      
      // Create new event object
      const newEvent: PlayerEvent = {
        id: eventId,
        userId: String(latestEvent.userId || ''),
        userName: latestEvent.userName || null,
        gameId: String(latestEvent.gameId || ''),
        gameName: latestEvent.gameName || null,
        vendorName: latestEvent.vendorName || null,
        status: String(latestEvent.status || "PENDING").toUpperCase(),
        stake: Number(latestEvent.stake || 0),
        payout: latestEvent.payout != null ? Number(latestEvent.payout) : null,
        at: latestEvent.at || new Date().toISOString(),
      };
      
      // Add to beginning of list
      const next = [newEvent, ...prev];
      
      // De-duplicate by id and keep only latest 100
      const dedup = [] as PlayerEvent[];
      const seen = new Set<string>();
      for (const e of next) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        dedup.push(e);
        if (dedup.length >= 100) break;
      }
      
      return dedup;
    });
  }, [latestEvent]);

  const fmt = (n?: number | null) =>
    n != null ? formatAmount(convertFromWhitelabelCurrency(Number(n))) : "—";

  const formatTimeRelativeOrTz = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return formatTimeTz(dateStr, "HH:mm");
  };

  const formatProperTime = (dateStr: string) => {
    return formatTimeTz(dateStr, "h:mm a");
  };

  // Filter items by player name or game name
  const filteredItems = useMemo(() => {
    if (!playerFilter.trim()) return items;
    const filterLower = playerFilter.toLowerCase().trim();
    return items.filter((e) => {
      const userName = (e.userName || `User #${e.userId}`).toLowerCase();
      const gameName = (e.gameName || e.gameId || '').toLowerCase();
      return userName.includes(filterLower) || gameName.includes(filterLower);
    });
  }, [items, playerFilter]);

  // Notify parent of bets count change
  useEffect(() => {
    if (onBetsCountChange) {
      onBetsCountChange(filteredItems.length);
    }
  }, [filteredItems.length, onBetsCountChange]);

  // Kit feed rows (.ev-bet): game, provider and time; stake, payout and net; the player, when, and the result.
  const renderFeedContent = () => <div className={styles.actList} aria-label="Live activity events">
    {!filteredItems.length ? <EmptyState title={playerFilter ? "No matching activities" : "No activity yet"} description={playerFilter ? "Try a different search" : "Waiting for events..."} /> : filteredItems.map((event, index) => {
      const isNew = index === 0 && latestEvent?.id === event.id;
      const netAmount = event.payout != null && event.payout > 0 ? event.payout - event.stake : 0;
      const status = String(event.status || "");
      return <article key={event.id} className={clsx(styles.actItem, isNew && styles.actNew)}>
        <div className={styles.actTop}><b className={styles.actGame} title={event.gameName || event.gameId}>{event.gameName || event.gameId}</b>{event.vendorName && <span className={styles.actVendor} title={event.vendorName}>{event.vendorName}</span>}<time className={styles.actTime} dateTime={event.at}>{formatProperTime(event.at)}</time></div>
        <div className={styles.actNums}><span>Stake <b>{fmt(event.stake)}</b></span>{event.payout != null && event.payout > 0 && <><span>Payout <b>{fmt(event.payout)}</b></span><span>Net <b className={netAmount > 0 ? styles.positive : styles.negative}>{netAmount > 0 ? "+" : ""}{fmt(netAmount)}</b></span></>}</div>
        <div className={styles.actFoot}><span className={styles.actPlayer}>{event.userName || `User #${event.userId}`}</span><span className={styles.muted}>{formatTimeRelativeOrTz(event.at)}</span>
          <StatusPill className={styles.actStatus} status={status}>{["WON", "LOST", "PENDING"].includes(status.toUpperCase()) ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : status}</StatusPill></div>
      </article>;
    })}
  </div>;
  const summary = filteredItems.length > 0 ? `${filteredItems.length} ${playerFilter ? "filtered" : ""} activities` : "No activities";
  return <div className={styles.act}>
    <div className={styles.actTools}><SearchField className={styles.actSearch} label="Search player or game" placeholder="Player or game" value={playerFilter} onChange={setPlayerFilter} size="sm" /><Button size="sm" onClick={() => setIsExpanded(true)}>Expand view</Button></div>
    {recentError && <Notice tone="error" action={<Button size="sm" onClick={() => void refetchRecent()}>Retry</Button>}>{recentError.message}</Notice>}
    {renderFeedContent()}
    <div className={styles.actSummary}><span className={styles.muted}>{summary}</span>{filteredItems.length > 0 && <span className={styles.muted}>{formatTimeRelativeOrTz(filteredItems[0]?.at || "")}</span>}</div>
    <Dialog open={isExpanded} onOpenChange={setIsExpanded} title="Live Activity Feed" description="Real-time feed - Expanded view" size="lg">
      <div className={styles.stack}><SearchField label="Search expanded activities" placeholder="Player or game" value={playerFilter} onChange={setPlayerFilter} />{renderFeedContent()}<div className={styles.actSummary}><span className={styles.muted}>{summary}</span>{filteredItems.length > 0 && <span className={styles.muted}>Latest: {formatTimeRelativeOrTz(filteredItems[0]?.at || "")}</span>}</div></div>
    </Dialog>
  </div>;
};
