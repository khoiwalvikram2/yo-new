/**
 * Agent scoping in reporting, against the real database — READ ONLY.
 *
 * Writes nothing: every statement is a SELECT, the fixtures are whatever live
 * data exists, and a check that finds no suitable data skips rather than
 * fails. It proves that the agent-scoped SQL the repos now emit actually runs
 * on PostgreSQL (the `IN (WITH …)` subquery included) and that its rows belong
 * to the agent:
 *   - the matka player breakdown for an agent lists only the agent's players
 *     (it used to list the whole whitelabel, phone numbers included);
 *   - overviewKPIs for an agent caller counts the agent's players and none of
 *     the whitelabel's pending approvals, and an agent with no players gets
 *     zeros rather than the whitelabel's dashboard;
 *   - every other agent-scoped repo path executes.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/reporting/__tests__/agentReportingScope.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

let db: (typeof import('@src/db/client.js'))['db']
/** An agent whose players have settled matka bets (absent on a database with no matka play). */
let matkaCandidate: { agentId: string; tenant: string; whitelabelId: string } | null = null
/** An agent whose players have casino bets — the general fixture. */
let candidate: { agentId: string; tenant: string; whitelabelId: string } | null = null

const PAST_FROM = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
const PAST_TO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? []
}

function agentCtx(agentId: string, tenant: string) {
  return {
    tenant,
    whitelabel: { id: tenant },
    user: { type: 'agent', agentId, sub: agentId, roles: [] },
    permissions: [{ domain: 'reporting', actions: ['read', 'view'] }],
  }
}

before(async () => {
  ;({ db } = await import('@src/db/client.js'))
  // The agent whose directly assigned players placed the most settled matka bets.
  const found = rows(
    await db.execute(sql`
      SELECT a.id::text AS agent_id, a.tenant_id AS tenant, mb.whitelabel_id AS whitelabel_id, COUNT(*)::int AS n
      FROM agents a
      JOIN users u ON u.agent_id = a.id AND u.tenant = a.tenant_id
      JOIN matka_bets mb ON mb.user_id = u.id AND mb.status IN ('won', 'lost')
      GROUP BY a.id, a.tenant_id, mb.whitelabel_id
      ORDER BY n DESC
      LIMIT 1
    `),
  )
  if (found[0]) matkaCandidate = { agentId: found[0].agent_id, tenant: found[0].tenant, whitelabelId: found[0].whitelabel_id }

  // Among agents with a parent-of-subtree shape preferred: the agent whose
  // subtree's direct players placed the most casino bets.
  const general = rows(
    await db.execute(sql`
      SELECT a.id::text AS agent_id, a.tenant_id AS tenant, cb.whitelabel_id AS whitelabel_id, COUNT(*)::int AS n
      FROM agents a
      JOIN users u ON u.agent_id = a.id AND u.tenant = a.tenant_id
      JOIN casino_bets cb ON cb.user_id = u.id
      GROUP BY a.id, a.tenant_id, cb.whitelabel_id
      ORDER BY n DESC
      LIMIT 1
    `),
  )
  if (general[0]) candidate = { agentId: general[0].agent_id, tenant: general[0].tenant, whitelabelId: general[0].whitelabel_id }
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('matka player breakdown for an agent', () => {
  it('lists only the agent’s own players', async (t) => {
    if (!matkaCandidate) return t.skip('no agent with settled matka bets in this database')
    const repo = await import('@src/repos/reporting/matkaReportingRepo.js')
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = new Set(await listAgentPlayerIds(matkaCandidate.agentId, matkaCandidate.tenant))
    assert.ok(own.size > 0, 'the matkaCandidate agent has players')

    const scoped = await repo.getMatkaPlayerBreakdown({ tenant: matkaCandidate.tenant, whitelabelId: matkaCandidate.whitelabelId, agentId: matkaCandidate.agentId })
    const whole = await repo.getMatkaPlayerBreakdown({ tenant: matkaCandidate.tenant, whitelabelId: matkaCandidate.whitelabelId })

    assert.ok(scoped.length > 0, 'the agent’s players have settled matka bets')
    for (const row of scoped) {
      assert.ok(own.has(Number(row.playerId)), `player ${row.playerId} is not one of the agent’s players`)
    }
    const outsiders = whole.filter((r) => !own.has(Number(r.playerId)))
    if (outsiders.length > 0) {
      assert.ok(scoped.length < whole.length, 'the whitelabel has other players; the agent must not see them')
    }
  })

  it('totals of the type/market/session drill-downs never exceed the whitelabel’s', async (t) => {
    if (!matkaCandidate) return t.skip('no agent with settled matka bets in this database')
    const repo = await import('@src/repos/reporting/matkaReportingRepo.js')
    const base = { tenant: matkaCandidate.tenant, whitelabelId: matkaCandidate.whitelabelId }
    const sum = (list: Array<{ totalStakes: number }>) => list.reduce((s, r) => s + r.totalStakes, 0)
    for (const fn of [repo.getMatkaTypeBreakdown, repo.getMatkaMarketBreakdown, repo.getMatkaSessionBreakdown]) {
      const scoped = sum(await fn({ ...base, agentId: matkaCandidate.agentId }))
      const whole = sum(await fn(base))
      assert.ok(scoped > 0, `${fn.name}: the agent has stakes`)
      assert.ok(scoped <= whole + 1e-6, `${fn.name}: agent ${scoped} > whitelabel ${whole}`)
    }
  })
})

describe('casino player breakdown for an agent (the same scope, on live data)', () => {
  it('lists only the agent’s own players, and fewer than the whitelabel when others exist', async (t) => {
    if (!candidate) return t.skip('no agent with casino bets in this database')
    const repo = await import('@src/repos/reporting/casinoReportingRepo.js')
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = new Set(await listAgentPlayerIds(candidate.agentId, candidate.tenant))
    const base = { tenant: candidate.tenant, whitelabelId: candidate.whitelabelId }
    const scoped = await repo.getCasinoPlayerBreakdown({ ...base, agentId: candidate.agentId })
    const whole = await repo.getCasinoPlayerBreakdown(base)
    assert.ok(scoped.length > 0, 'the agent’s players have casino bets')
    for (const row of scoped as any[]) {
      assert.ok(own.has(Number(row.playerId)), `player ${row.playerId} is not one of the agent’s players`)
      // An agent never sees its upline in the chain: the chain starts at an agent of its subtree.
      if (row.agentChain?.length) assert.ok(row.directAgentId, 'a chain is shown only with a visible direct agent')
    }
    if ((whole as any[]).some((r) => !own.has(Number(r.playerId)))) {
      assert.ok(scoped.length < whole.length)
    }
  })
})

describe('overviewKPIs for an agent caller', () => {
  it('counts the agent’s players and shows none of the whitelabel’s approvals', async (t) => {
    if (!candidate) return t.skip('no agent with players in this database')
    const { commonQueryResolvers } = (await import('@src/domains/common/resolvers/queries.js')) as any
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = await listAgentPlayerIds(candidate.agentId, candidate.tenant)
    const kpis = await commonQueryResolvers.overviewKPIs(undefined, {}, agentCtx(candidate.agentId, candidate.tenant))
    assert.equal(kpis.totalPlayers, own.length, 'totalPlayers is the agent’s own player count')
    assert.deepEqual(kpis.approvalsPending, [], 'pending approvals are the operator’s, not the agent’s')
    assert.deepEqual(kpis.alerts, [])
    assert.equal(kpis.agentCommission, 0, 'the whitelabel’s commission bill is not shown to an agent')
  })

  it('an agent with no players gets zeros, not the whitelabel’s dashboard', async (t) => {
    if (!candidate) return t.skip('no tenant with agent players in this database')
    const tenantPlayers = Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant = ${candidate.tenant}`))[0]?.n ?? 0)
    assert.ok(tenantPlayers > 0)
    const { commonQueryResolvers } = (await import('@src/domains/common/resolvers/queries.js')) as any
    const kpis = await commonQueryResolvers.overviewKPIs(undefined, {}, agentCtx(randomUUID(), candidate.tenant))
    assert.equal(kpis.totalPlayers, 0)
    assert.equal(kpis.totalDeposits, 0)
    assert.equal(kpis.totalWithdrawals, 0)
    assert.equal(kpis.turnover, 0)
    assert.equal(kpis.activePlayers, 0)
  })
})

describe('sports reads for an agent', () => {
  it('sportsPlayerProfile opens the agent’s own player only, and nothing across tenants', async (t) => {
    if (!candidate) return t.skip('no agent in this database')
    const { sportsQueryResolvers } = await import('@src/domains/sports/resolvers/queries.js')
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = await listAgentPlayerIds(candidate.agentId, candidate.tenant)
    if (own.length === 0) return t.skip('the agent has no players')
    const ownSet = new Set(own)
    const stranger = rows(
      await db.execute(sql`SELECT id FROM users WHERE tenant = ${candidate.tenant} ORDER BY id DESC LIMIT 200`),
    ).map((r) => Number(r.id)).find((id) => !ownSet.has(id))

    const ctx = { ...agentCtx(candidate.agentId, candidate.tenant), permissions: [{ domain: 'sports', actions: ['read'] }] }
    const mine = await sportsQueryResolvers.sportsPlayerProfile(undefined, { userId: String(own[0]) }, ctx)
    assert.ok(mine, 'the agent can open its own player')
    assert.equal(String(mine.user.id), String(own[0]))
    if (stranger !== undefined) {
      const theirs = await sportsQueryResolvers.sportsPlayerProfile(undefined, { userId: String(stranger) }, ctx)
      assert.equal(theirs, null, 'another agent’s (or the whitelabel’s) player is not visible')
    }
    // An admin of another tenant cannot open this tenant's player by id.
    const otherTenantAdmin = { tenant: 'w4-test-other-tenant', whitelabel: { id: 'w4-test-other-tenant' }, user: { sub: '1', roles: [] }, permissions: [] }
    assert.equal(await sportsQueryResolvers.sportsPlayerProfile(undefined, { userId: String(own[0]) }, otherTenantAdmin), null)
  })

  it('runningEvents and bettingPatterns run agent-scoped', async (t) => {
    if (!candidate) return t.skip('no agent in this database')
    const { sportsQueryResolvers, agentOpenEventTotals } = await import('@src/domains/sports/resolvers/queries.js')
    const ctx = agentCtx(candidate.agentId, candidate.tenant)
    // The totals query itself (runningEvents swallows errors for agents, so call it directly).
    const totals = await agentOpenEventTotals(candidate.agentId, candidate.tenant, candidate.tenant)
    const expected = Number(rows(await db.execute(sql`
      SELECT COUNT(DISTINCT sb.event_id)::int AS n FROM sports_bets sb
      WHERE sb.whitelabel_id = ${candidate.tenant} AND sb.tenant = ${candidate.tenant}
        AND sb.status IN ('matched', 'unmatched') AND sb.exclude_from_admin_running = false
        AND sb.user_id IN (SELECT player_id FROM (SELECT u.id AS player_id FROM users u
          JOIN agent_hierarchy_closure c ON c.descendant_id = u.agent_id
          WHERE c.ancestor_id = ${candidate.agentId} AND u.tenant = ${candidate.tenant}) d)
    `))[0]?.n ?? 0)
    assert.ok(totals.size >= expected, `open events of the agent's direct-subtree players: ${expected}, got ${totals.size}`)
    const events = await sportsQueryResolvers.runningEvents(undefined, {}, ctx)
    assert.ok(Array.isArray(events))
    for (const e of events as any[]) assert.ok(totals.has(String(e.id)), 'runningEvents lists only events the agent’s players bet on')
    const patterns = await sportsQueryResolvers.bettingPatterns(undefined, { limit: 20 }, ctx)
    assert.ok(Array.isArray(patterns))
  })
})

describe('every agent-scoped reporting path executes on PostgreSQL', () => {
  it('snapshot, live, pnl, exposure, bonus, agent and player paths', async (t) => {
    if (!candidate) return t.skip('no agent in this database')
    const { agentId, tenant, whitelabelId } = candidate
    const sports = await import('@src/repos/reporting/sportsReportingRepo.js')
    const casino = await import('@src/repos/reporting/casinoReportingRepo.js')
    const matka = await import('@src/repos/reporting/matkaReportingRepo.js')
    const pnl = await import('@src/repos/reporting/pnlReportingRepo.js')
    const exposure = await import('@src/repos/reporting/exposureReportingRepo.js')
    const bonus = await import('@src/repos/reporting/bonusReportingRepo.js')
    const agentRepo = await import('@src/repos/reporting/agentReportingRepo.js')

    const past = { tenant, whitelabelId, agentId, dateFrom: PAST_FROM, dateTo: PAST_TO }
    const live = { tenant, whitelabelId, agentId, dateFrom: PAST_FROM, dateTo: new Date() }
    for (const f of [past, live]) {
      await sports.getSportsKPIs(f)
      await sports.getSportsTrends(f)
      await casino.getCasinoKPIs(f)
      await casino.getCasinoTrends(f)
      await matka.getMatkaKPIs(f)
      await matka.getMatkaTrends(f)
    }
    // The matka drill-downs, agent-scoped (they run even where matka has no rows).
    await matka.getMatkaTypeBreakdown(past)
    await matka.getMatkaMarketBreakdown(past)
    await matka.getMatkaSessionBreakdown(past)
    await matka.getMatkaPlayerBreakdown(past)
    await sports.getSportsPlayerBreakdown(past)
    await sports.getSportsBreakdown(past, 'sport')
    await casino.getCasinoPlayerBreakdown(past)
    const p = await pnl.getPNLData({ tenant, whitelabelId, agentId, dateFrom: PAST_FROM.toISOString(), dateTo: PAST_TO.toISOString() })
    assert.ok(Array.isArray(p))
    const e = await exposure.getExposureData({ tenant, whitelabelId, agentId, dateFrom: PAST_FROM.toISOString(), dateTo: new Date().toISOString() })
    assert.ok(Array.isArray(e))
    await bonus.getBonusKPIs({ tenant, agentId })
    const players = await agentRepo.getAgentPlayerBreakdown({ tenant, whitelabelId, agentId, dateFrom: PAST_FROM, dateTo: PAST_TO })
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = new Set(await listAgentPlayerIds(agentId, tenant))
    for (const r of players) assert.ok(own.has(Number(r.playerId)), `agent player breakdown leaked player ${r.playerId}`)
    const perf = await agentRepo.getAgentPerformance({ tenant, whitelabelId, agentId, parentAgentId: agentId, dateFrom: PAST_FROM, dateTo: PAST_TO })
    assert.ok(Array.isArray(perf.agents))
    // The matka exposure book an agent's subscription now computes.
    const { computeExposureBook } = await import('@src/domains/matka/services/ExposureService.js')
    const book = await computeExposureBook({ tenant, whitelabelId, agentId })
    assert.ok(Array.isArray(book.markets))
  })
})

describe('agent dashboard trends, domain split and player activity (player-level rows)', () => {
  /** An agent whose players have player-level snapshot rows in the window. */
  let snapAgent: { agentId: string; tenant: string; from: string; to: string } | null = null

  before(async () => {
    const found = rows(
      await db.execute(sql`
        SELECT a.id::text AS agent_id, a.tenant_id AS tenant,
               MIN(s.snapshot_date)::date::text AS d_from, MAX(s.snapshot_date)::date::text AS d_to, COUNT(*)::int AS n
        FROM agents a
        JOIN users u ON u.agent_id = a.id AND u.tenant = a.tenant_id
        JOIN reporting_daily_snapshots s ON s.player_id = u.id AND s.tenant = a.tenant_id
        WHERE s.snapshot_date >= ${PAST_FROM} AND s.snapshot_date <= ${PAST_TO}
        GROUP BY a.id, a.tenant_id
        ORDER BY n DESC
        LIMIT 1
      `),
    )
    if (found[0]) snapAgent = { agentId: found[0].agent_id, tenant: found[0].tenant, from: found[0].d_from, to: found[0].d_to }
  })

  it('the three agent queries run and return the agent’s figures (they return [] on any SQL error)', async (t) => {
    if (!snapAgent) return t.skip('no agent with player-level snapshot rows in this database')
    const { reportingQueryGroupResolvers } = await import('@src/domains/reporting/resolvers/queries.js')
    const ctx = agentCtx(snapAgent.agentId, snapAgent.tenant)
    const args = { agentId: snapAgent.agentId, periodFrom: snapAgent.from, periodTo: snapAgent.to }

    const split = await (reportingQueryGroupResolvers as any).domainBreakdown(null, args, ctx)
    const trends = await (reportingQueryGroupResolvers as any).ggrTrends(null, args, ctx)
    const activity = await (reportingQueryGroupResolvers as any).playerActivity(null, args, ctx)
    assert.ok(split.length > 0, 'domainBreakdown returned nothing for an agent with snapshot rows')
    assert.ok(trends.length > 0, 'ggrTrends returned nothing for an agent with snapshot rows')
    assert.ok(activity.length > 0, 'playerActivity returned nothing for an agent with snapshot rows')

    // The domain split adds up to the player-level rows of exactly the agent's players.
    const { agentPlayerIdsSubquery } = await import('@src/repos/reporting/agentPlayerScope.js')
    const [expected] = rows(
      await db.execute(sql`
        SELECT COALESCE(SUM(ggr::numeric), 0)::float AS ggr
        FROM reporting_daily_snapshots
        WHERE tenant = ${snapAgent.tenant} AND player_id IS NOT NULL
          AND player_id IN ${agentPlayerIdsSubquery(snapAgent.agentId, snapAgent.tenant)}
          AND snapshot_date::date >= ${snapAgent.from}::date AND snapshot_date::date <= ${snapAgent.to}::date
      `),
    )
    const total = split.reduce((s: number, r: { ggr: number }) => s + r.ggr, 0)
    assert.ok(Math.abs(total - Number(expected.ggr)) < 0.01, `domain split ${total} vs player rows ${expected.ggr}`)

    // Active players are distinct players, so a day never shows more than the agent has.
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = (await listAgentPlayerIds(snapAgent.agentId, snapAgent.tenant)).length
    for (const day of activity) assert.ok(day.activePlayers <= own, `day ${day.date}: ${day.activePlayers} active of ${own} players`)
  })
})
