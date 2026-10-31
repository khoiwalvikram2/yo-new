import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Stat } from '@/ui/components/Stat';
import { IconReceipt, IconCoins, IconWallet, IconShield, IconUsers } from '@tabler/icons-react';
import styles from './EventHead.module.css';
import { useQuery, useSubscription, gql } from "@apollo/client";
import { useCurrency } from "@/shared/core/CurrencyContext";
import { useCurrentWhitelabel } from "@/shared/core/useWhitelabels";
import { SUB_SPORTS_PLAYER_EVENTS } from "@/lib/graphql/sportsLive";

interface HeaderBet {
  id?: string; userId?: string | number | null; createdAt?: string | null
  eventId?: string | number | null; marketId?: string | number | null; side?: string | null
  stake?: number | string | null; liability?: number | string | null; price?: number | string | null
  oddsSize?: number | string | null; odds_size?: number | string | null; status?: string | null
}
interface HeaderMarket { id?: string | number | null; kind?: string | null; type?: string | null }
interface HeaderEvent { id?: string | number | null; betsCount?: number | null; totalStake?: number | null; totalLiability?: number | null; matchedVolume?: number | null; status?: string | null; inPlay?: boolean | null }

interface EventHeaderStatsSectionProps {
  event: HeaderEvent | undefined;
  liveData?: { totalStake?: number | null; totalLiability?: number | null };
  /** Optional map of market id -> market (kind/type) for correct Potential Payout by market type */
  marketsMap?: Record<string, HeaderMarket>;
}

const EVENT_BETS_STATS_QUERY = gql`
  query EventBetsStats($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      id
      userId
      eventId
      marketId
      side
      price
      stake
      liability
      oddsSize
      status
      createdAt
    }
  }
`;

export const EventHeaderStatsSection: React.FC<
  EventHeaderStatsSectionProps
> = ({
  event,
  liveData,
  marketsMap,
}) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { whitelabel } = useCurrentWhitelabel();
  const [betsCache, setBetsCache] = useState<HeaderBet[]>([]);
  /** The clock "in the last minute" counts against; it moves every 15 seconds. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // Query bets for this event to calculate stats (only for this event)
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  // This ensures proper filtering based on selected whitelabel in admin panel top bar
  const { data: betsData, refetch: refetchBets } = useQuery<{ sportsBets?: HeaderBet[] | null }>(EVENT_BETS_STATS_QUERY, {
    variables: {
      query: {
        eventId: event?.id || undefined, // Include eventId to filter server-side
        limit: 5000,
      },
    },
    skip: !event?.id,
    errorPolicy: "all",
    // CRITICAL: Use network-only to ensure fresh data when whitelabel changes
    fetchPolicy: "network-only",
  });

  // Subscribe to real-time bet events
  // Use whitelabel ID for both tenant and whitelabelId to ensure consistent filtering
  const scope = useMemo(
    () => ({
      tenant: whitelabel?.id || "default",
      whitelabelId: whitelabel?.id || "default",
    }),
    [whitelabel?.id]
  );

  const { data: playerEventData } = useSubscription<{ sportsPlayerEvents?: { eventId?: string | number | null } | null }>(SUB_SPORTS_PLAYER_EVENTS, {
    variables: { scope },
    skip: !event?.id,
    errorPolicy: "all",
  });

  // Update cache when event or query data changes
  // Bets are already filtered by eventId on server, no need to filter client-side
  useEffect(() => {
    if (!event?.id) {
      setBetsCache([]);
      return;
    }
    
    // Update cache when query data changes (bets are already filtered by eventId)
    if (betsData?.sportsBets && Array.isArray(betsData.sportsBets)) {
      setBetsCache(betsData.sportsBets);
    } else if (!betsData?.sportsBets) {
      // Clear cache if query data is not available
      setBetsCache([]);
    }
  }, [event?.id, betsData?.sportsBets]);

  // Throttle subscription updates to prevent excessive re-renders
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<boolean>(false);

  // Update cache when new bet event comes in (throttled to prevent glitches)
  useEffect(() => {
    if (!event?.id) return;
    
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const currentEventId = event.id; // Capture current event ID to avoid stale closure
    
    if (playerEventData?.sportsPlayerEvents) {
      const betEvent = playerEventData.sportsPlayerEvents;
      // Only process events for this event
      if (String(betEvent.eventId || '') === String(currentEventId || '')) {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateRef.current;
        const throttleDelay = 2000; // Throttle to max 1 update per 2 seconds
        
        // Skip if update is too soon or already pending
        if (timeSinceLastUpdate < throttleDelay || pendingUpdateRef.current) {
          return;
        }
        
        pendingUpdateRef.current = true;
        lastUpdateRef.current = now;
        
        // Debounce refetch to prevent too many updates
        timeoutId = setTimeout(() => {
          refetchBets().then((result) => {
            // Check if event hasn't changed during async operation
            if (!event?.id || String(event.id) !== String(currentEventId)) {
              pendingUpdateRef.current = false;
              return; // Event changed, ignore this result
            }
            // Update cache after refetch (bets are already filtered by eventId on server)
            if (result.data?.sportsBets && Array.isArray(result.data.sportsBets)) {
              setBetsCache(result.data.sportsBets);
            }
            pendingUpdateRef.current = false;
          }).catch(() => {
            pendingUpdateRef.current = false;
            // Silently handle errors
          });
        }, 1500); // Wait 1.5 seconds before refetching
      }
    }
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [playerEventData, event?.id, refetchBets]);

  // Potential payout per bet (platform pays if selection wins)
  // Exchange/Bookmaker: back = (stake * price) - stake, lay = stake
  // Fancy: back = (stake * odds_size) / 100, lay = liability
  const getPotentialPayout = useCallback((bet: HeaderBet, markets: Record<string, HeaderMarket> | undefined) => {
    const side = String(bet?.side || "").toLowerCase();
    const stake = Number(bet.stake) || 0;
    const liability = Number(bet.liability) || 0;
    const price = Number(bet.price) || 0;
    const oddsSize = Number(bet.oddsSize ?? bet.odds_size) || 0;
    const market = markets && (
      markets[bet.marketId ?? ''] ||
      markets[String(bet?.marketId)] ||
      markets[Number(bet?.marketId)] ||
      Object.values(markets).find((m) => m && (m.id === bet?.marketId || String(m.id) === String(bet?.marketId)))
    );
    const isFancy = market && (market.kind === "fancy" || market.type === "fancy");
    if (isFancy) {
      return side === "back" ? (stake * oddsSize) / 100 : liability;
    }
    return side === "back" ? stake * price - stake : stake;
  }, []);

  // Calculate stats from bets (already filtered by eventId on server)
  const stats = useMemo(() => {
    // Use query data if cache is empty or if we have fresh data
    const allBets = betsData?.sportsBets && Array.isArray(betsData.sportsBets) 
      ? betsData.sportsBets 
      : betsCache.length > 0 
        ? betsCache 
        : [];
    
    if (!Array.isArray(allBets) || allBets.length === 0) {
      return {
        betsCount: 0,
        totalStake: 0,
        totalLiability: 0,
        totalPotentialPayout: 0,
        netExposure: 0,
        openBets: [] as HeaderBet[],
      };
    }

    // Early return if no event ID
    if (!event?.id) {
      return {
        betsCount: 0,
        totalStake: 0,
        totalLiability: 0,
        totalPotentialPayout: 0,
        netExposure: 0,
        openBets: [] as HeaderBet[],
      };
    }
    
    // Bets are already filtered by eventId on server, no need to filter again
    // Include all matched bets (IP = In Play, which means matched)
    // Also include unmatched bets for complete stats
    const openBets: HeaderBet[] = [];
    for (let i = 0; i < allBets.length; i++) {
      const bet = allBets[i];
      if (!bet || !bet.status) continue;
      const status = String(bet.status || '').toLowerCase();
      if (status === 'matched' || status === 'unmatched') {
        openBets.push(bet);
      }
    }

    let totalStake = 0;
    let totalLiability = 0;
    let totalPotentialPayout = 0;
    let backLiability = 0;
    let layLiability = 0;

    // Use for loop for better performance
    for (let i = 0; i < openBets.length; i++) {
      const bet = openBets[i];
      const liability = Number(bet.liability) || 0;
      const side = bet.side;

      // Total wagered for sports = liability
      if (!isNaN(liability) && isFinite(liability)) {
        totalStake += liability;
        totalLiability += liability;
        if (marketsMap) {
          totalPotentialPayout += getPotentialPayout(bet, marketsMap);
        }

        // Only process valid sides
        if (side === "back") {
          backLiability += liability;
        } else if (side === "lay") {
          layLiability += liability;
        }
      }
    }

    const netExposure = backLiability - layLiability;

    return {
      betsCount: openBets.length,
      totalStake,
      totalLiability,
      totalPotentialPayout: marketsMap ? totalPotentialPayout : totalLiability,
      netExposure,
      openBets,
    };
  }, [betsCache, betsData?.sportsBets, event?.id, marketsMap, getPotentialPayout]);

  // The kit tiles' supporting lines: open bets placed in the last minute, and the players behind the open bets.
  const recentBets = useMemo(() => stats.openBets.filter((bet) => {
    const at = bet.createdAt ? Date.parse(bet.createdAt) : NaN;
    return Number.isFinite(at) && now - at <= 60000 && at <= now;
  }).length, [stats.openBets, now]);
  const playersCount = useMemo(() => new Set(stats.openBets.map((bet) => String(bet.userId ?? '')).filter(Boolean)).size, [stats.openBets]);

  // Use calculated stats, fallback to event data
  // Note: Use calculated stats if they exist (even if 0), only fallback if undefined
  const betsCount = stats.betsCount !== undefined ? stats.betsCount : (event?.betsCount || 0);
  const totalStake = stats.totalStake !== undefined ? stats.totalStake : (liveData?.totalStake ?? event?.totalStake ?? 0);
  const totalPotentialPayout = stats.totalPotentialPayout !== undefined ? stats.totalPotentialPayout : (liveData?.totalLiability ?? event?.totalLiability ?? 0);

  // Checked after the hooks: `event` arrives asynchronously, so returning above
  // the memo below would change hook count between renders.
  if (!event) return null;

  // Open back liability minus open lay liability; more backed than laid is the house's risk, so it reads red.
  const netExposure = stats.netExposure;
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value));
  // The kit's five tiles: Bets, Wagered (with the matched volume under it), Potential payout, Exposure, Players.
  return <div className={styles.statsFrame}>
    <div className={styles.stats} role="group" aria-label="Event statistics">
      <Stat label="Bets" value={betsCount.toLocaleString()} icon={<IconReceipt size={18} />} hue="amb" size="compact" tooltip="Open (matched and unmatched) bets on this event"
        delta={recentBets > 0 ? { value: recentBets.toLocaleString(), dir: 'up', note: 'in the last minute' } : undefined}
        note={recentBets > 0 ? undefined : 'None in the last minute'} />
      <Stat label="Wagered" value={fmt(totalStake)} icon={<IconCoins size={18} />} hue="grn" size="compact" tooltip="Total wagered amount from open bets"
        note={event.matchedVolume != null ? `Matched ${fmt(event.matchedVolume)}` : 'Open bets'} />
      <Stat label="Potential payout" value={fmt(totalPotentialPayout)} icon={<IconWallet size={18} />} hue="blu" size="compact" tooltip="Potential payout across open bets if selections win"
        note="If every open bet wins" />
      <Stat label="Exposure" value={<span className={netExposure > 0 ? styles.loss : undefined}>{fmt(netExposure)}</span>} icon={<IconShield size={18} />} hue="red" size="compact" tooltip="Open back liability minus open lay liability"
        note="Back minus lay liability" />
      <Stat label="Players" value={playersCount.toLocaleString()} icon={<IconUsers size={18} />} hue="vio" size="compact" tooltip="Players with an open bet on this event"
        note="With open bets" />
    </div>
  </div>;
};

