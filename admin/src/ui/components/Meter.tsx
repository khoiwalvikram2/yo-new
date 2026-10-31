import type { HTMLAttributes } from 'react'
import clsx from 'clsx'
import styles from './Meter.module.css'

/* A share or usage bar: the mockup's .bar with its fill (M:1085, M:1091).
   The caller sizes the track (a fixed 56px beside an amount, or full width under a label).

   Accessibility: when the figure is already printed beside the bar — which is how the mockup draws it
   — the bar is decoration and says nothing. Give it a `label` only when it is the sole carrier of the
   figure; it then becomes a `meter` with its value. */

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> {
  /** 0-100. Anything outside is clamped; a value that is not finite reads as 0. */
  value: number
  /** @default 'acc' */
  tone?: 'acc' | 'warn' | 'neg'
  /** Makes it a labelled `meter`. Omit when the figure is printed beside it. */
  label?: string
  /** What the value means when read out, e.g. "72% of the credit limit". Defaults to "N%". */
  valueText?: string
}

export function Meter({ value, tone = 'acc', label, valueText, className, ...rest }: MeterProps) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  const a11y = label
    ? {
        role: 'meter' as const,
        'aria-label': label,
        'aria-valuenow': Math.round(pct),
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuetext': valueText ?? `${Math.round(pct)}%`,
      }
    : { 'aria-hidden': true as const }

  return (
    <div {...rest} {...a11y} className={clsx(styles.track, className)}>
      <span
        className={clsx(styles.fill, tone === 'warn' && styles.warn, tone === 'neg' && styles.neg)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
