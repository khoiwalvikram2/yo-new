/**
 * The Matka and Casino reports' cards follow their drill-down (F-REP-01, F-REP-14), against the real
 * database — READ ONLY (every statement is a SELECT; a check with no suitable data skips).
 *
 *   - The schema: MatkaReportingFilter takes matkaType / matkaId / marketSession / playerId, and
 *     CasinoReportingFilter takes providerId / vendorId / gameId. The Matka page's KPI query carried
 *     matkaType and the server refused the whole variable, so the cards vanished on the first click;
 *     the Casino page dropped the vendor, so a vendor's cards showed the whole casino.
 *   - The figures: matkaKPIs for a type equals that type's row of the type breakdown, and casinoKPIs
 *     for a vendor equals that vendor's row of the vendor breakdown.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/reportDrillFilters.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, parse, getVariableValues, type GraphQLInputObjectType, type OperationDefinitionNode } from 'graphql'
import { sql } from 'drizzle-orm'
import { typeDefs } from '@src/types/graphql.js'

let db: (typeof import('@src/db/client.js'))['db']
let matkaFixture: { tenant: string; matkaType: string } | null = null
let casinoFixture: { tenant: string; vendorId: number } | null = null

const ALL_TIME = { dateFrom: '2000-01-01', dateTo: new Date().toISOString().slice(0, 10) }

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? []
}

function adminCtx(tenant: string) {
  return {
    tenant,
    whitelabel: { id: tenant },
    user: { sub: '1', type: 'admin', roles: [] },
    permissions: [
      { domain: 'reporting.matka', actions: ['view'] },
      { domain: 'reporting.casino', actions: ['view'] },
    ],
  }
}

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`)

before(async () => {
  ;({ db } = await import('@src/db/client.js'))
  const matka = rows(await db.execute(sql`
    SELECT tenant, matka_type::text AS matka_type FROM matka_bets
    WHERE status::text IN ('won', 'lost') AND matka_type IS NOT NULL
    GROUP BY tenant, matka_type ORDER BY COUNT(*) DESC LIMIT 1`))
  if (matka[0]) matkaFixture = { tenant: matka[0].tenant, matkaType: matka[0].matka_type }
  const casino = rows(await db.execute(sql`
    SELECT tenant, vendor_id FROM casino_bets
    WHERE status::text IN ('won', 'lost') AND wallet_type = 'cash' AND vendor_id IS NOT NULL
    GROUP BY tenant, vendor_id ORDER BY COUNT(*) DESC LIMIT 1`))
  if (casino[0]) casinoFixture = { tenant: casino[0].tenant, vendorId: Number(casino[0].vendor_id) }
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('the report filters accept the drill-down keys', () => {
  const schema = buildSchema(typeDefs)
  const fields = (name: string) => Object.keys((schema.getType(name) as GraphQLInputObjectType).getFields())

  it('MatkaReportingFilter and CasinoReportingFilter declare them', () => {
    for (const key of ['matkaType', 'matkaId', 'marketSession', 'playerId']) assert.ok(fields('MatkaReportingFilter').includes(key), key)
    for (const key of ['providerId', 'vendorId', 'gameId']) assert.ok(fields('CasinoReportingFilter').includes(key), key)
  })

  it('the Matka page’s drilled KPI variables are valid (they were refused whole)', () => {
    const document = parse('query MatkaKPIs($filter: MatkaReportingFilter) { matkaKPIs(filter: $filter) { totalStakes } }')
    const operation = document.definitions[0] as OperationDefinitionNode
    const coerced = getVariableValues(schema, operation.variableDefinitions ?? [], {
      filter: { dateFrom: '2000-01-01', dateTo: '2026-11-02', matkaType: 'worli', matkaId: '12', marketSession: 'OPEN', playerId: '41' },
    })
    assert.equal(coerced.errors, undefined, JSON.stringify(coerced.errors))
  })
})

describe('the drilled cards are the drilled rows', () => {
  it('matkaKPIs for a type equals the type’s breakdown row', async (t) => {
    if (!matkaFixture) return t.skip('no settled matka bets in this database')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant, matkaType } = matkaFixture
    const ctx = adminCtx(tenant)
    const kpis = await reportingQueryResolvers.matkaKPIs(undefined, { filter: { ...ALL_TIME, matkaType } }, ctx)
    const types = await reportingQueryResolvers.matkaTypeBreakdown(undefined, { filter: { ...ALL_TIME } }, ctx)
    const row = types.find((r: any) => r.matkaType === matkaType)
    assert.ok(row, 'the type has a breakdown row')
    near(kpis.totalStakes, row.totalStakes, 'stakes')
    assert.equal(kpis.betCount, row.betCount, 'bets')
    assert.equal(kpis.playerCount, row.playerCount, 'players')
    const whole = await reportingQueryResolvers.matkaKPIs(undefined, { filter: { ...ALL_TIME } }, ctx)
    if (types.length > 1) assert.ok(kpis.totalStakes < whole.totalStakes, 'a type is part of the whole')
    const trend = await reportingQueryResolvers.matkaTrends(undefined, { filter: { ...ALL_TIME, matkaType } }, ctx)
    near(trend.reduce((sum: number, point: any) => sum + point.stakes, 0), kpis.totalStakes, 'the type’s trend adds up to its card')
  })

  it('casinoKPIs for a vendor equals the vendor’s breakdown row', async (t) => {
    if (!casinoFixture) return t.skip('no settled casino bets in this database')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant, vendorId } = casinoFixture
    const ctx = adminCtx(tenant)
    const kpis = await reportingQueryResolvers.casinoKPIs(undefined, { filter: { ...ALL_TIME, vendorId: String(vendorId) } }, ctx)
    const vendors = await reportingQueryResolvers.casinoVendorBreakdown(undefined, { filter: { ...ALL_TIME } }, ctx)
    const row = vendors.find((r: any) => Number(r.vendorId) === vendorId)
    assert.ok(row, 'the vendor has a breakdown row')
    near(kpis.totalStakes, row.totalStakes, 'stakes')
    assert.equal(kpis.betCount, row.betCount, 'bets')
    assert.equal(kpis.playerCount, row.playerCount, 'players')
    const whole = await reportingQueryResolvers.casinoKPIs(undefined, { filter: { ...ALL_TIME } }, ctx)
    if (vendors.length > 1) assert.ok(kpis.totalStakes < whole.totalStakes, 'a vendor is part of the whole')
  })
})
