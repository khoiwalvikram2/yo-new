import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { IconArrowDown, IconArrowUp, IconMinus } from '@tabler/icons-react'
import clsx from 'clsx'
import { Skeleton } from './Skeleton'
import { Tooltip } from './Tooltip'
import type { Accent } from './accent'
import styles from './Stat.module.css'

export type StatHue = 'ind' | 'red' | 'grn' | 'vio' | 'blu' | 'amb'
export type StatDeltaDirection = 'up' | 'down' | 'flat'

export interface StatDelta {
  value: string
  dir: StatDeltaDirection
  note?: string
}

export interface StatProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  value: ReactNode
  /** Decorative glyph; its hue never carries status or direction. */
  icon?: ReactNode
  /** Decorative ramp step. @default 'ind' */
  hue?: StatHue
  /** A dashboard accent (the player skin): a solid accent tile, a faint wash of the accent on the card and
   *  the sparkline in the accent. Decorative, like the hue; it outranks it. */
  accent?: Accent
  delta?: StatDelta
  /** Supporting copy when no comparison delta is available. */
  note?: ReactNode
  tooltip?: ReactNode
  /** `bare` composes inside an existing Card and paints no second surface. @default 'card' */
  variant?: 'card' | 'bare'
  /** Compact Overview KPI metrics: 32px tile, 20px value and 12px delta. @default 'default' */
  size?: 'default' | 'compact'
  /** Waiting for its figure: the label and glyph stay, the value and the delta/note line become
   *  placeholders on the same line boxes, so the card keeps the height it will have once the data lands.
   *  Pass the same `note`/`delta` as the loaded card so the reserved line matches. */
  loading?: boolean
  /** A small trend line across the foot of the card (the kit's .stat__spark), oldest value first; the
   *  latest point is marked. Decorative: the figure and its delta carry the meaning. An empty array keeps
   *  the slot's height while the series loads. */
  spark?: readonly number[]
  /** Other content for the same full-width foot slot when there is no series, e.g. a split bar. */
  footer?: ReactNode
}

/** The kit's sparkline: the series scaled into a 100 x 32 box that stretches to the card's width, the
    line kept 1.6px by a non-scaling stroke, and the latest point a dot laid over it in CSS pixels. */
function Sparkline({ values }: { values: readonly number[] }) {
  const height = 32
  const pad = 4
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (index: number) => 2 + (index * 96) / (values.length - 1)
  const y = (value: number) => max === min ? height / 2 : pad + ((max - value) / (max - min)) * (height - 2 * pad)
  const points = values.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`)
  const last = values.length - 1
  const area = `M${x(0).toFixed(2)},${height} L${points.join(' L')} L${x(last).toFixed(2)},${height} Z`
  return (
    <>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" focusable="false">
        <path className={styles.sparkArea} d={area} />
        <polyline className={styles.sparkLine} points={points.join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.sparkDot} style={{ left: `${x(last)}%`, top: `${y(values[last])}px` }} />
    </>
  )
}

const isPresent = (value: ReactNode) => value !== undefined && value !== null && value !== false

const DIRECTION_TEXT: Record<StatDeltaDirection, string> = {
  up: 'Up',
  down: 'Down',
  flat: 'No change',
}

/**
 * A KPI figure. The card variant owns its one surface; the bare variant is only the figure
 * anatomy, so a Card consumer never has to nest one card inside another.
 */
export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  {
    label,
    value,
    icon,
    hue = 'ind',
    accent,
    delta,
    note,
    tooltip,
    variant = 'card',
    size = 'default',
    loading = false,
    spark,
    footer,
    className,
    tabIndex,
    ...rest
  },
  ref,
) {
  const hasTooltip = !loading && tooltip !== undefined && tooltip !== null && tooltip !== false
  const supportingNote = delta ? delta.note : note
  const hasSupportingNote = delta ? Boolean(supportingNote) : isPresent(supportingNote)
  const compact = size === 'compact'
  const hasFoot = spark !== undefined || isPresent(footer)
  const root = (
    <div
      {...rest}
      ref={ref}
      aria-busy={loading || undefined}
      data-accent={accent}
      tabIndex={hasTooltip ? (tabIndex ?? 0) : tabIndex}
      className={clsx(styles.stat, styles[variant], compact && styles.compact, hasFoot && styles.withFoot, accent && styles.accented, className)}
    >
      {icon !== undefined && icon !== null && icon !== false ? (
        <span className={clsx(styles.tile, styles[hue])} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles.stack}>
        <div className={styles.label}>{label}</div>
        {loading ? (
          <div className={clsx(styles.value, styles.pending)}>
            <Skeleton width={compact ? 72 : 88} height={compact ? 16 : 20} />
            <span className={styles.srOnly}>Loading</span>
          </div>
        ) : (
          <div className={styles.value}>{value}</div>
        )}
        {/* While loading, the line is laid out as it will be but hidden, with a placeholder over it, so a
            note that carries a Meter or wraps reserves exactly its own height. */}
        {delta || hasSupportingNote ? (
          <div className={clsx(styles.delta, delta && styles[delta.dir], loading && styles.pendingLine)}>
            {loading ? <Skeleton className={styles.lineSkeleton} width={120} height={10} /> : null}
            {delta ? (
              <span className={styles.movement}>
                <span className={styles.deltaIcon} aria-hidden="true">
                  {delta.dir === 'up' ? (
                    <IconArrowUp size={13} stroke={2.4} />
                  ) : delta.dir === 'down' ? (
                    <IconArrowDown size={13} stroke={2.4} />
                  ) : (
                    <IconMinus size={13} stroke={2.4} />
                  )}
                </span>
                {/* The arrow shows the direction; the word is for assistive tech (and keeps the text "Up 4.2%"). */}
                <span className={styles.srOnly}>{`${DIRECTION_TEXT[delta.dir]} `}</span>
                <span>{delta.value}</span>
              </span>
            ) : null}
            {hasSupportingNote ? <span className={styles.note}>{supportingNote}</span> : null}
          </div>
        ) : null}
      </div>
      {hasFoot ? (
        <div className={styles.foot} aria-hidden={spark !== undefined || undefined}>
          {!loading && spark && spark.length > 1 ? <Sparkline values={spark} /> : spark === undefined && !loading ? footer : null}
        </div>
      ) : null}
    </div>
  )

  return hasTooltip ? <Tooltip content={tooltip}>{root}</Tooltip> : root
})
