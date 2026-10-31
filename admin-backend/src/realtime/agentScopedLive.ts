import { getRedisEmitter } from '@src/realtime/redisPubsub.js'

/**
 * Agent scoping for the live-analysis subscriptions.
 *
 * The live topics are per whitelabel (`<domain>.live.dashboard.<tenant>.<wl>`,
 * `<domain>.live.player.<tenant>.<wl>`, the matka exposure book and the risk
 * alert topics). An agent subscribing to them received:
 *   - the whitelabel-wide dashboard snapshots pgBridge publishes on every bet,
 *     and the snapshots any other subscriber's ticker published (another
 *     agent's included) — and its own agent-scoped ticker published onto the
 *     same shared topic, so admins were handed an agent's figures in return;
 *   - every player event of the whitelabel (casino and matka had no filter);
 *   - the tenant-wide matka exposure book and risk alerts.
 *
 * For an agent caller the subscription resolvers therefore never forward a
 * shared topic's payload. Dashboards, books and alerts are recomputed for the
 * agent (the shared topic is only a "something changed" tick), and player
 * events are filtered to the agent's own players.
 *
 * Authentication is checked here too, inside the resolver: mercurius does not
 * run the HTTP context function for WebSocket subscriptions, so nothing but
 * `onConnect` + `guardSubscriptions` stands in front of these, and a resolver
 * must not assume a user it has not looked at.
 */

type Listener = (msg: any, done?: () => void) => void
export interface LiveEmitter {
  on(topic: string, listener: Listener, cb?: () => void): unknown
  removeListener(topic: string, listener: Listener, cb?: () => void): unknown
}

/**
 * The agent a subscription must be scoped to, or null for a non-agent caller.
 * Throws when there is no session at all, or an agent session without an id
 * (which cannot be scoped, so it fails closed).
 */
export function subscriptionAgentId(ctx: any): string | null {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  if (ctx.user.type !== 'agent') return null
  const agentId = ctx.user.agentId ? String(ctx.user.agentId) : ''
  if (!agentId) throw new Error('Forbidden: agent session has no agent id')
  return agentId
}

/** A minimal push/pull async iterator with explicit teardown. */
class PushIterator implements AsyncIterableIterator<unknown> {
  private queue: unknown[] = []
  private waiting: ((r: IteratorResult<unknown>) => void) | null = null
  private closed = false
  constructor(private readonly onClose: () => void, private readonly maxQueue: number) {}

  push(value: unknown): void {
    if (this.closed) return
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value, done: false })
      return
    }
    this.queue.push(value)
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue)
  }

  get isClosed(): boolean {
    return this.closed
  }

  next(): Promise<IteratorResult<unknown>> {
    if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift(), done: false })
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve) => {
      this.waiting = resolve
    })
  }

  return(): Promise<IteratorResult<unknown>> {
    this.close()
    return Promise.resolve({ value: undefined, done: true })
  }

  throw(err?: unknown): Promise<IteratorResult<unknown>> {
    this.close()
    return Promise.reject(err)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queue.length = 0
    try {
      this.onClose()
    } catch {
      /* teardown is best-effort */
    }
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    return this
  }
}

export interface RecomputeIteratorOptions {
  /** Computes the caller's own snapshot (agent-scoped). */
  compute: () => Promise<unknown>
  /** Wraps a snapshot into the payload shape the field's `resolve` reads. */
  wrap: (snapshot: unknown) => unknown
  /**
   * Shared whitelabel topics whose messages mean "something changed". Their
   * payloads are never forwarded; they only trigger a recompute.
   */
  tickTopics?: string[]
  /** Safety recompute cadence. */
  intervalMs: number
  /** Minimum gap between two recomputes triggered by ticks. */
  minGapMs?: number
  emitter?: LiveEmitter
}

/**
 * Yields only snapshots computed by `compute` — at start, on each tick (throttled,
 * with one trailing run so the last change is reflected) and every `intervalMs`.
 */
export function createRecomputeIterator(opts: RecomputeIteratorOptions): AsyncIterableIterator<unknown> {
  const emitter = opts.emitter ?? (getRedisEmitter() as LiveEmitter)
  const minGap = opts.minGapMs ?? 3000
  const topics = opts.tickTopics ?? []
  let lastRun = 0
  let running = false
  let trailing: ReturnType<typeof setTimeout> | null = null

  const listener: Listener = (_msg, done) => {
    try {
      schedule()
    } finally {
      if (typeof done === 'function') done()
    }
  }

  const it = new PushIterator(() => {
    clearInterval(interval)
    if (trailing) clearTimeout(trailing)
    for (const t of topics) {
      try {
        emitter.removeListener(t, listener)
      } catch {
        /* ignore */
      }
    }
  }, 1)

  async function run(): Promise<void> {
    if (it.isClosed || running) return
    running = true
    lastRun = Date.now()
    try {
      const snapshot = await opts.compute()
      it.push(opts.wrap(snapshot))
    } catch {
      /* a failed recompute keeps the previous snapshot on screen */
    } finally {
      running = false
    }
  }

  function schedule(): void {
    if (it.isClosed) return
    const wait = minGap - (Date.now() - lastRun)
    if (wait <= 0 && !running) {
      void run()
      return
    }
    if (trailing) return
    trailing = setTimeout(() => {
      trailing = null
      void run()
    }, Math.max(wait, 50))
  }

  for (const t of topics) emitter.on(t, listener)
  const interval = setInterval(() => void run(), opts.intervalMs)
  void run()
  return it
}

export interface FilteredIteratorOptions {
  topic: string
  /** The event inside an emitter message. */
  extract: (msg: any) => any
  /** Whether this caller may see the event. */
  allow: (event: any) => boolean | Promise<boolean>
  /** Wraps an allowed event into the payload shape the field's `resolve` reads. */
  wrap: (event: any) => unknown
  emitter?: LiveEmitter
  maxQueue?: number
}

/** Forwards only the events `allow` accepts, in arrival order. */
export function createFilteredIterator(opts: FilteredIteratorOptions): AsyncIterableIterator<unknown> {
  const emitter = opts.emitter ?? (getRedisEmitter() as LiveEmitter)
  let chain: Promise<void> = Promise.resolve()

  const listener: Listener = (msg, done) => {
    try {
      const event = opts.extract(msg)
      chain = chain
        .then(async () => {
          if (it.isClosed || event == null) return
          if (await opts.allow(event)) it.push(opts.wrap(event))
        })
        .catch(() => {
          /* an event that cannot be checked is dropped, never forwarded */
        })
    } finally {
      if (typeof done === 'function') done()
    }
  }

  const it = new PushIterator(() => {
    try {
      emitter.removeListener(opts.topic, listener)
    } catch {
      /* ignore */
    }
  }, opts.maxQueue ?? 100)

  emitter.on(opts.topic, listener)
  return it
}

export type AgentPlayerLoader = (agentId: string, tenant: string) => Promise<Iterable<number>>

/** The agent's players by the canonical CTE (subtree + confirmed referrals). */
export async function loadAgentPlayerIds(agentId: string, tenant: string): Promise<number[]> {
  const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
  return listAgentPlayerIds(agentId, tenant)
}

/**
 * Membership test for "is this user one of the agent's players". Loaded lazily
 * and refreshed at most once per `refreshMs`, for both additions and removals.
 * An expired positive must not keep exposing a player reassigned to another agent.
 */
export function agentPlayerMatcher(
  agentId: string,
  tenant: string,
  loader: AgentPlayerLoader = loadAgentPlayerIds,
  refreshMs = 60_000,
): { has(userId: unknown): Promise<boolean> } {
  let ids: Set<number> | null = null
  let loadedAt = 0
  let inflight: Promise<Set<number>> | null = null

  const load = (): Promise<Set<number>> => {
    if (!inflight) {
      inflight = loader(agentId, tenant)
        .then((list) => {
          ids = new Set(Array.from(list, Number))
          loadedAt = Date.now()
          return ids
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }

  return {
    async has(userId: unknown): Promise<boolean> {
      const id = Number(userId)
      if (userId == null || userId === '' || !Number.isFinite(id)) return false
      const current = ids && Date.now() - loadedAt < refreshMs ? ids : await load()
      return current.has(id)
    },
  }
}
