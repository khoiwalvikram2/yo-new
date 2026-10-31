import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { LiveEmitter } from '@src/realtime/agentScopedLive.js'
import type { SportsLiveDashboard } from '../LiveAnalyticsService.js'
import { createSportsDashboardStream } from '../sportsDashboardStream.js'

function emitter() {
  const listeners = new Map<string, (message: unknown, done?: () => void) => void>()
  let acks = 0
  return {
    on: (topic: string, listener: (message: unknown, done?: () => void) => void) => listeners.set(topic, listener),
    removeListener: (topic: string) => listeners.delete(topic),
    send: (topic: string, message: unknown) => listeners.get(topic)?.(message, () => { acks++ }),
    count: () => listeners.size,
    acks: () => acks,
  } satisfies LiveEmitter & Record<string, unknown>
}
const snapshot = (amount: number) => ({ kpis: { totalStake: amount }, breakdown: {} }) as SportsLiveDashboard
async function next(stream: AsyncIterableIterator<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([stream.next(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Snapshot did not arrive')), 2000) })]) }
  finally { clearTimeout(timer) }
}

describe('Sports admin raw dashboard stream', () => {
  it('provides its initial frame without a Redis publish or the sixty-second safety tick', async () => {
    const transport = emitter()
    const value = snapshot(10)
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', compute: async () => value })
    try {
      assert.deepEqual(await next(stream), { value: { sportsLiveDashboard: value }, done: false })
      assert.equal(transport.acks(), 0)
    } finally { await stream.return!() }
    assert.equal(transport.count(), 0)
  })
  it('wraps live messages for the GraphQL field resolver and bounds a burst to the newest queued snapshot', async () => {
    const transport = emitter()
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', compute: async () => snapshot(1) })
    try {
      await next(stream)
      for (let value = 2; value <= 50; value++) transport.send('brand-a', { payload: { sportsLiveDashboard: snapshot(value) } })
      assert.deepEqual((await next(stream)).value, { sportsLiveDashboard: snapshot(50) })
      assert.equal(transport.acks(), 49)
    } finally { await stream.return!() }
  })
  it('does not replace a newer live frame with a slow initial computation', async () => {
    const transport = emitter()
    let release!: (value: SportsLiveDashboard) => void
    const pending = new Promise<SportsLiveDashboard>(resolve => { release = resolve })
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', compute: () => pending })
    try {
      transport.send('brand-a', { sportsLiveDashboard: snapshot(20) })
      release(snapshot(10))
      await pending
      assert.deepEqual((await next(stream)).value, { sportsLiveDashboard: snapshot(20) })
    } finally { await stream.return!() }
  })
  it('resolves a waiting reader on unsubscribe and ignores computations completed after close', async () => {
    const transport = emitter()
    let release!: (value: SportsLiveDashboard) => void
    const pending = new Promise<SportsLiveDashboard>(resolve => { release = resolve })
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', compute: () => pending })
    const waiting = stream.next()
    await stream.return!()
    assert.deepEqual(await waiting, { value: undefined, done: true })
    release(snapshot(10)); await pending
    assert.deepEqual(await stream.next(), { value: undefined, done: true })
    assert.equal(transport.count(), 0)
  })
  it('recovers from an initial computation failure via a later live frame', async () => {
    const transport = emitter()
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', compute: async () => { throw new Error('Temporary failure') } })
    try {
      await Promise.resolve()
      transport.send('brand-a', { payload: { sportsLiveDashboard: snapshot(30) } })
      assert.deepEqual((await next(stream)).value, { sportsLiveDashboard: snapshot(30) })
    } finally { await stream.return!() }
  })
  it('still computes safety refreshes after the initial frame', async () => {
    const transport = emitter()
    let count = 0
    const stream = createSportsDashboardStream({ emitter: transport, topic: 'brand-a', intervalMs: 10, compute: async () => snapshot(++count) })
    try {
      assert.deepEqual((await next(stream)).value, { sportsLiveDashboard: snapshot(1) })
      const refreshed = (await next(stream)).value as { sportsLiveDashboard: SportsLiveDashboard }
      assert.ok(refreshed.sportsLiveDashboard.kpis.totalStake >= 2)
    } finally { await stream.return!() }
  })
})
