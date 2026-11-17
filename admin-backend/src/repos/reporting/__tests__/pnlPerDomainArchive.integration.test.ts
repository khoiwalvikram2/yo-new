/**
 * F-REP-18 (G504): the P&L table reads each domain the way its KPI card does, against the isolated Matka QA database,
 * each test inside a transaction that is rolled back. A past day whose matka bets were deleted after it was archived
 * (the owner's 2026-11-02 cut) keeps its matka figures only in the snapshot, while a sports bet of that day settled
 * after its snapshot makes sports read live. getPNLData switched all three domains to live bets whenever any one was
 * out of date, so the archived matka figures were on the card and missing from the table; it now decides per domain
 * (snapshotFreshness.ts, as the KPI repos do) and returns each domain's days.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
import { seedFinancialAudit, expected } from '../../../../../tmp/system-audit-2026-10-25/financial-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const sports = await import('../sportsReportingRepo.js'), casino = await import('../casinoReportingRepo.js'), matka = await import('../matkaReportingRepo.js')
const { getPNLData } = await import('../pnlReportingRepo.js')
process.env.REDIS_URL = 'redis://127.0.0.1:1'
const { generateDailySnapshot } = await import('../../../services/reportingSnapshotService.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

function close(actual: number, target: number, label: string) { assert.ok(Math.abs(actual - target) < .00001, `${label}: ${actual} != ${target}`) }

test('an archived range reads a snapshot-only matka day from its snapshot and a stale sports day live, each agreeing with its card', async () => {
  await rollback(db, async tx => {
    const f = await seedFinancialAudit(tx); routeDbToTransaction(mock, db, tx)
    mock.method(pool, 'query', (...args: any[]) => (tx as any).session.client.query(...args))
    const past = new Date(f.now.getTime() - 3 * 86400000), day = DateTime.fromJSDate(past, { zone: 'Asia/Kolkata' }).toISODate()!
    for (const table of [t.sportsBets, t.casinoBets, t.matkaBets]) await tx.update(table).set({ createdAt: past, settledAt: past, updatedAt: past }).where(eq(table.tenant, f.tenant))
    for (const domain of ['sports', 'casino', 'matka'] as const) {
      assert.equal((await generateDailySnapshot({ tenant: f.tenant, whitelabelId: f.tenant, date: past, domain, currency: 'INR', forceRefresh: true })).success, true)
    }
    // After the day was archived: its matka bets are hard-deleted, and another sports loss of that day settles.
    await tx.delete(t.matkaBets).where(eq(t.matkaBets.tenant, f.tenant))
    await tx.insert(t.sportsBets).values({ ...f.sports[1], id: randomUUID(), createdAt: past, settledAt: new Date(), updatedAt: new Date(f.now.getTime() + 60000) })

    const filter = { tenant: f.tenant, whitelabelId: f.tenant, currency: 'INR', dateFrom: day, dateTo: day }
    const rows = await getPNLData(filter)
    const sum = (domain: string) => rows.filter((row) => row.dimension === domain).reduce((total, row) => total + row.value, 0)
    const cards = { sports: await sports.getSportsKPIs(filter), casino: await casino.getCasinoKPIs(filter), matka: await matka.getMatkaKPIs(filter) }
    for (const domain of ['sports', 'casino', 'matka'] as const) close(sum(domain), Number(cards[domain].grossGamingRevenue), `${domain} rows vs its card`)
    close(sum('matka'), expected.matka.ggr, 'matka from the archived snapshot, its bets gone')
    close(sum('sports'), expected.sports.ggr + 211, 'sports live, the late loss included')
    close(sum('casino'), expected.casino.ggr, 'casino from its up-to-date snapshot')
    // One row per domain per day, and a domain asked alone gives the same rows.
    assert.deepEqual(rows.map((row) => row.dimension), ['casino', 'matka', 'sports'])
    assert.deepEqual(await getPNLData({ ...filter, domain: 'matka' }), rows.filter((row) => row.dimension === 'matka'))
  })
})
