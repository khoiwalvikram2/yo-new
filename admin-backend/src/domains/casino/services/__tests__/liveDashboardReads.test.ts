import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db, pool } from '@src/db/client.js'
import { QueryCache } from '@src/services/QueryCache.js'
import { createSnapshotStream } from '@src/realtime/snapshotStream.js'
import { clearSnapshot, computeDashboard, getLastSnapshot, type CasinoLiveDashboard } from '../LiveAnalyticsService.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const scope = { tenant: 'brand-a', whitelabelId: 'brand-a', windowMins: 10 }
function database(fail = false) {
  const queries: string[] = []
  mock.method(db, 'execute', async (query: any) => {
    const compiled = new PgDialect().sqlToQuery(query)
    queries.push(compiled.sql)
    if (fail && queries.length === 1) throw new Error('Temporary failure')
    return { rows: compiled.sql.includes('as active_players') ? [{ total_bets: '10', wagered: '100', payouts: '80', active_players: '2' }] : [] } as any
  })
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})
  return queries
}
describe('Casino live snapshot reads', () => {
  it('coalesces simultaneous same-scope misses, with a fresh computation for the next miss', async () => {
    const queries = database()
    const [first, second] = await Promise.all([computeDashboard(scope), computeDashboard({ ...scope })])
    assert.equal(first, second)
    assert.equal(queries.length, 4)
    await computeDashboard(scope)
    assert.equal(queries.length, 8)
  })
  it('keeps windows, tenants and agents separate, including remembered snapshots', async () => {
    const queries = database()
    const scopes = [scope, { ...scope, windowMins: 30 }, { ...scope, agentId: 'a' }, { ...scope, agentId: 'b' }, { tenant: 'brand-b', whitelabelId: 'brand-b', windowMins: 10 }]
    for (const value of scopes) clearSnapshot(value)
    const snapshots = await Promise.all(scopes.map(value => computeDashboard(value)))
    assert.equal(queries.length, 20)
    assert.equal(new Set(snapshots).size, 5)
    scopes.forEach((value, index) => assert.equal(getLastSnapshot(value), snapshots[index]))
    clearSnapshot(scopes[2]); assert.equal(getLastSnapshot(scopes[2]), null)
    assert.equal(getLastSnapshot(scope), snapshots[0])
  })
  it('clears failed reads so a later request recovers', async () => {
    const queries = database(true)
    assert.ok((await Promise.allSettled([computeDashboard(scope), computeDashboard(scope)])).every(result => result.status === 'rejected'))
    assert.equal(queries.length, 1)
    const value = await computeDashboard(scope)
    assert.equal(value.kpis.ggr, 20)
    assert.equal(value.kpis.rtp, .8)
    assert.equal(queries.length, 5)
  })
  it('the raw transport delivers the initial Casino wrapper immediately and closes pending readers', async () => {
    let listener: ((message: any, done?: () => void) => void) | null = null
    const snapshot = { kpis: { wagered: 100, payouts: 80, ggr: 20 } } as CasinoLiveDashboard
    const stream = createSnapshotStream({
      emitter: { on: (_topic, callback) => { listener = callback }, removeListener: () => { listener = null } },
      topic: 'casino.brand-a.10', compute: async () => snapshot,
      extract: message => message?.payload?.casinoLiveDashboard ?? message?.casinoLiveDashboard ?? message,
      wrap: value => ({ casinoLiveDashboard: value }),
    })
    try { assert.deepEqual(await stream.next(), { value: { casinoLiveDashboard: snapshot }, done: false }) }
    finally { await stream.return!() }
    assert.equal(listener, null)
    assert.deepEqual(await stream.next(), { value: undefined, done: true })
  })
})
