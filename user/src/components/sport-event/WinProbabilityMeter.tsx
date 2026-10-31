import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'

interface WinProbabilityMeterProps {
  homeTeam: string
  awayTeam: string
  homeProbability: number // 0-100
  awayProbability: number // 0-100
  drawProbability?: number // 0-100 (optional for sports with draws)
}

export default function WinProbabilityMeter({ 
  homeTeam, 
  awayTeam, 
  homeProbability, 
  awayProbability,
  drawProbability 
}: WinProbabilityMeterProps) {
  const { t } = useTranslation()
  // No prices yet means no probability: say so rather than show an invented 50 / 50.
  const hasPrices = homeProbability + awayProbability + (drawProbability || 0) > 0
  const { normalizedHome, normalizedAway, normalizedDraw } = useMemo(() => {
    const total = homeProbability + awayProbability + (drawProbability || 0)

    if (total === 0) {
      return { normalizedHome: 0, normalizedAway: 0, normalizedDraw: 0 }
    }

    return {
      normalizedHome: (homeProbability / total) * 100,
      normalizedAway: (awayProbability / total) * 100,
      normalizedDraw: drawProbability ? (drawProbability / total) * 100 : 0
    }
  }, [homeProbability, awayProbability, drawProbability])

  const size = 180
  const strokeWidth = 16
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const homeArcLength = (normalizedHome / 100) * circumference
  const awayArcLength = (normalizedAway / 100) * circumference
  const drawArcLength = (normalizedDraw / 100) * circumference

  const homeOffset = 0
  const drawOffset = homeArcLength
  const awayOffset = homeArcLength + drawArcLength

  const createArc = (startOffset: number, arcLength: number, color: string) => {
    const dashArray = `${arcLength} ${circumference - arcLength}`
    const dashOffset = -startOffset

    return {
      strokeDasharray: dashArray,
      strokeDashoffset: dashOffset,
      stroke: color,
    }
  }

  const leader = normalizedHome > normalizedAway ? 'home' : normalizedAway > normalizedHome ? 'away' : 'draw'

  if (!hasPrices) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[color:var(--brand-primary)]" />
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">Win Probability</h3>
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
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-[color:var(--brand-primary)]" />
        <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">Win Probability</h3>
      </div>

      {/* Circular Meter */}
      <div className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-6">
        <div className="flex flex-col items-center">
          {/* SVG Meter */}
          <div className="relative">
            <svg width={size} height={size} className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--ds-color-slate-700)"
                strokeWidth={strokeWidth}
              />

              {/* Home team arc */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                className="transition-all duration-500"
                {...createArc(homeOffset, homeArcLength, 'rgb(14, 165, 233)')}
              />

              {/* Draw arc (if applicable) */}
              {normalizedDraw > 0 && (
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  className="transition-all duration-500"
                  {...createArc(drawOffset, drawArcLength, 'rgb(156, 163, 175)')}
                />
              )}

              {/* Away team arc */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                className="transition-all duration-500"
                {...createArc(awayOffset, awayArcLength, 'rgb(244, 63, 94)')}
              />
            </svg>

            {/* Center text */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className={`text-3xl font-black tabular-nums ${
                  leader === 'home' 
                    ? 'text-sky-400' 
                    : leader === 'away'
                    ? 'text-rose-400'
                    : 'text-[color:var(--ds-color-slate-400)]'
                }`}>
                  {leader === 'home' ? normalizedHome.toFixed(0) : leader === 'away' ? normalizedAway.toFixed(0) : normalizedDraw.toFixed(0)}%
                </div>
                <div className="text-[10px] text-[color:var(--ds-color-slate-400)] uppercase mt-1">
                  {leader === 'home' ? homeTeam : leader === 'away' ? awayTeam : 'Draw'}
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-6 w-full space-y-2">
            {/* Home team */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-[5px] bg-sky-500" />
                <span className="text-xs font-medium text-[color:var(--ds-color-slate-100)] truncate">{homeTeam}</span>
              </div>
              <span className="text-sm font-black text-sky-400 tabular-nums">
                {normalizedHome.toFixed(1)}%
              </span>
            </div>

            {/* Draw (if applicable) */}
            {normalizedDraw > 0 && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-[color:var(--ds-color-slate-700)]/30 border border-[color:var(--ds-color-slate-600)]/30">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-[5px] bg-[color:var(--ds-color-slate-500)]" />
                  <span className="text-xs font-medium text-[color:var(--ds-color-slate-100)]">Draw</span>
                </div>
                <span className="text-sm font-black text-[color:var(--ds-color-slate-400)] tabular-nums">
                  {normalizedDraw.toFixed(1)}%
                </span>
              </div>
            )}

            {/* Away team */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-[5px] bg-rose-500" />
                <span className="text-xs font-medium text-[color:var(--ds-color-slate-100)] truncate">{awayTeam}</span>
              </div>
              <span className="text-sm font-black text-rose-400 tabular-nums">
                {normalizedAway.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
