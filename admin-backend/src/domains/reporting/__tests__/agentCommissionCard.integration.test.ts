/**
 * The Agent Overview's Commission Earned card and the Agent Performance domain tabs, on fixture rows.
 *
 * Commission Earned (B102): for an admin the card summed reporting_daily_snapshots.agent_commission, or live a
 * rate x GGR estimate. That disagreed with the posted commission the same page shows (each agent's Commission, the
 * Activity Trends column) and went negative on a losing period. It now sums the posted COMMISSION ledger lines of
 * the whitelabel's agents, narrowed to the Agent type and the domain tab, with the predicates of an agent's own card.
 *
 * Domain tabs (B103): under Sports or Casino the Share tile and the domain cut columns read 0.00 and Cut fell back
 * to commission alone, while All Domains showed them. A tab now gets that domain's cut: the figure All Domains shows
 * in that domain's column.
 *
 * Runs on the isolated QA database (tmp/matka-test-database-2026-10-25.json); every row is written inside a
 * transaction that is rolled back, so nothing is left behind. Run:
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentCommissionCard.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
import { seedFinancialAudit, expected } from '../../../../../tmp/system-audit-2026-10-25/financial-fixtures.js'

const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { reportingQueryResolvers } = (await import('../resolvers/queries.js')) as any
const agentReports = await import('../../../repos/reporting/agentReportingRepo.js')
const { parseDateFrom, parseDateTo } = await import('../../../shared/dateUtils.js')

test.before(() => guard(pool))
test.after(async () => {
  const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
  await pool.end()
})
test.afterEach(() => mock.restoreAll())

const IST = 'Asia/Kolkata'
const ist = (local: string) => DateTime.fromISO(local, { zone: IST }).toJSDate()
/** Weekly commission periods, Monday to Monday IST, as the cycles post them. */
const W0 = { from: ist('2026-01-05T00:00'), to: ist('2026-01-12T00:00') }
const W1 = { from: ist('2026-03-02T00:00'), to: ist('2026-03-09T00:00') }
const W2 = { from: ist('2026-03-09T00:00'), to: ist('2026-03-16T00:00') }
const MARCH = { dateFrom: '2026-03-01', dateTo: '2026-03-31' }

function close(actual: number, target: number, label: string) {
  assert.ok(Math.abs(Number(actual) - target) < 1e-6, `${label}: ${actual} != ${target}`)
}

function adminCtx(tenant: string) {
  return {
    tenant,
    whitelabel: { id: tenant },
    user: { sub: '1', type: 'admin', roles: [] },
    permissions: [
      { domain: 'reporting.agents-performance', actions: ['view'] },
      { domain: 'reporting.agent-overview', actions: ['view'] },
    ],
  }
}

async function scenario(check: (f: any, tx: any, today: string) => Promise<void>) {
  await rollback(db, async (tx) => {
    const f = await seedFinancialAudit(tx)
    routeDbToTransaction(mock, db, tx)
    const today = DateTime.fromJSDate(f.now, { zone: IST }).toISODate()!
    await check(f, tx, today)
    mock.restoreAll()
  })
}

/**
 * Posted lines: the owner's (two domains, two weeks), its sub-agent's, a CREDIT agent's, and lines that must not
 * count: a week before the range, another currency, a SHARE line, and another whitelabel's agent.
 */
async function seedLedger(f: any, tx: any) {
  const child = await f.agent('COMMISSION', f.owner)
  const credit = await f.agent('CREDIT')
  const other = await fixture(tx)
  const stranger = await other.agent('COMMISSION')
  const line = (agent: any, domain: string, week: { from: Date; to: Date }, amount: string, extra: Record<string, unknown> = {}) => ({
    agentId: agent.id, domain, periodFrom: week.from, periodTo: week.to, lineType: 'COMMISSION', amount, currency: 'INR', ...extra,
  })
  await tx.insert(t.agentLedger).values([
    line(f.owner, 'casino', W1, '1000.50'),
    line(f.owner, 'sports', W1, '20.25'),
    line(f.owner, 'casino', W2, '300.00'),
    line(child, 'casino', W1, '75.10'),
    line(credit, 'casino', W1, '33.00'),
    line(f.owner, 'casino', W0, '5000.00'),
    line(f.owner, 'sports', W2, '999.00', { currency: 'USD' }),
    line(f.owner, 'casino', W1, '4444.00', { lineType: 'SHARE' }),
    line(stranger, 'casino', W1, '7777.00'),
  ])
  return { child, credit }
}

/** The owner's commission rates and the whitelabel's sharing rates, from 2026-01-01. */
async function seedRates(f: any, tx: any, agent = f.owner, rates = { sports: '0.0200', casino: '0.2500', matka: '0.1000' }) {
  const effectiveFrom = ist('2026-01-01T00:00')
  await tx.insert(t.agentCommissionConfig).values(Object.entries(rates).map(([domain, commissionRate]) => ({ agentId: agent.id, domain, commissionRate, effectiveFrom })))
}
async function seedWhitelabelShare(f: any, tx: any) {
  await tx.insert(t.whitelabelSharingConfig).values(['sports', 'casino', 'matka'].map((domain) => ({ whitelabelId: f.tenant, domain, shareRate: '1.0000' })))
}

const kpis = (f: any, filter: Record<string, unknown>) => reportingQueryResolvers.agentKPIs(undefined, { filter }, adminCtx(f.tenant))
const performance = (f: any, filter: Record<string, unknown>) => reportingQueryResolvers.agentPerformance(undefined, { filter, limit: 50 }, adminCtx(f.tenant))
const trends = (f: any, filter: Record<string, unknown>) => reportingQueryResolvers.agentTrends(undefined, { filter }, adminCtx(f.tenant))

test('B102: the admin card is the posted COMMISSION lines of the whitelabel’s agents, by Agent type and domain tab', async () => scenario(async (f, tx) => {
  await seedLedger(f, tx)
  // owner 1000.50 + 20.25 + 300 (W1, W2), its sub-agent 75.10, the CREDIT agent 33; nothing else is in March in INR.
  close((await kpis(f, MARCH)).commissionEarned, 1428.85, 'all types, all domains')
  close((await kpis(f, { ...MARCH, schemeType: 'COMMISSION' })).commissionEarned, 1395.85, 'COMMISSION agents')
  close((await kpis(f, { ...MARCH, schemeType: 'CREDIT' })).commissionEarned, 33, 'CREDIT agents')
  close((await kpis(f, { ...MARCH, schemeType: 'SHARING' })).commissionEarned, 0, 'SHARING agents')
  close((await kpis(f, { ...MARCH, domain: 'casino' })).commissionEarned, 1408.6, 'Casino tab')
  close((await kpis(f, { ...MARCH, domain: 'sports' })).commissionEarned, 20.25, 'Sports tab')
  close((await kpis(f, { ...MARCH, domain: 'matka' })).commissionEarned, 0, 'Matka tab')
  close((await kpis(f, { ...MARCH, domain: 'casino', schemeType: 'COMMISSION' })).commissionEarned, 1375.6, 'Casino tab, COMMISSION agents')
  // A range that holds only the earlier week.
  close((await kpis(f, { dateFrom: '2026-01-01', dateTo: '2026-01-31' })).commissionEarned, 5000, 'January')
}))

test('B102: the card adds up to the Activity Trends commission column and holds each agent’s own Commission', async () => scenario(async (f, tx, today) => {
  await seedLedger(f, tx)
  for (const range of [MARCH, { dateFrom: '2000-01-01', dateTo: today }]) {
    const card = Number((await kpis(f, range)).commissionEarned)
    const days = await trends(f, range)
    close(days.reduce((sum: number, day: any) => sum + day.commission, 0), card, `Σ trend commission = the card (${range.dateFrom}..${range.dateTo})`)
  }
  // All time: the owner's own lines, which its Agent Performance row shows, plus its sub-agent's and the CREDIT agent's.
  const allTime = { dateFrom: '2000-01-01', dateTo: today }
  close((await kpis(f, allTime)).commissionEarned, 6428.85, 'all-time card')
  const owner = (await performance(f, allTime)).agents.find((row: any) => row.agentId === f.owner.id)
  assert.ok(owner, 'the owner has activity, so it has a row')
  close(owner.commissionEarned, 6320.75, 'the owner’s posted commission in its row')
}))

test('B102: a losing day with nothing posted reads 0, not the negative rate x GGR estimate', async () => scenario(async (f, tx, today) => {
  await seedRates(f, tx)
  // The fixture's bets today: sports GGR 621.2, casino 69, matka -845. At 2% / 25% / 10% the estimate is negative.
  const estimate = 0.02 * expected.sports.ggr + 0.25 * expected.casino.ggr + 0.1 * expected.matka.ggr
  assert.ok(estimate < 0)
  const tz = IST
  const old = await agentReports.getAgentKPIs({ tenant: f.tenant, whitelabelId: f.tenant, dateFrom: parseDateFrom(today, tz), dateTo: parseDateTo(today, tz) })
  close(old.commissionEarned, estimate, 'the repository estimate the card used to show')
  const card = await kpis(f, { dateFrom: today, dateTo: today })
  close(card.commissionEarned, 0, 'the card: nothing is posted today')
  close(card.totalGGR, expected.sports.ggr + expected.casino.ggr + expected.matka.ggr, 'the other cards are unchanged')
}))

test('B103: a domain tab shows that domain’s share and cut, the figure All Domains shows in its column', async () => scenario(async (f, tx, today) => {
  await seedRates(f, tx)
  await seedWhitelabelShare(f, tx)
  const range = { dateFrom: today, dateTo: today }
  const all = await performance(f, range)
  const allRow = all.agents.find((row: any) => row.agentId === f.owner.id)
  assert.ok(allRow, 'the owner has a row under All Domains')
  const cutOf = (row: any, domain: string) => row.domainBreakdown.find((d: any) => d.domain === domain)
  // Whitelabel 100% minus the agent's rate, on the domain's GGR.
  const cuts = { sports: expected.sports.ggr * 0.98, casino: expected.casino.ggr * 0.75, matka: expected.matka.ggr * 0.9 }
  for (const [domain, cut] of Object.entries(cuts)) close(cutOf(allRow, domain).cut, cut, `All Domains ${domain} cut`)
  close(allRow.shareEarned, cuts.sports + cuts.casino + cuts.matka, 'All Domains share')

  let tabsShare = 0
  for (const [domain, cut] of Object.entries(cuts)) {
    const tab = await performance(f, { ...range, domain })
    const row = tab.agents.find((r: any) => r.agentId === f.owner.id)
    assert.ok(row, `the owner has a ${domain} row`)
    assert.deepEqual(row.domainBreakdown.map((d: any) => d.domain), [domain], `${domain}: the tab's own domain only`)
    const entry = cutOf(row, domain)
    close(entry.cut, cut, `${domain} tab cut`)
    close(entry.cut, cutOf(allRow, domain).cut, `${domain} tab cut = its All Domains column`)
    close(entry.userCutPercent, 100, `${domain} whitelabel %`)
    close(entry.agentCutPercent, { sports: 2, casino: 25, matka: 10 }[domain]!, `${domain} agent %`)
    close(row.shareEarned, cut, `${domain} share (the Cut column adds it to commission)`)
    assert.ok(tab.totals, `${domain} tab has totals`)
    close(tab.totals.shareEarned, cut, `${domain} Share tile`)
    tabsShare += row.shareEarned
  }
  close(tabsShare, allRow.shareEarned, 'the tabs add up to All Domains')
}))

test('B103: an admin drilling into an agent gets the parent’s cut of the domain tab too', async () => scenario(async (f, tx, today) => {
  const child = await f.agent('COMMISSION', f.owner)
  await tx.update(t.users).set({ agentId: child.id }).where(eq(t.users.id, f.player.id))
  await seedRates(f, tx)
  await seedRates(f, tx, child, { sports: '0.0100', casino: '0.2000', matka: '0.0500' })
  const range = { dateFrom: today, dateTo: today, parentAgentId: f.owner.id }
  // The owner's rate minus its sub-agent's, on the domain's GGR.
  const cuts = { sports: expected.sports.ggr * 0.01, casino: expected.casino.ggr * 0.05, matka: expected.matka.ggr * 0.05 }
  const all = await performance(f, range)
  const allRow = all.agents.find((row: any) => row.agentId === child.id)
  assert.ok(allRow, 'the sub-agent has a row')
  close(allRow.shareEarned, cuts.sports + cuts.casino + cuts.matka, 'All Domains parent cut')
  for (const [domain, cut] of Object.entries(cuts)) {
    const tab = await performance(f, { ...range, domain })
    const row = tab.agents.find((r: any) => r.agentId === child.id)
    assert.ok(row, `the sub-agent has a ${domain} row`)
    assert.deepEqual(row.domainBreakdown.map((d: any) => d.domain), [domain])
    close(row.domainBreakdown[0].cut, cut, `${domain} tab parent cut`)
    close(row.shareEarned, cut, `${domain} share`)
    assert.ok(tab.totals, `${domain} tab has totals (it had none)`)
    close(tab.totals.shareEarned, cut, `${domain} Share tile`)
  }
}))
