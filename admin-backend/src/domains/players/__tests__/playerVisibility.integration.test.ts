/**
 * An agent reads its own players, not the whitelabel's.
 *
 * A player belongs to an agent two ways: assigned directly to an agent in the
 * subtree, or referred by one of those players. `PlayerAuthService.getAgentPlayerIds`
 * covers both, and the `players/` domain's read resolvers use it consistently.
 *
 * The `users/` domain did not. `Query.user`, `wallet`, `playerLimits`,
 * `usersByIds`, `playersStatsByIds`, `playerActivityDepositWithdrawalStats` and
 * `agentsByIds` each checked a permission and scoped by tenant, then handed back
 * whichever id the caller named — so an agent read any player of the whitelabel.
 * `players.playerSecurityAudit` had the same gap while every read around it did
 * not.
 *
 * Singular reads refuse; plural reads narrow. Narrowing is deliberate: a mixed
 * request should return the visible rows the way a list query does rather than
 * fail whole because one id was out of reach.
 *
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'visibility-test-tenant'

let db: (typeof import('@src/db/client.js'))['db']
let vis: typeof import('@src/domains/players/services/playerVisibility.js')
let mine = 0
let theirs = 0
let myAgent = ''
let otherAgent = ''

const asAgent = (agentId: string) => ({
  user: { sub: '1', type: 'agent', agentId, isReadOnly: false },
  tenant: TENANT,
})
const asAdmin = () => ({ user: { sub: '1', type: 'admin', roles: [] }, tenant: TENANT })

async function mkAgent(): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, status)
    VALUES (${TENANT}, 'CREDIT', ARRAY['sports']::text[], 'ACTIVE') RETURNING id`)
  return String((r.rows[0] as { id: string }).id)
}

async function mkPlayer(agentId: string): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash, agent_id)
    VALUES (${TENANT}, 'P', ${'p-' + Math.floor(performance.now() * 1000)}, 'active', 'x', ${agentId})
    RETURNING id`)
  return Number((r.rows[0] as { id: number }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  vis = await import('@src/domains/players/services/playerVisibility.js')

  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'Visibility Test', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)

  myAgent = await mkAgent()
  otherAgent = await mkAgent()
  // The closure carries a depth-0 self row for each agent in the real system.
  for (const a of [myAgent, otherAgent]) {
    await db.execute(sql`
      INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
      VALUES (${a}, ${a}, 0) ON CONFLICT DO NOTHING`)
  }
  mine = await mkPlayer(myAgent)
  theirs = await mkPlayer(otherAgent)
})

after(async () => {
  if (db) {
    await db.execute(sql`
      DELETE FROM agent_hierarchy_closure
      WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('maySeePlayer', () => {
  it('lets an agent see its own player', async () => {
    assert.equal(await vis.maySeePlayer(asAgent(myAgent), mine, TENANT), true)
  })

  it('refuses another agent’s player in the same whitelabel', async () => {
    assert.equal(
      await vis.maySeePlayer(asAgent(myAgent), theirs, TENANT),
      false,
      'an agent read a player belonging to a different agent'
    )
  })

  it('does not constrain an admin', async () => {
    assert.equal(await vis.maySeePlayer(asAdmin(), theirs, TENANT), true)
  })

  it('refuses an id that is not a number', async () => {
    assert.equal(await vis.maySeePlayer(asAgent(myAgent), 'not-an-id', TENANT), false)
  })
})

describe('visiblePlayerIds', () => {
  it('narrows a mixed list to what the agent may see', async () => {
    const out = await vis.visiblePlayerIds(asAgent(myAgent), [mine, theirs], TENANT)
    assert.deepEqual(out, [mine], 'the narrowing let another agent’s player through')
  })

  it('returns everything requested for an admin', async () => {
    const out = await vis.visiblePlayerIds(asAdmin(), [mine, theirs], TENANT)
    assert.deepEqual(out.sort(), [mine, theirs].sort())
  })

  it('returns empty rather than everything when nothing is visible', async () => {
    // The failure mode worth pinning: a narrowing that falls back to "no filter"
    // when the allowed set is empty would be worse than no narrowing at all.
    const out = await vis.visiblePlayerIds(asAgent(otherAgent), [mine], TENANT)
    assert.deepEqual(out, [])
  })
})
