import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import { useOverflowCue } from './useOverflowCue'
import styles from './Table.module.css'

export type TableWidth = 'default' | 'wide' | 'narrow' | 'fill'
export type TableAlign = 'left' | 'right' | 'center'
export type TableEmphasis = 'key' | 'dim' | 'id'
export type TableTone = 'pos' | 'neg'

interface TableCommonProps
  extends Omit<TableHTMLAttributes<HTMLTableElement>, 'children' | 'aria-label' | 'aria-labelledby'> {
  children: ReactNode
  /** 560px, 720px, 0px or 100% minimum width. @default 'default' */
  width?: TableWidth
  /** Removes the outer card gutter because a padded parent already owns it. @default false */
  inset?: boolean
  /** The caption is visually hidden by default but remains the table's accessible name. */
  caption?: string
  /** Make a supplied caption visible. @default true */
  hideCaption?: boolean
  /** Class for the horizontal scroll region, separate from the table className. */
  wrapperClassName?: string
}

type CaptionedTableProps = TableCommonProps & {
  caption: string
  'aria-labelledby'?: never
}

type LabelledTableProps = TableCommonProps & {
  caption?: never
  'aria-labelledby': string
}

/** A table must have either a native caption or the id of visible labelling text. */
export type TableProps = CaptionedTableProps | LabelledTableProps

/**
 * Native table semantics plus the approved horizontal overflow treatment. The scroll region
 * only joins the tab order when it actually overflows, so keyboard users do not encounter a
 * dead stop for a table that already fits.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  {
    children,
    width = 'default',
    inset = false,
    caption,
    hideCaption = true,
    wrapperClassName,
    className,
    'aria-labelledby': labelledBy,
    ...rest
  },
  forwardedRef,
) {
  const { ref: scrollRef, cue } = useOverflowCue<HTMLDivElement>([children, width, inset])

  return (
    <div
      ref={scrollRef}
      className={clsx(
        styles.scroller,
        cue.over && styles.overflowing,
        cue.atStart && styles.atStart,
        cue.atEnd && styles.atEnd,
        wrapperClassName,
      )}
      role={cue.over ? 'region' : undefined}
      tabIndex={cue.over ? 0 : undefined}
      aria-label={cue.over && caption ? caption : undefined}
      aria-labelledby={cue.over && !caption ? labelledBy : undefined}
      data-overflow={cue.over ? 'true' : 'false'}
      data-overflow-start={cue.atStart ? 'true' : 'false'}
      data-overflow-end={cue.atEnd ? 'true' : 'false'}
    >
      <table
        {...rest}
        ref={forwardedRef}
        aria-labelledby={labelledBy}
        className={clsx(styles.table, styles[width], inset && styles.inset, className)}
      >
        {caption ? <caption className={hideCaption ? styles.visuallyHidden : styles.caption}>{caption}</caption> : null}
        {children}
      </table>
    </div>
  )
})

export const THead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function THead({ className, ...rest }, ref) {
    return <thead {...rest} ref={ref} className={clsx(styles.head, className)} />
  },
)

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TBody({ className, ...rest }, ref) {
    return <tbody {...rest} ref={ref} className={clsx(styles.body, className)} />
  },
)

export const TFoot = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TFoot({ className, ...rest }, ref) {
    return <tfoot {...rest} ref={ref} className={clsx(styles.foot, className)} />
  },
)

export interface TRProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Hover/pressed treatment. This alone never adds a tab stop. */
  interactive?: boolean
  /** Highlights the row associated with an open detail surface. */
  open?: boolean
  /**
   * Convenience activation for bespoke tables with no focusable cell. Adds a default tab stop
   * and Enter/Space handling; DataTable may instead use the native handlers after inspecting
   * the rendered cells.
   */
  onActivate?: () => void
}

export const TR = forwardRef<HTMLTableRowElement, TRProps>(function TR(
  {
    interactive = false,
    open = false,
    onActivate,
    className,
    tabIndex,
    onClick,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const activatable = typeof onActivate === 'function'

  return (
    <tr
      {...rest}
      ref={ref}
      className={clsx((interactive || activatable) && styles.interactive, open && styles.open, className)}
      tabIndex={tabIndex ?? (activatable ? 0 : undefined)}
      data-state={open ? 'open' : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onActivate?.()
      }}
      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
        onKeyDown?.(event)
        if (event.defaultPrevented || !onActivate || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onActivate()
      }}
    />
  )
})

export interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /** @default 'left' */
  align?: TableAlign
  /** Pins an actions/header cell to the inline end of the horizontal scroller. */
  sticky?: 'end'
}

export const TH = forwardRef<HTMLTableCellElement, THProps>(function TH(
  { align = 'left', sticky, scope = 'col', className, ...rest },
  ref,
) {
  return (
    <th
      {...rest}
      ref={ref}
      scope={scope}
      className={clsx(styles[align], sticky === 'end' && styles.stickyEnd, className)}
    />
  )
})

export interface TDProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align'> {
  /** @default 'left' */
  align?: TableAlign
  emphasis?: TableEmphasis
  tone?: TableTone
  sticky?: 'end'
}

export const TD = forwardRef<HTMLTableCellElement, TDProps>(function TD(
  { align = 'left', emphasis, tone, sticky, className, ...rest },
  ref,
) {
  return (
    <td
      {...rest}
      ref={ref}
      className={clsx(
        styles[align],
        emphasis && styles[emphasis],
        tone && styles[tone],
        sticky === 'end' && styles.stickyEnd,
        className,
      )}
    />
  )
})
