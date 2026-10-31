import mqemitter from 'mqemitter-redis'

// Deliberately loose: the subscription resolvers use emitter methods that
// mqemitter-redis does not declare (off, three-argument on). Tightening this
// type is a separate change from fixing what the emitter connects to.
let emitter: any | null = null

/**
 * Turns REDIS_URL into the connection options mqemitter-redis expects.
 *
 * This used to read REDIS_URL and then connect to localhost:6379 regardless.
 * The emitter exists so subscriptions fan out between instances; pointed at a
 * local Redis that other instances cannot see, it does the opposite of its job
 * silently — every instance publishes only to itself.
 */
function connectionOptions(): Record<string, unknown> {
  const raw = process.env.REDIS_URL || 'redis://localhost:6379'
  try {
    const url = new URL(raw)
    const db = Number(url.pathname.replace('/', '')) || 0
    return {
      host: url.hostname || 'localhost',
      port: Number(url.port) || 6379,
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.username && url.username !== 'default'
        ? { username: decodeURIComponent(url.username) }
        : {}),
      ...(db ? { db } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    }
  } catch {
    console.error('[redis] REDIS_URL is not a valid URL; falling back to localhost:6379', { raw })
    return { host: 'localhost', port: 6379 }
  }
}

export function getRedisEmitter() {
  if (emitter) return emitter

  emitter = mqemitter(connectionOptions() as never)

  // Swallowing this hid a Redis outage completely: subscriptions would stop
  // crossing instances with nothing said anywhere. It is logged, not thrown —
  // ioredis reconnects on its own and an unhandled 'error' would end the process.
  // `on` subscribes to a Redis message topic. Connection failures are events on
  // mqemitter-redis's separate state emitter and otherwise go unhandled.
  emitter.state.on('error', (err: Error) => {
    console.error('[redis] pub/sub emitter error', { error: err?.message ?? String(err) })
  })

  return emitter
}

/**
 * Releases the emitter's Redis connections.
 *
 * Needed by graceful shutdown, which closed the database pool and left these
 * open, and by any short-lived process — a test, a script — that publishes an
 * event and would otherwise never exit.
 */
export async function closeRedisEmitter(): Promise<void> {
  const current = emitter
  if (!current) return
  emitter = null
  await new Promise<void>((resolve) => {
    try {
      const done = () => resolve()
      // mqemitter's close takes a callback; guard in case it resolves neither way.
      const timer = setTimeout(done, 2000)
      timer.unref?.()
      current.close(() => {
        clearTimeout(timer)
        done()
      })
    } catch {
      resolve()
    }
  })
}
