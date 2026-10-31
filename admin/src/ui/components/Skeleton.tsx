import type { CSSProperties, HTMLAttributes } from 'react'
import clsx from 'clsx'
import styles from './Skeleton.module.css'

export type SkeletonRadius = 'row' | 'ctl' | 'card' | 'pill'
export type SkeletonWidth = number | 'full'

export interface SkeletonProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'role' | 'style' | 'aria-hidden'> {
  /** Pixel width, or the width of the containing block. @default 'full' */
  width?: SkeletonWidth
  /** Pixel height of each line. @default 12 */
  height?: number
  /** Shape token used by every line. @default 'row' */
  radius?: SkeletonRadius
  /** Number of equal lines. Values are kept between 1 and 12. @default 1 */
  lines?: number
}

type SkeletonVariables = CSSProperties & {
  '--skeleton-width': string
  '--skeleton-height': string
}

const boundedPixels = (value: number | undefined, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(4096, Math.max(1, value))
}

const boundedLines = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(12, Math.max(1, Math.trunc(value)))
}

/**
 * A decorative placeholder. The region that owns it is responsible for `aria-busy` and any
 * loading announcement; the skeleton itself deliberately stays out of the accessibility tree.
 */
export function Skeleton({
  width = 'full',
  height = 12,
  radius = 'row',
  lines = 1,
  className,
  ...rest
}: SkeletonProps) {
  const variables: SkeletonVariables = {
    '--skeleton-width': width === 'full' ? '100%' : `${boundedPixels(width, 1)}px`,
    '--skeleton-height': `${boundedPixels(height, 12)}px`,
  }
  const lineCount = boundedLines(lines)

  return (
    <span
      {...rest}
      aria-hidden="true"
      className={clsx(styles.skeleton, styles[radius], className)}
      style={variables}
    >
      {Array.from({ length: lineCount }, (_, index) => (
        <span className={styles.line} key={index} />
      ))}
    </span>
  )
}
