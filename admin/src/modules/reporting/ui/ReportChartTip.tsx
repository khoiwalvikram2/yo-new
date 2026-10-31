import clsx from 'clsx'
import { toChartNumber } from '@/lib/chartValue'
import type { SeriesSlot } from './drillDownModel'
import s from './reportCharts.module.css'

/* The mockup's .tip (M:942-958) as recharts tooltip content, shared by the drill-down charts. It
   replaces the legacy white Tailwind box (TrendCard) and recharts' default box with an inline
   contentStyle (ContextCharts): each row is a swatch, the series name and its formatted value. */

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

export interface ChartTipEntry {
  name?: string | number
  value?: unknown
  dataKey?: string | number | ((...args: never[]) => unknown)
}

export interface ReportChartTipProps {
  /** Set by recharts. */
  active?: boolean
  /** Set by recharts. */
  payload?: readonly ChartTipEntry[]
  /** Set by recharts: the hovered category (a date on a trend plot). */
  label?: unknown
  /** The series slot whose swatch a row takes. */
  slotOf: (entry: ChartTipEntry, index: number) => SeriesSlot
  /** Formats a row's value. */
  format: (value: number, entry: ChartTipEntry) => string
}

export function ReportChartTip({ active, payload, label, slotOf, format }: ReportChartTipProps) {
  if (!active || !payload?.length) return null
  const heading = label === undefined || label === null ? '' : String(label)
  return (
    <div className={s.tip}>
      {heading ? <p className={s.tipLabel}>{heading}</p> : null}
      {payload.map((entry, index) => (
        // rows follow the series order recharts passes; a name may repeat, a position cannot
        <div className={s.tipRow} key={index}>
          <i className={clsx(s.tipDot, KEY_CLASS[slotOf(entry, index)])} aria-hidden="true" />
          <span className={s.tipName}>{entry.name}</span>
          <b className={s.tipValue}>{format(toChartNumber(entry.value), entry)}</b>
        </div>
      ))}
    </div>
  )
}
