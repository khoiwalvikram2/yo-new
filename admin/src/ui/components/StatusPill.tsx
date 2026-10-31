import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import styles from './StatusPill.module.css'

/** Semantic status tones. The visible label, never this tone, carries the meaning. */
export type StatusPillTone = 'ok' | 'neg' | 'warn' | 'info' | 'neutral' | 'muted'

const TONES_BY_STATUS: Readonly<Record<string, StatusPillTone>> = {
  pending: 'warn',

  approved: 'ok',
  completed: 'ok',
  active: 'ok',
  live: 'ok',
  enabled: 'ok',
  settled: 'ok',
  ready: 'ok',
  visible: 'ok',
  matched: 'ok',
  verified: 'ok',
  paid: 'ok',

  rejected: 'neg',
  failed: 'neg',
  suspended: 'neg',
  blocked: 'neg',

  processing: 'info',
  open: 'info',
  inplay: 'info',
  scheduled: 'info',
  test: 'info',

  cancelled: 'muted',
  disabled: 'muted',
  paused: 'muted',
  ended: 'muted',
  expired: 'muted',
  draft: 'muted',
  hidden: 'muted',
  unmatched: 'muted',
}

/**
 * Maps every status family named by the page-migration design to a semantic tone.
 *
 * Values are case-insensitive and separators are ignored so API spellings such as
 * `IN_PLAY` resolve to the design's `inplay` entry. Unknown values stay neutral.
 */
// The public design contract exports this pure mapper beside the component.
// eslint-disable-next-line react-refresh/only-export-components
export function toneForStatus(status: string): StatusPillTone {
  const key = status.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
  return TONES_BY_STATUS[key] ?? 'neutral'
}

export interface StatusPillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Visible status label. Colour is never the only carrier of meaning. */
  children: ReactNode
  /** Used to derive a tone when `tone` is omitted. */
  status?: string
  /** Explicitly overrides the status-derived tone. @default status-derived or 'neutral' */
  tone?: StatusPillTone
  /** Decorative leading glyph. */
  icon?: ReactNode
}

/** A compact, non-interactive semantic status label. */
export function StatusPill({
  children,
  status,
  tone,
  icon,
  className,
  ...rest
}: StatusPillProps) {
  const resolvedTone = tone ?? (status === undefined ? 'neutral' : toneForStatus(status))

  return (
    <span {...rest} className={clsx(styles.pill, styles[resolvedTone], className)}>
      {icon !== undefined && icon !== null && icon !== false ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.label}>{children}</span>
    </span>
  )
}
