import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, Clock, Radio, Search, Ticket, Trophy, X } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { formatStart } from "../components/sports/utils";
import type { EventItem, SportType } from "@/types";
import { useSportsEvents, storedToEvent, generateEventId } from "@/lib/sportsHelpers";
import { getSportsList, getUserBets } from '@/lib/api/user'
import { useAuth } from '@/lib/auth'
import { useFeatureFlags, useSportsIconStyle } from '@/hooks/useAppSettings'
import { formatAmount } from '@/lib/currency'
import { useOddsSocket } from '@/lib/hooks/useOddsSocket'
import { usePageSEO } from '../hooks/usePageSEO'
import ModalSurface from '../components/modals/ModalSurface'
import SportTabBar from '../components/nova/exchange-home/SportTabBar'
import SectionHeader from '../components/nova/exchange-home/SectionHeader'
import { LiveMatchRow } from '../components/nova/exchange-home/MatchCard'
import { ALL_TAB, IN_PLAY_TAB, eventUrl, isStale, rankSport, sportIcon, sportIconClass, sportTitle, waysFor, type SportTab } from '../components/nova/exchange-home/exchangeShared'
import { ALL_SPORTS_SIDEBAR } from '../components/sports/allSportsList'
import '../components/nova/exchange-home/nova-exchange-home.css'

type TimeFilter = 'all' | 'in-play' | 'today' | 'tomorrow'
type EventGroup = { key: string; title: string; sport: string; events: EventItem[] }
/** Every sport is a tab (owner 2026-11-01); one the backend does not list as active opens "Coming soon". */
const SPORT_CATALOGUE = ALL_SPORTS_SIDEBAR.map(sport => sport.key);

export default function SportsPage() {
  const iconStyle = useSportsIconStyle()
  usePageSEO({
    title: 'Sports',
    description: 'Bet on live sports events and get the best odds'
  })
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user, isAuthenticated, isHydrating, openAuthModal } = useAuth();
  const features = useFeatureFlags();
  const userId = user?.id;
  const [activeTab, setActiveTab] = useState<TimeFilter>("in-play");
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetMode, setSheetMode] = useState<"bookmarked" | "recent">("recent");
  // One bookmarks hook for the whole page: it fetches the server list on mount.
  const { bookmarkedEvents, cleanupBookmarks, toggleBookmark } = useSportsEvents();

  const [allEvents, setAllEvents] = useState<EventItem[]>([]);
  // Sports the backend lists (admin status active), with or without events.
  const [activeSports, setActiveSports] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" after a failed load; the events request below runs again.
  const [reloadKey, setReloadKey] = useState(0);
  const [serverBets, setServerBets] = useState<Awaited<ReturnType<typeof getUserBets>>['data']>([]);
  const [betsLoading, setBetsLoading] = useState(false);
  const [betsError, setBetsError] = useState(false);
  const betsRequestId = useRef(0);
  const betsInFlightRequest = useRef<number | null>(null);
  // The existing cards expect populated event/side fields. Adapt the real flat
  // UserBets response without changing stake, odds, P/L or the API contract.
  const activeBets = useMemo(() => serverBets.map(bet => {
    const event = allEvents.find(item => item.eventId === bet.eventId);
    return {
      ...bet,
      _id: bet.id,
      selectionType: bet.side || bet.type,
      eventId: { id: bet.eventId, name: bet.eventName || event?.eventName || bet.eventId, date: bet.createdAt },
      leagueId: { name: event?.league || '' },
      sportId: { name: event?.sport || '' },
    };
  }), [serverBets, allEvents]);
  const [showBetsModal, setShowBetsModal] = useState<boolean>(false);

  const normalizeSportKey = (raw?: string) => {
    const s = (raw || '').toLowerCase().trim();
    // prefer slug-like formatting
    let key = s.replace(/_/g, '-').replace(/\s+/g, '-');
    // alias mapping
    if (key === 'soccer') key = 'football';
    if (key === 'e-sports') key = 'esports';
    if (key === 'ice-hockey' || key === 'icehockey') key = 'ice-hockey';
    if (key === 'horse-racing' || key === 'horse-race' || key === 'horse') key = 'horseracing';
    if (key === 'greyhound-racing' || key === 'greyhound') key = 'greyhoundracing';
    return key;
  };

  const { selectedSport, selectedLeague } = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return { selectedSport: (params.get('sport') || '').toLowerCase(), selectedLeague: params.get('league') || '' };
  }, [location.search]);

  // Keep the time filter in sync with the sport tab
  useEffect(() => {
    setActiveTab(selectedSport === 'live' ? 'in-play' : 'all');
  }, [selectedSport]);

  // Build a list of market codes and bookmaker channels to determine in-play status via one-shot odds snapshot
  const marketCodeToEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEvents) {
      if (e.primaryMarketCode && (e.eventId || e.eventName)) {
        map.set(e.primaryMarketCode, e.eventId || e.eventName);
      }
    }
    return map;
  }, [allEvents]);
  // The odds socket keys bookmaker channels by the feed event id (eventCode), not the DB id.
  const eventCodeToEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEvents) {
      if (e.eventCode && (e.eventId || e.eventName)) map.set(e.eventCode, e.eventId || e.eventName);
    }
    return map;
  }, [allEvents]);

  const oddsChannelsForLive = useMemo(() => {
    const codes: string[] = [];
    for (const e of allEvents) {
      if (e.primaryMarketCode) codes.push(e.primaryMarketCode);
      if (e.eventCode) codes.push(`bookmaker-${e.eventCode}`);
    }
    // de-duplicate
    return Array.from(new Set(codes));
  }, [allEvents]);

  const oddsSnapshot = useOddsSocket(oddsChannelsForLive, { once: true });

  const liveEventIds = useMemo(() => {
    const live = new Set<string>();
    const isLiveOdds = (payload: any): boolean => {
      if (!payload) return false;
      const status = String((payload as any)?.status || (payload as any)?.marketStatus || '').toLowerCase();
      const inplay = Boolean((payload as any)?.inplay || (payload as any)?.inPlay);
      // Consider live only when explicitly inplay and market is open/active (parity with ibf-goa-user)
      return inplay && /(^|\b)(open|active)(\b|$)/.test(status);
    };
    // Check exchange markets
    for (const [code, payload] of Object.entries(oddsSnapshot as Record<string, any>)) {
      let eventKey: string | undefined;
      if (code.startsWith('bookmaker-')) {
        eventKey = eventCodeToEventId.get(code.replace('bookmaker-', ''));
      } else {
        eventKey = marketCodeToEventId.get(code);
      }
      if (!eventKey) continue;
      const p = (payload && (payload as any).data) ? (payload as any).data : payload;
      if (isLiveOdds(p)) live.add(eventKey);
    }
    return live;
  }, [oddsSnapshot, marketCodeToEventId, eventCodeToEventId]);

  const filteredEvents = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    return allEvents
      .map((event) => {
        const liveBySocket = liveEventIds.has(event.eventId || event.eventName)
        return {
          ...event,
          // Prefer socket signal; fallback to precomputed isLive from API/markets
          isLive: liveBySocket || Boolean(event.isLive),
        }
      })
      .filter((event) => {
        if (isStale(event)) return false;
        // If a specific sport (not 'live') is selected, limit to that sport
        if (selectedSport && selectedSport !== 'live' && event.sport !== selectedSport) return false;

        const eventDate = new Date(event.startISO);
        const isToday = eventDate >= todayStart && eventDate < tomorrowStart;
        const isTomorrow = eventDate >= tomorrowStart && eventDate < tomorrowEnd;

        // When 'Live' is selected in the sport tabs, the time filter still constrains to live events
        const constrainToLive = selectedSport === 'live';

        if (activeTab === "in-play") return Boolean(event.isLive);
        if (activeTab === "today") return constrainToLive ? (event.isLive && isToday) : isToday;
        if (activeTab === "tomorrow") return constrainToLive ? (event.isLive && isTomorrow) : isTomorrow;
        return constrainToLive ? Boolean(event.isLive) : true;
      })
      // In play first, then by scheduled start time
      .sort((a, b) => Number(Boolean(b.isLive)) - Number(Boolean(a.isLive)) || new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
  }, [activeTab, allEvents, selectedSport, liveEventIds]);

  const searchFilteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return filteredEvents;
    const q = searchQuery.trim().toLowerCase();
    return filteredEvents.filter(
      (e) =>
        (e.eventName && e.eventName.toLowerCase().includes(q)) ||
        (e.league && e.league.toLowerCase().includes(q))
    );
  }, [filteredEvents, searchQuery]);

  // League chips for a single sport, counted before the league itself is applied.
  const leagues = useMemo(() => {
    if (!selectedSport || selectedSport === 'live') return [];
    const counts = new Map<string, number>();
    for (const e of searchFilteredEvents) counts.set(e.league, (counts.get(e.league) || 0) + 1);
    if (selectedLeague && !counts.has(selectedLeague)) counts.set(selectedLeague, 0);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [searchFilteredEvents, selectedSport, selectedLeague]);

  const visibleEvents = useMemo(
    () => selectedLeague ? searchFilteredEvents.filter(e => e.league === selectedLeague) : searchFilteredEvents,
    [searchFilteredEvents, selectedLeague],
  );

  // All sports or in-play: one section per sport. A single sport: one section per league.
  const groups = useMemo<EventGroup[]>(() => {
    const bySport = !selectedSport || selectedSport === 'live';
    const map = new Map<string, EventGroup>();
    for (const e of visibleEvents) {
      const key = bySport ? (e.sport || 'other') : (e.league || 'Other');
      if (!map.has(key)) map.set(key, { key, title: bySport ? sportTitle(key) : key, sport: e.sport, events: [] });
      map.get(key)!.events.push(e);
    }
    const list = [...map.values()];
    return bySport
      ? list.sort((a, b) => rankSport(a.key) - rankSport(b.key) || b.events.length - a.events.length)
      : list.sort((a, b) => b.events.length - a.events.length || a.title.localeCompare(b.title));
  }, [visibleEvents, selectedSport]);

  // If Live is selected but in-play list is empty (likely no WS snapshot available), fall back to 'All'
  useEffect(() => {
    if (selectedSport === 'live' && activeTab === 'in-play' && filteredEvents.length === 0 && allEvents.length > 0) {
      setActiveTab('all');
    }
  }, [selectedSport, activeTab, filteredEvents.length, allEvents.length]);

  const dynamicRecentEvents = useMemo(() => {
    // Recent shows events where the user placed bets (open bets)
    const mapped: EventItem[] = activeBets.map((bet: any) => {
      const sport = (bet?.sportId?.slugName || bet?.sportId?.name || 'football').toLowerCase();
      const league = bet?.leagueId?.name || bet?.leagueId?.slugName || 'League';
      const eventName = bet?.eventId?.name || bet?.eventId?.slugName || 'Event';
      const eventId = String(bet?.eventId?._id || bet?.eventId?.id || '');
      const dateISO = bet?.eventId?.date ? new Date(bet.eventId.date).toISOString() : new Date().toISOString();
      return {
        eventId,
        sport: sport as any,
        eventName,
        league,
        startISO: dateISO,
        runners: [ { name: 'Home' }, { name: 'Draw' }, { name: 'Away' } ],
        isLive: false,
      };
    });
    const dedup = new Map<string, EventItem>();
    for (const e of mapped) {
      const key = e.eventId || `${e.eventName}|${e.startISO}`;
      if (!dedup.has(key)) dedup.set(key, e);
    }
    return Array.from(dedup.values()).sort((a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime());
  }, [activeBets]);

  // Enrich stored events with actual event data from allEvents when available
  const enrichStoredEvents = useMemo(() => {
    const eventMap = new Map<string, EventItem>();
    for (const e of allEvents) {
      if (e.eventId) eventMap.set(e.eventId, e);
      // Also index by eventName for fallback matching
      if (e.eventName) eventMap.set(e.eventName, e);
    }
    return eventMap;
  }, [allEvents]);

  const rightBookmarkedEvents = useMemo(() => {
    return bookmarkedEvents.map(stored => {
      const converted = storedToEvent(stored);
      // Enrich with actual event data if available
      const enriched = enrichStoredEvents.get(converted.eventId || '') || enrichStoredEvents.get(converted.eventName || '');
      return enriched ? { ...converted, ...enriched } : converted;
    });
  }, [bookmarkedEvents, enrichStoredEvents]);

  const rightRecentEvents = useMemo(() => {
    // Recent events should only show events where user has placed bets
    const enriched = dynamicRecentEvents.map(e => {
      const enrichedEvent = enrichStoredEvents.get(e.eventId || '') || enrichStoredEvents.get(e.eventName || '');
      return enrichedEvent ? { ...e, ...enrichedEvent } : e;
    });
    const seen = new Map<string, EventItem>();
    for (const e of enriched) {
      const key = e.eventId || `${e.eventName}|${e.startISO}`;
      if (!seen.has(key)) seen.set(key, e);
    }
    return Array.from(seen.values());
  }, [dynamicRecentEvents, enrichStoredEvents]);

  // Stored bookmarks carry the name slug and, when known, the backend event id.
  const bookmarkKeys = useMemo(
    () => new Set(bookmarkedEvents.flatMap(b => [b.id, b._eventId].filter((value): value is string => Boolean(value)))),
    [bookmarkedEvents],
  );
  const isBookmarkedEvent = (e: EventItem) => bookmarkKeys.has(generateEventId(e.eventName)) || Boolean(e.eventId && bookmarkKeys.has(e.eventId));

  useEffect(() => {
    // Fetch sports data and map to EventItem[]
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await getSportsList();
        const sports: any[] = Array.isArray(res?.data) ? res.data : [];
        const events: EventItem[] = [];
        for (const sport of sports) {
          const sportName: string = normalizeSportKey((sport?.slugName || sport?.name || '').toString());
          const leagues: any[] = Array.isArray(sport?.leagues) ? sport.leagues : [];
          for (const lg of leagues) {
            const leagueName: string = (lg?.name || lg?.slugName || '').toString();
            const lgEvents: any[] = Array.isArray(lg?.events) ? lg.events : [];
            for (const ev of lgEvents) {
              // Normalize to ISO to avoid timezone mismatches between list and detail pages
              const start = (() => {
                try { return ev?.date ? new Date(ev.date).toISOString() : new Date().toISOString() } catch { return String(ev?.date || new Date().toISOString()) }
              })();

              // Try to find the primary market ("Match Odds")
              let primaryMarketCode: string | undefined = undefined;
              let initialIsLive: boolean = false;
              try {
                const markets: any[] = Array.isArray(ev?.markets) ? ev.markets : [];
                const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
                const isBookOrFancy = (m: any) => /book|fancy/.test(normalize(m?.type)) || /bookmaker/.test(normalize(m?.marketName));

                // Priority synonyms for primary (exchange) market
                const synonymTests = [
                  (m: any) => normalize(m?.marketName) === 'match odds',
                  (m: any) => /\b1x2\b/.test(normalize(m?.marketName)),
                  (m: any) => /full\s*time\s*result/.test(normalize(m?.marketName)),
                  (m: any) => /match\s*result/.test(normalize(m?.marketName)),
                  (m: any) => /money\s*line|moneyline/.test(normalize(m?.marketName)),
                ];

                let primary = undefined as any;
                for (const test of synonymTests) {
                  primary = markets.find((m: any) => test(m));
                  if (primary) break;
                }
                // Fallback: first non-book/fancy market
                if (!primary) primary = markets.find((m: any) => !isBookOrFancy(m));

                primaryMarketCode = primary?.marketId || primary?._id;

                // Derive a best-effort initial live flag when socket snapshot is not yet available
                const liveFromEvent = (() => {
                  const raw = (ev as any);
                  // Direct flags
                  const direct = raw?.inplay ?? raw?.inPlay ?? raw?.live ?? raw?.isLive;
                  if (typeof direct === 'boolean') return direct as boolean;
                  // String status
                  const s = String(raw?.status || '').toLowerCase();
                  if (/(^|\b)(live|inplay|running)(\b|$)/.test(s)) return true;
                  return false;
                })();
                const liveFromMarkets = markets.some((m: any) => {
                  const ip = Boolean((m as any)?.inplay || (m as any)?.inPlay);
                  const statusStr = normalize((m as any)?.status || (m as any)?.marketStatus);
                  const open = /(^|\b)(open|active)(\b|$)/.test(statusStr);
                  return ip && open;
                });
                // Deep scan on unknown shapes
                const deepHasInplayTrue = (node: any, depth = 0): boolean => {
                  if (!node || depth > 3) return false;
                  if (Array.isArray(node)) return node.some(n => deepHasInplayTrue(n, depth + 1));
                  if (typeof node === 'object') {
                    const v1 = (node as any)?.inplay ?? (node as any)?.inPlay ?? (node as any)?.isLive ?? (node as any)?.live;
                    if (v1 === true) return true;
                    const st = String((node as any)?.status || (node as any)?.marketStatus || '').toLowerCase();
                    if (/(^|\b)(live|inplay|running)(\b|$)/.test(st)) return true;
                    return Object.values(node).some(val => deepHasInplayTrue(val, depth + 1));
                  }
                  return false;
                }

                const liveFromDeep = deepHasInplayTrue(ev);

                // Time heuristic as last resort: consider events started within last 6 hours as live
                const liveFromTime = (() => {
                  try {
                    const startMs = new Date(start).getTime();
                    if (!Number.isFinite(startMs)) return false;
                    const now = Date.now();
                    const SIX_HOURS = 6 * 3600 * 1000;
                    return startMs <= now && now - startMs < SIX_HOURS;
                  } catch { return false }
                })();

                initialIsLive = liveFromEvent || liveFromMarkets || liveFromDeep || liveFromTime;
              } catch { /* ignore malformed market data */ }

              events.push({
                eventId: String(ev?._id || ev?.id || ''),
                eventCode: ev?.eventCode ? String(ev.eventCode) : undefined,
                sport: (sportName || 'football') as any,
                eventName: (ev?.name || ev?.slugName || 'Event').toString(),
                league: leagueName || 'League',
                startISO: start,
                isLive: initialIsLive,
                primaryMarketCode,
                runners: [
                  { name: 'Home' },
                  { name: 'Draw' },
                  { name: 'Away' },
                ],
              });
            }
          }
        }
        setAllEvents(events);
        setActiveSports(new Set(sports.map(sport => normalizeSportKey((sport?.slugName || sport?.name || '').toString())).filter(Boolean)));

        // Clean up stale bookmarks for events no longer in the current data
        cleanupBookmarks(events);
      } catch (_e) {
        setError('Failed to load sports data');
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  // Group active bets by event for the open-bets panel
  const groupedActiveBets = useMemo(() => {
    const groups = new Map<string, { name: string; items: any[]; eventId?: string; sportKey?: string }>();
    for (const bet of activeBets) {
      const evIdVal = String(bet.eventId.id || bet.eventName || "");
      const evName = bet.eventId.name || bet.eventName || "Event";
      const sportKey = bet.sportId.name.toLowerCase();
      const key = evIdVal || `${evName}`;
      if (!groups.has(key)) groups.set(key, { name: evName, items: [], eventId: evIdVal || undefined, sportKey });
      const g = groups.get(key)!;
      g.items.push(bet);
      if (!g.sportKey && sportKey) g.sportKey = sportKey;
      if (!g.eventId && evIdVal) g.eventId = evIdVal;
    }
    return Array.from(groups.entries()).map(([eventKey, value]) => ({ eventKey, name: value.name, items: value.items, eventId: value.eventId, sportKey: value.sportKey }));
  }, [activeBets]);

  const refreshBets = useCallback(async () => {
    if (!isAuthenticated || isHydrating || !features.sportsEnabled) return;
    if (betsInFlightRequest.current === betsRequestId.current) return;
    const currentRequest = ++betsRequestId.current;
    betsInFlightRequest.current = currentRequest;
    setBetsLoading(true);
    setBetsError(false);
    try {
      const response = await getUserBets({ openOnly: true });
      if (currentRequest !== betsRequestId.current) return;
      if (response?.meta?.code !== 200 || !Array.isArray(response.data)) throw new Error('Unavailable bets');
      setServerBets(response.data.filter(bet => ['matched', 'unmatched', 'pending', 'open'].includes((bet.status || '').toLowerCase())));
    } catch {
      if (currentRequest !== betsRequestId.current) return;
      setServerBets([]);
      setBetsError(true);
    } finally {
      if (betsInFlightRequest.current === currentRequest) betsInFlightRequest.current = null;
      if (currentRequest === betsRequestId.current) setBetsLoading(false);
    }
  }, [isAuthenticated, isHydrating, features.sportsEnabled, userId]);

  useEffect(() => {
    setServerBets([]);
    setBetsError(false);
    setShowBetsModal(false);
    if (!isAuthenticated || isHydrating || !features.sportsEnabled) {
      ++betsRequestId.current;
      setBetsLoading(false);
      return;
    }
    void refreshBets();
    // Existing placement/update events now refresh authoritative current-user
    // bets, rather than fabricating random IDs from device-wide local storage.
    const onUpdate = () => { void refreshBets() };
    window.addEventListener('stakex:my-bets:update', onUpdate);
    window.addEventListener('stakex:bet-placed', onUpdate);
    return () => {
      ++betsRequestId.current;
      window.removeEventListener('stakex:my-bets:update', onUpdate);
      window.removeEventListener('stakex:bet-placed', onUpdate);
    };
  }, [refreshBets, isAuthenticated, isHydrating, features.sportsEnabled]);

  const countsByKey = useMemo(() => {
    const counts: Record<string, number> = {};
    // Same visibility rule as the list: in play by socket or API, and not a finished leftover.
    const listed = allEvents
      .map(e => ({ ...e, isLive: liveEventIds.has(e.eventId || e.eventName) || Boolean(e.isLive) }))
      .filter(e => !isStale(e));
    for (const e of listed) {
      const key = normalizeSportKey(e.sport) || '';
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    counts['live'] = listed.filter(e => e.isLive).length;
    counts['all'] = listed.length;
    return counts;
  }, [allEvents, liveEventIds]);

  const sportTabs = useMemo<SportTab[]>(() => {
    const keys = new Set([...SPORT_CATALOGUE, ...activeSports]);
    if (selectedSport && selectedSport !== 'live') keys.add(selectedSport);
    const catalogueIndex = (key: string) => { const index = SPORT_CATALOGUE.indexOf(key); return index < 0 ? SPORT_CATALOGUE.length : index };
    // Active sports first, then the coming-soon ones in catalogue order.
    const ordered = [...keys].sort((a, b) => Number(!activeSports.has(a)) - Number(!activeSports.has(b))
      || rankSport(a) - rankSport(b) || (countsByKey[b] || 0) - (countsByKey[a] || 0) || catalogueIndex(a) - catalogueIndex(b));
    return [
      { key: ALL_TAB, label: t('nova.allSports'), count: countsByKey.all || 0 },
      { key: IN_PLAY_TAB, label: t('nova.inPlay'), count: countsByKey.live || 0 },
      ...ordered.map(key => ({ key, label: sportTitle(key), count: countsByKey[key] || 0, sport: key as SportType })),
    ];
  }, [countsByKey, activeSports, selectedSport, t]);
  // A failed load has no counts to show: dashes, as while loading, never a made-up zero.
  const failed = !loading && Boolean(error) && allEvents.length === 0;
  const singleSport = Boolean(selectedSport) && selectedSport !== 'live';
  const comingSoon = !loading && !failed && singleSport && !activeSports.has(selectedSport);
  const activeSportTab = !selectedSport ? ALL_TAB : selectedSport === 'live' ? IN_PLAY_TAB : selectedSport;
  const selectSportTab = (key: string) => {
    navigate({ pathname: '/sports', search: key === ALL_TAB ? '' : `?sport=${key === IN_PLAY_TAB ? 'live' : key}` });
  };
  const selectLeague = (league: string) => {
    const params = new URLSearchParams(location.search);
    if (league) params.set('league', league); else params.delete('league');
    navigate({ pathname: '/sports', search: params.toString() }, { replace: true });
  };

  const pageTitle = selectedSport === 'live'
    ? t('nova.inPlay')
    : selectedSport ? sportTitle(selectedSport) : t('nova.sportsExchange');
  const titleIcon = selectedSport && selectedSport !== 'live' ? sportIcon(selectedSport, iconStyle) : undefined;
  const timeFilters: { key: TimeFilter; label: string }[] = [
    { key: 'all', label: t('sportsPage.all', { defaultValue: 'All' }) },
    { key: 'in-play', label: t('nova.inPlay') },
    { key: 'today', label: t('exchangeHome.today', { defaultValue: 'Today' }) },
    { key: 'tomorrow', label: t('exchangeHome.tomorrow', { defaultValue: 'Tomorrow' }) },
  ];
  const sideEvents = sheetMode === "bookmarked" ? rightBookmarkedEvents : rightRecentEvents;

  return (
    <div className="nova-ex-grid nova-sx">
      <div className="nova-ex-main">
        <header className="nova-ex-section-head nova-sx-head" data-page-header="title-only">
          {titleIcon ? <img src={titleIcon} alt="" className={sportIconClass(selectedSport ?? '', iconStyle)} /> : selectedSport === 'live' ? <Radio className="nova-ex-strip-icon" aria-hidden="true" /> : <Trophy className="nova-ex-strip-icon" aria-hidden="true" />}
          <h1>{pageTitle}{selectedLeague && <small> · {selectedLeague}</small>}</h1>
          <span className="nova-ex-section-count">{loading || failed ? '–' : visibleEvents.length}</span>
        </header>

        <SportTabBar tabs={sportTabs} active={activeSportTab} onSelect={selectSportTab} loading={loading || failed} controls="nova-sx-events" />

        {!comingSoon && <div className="nova-sx-filters">
          <div className="nova-sx-time" role="group" aria-label={t('sportsPage.filterByTime', { defaultValue: 'Filter by time' })}>
            {timeFilters.map(filter => <button
              key={filter.key}
              type="button"
              className={activeTab === filter.key ? 'active' : ''}
              aria-pressed={activeTab === filter.key}
              aria-controls="nova-sx-events"
              onClick={() => setActiveTab(filter.key)}
            >{filter.label}</button>)}
          </div>
          <label className="nova-sx-search">
            <Search aria-hidden="true" />
            <span className="sr-only">{t('sportsPage.searchEvents', { defaultValue: 'Search events' })}</span>
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder={t('sportsPage.searchPlaceholder', { defaultValue: 'Search teams or leagues…' })}
            />
          </label>
        </div>}

        {!comingSoon && (leagues.length > 1 || selectedLeague) ? (
          <div className="nova-sx-leagues" role="group" aria-label={t('sportsPage.leagues', { defaultValue: 'Leagues' })}>
            <button type="button" className={!selectedLeague ? 'active' : ''} aria-pressed={!selectedLeague} onClick={() => selectLeague('')}>
              {t('sportsPage.allLeagues', { defaultValue: 'All leagues' })}
            </button>
            {leagues.map(([league, count]) => <button
              key={league}
              type="button"
              className={selectedLeague === league ? 'active' : ''}
              aria-pressed={selectedLeague === league}
              onClick={() => selectLeague(selectedLeague === league ? '' : league)}
            >{league}<small>{count}</small></button>)}
          </div>
        ) : null}

        <div id="nova-sx-events" className="nova-ex-games-list">
          {loading ? (
            <div className="nova-sx-rows" aria-busy="true">{[0, 1, 2, 3, 4].map(index => <div key={index} className="nova-sx-row is-skeleton"><i /><i /><i /></div>)}</div>
          ) : failed ? (
            <div className="nova-ex-empty" role="alert">
              <strong>{t('nova.eventLoadError')}</strong>
              <button type="button" onClick={() => setReloadKey(key => key + 1)}>{t('nova.tryAgain')}</button>
            </div>
          ) : comingSoon ? (
            <div className="nova-ex-empty" role="status">
              <strong>{t('sportsPage.comingSoon', { defaultValue: 'Coming soon' })}</strong>
              <p>{t('sportsPage.comingSoonBody', { sport: sportTitle(selectedSport), defaultValue: '{{sport}} betting opens here soon. Check back later.' })}</p>
              <button type="button" onClick={() => selectSportTab(ALL_TAB)}>{t('nova.allSports')}</button>
            </div>
          ) : !countsByKey.all || (singleSport && !countsByKey[selectedSport]) ? (
            <div className="nova-ex-empty" role="status"><strong>{t('nova.noUpcoming')}</strong></div>
          ) : groups.length === 0 ? (
            <div className="nova-ex-empty" role="status">
              <strong>{activeTab === 'in-play' ? t('exchangeHome.noInPlay', { defaultValue: 'No in-play events right now' }) : t('nova.noFilterMatches')}</strong>
              <button type="button" onClick={() => { setSearchQuery(''); setActiveTab('all'); if (selectedLeague) selectLeague(''); }}>{t('nova.resetFilters')}</button>
            </div>
          ) : groups.map(group => {
            const icon = sportIcon(group.sport, iconStyle);
            // Every row in a group is the same sport, so one set of column labels fits all of them.
            const ways = waysFor(group.sport);
            return <section key={group.key} className="nova-sx-group" aria-labelledby={`nova-sx-group-${group.key}`}>
              <SectionHeader className="nova-sx-group-head" icon={icon && <img src={icon} alt="" className={sportIconClass(group.sport, iconStyle)} />} titleId={`nova-sx-group-${group.key}`} title={group.title} count={group.events.length}>
                {ways > 0 && <span className={`nova-sx-cols ways-${ways}`} aria-hidden="true">
                  {(ways === 3 ? ['1', 'X', '2'] : ['1', '2']).map(label => <span key={label}>{label}</span>)}
                </span>}
              </SectionHeader>
              <div className="nova-sx-rows">
                {group.events.map(event => <LiveMatchRow
                  key={event.eventId || `${event.sport}|${event.eventName}|${event.startISO}`}
                  event={event}
                  ways={ways}
                  bookmark={{ active: isBookmarkedEvent(event), onToggle: () => { void toggleBookmark(event) } }}
                />)}
              </div>
            </section>;
          })}
        </div>
      </div>

      <aside className="nova-ex-side nova-sx-side" aria-label={t('nova.yourSports')}>
        <section className="nova-ex-widget" aria-labelledby="nova-sx-bets-title">
          <SectionHeader icon={<Ticket className="nova-ex-strip-icon" aria-hidden="true" />} titleId="nova-sx-bets-title" title={t('sportsPage.openBets', { defaultValue: 'Open bets' })} count={activeBets.length}>
            {activeBets.length > 0 && <button type="button" className="nova-ex-section-all nova-sx-link-button" onClick={() => setShowBetsModal(true)}>{t('exchangeHome.seeAll', { defaultValue: 'See All' })}</button>}
          </SectionHeader>
          <div className="nova-ex-widget-list nova-sx-bets">
            {isHydrating || betsLoading ? (
              <p className="nova-sx-state" role="status">{t('userPanel.betsLoading', { defaultValue: 'Loading your bets…' })}</p>
            ) : !isAuthenticated ? (
              <div className="nova-sx-state">
                <p>{t('nova.signInAccess')}</p>
                <button type="button" className="nova-sx-cta" onClick={() => openAuthModal('login')}>{t('nova.signIn')}</button>
              </div>
            ) : betsError ? (
              <div className="nova-sx-state" role="alert">
                <p>{t('userPanel.betsError', { defaultValue: 'Could not load your bets. Please try again.' })}</p>
                <button type="button" className="nova-sx-cta" onClick={() => { void refreshBets() }}>{t('nova.tryAgain')}</button>
              </div>
            ) : groupedActiveBets.length === 0 ? (
              <p className="nova-sx-state">{t('userPanel.betsEmpty', { defaultValue: 'No open bets' })}</p>
            ) : groupedActiveBets.map((group, index) => {
              const icon = sportIcon(group.sportKey || 'football', iconStyle);
              const to = group.eventId ? `/sports/event/${generateEventId(group.name)}?id=${encodeURIComponent(group.eventId)}` : `/sports/event/${generateEventId(group.name)}`;
              return <details key={group.eventKey} className="nova-sx-bet-group" open={index === 0}>
                <summary>
                  {icon && <img className={sportIconClass(group.sportKey || 'football', iconStyle, 'sport-img')} src={icon} alt="" />}
                  <span>{group.name}</span>
                  <small>{group.items.length}</small>
                </summary>
                {group.items.map((bet: any, betIndex: number) => {
                  const side = (bet?.selectionType || '').toString().toLowerCase() === 'back' ? 'back' : 'lay';
                  const odds = Number(bet?.odds) || 0;
                  const stake = Number(bet?.stake) || 0;
                  const plComputed = odds > 0 ? (side === 'lay' ? -(stake * Math.max(0, odds - 1)) : stake * Math.max(0, odds - 1)) : 0;
                  const pl = typeof bet?.pl === 'number' ? bet.pl : plComputed;
                  return <div key={bet?._id || betIndex} className="nova-sx-bet">
                    <span className={`nova-sx-bet-side is-${side}`}>{side === 'back' ? 'Back' : 'Lay'}</span>
                    <span className="nova-sx-bet-selection">{bet?.selection || '-'}<small>@ {odds || '-'} · {formatAmount(stake)}</small></span>
                    <strong className={pl >= 0 ? 'is-up' : 'is-down'}>{pl >= 0 ? formatAmount(pl) : `-${formatAmount(Math.abs(pl))}`}</strong>
                  </div>;
                })}
                <Link to={to} className="nova-sx-bet-open">{t('nova.openMatch')}</Link>
              </details>;
            })}
          </div>
        </section>

        <section className="nova-ex-widget" aria-label={sheetMode === 'bookmarked' ? 'Bookmarked events' : 'Recent events'}>
          <header className="nova-ex-section-head nova-sx-tabs-head">
            <div className="nova-sx-head-tabs" role="group">
              <button type="button" className={sheetMode === 'recent' ? 'active' : ''} aria-pressed={sheetMode === 'recent'} onClick={() => setSheetMode('recent')}>
                <Clock aria-hidden="true" />{t('sportsPage.recent', { defaultValue: 'Recent' })}<small>{rightRecentEvents.length}</small>
              </button>
              <button type="button" className={sheetMode === 'bookmarked' ? 'active' : ''} aria-pressed={sheetMode === 'bookmarked'} onClick={() => setSheetMode('bookmarked')}>
                <Bookmark aria-hidden="true" />{t('sportsPage.bookmarked', { defaultValue: 'Bookmarked' })}<small>{rightBookmarkedEvents.length}</small>
              </button>
            </div>
          </header>
          <ul className="nova-ex-widget-list">
            {sideEvents.length === 0 ? (
              <li className="nova-sx-state">
                {sheetMode === 'bookmarked'
                  ? t('sportsPage.noBookmarks', { defaultValue: 'Tap the bookmark on a match card to keep it here.' })
                  : t('sportsPage.noRecent', { defaultValue: 'Matches you have bets on appear here.' })}
              </li>
            ) : sideEvents.slice(0, 8).map((e: EventItem, index: number) => {
              const { dayMon, time } = formatStart(e.startISO);
              const icon = sportIcon(e.sport, iconStyle);
              return <li key={`${e.eventName}-${e.startISO}-${index}`} className="nova-sx-event">
                <Link to={eventUrl(e)} className="nova-ex-league">
                  {icon && <img className={sportIconClass(e.sport, iconStyle, 'sport-img')} src={icon} alt="" />}
                  <span className="nova-sx-event-copy">
                    <strong>{e.eventName}</strong>
                    <small>{e.league}</small>
                  </span>
                  {e.isLive ? <span className="nova-sx-live"><i aria-hidden="true" />{t('nova.live')}</span> : <small className="nova-sx-when">{dayMon} {time}</small>}
                </Link>
                {sheetMode === 'bookmarked' && <button type="button" className="nova-sx-remove" onClick={() => { void toggleBookmark(e) }} aria-label={`${t('nova.removeBookmark')}: ${e.eventName}`}><X aria-hidden="true" /></button>}
              </li>;
            })}
          </ul>
        </section>
      </aside>

      {showBetsModal && (
        <ModalSurface open onClose={() => setShowBetsModal(false)} title="Active Bets" size="lg" className="nova-bets-table-modal">
            <div className="nova-modal-body nova-modal-table flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[color:var(--surface)] border-b border-[color:var(--border)]/40">
                  <tr className="text-[color:var(--subtle)]">
                    <th className="py-2 px-3">Event</th>
                    <th className="py-2 px-3">League</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Selection</th>
                    <th className="py-2 px-3">Odds</th>
                    <th className="py-2 px-3">Stake</th>
                    <th className="py-2 px-3">P/L</th>
                    <th className="py-2 px-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBets.map((bet: any, idx: number) => {
                    const evName = bet?.eventId?.name || 'Event';
                    const leagueName = bet?.leagueId?.name || 'League';
                    const tRaw = (bet?.selectionType || '').toString().toLowerCase();
                    const betType = tRaw === 'back' ? 'Back' : 'Lay';
                    const date = bet?.eventId?.date ? new Date(bet.eventId.date).toISOString() : new Date().toISOString();
                    const { dayMon, time } = formatStart(date);
                    const odds = Number(bet?.odds) || 0;
                    const stake = Number(bet?.stake) || 0;
                    const plComputed = odds > 0 ? (tRaw === 'lay' ? -(stake * Math.max(0, odds - 1)) : stake * Math.max(0, odds - 1)) : 0;
                    const pl = typeof bet?.pl === 'number' ? bet.pl : plComputed;
                    const plText = Number.isFinite(pl) ? (pl >= 0 ? formatAmount(pl) : `-${formatAmount(Math.abs(pl))}`) : '-';
                    const plClass = pl >= 0 ? 'text-green-500' : 'text-red-500';
                    return (
                      <tr key={bet?._id || idx} className="border-b border-[color:var(--border)]/20">
                        <td className="py-2 px-3 text-[color:var(--foreground)]">{evName}</td>
                        <td className="py-2 px-3 text-[color:var(--subtle)]">{leagueName}</td>
                        <td className="py-2 px-3">
                          <span className={`${tRaw === 'back' ? 'bg-[#8DCDF3]' : 'bg-[#F6AABA]'} text-[#141518] text-[10px] font-bold px-2 py-0.5 rounded-md`}>{betType}</span>
                        </td>
                        <td className="py-2 px-3">{bet?.selection || '-'}</td>
                        <td className="py-2 px-3">{odds || '-'}</td>
                        <td className="py-2 px-3">{stake || '-'}</td>
                        <td className={`py-2 px-3 font-semibold ${plClass}`}>{plText}</td>
                        <td className="py-2 px-3">{dayMon} {time}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        </ModalSurface>
      )}
    </div>
  );
}
