import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Search, Trophy, Gamepad2, Clock, ChevronRight, Loader2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import type { CasinoCardItem, EventItem, SportType } from '@/types'
import { formatStart } from '../sports/utils'
import CricketImg from '../../assets/images/cricket.png'
import TennisImg from '../../assets/images/tennis.png'
import FootballImg from '../../assets/images/football.png'
import { getCasinoGames, getSportsList, getCasinoUrl } from '@/lib/api/user'
import { getSelectedWallet } from '@/lib/walletUtils'
import { useSportsEvents, generateEventId } from '@/lib/sportsHelpers'
import { useAuth } from '@/lib/auth'
import { useFeatureFlags, useSportsIconStyle } from '@/hooks/useAppSettings'
import { sportIcon, sportIconClass } from '@/components/nova/exchange-home/exchangeShared'

function getSportImage(sport: SportType) {
  switch (sport) {
    case 'cricket':
      return CricketImg
    case 'tennis':
      return TennisImg
    case 'football':
    default:
      return FootballImg
  }
}

function highlightMatch(text: string, query: string) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={idx} className="px-0.5 rounded bg-[color:var(--mb-red-bg)] text-[color:var(--mb-red-ink)]">{part}</mark>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </>
  )
}

// Debounce utility
function useDebouncedValue(value: string, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

function SearchModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const iconStyle = useSportsIconStyle()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [isMounted, setIsMounted] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const previousRoute = useRef(location.pathname + location.search)
  const { addToRecent } = useSportsEvents()
  const { isAuthenticated, openAuthModal } = useAuth()
  const features = useFeatureFlags()
  const sportsEnabled = features?.sportsEnabled ?? true
  const casinoEnabled = features?.casinoEnabled ?? true

  // Casino results state
  const [casinoLoading, setCasinoLoading] = useState(false)
  const [casinoError, setCasinoError] = useState(false)
  const [casinoResults, setCasinoResults] = useState<CasinoCardItem[]>([])
  // Sports events cache and derived results
  const [sportsLoading, setSportsLoading] = useState(false)
  const [sportsError, setSportsError] = useState(false)
  const [allSportsEvents, setAllSportsEvents] = useState<EventItem[] | null>(null)
  const [launchingGameId, setLaunchingGameId] = useState<string | null>(null)
  const [launchError, setLaunchError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!isOpen || !dialog) { setIsMounted(false); return }
    const returnFocus = document.activeElement as HTMLElement | null
    const id = requestAnimationFrame(() => setIsMounted(true))
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    inputRef.current?.focus()
    return () => {
      cancelAnimationFrame(id)
      if (dialog.open) dialog.close()
      document.body.style.overflow = prevOverflow
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const next = location.pathname + location.search
    if (previousRoute.current !== next && isOpen) onClose()
    previousRoute.current = next
  }, [location.pathname, location.search, isOpen, onClose])

  // Clear disabled-module state when features are off (avoid stale results)
  useEffect(() => {
    if (!casinoEnabled) setCasinoResults([])
    if (!sportsEnabled) setAllSportsEvents(null)
  }, [casinoEnabled, sportsEnabled])

  // Fetch casino games (both live and slots) when query changes (only if casino enabled)
  useEffect(() => {
    if (!isOpen || !casinoEnabled) {
      setCasinoResults([])
      setCasinoError(false)
      setCasinoLoading(false)
      return
    }
    const q = debouncedQuery.trim()
    if (!q) {
      setCasinoResults([])
      setCasinoError(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        setCasinoLoading(true)
        setCasinoError(false)
        const [liveRes, slotsRes] = await Promise.all([
          getCasinoGames({ search: q, page: 1, limit: 6, liveOnly: true }),
          getCasinoGames({ search: q, page: 1, limit: 6, slots: true }),
        ])
        const map = new Map<string, CasinoCardItem>()
        const mapGame = (g: any): CasinoCardItem | null => {
          if (!g) return null
          const title = g?.title || g?.game_name || g?.name || g?.gameName || ''
          const provider = g?.provider_name || g?.provider || g?.vendorName || g?.vendor || 'Provider'
          const category = g?.category || g?.mainCategory || ''
          const imageUrl =
            g?.imageUrl ||
            g?.thumbnail ||
            g?.thumbnailUrl ||
            g?.image ||
            g?.game_images ||
            g?.gameImages ||
            g?.imageUrlThumb ||
            '/dice-bg.svg'
          const gameIdRaw = g?.gameId || g?.game_id || g?.id || g?.externalId || g?.gameID
          const gameId = gameIdRaw != null ? String(gameIdRaw) : ''
          if (!gameId) return null
          return { title: title || 'Game', provider, imageUrl, gameId, category }
        }
        const mapInto = (res: any) => {
          const arr = Array.isArray(res?.data) ? res.data : []
          for (const g of arr) {
            const item = mapGame(g)
            if (!item) continue
            const key = `${item.gameId}|${item.provider}`
            if (!map.has(key)) map.set(key, item)
          }
        }
        mapInto(liveRes)
        mapInto(slotsRes)
        if (!cancelled) setCasinoResults(Array.from(map.values()).slice(0, 10))
      } catch {
        if (!cancelled) { setCasinoResults([]); setCasinoError(true) }
      } finally {
        if (!cancelled) setCasinoLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, casinoEnabled, isOpen])

  // Ensure we have sports events cached once the user starts searching (only if sports enabled)
  useEffect(() => {
    if (!isOpen || !sportsEnabled) { setSportsError(false); setSportsLoading(false); return }
    const q = debouncedQuery.trim()
    if (!q) return
    if (allSportsEvents !== null) return
    let cancelled = false
    ;(async () => {
      try {
        setSportsLoading(true)
        setSportsError(false)
        const res = await getSportsList()
        const sports: any[] = Array.isArray(res?.data) ? res.data : []
        const events: EventItem[] = []
        for (const sport of sports) {
          const sportName: string = (sport?.slugName || sport?.name || 'football').toString().toLowerCase()
          const leagues: any[] = Array.isArray(sport?.leagues) ? sport.leagues : []
          for (const lg of leagues) {
            const leagueName: string = (lg?.name || lg?.slugName || 'League').toString()
            const lgEvents: any[] = Array.isArray(lg?.events) ? lg.events : []
            for (const ev of lgEvents) {
              const start = ev?.date ? new Date(ev.date).toISOString() : new Date().toISOString()
              events.push({
                eventId: String(ev?.id || ev?._id || ''),
                sport: (sportName || 'football') as any,
                eventName: (ev?.name || ev?.slugName || 'Event').toString(),
                league: leagueName,
                startISO: start,
                isLive: false,
                runners: [
                  { name: 'Home' },
                  { name: 'Draw' },
                  { name: 'Away' },
                ],
              })
            }
          }
        }
        if (!cancelled) setAllSportsEvents(events)
      } catch {
        if (!cancelled) { setAllSportsEvents(null); setSportsError(true) }
      } finally {
        if (!cancelled) setSportsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, allSportsEvents, sportsEnabled, isOpen])

  const filteredGames = casinoEnabled ? casinoResults : []
  const filteredEvents = useMemo(() => {
    if (!sportsEnabled) return []
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return []
    const list = Array.isArray(allSportsEvents) ? allSportsEvents : []
    return list.filter(e =>
      e.eventName.toLowerCase().includes(q) ||
      e.league.toLowerCase().includes(q) ||
      e.runners.some(r => (r.name || '').toLowerCase().includes(q))
    ).slice(0, 10)
  }, [debouncedQuery, allSportsEvents, sportsEnabled])

  const hasResults = filteredEvents.length > 0 || filteredGames.length > 0
  const waitingForQuery = query.trim() !== debouncedQuery.trim()
  const hasMoreEvents = false
  const hasMoreGames = false

  if (!isOpen) return null

  const overlay = (
    <dialog ref={dialogRef}
      className={`nova-search-dialog fixed inset-0 m-0 h-full w-full max-h-none max-w-none border-0 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-24 lg:pb-4 transition-opacity duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${isMounted ? 'opacity-100' : 'opacity-0'}`}
      aria-labelledby="search-modal-title"
      onCancel={onClose}
      onClose={event => { if (!event.currentTarget.open) onClose() }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        backdropFilter: 'blur(16px) saturate(160%)',
        WebkitBackdropFilter: 'blur(16px) saturate(160%)',
        background: 'rgba(12, 12, 16, 0.35)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)'
      }}
    >
      <div
        className={`relative w-full max-w-3xl max-h-[calc(100vh-6rem)] lg:max-h-[90vh] sm:rounded-3xl rounded-t-3xl overflow-hidden flex flex-col min-h-0 transform transition-all duration-300 ease-[cubic-bezier(.16,1,.3,1)] bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)] shadow-xl ${isMounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.98] translate-y-1.5'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col min-h-0 flex-1">
        <div className="relative overflow-hidden sticky top-0 z-10">
          <div className="absolute inset-0 bg-[color:var(--brand-primary)]/5" />
          <div className="relative px-4 sm:px-6 py-4 sm:py-5 border-b border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3">
                <div className="relative h-9 w-9 sm:h-10 sm:w-10 rounded-2xl grid place-items-center text-[color:var(--mb-on-red)] bg-[color:var(--brand-primary)]">
                  <Search className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="search-modal-title" className="text-base sm:text-lg font-bold text-[color:var(--ds-color-slate-100)]">{t('nova.searchTeamsMarkets')}</h2>
                  <p className="text-[11px] sm:text-xs text-[color:var(--ds-color-slate-400)] mt-0.5">{t('userPanel.searchHint', { defaultValue: 'Find events and casino games' })}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-[color:var(--ds-color-slate-700)] transition-all duration-200 inline-flex items-center gap-2 group active:scale-95"
                aria-label={t('common.close')}
              >
                <span className="hidden lg:inline text-[10px] px-2 py-1 rounded-md bg-[color:var(--ds-color-slate-700)] text-[color:var(--ds-color-slate-100)]">ESC</span>
                <X className="h-5 w-5 text-[color:var(--ds-color-slate-400)] group-hover:text-[color:var(--ds-color-slate-100)]" />
              </button>
            </div>
            
            <div className="mt-4">
              <div className="relative">
                <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <Search className="h-4 w-4 text-[color:var(--subtle)]" />
                  <div className="hidden sm:block w-px h-4 bg-[color:var(--border)]" />
                </div>
                <input
                  ref={inputRef}
                  aria-label={t('nova.searchTeamsMarkets')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('userPanel.searchPlaceholder', { defaultValue: 'Search events, games or providers…' })}
                  className="w-full pl-10 sm:pl-16 pr-12 py-3 rounded-xl bg-gradient-to-b from-[color:var(--surface)]/10 to-[color:var(--surface-2)]/10 border border-[color:var(--border)]/40 text-[color:var(--text)] placeholder:italic placeholder-[color:var(--subtle)]/80 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]/30 focus:border-[color:var(--brand-primary)]/50 focus:from-[color:var(--surface)]/20 focus:to-[color:var(--surface-2)]/20 transition-all duration-200"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    aria-label={t('userPanel.searchClear', { defaultValue: 'Clear search' })}
                    onClick={() => { setQuery(''); setTimeout(() => inputRef.current?.focus(), 0) }}
                    className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-[color:var(--subtle)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-3)]/60 transition-all duration-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
              <div className="h-20 w-20 rounded-3xl bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 grid place-items-center mb-6 shadow-soft">
                <Search className="h-10 w-10 text-[color:var(--brand-primary)]" />
              </div>
              <h3 className="text-xl font-bold text-[color:var(--text)] mb-2">Ready to explore?</h3>
              <p className="text-sm text-[color:var(--subtle)] max-w-md">
                {!sportsEnabled && !casinoEnabled
                  ? 'Search is not available for this site.'
                  : 'Search for sports events, casino games, slots, providers, and more. Try "IPL" or "Roulette".'}
              </p>
            </div>
          ) : waitingForQuery || ((casinoLoading || sportsLoading) && !hasResults) ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
              <div className="h-20 w-20 rounded-3xl bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 grid place-items-center mb-6 shadow-soft">
                <Loader2 className="h-10 w-10 text-[color:var(--subtle)] animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-[color:var(--text)] mb-2">Searching…</h3>
              <p className="text-sm text-[color:var(--subtle)] max-w-md">Fetching live results for "{query.trim()}"</p>
            </div>
          ) : !hasResults && (casinoError || sportsError) ? (
            <div className="py-12 px-6 text-center" role="alert">{t('userPanel.searchError', { defaultValue: 'Search results could not be loaded. Please try another search.' })}</div>
          ) : !hasResults ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
              <div className="h-20 w-20 rounded-3xl bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 grid place-items-center mb-6 shadow-soft">
                <Search className="h-10 w-10 text-[color:var(--subtle)]" />
              </div>
              <h3 className="text-xl font-bold text-[color:var(--text)] mb-2">No matches found</h3>
              <p className="text-sm text-[color:var(--subtle)] max-w-md">
                {!sportsEnabled && !casinoEnabled
                  ? 'Search has no modules enabled for this site.'
                  : 'Try adjusting your search terms. Popular searches: "Cricket", "Slots", "Evolution".'}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-8">
              {/* Events Section */}
              {filteredEvents.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="h-8 w-8 rounded-lg bg-[color:var(--brand-primary)] border border-[color:var(--border)]/50 grid place-items-center text-[color:var(--text)]">
                      <Trophy className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-medium text-[color:var(--text)]">Sports Events</h3>
                    <span className="text-[10px] font-medium text-[color:var(--subtle)] bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 px-2 py-0.5 rounded-[5px]">{filteredEvents.length}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredEvents.map((e, idx) => (
                      <div key={e.eventName + idx} className="group rounded-xl relative border border-[color:var(--border)]/40 bg-[color:var(--surface-2)]/20 hover:bg-[color:var(--surface-2)]/40 transition-colors duration-200">
                        <div className="p-3.5 flex items-start gap-3">
                          <div className="h-10 w-10 rounded-lg overflow-hidden ring-1 ring-[color:var(--border)]/50 bg-[color:var(--surface)]/70 shrink-0 grid place-items-center">
                            <img src={sportIconClass(e.sport, iconStyle) ? sportIcon(e.sport, iconStyle) : getSportImage(e.sport)} alt={`${e.sport} icon`} className={sportIconClass(e.sport, iconStyle, 'h-6 w-6 object-contain sport-img')} loading="lazy" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[color:var(--text)] truncate">{highlightMatch(e.eventName, query)}</div>
                            <div className="text-[11px] text-[color:var(--subtle)] truncate">{highlightMatch(e.league, query)}</div>
                            <div className="mt-2 flex items-center gap-2">
                              {e.isLive ? (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-emerald-500/20 text-emerald-300 inline-flex items-center gap-1 font-medium border border-emerald-500/30">
                                  <span className="h-1.5 w-1.5 rounded-[5px] bg-emerald-300 animate-pulse" /> LIVE
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 text-[color:var(--subtle)] inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" /> {(() => {
                                    const { dayMon, time } = formatStart(e.startISO)
                                    return `${dayMon} • ${time}`
                                  })()}
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 text-[color:var(--subtle)] capitalize">{e.sport}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              addToRecent(e)
                              const slugId = generateEventId(e.eventName)
                              onClose()
                              const url = (e as any)?.eventId ? `/sports/event/${slugId}?id=${(e as any).eventId}` : `/sports/event/${slugId}`
                              navigate(url)
                            }}
                            className="ml-1 shrink-0 h-8 w-8 rounded-lg border border-[color:var(--border)]/50 text-[color:var(--subtle)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-3)]/60 transition-colors"
                            aria-label="View Event"
                          >
                            <ChevronRight className="h-4 w-4 mx-auto" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {hasMoreEvents && (
                      <button className="w-full py-2.5 text-xs font-medium text-[color:var(--brand-primary)] hover:bg-[color:var(--surface-2)]/30 rounded-lg transition-colors border border-[color:var(--border)]/40">
                        See more events...
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Games Section */}
              {filteredGames.length > 0 && (
                <div>
                  <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="h-8 w-8 rounded-lg bg-[color:var(--brand-primary)] border border-[color:var(--border)]/50 grid place-items-center text-[color:var(--text)]">
                      <Gamepad2 className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-medium text-[color:var(--text)]">Casino & Slots</h3>
                    <span className="text-[10px] font-medium text-[color:var(--subtle)] bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 px-2 py-0.5 rounded-[5px]">{filteredGames.length}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredGames.map((g, idx) => (
                      <div key={g.title + idx} className="group rounded-xl relative border border-[color:var(--border)]/40 bg-[color:var(--surface-2)]/20 hover:bg-[color:var(--surface-2)]/40 transition-colors duration-200">
                        <div className="p-3.5 flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg overflow-hidden ring-1 ring-[color:var(--border)]/50 bg-[color:var(--surface)]/70 shrink-0 grid place-items-center">
                            {g.imageUrl ? (
                              <img src={g.imageUrl} alt={`${g.title} thumbnail`} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="h-full w-full grid place-items-center text-base text-[color:var(--subtle)]">
                                <span className="font-semibold">{g.title.charAt(0)}</span>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[color:var(--text)] truncate">{highlightMatch(g.title, query)}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-[color:var(--subtle)] truncate">{highlightMatch(g.provider, query)}</span>
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-[color:var(--surface-2)]/60 border border-[color:var(--border)]/40 text-[color:var(--subtle)] capitalize">
                                {g.category ? g.category.replace(/_/g, ' ') : 'casino'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              if (!isAuthenticated) { onClose(); openAuthModal('login'); return }
                              const gameId = g.gameId
                              if (!gameId) {
                                onClose()
                                const q = query.trim()
                                navigate(`/casino${q ? `?q=${encodeURIComponent(q)}` : ''}`)
                                return
                              }
                              if (launchingGameId) return
                              setLaunchError(null)
                              setLaunchingGameId(gameId)
                              try {
                                const res = await getCasinoUrl(gameId, getSelectedWallet())
                                const url = (res as any)?.data?.redirectUrl || res?.data?.redirectUrl
                                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                                  window.open(url, '_self')
                                } else {
                                  // A 403 refusal carries a player-facing reason (e.g. betting suspended by the agent).
                                  setLaunchError(res?.meta?.code === 403 && res.meta.message ? res.meta.message : 'Game unavailable. Please try again later.')
                                }
                              } catch (err: any) {
                                setLaunchError(err?.message || 'Failed to launch')
                                // fallback: navigate to casino list
                                const q = query.trim()
                                navigate(`/casino${q ? `?q=${encodeURIComponent(q)}` : ''}`)
                              } finally {
                                setLaunchingGameId(null)
                              }
                            }}
                            className={`ml-1 shrink-0 h-8 w-8 rounded-lg border border-[color:var(--border)]/50 text-[color:var(--subtle)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-3)]/60 transition-colors ${launchingGameId === (g.gameId || '') ? 'opacity-80 pointer-events-none' : ''}`}
                            aria-label="Play Now"
                          >
                            {launchingGameId === (g.gameId || '') ? (
                              <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                            ) : (
                              <ChevronRight className="h-4 w-4 mx-auto" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                    {hasMoreGames && (
                      <button
                        onClick={() => {
                          onClose()
                          const q = query.trim()
                          navigate(`/casino${q ? `?q=${encodeURIComponent(q)}` : ''}`)
                        }}
                        className="w-full py-2.5 text-xs font-medium text-[color:var(--brand-primary)] hover:bg-[color:var(--surface-2)]/30 rounded-lg transition-colors border border-[color:var(--border)]/40"
                      >
                        See more games...
                      </button>
                    )}
                  </div>
                </div>
              )}
              {launchError && (
                <div className="px-2 text-[11px] text-red-400">{launchError}</div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </dialog>
  )

  return createPortal(overlay, document.body)
}

export default SearchModal
export { SearchModal }


