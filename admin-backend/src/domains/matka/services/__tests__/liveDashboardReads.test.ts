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
      ? [{ total_bets: '10', recent_bets: '5', wagered: '100', payouts: '80', potential_payouts: '900', active_players: '2' }]
      : [{ matka_type: 'worli', market_name: 'OPEN', bid_type: 'single', matka_id: 'matka-a', market_session: 'open', selection: '5', wagered: '100', payouts: '80', potential_payouts: '700', exposure: '600', bets: '10' }] } as any
  })
  mock.method(QueryCache, 'getLive', async () => null)
  mock.method(QueryCache, 'setLive', async () => {})
  return queries
}
describe('Matka live snapshot reads', () => {
  it('shares simultaneous dashboard/risk reads, keeps formulas and reads again after completion', async () => {
    const queries = database()
    const [first, second] = await Promise.all([computeDashboard(scope), computeDashboard({ ...scope })])
    assert.equal(first, second); assert.equal(queries.length, 7)
    assert.deepEqual({ ...first.kpis, at: 'fixed' }, { at: 'fixed', wagered: 100, payouts: 80, ggr: 20, rtp: .8, betsPerMin: 1, potentialPayouts: 900, activePlayers: 2 })
    for (const rows of [first.breakdown.byType, first.breakdown.byMarket, first.breakdown.byBidType, first.breakdown.byMatka, first.breakdown.bySession]) {
      assert.equal(rows[0].bets, 10); assert.equal(rows[0].ggr, 20)
    }
    // E004: byDigit and bySelection were always empty; both now come from the one selection read (a Single Digit bet on 5).
    assert.deepEqual(first.breakdown.bySelection, [{ selection: '5', matkaId: 'matka-a', matkaName: null, marketName: 'OPEN', marketSession: 'open', bidType: 'single',
      wagered: 100, payouts: 80, exposure: 600, bets: 10 }])
    assert.deepEqual(first.breakdown.byDigit, [{ digit: '5', wagered: 100, payouts: 80, exposure: 600, bets: 10 }])
    // G502: the totals come from the same selection read, over every selection (no extra query).
    assert.deepEqual(first.breakdown.selectionTotals, { selections: 1, wagered: 100, payouts: 80, exposure: 600, bets: 10 })
    await computeDashboard(scope); assert.equal(queries.length, 14)
    assert.ok(queries.every(query => query.includes("mb.status IN ('pending', 'active')")))
  })
  // MAT-13 follow-up: the byMatka / bySession Exposure came from payouts (0 on open bets), so it equalled Wagered.
  // Both breakdowns now carry potentialPayouts, read with the KPI tile's own expression over the same open bets.
  it("byMatka and bySession carry potentialPayouts: the KPI tile's expression over the same open bets", async () => {
    for (const agentId of [undefined, 'agent-a']) {
      const queries = database()
      const snapshot = await computeDashboard({ ...scope, agentId })
      for (const rows of [snapshot.breakdown.byMatka, snapshot.breakdown.bySession]) {
        assert.equal(rows[0].potentialPayouts, 700)
        assert.equal(rows[0].payouts, 80, 'payouts stays on settled wins'); assert.equal(rows[0].ggr, 20)
      }
      const expression = 'COALESCE(SUM(CAST(COALESCE(mb.potential_win, mb.bet_amount * mb.payout_multiplier) AS DECIMAL)), 0) as potential_payouts'
      const kpi = queries.find(query => query.includes('as active_players'))!
      const byMatka = queries.find(query => query.includes('GROUP BY mb.matka_id'))!
      const bySession = queries.find(query => query.includes('GROUP BY mb.market_session'))!
      for (const query of [kpi, byMatka, bySession]) assert.ok(query.includes(expression), query)
      // The same rows: everything from FROM up to the GROUP BY (tenant, whitelabel, open statuses, agent subtree).
      const rows = (query: string) => query.slice(query.indexOf('FROM matka_bets mb'), query.search(/GROUP BY|$/)).replace(/\s+/g, ' ').trim()
      assert.ok(rows(kpi).includes("mb.status IN ('pending', 'active')"))
      assert.equal(rows(byMatka), rows(kpi)); assert.equal(rows(bySession), rows(kpi))
      // E004: the selection read (byDigit is summed from it) reads the same rows, and its exposure is the potential payout
      // above the stake, floored at 0 (MAT-13).
      const bySelection = queries.find(query => query.includes('mb.bet_numbers as selection'))!
      assert.equal(rows(bySelection), rows(kpi))
      assert.ok(bySelection.includes(expression), bySelection)
      assert.ok(bySelection.includes('GREATEST(COALESCE(SUM(CAST(COALESCE(mb.potential_win, mb.bet_amount * mb.payout_multiplier) AS DECIMAL)), 0) - COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0), 0) as exposure'), bySelection)
      assert.match(bySelection, /GROUP BY mb\.matka_id, mb\.tenant, mb\.market_name, mb\.market_session, mb\.bid_type, mb\.bet_numbers\s*$/)
      mock.restoreAll()
    }
  })
  it('the subscription payload carries the breakdown potentialPayouts, and null for an older cached snapshot', async () => {
    const schema = buildSchema(typeDefs)
    const source = 'subscription { matkaLiveDashboard { breakdown { byMatka { matkaId potentialPayouts } bySession { marketSession potentialPayouts } } } }'
    const frame = (potentialPayouts?: number) => {
      const row = { wagered: 100, payouts: 0, ggr: 100, bets: 1, ...(potentialPayouts === undefined ? {} : { potentialPayouts }) }
      return { kpis: {}, breakdown: { byMatka: [{ matkaId: 'm1', ...row }], bySession: [{ marketSession: 'open', ...row }] } }
    }
    const fresh = await graphql({ schema, source, rootValue: { matkaLiveDashboard: frame(900) } })
    assert.equal(fresh.errors, undefined)
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.data)), { matkaLiveDashboard: { breakdown: {
      byMatka: [{ matkaId: 'm1', potentialPayouts: 900 }], bySession: [{ marketSession: 'open', potentialPayouts: 900 }] } } })
    const older = await graphql({ schema, source, rootValue: { matkaLiveDashboard: frame() } })
    assert.equal(older.errors, undefined, 'a snapshot cached before the field existed still renders')
    assert.equal((older.data as any).matkaLiveDashboard.breakdown.byMatka[0].potentialPayouts, null)
  })
  it("E004: the live page's own subscription document takes the byDigit and bySelection rows the repo builds", async () => {
    const schema = buildSchema(typeDefs)
    const source = fs.readFileSync('../admin/src/lib/graphql/matkaLive.ts', 'utf8')
    const document = scanDocuments(source).find(doc => doc.resolved && parse(doc.body).definitions.some(node => node.kind === 'OperationDefinition' && node.name?.value === 'MatkaLiveDashboard'))!
    const byDigit = [{ digit: '5', wagered: 30, payouts: 0, exposure: 240, bets: 1 }]
    // A market row of another whitelabel has no name here, and a bet may carry no session: both are nullable.
    const bySelection = [{ selection: '5', matkaId: 'm1', matkaName: null, marketName: 'KALYAN', marketSession: null, bidType: 'SINGLE', wagered: 30, payouts: 0, exposure: 240, bets: 1 }]
    const selectionTotals = { selections: 250, wagered: 2500, payouts: 0, exposure: 99000, bets: 260 }
    const frame = { kpis: { at: 'now', betsPerMin: 0, wagered: 30, payouts: 0, ggr: 30, rtp: 0, potentialPayouts: 270, activePlayers: 1 },
      breakdown: { byType: [], byMarket: [], byBidType: [], byMatka: [], bySession: [], byDigit, bySelection, selectionTotals } }
    const result = await graphql({ schema, source: document.body, rootValue: { matkaLiveDashboard: frame } })
    assert.equal(result.errors, undefined, result.errors?.map(error => error.message).join('; '))
    const breakdown = JSON.parse(JSON.stringify(result.data)).matkaLiveDashboard.breakdown
    assert.deepEqual(breakdown.byDigit, byDigit); assert.deepEqual(breakdown.bySelection, bySelection)
    // G502: the page asks for the totals over every selection; a frame cached before they existed renders them null.
    assert.deepEqual(breakdown.selectionTotals, selectionTotals)
    const { selectionTotals: _dropped, ...older } = frame.breakdown
    const cached = await graphql({ schema, source: document.body, rootValue: { matkaLiveDashboard: { ...frame, breakdown: older } } })
    assert.equal(cached.errors, undefined); assert.equal((cached.data as any).matkaLiveDashboard.breakdown.selectionTotals, null)
  })
  it('keeps tenants, whitelabels and agents separate in pending and remembered snapshots', async () => {
    const queries = database()
    const scopes = [scope, { ...scope, agentId: 'a' }, { ...scope, agentId: 'b' }, { ...scope, whitelabelId: 'brand-b' }, { tenant: 'brand-b', whitelabelId: 'brand-b' }]
    scopes.forEach(clearSnapshot)
    const snapshots = await Promise.all(scopes.map(computeDashboard))
    assert.equal(queries.length, 35); assert.equal(new Set(snapshots).size, 5)
    scopes.forEach((value, index) => assert.equal(getLastSnapshot(value), snapshots[index]))
    clearSnapshot(scopes[1]); assert.equal(getLastSnapshot(scopes[1]), null)
    assert.equal(getLastSnapshot(scope), snapshots[0])
  })
  it('retains zero-on-error behavior and recovers on the next request', async () => {
    const queries = database(true)
    const [a, b] = await Promise.all([computeDashboard(scope), computeDashboard(scope)])
    assert.equal(a, b); assert.equal(a.kpis.wagered, 0); assert.equal(queries.length, 1)
    const recovered = await computeDashboard(scope)
    assert.equal(recovered.kpis.ggr, 20); assert.equal(queries.length, 8)
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
