import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import clsx from 'clsx'
import dayjs from 'dayjs'
import { DASHBOARD_TRENDS_QUERY } from '../graphql'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import styles from './RevenueBars.module.css'

/* The kit dashboard's Revenue panel (kit p2, "Revenue · Last 14 days · ₹ lakh"): gross revenue (GGR) as bars,
   green where the house won and rose where it lost (the owner's colour pass, 2026-10-29), the latest one
   at full strength with its figure over it, on a light grid, grouped by day, week or month from
   the head's segmented control. It reads Query.dashboardTrends (daily points) for its own window, whatever
   period the page's presets show, and sums the days into weeks or months on the client. */

type Grouping = 'day' | 'week' | 'month'

const GROUPINGS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const

const WINDOW: Record<Grouping, { count: number; label: string; noun: string }> = {
  day: { count: 14, label: 'Last 14 days', noun: 'Daily' },
  week: { count: 12, label: 'Last 12 weeks', noun: 'Weekly' },
  month: { count: 12, label: 'Last 12 months', noun: 'Monthly' },
}

/** The chart's own height and its plot margins, as the kit draws it. */
const HEIGHT = 220
const MARGIN = { l: 40, r: 4, t: 18, b: 24 }

interface TrendPoint {
  date: string
  ggr?: number
}

interface Bucket {
  key: string
  /** The axis label: the first and last carry the month, the rest only the day (as the kit labels days). */
  tick: string
  /** The full name, for the bar's tooltip. */
  name: string
}

/** The window's buckets, oldest first, and the IST range the query needs to fill them. */
function buckets(grouping: Grouping): { list: Bucket[]; dateFrom: string; dateTo: string } {
  const now = nowIST()
  const count = WINDOW[grouping].count
  let starts: dayjs.Dayjs[]
  if (grouping === 'day') {
    starts = Array.from({ length: count }, (_, i) => now.subtract(count - 1 - i, 'day').startOf('day'))
  } else if (grouping === 'week') {
    // Weeks start on Monday, as the commission cycle and the rest of the admin count them.
    const monday = now.subtract((now.day() + 6) % 7, 'day').startOf('day')
    starts = Array.from({ length: count }, (_, i) => monday.subtract(7 * (count - 1 - i), 'day'))
  } else {
    const month = now.startOf('month')
    starts = Array.from({ length: count }, (_, i) => month.subtract(count - 1 - i, 'month'))
  }
  const list = starts.map((start, index) => {
    const edge = index === 0 || index === starts.length - 1
    if (grouping === 'month') {
      return { key: start.format('YYYY-MM'), tick: edge || start.month() === 0 ? start.format('MMM YY') : start.format('MMM'), name: start.format('MMMM YYYY') }
    }
    return {
      key: start.format('YYYY-MM-DD'),
      tick: grouping === 'week' || edge ? start.format('D MMM') : start.format('D'),
      name: grouping === 'week' ? `Week of ${start.format('D MMM YYYY')}` : start.format('D MMM YYYY'),
    }
  })
  return { list, dateFrom: starts[0].toDate().toISOString(), dateTo: now.endOf('day').toDate().toISOString() }
}

/** The bucket a daily point belongs to. */
function bucketKey(grouping: Grouping, day: string): string {
  if (grouping === 'day') return day
  const date = dayjs(day)
  if (grouping === 'month') return date.format('YYYY-MM')
  return date.subtract((date.day() + 6) % 7, 'day').format('YYYY-MM-DD')
}

/** A round step for about four intervals: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(span: number): number {
  const raw = span / 4
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const fraction = raw / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power
}

/** The chart's width, measured, so its text stays at the kit's 11px at any card width. */
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

export function RevenueBars() {
  const [grouping, setGrouping] = useState<Grouping>('day')
  const { convertFromWhitelabelCurrency, getCurrencySymbol, selectedCurrency } = useCurrency()
  const range = useMemo(() => buckets(grouping), [grouping])
  const { ref, width: measured } = useWidth()
  // The bars' gradients need ids unique on the page; useId's colons are not safe in url(#…).
  const gradient = `revenue-${useId().replace(/:/g, '')}`
  // Before the first measurement (and in tests) the chart is drawn at a typical width and then redrawn.
  const width = measured || 640

  const { data, loading, error } = useQuery(DASHBOARD_TRENDS_QUERY, {
    variables: { dateRange: { dateFrom: range.dateFrom, dateTo: range.dateTo } },
    pollInterval: 60000,
    errorPolicy: 'all',
  })

  const totals = useMemo(() => {
    const sums = new Map<string, number>()
    for (const point of (data?.dashboardTrends ?? []) as TrendPoint[]) {
      const key = bucketKey(grouping, String(point.date).slice(0, 10))
      sums.set(key, (sums.get(key) ?? 0) + Number(point.ggr ?? 0))
    }
    return range.list.map((bucket) => convertFromWhitelabelCurrency(sums.get(bucket.key) ?? 0))
  }, [data, grouping, range, convertFromWhitelabelCurrency])

  // The figures in one readable unit: Indian lakh and crore for rupees, thousands and millions otherwise.
  const symbol = getCurrencySymbol?.() || '₹'
  const indian = (selectedCurrency ?? 'INR') === 'INR'
  const peak = Math.max(0, ...totals.map(Math.abs))
  const unit = indian
    ? peak >= 1e7 ? { size: 1e7, name: 'crore' } : peak >= 1e5 ? { size: 1e5, name: 'lakh' } : peak >= 1e3 ? { size: 1e3, name: 'thousand' } : { size: 1, name: '' }
    : peak >= 1e6 ? { size: 1e6, name: 'million' } : peak >= 1e3 ? { size: 1e3, name: 'thousand' } : { size: 1, name: '' }
  const unitLabel = unit.name ? `${symbol} ${unit.name}` : symbol
  const values = totals.map((value) => value / unit.size)
  // A bar's figure: one decimal below 10 (2.5 lakh), whole above (91 lakh).
  const number = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(value) < 10 && value % 1 ? 1 : 0 })

  // The axis: round ticks from the lowest value (or 0) to the highest, about four intervals.
  let low = Math.min(0, ...values)
  let high = Math.max(0, ...values)
  if (high === low) high = low + 1
  const step = niceStep(high - low)
  low = Math.floor(low / step) * step
  high = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick * 1e6) / 1e6)
  // An axis label keeps the step's own decimals (0.25, 2.5), so no two ticks read the same.
  const tickDecimals = Math.min(2, (String(step).split('.')[1] ?? '').length)
  const tickText = (tick: number) => tick === 0 ? '0' : tick.toLocaleString('en-IN', { minimumFractionDigits: tickDecimals, maximumFractionDigits: tickDecimals })

  const plotWidth = Math.max(1, width - MARGIN.l - MARGIN.r)
  const plotHeight = HEIGHT - MARGIN.t - MARGIN.b
  const y = (value: number) => MARGIN.t + ((high - value) / (high - low)) * plotHeight
  const band = plotWidth / values.length
  const barWidth = Math.max(4, Math.min(28, band * 0.62))
  const every = band < 26 ? 3 : band < 38 ? 2 : 1
  const last = values.length - 1

  const latest = values[last] ?? 0
  const summary = `${WINDOW[grouping].noun} gross revenue for the ${WINDOW[grouping].label.toLowerCase()}, in ${unitLabel}: latest ${number(latest)} (${range.list[last]?.name ?? ''})`

  return (
    <Card
      title="Revenue"
      sub={`${WINDOW[grouping].label} · ${unitLabel}`}
      tools={<SegmentedControl label="Group revenue by" size="sm" value={grouping} options={GROUPINGS} onChange={(value) => setGrouping(value as Grouping)} />}
    >
      <div ref={ref} className={styles.chart}>
        {loading && !data ? (
          <LoadingState height={HEIGHT} label="Loading revenue" />
        ) : error && !data ? (
          <p className={styles.error}>Revenue could not be loaded: {error.message}</p>
        ) : (
          <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT}>
            <defs>
              {/* Strongest at the bar's tip: the top of a gain, the bottom of a loss. */}
              <linearGradient id={`${gradient}-up`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className={styles.stopUp} />
                <stop offset="1" className={clsx(styles.stopUp, styles.stopFade)} />
              </linearGradient>
              <linearGradient id={`${gradient}-down`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className={clsx(styles.stopDown, styles.stopFade)} />
                <stop offset="1" className={styles.stopDown} />
              </linearGradient>
            </defs>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 && low < 0 ? styles.zero : styles.grid} x1={MARGIN.l} x2={width - MARGIN.r} y1={y(tick)} y2={y(tick)} />
                <text x={MARGIN.l - 8} y={y(tick) + 4} textAnchor="end">{tickText(tick)}</text>
              </g>
            ))}
            {values.map((value, index) => {
              const x = MARGIN.l + band * index + (band - barWidth) / 2
              const top = Math.min(y(value), y(0))
              const barHeight = Math.max(1, Math.abs(y(value) - y(0)))
              const bucket = range.list[index]
              return (
                <g key={bucket.key}>
                  <rect
                    className={index === last ? styles.barNow : styles.bar}
                    fill={`url(#${gradient}-${value < 0 ? 'down' : 'up'})`}
                    x={x}
                    y={top}
                    width={barWidth}
                    height={barHeight}
                    rx={2}
                  >
                    <title>{`${bucket.name}: ${number(value)} ${unitLabel}`}</title>
                  </rect>
                  {(last - index) % every === 0 ? (
                    <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle">{bucket.tick}</text>
                  ) : null}
                </g>
              )
            })}
            {values.length ? (
              <text className={styles.value} x={MARGIN.l + band * last + band / 2} y={Math.min(y(latest), y(0)) - 6} textAnchor="middle">{number(latest)}</text>
            ) : null}
          </svg>
        )}
      </div>
    </Card>
  )
}
