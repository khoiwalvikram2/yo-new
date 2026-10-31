import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MomentumPoint {
  timestamp: number
  value: number // -100 to +100 (negative = away team momentum, positive = home team momentum)
}

interface MomentumIndicatorProps {
  homeTeam: string
  awayTeam: string
  momentumData?: MomentumPoint[]
  currentMomentum?: number // -100 to +100
}

export default function MomentumIndicator({ 
  homeTeam, 
  awayTeam, 
  momentumData = [],
  currentMomentum 
}: MomentumIndicatorProps) {
  const { t } = useTranslation()
  // Real price history only: no invented swings while the market has not priced yet.
  const momentum = momentumData

  const latestMomentum = currentMomentum !== undefined 
    ? currentMomentum 
    : momentum.length > 0 
    ? momentum[momentum.length - 1].value 
    : 0

  const { strength, direction, trend } = useMemo(() => {
    const absValue = Math.abs(latestMomentum)
    const dir = latestMomentum > 10 ? 'home' : latestMomentum < -10 ? 'away' : 'neutral'
    
    let trendDir: 'up' | 'down' | 'stable' = 'stable'
    if (momentum.length >= 3) {
      const recent = momentum.slice(-3)
      const first = recent[0].value
      const last = recent[recent.length - 1].value
      const diff = last - first
      
      if (diff > 15) trendDir = 'up'
      else if (diff < -15) trendDir = 'down'
    }

    return {
      strength: absValue,
      direction: dir,
      trend: trendDir
    }
  }, [latestMomentum, momentum])

  const getMomentumColor = () => {
    if (direction === 'home') return 'sky'
    if (direction === 'away') return 'rose'
    return 'gray'
  }

  const color = getMomentumColor()
  const percentage = (latestMomentum + 100) / 2

  if (momentum.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[color:var(--brand-primary)]" />
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">Momentum</h3>
        </div>
        <p className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4 text-xs text-[color:var(--ds-color-slate-400)]" role="status">
          {t('eventAnalytics.noPriceData', { defaultValue: 'No live price data for this market yet.' })}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[color:var(--brand-primary)]" />
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">Momentum</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
          trend === 'up' 
            ? 'bg-emerald-500/10 text-emerald-500' 
            : trend === 'down'
            ? 'bg-red-500/10 text-red-500'
            : 'bg-[color:var(--ds-color-slate-700)]/50 text-[color:var(--ds-color-slate-400)]'
        }`}>
          {trend === 'up' && <TrendingUp className="w-3.5 h-3.5" />}
          {trend === 'down' && <TrendingDown className="w-3.5 h-3.5" />}
          {trend === 'stable' && <Minus className="w-3.5 h-3.5" />}
          <span className="text-xs font-bold uppercase">{trend}</span>
        </div>
      </div>

      {/* Momentum Bar */}
      <div className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4 space-y-4">
        {/* Main bar */}
        <div className="relative">
          {/* Team labels */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-sky-400">{awayTeam}</span>
            <span className="text-xs font-medium text-rose-400">{homeTeam}</span>
          </div>

          {/* Progress bar container */}
          <div className="relative h-8 bg-gradient-to-r from-sky-500/20 via-[color:var(--ds-color-slate-700)]/30 to-rose-500/20 rounded-lg overflow-hidden border border-[color:var(--ds-color-slate-600)]/30">
            {/* Center line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[color:var(--ds-color-slate-600)]" />
            
            {/* Momentum indicator */}
            <div 
              className={`absolute top-1 bottom-1 w-2 rounded-[5px] transition-all duration-500 ${
                color === 'sky' 
                  ? 'bg-gradient-to-r from-sky-500 to-sky-600 shadow-lg shadow-sky-500/50' 
                  : color === 'rose'
                  ? 'bg-gradient-to-r from-rose-500 to-rose-600 shadow-lg shadow-rose-500/50'
                  : 'bg-[color:var(--ds-color-slate-500)]'
              }`}
              style={{ left: `calc(${percentage}% - 4px)` }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-[5px]" />
            </div>
          </div>

          {/* Scale markers */}
          <div className="flex justify-between mt-1 px-1">
            {[-100, -50, 0, 50, 100].map((val) => (
              <div key={val} className="flex flex-col items-center">
                <div className="w-px h-1 bg-[color:var(--ds-color-slate-600)]" />
                <span className="text-[9px] text-[color:var(--ds-color-slate-500)] tabular-nums mt-0.5">
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Current status */}
        <div className={`text-center p-3 rounded-lg border ${
          color === 'sky'
            ? 'bg-sky-500/10 border-sky-500/30'
            : color === 'rose'
            ? 'bg-rose-500/10 border-rose-500/30'
            : 'bg-[color:var(--ds-color-slate-700)]/30 border-[color:var(--ds-color-slate-600)]/30'
        }`}>
          <div className="text-xs text-[color:var(--ds-color-slate-400)] uppercase mb-1">Current Momentum</div>
          <div className={`text-2xl font-black tabular-nums ${
            color === 'sky'
              ? 'text-sky-400'
              : color === 'rose'
              ? 'text-rose-400'
              : 'text-[color:var(--ds-color-slate-400)]'
          }`}>
            {latestMomentum > 0 ? '+' : ''}{latestMomentum.toFixed(0)}
          </div>
          <div className="text-xs font-medium text-[color:var(--ds-color-slate-200)] mt-1">
            {direction === 'neutral' 
              ? 'Balanced' 
              : `${direction === 'home' ? homeTeam : awayTeam} ${strength > 70 ? 'Dominating' : strength > 40 ? 'Leading' : 'Ahead'}`
            }
          </div>
        </div>

        {/* Momentum chart mini */}
        {momentum.length > 0 && (
          <div className="pt-3 border-t border-[color:var(--ds-color-slate-700)]/20">
            <div className="flex items-end justify-between h-12 gap-0.5">
              {momentum.map((point, i) => {
                const height = (Math.abs(point.value) / 100) * 100
                const isPositive = point.value >= 0
                
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end items-center">
                    <div 
                      className={`w-full rounded-t transition-all ${
                        isPositive
                          ? 'bg-gradient-to-t from-rose-500/60 to-rose-600/40'
                          : 'bg-gradient-to-t from-sky-500/60 to-sky-600/40'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                )
              })}
            </div>
            <div className="text-center mt-2">
              <span className="text-[9px] text-[color:var(--ds-color-slate-500)]">Last 10 minutes</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
