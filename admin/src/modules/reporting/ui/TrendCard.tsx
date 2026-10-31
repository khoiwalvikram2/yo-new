import clsx from 'clsx'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Skeleton } from '@/ui/components/Skeleton'
import { Spinner } from '@/ui/components/Spinner'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useFormatLocale } from '@/shared/core/useFormatLocale'
import {
  compactAxisValue,
  formatTrendAxisDate,
  lineSlots,
  seriesLegend,
  trendTooltipValue,
  type LegendItem,
  type SeriesSlot,
} from './drillDownModel'
import { ReportChartTip } from './ReportChartTip'
import s from './reportCharts.module.css'

export interface TrendDataPoint {
  date: string
  [key: string]: string | number
}

export interface TrendLine {
  key: string
  name: string
  /**
   * Accepted so a page can switch imports unchanged, but not drawn: a series takes its colour from
   * its position on the token ramp (drillDownModel.lineSlots), never from a literal.
   */
  color?: string
  formatter?: (value: number) => string
}

const LINE_CLASS: Readonly<Record<SeriesSlot, string>> = {
  s1: s.lineS1,
  s2: s.lineS2,
  s3: s.lineS3,
  hInd: s.lineHInd,
  hRed: s.lineHRed,
  hGrn: s.lineHGrn,
  hVio: s.lineHVio,
  hBlu: s.lineHBlu,
  hAmb: s.lineHAmb,
}

const DOT_CLASS: Readonly<Record<SeriesSlot, string>> = {
  s1: s.dotS1,
  s2: s.dotS2,
  s3: s.dotS3,
  hInd: s.dotHInd,
  hRed: s.dotHRed,
  hGrn: s.dotHGrn,
  hVio: s.dotHVio,
  hBlu: s.dotHBlu,
  hAmb: s.dotHAmb,
}

const KEY_CLASS: Readonly<Record<SeriesSlot, string>> = {
  s1: s.keyS1,
  s2: s.keyS2,
  s3: s.keyS3,
  hInd: s.keyHInd,
  hRed: s.keyHRed,
  hGrn: s.keyHGrn,
  hVio: s.keyHVio,
  hBlu: s.keyHBlu,
  hAmb: s.keyHAmb,
}

export interface TrendLegendProps {
  items: readonly LegendItem[]
}

/**
 * The plot's legend (the mockup's .legend / .lg, M:903-911 and M:1777-1780): one swatch and name per
 * series, in series order, each swatch on its own line's slot. Drawn as recharts Legend content, which
 * clones it with recharts' own props; only `items` is read.
 */
export function TrendLegend({ items }: TrendLegendProps) {
  return (
    <ul className={s.legend}>
      {items.map((item) => (
        <li key={item.key} className={s.lg}>
          <i className={clsx(s.lgKey, KEY_CLASS[item.slot])} aria-hidden="true" />
          <span className={s.lgText}>{item.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** A plotted line: TrendLine's fields, plus a slot when its colour carries a reading. */
export type TrendPlotLine = Pick<TrendLine, 'key' | 'name' | 'formatter'> & { slot?: SeriesSlot }

export interface TrendPlotProps {
  data: readonly Record<string, unknown>[]
  lines: readonly TrendPlotLine[]
  height: number
  /** The Y axis tick. */
  formatY: (value: number) => string
  /** A tooltip row's value, given the row's line when it has one. */
  formatTip: (value: number, line: TrendPlotLine | undefined) => string
}

/**
 * One trend plot: date ticks as "MMM d", a monotone line per series with no resting dots and a 5px
 * active dot, the shared tip and the legend. TrendCard and ContextCharts both draw it. Line, active
 * dot, tip swatch and legend swatch all take the line's slot by its key, never by a list position.
 */
export function TrendPlot({ data, lines, height, formatY, formatTip }: TrendPlotProps) {
  const { formatDate } = useFormatDate()
  const slots = lineSlots(lines)
  const slotOfKey = (key: unknown, index: number): SeriesSlot => {
    const at = lines.findIndex((line) => line.key === key)
    return slots[at >= 0 ? at : index % Math.max(1, slots.length)] ?? 's1'
  }

  return (
    <div className={s.plot}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data as Record<string, unknown>[]}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => formatTrendAxisDate(String(value), formatDate)}
            tick={{ fontSize: 11 }}
          />
          <YAxis tickFormatter={(value) => formatY(Number(value))} tick={{ fontSize: 11 }} />
          <Tooltip
            cursor={{ className: s.cursorLine }}
            content={
              <ReportChartTip
                slotOf={(entry, index) => slotOfKey(entry.dataKey, index)}
                format={(value, entry) =>
                  formatTip(value, lines.find((line) => line.key === entry.dataKey))
                }
              />
            }
          />
          <Legend content={<TrendLegend items={seriesLegend(lines)} />} />
          {lines.map((line, index) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              className={LINE_CLASS[slots[index]]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, className: DOT_CLASS[slots[index]] }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface TrendCardProps {
  title: string
  data: TrendDataPoint[]
  loading?: boolean
  lines: TrendLine[]
  height?: number
  /** BEYOND the legacy props: an h3 when the card sits inside another titled section. @default 2 */
  headingLevel?: 2 | 3
}

/**
 * A titled trend chart. Same props as the legacy components/TrendCard.tsx (`color` is accepted and
 * ignored, see TrendLine); a page migrates by switching the import.
 */
export function TrendCard({ title, data, loading = false, lines, height = 300, headingLevel = 2 }: TrendCardProps) {
  const formatLocale = useFormatLocale()
  const hasData = Boolean(data && data.length > 0)

  if (!hasData) {
    return (
      <Card
        title={title}
        sub={loading ? <Skeleton width={96} height={12} /> : undefined}
        headingLevel={headingLevel}
        aria-busy={loading || undefined}
      >
        {loading ? (
          <LoadingState label="Loading trend data" height={height} />
        ) : (
          <EmptyState title="No data available" inset="none" />
        )}
      </Card>
    )
  }

  return (
    <Card
      title={title}
      sub={`${data.length} data points`}
      headingLevel={headingLevel}
      aria-busy={loading || undefined}
      tools={loading ? <Spinner size="sm" label="Refreshing trend data" /> : undefined}
    >
      <TrendPlot
        data={data}
        lines={lines}
        height={height}
        formatY={compactAxisValue}
        formatTip={(value, line) => trendTooltipValue(value, formatLocale, line?.formatter)}
      />
    </Card>
  )
}
