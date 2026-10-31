import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db, pool } from '@src/db/client.js'
import { QueryCache } from '@src/services/QueryCache.js'
import { clearSnapshot, computeDashboard, getLastSnapshot } from '../LiveAnalyticsService.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const scope = { tenant: 'brand-a', whitelabelId: 'brand-a' }
function database(failFirst = false) {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  mock.method(db, 'execute', async (query: any) => {
    const compiled = new PgDialect().sqlToQuery(query)
    queries.push(compiled)
    if (failFirst && queries.length === 1) throw new Error('Transient database failure')
    return { rows: compiled.sql.includes('as active_markets') ? [{ total_stake: '30', total_liability: '30', active_markets: '2', active_players: '3', back_bets: '2', lay_bets: '1', avg_odds: '2.5', recent_bets: '5' }] : [] } as any
  })
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})
  return queries
}

describe('Sports live snapshot computation', () => {
  it('shares a simultaneous cache miss between dashboard/risk consumers, then reads fresh on the next miss', async () => {
    const queries = database()
    const [dashboard, riskDashboard] = await Promise.all([computeDashboard(scope), computeDashboard({ ...scope })])
    assert.equal(dashboard, riskDashboard)
    assert.equal(queries.length, 8, 'one computation rather than two sets of eight SQL reads')
    await computeDashboard(scope)
    assert.equal(queries.length, 16, 'there is no extra persistent snapshot cache')
  })
  it('keeps whitelabel and agent computations and remembered snapshots separate', async () => {
    const queries = database()
    const contexts = [scope, { ...scope, agentId: 'agent-a' }, { ...scope, agentId: 'agent-b' }, { tenant: 'brand-b', whitelabelId: 'brand-b' }]
    for (const context of contexts) clearSnapshot(context)
    const values = await Promise.all(contexts.map(context => computeDashboard(context)))
    assert.equal(queries.length, 32)
    assert.equal(new Set(values).size, 4)
    contexts.forEach((context, index) => assert.equal(getLastSnapshot(context), values[index]))
    clearSnapshot(contexts[1])
    assert.equal(getLastSnapshot(contexts[1]), null)
    assert.equal(getLastSnapshot(scope), values[0])
  })
  it('removes a rejected in-flight read so a later request can recover', async () => {
    const queries = database(true)
    const results = await Promise.allSettled([computeDashboard(scope), computeDashboard(scope)])
    assert.ok(results.every(result => result.status === 'rejected'))
    assert.equal(queries.length, 1)
    const value = await computeDashboard(scope)
    assert.equal(value.kpis.totalStake, 30)
    assert.equal(queries.length, 9)
  })
  it('retains the existing cache key, cached response and five-second cache service', async () => {
    const queries = database()
    const cached = await computeDashboard(scope)
    const keys: string[] = []
    mock.method(QueryCache, 'getLive', async (key: string) => { keys.push(key); return cached })
    assert.equal(await computeDashboard(scope), cached)
    assert.equal(await computeDashboard({ ...scope, agentId: 'a' }), cached)
    assert.deepEqual(keys, ['sports:live:brand-a:brand-a', 'sports:live:brand-a:brand-a:agent:a'])
    assert.equal(queries.length, 8)
  })
})
