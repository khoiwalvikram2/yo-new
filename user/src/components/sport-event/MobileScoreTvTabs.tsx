import { useState } from 'react'
import { BarChart3, Tv, ChevronDown } from 'lucide-react'
import { getScoreboardUrl, getLiveTvUrl } from '@/lib/sportsStreamUrls'
import { useAppSettings } from '@/lib/app-settings'

interface MobileScoreTvTabsProps {
  eventId: string
}

export default function MobileScoreTvTabs({ eventId }: MobileScoreTvTabsProps) {
  const { parsedSettings } = useAppSettings()
  const [activeMode, setActiveMode] = useState<'score' | 'tv' | null>(null)

  // Tabs always visible; real URLs only for grandwinn-com — others get blank/placeholder
  const urlEnabled = parsedSettings.features.liveTvAndScoreCardEnabled === true
  const scoreboardUrl = urlEnabled ? getScoreboardUrl(eventId) : ''
  const liveTvUrl = urlEnabled ? getLiveTvUrl(eventId) : ''

  if (!eventId) return null

  const isExpanded = activeMode !== null

  const handleTabClick = (mode: 'score' | 'tv') => {
    if (activeMode === mode) {
      setActiveMode(null)
    } else {
      setActiveMode(mode)
    }
  }

  return (
    <div className="xl:hidden">
      <div className="rounded-[5px] border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] overflow-hidden">
        {/* Tab Buttons */}
        <div className="flex">
          <button
            onClick={() => handleTabClick('score')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold transition-all duration-200 border-b-2 ${
              activeMode === 'score'
                ? 'border-[color:var(--brand-primary)] text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10'
                : 'border-transparent text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-200)]'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Scorecard</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-300 ${
                activeMode === 'score' ? 'rotate-180' : ''
              }`}
            />
          </button>
          <div className="w-px bg-[color:var(--ds-color-slate-600)]" />
          <button
            onClick={() => handleTabClick('tv')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold transition-all duration-200 border-b-2 ${
              activeMode === 'tv'
                ? 'border-[color:var(--brand-primary)] text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10'
                : 'border-transparent text-[color:var(--ds-color-slate-400)] hover:text-[color:var(--ds-color-slate-200)]'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            <span>Live TV</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-300 ${
                activeMode === 'tv' ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        {/* Expandable Content */}
        <div
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            isExpanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="p-2">
            {activeMode === 'score' && scoreboardUrl && (
              <div className="aspect-video rounded-[5px] overflow-hidden border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
                <iframe
                  title="Live Score"
                  src={scoreboardUrl}
                  className="w-full h-full min-h-[180px]"
                  allowFullScreen
                  allow="fullscreen"
                />
              </div>
            )}
            {activeMode === 'tv' && liveTvUrl && (
              <div className="aspect-video rounded-[5px] overflow-hidden border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-750)]">
                <iframe
                  title="Live TV"
                  src={liveTvUrl}
                  className="w-full h-full min-h-[180px]"
                  allowFullScreen
                  allow="fullscreen; encrypted-media"
                />
              </div>
            )}
            {activeMode === 'tv' && !liveTvUrl && (
              <div className="aspect-video rounded-[5px] bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
                <div className="text-center p-4">
                  <Tv className="h-8 w-8 mx-auto mb-2 text-[color:var(--ds-color-slate-450)]" />
                  <p className="text-[11px] text-[color:var(--ds-color-slate-450)]">Stream not available</p>
                </div>
              </div>
            )}
            {activeMode === 'score' && !scoreboardUrl && (
              <div className="aspect-video rounded-[5px] bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
                <div className="text-center p-4">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 text-[color:var(--ds-color-slate-450)]" />
                  <p className="text-[11px] text-[color:var(--ds-color-slate-450)]">Scorecard not available</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
