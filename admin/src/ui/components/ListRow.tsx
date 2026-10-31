import type { LiHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import type { Accent } from './accent'
import styles from './ListRow.module.css'

export type ListRowHue = 1 | 2 | 3 | 4 | 5 | 6

interface ListRowBaseProps extends Omit<LiHTMLAttributes<HTMLLIElement>, 'children' | 'title' | 'value'> {
  /** The tile and everything inside it are decorative. */
  icon: ReactNode
  /** Optional second line. Values such as zero are retained rather than treated as absent. */
  sub?: ReactNode
}

export interface FeedListRowProps extends ListRowBaseProps {
  variant: 'feed'
  title: ReactNode
  age: ReactNode
  /** A decorative hue only; it never communicates the row's status. @default 1 */
  hue?: ListRowHue
  label?: never
  value?: never
}

export interface StatListRowProps extends ListRowBaseProps {
  variant: 'stat'
  label: ReactNode
  value: ReactNode
  title?: never
  age?: never
  hue?: never
  /** A dashboard accent for the tile: its soft tint behind the glyph in the accent. Decorative. */
  accent?: Accent
}

export type ListRowProps = FeedListRowProps | StatListRowProps

const isPresent = (value: ReactNode) => value !== undefined && value !== null && value !== false
const hueClasses: Record<ListRowHue, string> = {
  1: styles.hue1,
  2: styles.hue2,
  3: styles.hue3,
  4: styles.hue4,
  5: styles.hue5,
  6: styles.hue6,
}

/**
 * A single truthful feed or snapshot row. Compose rows inside a `ul`; this component always emits
 * the corresponding `li` and never turns a decorative tile into accessible duplicate content.
 */
export function ListRow(props: ListRowProps) {
  if (props.variant === 'feed') {
    const { variant, icon, sub, title, age, hue = 1, className, ...liProps } = props
    return (
      <li {...liProps} className={clsx(styles.row, styles[variant], className)}>
        <span className={clsx(styles.tile, hueClasses[hue])} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.body}>
          <span className={styles.feedTitle}>{title}</span>
          {isPresent(sub) ? <span className={styles.sub}>{sub}</span> : null}
        </span>
        <span className={styles.age}>{age}</span>
      </li>
    )
  }

  const { variant, icon, sub, label, value, accent, className, ...liProps } = props
  return (
    <li {...liProps} data-accent={accent} className={clsx(styles.row, styles[variant], className)}>
      <span className={clsx(styles.tile, styles.statTile, accent && styles.accentTile)} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.body}>
        <span className={styles.statLabel}>{label}</span>
        {isPresent(sub) ? <span className={styles.sub}>{sub}</span> : null}
      </span>
      <span className={styles.value}>{value}</span>
    </li>
  )
}
