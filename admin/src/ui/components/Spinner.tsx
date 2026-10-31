import type { HTMLAttributes } from 'react'
import clsx from 'clsx'
import styles from './Spinner.module.css'

/** sm 14px: Button loading, wallet trigger placeholder (T11, T41). md 18px: popover loading (T38, T41).
 *  lg 24px: a whole region waiting for its first data, through LoadingState (page migration C, W0). */
export type SpinnerSize = 'sm' | 'md' | 'lg'

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'role' | 'children'> {
  /** @default 'md' */
  size?: SpinnerSize
  /** Accessible name. @default 'Loading' */
  label?: string
  /** Hide from assistive tech when the parent already says it is busy (Button, Select). @default false */
  decorative?: boolean
}

export function Spinner({ size = 'md', label = 'Loading', decorative = false, className, ...rest }: SpinnerProps) {
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label }
  return <span {...rest} {...a11y} className={clsx(styles.spinner, styles[size], className)} />
}
