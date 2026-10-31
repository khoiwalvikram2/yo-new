import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Accent } from '@/ui/components/accent'
import { Meter } from '@/ui/components/Meter'
import { WEEKDAYS, compactAmount, hourLabel } from './insightFormat'
import { DrillButton } from './DrilldownDialog'
import type { DrillRequest } from './drilldownContext'
import styles from './TabCharts.module.css'

/* The charts the Players, Financial, Agents and Time tabs draw (the owner's redesign, 2026-10-29), in the
   Revenue panel's idiom (RevenueBars): measured SVG at the kit's 11px axis text, hairline grid, and the
   dashboard accents (tokens.css --viz-*, through data-accent) for the marks. Every chart says in its label
   what a screen reader would otherwise have to read off the picture. */

/** A round step for about four intervals: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(span: number): number {
  const raw = span / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const fraction = raw / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power
}

/** The element's width, measured, so the chart's text stays 11px at any card width. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

export interface ColumnSeries {
  name: string
  accent: Accent
  values: readonly number[]
}

interface ColumnChartProps {
  /** What the chart shows, for its accessible name. */
  label: string
  categories: readonly string[]
  series: readonly ColumnSeries[]
  /** A value in full, for the bar's tooltip. */
  format: (value: number) => string
  /** A value on the axis. @default compactAmount */
  axis?: (value: number) => string
  height?: number
  /** One series drawn green where it is above 0 and rose below (a gain or a loss). */
  signed?: boolean
}

const MARGIN = { l: 46, r: 6, t: 12, b: 24 }

/** Grouped columns: one group per category, one column per series, on round axis ticks. */
export function ColumnChart({ label, categories, series, format, axis = compactAmount, height = 220, signed = false }: ColumnChartProps) {
  const { ref, width: measured } = useWidth()
  const width = measured || 640
  const all = series.flatMap((s) => s.values)
  let low = Math.min(0, ...all)
  let high = Math.max(0, ...all)
  if (high === low) high = low + 1
  const step = niceStep(high - low)
  low = Math.floor(low / step) * step
  high = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick * 1e6) / 1e6)

  const plotWidth = Math.max(1, width - MARGIN.l - MARGIN.r)
  const plotHeight = height - MARGIN.t - MARGIN.b
  const y = (value: number) => MARGIN.t + ((high - value) / (high - low)) * plotHeight
  const band = plotWidth / Math.max(1, categories.length)
  const group = Math.min(band * 0.72, 30 * series.length)
  const barWidth = Math.max(2, group / series.length)
  // Thin the category labels so they never collide (about 38px each).
  const every = Math.max(1, Math.ceil((38 * categories.length) / plotWidth))
  const last = categories.length - 1

  const totals = series.map((s) => `${s.name} ${format(s.values.reduce((sum, v) => sum + v, 0))}`).join(', ')
  const summary = `${label}: ${categories[0] ?? ''} to ${categories[last] ?? ''}; totals ${totals}`

  return (
    <div className={styles.chartWrap}>
      <div ref={ref} className={styles.chart}>
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className={tick === 0 && low < 0 ? styles.zero : styles.grid} x1={MARGIN.l} x2={width - MARGIN.r} y1={y(tick)} y2={y(tick)} />
              <text x={MARGIN.l - 8} y={y(tick) + 4} textAnchor="end">{tick === 0 ? '0' : axis(tick)}</text>
            </g>
          ))}
          {categories.map((category, index) => {
            const start = MARGIN.l + band * index + (band - group) / 2
            return (
              <g key={`${category}-${index}`}>
                {series.map((s, si) => {
                  const value = s.values[index] ?? 0
                  const top = Math.min(y(value), y(0))
                  const barHeight = Math.max(value === 0 ? 0 : 1, Math.abs(y(value) - y(0)))
                  const accent = signed ? (value < 0 ? 'rose' : 'green') : s.accent
                  return (
                    <rect key={s.name} className={styles.bar} data-accent={accent} x={start + si * barWidth} y={top} width={Math.max(1, barWidth - 1)} height={barHeight} rx={1.5}>
                      <title>{`${category} · ${s.name}: ${format(value)}`}</title>
                    </rect>
                  )
                })}
                {(last - index) % every === 0 ? (
                  <text x={MARGIN.l + band * index + band / 2} y={height - 6} textAnchor="middle">{category}</text>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
      {series.length > 1 || signed ? (
        <ul className={styles.legend} aria-hidden="true">
          {signed ? (
            <>
              <li data-accent="green">Gain</li>
              <li data-accent="rose">Loss</li>
            </>
          ) : series.map((s) => <li key={s.name} data-accent={s.accent}>{s.name}</li>)}
        </ul>
      ) : null}
    </div>
  )
}

interface HeatGridProps {
  /** ISO weekday 1..7 × hour 0..23; missing cells are 0. */
  cells: ReadonlyArray<{ weekday: number; hour: number; value: number }>
  /** What a cell counts, e.g. "bets". */
  unit: string
  format: (value: number) => string
}

/** Weekday rows × 24 hour columns, each cell shaded by its share of the busiest cell. */
export function HeatGrid({ cells, unit, format }: HeatGridProps) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const cell of cells) {
    if (cell.weekday >= 1 && cell.weekday <= 7 && cell.hour >= 0 && cell.hour <= 23) grid[cell.weekday - 1][cell.hour] += cell.value
  }
  const max = Math.max(0, ...grid.flat())
  let peak = { weekday: 0, hour: 0, value: 0 }
  grid.forEach((row, d) => row.forEach((value, h) => { if (value > peak.value) peak = { weekday: d, hour: h, value } }))
  const summary = max > 0
    ? `${unit} by weekday and hour (IST); busiest ${WEEKDAYS[peak.weekday]} ${hourLabel(peak.hour)} with ${format(peak.value)} ${unit}`
    : `No ${unit} in this window`
  return (
    <div className={styles.heatWrap}>
      <div className={styles.heat} role="img" aria-label={summary}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={`h${hour}`} className={styles.heatHour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
        ))}
        {grid.map((row, d) => (
          <div key={WEEKDAYS[d]} className={styles.heatRow}>
            <span className={styles.heatDay}>{WEEKDAYS[d]}</span>
            {row.map((value, hour) => (
              <span
                key={hour}
                className={styles.heatCell}
                data-empty={value === 0 || undefined}
                style={{ '--heat': max > 0 ? Math.round((value / max) * 100) : 0 } as CSSProperties}
                title={`${WEEKDAYS[d]} ${hourLabel(hour)}: ${format(value)} ${unit}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className={styles.heatKey} aria-hidden="true">
        <span>Less</span>
        {[0, 25, 50, 75, 100].map((step) => <span key={step} className={styles.heatCell} style={{ '--heat': step } as CSSProperties} data-empty={step === 0 || undefined} />)}
        <span>More</span>
      </div>
    </div>
  )
}

export interface SplitSegment {
  label: string
  value: number
  accent: Accent
  /** The rows behind the part, for the drill-down modal. */
  drill?: DrillRequest
}

/** One bar split into its parts, with a legend of each part's figure and share. */
export function SplitBar({ title, segments, format }: { title: string; segments: readonly SplitSegment[]; format: (value: number) => string }) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  return (
    <div className={styles.split}>
      <div className={styles.splitHead}>
        <span className={styles.splitTitle}>{title}</span>
        <span className={styles.splitTotal}>{format(total)}</span>
      </div>
      <div className={styles.splitBar} aria-hidden="true">
        {total > 0 ? segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.label} data-accent={s.accent} style={{ flexGrow: s.value }} />
        )) : null}
      </div>
      <ul className={styles.splitLegend}>
        {segments.map((s) => (
          <li key={s.label} data-accent={s.accent}>
            <span className={styles.splitName}>{s.drill ? <DrillButton drill={{ title: s.label, ...s.drill }}>{s.label}</DrillButton> : s.label}</span>
            <span className={styles.splitValue}>{format(s.value)}</span>
            <span className={styles.splitShare}>{total > 0 ? `${((Math.max(0, s.value) / total) * 100).toFixed(1)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface FunnelStep {
  label: string
  value: number
  note: string
  accent: Accent
  /** The rows behind the step, for the drill-down modal. */
  drill?: DrillRequest
}

/** Steps narrowing from the first: each bar is its share of the first step, with the step-to-step rate. */
export function Funnel({ steps, format }: { steps: readonly FunnelStep[]; format: (value: number) => string }) {
  const first = steps[0]?.value ?? 0
  return (
    <ol className={styles.funnel}>
      {steps.map((step, index) => {
        const share = first > 0 ? (step.value / first) * 100 : 0
        const previous = index > 0 ? steps[index - 1].value : null
        return (
          <li key={step.label} className={styles.funnelStep} data-accent={step.accent}>
            <div className={styles.funnelHead}>
              <span className={styles.funnelLabel}>{step.label}</span>
              <span className={styles.funnelValue}>{step.drill ? <DrillButton drill={{ title: step.label, ...step.drill }}>{format(step.value)}</DrillButton> : format(step.value)}</span>
            </div>
            <Meter className={styles.funnelBar} value={share} />
            <div className={styles.funnelNote}>
              <span>{step.note}</span>
              <span>{index === 0 ? '100%' : `${share.toFixed(1)}% of all${previous ? ` · ${((step.value / previous) * 100).toFixed(1)}% of the step above` : ''}`}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
