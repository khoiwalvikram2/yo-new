/**
 * Live-analysis subscriptions for agent callers (W4).
 *
 * The live topics are per whitelabel. An agent subscribed to them received the
 * whitelabel's dashboards, every player's casino/matka events and the
 * tenant-wide exposure book. For an agent the resolvers now (a) filter player
 * events to the agent's own players and (b) never forward a shared topic's
 * payload, recomputing the agent's own snapshot instead. Auth is checked in
 * the resolver because mercurius does not run the context function for
 * WebSockets.
 *
 * An in-memory emitter stands in for Redis; no database or Redis is touched.
 *   node --env-file-if-exists=.env --test --import tsx src/realtime/__tests__/agentScopedLive.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  agentPlayerMatcher,
  createFilteredIterator,
  createRecomputeIterator,
  subscriptionAgentId,
  type LiveEmitter,
} from '@src/realtime/agentScopedLive.js'

function fakeEmitter() {
  const listeners = new Map<string, Set<(msg: any, done?: () => void) => void>>()
  const emitter: LiveEmitter & { emit(topic: string, payload: unknown): void; count(topic: string): number } = {
    on(topic, listener) {
      if (!listeners.has(topic)) listeners.set(topic, new Set())
      listeners.get(topic)!.add(listener)
      return emitter
    },
    removeListener(topic, listener) {
      listeners.get(topic)?.delete(listener)
      return emitter
    },
    emit(topic, payload) {
      for (const l of listeners.get(topic) ?? []) l({ topic, payload }, () => {})
    },
    count(topic) {
      return listeners.get(topic)?.size ?? 0
    },
  }
  return emitter
}

const tick = () => new Promise((r) => setTimeout(r, 10))

async function take(it: AsyncIterator<unknown>, n: number, timeoutMs = 500): Promise<unknown[]> {
  const out: unknown[] = []
  for (let i = 0; i < n; i++) {
    const next = await Promise.race([
      it.next(),
      new Promise<IteratorResult<unknown>>((r) => setTimeout(() => r({ value: '__timeout__', done: true }), timeoutMs)),
    ])
    if (next.done) break
    out.push(next.value)
  }
  return out
}

describe('player events for an agent', () => {
  it('drops other agents’ players’ events and forwards its own', async () => {
    const emitter = fakeEmitter()
    const topic = 'casino.live.player.brand-a.brand-a'
    const players = agentPlayerMatcher('agent-1', 'brand-a', async () => [11, 12])
    const it = createFilteredIterator({
      topic,
      extract: (msg) => msg?.payload?.casinoPlayerEvents ?? null,
      allow: (event) => players.has(event?.userId),
      wrap: (event) => ({ casinoPlayerEvents: event }),
      emitter,
    })
    emitter.emit(topic, { casinoPlayerEvents: { id: 'b1', userId: '11' } })
    emitter.emit(topic, { casinoPlayerEvents: { id: 'b2', userId: '99' } }) // another agent's player
    emitter.emit(topic, { casinoPlayerEvents: { id: 'b3', userId: null } }) // nobody's
    emitter.emit(topic, { casinoPlayerEvents: { id: 'b4', userId: 12 } })
    const got = (await take(it, 3, 150)) as any[]
    assert.deepEqual(got.map((g) => g.casinoPlayerEvents.id), ['b1', 'b4'])
    await it.return!()
    assert.equal(emitter.count(topic), 0, 'unsubscribing removes the listener')
  })

  it('picks up a player created after the socket opened (refresh on a miss)', async () => {
    let list = [11]
    let loads = 0
    const players = agentPlayerMatcher('agent-1', 'brand-a', async () => { loads++; return list }, 0)
    assert.equal(await players.has(13), false)
    list = [11, 13]
    assert.equal(await players.has(13), true)
    assert.ok(loads >= 2)
  })

  it('does not reload on every miss within the refresh window', async () => {
    let loads = 0
    const players = agentPlayerMatcher('agent-1', 'brand-a', async () => { loads++; return [1] }, 60_000)
    await players.has(2)
    await players.has(3)
    await players.has(4)
    assert.equal(loads, 1)
  })

  it('removes a formerly owned player once the membership cache expires', async () => {
    let list = [11]
    const players = agentPlayerMatcher('agent-1', 'brand-a', async () => list, 0)
    assert.equal(await players.has(11), true)
    list = []
    assert.equal(await players.has(11), false)
  })

  it('refuses to reuse an expired positive match when ownership cannot be refreshed', async () => {
    let unavailable = false
    const players = agentPlayerMatcher('agent-1', 'brand-a', async () => {
      if (unavailable) throw new Error('Ownership unavailable')
      return [11]
    }, 0)
    assert.equal(await players.has(11), true)
    unavailable = true
    await assert.rejects(() => players.has(11), /Ownership unavailable/)
  })
})

describe('dashboards, books and alerts for an agent', () => {
  it('never forwards the whitelabel snapshot from the shared topic; recomputes its own', async () => {
    const emitter = fakeEmitter()
    const topic = 'sports.live.dashboard.brand-a.brand-a'
    let n = 0
    const it = createRecomputeIterator({
      compute: async () => ({ scope: 'agent-1', n: ++n }),
      wrap: (s) => ({ sportsLiveDashboard: s }),
      tickTopics: [topic],
      intervalMs: 60_000,
      minGapMs: 0,
      emitter,
    })
    const first = (await take(it, 1)) as any[]
    assert.equal(first[0].sportsLiveDashboard.scope, 'agent-1')
    await tick()
    // A whitelabel-wide snapshot published by pgBridge (or another agent's ticker).
    emitter.emit(topic, { sportsLiveDashboard: { scope: 'WHITELABEL', n: -1 } })
    const second = (await take(it, 1)) as any[]
    assert.equal(second.length, 1)
    assert.equal(second[0].sportsLiveDashboard.scope, 'agent-1', 'the shared payload leaked to the agent')
    assert.ok(second[0].sportsLiveDashboard.n >= 2, 'the tick triggered a recompute')
    await it.return!()
    assert.equal(emitter.count(topic), 0)
  })

  it('stops computing after the client unsubscribes', async () => {
    const emitter = fakeEmitter()
    let calls = 0
    const it = createRecomputeIterator({
      compute: async () => ++calls,
      wrap: (s) => ({ matkaExposureBook: s }),
      tickTopics: ['t'],
      intervalMs: 20,
      emitter,
    })
    await take(it, 1)
    await it.return!()
    const after = calls
    await new Promise((r) => setTimeout(r, 80))
    emitter.emit('t', {})
    await tick()
    assert.equal(calls, after)
  })
})

describe('auth inside the subscription resolver', () => {
  it('refuses a socket with no session', () => {
    assert.throws(() => subscriptionAgentId({}), /Unauthorized/)
    assert.throws(() => subscriptionAgentId(undefined), /Unauthorized/)
  })

  it('returns null for an admin and the id for an agent', () => {
    assert.equal(subscriptionAgentId({ user: { sub: '1', roles: [] } }), null)
    assert.equal(subscriptionAgentId({ user: { type: 'agent', agentId: 'agent-1' } }), 'agent-1')
  })

  it('fails closed for an agent session without an id', () => {
    assert.throws(() => subscriptionAgentId({ user: { type: 'agent' } }), /Forbidden/)
  })
})

describe('the live resolvers use these for agents', () => {
  it('casino, matka and sports subscriptions route agent callers through the scoped iterators', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
    const casino = read('src/domains/casino/resolvers/subscriptions.ts')
    const matka = read('src/domains/matka/resolvers/subscriptions.ts')
    const sports = read('src/domains/sports/resolvers/subscriptions.ts')
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
    assert.ok(count(casino, /createFilteredIterator\(/g) >= 1 && count(casino, /createRecomputeIterator\(/g) >= 1, 'casino')
    assert.ok(count(matka, /createFilteredIterator\(/g) >= 1 && count(matka, /createRecomputeIterator\(/g) >= 3, 'matka: dashboard, exposure book, risk alerts')
    assert.ok(count(sports, /createFilteredIterator\(/g) >= 1 && count(sports, /createRecomputeIterator\(/g) >= 2, 'sports: dashboard, risk alerts')
  })
})
