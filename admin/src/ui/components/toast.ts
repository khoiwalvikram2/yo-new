/* The kit's toast queue. `toast()` may be called from anywhere — an Apollo link, a service, an event
 * handler — so the queue is a plain module-level store rather than a hook, and `<Toaster />` (mounted
 * once at the app root) subscribes to it and does the rendering, the timing and the dismissing.
 *
 * The mockup's own toast (M:2845-2871) sets the behaviour this keeps: at most three at a time, the
 * oldest dropping when a fourth arrives, 3.4 seconds on screen, 7 when it carries an action.
 */

export type ToastTone = 'neutral' | 'info' | 'ok' | 'warn' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** The line the user reads, and what a screen reader announces. */
  message: string
  /** An optional stronger first line, e.g. "Export failed". */
  title?: string
  /** @default 'neutral' */
  tone?: ToastTone
  /** A single control, e.g. Undo. A toast with an action stays twice as long. */
  action?: ToastAction
  /** Milliseconds on screen. 0 keeps it until it is dismissed. Defaults to 3400, or 7000 with an action. */
  duration?: number
  /** Shows a spinner instead of a tone glyph, for work in progress. Implies duration 0. */
  busy?: boolean
}

export interface ToastRecord extends ToastOptions {
  id: number
  tone: ToastTone
  duration: number
}

/** The mockup's own timings (M:2871). */
export const TOAST_DURATION_MS = 3400
export const TOAST_ACTION_DURATION_MS = 7000
/** The mockup keeps at most three (M:2868). */
export const TOAST_LIMIT = 3

let nextId = 1
let queue: ToastRecord[] = []
const listeners = new Set<(toasts: readonly ToastRecord[]) => void>()

function emit() {
  for (const listener of listeners) listener(queue)
}

/** Raise a toast. Returns its id, which `toast.dismiss` takes. */
function raise(options: ToastOptions): number {
  const id = nextId++
  const busy = options.busy === true
  const duration =
    options.duration ??
    (busy ? 0 : options.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS)

  const record: ToastRecord = {
    ...options,
    id,
    tone: options.tone ?? 'neutral',
    duration: busy ? 0 : duration,
  }

  /* The oldest goes when a fourth arrives, as the mockup does, so a burst of feedback cannot bury the
     page under toasts. */
  queue = [...queue, record].slice(-TOAST_LIMIT)
  emit()
  return id
}

export const toast = Object.assign(raise, {
  dismiss(id: number) {
    const next = queue.filter((t) => t.id !== id)
    if (next.length === queue.length) return
    queue = next
    emit()
  },
  /** Every toast currently queued. The Toaster renders these. */
  peek(): readonly ToastRecord[] {
    return queue
  },
  /** Drop everything. Used by tests and by a sign-out that clears the screen. */
  clear() {
    if (queue.length === 0) return
    queue = []
    emit()
  },
})

/** Subscribe to the queue. Returns the unsubscribe function. */
export function subscribeToasts(listener: (toasts: readonly ToastRecord[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
