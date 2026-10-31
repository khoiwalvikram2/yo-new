import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSchema, graphql, parse } from 'graphql'
import { PgDialect } from 'drizzle-orm/pg-core'
import { db, pool } from '@src/db/client.js'
import { QueryCache } from '@src/services/QueryCache.js'
import { typeDefs } from '@src/types/graphql.js'
import { scanDocuments } from '../../../../../scripts/graphqlDocScan.js'
import { createSnapshotStream } from '@src/realtime/snapshotStream.js'
import { matkaSubscriptionResolvers } from '../../resolvers/subscriptions.js'
import { clearSnapshot, computeDashboard, getLastSnapshot } from '../LiveAnalyticsService.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const scope = { tenant: 'brand-a', whitelabelId: 'brand-a' }
function database(fail = false) {
  const queries: string[] = []
  mock.method(db, 'execute', async (query: any) => {
    const compiled = new PgDialect().sqlToQuery(query)
    queries.push(compiled.sql)
    if (fail && queries.length === 1) throw new Error('Temporary failure')
    return { rows: compiled.sql.includes('as active_players')
      ? [{ total_bets: '10', recent_bets: '5', wagered: '100', payouts: '80', active_players: '2' }]
      : [{ matka_type: 'worli', market_name: 'OPEN', bid_type: 'single', matka_id: 'matka-a', market_session: 'open', wagered: '100', payouts: '80', bets: '10' }] } as any
  })
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})
  return queries
}
describe('Matka live snapshot reads', () => {
  it('shares simultaneous dashboard/risk reads, keeps formulas and reads again after completion', async () => {
    const queries = database()
    const [first, second] = await Promise.all([computeDashboard(scope), computeDashboard({ ...scope })])
    assert.equal(first, second); assert.equal(queries.length, 6)
    assert.deepEqual({ ...first.kpis, at: 'fixed' }, { at: 'fixed', wagered: 100, payouts: 80, ggr: 20, rtp: .8, betsPerMin: 1, activePlayers: 2 })
    for (const rows of [first.breakdown.byType, first.breakdown.byMarket, first.breakdown.byBidType, first.breakdown.byMatka, first.breakdown.bySession]) {
      assert.equal(rows[0].bets, 10); assert.equal(rows[0].ggr, 20)
    }
    assert.deepEqual(first.breakdown.byDigit, []); assert.deepEqual(first.breakdown.bySelection, [])
    await computeDashboard(scope); assert.equal(queries.length, 12)
    assert.ok(queries.every(query => query.includes("mb.status IN ('pending', 'active')")))
  })
  it('keeps tenants, whitelabels and agents separate in pending and remembered snapshots', async () => {
    const queries = database()
    const scopes = [scope, { ...scope, agentId: 'a' }, { ...scope, agentId: 'b' }, { ...scope, whitelabelId: 'brand-b' }, { tenant: 'brand-b', whitelabelId: 'brand-b' }]
    scopes.forEach(clearSnapshot)
    const snapshots = await Promise.all(scopes.map(computeDashboard))
    assert.equal(queries.length, 30); assert.equal(new Set(snapshots).size, 5)
    scopes.forEach((value, index) => assert.equal(getLastSnapshot(value), snapshots[index]))
    clearSnapshot(scopes[1]); assert.equal(getLastSnapshot(scopes[1]), null)
    assert.equal(getLastSnapshot(scope), snapshots[0])
  })
  it('retains zero-on-error behavior and recovers on the next request', async () => {
    const queries = database(true)
    const [a, b] = await Promise.all([computeDashboard(scope), computeDashboard(scope)])
    assert.equal(a, b); assert.equal(a.kpis.wagered, 0); assert.equal(queries.length, 1)
    const recovered = await computeDashboard(scope)
    assert.equal(recovered.kpis.ggr, 20); assert.equal(queries.length, 7)
  })
  it('honors existing Redis cache keys without reading SQL', async () => {
    const queries = database()
    const cached = { kpis: { wagered: 123 }, breakdown: {} }
    const keys: string[] = []
    mock.method(QueryCache, 'getLive', async (key: string) => { keys.push(key); return cached as any })
    assert.equal(await computeDashboard(scope), cached)
    assert.equal(await computeDashboard({ ...scope, agentId: 'a' }), cached)
    assert.deepEqual(keys, ['matka:live:brand-a:brand-a', 'matka:live:brand-a:brand-a:agent:a'])
    assert.equal(queries.length, 0)
  })
  it('raw dashboard, exposure and risk frames match their real GraphQL field resolvers and close readers', async () => {
    for (const field of ['matkaLiveDashboard', 'matkaExposureBook', 'matkaRiskAlerts'] as const) {
      let listener: ((message: any, done?: () => void) => void) | null = null
      const initial = { at: 'initial', value: 1 }
      const stream = createSnapshotStream({
        emitter: { on: (_topic, callback) => { listener = callback }, removeListener: () => { listener = null } },
        topic: field, compute: async () => initial,
        extract: message => message?.payload?.[field] ?? message?.[field] ?? message,
        wrap: snapshot => ({ [field]: snapshot }),
      })
      try {
        const frame = await stream.next()
        assert.equal(matkaSubscriptionResolvers[field].resolve(frame.value), initial)
        const waiting = stream.next(); await stream.return!()
        assert.deepEqual(await waiting, { value: undefined, done: true }); assert.equal(listener, null)
      } finally { await stream.return!() }
    }
  })
})

describe('Matka players GraphQL variables', () => {
  const schema = buildSchema(typeDefs)
  for (const component of ['PlayerOverview', 'TopPlayersTable', 'PlayerProfitability', 'PlayerSegments']) {
    it(`${component} requests pending and active using the actual API enum/list contract`, async () => {
      const source = fs.readFileSync(`../admin/src/routes/matka/live-analysis/tabs/players/${component}.tsx`, 'utf8')
      assert.match(source, /statuses: \['pending', 'active'\]/)
      const document = scanDocuments(source).find(doc => doc.resolved && parse(doc.body).definitions.some(node => node.kind === 'OperationDefinition' && node.name?.value === 'MatkaBets'))!
      const limit = component === 'PlayerProfitability' ? 10000 : 5000
      let received: any
      const result = await graphql({ schema, source: document.body, variableValues: { query: { statuses: ['pending', 'active'], limit } },
        rootValue: { matkaBets: (args: any) => { received = args.query; return [] } } })
      assert.equal(result.errors, undefined); assert.deepEqual(received, { statuses: ['pending', 'active'], limit })
      const invalid = await graphql({ schema, source: document.body, variableValues: { query: { status: ['PENDING', 'ACTIVE'], limit } } })
      assert.ok(invalid.errors?.length)
    })
  }
})
