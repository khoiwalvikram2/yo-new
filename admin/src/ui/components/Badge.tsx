import type { HTMLAttributes } from 'react'
import clsx from 'clsx'
import { formatBadgeCount } from './badgeCount'
import styles from './Badge.module.css'

export type BadgeTone = 'soft' | 'solid'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  count: number
  /** Above this the badge reads `${max}+`. @default 99 */
  max?: number
  /** soft = panel-row badge, solid = rail badge / active-row badge. @default 'soft' */
  tone?: BadgeTone
}

/** Renders nothing when count is 0 (or negative / NaN). Sets no position or box-shadow, so callers can. */
export function Badge({ count, max = 99, tone = 'soft', className, ...rest }: BadgeProps) {
  const text = formatBadgeCount(count, max)
  if (text === null) return null
  return (
    <span {...rest} className={clsx(styles.badge, styles[tone], className)}>
      {text}
    </span>
  )
}
