import { Clock, Calendar, Bookmark } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatStart } from './utils'
import type { EventItem } from '@/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOddsSocket } from '@/lib/hooks/useOddsSocket'
import footballImg from '@/assets/images/football.png'
import cricketImg from '@/assets/images/cricket.png'
import tennisImg from '@/assets/images/tennis.png'
import { useBookmarkedEvents, useRecentEvents, generateEventId } from '@/lib/sportsHelpers'
// useMemo/useState already imported above
import ConfettiBurst from '../animations/ConfettiBurst'

function ListRow({ e, compact = false }: { e: EventItem, compact?: boolean }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { dayMon, time } = formatStart(e.startISO)
  
  const getSportImage = (sport: string) => {
    switch(sport) {
      case 'football': return footballImg
      case 'cricket': return cricketImg
      case 'tennis': return tennisImg
      default: return ''
    }
  }
  
  const sportImage = getSportImage(e.sport)
  
  const { isBookmarked, toggleBookmark, bookmarkedEvents } = useBookmarkedEvents()
  const { addToRecent } = useRecentEvents()
  const eventId = useMemo(() => generateEventId(e.eventName), [e.eventName])
  // Check if bookmarked by generated ID or backend eventId
  const checkIsBookmarked = useMemo(() => {
    const byId = isBookmarked(eventId)
    const byBackendId = e.eventId ? bookmarkedEvents.some(b => b._eventId === e.eventId) : false
    return byId || byBackendId
  }, [eventId, e.eventId, bookmarkedEvents])
  const [bookmarked, setBookmarked] = useState(() => checkIsBookmarked)
  
  // Sync bookmark state when bookmarks change
  useEffect(() => {
    setBookmarked(checkIsBookmarked)
  }, [checkIsBookmarked])

  // One-time odds snapshot for primary market
  const [snapshot, setSnapshot] = useState<{ back?: number; lay?: number }[] | null>(null)
  const hasSnapshotRef = useRef<boolean>(false)
  const marketCode = e.primaryMarketCode
  const oddsMap = useOddsSocket(marketCode ? [marketCode] : [], { once: !e.isLive, eventId: e.eventId })
  useEffect(() => {
    if (!marketCode && !e.eventId) return
    const live = (oddsMap as any)[marketCode as any] || (e.eventId ? (oddsMap as any)[`bookmaker-${e.eventId}`] : undefined)
    if (!live) return
    // For non-live events, only take the first snapshot once
    if (!e.isLive && hasSnapshotRef.current) return
    try {
      const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
      let liveRunners: any[] = []
      if (Array.isArray(live?.runners)) liveRunners = live.runners as any[]
      else if (Array.isArray(live?.selections)) liveRunners = live.selections as any[]
      else if (live?.runners && typeof live.runners === 'object') liveRunners = Object.values(live.runners as any)
      else if (typeof live === 'object') liveRunners = Object.values(live as any)

      const extract = (runner: any) => {
        const ex = runner?.ex
        if (ex) {
          const atb = Array.isArray(ex.availableToBack) ? ex.availableToBack : []
          const atl = Array.isArray(ex.availableToLay) ? ex.availableToLay : []
          const back = atb.length ? atb[atb.length - 1]?.price : undefined
          const lay = atl.length ? atl[0]?.price : undefined
          return { back, lay }
        }
        return { back: runner?.back, lay: runner?.lay }
      }

      // Try to order as [Home, Draw, Away]: place the one that contains 'draw' in the middle if present
      const idxDraw = liveRunners.findIndex(r => normalize(r?.selectionName ?? r?.runnerName ?? r?.name).includes('draw'))
      let order = [0,1,2]
      if (idxDraw >= 0 && liveRunners.length >= 3) {
        const others = [0,1,2].filter(i => i !== idxDraw)
        order = [others[0], idxDraw, others[1]]
      }
      const picked = order.map(i => liveRunners[i]).filter(Boolean)
      const next = picked.slice(0,3).map(extract)
      // Support 2-runner markets by padding the middle draw slot
      const padded = next.length === 2 ? [next[0], { back: undefined, lay: undefined }, next[1]] : next
      if (padded.length >= 2) {
        setSnapshot(padded as any)
        hasSnapshotRef.current = true
      }
    } catch { /* ignore */ }
  }, [oddsMap, marketCode, e.eventId, e.isLive])

  const handleEventClick = () => {
    // Generate slug from event name and prefer backend event id for disambiguation
    const slugId = generateEventId(e.eventName)
    addToRecent(e)
    const url = e.eventId ? `/sports/event/${slugId}?id=${e.eventId}` : `/sports/event/${slugId}`
    navigate(url)
  }

  const handleToggleBookmark = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    toggleBookmark(e)
    setBookmarked(v => !v)
  }
  
  return (
    <div className={`w-full text-left group relative bg-transparent hover:bg-[color:var(--ds-color-slate-850)] transition-colors duration-200 rounded-[5px] overflow-hidden ${compact ? 'py-2.5 px-3 sm:px-4' : 'py-3 px-3 sm:px-4'}`}>
      <button
        type="button"
        aria-label={`${t('nova.openMatch')}: ${e.eventName}`}
        onClick={handleEventClick}
        className="absolute inset-0 z-0 w-full cursor-pointer rounded-[5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--nova-accent)]"
      />
      {/* Mobile: Stacked Layout, Desktop: Single Row */}
      <div className="pointer-events-none relative z-[1] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        
        {/* Left: Image + Time + Event Info */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {sportImage && (
            <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors">
              <img 
                src={sportImage} 
                alt={e.sport} 
                className={`${compact ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-5 h-5 sm:w-6 sm:h-6'} object-contain opacity-80 group-hover:opacity-100 transition-opacity sport-img`} 
              />
            </div>
          )}
          
          {/* Date/Time Section - Hidden on mobile, shown on tablet+ */}
          <div className="hidden sm:flex flex-col gap-0.5 px-2 py-1.5 rounded-[5px] bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)] text-[color:var(--ds-color-slate-300)] flex-shrink-0">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3 flex-shrink-0" />
              <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium`}>{dayMon}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 flex-shrink-0" />
              <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-medium`}>{time}</span>
            </div>
          </div>
          
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'} text-[color:var(--text)] leading-tight`}>
                {e.eventName}
              </h3>
            </div>
            <div className="sm:block">
              <p className={`text-[color:var(--ds-color-slate-400)] truncate ${compact ? 'text-xs' : 'text-sm'} font-normal mt-0`}>
                {e.league}
              </p>
            </div>
          </div>

          {/* Mobile meta: LIVE + datetime on the right */}
          <div className="sm:hidden flex flex-col items-end gap-0.5 ml-2">
              {e.isLive && (
              <span className="px-2 py-1 rounded-[5px] text-[9px] font-semibold text-white bg-emerald-500 inline-flex items-center gap-1 flex-shrink-0 animate-pulse">
                <div className="w-1.5 h-1.5 rounded-[5px] bg-white animate-pulse" />
                {t('nova.live')}
              </span>
            )}
            <div className="flex items-center gap-0.5 mt-1">
              <span className="text-[10px] text-[color:var(--ds-color-slate-400)] font-medium bg-[color:var(--ds-color-slate-800)] px-2 py-0.5 rounded-[5px] border border-[color:var(--ds-color-slate-600)]">
                {dayMon} {time}
              </span>
            </div>
          </div>
        </div>
        
        {/* Right: Odds (responsive) */}
        <div className="flex-shrink-0 w-full sm:w-auto flex items-center justify-end gap-2 sm:gap-2">
          {/* Desktop: LIVE pill next to bookmark */}
          {e.isLive && (
            <span className="hidden sm:inline-flex px-2.5 py-1 rounded-[5px] text-[10px] font-semibold text-white bg-emerald-500 items-center gap-1 flex-shrink-0 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-[5px] bg-white animate-pulse" />
              {t('nova.live')}
            </span>
          )}
          <button
            type="button"
              aria-label={bookmarked ? t('nova.removeBookmark') : t('nova.addBookmark')}
            onClick={handleToggleBookmark}
              className="pointer-events-auto relative z-[2] h-7 w-7 rounded-[5px] bg-[color:var(--ds-color-slate-800)] border border-[color:var(--ds-color-slate-600)] grid place-items-center overflow-visible flex-shrink-0 order-2 sm:order-1 hover:bg-[color:var(--ds-color-slate-750)]"
          >
            <Bookmark
              className={`h-3.5 w-3.5 transition-colors duration-200 ${
                bookmarked
                  ? "text-amber-400"
                  : "text-[color:var(--ds-color-slate-400)]"
              }`}
              fill={bookmarked ? "currentColor" : "none"}
              style={bookmarked ? { animation: "heart-burst 180ms ease" } : undefined}
            />
            {bookmarked && (
              <ConfettiBurst
                className="absolute inset-0"
                particleCount={5}
                durationMs={450}
                spread={14}
              />
            )}
          </button>
          <div className={`grid grid-cols-3 sm:flex gap-1 sm:gap-1.5 flex-1 min-w-0 order-1 sm:order-2`}>
            {[0, 1, 2].map((index) => {
              const r = e.runners[index]
              return (
                <div
                  key={index}
                  className="py-1.5 sm:min-w-[120px]"
                >
                  <div className="grid grid-cols-2 gap-1 sm:gap-1.5">
                    <span
                      className={`nova-odds-back ${compact ? 'py-2 text-[10px] sm:text-[11px]' : 'py-2.5 text-xs sm:text-sm'} text-center rounded-[5px] border font-semibold`}
                    >
                      {snapshot?.[index]?.back !== undefined ? Number(snapshot[index]!.back).toFixed(2) : (r && typeof r.back === 'number' ? r.back.toFixed(2) : '-')}
                    </span>
                    <span
                      className={`nova-odds-lay ${compact ? 'py-2 text-[10px] sm:text-[11px]' : 'py-2.5 text-xs sm:text-sm'} text-center rounded-[5px] border font-semibold`}
                    >
                      {snapshot?.[index]?.lay !== undefined ? Number(snapshot[index]!.lay).toFixed(2) : (r && typeof r.lay === 'number' ? r.lay.toFixed(2) : '-')}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        
      </div>
    </div>
  )
}

// Export the ListRow function for use in other components
export { ListRow }

