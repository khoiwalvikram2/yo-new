/**
 * W10 B4: the agent list's player sets use the money paths' player scope
 * (commissionPlayerScope: a player belongs to ONE agent,
 * COALESCE(users.agent_id, its confirmed referrer's agent)), each player once.
 *
 * The pure assignment is tested in memory. A READ-ONLY check against the
 * configured database (SELECTs only) compares getPlayersByAgents with an
 * independent formulation; it is skipped without DATABASE_URL or when no agent
 * has referral-linked players.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/agentListPlayersScope.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)

describe('assignPlayersToAgents (pure)', () => {
  it('each listed agent gets its own players plus its subtree\'s, each once', async () => {
    const { assignPlayersToAgents } = await import('../AgentListStatsService.js')
    const subtree = new Map<string, Set<string>>([
      ['root', new Set(['mid', 'leaf'])],
      ['mid', new Set(['leaf'])],
    ])
    const rows = [
      { agentId: 'root', playerId: 1 },
      { agentId: 'mid', playerId: 2 },
      { agentId: 'leaf', playerId: 3 },
      { agentId: 'leaf', playerId: 3 }, // a duplicate row never counts twice
      { agentId: 'other', playerId: 4 },
      { agentId: null, playerId: 5 },
    ]
    const out = assignPlayersToAgents(rows, ['root', 'mid'], subtree)
    assert.deepEqual(out.get('root'), [1, 2, 3])
    assert.deepEqual(out.get('mid'), [2, 3])
    assert.equal(out.has('other'), false)
  })

  it('an agent with no players still has an (empty) entry', async () => {
    const { assignPlayersToAgents } = await import('../AgentListStatsService.js')
    assert.deepEqual(assignPlayersToAgents([], ['a'], new Map()).get('a'), [])
  })
})

describe('getPlayersByAgents counts referral-linked players (read-only DB)', { skip: !hasDb }, () => {
  after(async () => {
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
    await closeRedisEmitter().catch(() => {})
    const { pool } = await import('@/db/client.js')
    await pool.end().catch(() => {})
  })

  it('equals the independent player scope of the agent\'s subtree (COALESCE attribution)', async () => {
    const { db } = await import('@/db/client.js')
    const exec = async (q: ReturnType<typeof sql>) => {
      const r: any = await db.execute(q)
      return (Array.isArray(r) ? r : r?.rows ?? []) as any[]
    }
    // An agent whose players referred someone with no agent of its own.
    const [pick] = await exec(sql`
      SELECT ru.agent_id::text AS agent_id, ra.tenant AS tenant
      FROM referral_attributions ra
      JOIN users u ON u.id = ra.referee_id
      JOIN users ru ON ru.id = ra.referrer_id
      WHERE ra.status = 'confirmed' AND u.agent_id IS NULL AND ru.agent_id IS NOT NULL AND ru.tenant = ra.tenant
      LIMIT 1`)
    if (!pick) return
    const agentId = String(pick.agent_id)
    const tenant = String(pick.tenant)

    const expected = await exec(sql`
      WITH scope AS (
        SELECT descendant_id::text AS id FROM agent_hierarchy_closure WHERE ancestor_id::text = ${agentId}
        UNION SELECT ${agentId}
      )
      SELECT u.id AS id
      FROM users u
      LEFT JOIN referral_attributions ra ON ra.referee_id = u.id AND ra.status = 'confirmed' AND ra.tenant = ${tenant}
      LEFT JOIN users ru ON ru.id = ra.referrer_id AND ru.tenant = ${tenant}
      WHERE u.tenant = ${tenant} AND COALESCE(u.agent_id, ru.agent_id)::text IN (SELECT id FROM scope)`)

    const { AgentListStatsService } = await import('../AgentListStatsService.js')
    const svc = new AgentListStatsService() as unknown as { getPlayersByAgents(ids: string[], tenant: string): Promise<Map<string, number[]>> }
    const got = (await svc.getPlayersByAgents([agentId], tenant)).get(agentId) ?? []
    assert.equal(new Set(got).size, got.length, 'each player once')
    assert.deepEqual([...got].map(Number).sort((a, b) => a - b), expected.map((r) => Number(r.id)).sort((a, b) => a - b))

    const [referee] = await exec(sql`
      SELECT ra.referee_id AS id FROM referral_attributions ra
      JOIN users u ON u.id = ra.referee_id JOIN users ru ON ru.id = ra.referrer_id
      WHERE ra.status = 'confirmed' AND u.agent_id IS NULL AND ru.agent_id::text = ${agentId} LIMIT 1`)
    assert.ok(got.map(Number).includes(Number(referee.id)), 'the referral-linked player is in the agent\'s list stats')
  })
})
