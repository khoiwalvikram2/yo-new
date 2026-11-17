/**
 * The P&L report's rows per domain, against the real database — READ ONLY (every statement is a SELECT;
 * a check with no suitable data skips).
 *
 *   - F-REP-07: every row is labelled with its domain. The live rows were one combined "All" row per
 *     day, which the page kept under every domain tab (a matka loss showed under Sports).
 *   - F-REP-18: each domain is read as its KPI card reads it (snapshots for an up-to-date past range,
 *     live bets otherwise), so a domain's rows add up to its card for any range. The three domains were
 *     switched to live bets together, so October's archived matka figures were on the card and missing
 *     from the table.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/reporting/__tests__/pnlByDomain.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

let db: (typeof import('@src/db/client.js'))['db']
let tenant: string | null = null

const TODAY = new Date().toISOString().slice(0, 10)
const RANGES = [
  { label: 'all time', dateFrom: '2000-01-01', dateTo: TODAY },
  { label: 'October 2026', dateFrom: '2026-10-01', dateTo: '2026-10-31' },
  { label: 'June 2026', dateFrom: '2026-06-01', dateTo: '2026-06-30' },
]

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? []
}

function adminCtx(t: string) {
  return {
    tenant: t,
    whitelabel: { id: t },
    user: { sub: '1', type: 'admin', roles: [] },
    permissions: [
      { domain: 'reporting.pnl', actions: ['view'] },
      { domain: 'reporting.sports', actions: ['view'] },
      { domain: 'reporting.casino', actions: ['view'] },
      { domain: 'reporting.matka', actions: ['view'] },
    ],
  }
}

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`)

before(async () => {
  ;({ db } = await import('@src/db/client.js'))
  const found = rows(await db.execute(sql`
    SELECT tenant FROM reporting_daily_snapshots WHERE agent_id IS NULL AND player_id IS NULL
    GROUP BY tenant ORDER BY COUNT(*) DESC LIMIT 1`))
  tenant = found[0]?.tenant ?? null
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('pnl rows per domain', () => {
  for (const range of RANGES) {
    it(`labels every row with its domain, and each domain's rows add up to its card (${range.label})`, async (t) => {
      if (!tenant) return t.skip('no snapshot data in this database')
      const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
      const ctx = adminCtx(tenant)
      const days = Math.max(1, Math.round((Date.parse(range.dateTo) - Date.parse(range.dateFrom)) / 864e5))
      const pnl = await reportingQueryResolvers.pnl(undefined, { range: String(days), dateFrom: range.dateFrom, dateTo: range.dateTo }, ctx)
      for (const row of pnl) assert.ok(['sports', 'casino', 'matka'].includes(row.dimension), `row dimension ${row.dimension}`)
      const filter = { filter: { dateFrom: range.dateFrom, dateTo: range.dateTo } }
      const cards = {
        sports: await reportingQueryResolvers.sportsKPIs(undefined, filter, ctx),
        casino: await reportingQueryResolvers.casinoKPIs(undefined, filter, ctx),
        matka: await reportingQueryResolvers.matkaKPIs(undefined, filter, ctx),
      }
      for (const domain of ['sports', 'casino', 'matka'] as const) {
        const sum = pnl.filter((row: any) => row.dimension === domain).reduce((total: number, row: any) => total + row.value, 0)
        near(sum, Number(cards[domain].netRevenue), `${domain} rows vs the ${domain} card`)
      }
      // One row per domain per day.
      const keys = pnl.map((row: any) => `${row.dimension}|${row.date}`)
      assert.equal(new Set(keys).size, keys.length, 'no domain day twice')
      // A domain asked alone returns the same rows.
      const matkaOnly = await reportingQueryResolvers.pnl(undefined, { range: String(days), domain: 'matka', dateFrom: range.dateFrom, dateTo: range.dateTo }, ctx)
      assert.deepEqual(matkaOnly, pnl.filter((row: any) => row.dimension === 'matka'))
    })
  }
})
