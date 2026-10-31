/**
 * End-to-end scope checks for the agent hierarchy.
 *
 * Seeds an isolated tenant containing a three-level COMMISSION chain
 *
 *     L1 (root) -> L2 (child) -> L3 (grandchild)
 *
 * with players attached at every level, then asserts what each agent can see.
 * These are the exact shapes that were broken:
 *
 *   - a COMMISSION agent was treated as "standalone with no sub-agents"
 *   - access checks compared parent_agent_id, so depth >= 2 was invisible
 *   - player scoping resolved referrals only, missing directly assigned players
 *
 * Requires DATABASE_URL. Cleans up everything it creates.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef'

const TENANT = `itest-${randomUUID().slice(0, 8)}`

type Seeded = {
  l1: string; l2: string; l3: string
  playersL1: number[]; playersL2: number[]; playersL3: number[]
  outsiderAgent: string; outsiderPlayer: number
}

let seeded: Seeded

/** Create an agent through the real repo so closure rows are built the same way. */
async function makeAgent(repo: any, opts: { username: string; parentAgentId?: string; levelIndex: number }) {
  const row = await repo.createAgent({
    tenantId: TENANT,
    schemeType: 'COMMISSION',
    allowedDomains: ['casino'],
    currency: 'INR',
    username: opts.username,
    passwordHash: '$2a$04$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU',
    parentAgentId: opts.parentAgentId ?? null,
    levelIndex: opts.levelIndex,
  })
  return row.id as string
}

async function makePlayers(db: any, schema: any, agentId: string, count: number): Promise<number[]> {
  const ids: number[] = []
  for (let i = 0; i < count; i++) {
    const [row] = await db
      .insert(schema.users)
      .values({
        tenant: TENANT,
        name: 'Integration Player',
        username: `p_${randomUUID().slice(0, 12)}`,
        email: `${randomUUID().slice(0, 12)}@itest.local`,
        passwordHash: 'x',
        playerType: 'COMMISSION_AGENT_PLAYER',
        agentId,
      })
      .returning({ id: schema.users.id })
    ids.push(row.id)
  }
  return ids
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')

  const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
  const { db } = await import('@/db/client.js')
  const schema = await import('@shared/db/schema.js')

  const repo = new AgentsRepo()
  const tag = randomUUID().slice(0, 8)
  const l1 = await makeAgent(repo, { username: `l1_${tag}`, levelIndex: 1 })
  const l2 = await makeAgent(repo, { username: `l2_${tag}`, parentAgentId: l1, levelIndex: 2 })
  const l3 = await makeAgent(repo, { username: `l3_${tag}`, parentAgentId: l2, levelIndex: 3 })
  const outsiderAgent = await makeAgent(repo, { username: `out_${tag}`, levelIndex: 1 })

  seeded = {
    l1, l2, l3, outsiderAgent,
    playersL1: await makePlayers(db, schema, l1, 2),
    playersL2: await makePlayers(db, schema, l2, 3),
    playersL3: await makePlayers(db, schema, l3, 4),
    outsiderPlayer: (await makePlayers(db, schema, outsiderAgent, 1))[0],
  }
})

after(async () => {
  // Clean by tenant, not by the `seeded` handle: if before() throws part-way
  // the handle is never assigned and any rows already created would be orphaned.
  const { db } = await import('@/db/client.js')
  const schema = await import('@shared/db/schema.js')
  const { eq, inArray, sql } = await import('drizzle-orm')

  const agentRows = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, TENANT))
  const agentIds = agentRows.map((r) => r.id)

  await db.delete(schema.users).where(eq(schema.users.tenant, TENANT))
  if (agentIds.length > 0) {
    await db
      .delete(schema.agentHierarchyClosure)
      .where(
        sql`${inArray(schema.agentHierarchyClosure.ancestorId, agentIds)} OR ${inArray(schema.agentHierarchyClosure.descendantId, agentIds)}`
      )
  }
  await db.delete(schema.agents).where(eq(schema.agents.tenantId, TENANT))
})

describe('agent hierarchy scope (COMMISSION, 3 levels)', () => {
  it('builds closure rows spanning the whole chain, not just direct children', async () => {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const repo = new AgentsRepo()
    const fromL1 = await repo.getDescendantIds(seeded.l1)
    assert.equal(fromL1.length, 3, 'L1 subtree must contain L1, L2 and L3')
    assert.ok(fromL1.includes(seeded.l3), 'grandchild must be reachable from the root')
    const fromL3 = await repo.getDescendantIds(seeded.l3)
    assert.deepEqual(fromL3, [seeded.l3], 'a leaf has only itself')
  })

  it('resolves the whole subtree of players for the root agent', async () => {
    const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
    const ids = await new PlayerAuthService().getAgentPlayerIds(seeded.l1, TENANT)
    assert.equal(ids.length, 9, 'root sees 2 + 3 + 4 players across three levels')
  })

  it('resolves only its own subtree for a mid-level agent', async () => {
    const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
    const ids = await new PlayerAuthService().getAgentPlayerIds(seeded.l2, TENANT)
    assert.equal(ids.length, 7, 'L2 sees its own 3 plus the 4 below it')
    assert.ok(!ids.includes(seeded.playersL1[0]), 'must not see the parent players')
  })

  it('never leaks players from an unrelated hierarchy', async () => {
    const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
    const ids = await new PlayerAuthService().getAgentPlayerIds(seeded.l1, TENANT)
    assert.ok(!ids.includes(seeded.outsiderPlayer), 'players of a separate root stay invisible')
  })

  it('grants the root access to a GRANDCHILD player, not just direct children', async () => {
    const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
    const svc = new PlayerAuthService()
    assert.equal(
      await svc.canAgentAccessPlayer(seeded.l1, seeded.playersL3[0], TENANT),
      true,
      'a depth-2 descendant was previously invisible'
    )
  })

  it('denies access across separate hierarchies and upward', async () => {
    const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
    const svc = new PlayerAuthService()
    assert.equal(await svc.canAgentAccessPlayer(seeded.l1, seeded.outsiderPlayer, TENANT), false)
    assert.equal(await svc.canAgentAccessPlayer(seeded.l3, seeded.playersL1[0], TENANT), false,
      'a child must not see its parent players')
  })
})
