import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import styles from './LayoutPrimitives.module.css'

export type StackGap = 8 | 12 | 16 | 20
export type InlineGap = 6 | 8 | 12
export type GridGap = 12 | 16 | 20
export type GridColumnCount = 1 | 2 | 3 | 4

const STACK_GAP_CLASS: Record<StackGap, string> = {
  8: styles.gap8,
  12: styles.gap12,
  16: styles.gap16,
  20: styles.gap20,
}

const INLINE_GAP_CLASS: Record<InlineGap, string> = {
  6: styles.gap6,
  8: styles.gap8,
  12: styles.gap12,
}

const GRID_GAP_CLASS: Record<GridGap, string> = {
  12: styles.gap12,
  16: styles.gap16,
  20: styles.gap20,
}

const BASE_COLUMN_CLASS: Record<GridColumnCount, string> = {
  1: styles.base1,
  2: styles.base2,
  3: styles.base3,
  4: styles.base4,
}

const MD_COLUMN_CLASS: Record<GridColumnCount, string> = {
  1: styles.md1,
  2: styles.md2,
  3: styles.md3,
  4: styles.md4,
}

const LG_COLUMN_CLASS: Record<GridColumnCount, string> = {
  1: styles.lg1,
  2: styles.lg2,
  3: styles.lg3,
  4: styles.lg4,
}

const XL_COLUMN_CLASS: Record<GridColumnCount, string> = {
  1: styles.xl1,
  2: styles.xl2,
  3: styles.xl3,
  4: styles.xl4,
}

interface PrimitiveProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
}

export interface StackProps extends PrimitiveProps {
  /** @default 20 */
  gap?: StackGap
}

/** A presentational vertical rhythm. A 20px mockup gap steps to 16px below 768px. */
export function Stack({ gap = 20, className, children, ...rest }: StackProps) {
  return (
    <div {...rest} className={clsx(styles.stack, STACK_GAP_CLASS[gap], className)}>
      {children}
    </div>
  )
}

export interface InlineProps extends Omit<PrimitiveProps, 'align'> {
  /** @default 8 */
  gap?: InlineGap
  wrap?: boolean
  align?: 'start' | 'center' | 'end' | 'baseline'
  justify?: 'start' | 'center' | 'end' | 'between'
}

const ALIGN_CLASS: Record<NonNullable<InlineProps['align']>, string> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  baseline: styles.alignBaseline,
}

const JUSTIFY_CLASS: Record<NonNullable<InlineProps['justify']>, string> = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
}

/** A presentational row for controls or short pieces of metadata. */
export function Inline({
  gap = 8,
  wrap = false,
  align = 'center',
  justify = 'start',
  className,
  children,
  ...rest
}: InlineProps) {
  return (
    <div
      {...rest}
      className={clsx(
        styles.inline,
        INLINE_GAP_CLASS[gap],
        wrap && styles.wrap,
        ALIGN_CLASS[align],
        JUSTIFY_CLASS[justify],
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface GridColumns {
  base: GridColumnCount
  md?: GridColumnCount
  lg?: GridColumnCount
  xl?: GridColumnCount
}

export interface GridProps extends PrimitiveProps {
  /** Mobile-first columns: md=768px, lg=1024px, xl=1280px. */
  cols: GridColumns
  /** @default 20 */
  gap?: GridGap
}

/** A fixed, mobile-first responsive grid. Arbitrary CSS column strings are deliberately excluded. */
export function Grid({ cols, gap = 20, className, children, ...rest }: GridProps) {
  return (
    <div
      {...rest}
      className={clsx(
        styles.grid,
        GRID_GAP_CLASS[gap],
        BASE_COLUMN_CLASS[cols.base],
        cols.md && MD_COLUMN_CLASS[cols.md],
        cols.lg && LG_COLUMN_CLASS[cols.lg],
        cols.xl && XL_COLUMN_CLASS[cols.xl],
        className,
      )}
    >
      {children}
    </div>
  )
}
