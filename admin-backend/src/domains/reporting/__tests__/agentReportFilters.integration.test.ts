/**
 * The Agent Performance / Agent Overview filters, against the real database — READ ONLY.
 *
 * Writes nothing: every statement is a SELECT and the fixtures are whatever
 * live data exists; a check that finds no suitable data skips rather than fails.
 *   - F-REP-03: an agent's Commission under a domain tab is the posted COMMISSION
 *     ledger lines of that domain only (every tab showed the all-domain sum), and
 *     an agent's own agentKPIs Commission follows the tab the same way.
 *   - F-REP-04: agentKPIs honours the Agent type picker. The three types
 *     partition the whitelabel's figures (every type returned the whole network),
 *     and the whitelabel-wide snapshot read counts agent-level rows only.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentReportFilters.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

let db: (typeof import('@src/db/client.js'))['db']
/** A tenant whose COMMISSION root agents have posted commission in more than one domain. */
let commissionTenant: { tenant: string; agentId: string } | null = null
/** The tenant with the most agents (the F-REP-04 fixture). */
let agentTenant: string | null = null

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
      { domain: 'reporting.agents-performance', actions: ['view'] },
      { domain: 'reporting.agent-overview', actions: ['view'] },
    ],
  }
}

function agentCtx(agentId: string, tenant: string) {
  return {
    tenant,
    whitelabel: { id: tenant },
    user: { type: 'agent', agentId, sub: agentId, roles: [], agentSchemeType: 'COMMISSION' },
    permissions: [{ domain: 'reporting.agent-overview', actions: ['view'] }],
  }
}

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`)

before(async () => {
  ;({ db } = await import('@src/db/client.js'))
  const found = rows(await db.execute(sql`
    SELECT a.tenant_id AS tenant, a.id::text AS agent_id, COUNT(DISTINCT l.domain)::int AS domains
    FROM agent_ledger l JOIN agents a ON a.id = l.agent_id
    WHERE l.line_type = 'COMMISSION' AND a.scheme_type = 'COMMISSION' AND a.parent_agent_id IS NULL
    GROUP BY a.tenant_id, a.id
    HAVING COUNT(DISTINCT l.domain) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `))
  if (found[0]) commissionTenant = { tenant: found[0].tenant, agentId: found[0].agent_id }
  const busiest = rows(await db.execute(sql`
    SELECT tenant_id AS tenant FROM agents GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1
  `))
  if (busiest[0]) agentTenant = busiest[0].tenant
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

/** The posted COMMISSION lines of one agent, as getPostedPerformanceCommissions reads them. */
async function postedCommission(tenant: string, agentId: string, domain: string | null): Promise<number> {
  const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
  const currency = await getWhitelabelCurrency(tenant)
  const [row] = rows(await db.execute(sql`
    SELECT COALESCE(SUM(l.amount::numeric), 0)::text AS total
    FROM agent_ledger l JOIN agents a ON a.id = l.agent_id
    WHERE a.tenant_id = ${tenant} AND l.agent_id = ${agentId} AND l.line_type = 'COMMISSION'
      AND l.currency = ${currency} ${domain ? sql`AND l.domain = ${domain}` : sql``}
  `))
  return Number(row?.total ?? 0)
}

describe('F-REP-03: per-agent Commission follows the domain tab', () => {
  it('agentPerformance shows each COMMISSION agent’s posted lines of the chosen domain', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant } = commissionTenant
    const perDomain: Record<string, number> = {}
    for (const domain of [undefined, 'sports', 'casino', 'matka'] as const) {
      const result = await reportingQueryResolvers.agentPerformance(undefined, {
        filter: { ...ALL_TIME, schemeType: 'COMMISSION', ...(domain ? { domain } : {}) }, limit: 500,
      }, adminCtx(tenant))
      const commissionRows = (result?.agents ?? []).filter((row: any) => row.schemeType === 'COMMISSION')
      for (const row of commissionRows) {
        near(row.commissionEarned, await postedCommission(tenant, row.agentId, domain ?? null), `${domain ?? 'all'} commission of ${row.agentId}`)
      }
      const fixture = commissionRows.find((row: any) => row.agentId === commissionTenant!.agentId)
      if (fixture) perDomain[domain ?? 'all'] = fixture.commissionEarned
    }
    if ('all' in perDomain && 'sports' in perDomain && 'casino' in perDomain && 'matka' in perDomain) {
      near(perDomain.sports + perDomain.casino + perDomain.matka, perDomain.all, 'the domain tabs add up to All Domains')
    }
  })

  it('an agent’s own agentKPIs Commission is its posted lines of the chosen domain', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant, agentId } = commissionTenant
    for (const domain of [undefined, 'sports', 'casino'] as const) {
      const kpis = await reportingQueryResolvers.agentKPIs(undefined, {
        filter: { ...ALL_TIME, ...(domain ? { domain } : {}) },
      }, agentCtx(agentId, tenant))
      near(kpis.commissionEarned, await postedCommission(tenant, agentId, domain ?? null), `${domain ?? 'all'} agentKPIs commission`)
    }
  })

  it('an admin naming another whitelabel’s agent in agentKPIs reads none of its posted commission', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const [other] = rows(await db.execute(sql`SELECT id FROM whitelabels WHERE id <> ${commissionTenant.tenant} AND id <> 'default' LIMIT 1`))
    if (!other) return t.skip('no second whitelabel in this database')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant, agentId } = commissionTenant
    const posted = await postedCommission(tenant, agentId, null)
    if (posted === 0) return t.skip('the fixture agent has no posted commission in its whitelabel currency')
    const filter = { filter: { ...ALL_TIME, agentId } }
    const foreign = await reportingQueryResolvers.agentKPIs(undefined, filter, adminCtx(other.id))
    assert.equal(Number(foreign.commissionEarned ?? 0), 0, 'the ledger was read without the agent’s tenant')
    // Its own whitelabel's admin still sees it.
    near((await reportingQueryResolvers.agentKPIs(undefined, filter, adminCtx(tenant))).commissionEarned, posted, 'its own admin')
  })
})

describe('F-REP-04: agentKPIs honours the Agent type', () => {
  const keys = ['totalTurnover', 'totalGGR', 'betCount'] as const

  for (const [label, range] of [
    ['a range ending today (live slice)', ALL_TIME],
    ['a past month (snapshots when current)', { dateFrom: '2026-06-01', dateTo: '2026-06-30' }],
  ] as const) {
    it(`the three types partition the whitelabel figures over ${label}`, async (t) => {
      if (!agentTenant) return t.skip('no agents in this database')
      const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
      const ctx = adminCtx(agentTenant)
      const whole = await reportingQueryResolvers.agentKPIs(undefined, { filter: { ...range } }, ctx)
      const parts = await Promise.all(['COMMISSION', 'SHARING', 'CREDIT'].map((schemeType) =>
        reportingQueryResolvers.agentKPIs(undefined, { filter: { ...range, schemeType } }, ctx)))
      for (const key of keys) {
        near(parts.reduce((sum: number, part: any) => sum + Number(part[key] ?? 0), 0), Number(whole[key] ?? 0), `${key} by type`)
      }
      // A type with no activity gets zeros, not the whole network.
      const idle = parts.find((part: any) => Number(part.totalTurnover) === 0)
      if (Number(whole.totalTurnover) > 0 && idle) assert.equal(idle.betCount, 0)
    })
  }

  it('the whitelabel-wide snapshot read sums agent-level rows only (no player-level double count)', async (t) => {
    if (!agentTenant) return t.skip('no agents in this database')
    const { financialSnapshotsAreCurrent } = await import('@src/repos/reporting/snapshotFreshness.js')
    const { getWhitelabelCurrency, getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
    const { getAgentKPIs } = await import('@src/repos/reporting/agentReportingRepo.js')
    const range = { dateFrom: '2026-06-01', dateTo: '2026-06-30' }
    const currency = await getWhitelabelCurrency(agentTenant)
    const tz = await getWhitelabelTimezone(agentTenant)
    const scope = { tenant: agentTenant, whitelabelId: agentTenant, currency, ...range }
    for (const domain of ['sports', 'casino', 'matka'] as const) {
      if (!(await financialSnapshotsAreCurrent(scope, domain, tz))) return t.skip(`${domain} snapshots for June are not current here`)
    }
    const { parseDateFrom, parseDateTo } = await import('@src/shared/dateUtils.js')
    const [expected] = rows(await db.execute(sql`
      SELECT COALESCE(SUM(total_stakes::numeric), 0)::text AS stakes, COALESCE(SUM(bet_count), 0)::text AS bets
      FROM reporting_daily_snapshots
      WHERE tenant = ${agentTenant} AND whitelabel_id = ${agentTenant} AND currency = ${currency}
        AND agent_id IS NOT NULL AND player_id IS NULL AND domain IN ('sports', 'casino', 'matka')
        AND snapshot_date >= ${parseDateFrom(range.dateFrom, tz).toISOString()}
        AND snapshot_date <= ${parseDateTo(range.dateTo, tz).toISOString()}
    `))
    const kpis = await getAgentKPIs(scope)
    near(kpis.totalTurnover, Number(expected.stakes), 'June turnover')
    near(kpis.betCount, Number(expected.bets), 'June bets')
  })
})

describe('F-REP-05: agentTrends shows the activity the cards count', () => {
  /** True when every domain's snapshots are current, i.e. agentKPIs reads snapshots and live bets need not agree to the paisa. */
  async function snapshotsCurrent(tenant: string, range: { dateFrom: string; dateTo: string }) {
    const { financialSnapshotsAreCurrent } = await import('@src/repos/reporting/snapshotFreshness.js')
    const { getWhitelabelCurrency, getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
    const scope = { tenant, whitelabelId: tenant, currency: await getWhitelabelCurrency(tenant), ...range }
    const tz = await getWhitelabelTimezone(tenant)
    for (const domain of ['sports', 'casino', 'matka'] as const) if (!(await financialSnapshotsAreCurrent(scope, domain, tz))) return false
    return true
  }

  it('the whitelabel’s days add up to its cards', async (t) => {
    if (!agentTenant) return t.skip('no agents in this database')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const ctx = adminCtx(agentTenant)
    const kpis = await reportingQueryResolvers.agentKPIs(undefined, { filter: { ...ALL_TIME } }, ctx)
    const trends = await reportingQueryResolvers.agentTrends(undefined, { filter: { ...ALL_TIME } }, ctx)
    if (Number(kpis.totalTurnover) === 0) return t.skip('no agent activity in this database')
    assert.ok(trends.length > 0, 'activity shows (it read an empty table)')
    assert.deepEqual(trends.map((p: any) => p.date), [...trends.map((p: any) => p.date)].sort(), 'oldest day first')
    if (await snapshotsCurrent(agentTenant, ALL_TIME)) return t.skip('snapshots are current: the cards read them, not live bets')
    near(trends.reduce((sum: number, p: any) => sum + p.turnover, 0), Number(kpis.totalTurnover), 'Σ turnover = the card')
    near(trends.reduce((sum: number, p: any) => sum + p.ggr, 0), Number(kpis.totalGGR), 'Σ GGR = the card')
    // A domain tab narrows the days to that domain.
    const casino = await reportingQueryResolvers.agentTrends(undefined, { filter: { ...ALL_TIME, domain: 'casino' } }, ctx)
    const casinoKpis = await reportingQueryResolvers.agentKPIs(undefined, { filter: { ...ALL_TIME, domain: 'casino' } }, ctx)
    near(casino.reduce((sum: number, p: any) => sum + p.turnover, 0), Number(casinoKpis.totalTurnover), 'Σ casino turnover = the casino card')
  })

  it('a COMMISSION agent’s days add up to its cards, its posted commission included', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { tenant, agentId } = commissionTenant
    const ctx = agentCtx(agentId, tenant)
    const kpis = await reportingQueryResolvers.agentKPIs(undefined, { filter: { ...ALL_TIME } }, ctx)
    const trends = await reportingQueryResolvers.agentTrends(undefined, { filter: { ...ALL_TIME } }, ctx)
    assert.ok(trends.length > 0)
    near(trends.reduce((sum: number, p: any) => sum + p.commission, 0), await postedCommission(tenant, agentId, null), 'Σ commission = its posted lines')
    if (await snapshotsCurrent(tenant, ALL_TIME)) return t.skip('snapshots are current: the cards read them, not live bets')
    near(trends.reduce((sum: number, p: any) => sum + p.turnover, 0), Number(kpis.totalTurnover), 'Σ turnover = its card')
  })

  it('an admin naming another whitelabel’s agent reads none of its ledger (the bets were tenant-filtered, the ledger was not)', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const [other] = rows(await db.execute(sql`SELECT id FROM whitelabels WHERE id <> ${commissionTenant.tenant} AND id <> 'default' LIMIT 1`))
    if (!other) return t.skip('no second whitelabel in this database')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const trends = await reportingQueryResolvers.agentTrends(undefined, { filter: { ...ALL_TIME, agentId: commissionTenant.agentId } }, adminCtx(other.id))
    assert.deepEqual(trends, [], 'no days, no commission of a foreign agent')
  })
})

describe('the admin Commission Earned card is the posted commission the rest of the page shows', () => {
  // It summed the snapshots' agent_commission estimate (grandwinn, 2026-02-01..2026-10-31: 1,070,705.98 against
  // posted lines of 649,048.87; the estimate can go negative). Fixture-row cases: agentCommissionCard.integration.test.ts.
  it('equals the whitelabel’s posted COMMISSION lines and the Activity Trends column, per domain tab', async (t) => {
    if (!commissionTenant) return t.skip('no COMMISSION root agent with commission in two domains')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
    const { tenant } = commissionTenant
    const currency = await getWhitelabelCurrency(tenant)
    for (const domain of [undefined, 'sports', 'casino'] as const) {
      const filter = { ...ALL_TIME, ...(domain ? { domain } : {}) }
      const [posted] = rows(await db.execute(sql`
        SELECT COALESCE(SUM(l.amount::numeric), 0)::text AS total
        FROM agent_ledger l JOIN agents a ON a.id = l.agent_id
        WHERE a.tenant_id = ${tenant} AND l.line_type = 'COMMISSION' AND l.currency = ${currency}
          ${domain ? sql`AND l.domain = ${domain}` : sql``}
      `))
      const card = Number((await reportingQueryResolvers.agentKPIs(undefined, { filter }, adminCtx(tenant))).commissionEarned)
      near(card, Number(posted.total), `${domain ?? 'all'} card = posted lines`)
      assert.ok(card >= 0, 'posted commission is never negative here')
      const days = await reportingQueryResolvers.agentTrends(undefined, { filter }, adminCtx(tenant))
      near(days.reduce((sum: number, p: any) => sum + p.commission, 0), card, `${domain ?? 'all'} Σ trend commission = the card`)
    }
  })
})
