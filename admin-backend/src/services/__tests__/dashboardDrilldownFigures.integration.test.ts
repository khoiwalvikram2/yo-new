/**
 * Executive Dashboard drill-downs that must add up to the figure they open from, against the real
 * database — READ ONLY (every statement is a SELECT; a check with no suitable data skips).
 *
 *   - DAS-EXPOSURE-DRILL: an open-book list (Exposure, Exposure by market › Matka, a risk event's draw)
 *     carries an Exposure column that adds up to the figure: a sports bet's liability plus a matka
 *     bet's potential payout. Its Stake column is the money staked (it held the sports liability and
 *     the matka stake, so the matka lists added up to the stakes, not to the figure).
 *   - DAS-AGENTS-TAB-SCHEME: "COMMISSION:all" lists every agent of the scheme (the Agents tab counts
 *     every status); the bare scheme still lists ACTIVE agents only (the Operations figures).
 *   - DAS-BONUS-FULLPAGE: Bonus given opens /bonus-awards, the list of the awards it shows.
 *   - DAS-KPI-DRILL-GGR: Gross Revenue and Net GGR open their parts (GGR by player, each top-level
 *     agent's commission, each bonus paid), whose Amount column adds up to the card (they opened the
 *     GGR-only "GGR by player" list); Agent commission and Bonus paid add up to their own figures.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/__tests__/dashboardDrilldownFigures.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)

let db: any
let drill: typeof import('../dashboardDrilldownService.js')
/** The tenant with the most open matka bets (the exposure fixture), and the one with the most agents. */
let openTenant: string | null = null
let agentTenant: string | null = null

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
  const r = await db.execute(query)
  return r?.rows ?? []
}

type Result = Awaited<ReturnType<typeof import('../dashboardDrilldownService.js')['getDashboardDrilldown']>>

/** Every row of a drill-down, page by page (over the dashboard's period when one is given). */
async function allRows(
  tenant: string,
  kind: string,
  arg: string,
  period: { dateFrom?: string; dateTo?: string } = {},
): Promise<{ first: Result; rows: Result['rows'] }> {
  const first = await drill.getDashboardDrilldown({ tenant }, { kind, arg, ...period, limit: 100, offset: 0 })
  const rows = [...first.rows]
  while (rows.length < first.total) {
    const next = await drill.getDashboardDrilldown({ tenant }, { kind, arg, ...period, limit: 100, offset: rows.length })
    if (next.rows.length === 0) break
    rows.push(...next.rows)
  }
  return { first, rows }
}

function sumOf(result: Result, rows: Result['rows'], key: string): number {
  const index = result.columns.findIndex((c) => c.key === key)
  assert.ok(index >= 0, `the list has a ${key} column`)
  return rows.reduce((sum, row) => sum + Number(row.cells[index] ?? 0), 0)
}

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} != ${b}`)

describe('dashboard drill-downs add up to their figures', { skip: !hasDb }, () => {
  before(async () => {
    ;({ db } = await import('@src/db/client.js'))
    drill = await import('../dashboardDrilldownService.js')
    const open = await q(sql`SELECT tenant FROM matka_bets WHERE status::text IN ('pending', 'active') GROUP BY tenant ORDER BY COUNT(*) DESC LIMIT 1`)
    openTenant = open[0]?.tenant ?? null
    const agents = await q(sql`SELECT tenant_id AS tenant FROM agents GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1`)
    agentTenant = agents[0]?.tenant ?? null
  })

  after(async () => {
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
    await closeRedisEmitter().catch(() => {})
  })

  it('Exposure: the Exposure column is sports liability plus matka potential payout; Stake is the stake', async (t) => {
    if (!openTenant) return t.skip('no open matka bets in this database')
    const [book] = await q(sql`
      SELECT
        (SELECT COALESCE(SUM(COALESCE(liability, stake)), 0) FROM sports_bets WHERE tenant = ${openTenant} AND status::text IN ('matched', 'unmatched'))::text AS sports_liability,
        (SELECT COALESCE(SUM(stake), 0) FROM sports_bets WHERE tenant = ${openTenant} AND status::text IN ('matched', 'unmatched'))::text AS sports_stake,
        (SELECT COALESCE(SUM(potential_win), 0) FROM matka_bets WHERE tenant = ${openTenant} AND status::text IN ('pending', 'active'))::text AS matka_payout,
        (SELECT COALESCE(SUM(bet_amount), 0) FROM matka_bets WHERE tenant = ${openTenant} AND status::text IN ('pending', 'active'))::text AS matka_stake`)
    const { first, rows } = await allRows(openTenant, 'bets', 'exposure')
    assert.deepEqual(first.columns.map((c) => c.label), ['Player', 'Agent', 'Product', 'On', 'Stake', 'Exposure', 'Status', 'Placed'])
    near(sumOf(first, rows, 'exposure'), Number(book.sports_liability) + Number(book.matka_payout), 'Σ Exposure = the Exposure figure')
    near(sumOf(first, rows, 'stake'), Number(book.sports_stake) + Number(book.matka_stake), 'Σ Stake = the open stakes')
    assert.match(first.subtitle, /potential payout/)
  })

  it('Exposure by market › Matka: its rows add up to the open matka potential payout', async (t) => {
    if (!openTenant) return t.skip('no open matka bets in this database')
    const { getCurrentOpenMatkaExposure } = await import('@src/repos/reporting/matkaReportingRepo.js')
    const figure = await getCurrentOpenMatkaExposure({ tenant: openTenant })
    const { first, rows } = await allRows(openTenant, 'bets', 'product:matka')
    near(sumOf(first, rows, 'exposure'), figure, 'Σ Exposure = the Matka row')
  })

  it('a period bet list keeps the plain columns (no Exposure)', async (t) => {
    if (!openTenant) return t.skip('no open matka bets in this database')
    const result = await drill.getDashboardDrilldown({ tenant: openTenant }, { kind: 'bets', limit: 1 })
    assert.equal(result.columns.some((c) => c.key === 'exposure'), false)
    const stale = await drill.getDashboardDrilldown({ tenant: openTenant }, { kind: 'bets', arg: 'stale', limit: 1 })
    assert.equal(stale.columns.some((c) => c.key === 'exposure'), false)
  })

  it('Agents by scheme opens every agent of the scheme; the bare scheme stays ACTIVE-only', async (t) => {
    if (!agentTenant) return t.skip('no agents in this database')
    const counts = await q(sql`
      SELECT scheme_type::text AS scheme, COUNT(*)::int AS every, COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
      FROM agents WHERE tenant_id = ${agentTenant} GROUP BY 1`)
    for (const row of counts) {
      const every = await drill.getDashboardDrilldown({ tenant: agentTenant }, { kind: 'agents', arg: `${row.scheme}:all`, limit: 1 })
      assert.equal(every.total, row.every, `${row.scheme}:all lists every ${row.scheme} agent`)
      assert.match(every.subtitle, /every status/)
      const active = await drill.getDashboardDrilldown({ tenant: agentTenant }, { kind: 'agents', arg: row.scheme, limit: 1 })
      assert.equal(active.total, row.active, `${row.scheme} lists the ACTIVE ones`)
      assert.match(active.subtitle, /active$/)
    }
    // The tab's figures: the scheme counts are every agent, and "suspended" is SUSPENDED or BLOCKED only.
    const { getAgentsTab } = await import('../dashboardTabsService.js')
    const tab = await getAgentsTab({ tenant: agentTenant }, { dateFrom: new Date(0).toISOString(), dateTo: new Date().toISOString() })
    const [statuses] = await q(sql`
      SELECT COUNT(*) FILTER (WHERE status IN ('SUSPENDED', 'BLOCKED'))::int AS suspended FROM agents WHERE tenant_id = ${agentTenant}`)
    assert.equal(tab.network.suspended, statuses.suspended)
    for (const row of counts) {
      const key = String(row.scheme).toLowerCase() as 'commission' | 'sharing' | 'credit'
      assert.equal(tab.network[key], row.every, `the ${key} count is what its drill-down lists`)
    }
  })

  it('Bonus given opens the bonus awards list', async (t) => {
    if (!agentTenant) return t.skip('no tenant in this database')
    const result = await drill.getDashboardDrilldown({ tenant: agentTenant }, { kind: 'bonus_awards', limit: 1 })
    assert.equal(result.page, '/bonus-awards')
  })

  it('Gross Revenue and Net GGR list their parts, and each list adds up to its card (DAS-KPI-DRILL-GGR)', async (t) => {
    if (!agentTenant) return t.skip('no tenant in this database')
    // The finding's period: a year to date, so commission and bonus are not 0 (today they usually are).
    const period = { dateFrom: '2026-01-01T00:00:00.000Z', dateTo: new Date().toISOString() }
    const { getDashboardKPIs } = await import('../dashboardService.js')
    const kpis = await getDashboardKPIs(agentTenant, agentTenant, period)

    const amountOf = async (kind: string, part?: string) => {
      const { first, rows } = await allRows(agentTenant!, kind, '', period)
      const index = first.columns.findIndex((c) => c.key === 'part')
      return sumOf(first, part ? rows.filter((row) => row.cells[index] === part) : rows, 'amount')
    }
    near(await amountOf('gross_revenue'), kpis.ggr + kpis.agentCommission, 'Σ Gross revenue = GGR + agent commission')
    near(await amountOf('gross_revenue', 'GGR'), kpis.ggr, 'its GGR rows = the GGR card')
    near(await amountOf('net_ggr'), kpis.ngr, 'Σ Net GGR = GGR − commission − bonus paid')
    near(await amountOf('agent_commission'), kpis.agentCommission, 'Σ Agent commission = the commission figure')
    near(await amountOf('bonus_paid'), kpis.bonusPayouts, 'Σ Bonus paid = the bonus figure')
    // A top-level agent with no commission is no part of the card (a quiet day listed every one at 0.00).
    const commission = await allRows(agentTenant, 'agent_commission', '', period)
    const amount = commission.first.columns.findIndex((c) => c.key === 'amount')
    assert.ok(commission.rows.every((row) => Number(row.cells[amount]) !== 0), 'no 0.00 commission rows')
  })
})
