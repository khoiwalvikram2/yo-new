import type { LiveEmitter } from './agentScopedLive.js'

interface SnapshotStreamOptions<Snapshot, Frame> {
  emitter: LiveEmitter
  topic: string
  compute: () => Promise<Snapshot>
  extract: (message: any) => Snapshot
  wrap: (snapshot: Snapshot) => Frame
  intervalMs?: number
}

/** Admin snapshot stream: initial local delivery, live frames, bounded backlog and explicit teardown. */
export function createSnapshotStream<Snapshot, Frame>({ emitter, topic, compute, extract, wrap, intervalMs = 60000 }: SnapshotStreamOptions<Snapshot, Frame>): AsyncIterableIterator<Frame> {
  let closed = false
  let running = false
  let revision = 0
  let latest: Frame | null = null
  let waiting: ((result: IteratorResult<Frame>) => void) | null = null
  const push = (snapshot: Snapshot) => {
    if (closed || !snapshot) return
    const frame = wrap(snapshot)
    if (waiting) {
      const resolve = waiting
      waiting = null
      resolve({ value: frame, done: false })
    } else latest = frame
  }
  const listener = (message: any, done?: () => void) => {
    try { revision++; push(extract(message)) }
    finally { done?.() }
  }
  const refresh = async () => {
    if (closed || running) return
    running = true
    const before = revision
    try {
      const snapshot = await compute()
      if (revision === before) push(snapshot)
    } catch { /* Keep the last good frame and recover on a later update. */ }
    finally { running = false }
  }
  emitter.on(topic, listener)
  const interval = setInterval(() => void refresh(), intervalMs)
  const close = () => {
    if (closed) return
    closed = true
    latest = null
    clearInterval(interval)
    try { emitter.removeListener(topic, listener) } catch { /* Best-effort teardown. */ }
    waiting?.({ value: undefined, done: true })
    waiting = null
  }
  void refresh()
  return {
    next: () => {
      if (closed) return Promise.resolve({ value: undefined, done: true })
      if (latest) { const value = latest; latest = null; return Promise.resolve({ value, done: false }) }
      return new Promise(resolve => { waiting = resolve })
    },
    return: async () => { close(); return { value: undefined, done: true } },
    throw: async error => { close(); throw error },
    [Symbol.asyncIterator]() { return this },
  }
}
