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
const { LiveGGRReader } = await import('../../../domains/agents/services/LiveGGRReader.js')
const { getPlayerStatistics } = await import('../../sports/playerIntelligenceRepo.js')
const { createAgentPerformanceReads } = await import('../agentPerformanceReads.js')
const agentReports = await import('../agentReportingRepo.js')
process.env.REDIS_URL = 'redis://127.0.0.1:1'
const { generateDailySnapshot } = await import('../../../services/reportingSnapshotService.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())
async function scenario(check: (f: any, filter: any, tx: any) => Promise<void>) {
  await rollback(db, async tx => {
    const f = await seedFinancialAudit(tx); routeDbToTransaction(mock, db, tx)
    const date = DateTime.fromJSDate(f.now, { zone: 'Asia/Kolkata' }).toISODate()
    const filter = { tenant: f.tenant, whitelabelId: f.tenant, currency: 'INR', dateFrom: date, dateTo: date }
    await check(f, filter, tx); mock.restoreAll()
  })
}
function close(actual: number, target: number, label: string) { assert.ok(Math.abs(actual - target) < .00001, `${label}: ${actual} != ${target}`) }
test('settled sports exchange/fancy back/lay KPI and trend GGR equals the negative stored player P/L', async () => scenario(async (_f, filter) => {
  const kpi = await sports.getSportsKPIs(filter), trend = await sports.getSportsTrends(filter)
  close(kpi.totalStakes, expected.sports.stakes, 'sports risk'); close(kpi.totalPayouts, expected.sports.payouts, 'sports gross returns'); close(kpi.grossGamingRevenue, expected.sports.ggr, 'sports GGR')
  assert.equal(kpi.betCount, 8); close(trend.reduce((sum, row) => sum + row.ggr, 0), expected.sports.ggr, 'sports trend')
}))
test('casino settled cash KPIs and trends exclude pending/void/cancelled/bonus and preserve break-even wins', async () => scenario(async (_f, filter) => {
  const kpi = await casino.getCasinoKPIs(filter), trend = await casino.getCasinoTrends(filter)
  close(kpi.totalStakes, expected.casino.stakes, 'casino stakes'); close(kpi.totalPayouts, expected.casino.payouts, 'casino payouts'); close(kpi.grossGamingRevenue, expected.casino.ggr, 'casino GGR')
  assert.equal(kpi.betCount, 3); close(trend.reduce((sum, row) => sum + row.ggr, 0), expected.casino.ggr, 'casino trend')
}))
test('Matka settled KPIs and trends use actual returns rather than open potential wins', async () => scenario(async (_f, filter) => {
  const kpi = await matka.getMatkaKPIs(filter), trend = await matka.getMatkaTrends(filter)
  close(kpi.totalStakes, expected.matka.stakes, 'Matka stakes'); close(kpi.totalPayouts, expected.matka.payouts, 'Matka payouts'); close(kpi.grossGamingRevenue, expected.matka.ggr, 'Matka GGR')
  assert.equal(kpi.betCount, 2); close(trend.reduce((sum, row) => sum + row.ggr, 0), expected.matka.ggr, 'Matka trend')
}))
test('domain P/L and commission GGR readers reconcile independently against settled bet expectations', async () => scenario(async (f, filter) => {
  const reader = new LiveGGRReader(), input = { agentId: f.owner.id, from: new Date(f.now.getTime() - 60000), to: new Date(f.now.getTime() + 60000), scope: 'direct' as const }
  for (const domain of ['sports', 'casino', 'matka'] as const) {
    const pnl = await getPNLData({ ...filter, domain }), ggr = await ({ sports: () => reader.getSportsGGR(input), casino: () => reader.getCasinoGGR(input), matka: () => reader.getMatkaGGR(input) })[domain]()
    close(pnl.reduce((sum, row) => sum + row.value, 0), expected[domain].ggr, domain + ' P/L'); close(ggr.ggr, expected[domain].ggr, domain + ' commission GGR')
  }
}))
test('stored sports settlement P/L remains authoritative when legacy status/result text differs from numeric gross returns', async () => scenario(async (f, filter, tx) => {
  await tx.update(t.sportsBets).set({ status: 'settled', result: 'LOST', pl: '-35' }).where(eq(t.sportsBets.id, f.sports[0].id))
  const kpi = await sports.getSportsKPIs(filter)
  close(kpi.grossGamingRevenue, expected.sports.ggr + 151.5 + 35, 'legacy settlement GGR')
}))
test('sports player intelligence reports realised profit and loss without counting open/void stakes as losses', async () => scenario(async (f) => {
  const stats = await getPlayerStatistics(f.player.id, f.tenant, f.tenant)
  close(stats.netProfit, -expected.sports.ggr, 'player intelligence P/L')
  close(stats.largestLoss, 970.8, 'largest realised lay loss')
  close(stats.winRate, 50, 'settled win rate')
}))
test('daily snapshots reconcile with live historical results even when accepted bets are hidden from the running screen', async () => scenario(async (f, filter, tx) => {
  const past = new Date(f.now.getTime() - 2 * 86400000)
  const day = DateTime.fromJSDate(past, { zone: 'Asia/Kolkata' }).toISODate()
  for (const table of [t.sportsBets, t.casinoBets, t.matkaBets]) await tx.update(table).set({ createdAt: past, settledAt: past }).where(eq(table.tenant, f.tenant))
  await tx.update(t.sportsBets).set({ excludeFromAdminRunning: true }).where(eq(t.sportsBets.id, f.sports[0].id))
  await tx.update(t.casinoBets).set({ excludeFromAdminRunning: true }).where(eq(t.casinoBets.id, f.casino[1].id))
  mock.method(pool, 'query', (...args: any[]) => (tx as any).session.client.query(...args))
  for (const domain of ['sports', 'casino', 'matka'] as const) {
    const outcome = await generateDailySnapshot({ tenant: f.tenant, whitelabelId: f.tenant, date: past, domain, currency: 'INR', forceRefresh: true })
    assert.equal(outcome.success, true)
    const kpi = await ({ sports: sports.getSportsKPIs, casino: casino.getCasinoKPIs, matka: matka.getMatkaKPIs })[domain]({ ...filter, dateFrom: day, dateTo: day })
    close(kpi.grossGamingRevenue, expected[domain].ggr, domain + ' historical snapshot GGR')
  }
}))
test('a range containing historical snapshots and today includes current-day settled P/L', async () => scenario(async (f, filter, tx) => {
  const past = new Date(f.now.getTime() - 2 * 86400000)
  await tx.insert(t.sportsBets).values(f.sports.map((bet: any) => ({ ...bet, id: randomUUID(), createdAt: past, settledAt: past })))
  mock.method(pool, 'query', (...args: any[]) => (tx as any).session.client.query(...args))
  assert.equal((await generateDailySnapshot({ tenant: f.tenant, whitelabelId: f.tenant, date: past, domain: 'sports', currency: 'INR', forceRefresh: true })).success, true)
  const rows = await getPNLData({ ...filter, domain: 'sports', dateFrom: DateTime.fromJSDate(past, { zone: 'Asia/Kolkata' }).toISODate() })
  close(rows.reduce((sum, row) => sum + row.value, 0), 2 * expected.sports.ggr, 'historical + today P/L')
}))
test('referral-only player performance uses the same single agent ownership as commission GGR', async () => scenario(async (f, filter, tx) => {
  const [referrer] = await tx.insert(t.users).values({ tenant: f.tenant, name: 'Financial QA referrer', phone: '0000000000', passwordHash: 'not-a-login', agentId: f.owner.id, status: 'active' }).returning()
  await tx.update(t.users).set({ agentId: null }).where(eq(t.users.id, f.player.id))
  await tx.insert(t.referralAttributions).values({ tenant: f.tenant, refereeId: f.player.id, referrerId: referrer.id, status: 'confirmed' })
  const reads = await createAgentPerformanceReads(new Map([[f.owner.id, [f.owner.id]]]), filter, 'Asia/Kolkata')
  close(reads.breakdown(f.owner.id).find(row => row.domain === 'sports')!.ggr, expected.sports.ggr, 'referral Sports performance')
  close(reads.breakdown(f.owner.id).find(row => row.domain === 'casino')!.ggr, expected.casino.ggr, 'referral Casino performance')
  close(reads.breakdown(f.owner.id).find(row => row.domain === 'matka')!.ggr, expected.matka.ggr, 'referral Matka performance')
}))
test('report and commission GGR do not add a foreign-currency stake to the tenant base currency', async () => scenario(async (f, filter, tx) => {
  await tx.insert(t.sportsBets).values({ ...f.sports[1], id: randomUUID(), currency: 'USD', stake: '4096', liability: '4096', result: '0', pl: '-4096' })
  const reads = await createAgentPerformanceReads(new Map([[f.owner.id, [f.owner.id]]]), filter, 'Asia/Kolkata')
  close(reads.breakdown(f.owner.id).find(row => row.domain === 'sports')!.ggr, expected.sports.ggr, 'base-currency Sports performance')
  const ggr = await new LiveGGRReader().getSportsGGR({ agentId: f.owner.id, scope: 'direct', from: new Date(f.now.getTime() - 60000), to: new Date(f.now.getTime() + 60000) })
  close(ggr.ggr, expected.sports.ggr, 'base-currency commission GGR')
}))

test('sports sport, league and event breakdowns include the same live settlements as the KPI', async () => scenario(async (_f, filter) => {
  for (const read of [() => sports.getSportsBreakdown(filter, 'sport'), () => sports.getSportsLeagueBreakdown(filter), () => sports.getSportsEventBreakdown(filter)]) {
    close((await read()).reduce((sum, row) => sum + row.grossGamingRevenue, 0), expected.sports.ggr, 'Sports drilldown GGR')
  }
}))

test('casino vendor and game drilldowns use cash-only settled revenue just like their KPI', async () => scenario(async (_f, filter) => {
  for (const read of [casino.getCasinoVendorBreakdown, casino.getCasinoGameBreakdown, casino.getCasinoPlayerBreakdown]) {
    close((await read(filter)).reduce((sum, row) => sum + row.grossGamingRevenue, 0), expected.casino.ggr, 'Casino drilldown GGR')
  }
}))

test('partial historical snapshots cannot omit settled bets from a second historical day', async () => scenario(async (f, filter, tx) => {
  const first = new Date(f.now.getTime() - 4 * 86400000), second = new Date(f.now.getTime() - 2 * 86400000)
  const from = DateTime.fromJSDate(first, { zone: 'Asia/Kolkata' }).toISODate(), to = DateTime.fromJSDate(second, { zone: 'Asia/Kolkata' }).toISODate()
  mock.method(pool, 'query', (...args: any[]) => (tx as any).session.client.query(...args))
  for (const [domain, table, rows, read] of [['sports', t.sportsBets, f.sports, sports.getSportsKPIs], ['casino', t.casinoBets, f.casino.slice(0, 3), casino.getCasinoKPIs], ['matka', t.matkaBets, f.matka.slice(0, 2), matka.getMatkaKPIs]] as const) {
    await tx.update(table).set({ createdAt: first, settledAt: first, updatedAt: first }).where(eq(table.tenant, f.tenant))
    await generateDailySnapshot({ tenant: f.tenant, whitelabelId: f.tenant, date: first, domain, currency: 'INR', forceRefresh: true })
    await tx.insert(table).values(rows.map((row: any) => ({ ...row, id: randomUUID(), createdAt: second, settledAt: second, updatedAt: second })))
    const scoped = { ...filter, dateFrom: from, dateTo: to }
    close((await read(scoped)).grossGamingRevenue, 2 * expected[domain].ggr, domain + ' partial snapshot KPI')
    close((await getPNLData({ ...scoped, domain })).reduce((sum, row) => sum + row.value, 0), 2 * expected[domain].ggr, domain + ' partial snapshot P/L')
  }
}))

test('Sports and Casino agent contributors retain referral-only financial ownership', async () => scenario(async (f, filter, tx) => {
  const [referrer] = await tx.insert(t.users).values({ tenant: f.tenant, name: 'Contributor referrer', phone: '0000000000', passwordHash: 'not-a-login', agentId: f.owner.id, status: 'active' }).returning()
  await tx.update(t.users).set({ agentId: null }).where(eq(t.users.id, f.player.id))
  await tx.insert(t.referralAttributions).values({ tenant: f.tenant, refereeId: f.player.id, referrerId: referrer.id, status: 'confirmed' })
  for (const [domain, read] of [['sports', sports.getSportsAgentBreakdown], ['casino', casino.getCasinoAgentBreakdown], ['matka', matka.getMatkaAgentBreakdown]] as const) {
    close((await read(filter)).reduce((sum, row) => sum + row.grossGamingRevenue, 0), expected[domain].ggr, domain + ' referral agent contributor')
  }
  for (const read of [casino.getCasinoVendorBreakdown, casino.getCasinoGameBreakdown, casino.getCasinoPlayerBreakdown]) {
    close((await read({ ...filter, agentId: f.owner.id })).reduce((sum, row) => sum + row.grossGamingRevenue, 0), expected.casino.ggr, 'agent scoped referral Casino drilldown')
  }
}))

test('a late settlement correction invalidates an older historical financial snapshot', async () => scenario(async (f, filter, tx) => {
  const past = new Date(f.now.getTime() - 3 * 86400000), day = DateTime.fromJSDate(past, { zone: 'Asia/Kolkata' }).toISODate()
  await tx.update(t.sportsBets).set({ createdAt: past, settledAt: past, updatedAt: past }).where(eq(t.sportsBets.tenant, f.tenant))
  mock.method(pool, 'query', (...args: any[]) => (tx as any).session.client.query(...args))
  await generateDailySnapshot({ tenant: f.tenant, whitelabelId: f.tenant, date: past, domain: 'sports', currency: 'INR', forceRefresh: true })
  await tx.update(t.sportsBets).set({ status: 'lost', pl: '-101', result: '0', updatedAt: new Date(f.now.getTime() + 60000), settledAt: new Date() }).where(eq(t.sportsBets.id, f.sports[0].id))
  const scoped = { ...filter, dateFrom: day, dateTo: day }
  close((await sports.getSportsKPIs(scoped)).grossGamingRevenue, expected.sports.ggr + 252.5, 'late correction KPI')
  close((await getPNLData({ ...scoped, domain: 'sports' })).reduce((sum, row) => sum + row.value, 0), expected.sports.ggr + 252.5, 'late correction P/L')
}))

test('agent display formatting config exposes only currency, time zone and locale without config administration rights', async () => scenario(async (f) => {
  const { appConfigQueryResolvers } = await import('../../../domains/app-config/resolvers/queries.js')
  const ctx = { tenant: f.tenant, whitelabel: { id: f.tenant }, user: { sub: f.owner.id, type: 'agent', agentId: f.owner.id }, permissions: [] }
  const display = await appConfigQueryResolvers.appDisplayConfig(null, null, ctx)
  assert.deepEqual(Object.keys(display).sort(), ['baseCurrency', 'defaultLocale', 'timeZone'])
  assert.equal(display.baseCurrency, 'INR')
  await assert.rejects(() => appConfigQueryResolvers.appConfig(null, null, ctx), /permission/i)
  await assert.rejects(() => appConfigQueryResolvers.appDisplayConfig(null, null, {}), /authentication/i)
}))

test('agent cards, table and player drilldown agree on base currency, referral ownership and settled source data', async () => scenario(async (f, filter, tx) => {
  const [referrer] = await tx.insert(t.users).values({ tenant: f.tenant, name: 'Agent report referrer', phone: '0000000000', passwordHash: 'not-a-login', agentId: f.owner.id, status: 'active' }).returning()
  await tx.update(t.users).set({ agentId: null }).where(eq(t.users.id, f.player.id))
  await tx.insert(t.referralAttributions).values({ tenant: f.tenant, refereeId: f.player.id, referrerId: referrer.id, status: 'confirmed' })
  await tx.insert(t.sportsBets).values({ ...f.sports[1], id: randomUUID(), currency: 'USD', stake: '4096', liability: '4096', result: '0', pl: '-4096' })
  const base = { ...filter, currency: undefined }, expectedGGR = expected.sports.ggr + expected.casino.ggr + expected.matka.ggr
  const kpi = await agentReports.getAgentKPIs(base), performance = await agentReports.getAgentPerformance(base)
  close(kpi.totalGGR, expectedGGR, 'agent KPI base currency')
  assert.equal(kpi.agentCount, 1); assert.equal(kpi.activePlayerCount, 1)
  close(performance.agents.reduce((sum, row) => sum + row.totalGGR, 0), expectedGGR, 'agent table base currency')
  const players = await agentReports.getAgentPlayerBreakdown({ ...base, agentId: f.owner.id })
  close(players.reduce((sum, row) => sum + row.grossGamingRevenue, 0), expectedGGR, 'agent player drilldown')
  assert.equal(players[0].betCount, 13); close(players[0].winRate, 7 / 13, 'combined settled win rate')
  const usd = await agentReports.getAgentKPIs({ ...base, currency: 'USD' })
  close(usd.totalGGR, 4096, 'explicit USD KPI')
}))

test('domain player win rates count won bets, independent of payout multiplier or stake size', async () => scenario(async (_f, filter) => {
  for (const [read, winRate] of [[sports.getSportsPlayerBreakdown, .5], [casino.getCasinoPlayerBreakdown, 2 / 3], [matka.getMatkaPlayerBreakdown, .5]] as const) {
    const rows = await read(filter); assert.equal(rows.length, 1); close(Number(rows[0].winRate), winRate, 'settled player win rate')
  }
}))

test('Matka agent breakdown rolls up to root or direct child once and excludes unrelated tenants', async () => scenario(async (f, filter, tx) => {
  const child = await f.agent('COMMISSION', f.owner)
  await tx.update(t.users).set({ agentId: child.id }).where(eq(t.users.id, f.player.id))
  const rootRows = await matka.getMatkaAgentBreakdown(filter), children = await matka.getMatkaAgentBreakdown({ ...filter, agentId: f.owner.id })
  assert.equal(rootRows[0].agentId, f.owner.id); assert.equal(children[0].agentId, child.id)
  close(rootRows[0].grossGamingRevenue, expected.matka.ggr, 'root Matka GGR'); close(children[0].grossGamingRevenue, expected.matka.ggr, 'child Matka GGR')
  assert.equal((await matka.getMatkaAgentBreakdown({ ...filter, tenant: filter.tenant + '-foreign' })).length, 0)
}))

test('agent cards and rows apply the same bet-date range when settlement arrives on a later date', async () => scenario(async (f, filter, tx) => {
  const placed = new Date(f.now.getTime() - 4 * 86400000), settled = new Date(f.now.getTime() - 2 * 86400000)
  for (const table of [t.sportsBets, t.casinoBets, t.matkaBets]) await tx.update(table).set({ createdAt: placed, settledAt: settled, updatedAt: settled }).where(eq(table.tenant, f.tenant))
  const day = DateTime.fromJSDate(placed, { zone: 'Asia/Kolkata' }).toISODate(), scope = { ...filter, dateFrom: day, dateTo: day }
  const expectedGGR = expected.sports.ggr + expected.casino.ggr + expected.matka.ggr
  close((await agentReports.getAgentKPIs(scope)).totalGGR, expectedGGR, 'bet-date agent card')
  close((await agentReports.getAgentPerformance(scope)).agents.reduce((sum, row) => sum + row.totalGGR, 0), expectedGGR, 'bet-date agent table')
}))
