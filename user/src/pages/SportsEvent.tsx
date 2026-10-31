import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { Info } from 'lucide-react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { useBetSlip } from '../components/sports/BetSlipProvider'
import { 
  EventHeader as RawEventHeader, 
  MarketTabs as RawMarketTabs, 
  MarketCard, 
  EventSidebar as RawEventSidebar,
  MobileScoreTvTabs,
  EnterpriseBetSlip,
  useEventAnalytics,
  WinProbabilityMeter,
  MomentumIndicator,
  OddsMovementGraph,
  MarketDepthChart,
} from '../components/sport-event'
import type { EventDetails, Bet } from '../components/sport-event/types'
import { adaptIbfEventToUi, adaptSportsEventDetailToUi, findEventByDetails, useBookmarkedEvents } from '@/lib/sportsHelpers'
import { getAllSportsData, getFancyOdds, getSportsEventDetails } from '@/lib/api/user'
import { useOpenBets } from '@/hooks/useOpenBets'
import { useOddsSocket } from '@/lib/hooks/useOddsSocket'
import { useAuth } from '@/lib/auth'
import { usePageSEO } from '../hooks/usePageSEO'
import ModalSurface from '../components/modals/ModalSurface'
import BetSlipDrawer from '../components/sport-event/BetSlipDrawer'
import SectionHeader from '../components/nova/exchange-home/SectionHeader'
import { useRailLayout } from '../components/sport-event/useRailLayout'
import '@/components/nova/exchange-home/nova-exchange-home.css'
import '../components/sport-event/nova-sports-event.css'

export default function SportsEventPage() {
  const { isMobile } = useBetSlip()
  const [activeTab, setActiveTab] = useState('all')
  const [sidebarMode, setSidebarMode] = useState<'score' | 'tv'>('score')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  // Bumped by "Try again" when the event could not be loaded (network, rate limit, unknown id).
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [mobileAnalyticsOpen, setMobileAnalyticsOpen] = useState(false)
  const [mobileAnalyticsTab, setMobileAnalyticsTab] = useState<'match' | 'momentum' | 'odds' | 'depth'>('match')
  const [desktopAnalyticsOpen, setDesktopAnalyticsOpen] = useState(false)
  const [event, setEvent] = useState<EventDetails>({
    id: '',
    homeTeam: { name: '' },
    awayTeam: { name: '' },
    league: '',
    venue: '',
    startTime: '',
    status: 'upcoming',
    markets: [],
  })
  const [myBets, setMyBets] = useState<Bet[]>([])
  const [timeRemaining, setTimeRemaining] = useState('00:00:00')
  const [status, setStatus] = useState<EventDetails['status']>('upcoming')
  const [bookmarked, setBookmarked] = useState(false)
  const [fancySeed, setFancySeed] = useState<any[] | null>(null)
  // Bookmark integration
  const { isBookmarked, toggleBookmark } = useBookmarkedEvents()

  // Dynamic SEO title based on event
  const eventTitle = event?.homeTeam?.name && event?.awayTeam?.name
    ? `${event.homeTeam.name} vs ${event.awayTeam.name}`
    : 'Sports Event'
  
  usePageSEO({ 
    title: eventTitle,
    description: `Live sports betting: ${eventTitle}` 
  })

  useEffect(() => {
    try {
      const name = `${event?.homeTeam?.name || ''} v ${event?.awayTeam?.name || ''}`.trim()
      const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      setBookmarked(isBookmarked(id))
    } catch (_) {}
  }, [event?.homeTeam?.name, event?.awayTeam?.name, isBookmarked])

  const [expandedMarkets, setExpandedMarkets] = useState<Set<string>>(new Set<string>())
  const [leagueEvents, setLeagueEvents] = useState<Array<{ id: string; name: string }>>([])
  const leagueEventsOwner = useRef('')
  const analytics = useEventAnalytics(event.id, event.markets)
  // Quick bet popover now controlled by provider, keep local for fallback only if needed

  // Load real data by default (unless explicitly disabled)
  const useLive = import.meta.env.VITE_SPORTS_LIVE !== 'false'
  const { eventId } = useParams<{ eventId: string }>()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const idParam = searchParams.get('id') || ''
  
  // Use the eventId from URL as the primary identifier
  // We'll search through all sports and leagues to find the matching event
  const eventParam = eventId || 'match'

  useEffect(() => {
    if (!useLive) return
    let cancelled = false
    setIsLoading(true)
    setEvent({ id: '', homeTeam: { name: '' }, awayTeam: { name: '' }, league: '', venue: '', startTime: '', status: 'upcoming', markets: [] })
    setLeagueEvents([])
    leagueEventsOwner.current = '' 
    ;(async () => {
      try {
        // 1) Try dedicated event detail (exchange-only for now)
        const eventKey = idParam || eventId || eventParam
        if (eventKey) {
          try {
            const detailRes = await getSportsEventDetails({ sport: '', league: '', event: eventKey })
            if (cancelled) return
            const detail = (detailRes as any)?.data || (detailRes as any)?.sportsEventDetail?.data
            if (detail?.event) {
              const adapted = adaptSportsEventDetailToUi(detail)
              if (Array.isArray(detail.leagueEvents)) {
                leagueEventsOwner.current = adapted.id
                setLeagueEvents(detail.leagueEvents)
              }
              setEvent(adapted)
              setExpandedMarkets(new Set(adapted.markets.map(m => m.id)))
              setIsLoading(false)
              return
            }
          } catch {
            /* fall through to list fallback */
          }
        }

        // 2) Fallback to sports list search (legacy path)
        const res = await getAllSportsData()
        if (cancelled) return
        const raw = (res as any)?.data || res
        
        // Use findEventByDetails logic like ibf-goa-user
        let eventData = null
        
        if (Array.isArray(raw)) {
          // Prefer exact backend id when available
          if (idParam) {
            outer: for (const sport of raw) {
              if (!sport?.leagues?.length) continue
              for (const league of sport.leagues) {
                if (!league?.events?.length) continue
                const found = league.events.find((e: any) => String((e as any)?.id || (e as any)?._id || e.id) === idParam)
                if (found) {
                  // Derive eventDate robustly for header rendering
                  const toISO = (v: unknown): string => {
                    if (v === null || v === undefined || v === '') return ''
                    if (typeof v === 'number') { const ms = v < 1e12 ? v * 1000 : v; return new Date(ms).toISOString() }
                    const d = new Date(String(v)); return isNaN(d.getTime()) ? '' : d.toISOString()
                  }
                  const markets: any[] = Array.isArray((found as any)?.markets) ? (found as any).markets : []
                  const fromMarkets = markets
                    .map((m: any) => toISO(m?.marketStartTime) || toISO(m?.startTime) || toISO(m?.start))
                    .filter(Boolean) as string[]
                  const derivedDate = toISO((found as any)?.date) || toISO((found as any)?.eventDate) || (fromMarkets.length ? fromMarkets.sort()[0] : '')
                  // Preserve IDs required for betting
                  const sportId = (sport as any)?.id || (sport as any)?._id
                  const leagueId = (league as any)?.id || (league as any)?._id
                  eventData = { ...found, sportName: sport?.name, leagueName: league?.name, sportId, leagueId, eventDate: derivedDate }
                  break outer
                }
              }
            }
          }
          // Fallback to name/slug based search
          if (!eventData) eventData = findEventByDetails(raw, eventParam)
        } else if (raw && raw.name) {
          eventData = raw
        }
        
        if (eventData && eventData.name) {
          const adapted = adaptIbfEventToUi(eventData)
          setEvent(adapted)
          setExpandedMarkets(new Set(adapted.markets.map(m => m.id)))
        }
      } catch (_e) {
        // Failed to fetch sports data
      }
      finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [useLive, eventParam, idParam, eventId, loadAttempt])

  // Fetch league events for Switch Event dropdown (same league as current event)
  useEffect(() => {
    if (!event?.id || !useLive || leagueEventsOwner.current === event.id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await getAllSportsData()
        const raw = (res as any)?.data || res
        if (!Array.isArray(raw)) return
        const leagueId = event.leagueId != null ? String(event.leagueId) : ''
        const leagueName = (event.league || '').trim().toLowerCase()
        for (const sport of raw) {
          const leagues = (sport as any)?.leagues || []
          for (const league of leagues) {
            const matchLeague =
              (leagueId && String((league as any)?.id ?? (league as any)?._id) === leagueId) ||
              (leagueName && String((league as any)?.name ?? '').trim().toLowerCase() === leagueName)
            if (!matchLeague) continue
            const events = (league as any)?.events || []
            const list = events.map((e: any) => ({
              id: String((e as any)?.id ?? (e as any)?._id ?? ''),
              name: String((e as any)?.name ?? (`${(e as any)?.homeTeam ?? ''} vs ${(e as any)?.awayTeam ?? ''}`.trim() || 'Event')),
            })).filter((item: { id: string; name: string }) => item.id && item.name)
            if (!cancelled) setLeagueEvents(list)
            return
          }
        }
        if (!cancelled) setLeagueEvents([])
      } catch {
        if (!cancelled) setLeagueEvents([])
      }
    })()
    return () => { cancelled = true }
  }, [event?.id, event?.leagueId, event?.league, useLive])

  // When event changes (e.g. after Switch Event), reset status and timeRemaining for the new event
  useEffect(() => {
    if (!event?.id || !event?.startTime) return
    const startMs = new Date(event.startTime).getTime()
    const nowMs = Date.now()
    if (startMs <= nowMs) {
      setStatus('live')
      setTimeRemaining('00:00:00')
    } else {
      setStatus('upcoming')
      const diff = Math.floor((startMs - nowMs) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      const pad = (n: number) => String(n).padStart(2, '0')
      setTimeRemaining(`${pad(h)}:${pad(m)}:${pad(s)}`)
    }
  }, [event?.id, event?.startTime])

  // Drive countdown based on scheduled start time - only runs when startTime changes
  useEffect(() => {
    if (!event?.startTime || status === 'live') return
    const compute = () => {
      const startMs = new Date(event.startTime).getTime()
      const nowMs = Date.now()
      const diff = Math.max(0, Math.floor((startMs - nowMs) / 1000))
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      const pad = (n: number) => String(n).padStart(2, '0')
      setTimeRemaining(`${pad(h)}:${pad(m)}:${pad(s)}`)
      if (diff <= 0) setStatus('live')
    }
    compute()
    const t = setInterval(compute, 1000)
    return () => clearInterval(t)
  }, [event?.startTime, status])

  // Memoize fancy event key to prevent recalculation on every render
  const fancyEventKey = useMemo(() => 
    event?.eventCode ? String(event.eventCode) : (event?.id ? String(event.id) : ''),
    [event?.eventCode, event?.id]
  )
  // Throttled live map to avoid excessive renders on rapid ticks
  const [liveMapThrottled, setLiveMapThrottled] = useState<Record<string, any>>({})

  useEffect(() => {
    const isLiveOdds = (payload: any): boolean => {
      if (!payload) return false
      const statusStr = String((payload as any)?.status || (payload as any)?.marketStatus || '').toLowerCase()
      const inplay = Boolean((payload as any)?.inplay || (payload as any)?.inPlay)
      return inplay && /(^|\b)(open|active)(\b|$)/.test(statusStr)
    }
    try {
      for (const [_, p] of Object.entries(liveMapThrottled as Record<string, any>)) {
        const raw = (p as any)?.payload ?? p
        const payload = (raw && (raw as any).data) ? (raw as any).data : raw
        if (isLiveOdds(payload)) { setStatus('live'); return }
      }
    } catch (_) {}
  }, [liveMapThrottled])

  // Fetch initial fancy data (fallback when WS snapshot isn't available)
  useEffect(() => {
    if (!useLive || !fancyEventKey) return
    
    let cancelled = false
    const fetchFancyData = async () => {
      try {
        const parse = (resp: any): any[] => {
          if (!resp) return []
          const d = (resp as any).data !== undefined ? (resp as any).data : resp
          if (Array.isArray(d)) return d
          if (d && typeof d === 'object') {
            if (Array.isArray((d as any).items)) return (d as any).items
            if (Array.isArray((d as any).fancy)) return (d as any).fancy
            return Object.values(d)
          }
          return []
        }

        let seed: any[] = []
        try {
          const response = await getFancyOdds(fancyEventKey, 'FANCY')
          seed = parse(response)
        } catch {
          /* noop */
        }

        if (!cancelled && seed.length > 0) {
          setFancySeed(seed)
        }
      } catch {
        /* noop */
      }
    }
    
    void fetchFancyData()
    return () => { cancelled = true }
  }, [fancyEventKey, useLive])

  // Clear old fancy seed on event change to avoid stale rows
  useEffect(() => {
    setFancySeed(null)
  }, [event?.id])

  // Countdown timer effect and inplay detection
  useEffect(() => {
    if (status === 'upcoming' && event.timeRemaining) {
      const timer = setInterval(() => {
        const [hours, minutes, seconds] = timeRemaining.split(':').map(Number)
        const totalSeconds = hours * 3600 + minutes * 60 + seconds

        if (totalSeconds > 0) {
          const newTotal = totalSeconds - 1
          const newHours = Math.floor(newTotal / 3600)
          const newMinutes = Math.floor((newTotal % 3600) / 60)
          const newSeconds = newTotal % 60

          setTimeRemaining(
            `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}:${String(newSeconds).padStart(2, '0')}`
          )
        } else {
          setStatus('live')
          clearInterval(timer)
        }
      }, 1000)

      return () => clearInterval(timer)
    }
  }, [timeRemaining, status, event.timeRemaining])

  // inplay detection moved below

  // Derive synthetic Fancy market from WS or fallback seed if not present in API markets
  const fancyItems: any[] = useMemo(() => {
    try {
      const wsKey = `fancy-${fancyEventKey}`
      const blob = (liveMapThrottled as any)?.[wsKey]?.payload ?? (liveMapThrottled as any)?.[wsKey]
      let arr: any[] = []
      
      if (Array.isArray(blob)) arr = blob
      else if (blob && typeof blob === 'object') {
        const wrapped = (blob as any).markets ?? (blob as any).data
        arr = Array.isArray(wrapped) ? wrapped : Object.values(blob as any)
      }
      else if (Array.isArray(fancySeed)) arr = fancySeed

      // Parse JSON strings if present (ibf-goa-user sends JSON strings sometimes)
      const parsed = arr.map((it: any) => {
        if (typeof it === 'string') {
          try { return JSON.parse(it) } catch { return null }
        }
        return it
      // An empty channel answers a wrapper ({ markets: [] }); only named runner objects are fancy rows.
      }).filter((it: any) => it && typeof it === 'object' && !Array.isArray(it) && String(it.name ?? '').trim() !== '')

      // Sort by numeric priority (asc), then by name
      parsed.sort((a: any, b: any) => {
        const pa = Number(a?.priority ?? 9999)
        const pb = Number(b?.priority ?? 9999)
        if (pa !== pb) return pa - pb
        const na = String(a?.name || '')
        const nb = String(b?.name || '')
        return na.localeCompare(nb)
      })
      
      return parsed
    } catch (_) { return [] }
  }, [liveMapThrottled, fancyEventKey, fancySeed])

  // Check if fancy market exists (calculated but not currently used)
  // const hasFancyInApi = useMemo(() => {
  //   return (event?.markets || []).some((m: any) => m?.type === 'fancy' || (m as any)?.marketType === 'fancy')
  // }, [event?.markets])

  const marketsAll: EventDetails['markets'] = useMemo(() => {
    // Remove any existing fancy markets from API (we'll use WS feed instead)
    const nonFancyMarkets = event.markets.filter(m => m.type !== 'fancy' && (m as any).marketType !== 'fancy')
    
    // If no fancy items from feed, just return non-fancy markets
    if (fancyItems.length === 0) return nonFancyMarkets
    
    // Build ONE "Fancy" market with ALL fancy items as odds
    const odds = fancyItems.map((fr: any) => ({
      selection: String(fr?.name || ''),
      back: Number(fr?.b1 || 0),
      lay: Number(fr?.l1 || 0),
      selectionId: String(fr?.id || ''),
      fancyData: {
        bs1: fr?.bs1,
        ls1: fr?.ls1,
        status1: fr?.status1,
        odd_type: fr?.odd_type,
        id: fr?.id,
        priority: Number(fr?.priority ?? 9999),
      }
    })) as any
    
    const singleFancyMarket = {
      id: `fancy-${event?.id || ''}`,
      name: 'Fancy',
      type: 'fancy' as const,
      status: 'active' as const,
      odds,
      marketType: 'fancy' as const,
      marketCode: String(event?.eventCode || event?.id || ''),
    }
    
    return [...nonFancyMarkets, singleFancyMarket]
  }, [event.markets, event?.id, event?.eventCode, fancyItems])

  const filteredMarkets = marketsAll.filter(market => {
    // Hide Toss market from everywhere
    if (market.name.toLowerCase().includes('toss')) return false
    
    if (activeTab === 'all') return true
    if (activeTab === 'exchange') {
      // Show Match Odds, Tied Match (Toss market is hidden)
      return market.type === 'match-odds' || 
             market.name.toLowerCase().includes('tied')
    }
    if (activeTab === 'bookmaker') return market.type === 'bookmaker'
    if (activeTab === 'fancy') return market.type === 'fancy'
    return false
  })
  
  // Remove excessive debug logging that triggers on every render

  // When live odds appear (handled inside market components), page-level sections remain stable

  const handleBookmark = useCallback(() => {
    try {
      const name = `${event?.homeTeam?.name || ''} v ${event?.awayTeam?.name || ''}`.trim()
      const syntheticEvent: any = {
        eventId: event?.eventId || event?.id,
        eventName: name || 'Event',
        league: event?.league || '',
        sport: (event as any)?.sportName?.toLowerCase?.() || 'football',
        startISO: event?.startTime || new Date().toISOString(),
        isLive: event?.status === 'live',
        runners: [ { name: event?.homeTeam?.name || 'Home' }, { name: 'Draw' }, { name: event?.awayTeam?.name || 'Away' } ],
      }
      toggleBookmark(syntheticEvent)
      setBookmarked(prev => !prev)
    } catch (_) { setBookmarked(prev => !prev) }
  }, [event, toggleBookmark])

  const handleOpenAnalytics = useCallback(() => {
    if (isMobile) setMobileAnalyticsOpen(true)
    else setDesktopAnalyticsOpen(true)
  }, [isMobile])

  const toggleMarket = useCallback((marketId: string) => {
    setExpandedMarkets(prev => {
      const newSet = new Set(prev)
      if (newSet.has(marketId)) {
        newSet.delete(marketId)
      } else {
        newSet.add(marketId)
      }
      return newSet
    })
  }, [])

  // Server-driven open bets for the current event and visible markets
  // moved below after filteredMarketsToRender is defined

  // Memoized components to avoid re-rendering the whole page on odds updates
  const EventHeader = useMemo(() => memo(RawEventHeader), [])
  const MarketTabs = useMemo(() => memo(RawMarketTabs), [])
  const EventSidebar = useMemo(() => memo(RawEventSidebar), [])

  // Stable onOddsClick callback
  const { openQuickBet } = useBetSlip()
    const { isAuthenticated, openAuthModal } = useAuth()
  
  const handleOddsClick = useCallback((team: string, odds: number, type: 'back' | 'lay', marketName: string, teamIndex: number, e: React.MouseEvent, extras?: { marketId?: string; marketType?: 'exchange' | 'bookmaker' | 'fancy'; marketCode?: string; selectionId?: string | number; backOdds?: number; layOdds?: number; oddsSize?: number; fancyStatus?: string }) => {
    if (!isAuthenticated) { openAuthModal('login'); return }
    // Prevent bet slip from opening if odds is zero or invalid
    if (!Number.isFinite(odds) || odds <= 0) { return }
    
    // Prevent bet slip from opening if fancy is suspended or ball running
    if (extras?.marketType === 'fancy' && (extras?.fancyStatus === 'SUSPENDED' || extras?.fancyStatus === 'Ball Running')) {
      return
    }
    
    const buttonElement = e.currentTarget as HTMLElement
    const buttonId = `${marketName}-${teamIndex}-${type}-${odds}`
    openQuickBet({
      team,
      odds,
      type,
      market: marketName,
      teamIndex,
      buttonElement,
      buttonId,
      inline: true,
      openId: Date.now(),
      marketId: extras?.marketId,
      marketType: extras?.marketType,
      marketCode: extras?.marketCode,
      selectionId: extras?.selectionId,
      backOdds: extras?.backOdds,
      layOdds: extras?.layOdds,
      oddsSize: extras?.oddsSize,
      fancyStatus: extras?.fancyStatus,
    })
  }, [isAuthenticated, openAuthModal, openQuickBet])

  const MarketsWithBetSlip = useMemo(() => memo(function MarketsWithBetSlip({ filteredMarkets, expandedMarkets, event, toggleMarket, liveMap, myBets, onOddsClick }: { filteredMarkets: EventDetails['markets']; expandedMarkets: Set<string>; event: EventDetails; toggleMarket: (id: string) => void; liveMap: Record<string, any>; myBets: Bet[]; onOddsClick: (team: string, odds: number, type: 'back' | 'lay', marketName: string, teamIndex: number, e: React.MouseEvent, extras?: any) => void }) {
    const { quickBet } = useBetSlip()

    if (filteredMarkets.length === 0) {
      return (
        <div className="nova-ex-empty nova-ev-empty">
          <strong>No markets open</strong>
          <span>Markets for this event show here as soon as they open for betting.</span>
        </div>
      )
    }

    return (
      <div className="nova-ev-markets">
        {filteredMarkets.map(market => (
          <MarketCard
            key={market.id}
            market={market}
            event={event}
            isExpanded={expandedMarkets.has(market.id)}
            betSlip={quickBet}
            myBets={myBets}
            liveMap={liveMap}
            onToggle={() => toggleMarket(market.id)}
            onOddsClick={onOddsClick}
          />
        ))}
      </div>
    )
  }), [])

  // Memoize filtered markets to keep stable reference between renders
  const filteredMarketsToRender = useMemo(() => {
    const sourceMarkets = filteredMarkets
    return sourceMarkets.filter(market => {
      if (market.name.toLowerCase().includes('toss')) return false
      if (activeTab === 'all') return true
      if (activeTab === 'exchange') {
        return market.type === 'match-odds' || market.name.toLowerCase().includes('tied')
      }
      if (activeTab === 'bookmaker') return market.type === 'bookmaker'
      if (activeTab === 'fancy') return market.type === 'fancy'
      return false
    })
  }, [filteredMarkets, activeTab])

  const marketsVisible = filteredMarketsToRender

  // Subscribe only to priority/visible markets (+ fancy) via a single shared socket
  const marketCodesForLive = useMemo(() => {
    const codes: string[] = []
    // Always include primary match-odds (first match-odds or first market)
    const primary = marketsVisible.find(m => m.type === 'match-odds') || marketsVisible[0]
    if (primary?.marketCode) codes.push(String((primary as any).marketCode))
    // Include expanded markets
    for (const m of marketsVisible) {
      if (expandedMarkets.has(m.id) && (m as any).marketCode) {
        codes.push(String((m as any).marketCode))
      }
    }
    return Array.from(new Set(codes))
  }, [marketsVisible, expandedMarkets])

  const liveMapRaw = useOddsSocket(marketCodesForLive, fancyEventKey ? { eventId: fancyEventKey } : undefined)

  // Time-based throttle (100ms) and reference equality for change detection to avoid heavy JSON.stringify
  const liveMapPendingRef = useRef<Record<string, any>>({})
  const liveMapFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveMapMountedRef = useRef(true)
  const LIVE_MAP_THROTTLE_MS = 100

  useEffect(() => {
    liveMapMountedRef.current = true
    const raw = (liveMapRaw as Record<string, any>) || {}
    liveMapPendingRef.current = { ...raw }

    const flush = () => {
      liveMapFlushTimeoutRef.current = null
      if (!liveMapMountedRef.current) return
      setLiveMapThrottled(prev => {
        const now = Date.now()
        const withTs: Record<string, any> = {}
        let hasAnyChanges = false
        const pending = liveMapPendingRef.current
        for (const k of Object.keys(pending)) {
          const v = pending[k]
          if (v === undefined) continue
          const prevPayload = prev[k]?.payload
          const payloadChanged = prevPayload !== v
          if (payloadChanged) {
            withTs[k] = { payload: v, _ts: now }
            hasAnyChanges = true
          } else {
            withTs[k] = prev[k] || { payload: v, _ts: now }
          }
        }
        const prevKeys = Object.keys(prev).sort().join(',')
        const newKeys = Object.keys(withTs).sort().join(',')
        return (hasAnyChanges || prevKeys !== newKeys) ? withTs : prev
      })
    }

    if (liveMapFlushTimeoutRef.current != null) clearTimeout(liveMapFlushTimeoutRef.current)
    liveMapFlushTimeoutRef.current = setTimeout(flush, LIVE_MAP_THROTTLE_MS)
    return () => {
      liveMapMountedRef.current = false
      if (liveMapFlushTimeoutRef.current != null) {
        clearTimeout(liveMapFlushTimeoutRef.current)
        liveMapFlushTimeoutRef.current = null
      }
    }
  }, [liveMapRaw])

  // Server-driven open bets for the current event and visible markets
  const visibleMarketIds = useMemo(() => {
    // Check if fancy market is visible
    const hasFancyVisible = marketsVisible.some(m => m.type === 'fancy')
    
    // If fancy is visible, fetch all bets for event (fancy market IDs are synthetic on frontend, actual UUIDs in DB)
    if (hasFancyVisible) {
      return undefined // Fetch all bets for the event
    }
    
    // Otherwise, only fetch bets for visible non-fancy markets
    return marketsVisible.map(m => m.id)
  }, [marketsVisible])
  
  const { data: openBets, refresh: refreshOpenBets } = useOpenBets({
    eventId: event?.eventId || event?.id,
    marketIds: visibleMarketIds,
  })
  useEffect(() => { setMyBets(openBets as any) }, [openBets])

  // Refresh open bets on external triggers like successful bet placement
  useEffect(() => {
    const onRefresh = () => refreshOpenBets()
    window.addEventListener('stakex:bet-placed', onRefresh as any)
    // Backward-compat with previous local event name
    window.addEventListener('stakex:my-bets:update', onRefresh as any)
    return () => {
      window.removeEventListener('stakex:bet-placed', onRefresh as any)
      window.removeEventListener('stakex:my-bets:update', onRefresh as any)
    }
  }, [refreshOpenBets])

  // Ensure Fancy market(s) are expanded by default (both in 'All' and 'Fancy' tabs)
  useEffect(() => {
    const fancyIds = marketsAll.filter(m => m.type === 'fancy').map(m => m.id)
    if (fancyIds.length === 0) return
    setExpandedMarkets(prev => {
      const next = new Set(prev)
      fancyIds.forEach(id => next.add(id))
      return next
    })
  }, [marketsAll])

  return (
    <>
      <div className="nova-ex-grid nova-ev">
        <div className="nova-ex-main nova-ev-main">
          {isLoading ? (
            <div className="nova-ev-skeleton" role="status" aria-label="Loading event">
              <span className="is-head" />
              <span className="is-tabs" />
              <span />
              <span />
            </div>
          ) : !event.id ? (
            <div className="nova-ex-empty nova-ev-empty" role="alert">
              <strong>This match could not be loaded</strong>
              <span>It may have ended, or the connection dropped. Try again, or pick another match.</span>
              <span className="nova-ev-empty-actions">
                <button type="button" onClick={() => setLoadAttempt(n => n + 1)}>Try again</button>
                <Link to="/sports">All sports</Link>
              </span>
            </div>
          ) : (
            <>
              <EventHeader
                event={event}
                bookmarked={bookmarked}
                onBookmark={handleBookmark}
                status={status}
                onOpenAnalytics={handleOpenAnalytics}
                timeRemaining={timeRemaining}
                leagueEvents={leagueEvents}
              />

              {/* Mobile Score & TV Tabs - visible only below xl */}
              <MobileScoreTvTabs
                eventId={
                  (event.eventCode != null ? String(event.eventCode) : '') ||
                  event.eventId ||
                  event.id
                }
              />

              {/* Market Tabs */}
              <MarketTabs
                markets={marketsAll}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />

              {/* Markets */}
              <MarketsWithBetSlip filteredMarkets={filteredMarketsToRender} expandedMarkets={expandedMarkets} event={event} toggleMarket={toggleMarket} liveMap={liveMapThrottled} myBets={myBets} onOddsClick={handleOddsClick} />
            </>
          )}
        </div>

        {/* Right column: bet slip, then score & TV. Hidden below 1280px, where the slip opens as a bottom sheet. */}
        <aside className="nova-ex-side nova-ev-side" aria-label="Bet slip and match centre">
          {isLoading ? (
            <>
              <span className="nova-ev-skeleton-block" />
              <span className="nova-ev-skeleton-block" />
            </>
          ) : (
            <>
              {/* Signed in, a picked price opens the slip as a rail drawer (BetSlipDrawer); guests are asked to log in. */}
              {!isAuthenticated && <section className="nova-ev-panel">
                <SectionHeader title="Bet slip" />
                <div className="nova-ev-panel-body">
                  <div className="nova-ev-slip-guest">
                    <p>Log in to bet. Pick a back or lay price and the bet slip opens.</p>
                    <button type="button" onClick={() => openAuthModal('login')}>Log in</button>
                  </div>
                </div>
              </section>}
              <section className="nova-ev-panel">
                <div className="nova-ev-panel-body is-score">
                  <EventSidebar
                    event={event}
                    myBets={myBets}
                    sidebarMode={sidebarMode}
                    onSidebarModeChange={setSidebarMode}
                    analyticsData={analytics}
                  />
                </div>
              </section>
            </>
          )}
        </aside>
      </div>

      {/* Mobile Analytics Drawer - stake state slate colors */}
      {!isLoading && isMobile && mobileAnalyticsOpen && (
            <ModalSurface open onClose={() => setMobileAnalyticsOpen(false)} title="Analytics" titleId="mobile-event-analytics-title" hideHeader size="lg" className="nova-event-analysis-surface nova-event-analysis-mobile">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
                  <div className="flex items-center gap-2">
                    <h2 id="mobile-event-analytics-title" className="font-semibold text-[color:var(--ds-color-slate-100)]">Analytics</h2>
                    <button
                      className="p-1.5 rounded-lg hover:bg-[color:var(--ds-color-slate-700)] transition-colors text-[color:var(--ds-color-slate-400)]"
                      title="Analytics provides real-time insights: Win Probability, Momentum, Odds Movement, and Market Depth. Press ESC to close."
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </div>
                  <button
                    onClick={() => setMobileAnalyticsOpen(false)}
                    className="text-[color:var(--ds-color-slate-300)] text-sm px-3 py-1 rounded-lg hover:bg-[color:var(--ds-color-slate-700)] transition-colors"
                  >
                    Close
                  </button>
                </div>
                
                {/* Tabs Section */}
                <div className="px-4 pt-3 pb-2 bg-[color:var(--ds-color-slate-800)]">
                  <div className="overflow-x-auto scrollbar-hide">
                    <div className="flex flex-nowrap gap-2 min-w-max">
                      <button
                        onClick={() => setMobileAnalyticsTab('match')}
                        className={`flex-shrink-0 px-4 py-2 text-[10px] font-semibold transition-all duration-300 rounded-lg border ${
                          mobileAnalyticsTab === 'match'
                            ? 'bg-[var(--brand-primary)] text-white shadow-lg border-[var(--brand-primary)]/50'
                            : 'bg-[color:var(--ds-color-slate-750)] text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]'
                        }`}
                      >
                        Win %
                      </button>
                      <button
                        onClick={() => setMobileAnalyticsTab('momentum')}
                        className={`flex-shrink-0 px-4 py-2 text-[10px] font-semibold transition-all duration-300 rounded-lg border ${
                          mobileAnalyticsTab === 'momentum'
                            ? 'bg-[var(--brand-primary)] text-white shadow-lg border-[var(--brand-primary)]/50'
                            : 'bg-[color:var(--ds-color-slate-750)] text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]'
                        }`}
                      >
                        Momentum
                      </button>
                      <button
                        onClick={() => setMobileAnalyticsTab('odds')}
                        className={`flex-shrink-0 px-4 py-2 text-[10px] font-semibold transition-all duration-300 rounded-lg border ${
                          mobileAnalyticsTab === 'odds'
                            ? 'bg-[var(--brand-primary)] text-white shadow-lg border-[var(--brand-primary)]/50'
                            : 'bg-[color:var(--ds-color-slate-750)] text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]'
                        }`}
                      >
                        Odds
                      </button>
                      <button
                        onClick={() => setMobileAnalyticsTab('depth')}
                        className={`flex-shrink-0 px-4 py-2 text-[10px] font-semibold transition-all duration-300 rounded-lg border ${
                          mobileAnalyticsTab === 'depth'
                            ? 'bg-[var(--brand-primary)] text-white shadow-lg border-[var(--brand-primary)]/50'
                            : 'bg-[color:var(--ds-color-slate-750)] text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)] border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)]'
                        }`}
                      >
                        Depth
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tab Content */}
                <div className="nova-modal-body p-4 overflow-y-auto max-h-[60vh] bg-[color:var(--ds-color-slate-800)]">
                  {mobileAnalyticsTab === 'match' && (
                    <WinProbabilityMeter
                      homeTeam={event.homeTeam.name}
                      awayTeam={event.awayTeam.name}
                      homeProbability={analytics.winProb.home}
                      awayProbability={analytics.winProb.away}
                      drawProbability={analytics.winProb.draw}
                    />
                  )}

                  {mobileAnalyticsTab === 'momentum' && (
                    <MomentumIndicator
                      homeTeam={event.homeTeam.name}
                      awayTeam={event.awayTeam.name}
                      momentumData={analytics.momentumHistory}
                      currentMomentum={analytics.momentumValue}
                    />
                  )}

                  {mobileAnalyticsTab === 'odds' && (
                    <OddsMovementGraph
                      data={
                        Object.keys(analytics.oddsHistory).length
                          ? analytics.oddsHistory[Object.keys(analytics.oddsHistory)[0]]
                          : []
                      }
                      selection={analytics.primarySelection}
                      height={240}
                    />
                  )}

                  {mobileAnalyticsTab === 'depth' && (
                    <MarketDepthChart
                      backDepth={analytics.depth.back}
                      layDepth={analytics.depth.lay}
                      selection={analytics.primarySelection}
                    />
                  )}
                </div>
            </ModalSurface>
      )}

      {/* Mobile Bet Slip - Shows as bottom sheet */}
      <MobileBetSlipRenderer event={event} />
      <BetSlipDrawer event={event} />

      {/* Desktop Analytics Modal */}
      {!isMobile && !isLoading && desktopAnalyticsOpen && (
        <ModalSurface open onClose={() => setDesktopAnalyticsOpen(false)} title="Analytics" titleId="desktop-event-analytics-title" hideHeader size="lg" className="nova-event-analysis-surface">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
              <div className="flex items-center gap-3">
                <h2 id="desktop-event-analytics-title" className="text-lg font-semibold text-[color:var(--ds-color-slate-100)]">Analytics</h2>
                <button
                  className="group relative p-1.5 rounded-lg hover:bg-[color:var(--ds-color-slate-700)] transition-colors"
                  title="Analytics provides real-time insights: Win Probability, Momentum, Odds Movement, and Market Depth. Press ESC to close."
                >
                  <Info className="h-4 w-4 text-[color:var(--ds-color-slate-400)] group-hover:text-[var(--brand-primary)] transition-colors" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[color:var(--ds-color-slate-400)] hidden sm:inline">Press ESC to close</span>
                <button
                  onClick={() => setDesktopAnalyticsOpen(false)}
                  className="text-[color:var(--ds-color-slate-300)] text-sm px-3 py-1 rounded-lg hover:bg-[color:var(--ds-color-slate-700)] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="nova-modal-body grid grid-cols-1 md:grid-cols-2 gap-5 p-5 max-h-[80vh] overflow-y-auto bg-[color:var(--ds-color-slate-800)]">
              <WinProbabilityMeter
                homeTeam={event.homeTeam.name}
                awayTeam={event.awayTeam.name}
                homeProbability={analytics.winProb.home}
                awayProbability={analytics.winProb.away}
                drawProbability={analytics.winProb.draw}
              />

              <MomentumIndicator
                homeTeam={event.homeTeam.name}
                awayTeam={event.awayTeam.name}
                momentumData={analytics.momentumHistory}
                currentMomentum={analytics.momentumValue}
              />

              <OddsMovementGraph
                data={
                  Object.keys(analytics.oddsHistory).length
                    ? analytics.oddsHistory[Object.keys(analytics.oddsHistory)[0]]
                    : []
                }
                selection={analytics.primarySelection}
                height={260}
              />

              <MarketDepthChart
                backDepth={analytics.depth.back}
                layDepth={analytics.depth.lay}
                selection={analytics.primarySelection}
              />
            </div>
        </ModalSurface>
      )}
    </>
  )
}

// Mobile bet slip renderer component - shows bottom sheet on mobile/tablet (< xl)
function MobileBetSlipRenderer({ event }: { event: EventDetails }) {
  const { quickBet } = useBetSlip()
  const rail = useRailLayout()

  // Only render when there's an active bet, and only on phones: with the rail (801px and up) the slip is a
  // right-hand drawer (BetSlipDrawer).
  if (!quickBet || rail) return null
  
  return <EnterpriseBetSlip bet={quickBet} event={event} variant="mobile" />
}
