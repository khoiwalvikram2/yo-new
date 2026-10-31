import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconExclamationCircle,
  IconInfoCircle,
  IconX,
} from '@tabler/icons-react'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Spinner } from './Spinner'
import { strokeFor } from './icons'
import { subscribeToasts, toast, type ToastRecord, type ToastTone } from './toast'
import styles from './Toaster.module.css'

/* Renders the toast queue (ui/components/toast.ts). Mounted once, at the app root.
 *
 * Two live regions are always in the DOM so that a toast inserted into one is announced: failures go
 * to the assertive region, everything else to the polite one. Focus never moves into a toast — the
 * page keeps it — so a toast that carries an action also carries enough time to reach it (7s, the
 * mockup's own, M:2871), and the timer pauses while the pointer or the keyboard is in the stack. Every
 * toast also carries a dismiss button (kit .toast .ibtn), so one need not be waited out.
 */

const TONE_GLYPH: Record<ToastTone, typeof IconInfoCircle | null> = {
  neutral: null,
  info: IconInfoCircle,
  ok: IconCircleCheck,
  warn: IconAlertTriangle,
  error: IconExclamationCircle,
}

const TONE_CLASS: Record<ToastTone, string | undefined> = {
  neutral: undefined,
  info: styles.info,
  ok: styles.ok,
  warn: styles.warn,
  error: styles.error,
}

function ToastItem({ record }: { record: ToastRecord }) {
  const Glyph = TONE_GLYPH[record.tone]
  return (
    <li className={clsx(styles.toast, TONE_CLASS[record.tone])}>
      {record.busy ? (
        <Spinner size="sm" decorative className={styles.glyph} />
      ) : Glyph ? (
        <span className={styles.glyph} aria-hidden="true">
          <Glyph size={16} stroke={strokeFor(16)} />
        </span>
      ) : null}
      <div className={styles.body}>
        {record.title ? <p className={styles.title}>{record.title}</p> : null}
        <p className={styles.message}>{record.message}</p>
      </div>
      {record.action ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            toast.dismiss(record.id)
            record.action?.onClick()
          }}
        >
          {record.action.label}
        </Button>
      ) : null}
      <IconButton
        size="sm"
        label="Dismiss notification"
        icon={<IconX size={16} stroke={strokeFor(16)} />}
        className={styles.dismiss}
        onClick={() => toast.dismiss(record.id)}
      />
    </li>
  )
}

export function Toaster() {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>(() => toast.peek())
  const [paused, setPaused] = useState(false)
  /* Each toast's remaining time, so a pause does not restart it. */
  const remaining = useRef(new Map<number, number>())
  const startedAt = useRef(new Map<number, number>())

  useEffect(() => subscribeToasts(setToasts), [])

  const dismiss = useCallback((id: number) => {
    toast.dismiss(id)
  }, [])

  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id))
    for (const id of remaining.current.keys()) {
      if (!live.has(id)) {
        remaining.current.delete(id)
        startedAt.current.delete(id)
      }
    }
    if (paused) {
      // freeze what is left of each timer
      for (const record of toasts) {
        const started = startedAt.current.get(record.id)
        if (started === undefined) continue
        const left = (remaining.current.get(record.id) ?? record.duration) - (Date.now() - started)
        remaining.current.set(record.id, Math.max(0, left))
        startedAt.current.delete(record.id)
      }
      return
    }

    const timers: number[] = []
    for (const record of toasts) {
      if (record.duration <= 0) continue
      const left = remaining.current.get(record.id) ?? record.duration
      remaining.current.set(record.id, left)
      startedAt.current.set(record.id, Date.now())
      timers.push(window.setTimeout(() => dismiss(record.id), left))
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [toasts, paused, dismiss])

  const polite = toasts.filter((t) => t.tone !== 'error')
  const assertive = toasts.filter((t) => t.tone === 'error')

  return (
    <div
      className={styles.host}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <ul className={styles.region} role="status" aria-label="Notifications">
        {polite.map((record) => (
          <ToastItem key={record.id} record={record} />
        ))}
      </ul>
      <ul className={styles.region} role="alert" aria-label="Errors">
        {assertive.map((record) => (
          <ToastItem key={record.id} record={record} />
        ))}
      </ul>
    </div>
  )
}
