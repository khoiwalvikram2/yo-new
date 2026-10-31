import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { getDefaultLocale } from '@/lib/currency'

interface OddsPoint {
  timestamp: number
  backOdds: number
  layOdds: number
}

interface OddsMovementGraphProps {
  data: OddsPoint[]
  selection: string
  height?: number
}

export default function OddsMovementGraph({ data, selection, height = 200 }: OddsMovementGraphProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const { t } = useTranslation()
  // Real price history only: no invented line while the market has not priced yet.
  const oddsData = data

  const { minOdds, maxOdds, currentTrend } = useMemo(() => {
    const allOdds = oddsData.flatMap(d => [d.backOdds, d.layOdds])
    const min = Math.min(...allOdds)
    const max = Math.max(...allOdds)
    
    if (oddsData.length < 2) return { minOdds: min, maxOdds: max, currentTrend: 'stable' }
    
    const recent = oddsData.slice(-5)
    const firstAvg = (recent[0].backOdds + recent[0].layOdds) / 2
    const lastAvg = (recent[recent.length - 1].backOdds + recent[recent.length - 1].layOdds) / 2
    const change = ((lastAvg - firstAvg) / firstAvg) * 100
    
    return {
      minOdds: min,
      maxOdds: max,
      currentTrend: change > 1 ? 'up' : change < -1 ? 'down' : 'stable'
    }
  }, [oddsData])

  // A line needs two prices; until then say so instead of drawing one.
  if (oddsData.length < 2) {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">{selection}</h3>
          <p className="text-xs text-[color:var(--ds-color-slate-400)]">Odds Movement</p>
        </div>
        <p className="rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4 text-xs text-[color:var(--ds-color-slate-400)]" role="status">
          {t('eventAnalytics.noPriceData', { defaultValue: 'No live price data for this market yet.' })}
        </p>
      </div>
    )
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString(getDefaultLocale(), { hour: '2-digit', minute: '2-digit' })
  }

  const padding = 40
  const width = 600
  const chartHeight = height - 60
  const chartWidth = width - padding * 2

  const xScale = (index: number) => padding + (index / (oddsData.length - 1)) * chartWidth
  const yScale = (value: number) => {
    const range = maxOdds - minOdds || 1
    return height - padding - ((value - minOdds) / range) * chartHeight
  }

  const backPath = oddsData.map((d, i) => 
    `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.backOdds)}`
  ).join(' ')

  const layPath = oddsData.map((d, i) => 
    `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.layOdds)}`
  ).join(' ')

  const hoveredPoint = hoveredIndex !== null ? oddsData[hoveredIndex] : null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[color:var(--ds-color-slate-100)]">{selection}</h3>
          <p className="text-xs text-[color:var(--ds-color-slate-400)]">Odds Movement (Last 20 min)</p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
          currentTrend === 'up' 
            ? 'bg-emerald-500/10 text-emerald-500' 
            : currentTrend === 'down'
            ? 'bg-red-500/10 text-red-500'
            : 'bg-[color:var(--ds-color-slate-700)]/50 text-[color:var(--ds-color-slate-400)]'
        }`}>
          {currentTrend === 'up' && <TrendingUp className="w-3.5 h-3.5" />}
          {currentTrend === 'down' && <TrendingDown className="w-3.5 h-3.5" />}
          {currentTrend === 'stable' && <Minus className="w-3.5 h-3.5" />}
          <span className="text-xs font-bold uppercase">{currentTrend}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative rounded-lg bg-[color:var(--ds-color-slate-900)]/60 border border-[color:var(--ds-color-slate-700)]/40 p-4">
        <svg 
          width="100%" 
          height={height} 
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = padding + t * chartHeight
            const value = maxOdds - t * (maxOdds - minOdds)
            return (
              <g key={i}>
                <line
                  x1={padding}
                  y1={y}
                  x2={width - padding}
                  y2={y}
                  stroke="var(--ds-color-slate-700)"
                  strokeOpacity="0.4"
                  strokeDasharray="2,2"
                />
                <text
                  x={padding - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--ds-color-slate-500)"
                >
                  {value.toFixed(2)}
                </text>
              </g>
            )
          })}

          {/* Back odds line */}
          <path
            d={backPath}
            fill="none"
            stroke="rgb(14, 165, 233)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Lay odds line */}
          <path
            d={layPath}
            fill="none"
            stroke="rgb(244, 63, 94)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {oddsData.map((d, i) => (
            <g key={i}>
              <circle
                cx={xScale(i)}
                cy={yScale(d.backOdds)}
                r={hoveredIndex === i ? 5 : 3}
                fill="rgb(14, 165, 233)"
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredIndex(i)}
              />
              <circle
                cx={xScale(i)}
                cy={yScale(d.layOdds)}
                r={hoveredIndex === i ? 5 : 3}
                fill="rgb(244, 63, 94)"
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredIndex(i)}
              />
            </g>
          ))}

          {/* Hover tooltip */}
          {hoveredPoint && hoveredIndex !== null && (
            <g>
              <rect
                x={xScale(hoveredIndex) - 50}
                y={yScale(Math.max(hoveredPoint.backOdds, hoveredPoint.layOdds)) - 60}
                width="100"
                height="50"
                rx="6"
                fill="var(--ds-color-slate-800)"
                stroke="var(--ds-color-slate-600)"
                strokeWidth="1"
              />
              <text
                x={xScale(hoveredIndex)}
                y={yScale(Math.max(hoveredPoint.backOdds, hoveredPoint.layOdds)) - 45}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ds-color-slate-400)"
              >
                {formatTime(hoveredPoint.timestamp)}
              </text>
              <text
                x={xScale(hoveredIndex)}
                y={yScale(Math.max(hoveredPoint.backOdds, hoveredPoint.layOdds)) - 30}
                textAnchor="middle"
                fontSize="11"
                fontWeight="bold"
                fill="rgb(14, 165, 233)"
              >
                Back: {hoveredPoint.backOdds.toFixed(2)}
              </text>
              <text
                x={xScale(hoveredIndex)}
                y={yScale(Math.max(hoveredPoint.backOdds, hoveredPoint.layOdds)) - 18}
                textAnchor="middle"
                fontSize="11"
                fontWeight="bold"
                fill="rgb(244, 63, 94)"
              >
                Lay: {hoveredPoint.layOdds.toFixed(2)}
              </text>
            </g>
          )}

          {/* Time labels */}
          {oddsData.filter((_, i) => i % 5 === 0).map((d, i) => {
            const originalIndex = i * 5
            return (
              <text
                key={originalIndex}
                x={xScale(originalIndex)}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ds-color-slate-500)"
              >
                {formatTime(d.timestamp)}
              </text>
            )
          })}
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[5px] bg-sky-500" />
            <span className="text-xs text-[color:var(--ds-color-slate-200)] font-medium">Back</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[5px] bg-rose-500" />
            <span className="text-xs text-[color:var(--ds-color-slate-200)] font-medium">Lay</span>
          </div>
        </div>
      </div>
    </div>
  )
}
