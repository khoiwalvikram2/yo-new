import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import styles from './EmptyState.module.css'

export type EmptyStateTone = 'neutral' | 'ok'
export type EmptyStateInset = 'card' | 'none'

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** Visible text, deliberately not rendered as a heading. */
  title: string
  description?: ReactNode
  /** Decorative glyph displayed in the status tile. */
  icon?: ReactNode
  /** @default 'neutral' */
  tone?: EmptyStateTone
  /** A real control or link supplied by the caller. */
  action?: ReactNode
  /** Card padding or no outer padding for an already-inset host. @default 'card' */
  inset?: EmptyStateInset
}

/** A quiet no-content state that does not invent a heading in the page outline. */
export function EmptyState({
  title,
  description,
  icon,
  tone = 'neutral',
  action,
  inset = 'card',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} className={clsx(styles.empty, styles[inset], styles[tone], className)}>
      {icon !== undefined && icon !== null && icon !== false ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className={styles.title}>{title}</p>
      {description !== undefined && description !== null && description !== false ? (
        <div className={styles.description}>{description}</div>
      ) : null}
      {action !== undefined && action !== null && action !== false ? (
        <div className={styles.action}>{action}</div>
      ) : null}
    </div>
  )
}
