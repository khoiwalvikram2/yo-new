import type { CSSProperties, HTMLAttributes } from 'react'
import clsx from 'clsx'
import { Spinner } from './Spinner'
import styles from './LoadingState.module.css'

/* What a region shows while it waits for its first data: a route's lazy chunk, a card before its
   query answers, a table before its first page. It is one `role="status"` whose name is the only text
   assistive tech hears — the ring beside it is decorative, so a screen reader is not told "Loading"
   twice.
   It replaces the antd `Spin` blocks the pages use today; the router's own fallback was an antd Spin
   inside a `min-h-screen` wrapper, which pushed the shell's content column past the viewport
   (page migration C, G3). */

export interface LoadingStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> {
  /** The name assistive tech hears. @default 'Loading' */
  label?: string
  /** Fill the flex column it sits in (the route fallback) instead of reserving a fixed height. */
  fill?: boolean
  /** Reserved height when it is not filling: 256px for a table card, 192px for a small one. @default 256 */
  minHeight?: 192 | 256
  /** The exact pixel height of the content it stands in for (a chart's plot, a fixed panel), so nothing
   *  moves when that content lands. Takes precedence over `minHeight`; kept between 24 and 4096. */
  height?: number
}

type HeightVariable = CSSProperties & { '--loading-height': string }

export function LoadingState({
  label = 'Loading',
  fill = false,
  minHeight = 256,
  height,
  className,
  style,
  ...rest
}: LoadingStateProps) {
  const exactHeight =
    !fill && typeof height === 'number' && Number.isFinite(height) ? Math.min(4096, Math.max(24, height)) : undefined
  const exact = exactHeight !== undefined
  const variables: HeightVariable | undefined = exact
    ? { ...style, '--loading-height': `${exactHeight}px` }
    : undefined
  return (
    <div
      {...rest}
      role="status"
      style={variables ?? style}
      className={clsx(
        styles.state,
        fill ? styles.fill : exact ? styles.exact : minHeight === 192 ? styles.sm : styles.md,
        className,
      )}
    >
      <Spinner size={exactHeight !== undefined && exactHeight < 64 ? 'md' : 'lg'} decorative />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
