import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'

interface DepthLevel {
  price: number
  volume: number
}

interface MarketDepthChartProps {
  backDepth: DepthLevel[]
  layDepth: DepthLevel[]
  selection: string
}

export default function MarketDepthChart({ backDepth, layDepth, selection }: MarketDepthChartProps) {
  const { t } = useTranslation()
  // Real ladder only (sorted copies, so the props are not reordered): no invented levels.
  const backLevels = useMemo(() => [...backDepth].sort((a, b) => b.price - a.price), [backDepth])
  const layLevels = useMemo(() => [...layDepth].sort((a, b) => a.price - b.price), [layDepth])

  if (backLevels.length === 0 && layLevels.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[color:var(--brand-primary)]" />
          Market Depth
        </h3>
        <p className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4 text-xs text-[color:var(--ds-color-slate-400)]" role="status">
          {t('eventAnalytics.noPriceData', { defaultValue: 'No live price data for this market yet.' })}
        </p>
      </div>
    )
  }

  const maxVolume = Math.max(
    ...backLevels.map(d => d.volume),
    ...layLevels.map(d => d.volume)
  )

  const formatVolume = (vol: number) => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(1)}M`
    if (vol >= 1000) return `${(vol / 1000).toFixed(0)}K`
    return vol.toString()
  }

  const getBarWidth = (volume: number) => {
    return (volume / maxVolume) * 100
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[color:var(--brand-primary)]" />
            Market Depth
          </h3>
          <p className="text-xs text-[color:var(--ds-color-slate-400)]">{selection}</p>
        </div>
        <div className="text-xs text-[color:var(--ds-color-slate-400)]">
          Total: <span className="font-bold text-[color:var(--ds-color-slate-100)]">
            {formatVolume(backLevels.reduce((sum, d) => sum + d.volume, 0) + layLevels.reduce((sum, d) => sum + d.volume, 0))}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4">
        <div className="space-y-1">
          {/* Back side */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-sky-400 uppercase mb-2">
              Back (Buyers)
            </div>
            {backLevels.map((level, index) => (
              <div key={index} className="flex items-center gap-2 group">
                <div className="w-12 text-xs font-bold text-[color:var(--ds-color-slate-100)] tabular-nums">
                  {level.price.toFixed(2)}
                </div>
                <div className="flex-1 relative h-6 bg-[color:var(--ds-color-slate-800)]/50 rounded overflow-hidden">
                  <div 
                    className="absolute right-0 top-0 h-full bg-gradient-to-l from-sky-500/30 to-sky-600/20 border-r-2 border-sky-500 transition-all duration-300 group-hover:from-sky-500/40 group-hover:to-sky-600/30"
                    style={{ width: `${getBarWidth(level.volume)}%` }}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-sky-400 tabular-nums">
                    {formatVolume(level.volume)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-[color:var(--ds-color-slate-600)] to-transparent my-3" />

          {/* Lay side */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-rose-400 uppercase mb-2">
              Lay (Sellers)
            </div>
            {layLevels.map((level, index) => (
              <div key={index} className="flex items-center gap-2 group">
                <div className="w-12 text-xs font-bold text-[color:var(--ds-color-slate-100)] tabular-nums">
                  {level.price.toFixed(2)}
                </div>
                <div className="flex-1 relative h-6 bg-[color:var(--ds-color-slate-800)]/50 rounded overflow-hidden">
                  <div 
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-rose-500/30 to-rose-600/20 border-l-2 border-rose-500 transition-all duration-300 group-hover:from-rose-500/40 group-hover:to-rose-600/30"
                    style={{ width: `${getBarWidth(level.volume)}%` }}
                  />
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-rose-400 tabular-nums">
                    {formatVolume(level.volume)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="mt-4 pt-3 border-t border-[color:var(--ds-color-slate-700)]/20 grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-lg bg-sky-500/10">
            <div className="text-[10px] text-[color:var(--ds-color-slate-400)] uppercase mb-0.5">Back Volume</div>
            <div className="text-sm font-black text-sky-400 tabular-nums">
              {formatVolume(backLevels.reduce((sum, d) => sum + d.volume, 0))}
            </div>
          </div>
          <div className="text-center p-2 rounded-lg bg-rose-500/10">
            <div className="text-[10px] text-[color:var(--ds-color-slate-400)] uppercase mb-0.5">Lay Volume</div>
            <div className="text-sm font-black text-rose-400 tabular-nums">
              {formatVolume(layLevels.reduce((sum, d) => sum + d.volume, 0))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
