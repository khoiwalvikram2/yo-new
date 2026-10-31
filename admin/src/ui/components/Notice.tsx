import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import styles from './Notice.module.css'

/* The kit's stand-in for antd's Alert and Result: the same message, the same tones, no antd surface
   and no light-only colours. Promoted out of the dashboard, which built it first (page migration C,
   D14).

   It is not a live region by default. A notice that is already on the page when it renders — an
   access-denied state, a mode explainer — must not be announced; only one raised in answer to
   something the user just did says `live`. */

export type NoticeTone = 'neutral' | 'info' | 'warn' | 'error' | 'ok'

const TONE_CLASS: Record<NoticeTone, string | undefined> = {
  neutral: undefined,
  info: styles.info,
  warn: styles.warn,
  error: styles.error,
  ok: styles.ok,
}

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'role'> {
  /** @default 'neutral' */
  tone?: NoticeTone
  /** A glyph for the tone; it is decorative, so the text must carry the meaning. */
  icon?: ReactNode
  /** One short line above the body. */
  title?: ReactNode
  /** The message. Phrasing content: it renders inside a paragraph. */
  children?: ReactNode
  /** A control at the end of the row, e.g. "Go to home". */
  action?: ReactNode
  /** 'strip' spans the page and drops the card's radius and side borders. @default 'block' */
  layout?: 'block' | 'strip'
  /** Announce it when it appears. @default 'off' */
  live?: 'off' | 'polite' | 'assertive'
}

export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  layout = 'block',
  live = 'off',
  className,
  ...rest
}: NoticeProps) {
  const liveProps =
    live === 'off'
      ? {}
      : { role: live === 'assertive' ? ('alert' as const) : ('status' as const) }

  return (
    <div
      {...rest}
      {...liveProps}
      className={clsx(styles.notice, TONE_CLASS[tone], layout === 'strip' && styles.strip, className)}
    >
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <p className={styles.text}>{children}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
