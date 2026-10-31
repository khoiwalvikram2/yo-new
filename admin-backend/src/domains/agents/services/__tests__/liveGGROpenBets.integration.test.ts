/**
 * W10 B3 against the real database — READ ONLY (SELECTs only; nothing is
 * settled or written).
 *
 * - LiveGGRReader.earliestOpenBetForAgent returns the creation time of the
 *   earliest still-open bet (sports matched/unmatched, cash casino and matka
 *   pending/active) of the agent's downline players, attributed as the GGR is
 *   (COALESCE(users.agent_id, confirmed referrer's agent)) — checked against an
 *   independent formulation.
 * - The wired SHARING engine (createSharingSettlementEngine) ends the open window
 *   at that instant (pending reads only).
 *
 * Skipped without DATABASE_URL, or when no player has an open bet.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/liveGGROpenBets.integration.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const FAR_PAST = new Date(0)

async function exec(q: ReturnType<typeof sql>): Promise<any[]> {
  const { db } = await import('@/db/client.js')
  const r: any = await db.execute(q)
  return Array.isArray(r) ? r : r?.rows ?? []
}

/** Independent: earliest open bet of the agent's subtree players (closure table + COALESCE attribution). */
async function independentEarliest(agentId: string, tenant: string, from: Date, to: Date): Promise<Date | null> {
  const [row] = await exec(sql`
    WITH scope AS (
      SELECT descendant_id::text AS id FROM agent_hierarchy_closure WHERE ancestor_id::text = ${agentId}
      UNION SELECT ${agentId}
    ), players AS (
      SELECT u.id FROM users u
      LEFT JOIN referral_attributions ra ON ra.referee_id = u.id AND ra.status = 'confirmed' AND ra.tenant = ${tenant}
      LEFT JOIN users ru ON ru.id = ra.referrer_id AND ru.tenant = ${tenant}
      WHERE COALESCE(u.agent_id, ru.agent_id)::text IN (SELECT id FROM scope)
    )
    SELECT LEAST(
      (SELECT MIN(created_at) FROM sports_bets WHERE user_id IN (SELECT id FROM players) AND tenant = ${tenant} AND whitelabel_id = ${tenant}
         AND status IN ('matched', 'unmatched') AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz),
      (SELECT MIN(created_at) FROM casino_bets WHERE user_id IN (SELECT id FROM players) AND tenant = ${tenant} AND whitelabel_id = ${tenant}
         AND wallet_type = 'cash' AND status IN ('pending', 'active') AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz),
      (SELECT MIN(created_at) FROM matka_bets WHERE user_id IN (SELECT id FROM players) AND tenant = ${tenant} AND whitelabel_id = ${tenant}
         AND status IN ('pending', 'active') AND created_at >= ${from.toISOString()}::timestamptz AND created_at < ${to.toISOString()}::timestamptz)
    ) AS earliest`)
  return row?.earliest ? new Date(row.earliest) : null
}

describe('earliest open bet of an agent\'s SHARE base (read-only DB)', { skip: !hasDb }, () => {
  after(async () => {
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
    await closeRedisEmitter().catch(() => {})
    const { pool } = await import('@/db/client.js')
    await pool.end().catch(() => {})
  })

  let candidate: { agentId: string; tenant: string; createdAt: Date } | null = null
  async function pick() {
    if (candidate) return candidate
    // The agent (by the GGR attribution) of a player with an open bet.
    const [row] = await exec(sql`
      SELECT COALESCE(u.agent_id, ru.agent_id)::text AS agent_id, a.tenant_id AS tenant, a.created_at AS created_at
      FROM (
        SELECT user_id, tenant FROM sports_bets WHERE status IN ('matched', 'unmatched') AND tenant = whitelabel_id
        UNION ALL SELECT user_id, tenant FROM casino_bets WHERE status IN ('pending', 'active') AND wallet_type = 'cash' AND tenant = whitelabel_id
        UNION ALL SELECT user_id, tenant FROM matka_bets WHERE status IN ('pending', 'active') AND tenant = whitelabel_id
      ) ob
      JOIN users u ON u.id = ob.user_id
      LEFT JOIN referral_attributions ra ON ra.referee_id = u.id AND ra.status = 'confirmed' AND ra.tenant = ob.tenant
      LEFT JOIN users ru ON ru.id = ra.referrer_id AND ru.tenant = ob.tenant
      JOIN agents a ON a.id = COALESCE(u.agent_id, ru.agent_id) AND a.tenant_id = ob.tenant
      LIMIT 1`)
    if (row) candidate = { agentId: String(row.agent_id), tenant: String(row.tenant), createdAt: new Date(row.created_at) }
    return candidate
  }

  it('LiveGGRReader.earliestOpenBetForAgent matches the independent formulation', async (t) => {
    const c = await pick()
    if (!c) return t.skip('no open bet in this database')
    const to = new Date(Date.now() + 60_000)
    const { LiveGGRReader } = await import('../LiveGGRReader.js')
    const reader = new LiveGGRReader()
    const got = await reader.earliestOpenBetForAgent({ agentId: c.agentId, from: FAR_PAST, to, scope: 'downline' })
    const expected = await independentEarliest(c.agentId, c.tenant, FAR_PAST, to)
    assert.ok(expected, 'the picked agent has an open bet')
    assert.equal(got?.getTime(), expected!.getTime())

    // The window bounds are half-open: from = the bet's instant includes it, to = that instant excludes it.
    const fromAt = await reader.earliestOpenBetForAgent({ agentId: c.agentId, from: expected!, to, scope: 'downline' })
    assert.equal(fromAt?.getTime(), expected!.getTime())
    const before = await reader.earliestOpenBetForAgent({ agentId: c.agentId, from: FAR_PAST, to: expected!, scope: 'downline' })
    assert.equal(before, null)

    // Same counts as commission readiness's open-bet definition (countOpenBetsByAgentIds).
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const ids = await new AgentsRepo().getDescendantIds(c.agentId)
    const counts = await reader.countOpenBetsByAgentIds({ agentIds: ids, tenantId: c.tenant, from: FAR_PAST, to, whitelabelId: c.tenant })
    assert.ok(counts.sports + counts.casino + counts.matka > 0)
  })

  it('the wired SHARING engine ends the open window at the earliest open bet', async (t) => {
    const c = await pick()
    if (!c) return t.skip('no open bet in this database')
    const { createSharingSettlementEngine } = await import('../sharingSettlementWiring.js')
    const engine = createSharingSettlementEngine()
    const now = new Date()
    const win = await engine.openWindow({ id: c.agentId, tenantId: c.tenant, createdAt: c.createdAt }, now)
    const expected = await independentEarliest(c.agentId, c.tenant, win.periodFrom, now)
    if (!expected) return t.skip('the open bet is older than the agent\'s open window')
    assert.equal(win.periodTo.getTime(), expected.getTime())
    assert.equal(win.openBetCutoff?.getTime(), expected.getTime())

    // With the hold-back turned off the same window runs to now (the W9 behaviour).
    const plain = createSharingSettlementEngine({ earliestOpenBetAt: null })
    const open = await plain.openWindow({ id: c.agentId, tenantId: c.tenant, createdAt: c.createdAt }, now)
    assert.equal(open.periodTo.getTime(), now.getTime())
  })
})
