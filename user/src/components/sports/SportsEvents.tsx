import { Zap, ArrowRight, ChevronUp, ChevronDown, CalendarDays, RefreshCw, SearchX } from 'lucide-react'
import { useMemo, useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { EventItem, SportType } from '@/types'
import { normalizeSportKey, useSportsEventsData } from './useSportsEventsData'
import { ListRow } from './LeaguesEventsList'

type LeagueGroup = { league: string; events: EventItem[] }
const COMPACT_EVENT_LIMIT = 8

export type SportsEventsState = {
  events: EventItem[]
  loading: boolean
  error: string | null
}

type SportsEventsProps = {
  compact?: boolean
  sportFilter?: SportType
  statusFilter?: 'all' | 'live' | 'upcoming'
  onResetFilters?: () => void
  onStateChange?: (state: SportsEventsState) => void
}

export default function SportsEvents({ compact = false, sportFilter, statusFilter = 'all', onResetFilters, onStateChange }: SportsEventsProps) {
  const { t } = useTranslation()
  const { events: allEvents, loading, error, reload } = useSportsEventsData()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggleLeague = useCallback((league: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(league)) next.delete(league)
      else next.add(league)
      return next
    })
  }, [])


  const visibleEvents = useMemo(() => {
    const now = Date.now()
    const filtered = allEvents.filter(event => {
      if (sportFilter && event.sport !== sportFilter) return false
      if (statusFilter === 'live') return Boolean(event.isLive)
      if (statusFilter === 'upcoming') return !event.isLive && new Date(event.startISO).getTime() >= now
      return true
    })
    if (!compact) return filtered
    const eventTime = (event: EventItem) => {
      const value = new Date(event.startISO).getTime()
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
    }

    return [...filtered].sort((a, b) => {
      if (Boolean(a.isLive) !== Boolean(b.isLive)) return a.isLive ? -1 : 1

      const aTime = eventTime(a)
      const bTime = eventTime(b)
      if (a.isLive && b.isLive) return bTime - aTime

      const aUpcoming = aTime >= now
      const bUpcoming = bTime >= now
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1
      if (aTime !== bTime) return aUpcoming ? aTime - bTime : bTime - aTime
      return a.eventName.localeCompare(b.eventName)
    }).slice(0, COMPACT_EVENT_LIMIT)
  }, [allEvents, compact, sportFilter, statusFilter])

  useEffect(() => {
    onStateChange?.({ events: allEvents, loading, error })
  }, [allEvents, error, loading, onStateChange])

  const leagueGroups = useMemo<LeagueGroup[]>(() => {
    const map = new Map<string, EventItem[]>()
    for (const e of visibleEvents) {
      const key = e.league || t('nova.availableEvents')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    const groups: LeagueGroup[] = []
    map.forEach((events, league) => groups.push({ league, events }))
    return groups
  }, [t, visibleEvents])

  return (
    <section className="nova-live-markets rounded-xl overflow-hidden border border-[color:var(--ds-color-slate-700)] bg-[color:var(--ds-color-slate-900)]" aria-label={t('nova.liveUpcoming')}>
      {/* Compact home already provides its market heading and status filters. */}
      {!compact && <div className="flex items-center justify-between px-3 py-3 sm:px-4 sm:py-3.5 bg-[color:var(--ds-color-slate-800)] border-b border-[color:var(--ds-color-slate-700)]">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-[color:var(--ds-color-slate-100)] leading-tight">{t('nova.marketCentreHeading')}</h2>
            <p className="text-[11px] text-[color:var(--ds-color-slate-450)] mt-0.5 hidden sm:block">
              {t('nova.sportsHeroCopy')}
            </p>
          </div>
        </div>
        <Link
          to="/sports"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 hover:bg-[color:var(--brand-primary)]/20 transition-colors"
        >
          {t('nova.allSports')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>}

      {/* Content */}
      <div className="nova-live-markets-content">
        {loading && (
          <div className="nova-market-loading" role="status" aria-live="polite">
            <span>{t('nova.loadingEvents')}</span>
            <div className="nova-market-skeletons" aria-hidden="true">{[0, 1, 2].map(index => <div key={index}><i /><span><b /><b /></span><i /></div>)}</div>
          </div>
        )}

        {error && !loading && (
          <div className="nova-market-state" role="alert">
            <span className="nova-market-state-icon"><RefreshCw size={26} /></span>
            <div className="nova-market-state-copy"><h3>{t('nova.eventLoadError')}</h3></div>
            <button type="button" className="nova-button nova-button-secondary" onClick={reload}><RefreshCw size={16} />{t('nova.tryAgain')}</button>
          </div>
        )}

        {!loading && !error && leagueGroups.length === 0 && (
          <div className="nova-market-state" role="status">
            <span className="nova-market-state-icon">{sportFilter || statusFilter !== 'all' ? <SearchX size={26} /> : <CalendarDays size={26} />}</span>
            <div className="nova-market-state-copy">
              <h3>{t(sportFilter || statusFilter !== 'all' ? 'nova.noFilterMatches' : 'nova.noFeaturedMatchTitle')}</h3>
              <p>{t('nova.noFeaturedMatchCopy')}</p>
            </div>
            {(sportFilter || statusFilter !== 'all') && onResetFilters && <button type="button" className="nova-button nova-button-secondary" onClick={onResetFilters}>{t('nova.resetFilters')} <ArrowRight size={16} /></button>}
            {!sportFilter && statusFilter === 'all' && <Link to="/sports" className="nova-button nova-button-secondary">{t('nova.allSports')} <ArrowRight size={16} /></Link>}
          </div>
        )}

        {!loading && !error && leagueGroups.length > 0 && leagueGroups.map((group, groupIndex) => {
          const isCollapsed = collapsed.has(group.league)
          const leagueRegionId = `sports-league-${normalizeSportKey(group.league) || groupIndex}`
          return (
            <div key={group.league}>
              {/* League header */}
              <button
                type="button"
                aria-expanded={!isCollapsed}
                aria-controls={leagueRegionId}
                onClick={() => toggleLeague(group.league)}
                className="w-full flex items-center justify-between px-3 py-2.5 sm:px-4 bg-[color:var(--ds-color-slate-850)] border-b border-[color:var(--ds-color-slate-700)]/60 cursor-pointer hover:bg-[color:var(--ds-color-slate-800)] transition-colors select-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-[5px] bg-[color:var(--brand-primary)] flex-shrink-0" />
                  <span className="text-xs font-bold text-[color:var(--ds-color-slate-100)] uppercase tracking-wide truncate">
                    {group.league}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-semibold text-[color:var(--ds-color-slate-400)]">
                    {group.events.length}
                  </span>
                  {isCollapsed
                    ? <ChevronDown className="h-3.5 w-3.5 text-[color:var(--ds-color-slate-400)]" />
                    : <ChevronUp className="h-3.5 w-3.5 text-[color:var(--ds-color-slate-400)]" />
                  }
                </div>
              </button>

              {/* Event rows */}
              {!isCollapsed && (
                <div id={leagueRegionId} className="divide-y divide-[color:var(--ds-color-slate-700)]/40">
                  {group.events.map((e, idx) => (
                    <ListRow key={e.eventId || idx} e={e} compact={compact} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {!loading && leagueGroups.length > 0 && (
        <Link
          to="/sports"
          className="flex items-center justify-center gap-2 px-4 py-3 bg-[color:var(--ds-color-slate-800)] border-t border-[color:var(--ds-color-slate-700)] text-sm font-semibold text-[color:var(--brand-primary)] hover:bg-[color:var(--ds-color-slate-750)] transition-colors"
        >
          {t('nova.allSports')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </section>
  )
}
