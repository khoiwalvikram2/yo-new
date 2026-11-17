import { Tv, BarChart3, History, ChevronDown } from 'lucide-react'
import type { EventDetails, Bet } from './types'
import BetHistoryTimeline from './BetHistoryTimeline'
import { betsForEvent } from './eventBets'
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { getScoreboardUrl, getLiveTvUrl } from '@/lib/sportsStreamUrls'
import { useAppSettings } from '@/lib/app-settings'

interface EventSidebarProps {
  event: EventDetails
  myBets: Bet[]
  sidebarMode: 'score' | 'tv'
  onSidebarModeChange: (mode: 'score' | 'tv') => void
  analyticsData?: unknown
}

export default function EventSidebar({ 
  event, 
  myBets, 
  sidebarMode, 
  onSidebarModeChange,
}: EventSidebarProps) {
  const { isAuthenticated } = useAuth()
  const { parsedSettings } = useAppSettings()
  const [isScoreExpanded, setIsScoreExpanded] = useState(true)
  const [isMyBetsExpanded, setIsMyBetsExpanded] = useState(true)
  const betCount = betsForEvent(myBets, event.eventId || event.id || '').length
  // Tabs always visible; real URLs only for grandwinn-com — others get blank/placeholder
  const urlEnabled = parsedSettings.features.liveTvAndScoreCardEnabled === true
  // Prefer provider eventCode for score/TV embeds; internal ids often fail on third-party APIs.
  const eventId = (
    (event.eventCode != null ? String(event.eventCode) : '') ||
    event.eventId ||
    event.id
  ).trim()
  const scoreboardUrl = urlEnabled ? getScoreboardUrl(eventId) : ''
  const liveTvUrl = urlEnabled ? getLiveTvUrl(eventId) : ''
  
  return (
    <div className="w-full space-y-4">
      {/* Score & TV Section - tabs always shown; iframe URLs only for grandwinn-com */}
      <div className="pb-4 transition-all duration-200">
        <button
          onClick={() => setIsScoreExpanded(!isScoreExpanded)}
          className="w-full px-0 py-2 flex items-center justify-between border-b border-[color:var(--ds-color-slate-600)] transition-colors"
        >
        <div className="flex items-center gap-2">
          <Tv className="h-4 w-4 text-[color:var(--brand-primary)]" />
            <span className="font-semibold text-sm text-[color:var(--ds-color-slate-100)]">Score & TV</span>
        </div>
          <ChevronDown 
            className={`h-4 w-4 text-[color:var(--ds-color-slate-400)] transition-transform duration-300 ${
              isScoreExpanded ? 'rotate-180' : ''
            }`}
          />
        </button>
        
        <div 
          className={`transition-all duration-300 ease-in-out ${
            isScoreExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
          } overflow-hidden`}
        >
          <div className="pt-3 pb-4">
        <div className="relative flex p-1 bg-[color:var(--ds-color-slate-750)] rounded-[5px] mb-4">
          <div 
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-[5px] bg-[color:var(--brand-primary)] shadow-lg transition-all duration-300 ease-out ${
              sidebarMode === 'tv' ? 'left-[calc(50%+2px)]' : 'left-1'
            }`}
          />
          
          <button
            onClick={() => onSidebarModeChange('score')}
            className={`relative z-10 flex-1 px-4 py-2 text-xs font-semibold transition-colors duration-300 rounded-[5px] ${
              sidebarMode === 'score'
                ? 'text-[color:var(--mb-on-red)]'
                : 'text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Score</span>
            </div>
          </button>
          <button
            onClick={() => onSidebarModeChange('tv')}
            className={`relative z-10 flex-1 px-4 py-2 text-xs font-semibold transition-colors duration-300 rounded-[5px] ${
              sidebarMode === 'tv'
                ? 'text-[color:var(--mb-on-red)]'
                : 'text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-100)]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Tv className="h-3.5 w-3.5" />
              <span>TV</span>
            </div>
          </button>
        </div>

        {sidebarMode === 'score' ? (
          <div className="space-y-3">
            {eventId && scoreboardUrl ? (
              <div className="rounded-[5px] overflow-hidden border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
                <iframe
                  title="Live Score"
                  src={scoreboardUrl}
                  className="w-full min-h-[250px]"
                  allowFullScreen
                  allow="fullscreen"
                />
              </div>
            ) : (
              <div className="rounded-[5px] min-h-[250px] bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
                <div className="text-center p-4">
                  <BarChart3 className="h-10 w-10 mx-auto mb-2 text-[color:var(--brand-primary)]" />
                  <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] mb-1">Scorecard</h3>
                  <p className="text-[11px] text-[color:var(--ds-color-slate-450)]">Not available for this site.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {eventId && liveTvUrl ? (
              <div className="aspect-video rounded-[5px] overflow-hidden border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
                <iframe
                  title="Live TV"
                  src={liveTvUrl}
                  className="w-full h-full min-h-[200px]"
                  allowFullScreen
                  allow="fullscreen; encrypted-media"
                />
              </div>
            ) : (
              <div className="aspect-video rounded-[5px] bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
                <div className="text-center p-4">
                  <Tv className="h-10 w-10 mx-auto mb-2 text-[color:var(--brand-primary)]" />
                  <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] mb-1">Live TV</h3>
                  <p className="text-[11px] text-[color:var(--ds-color-slate-450)]">{eventId ? 'Not available for this site.' : 'Event ID required to load stream.'}</p>
                </div>
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      </div>

      {/* My Bets Section - no outer box */}
      {isAuthenticated && (
        <div className="pb-4 transition-all duration-200">
          <button
            onClick={() => setIsMyBetsExpanded(!isMyBetsExpanded)}
            className="w-full px-0 py-2 flex items-center justify-between border-b border-[color:var(--ds-color-slate-600)] transition-colors"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[color:var(--brand-primary)]" />
              <span className="font-semibold text-sm text-[color:var(--ds-color-slate-100)]">My Bets</span>
              {betCount > 0 && (
                <span className="w-5 h-5 rounded-[5px] bg-[color:var(--mb-red-bg)] text-[color:var(--mb-red-ink)] text-[10px] font-bold flex items-center justify-center">
                  {betCount}
                </span>
              )}
            </div>
            <ChevronDown 
              className={`h-4 w-4 text-[color:var(--ds-color-slate-400)] transition-transform duration-300 ${
                isMyBetsExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>
          
          <div 
            className={`transition-all duration-300 ease-in-out ${
              isMyBetsExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
            } overflow-hidden`}
          >
            <div className="pt-3 pb-4">
              <BetHistoryTimeline 
                bets={myBets} 
                eventId={event.eventId || event.id || ''} 
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
