/**
 * Agent-scoped exports against the real database, READ ONLY (agent features spec §4).
 *
 * Every statement is a SELECT. The fixtures are whatever live data exists, and a check that finds no
 * suitable data skips rather than fails.
 *
 * It proves that the export SQL agents now get runs on PostgreSQL (the `IN (WITH …)` subquery
 * inside a capped statement), and that its rows belong to the agent:
 *   - the players of its subtree plus their confirmed referrals;
 *   - its sub-agents;
 *   - its own and its direct children's settlements;
 *   - its subtree's commission weeks.
 * The casino file is checked against an independently written count, so it is complete rather than
 * a capped whitelabel sample. The row estimate counts exactly what the file holds. A COMMISSION
 * agent can list its export jobs.
 *
 * Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/reporting/__tests__/agentExportScope.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

type Scheme = 'COMMISSION' | 'SHARING' | 'CREDIT'
type Candidate = { agentId: string; tenant: string; whitelabelId: string; schemeType: Scheme; allowedDomains: string[] }

let db: (typeof import('@src/db/client.js'))['db']
let candidate: Candidate | null = null
let settlementAgent: Candidate | null = null
let commissionAgent: Candidate | null = null
let referral: { agentId: string; tenant: string; refereeId: number } | null = null

function rows(result: any): any[] {
  return Array.isArray(result) ? result : result?.rows ?? []
}

function toCandidate(row: any): Candidate | null {
  if (!row) return null
  return {
    agentId: String(row.agent_id),
    tenant: String(row.tenant),
    whitelabelId: String(row.whitelabel_id ?? row.tenant),
    schemeType: String(row.scheme_type) as Scheme,
    allowedDomains: Array.isArray(row.allowed_domains) ? row.allowed_domains.map(String) : [],
  }
}

function queryScope(c: Candidate) {
  return { agentId: c.agentId, tenant: c.tenant, whitelabelId: c.whitelabelId }
}

async function scopeOf(c: Candidate) {
  const { loadAgentExportScope } = await import('@src/domains/reporting/services/agentExportScope.js')
  return loadAgentExportScope({
    callerAgentId: c.agentId,
    schemeType: c.schemeType,
    allowedDomains: c.allowedDomains,
    tenant: c.tenant,
    whitelabelId: c.whitelabelId,
  })
}

/** The processor's own read path (fetchExportData), never processJob: that writes the job row and the file. */
async function processorRows(c: Candidate, reportType: string, filters: Record<string, unknown> = {}): Promise<any[]> {
  const { ExportJobProcessor } = await import('@src/domains/reporting/services/ExportJobProcessor.js')
  return (new ExportJobProcessor() as any).fetchExportData(
    reportType,
    filters,
    { tenant: c.tenant, whitelabelId: c.whitelabelId },
    {
      agentContext: { agentId: c.agentId, schemeType: c.schemeType, allowedDomains: c.allowedDomains },
      agentScope: await scopeOf(c),
      tenant: c.tenant,
      whitelabelId: c.whitelabelId,
    },
  )
}

function agentCtx(c: Candidate) {
  return {
    tenant: c.tenant,
    whitelabelId: c.whitelabelId,
    whitelabel: { id: c.whitelabelId },
    user: { type: 'agent', agentId: c.agentId, sub: c.agentId, roles: [], agentSchemeType: c.schemeType, agentAllowedDomains: c.allowedDomains },
    permissions: [{ domain: 'reporting', actions: ['read', 'view'] }],
  }
}

before(async () => {
  ;({ db } = await import('@src/db/client.js'))

  // The agent whose subtree's direct players placed the most casino bets.
  candidate = toCandidate(rows(await db.execute(sql`
    SELECT a.id::text AS agent_id, a.tenant_id AS tenant, cb.whitelabel_id AS whitelabel_id,
           a.scheme_type::text AS scheme_type, a.allowed_domains AS allowed_domains, COUNT(*)::int AS n
    FROM agents a
    JOIN agent_hierarchy_closure c ON c.ancestor_id = a.id
    JOIN users u ON u.agent_id = c.descendant_id AND u.tenant = a.tenant_id
    JOIN casino_bets cb ON cb.user_id = u.id AND cb.tenant = a.tenant_id
    GROUP BY a.id, a.tenant_id, cb.whitelabel_id, a.scheme_type, a.allowed_domains
    ORDER BY n DESC
    LIMIT 1
  `))[0])

  // A SHARING or CREDIT agent with settlements of its own or of a direct child.
  settlementAgent = toCandidate(rows(await db.execute(sql`
    SELECT a.id::text AS agent_id, a.tenant_id AS tenant, a.scheme_type::text AS scheme_type,
           a.allowed_domains AS allowed_domains, COUNT(*)::int AS n
    FROM agents a
    JOIN agent_settlement_transactions s ON s.tenant = a.tenant_id
     AND (s.agent_id = a.id OR s.agent_id IN (SELECT ch.id FROM agents ch WHERE ch.parent_agent_id = a.id))
    WHERE a.scheme_type IN ('SHARING', 'CREDIT')
    GROUP BY a.id, a.tenant_id, a.scheme_type, a.allowed_domains
    ORDER BY n DESC
    LIMIT 1
  `))[0])

  // The COMMISSION agent with the smallest subtree, newest first (the engine runs once per agent and week).
  commissionAgent = toCandidate(rows(await db.execute(sql`
    SELECT a.id::text AS agent_id, a.tenant_id AS tenant, a.scheme_type::text AS scheme_type,
           a.allowed_domains AS allowed_domains, COUNT(c.descendant_id)::int AS size
    FROM agents a
    JOIN agent_hierarchy_closure c ON c.ancestor_id = a.id
    WHERE a.scheme_type = 'COMMISSION'
    GROUP BY a.id, a.tenant_id, a.scheme_type, a.allowed_domains, a.created_at
    ORDER BY size ASC, a.created_at DESC
    LIMIT 1
  `))[0])

  // A confirmed referral whose referee is not a direct player of the referrer's agent.
  const found = rows(await db.execute(sql`
    SELECT ru.agent_id::text AS agent_id, ru.tenant AS tenant, ra.referee_id AS referee_id
    FROM referral_attributions ra
    JOIN users ru ON ru.id = ra.referrer_id AND ru.agent_id IS NOT NULL
    JOIN users re ON re.id = ra.referee_id AND re.tenant = ru.tenant
    WHERE ra.status = 'confirmed' AND ra.tenant = ru.tenant
      AND (re.agent_id IS NULL OR re.agent_id <> ru.agent_id)
    LIMIT 1
  `))[0]
  if (found) referral = { agentId: String(found.agent_id), tenant: String(found.tenant), refereeId: Number(found.referee_id) }
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('agent export SQL on PostgreSQL', () => {
  it("every export holds only the agent's players, and its count is the file's row count", async (t) => {
    if (!candidate) return t.skip('no agent whose players have casino bets')
    const queries = await import('@src/repos/reporting/agentExportQueries.js')
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const own = new Set(await listAgentPlayerIds(candidate.agentId, candidate.tenant))
    assert.ok(own.size > 0, 'the candidate agent has players')
    const q = queryScope(candidate)

    const players = await queries.agentPlayersQuery(q)
    for (const p of players) assert.ok(own.has(Number(p.id)), `player ${p.id} is not the agent's`)
    assert.equal(await queries.agentPlayersCount(q), players.length)

    const checks: Array<[string, any[], number]> = [
      ['sports', await queries.agentSportsBetsQuery(q, {}), await queries.agentSportsBetsCount(q, {})],
      ['casino', await queries.agentCasinoBetsQuery(q, {}), await queries.agentCasinoBetsCount(q, {})],
      ['matka', await queries.agentMatkaBetsQuery(q, {}), await queries.agentMatkaBetsCount(q, {})],
      ['deposits', await queries.agentDepositsQuery(q, {}), await queries.agentDepositsCount(q, {})],
      ['withdrawals', await queries.agentWithdrawalsQuery(q, {}), await queries.agentWithdrawalsCount(q, {})],
    ]
    for (const [name, list, total] of checks) {
      for (const r of list) assert.ok(own.has(Number(r.userId)), `${name}: user ${r.userId} is not the agent's`)
      assert.equal(total, list.length, `${name}: the estimate is the file's row count`)
    }
  })

  it('the casino file is complete: an independently written count of the agent\'s bets, capped like the file', async (t) => {
    if (!candidate) return t.skip('no agent whose players have casino bets')
    const queries = await import('@src/repos/reporting/agentExportQueries.js')
    const expected = Number(rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM casino_bets cb
      WHERE cb.tenant = ${candidate.tenant} AND cb.whitelabel_id = ${candidate.whitelabelId}
        AND (cb.user_id IN (SELECT u.id FROM users u
                            JOIN agent_hierarchy_closure c ON c.descendant_id = u.agent_id
                            WHERE c.ancestor_id = ${candidate.agentId} AND u.tenant = ${candidate.tenant})
          OR cb.user_id IN (SELECT ra.referee_id FROM referral_attributions ra
                            JOIN users ru ON ru.id = ra.referrer_id
                            JOIN agent_hierarchy_closure c2 ON c2.descendant_id = ru.agent_id
                            WHERE c2.ancestor_id = ${candidate.agentId} AND ru.tenant = ${candidate.tenant}
                              AND ra.status = 'confirmed' AND ra.tenant = ${candidate.tenant}))
    `))[0]?.n ?? 0)
    assert.ok(expected > 0, 'the candidate agent has casino bets')
    const scoped = await queries.agentCasinoBetsQuery(queryScope(candidate), {})
    assert.equal(scoped.length, Math.min(expected, queries.AGENT_EXPORT_ROW_CAP))
  })

  it('includes a referral-linked player', async (t) => {
    if (!referral) return t.skip("no confirmed referral outside the referrer agent's direct players")
    const queries = await import('@src/repos/reporting/agentExportQueries.js')
    const list = await queries.agentPlayersQuery({ agentId: referral.agentId, tenant: referral.tenant, whitelabelId: referral.tenant })
    assert.ok(list.some((p) => Number(p.id) === referral!.refereeId), `referee ${referral.refereeId} is missing from the agent's players`)
  })
})

describe("the processor's agent exports", () => {
  it("players, deposits and (with casino) casino bets are the agent's own", async (t) => {
    if (!candidate) return t.skip('no agent whose players have casino bets')
    const { listAgentPlayerIds } = await import('@src/repos/reporting/agentPlayerScope.js')
    const { countAgentExportRows } = await import('@src/domains/reporting/services/agentExportScope.js')
    const own = new Set(await listAgentPlayerIds(candidate.agentId, candidate.tenant))
    for (const r of await processorRows(candidate, 'PLAYERS')) assert.ok(own.has(Number(r.id)), `player ${r.id}`)
    for (const r of await processorRows(candidate, 'DEPOSITS')) assert.ok(own.has(Number(r.userId)), `deposit of ${r.userId}`)
    if (candidate.allowedDomains.includes('casino')) {
      const casino = await processorRows(candidate, 'CASINO_BETS')
      for (const r of casino) assert.ok(own.has(Number(r.userId)), `casino bet of ${r.userId}`)
      assert.equal(casino.length, await countAgentExportRows('CASINO_BETS', {}, await scopeOf(candidate)))
    }
  })

  it('sub-agents are the subtree below the agent, never the agent', async (t) => {
    if (!candidate) return t.skip('no agent')
    const { countAgentExportRows } = await import('@src/domains/reporting/services/agentExportScope.js')
    const scope = await scopeOf(candidate)
    const below = new Set(scope.subtreeIds.filter((id) => id !== candidate!.agentId))
    const list = await processorRows(candidate, 'SUBAGENTS')
    for (const r of list) assert.ok(below.has(String(r.id)), `agent ${r.id} is not below the caller`)
    assert.equal(list.length, await countAgentExportRows('SUBAGENTS', {}, scope))
  })

  it("settlements are the agent's own and its direct children's", async (t) => {
    if (!settlementAgent) return t.skip('no SHARING/CREDIT agent with settlements')
    const { countAgentExportRows, loadSettlementAgentIds } = await import('@src/domains/reporting/services/agentExportScope.js')
    const allowed = new Set(await loadSettlementAgentIds(settlementAgent.agentId))
    const list = await processorRows(settlementAgent, 'SETTLEMENTS')
    assert.ok(list.length > 0, 'the settlement agent has settlement rows')
    for (const r of list) {
      assert.ok(allowed.has(r.agentId), `settlement of ${r.agentId} is neither the agent's nor a direct child's`)
      assert.equal(r.relation, r.agentId === settlementAgent.agentId ? 'SELF' : 'DIRECT_SUB_AGENT')
    }
    assert.equal(list.length, await countAgentExportRows('SETTLEMENTS', {}, await scopeOf(settlementAgent)))
  })

  it('commission rows are per week, for the agent and its sub-agents only, and the estimate counts them', async (t) => {
    if (!commissionAgent) return t.skip('no COMMISSION agent')
    const { countAgentExportRows } = await import('@src/domains/reporting/services/agentExportScope.js')
    const scope = await scopeOf(commissionAgent)
    const filters = { dateFrom: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), dateTo: new Date().toISOString() }
    const list = await processorRows(commissionAgent, 'COMMISSION', filters)
    const subtree = new Set(scope.subtreeIds)
    assert.ok(list.some((r) => r.relation === 'SELF'), "the agent's own weeks are listed")
    for (const r of list) {
      assert.ok(subtree.has(r.agentId), `commission row of ${r.agentId} is outside the subtree`)
      assert.ok(['OPEN', 'CLOSED_UNSETTLED', 'SETTLED', 'BLOCKED'].includes(r.status), r.status)
      assert.equal(typeof r.gross, 'number')
    }
    assert.equal(list.length, await countAgentExportRows('COMMISSION', filters, scope))
  })
})

describe('the Export Center resolvers for agents', () => {
  it('a COMMISSION agent lists its jobs, and a job that is not its own is not found', async (t) => {
    if (!commissionAgent) return t.skip('no COMMISSION agent')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const ctx = agentCtx(commissionAgent)
    assert.ok(Array.isArray(await reportingQueryResolvers.exportJobs(undefined, { limit: 5 }, ctx)))
    await assert.rejects(reportingQueryResolvers.exportJobDownloadUrl(undefined, { jobId: randomUUID() }, ctx), /Export job not found/)
  })

  it("agentExportRowCount answers the agent's own count, and ignores an agent outside its subtree", async (t) => {
    if (!candidate) return t.skip('no agent')
    const { reportingQueryResolvers } = (await import('@src/domains/reporting/resolvers/queries.js')) as any
    const queries = await import('@src/repos/reporting/agentExportQueries.js')
    const expected = await queries.agentPlayersCount(queryScope(candidate))
    const ctx = agentCtx(candidate)
    assert.equal(await reportingQueryResolvers.agentExportRowCount(undefined, { reportType: 'players', filtersJson: { agentId: candidate.agentId } }, ctx), expected)
    assert.equal(await reportingQueryResolvers.agentExportRowCount(undefined, { reportType: 'players', filtersJson: { agentId: randomUUID() } }, ctx), expected)
  })
})
