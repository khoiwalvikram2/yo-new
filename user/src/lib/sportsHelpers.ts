import { useState, useEffect } from 'react';
import {
  getRecentEvents,
  getLikedEvents,
  addRecentEvent,
  isEventLiked,
  toggleLike,
  setRecentEvents as setRecentEventsSafe,
  setLikedEvents,
  cleanupStaleBookmarks,
  type StoredEvent,
} from './sportsLocal'
import {
  addRecentSports,
  toggleBookmarkSports,
  getSportsBookmarks as fetchSportsBookmarks,
  getRecentSports as fetchRecentSports,
} from '@/lib/api/user'
import { useAuth } from '@/lib/auth'
import type { EventItem } from '@/types';
import type { IbfEventDetailsRaw, EventDetails, Market, MatchOdds } from '@/components/sport-event/types'

/**
 * Records an opened event as recent (local list + backend). Holds no state, so list rows call it directly:
 * mounting useRecentEvents per row fetched the recent list once per row and tripped the rate limit.
 */
export async function addEventToRecent(event: EventItem) {
  const eventId = event.eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const storedEvent: StoredEvent = {
    id: eventId,
    eventName: event.eventName,
    league: event.league,
    sport: event.sport,
    startISO: event.startISO,
    isLive: event.isLive,
    runners: event.runners,
    _eventId: event.eventId,
  };
  addRecentEvent(storedEvent);
  // Also persist on backend when we have eventId
  try {
    if (event.eventId) await addRecentSports(event.eventId);
  } catch (_) {}
}

/**
 * Hook to manage recent events state and operations
 */
export function useRecentEvents() {
  const [recentEvents, setRecentEvents] = useState<StoredEvent[]>(() => getRecentEvents());
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const handleUpdate = () => {
      setRecentEvents(getRecentEvents())
    }

    window.addEventListener('stakex:sports:update', handleUpdate)
    window.addEventListener('storage', handleUpdate)

    return () => {
      window.removeEventListener('stakex:sports:update', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

  // Hydrate from backend if authenticated (via API helper)
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetchRecentSports()
        const rows = Array.isArray(res?.data) ? res.data : []
        const mapped: StoredEvent[] = rows.map((r: any) => {
          // Extract event name from meta, or try to parse from eventId if it's a readable format
          const eventId = r?.eventId || r?.id || ''
          let eventName = r?.meta?.eventName || ''
          
          // If eventName is missing or just an ID, try to extract from meta or generate a readable name
          if (!eventName || eventName === eventId) {
            // Try to get from meta object
            if (r?.meta && typeof r.meta === 'object') {
              eventName = r.meta.eventName || r.meta.name || ''
            }
            // If still empty, try to make eventId more readable (replace hyphens with spaces, capitalize)
            if (!eventName && eventId && eventId.length > 0) {
              eventName = eventId
                .replace(/-/g, ' ')
                .replace(/\b\w/g, (l: string) => l.toUpperCase())
            }
          }
          
          return {
            id: eventId,
            eventName: eventName || 'Event',
            league: r?.meta?.league || '',
            sport: (r?.meta?.sport || 'cricket') as StoredEvent['sport'],
            startISO: r?.meta?.startISO || new Date().toISOString(),
            isLive: Boolean(r?.meta?.isLive),
            runners: Array.isArray(r?.meta?.runners) ? r.meta.runners : [],
            _eventId: eventId,
          }
        })
        if (mapped.length) {
          setRecentEventsSafe(mapped)
          setRecentEvents(mapped)
        }
      } catch (_) {
        // ignore hydration errors
      } finally {
        setHydrated(true)
      }
    })()
  }, [])

  const addToRecent = addEventToRecent;

  const seedRecentEvents = (events: EventItem[]) => {
    const toStored = (e: EventItem): StoredEvent => ({
      id: e.eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      eventName: e.eventName,
      league: e.league,
      sport: e.sport,
      startISO: e.startISO,
      isLive: e.isLive,
      runners: e.runners,
    });

    const recentTestData = events.slice(0, 8).map(toStored);
    setRecentEventsSafe(recentTestData);
    setRecentEventsSafe(getRecentEvents());
  };

  return {
    recentEvents,
    hydrated,
    addToRecent,
    seedRecentEvents,
  };
}

/**
 * Hook to manage bookmarked events state and operations
 */
export function useBookmarkedEvents() {
  const [bookmarkedEvents, setBookmarkedEvents] = useState<StoredEvent[]>(() => getLikedEvents());
  const [hydrated, setHydrated] = useState(false)
  const { isAuthenticated, openAuthModal } = useAuth()

  useEffect(() => {
    const handleUpdate = () => {
      setBookmarkedEvents(getLikedEvents())
    }

    window.addEventListener('stakex:sports:update', handleUpdate)
    window.addEventListener('storage', handleUpdate)

    return () => {
      window.removeEventListener('stakex:sports:update', handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [])

  // Hydrate from backend if available
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetchSportsBookmarks()
        const rows = Array.isArray(res?.data) ? res.data : []
        const mapped: StoredEvent[] = rows.map((r: any) => ({
          id: r?.eventId || r?.id || '',
          eventName: r?.meta?.eventName || r?.eventId || '',
          league: r?.meta?.league || '',
          sport: r?.meta?.sport || 'cricket',
          startISO: r?.meta?.startISO || new Date().toISOString(),
          isLive: Boolean(r?.meta?.isLive),
          runners: Array.isArray(r?.meta?.runners) ? r.meta.runners : [],
          _eventId: r?.eventId,
        }))
        if (mapped.length) {
          setLikedEvents(mapped)
          setBookmarkedEvents(mapped)
        }
      } catch (_) {
        // ignore hydration errors
      } finally {
        setHydrated(true)
      }
    })()
  }, [])

  const isBookmarked = (eventId: string) => isEventLiked(eventId);

  const toggleBookmark = async (event: EventItem) => {
    if (!isAuthenticated) { openAuthModal('login'); return }
    const eventId = event.eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const storedEvent: StoredEvent = {
      id: eventId,
      eventName: event.eventName,
      league: event.league,
      sport: event.sport,
      startISO: event.startISO,
      isLive: event.isLive,
      runners: event.runners,
      _eventId: event.eventId,
    };
    toggleLike(storedEvent);
    try {
      if (event.eventId) await toggleBookmarkSports(event.eventId);
    } catch (_) {}
  };

  const seedBookmarkedEvents = (events: EventItem[]) => {
    const toStored = (e: EventItem): StoredEvent => ({
      id: e.eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      eventName: e.eventName,
      league: e.league,
      sport: e.sport,
      startISO: e.startISO,
      isLive: e.isLive,
      runners: e.runners,
    });

    const bookmarkedTestData = events.slice(8, 15).map(toStored);
    setLikedEvents(bookmarkedTestData);
    setBookmarkedEvents(getLikedEvents());
  };

  return {
    bookmarkedEvents,
    hydrated,
    isBookmarked,
    toggleBookmark,
    seedBookmarkedEvents,
  };
}

/**
 * Hook to manage both recent and bookmarked events
 */
export function useSportsEvents() {
  const recent = useRecentEvents();
  const bookmarked = useBookmarkedEvents();

  const seedTestData = (events: EventItem[]) => {
    if (recent.recentEvents.length === 0) {
      recent.seedRecentEvents(events);
    }
    if (bookmarked.bookmarkedEvents.length === 0) {
      bookmarked.seedBookmarkedEvents(events);
    }
  };

  // Clean up stale bookmarks when sports data changes
  const cleanupBookmarks = (events: EventItem[]) => {
    const currentEvents = events.map(eventToStored);
    cleanupStaleBookmarks(currentEvents);
  };

  return {
    ...recent,
    ...bookmarked,
    hydratedRecent: recent.hydrated,
    hydratedBookmarked: bookmarked.hydrated,
    seedTestData,
    cleanupBookmarks,
  };
}

/**
 * Utility function to generate event ID from event name
 */
export function generateEventId(eventName: string): string {
  return eventName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Utility function to convert EventItem to StoredEvent
 */
export function eventToStored(event: EventItem): StoredEvent {
  return {
    id: generateEventId(event.eventName),
    eventName: event.eventName,
    league: event.league,
    sport: event.sport,
    startISO: event.startISO,
    isLive: event.isLive,
    runners: event.runners,
  };
}

/**
 * Utility function to convert StoredEvent to EventItem
 */
export function storedToEvent(stored: StoredEvent): EventItem {
  return {
    eventId: stored._eventId || stored.id,
    sport: stored.sport,
    eventName: stored.eventName || stored.id || 'Event',
    league: stored.league || '',
    startISO: stored.startISO,
    isLive: stored.isLive,
    runners: stored.runners || [
      { name: 'Home', back: 1.85, lay: 1.90 },
      { name: 'Away', back: 2.10, lay: 2.15 },
    ],
  };
}

// Find event by details (like ibf-goa-user findEventByDetails)
export function findEventByDetails(sportsData: any[], eventParam: string): any | null {
  const normalizeSlug = (value?: string) => {
    if (!value) return ''
    return value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/\s+vs\s+/g, '-v-')
      .replace(/\s+v\s+/g, '-v-')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$|/g, '')
  }

  const generateNameSlugs = (name?: string): string[] => {
    if (!name) return []
    const base = name.toLowerCase().replace(/&/g, 'and')
    const variants = [
      base.replace(/\s+vs\s+/g, ' v ').replace(/\s+/g, ' '),
      base.replace(/\s+v\s+/g, ' v ').replace(/\s+/g, ' '),
    ]
    const slugs = new Set<string>()
    for (const v of variants) {
      const s = normalizeSlug(v)
      slugs.add(s)
      // remove trailing -w if present on either team
      slugs.add(s.replace(/-w(?=-|$)/g, ''))
      // also allow vs form
      slugs.add(s.replace(/-v-/g, '-vs-'))
    }
    return Array.from(slugs)
  }

  const eventParamNorm = normalizeSlug(eventParam)
  const [teamAParam, teamBParam] = eventParamNorm.split(/-v-|-vs-/)
  const teamAPlain = teamAParam?.replace(/-w$/, '')
  const teamBPlain = teamBParam?.replace(/-w$/, '')

  // Search through ALL sports
  for (const sport of sportsData) {
    if (!sport?.leagues?.length) continue
    for (const league of sport.leagues) {
      if (!league?.events?.length) continue

      for (const event of league.events) {
        const slugFromField = normalizeSlug(event.slugName)
        if (slugFromField && slugFromField === eventParamNorm) {
          // Exact slug match
          const date = event?.markets?.[0]?.marketStartTime || event?.markets?.[1]?.marketStartTime
          return {
            sportName: sport?.name,
            sportId: sport?._id,
            sportCode: sport?.sportsCode,
            leagueName: league?.name,
            leagueId: league?._id,
            eventDate: date,
            allEvents: league?.events,
            ...event,
          }
        }

        const nameSlugs = generateNameSlugs(event.name)
        if (nameSlugs.includes(eventParamNorm)) {
          const date = event?.markets?.[0]?.marketStartTime || event?.markets?.[1]?.marketStartTime
          return {
            sportName: sport?.name,
            sportId: sport?._id,
            sportCode: sport?.sportsCode,
            leagueName: league?.name,
            leagueId: league?._id,
            eventDate: date,
            allEvents: league?.events,
            ...event,
          }
        }

        // Team token check (strong but flexible)
        if (teamAPlain && teamBPlain) {
          const nameNorm = normalizeSlug(event.name)
          if (nameNorm.includes(teamAPlain) && nameNorm.includes(teamBPlain)) {
          const date = event?.markets?.[0]?.marketStartTime || event?.markets?.[1]?.marketStartTime
            return {
              sportName: sport?.name,
              sportId: sport?._id,
              sportCode: sport?.sportsCode,
              leagueName: league?.name,
              leagueId: league?._id,
              eventDate: date,
              allEvents: league?.events,
              ...event,
            }
          }
        }
      }
    }
  }

  return null
}

// IBF -> UI adapters (used to keep stakex-ui components unchanged)
export function adaptIbfEventToUi(raw: IbfEventDetailsRaw): EventDetails {
  const [home, away] = parseTeams(raw.name);
  
  // Normalize start time to ISO for consistency across list and detail pages
  const startIso = (() => {
    const toISO = (v: unknown): string => {
      if (v === null || v === undefined || v === '') return ''
      if (typeof v === 'number') {
        const ms = v < 1e12 ? v * 1000 : v
        return new Date(ms).toISOString()
      }
      const s = String(v)
      const d = new Date(s)
      return isNaN(d.getTime()) ? '' : d.toISOString()
    }

    // Prefer explicit event-level dates; fallback to earliest marketStartTime
    const direct =
      toISO((raw as any).eventDate) ||
      toISO((raw as any).date) ||
      toISO((raw as any).startTime) ||
      toISO((raw as any).start) ||
      toISO((raw as any).scheduledStart) ||
      toISO((raw as any).time)

    if (direct) return direct

    try {
      const markets: any[] = Array.isArray((raw as any)?.markets) ? ((raw as any).markets as any[]) : []
      const times = markets
        .map((m: any) => toISO(m?.marketStartTime) || toISO(m?.startTime) || toISO(m?.start))
        .filter(Boolean) as string[]
      return times.length ? times.sort()[0] : ''
    } catch {
      return ''
    }
  })()

  // Provide sane runner fallbacks when market payload lacks runners
  const withFallbackRunners = (markets: any[], sportName?: string) => {
    const sport = String(sportName || '').toLowerCase()
    const needsDraw = sport === 'football' || sport === 'soccer'
    return markets.map((m: any) => {
      const hasRunners = Array.isArray(m?.runners) && m.runners.length > 0
      if (hasRunners) return m
      const nameNorm = String(m?.marketName || '').toLowerCase().replace(/\s+/g, ' ').trim()
      // Only add for match result style markets
      const isMatchOddsName = nameNorm === 'match odds' || /(^|\b)(1x2|full\s*time\s*result|match\s*result|money\s*line|moneyline)(\b|$)/.test(nameNorm)
      if (!isMatchOddsName) return m
      const base: any[] = [
        { runnerName: home, selectionId: 1, back: 0, lay: 0 },
        ...(needsDraw ? [{ runnerName: 'Draw', selectionId: 2, back: 0, lay: 0 }] : []),
        { runnerName: away, selectionId: needsDraw ? 3 : 2, back: 0, lay: 0 },
      ]
      return { ...m, runners: base }
    })
  }

  const adapted = {
    id: (raw as any)?._id || raw.id, // preserve backend _id
    homeTeam: { name: home },
    awayTeam: { name: away },
    league: raw.leagueName,
    venue: '',
    startTime: startIso,
    status: 'upcoming' as const,
    markets: withFallbackRunners((raw.markets || []), raw.sportName).map(adaptIbfMarketToUi),
    // Add sportName for fancy data condition
    sportName: raw.sportName,
    // Preserve IDs for betting
    sportId: raw.sportId,
    leagueId: raw.leagueId,
    eventId: (raw as any)?._id || raw.id,
    // Use the external event code if available for socket channels like fancy-{code}
    eventCode: (raw as any)?.id || (raw as any)?._id,
  }
  
  return adapted
}

export function adaptSportsEventDetailToUi(payload: any): EventDetails {
  const ev = payload?.event
  if (!ev) {
    return {
      id: '',
      homeTeam: { name: 'Team A' },
      awayTeam: { name: 'Team B' },
      league: '',
      venue: '',
      startTime: '',
      status: 'upcoming',
      markets: [],
    }
  }

  const [home, away] = parseTeams(ev.name)
  const toISO = (v: unknown): string => {
    if (!v) return ''
    if (typeof v === 'number') {
      const ms = v < 1e12 ? v * 1000 : v
      return new Date(ms).toISOString()
    }
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? '' : d.toISOString()
  }
  const startIso = toISO(ev.date)

  const markets: Market[] = Array.isArray(payload?.markets)
    ? (payload.markets as any[]).map((m) => {
        const statusRaw = String(m?.marketStatus || '').toLowerCase()
        const status: Market['status'] =
          statusRaw.includes('suspend') ? 'suspended' : statusRaw.includes('close') ? 'closed' : 'active'
        const uiType = toUiMarketType(m?.type, m?.name)
        const odds: MatchOdds[] = Array.isArray(m?.runners)
          ? (m.runners as any[]).map((r: any, idx: number) => ({
              selection: r?.name || `Runner ${idx + 1}`,
              selectionId: r?.selectionId ?? idx,
              back: 0,
              lay: 0,
              volume: 0,
            }))
          : []
        return {
          id: m?.marketId || m?.marketCode || '',
          name: m?.name || 'Market',
          type: uiType,
          status,
          odds,
          marketCode: m?.marketCode || m?.marketId,
          marketType: uiType === 'match-odds' ? 'exchange' : uiType,
        }
      })
    : []

  return {
    id: ev.id,
    homeTeam: { name: home },
    awayTeam: { name: away },
    league: ev.leagueName || '',
    venue: '',
    startTime: startIso,
    status: 'upcoming',
    markets,
    sportName: ev.sportName,
    sportId: ev.sportId,
    leagueId: ev.leagueId,
    eventId: ev.id,
    eventCode: ev.eventCode || ev.id,
  }
}

function adaptIbfMarketToUi(m: any): Market {
  const uiType = toUiMarketType(m?.type, m?.marketName);
  const extractPrices = (runner: any) => {
    const ex = runner?.ex
    if (ex) {
      const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
      const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
      const back = atb.length ? atb[atb.length - 1]?.price : undefined
      const lay = atl.length ? atl[0]?.price : undefined
      return { back: Number(back || 0), lay: Number(lay || 0) }
    }
    const back = runner?.back ?? runner?.backPrice ?? runner?.oddsBack ?? runner?.b
    const lay = runner?.lay ?? runner?.layPrice ?? runner?.oddsLay ?? runner?.l
    return { back: Number(back || 0), lay: Number(lay || 0) }
  }

  // Normalize runners array from various shapes
  const rawRunners: any[] = Array.isArray(m?.runners)
    ? m.runners
    : Array.isArray(m?.selections)
      ? m.selections
      : (m?.runners && typeof m.runners === 'object')
        ? Object.values(m.runners)
        : []

  const odds: MatchOdds[] = rawRunners.map((r: any, index: number) => {
    const { back, lay } = extractPrices(r)
    return {
      selection: r?.runnerName || r?.selectionName || r?.name || `Team ${index + 1}`,
      selectionId: r?.selectionId || index,
      back,
      lay,
      // pass through exchange ladder if present for richer initial view
      ...(r?.ex ? { ex: r.ex } as any : {}),
    } as any
  });
  return {
    id: m?._id || m?.marketId,
    name: m?.marketName,
    type: uiType,
    status: 'active',
    odds,
    marketCode: m?.marketId,
    marketType: uiType === 'match-odds' ? 'exchange' : uiType,
  };
}

function toUiMarketType(type?: string, name?: string): Market['type'] {
  const t = String(type || '').toLowerCase();
  if (t.includes('book')) return 'bookmaker';
  if (String(name || '').toLowerCase() === 'match odds') return 'match-odds';
  if (t.includes('fancy')) return 'fancy';
  return 'match-odds';
}

function parseTeams(name?: string): [string, string] {
  if (!name) return ['Team A', 'Team B'];
  if (name.includes(' @ ')) {
    const [a, b] = name.split(' @ ');
    return [a.trim(), b.trim()];
  }
  if (name.includes(' v ')) {
    const [a, b] = name.split(' v ');
    return [a.trim(), b.trim()];
  }
  const parts = name.split(' vs ');
  return [parts[0]?.trim() || 'Team A', parts[1]?.trim() || 'Team B'];
}
