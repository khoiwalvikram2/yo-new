/**
 * Who may lift an agent's restriction, end to end through the real resolvers and the audit log.
 *
 * The status guard (services/agentStatusGuard.ts) reads "who set this status" from the audit log, and three
 * things about that log went wrong:
 *
 * - updateAgent records the status on every save, changed or not. The newest such row made whoever saved the
 *   agent its "setter", so a parent could save its sub-agent once, unchanged, and then lift the suspension an
 *   admin had put on it (AGE-01).
 * - createAgent wrote no audit row at all, so a sub-agent its parent created INACTIVE had no setter, and the
 *   parent could never activate it (AGE-02, AGE-03).
 * - Admin actions were recorded as 'system' (AGE-04).
 *
 * Also here, because they need real rows: the agents search escaping LIKE wildcards and matching the short id
 * the profile shows (AGE-06, AGE-07), AgentAccount.blockedByAncestor (AGE-16), and a domain narrowing turning off
 * a tally it leaves with no domain (AGE-09).
 *
 * Requires DATABASE_URL. Its rows live in a throwaway whitelabel and are deleted afterwards, except the audit
 * rows, which are never deleted.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const RUN = Math.random().toString(36).slice(2, 8)
const TENANT = `vfyfix-agestatus-${RUN}`
const ADMIN_ID = '990001'

let db: (typeof import('@src/db/client.js'))['db']
let m: any
let AgentAccount: any
let repo: InstanceType<(typeof import('@src/repos/agents/AgentsRepo.js'))['AgentsRepo']>
let findLastStatusSetter: (typeof import('@src/domains/agents/services/agentStatusGuard.js'))['findLastStatusSetter']

const admin = () => ({
  user: { sub: ADMIN_ID, type: 'admin', roles: ['Whitelabel Admin'] },
  tenant: TENANT,
  whitelabel: { id: TENANT },
})
const asAgent = (agentId: string) => ({
  user: { sub: agentId, type: 'agent', agentId, isReadOnly: false, roles: [] },
  tenant: TENANT,
  whitelabel: { id: TENANT },
})
const sharing = (username: string, over: Record<string, unknown> = {}) => ({
  schemeType: 'SHARING',
  allowedDomains: ['sports'],
  username,
  password: 'secret123',
  currency: 'INR',
  ...over,
})
const statusOf = async (agentId: string) =>
  String(((await db.execute(sql`SELECT status FROM agents WHERE id = ${agentId}`)).rows[0] as { status: string }).status)

let parent = ''
let createdInactive = ''
let adminChild = ''
let adminInactive = ''

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
  repo = new AgentsRepo()
  ;({ findLastStatusSetter } = await import('@src/domains/agents/services/agentStatusGuard.js'))
  m = (await import('@src/domains/agents/resolvers/mutations.js')).buildAgentsMutationResolvers()
  AgentAccount = ((await import('@src/domains/index.js')).domainResolvers as Record<string, any>).AgentAccount

  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'vfyfix agent status', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)

  parent = String((await m.createAgent(null, { input: sharing(`vfyfixp${RUN}`) }, admin())).id)
  // Created INACTIVE by the parent itself (AGE-02), and two more by an admin under the same parent.
  createdInactive = String((await m.createAgent(null, { input: sharing(`vfyfix_c${RUN}`, { status: 'INACTIVE' }) }, asAgent(parent))).id)
  adminChild = String((await m.createAgent(null, { input: sharing(`vfyfixa${RUN}`, { parentAgentId: parent }) }, admin())).id)
  adminInactive = String((await m.createAgent(null, { input: sharing(`vfyfixi${RUN}`, { parentAgentId: parent, status: 'INACTIVE' }) }, admin())).id)
})

after(async () => {
  if (db) {
    await db.execute(sql`
      DELETE FROM agent_hierarchy_closure
      WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})
         OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})`)
    await db.execute(sql`DELETE FROM agent_credentials WHERE tenant_id = ${TENANT}`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${TENANT} AND parent_agent_id IS NOT NULL`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('agent creation is audited (AGE-03)', () => {
  it('writes one create_agent row per agent, under the creator, with the starting status', async () => {
    const rows = (await db.execute(sql`
      SELECT resource_id, actor_id, before, after FROM audit_logs
      WHERE tenant = ${TENANT} AND action = 'create_agent' AND resource_type = 'agent'`)).rows as Array<{ resource_id: string; actor_id: string; before: unknown; after: any }>
    const byId = new Map(rows.map((r) => [r.resource_id, r]))
    assert.equal(byId.get(parent)?.actor_id, ADMIN_ID)
    assert.equal(byId.get(createdInactive)?.actor_id, parent, 'an agent creator is recorded as itself')
    assert.equal(byId.get(createdInactive)?.after?.status, 'INACTIVE')
    assert.equal(byId.get(createdInactive)?.before, null)
    assert.equal(byId.get(adminInactive)?.actor_id, ADMIN_ID)
    assert.equal(JSON.stringify(rows).includes('secret123'), false, 'never the password')
  })
})

describe('a parent can activate a sub-agent it created INACTIVE (AGE-02)', () => {
  it('lifts its own starting status', async () => {
    await m.updateAgentStatus(null, { agentId: createdInactive, status: 'ACTIVE' }, asAgent(parent))
    assert.equal(await statusOf(createdInactive), 'ACTIVE')
  })

  it('but not one an admin created INACTIVE under it', async () => {
    await assert.rejects(
      m.updateAgentStatus(null, { agentId: adminInactive, status: 'ACTIVE' }, asAgent(parent)),
      /restricted by an admin or a higher-level agent/
    )
    assert.equal(await statusOf(adminInactive), 'INACTIVE')
  })
})

describe("an admin's suspension stays the admin's to lift (AGE-01, AGE-04)", () => {
  it('records the suspension under the admin, not system', async () => {
    await m.updateAgentStatus(null, { agentId: adminChild, status: 'SUSPENDED' }, admin())
    assert.deepEqual(await findLastStatusSetter(adminChild), { actorId: ADMIN_ID, status: 'SUSPENDED' })
  })

  it('the parent cannot lift it directly', async () => {
    await assert.rejects(
      m.updateAgentStatus(null, { agentId: adminChild, status: 'ACTIVE' }, asAgent(parent)),
      /restricted by an admin or a higher-level agent/
    )
  })

  it('nor after saving the sub-agent unchanged first', async () => {
    // What the edit page sends for an agent caller: the domains and the (unchanged) status.
    await m.updateAgent(null, { input: { id: adminChild, allowedDomains: ['sports'], status: 'SUSPENDED' } }, asAgent(parent))
    assert.deepEqual(await findLastStatusSetter(adminChild), { actorId: ADMIN_ID, status: 'SUSPENDED' }, 'an unchanged save sets nothing')
    await assert.rejects(
      m.updateAgentStatus(null, { agentId: adminChild, status: 'ACTIVE' }, asAgent(parent)),
      /restricted by an admin or a higher-level agent/
    )
    assert.equal(await statusOf(adminChild), 'SUSPENDED')
  })

  it('the admin lifts it', async () => {
    await m.updateAgentStatus(null, { agentId: adminChild, status: 'ACTIVE' }, admin())
    assert.equal(await statusOf(adminChild), 'ACTIVE')
  })

  it("a restriction the parent set itself is still the parent's to lift, after an admin's unchanged save", async () => {
    await m.updateAgentStatus(null, { agentId: adminChild, status: 'INACTIVE' }, asAgent(parent))
    await m.updateAgent(null, { input: { id: adminChild, allowedDomains: ['sports'], status: 'INACTIVE' } }, admin())
    await m.updateAgentStatus(null, { agentId: adminChild, status: 'ACTIVE' }, asAgent(parent))
    assert.equal(await statusOf(adminChild), 'ACTIVE')
  })
})

describe('agents search (AGE-06, AGE-07)', () => {
  const ids = async (query: string) => (await repo.list(TENANT, { query })).map((a: { id: string }) => String(a.id)).sort()

  it("'_' and '%' match themselves, not every agent", async () => {
    assert.deepEqual(await ids('_'), [createdInactive], "only the one username with an underscore")
    assert.deepEqual(await ids('%'), [])
    assert.equal(await repo.count(TENANT, { query: '_' }), 1, 'the count agrees with the list')
    assert.equal(await repo.count(TENANT, { query: '%' }), 0)
  })

  it('finds an agent by the 8-character id its profile shows, in either case, and by the full id', async () => {
    assert.deepEqual(await ids(parent.slice(0, 8)), [parent])
    assert.deepEqual(await ids(parent.slice(0, 8).toUpperCase()), [parent])
    assert.deepEqual(await ids(parent), [parent])
    assert.equal(await repo.count(TENANT, { query: parent.slice(0, 8) }), 1)
  })

  it('still finds by username', async () => {
    assert.deepEqual(await ids(`vfyfixa${RUN}`), [adminChild])
  })
})

describe('AgentAccount.blockedByAncestor (AGE-16)', () => {
  it('is null while every ancestor is ACTIVE, and names a suspended parent', async () => {
    const child = await repo.findById(adminChild)
    assert.equal(await AgentAccount.blockedByAncestor(child, {}, admin()), null)
    await m.updateAgentStatus(null, { agentId: parent, status: 'SUSPENDED' }, admin())
    try {
      const block = await AgentAccount.blockedByAncestor(child, {}, admin())
      assert.deepEqual(block, { id: parent, username: `vfyfixp${RUN}`, status: 'SUSPENDED' })
      // An agent outside that branch is not told about it; the parent itself is (it is its own subtree).
      assert.equal(await AgentAccount.blockedByAncestor(child, {}, asAgent(createdInactive)), null)
      assert.equal((await AgentAccount.blockedByAncestor(child, {}, asAgent(parent)))?.id, parent)
    } finally {
      await m.updateAgentStatus(null, { agentId: parent, status: 'ACTIVE' }, admin())
    }
    assert.equal(await AgentAccount.blockedByAncestor(child, {}, admin()), null)
  })
})

describe('a narrowing that takes the last tally domain turns the tally off (AGE-09)', () => {
  it('turns off a sub-agent left with nothing to tally, keeps a tally with a domain left, and leaves an empty one alone', async () => {
    const commission = (username: string, tallyDomains: string[], over: Record<string, unknown> = {}) => ({
      schemeType: 'COMMISSION', allowedDomains: ['sports', 'casino'], username, password: 'secret123', currency: 'INR',
      tallyEnabled: true, tallyDomains, ...over,
    })
    const root = String((await m.createAgent(null, { input: commission(`vfyfixt${RUN}`, ['sports', 'casino']) }, admin())).id)
    const casinoOnly = String((await m.createAgent(null, { input: commission(`vfyfixtc${RUN}`, ['casino'], { parentAgentId: root }) }, admin())).id)
    const both = String((await m.createAgent(null, { input: commission(`vfyfixtb${RUN}`, ['sports', 'casino'], { parentAgentId: root }) }, admin())).id)
    // A flag already on over an empty list (the rows awaiting the owner's decision): not this narrowing's to change.
    const legacy = String((await m.createAgent(null, { input: commission(`vfyfixtl${RUN}`, ['sports'], { parentAgentId: root }) }, admin())).id)
    await db.execute(sql`UPDATE agents SET tally_enabled = true, tally_domains = '{}' WHERE id = ${legacy}`)

    // The admin narrows the root to sports with no tally input: casino leaves the whole subtree.
    await m.updateAgent(null, { input: { id: root, allowedDomains: ['sports'] } }, admin())

    const rows = (await db.execute(sql`
      SELECT id, allowed_domains, tally_enabled, tally_domains FROM agents WHERE id IN (${root}, ${casinoOnly}, ${both}, ${legacy})`))
      .rows as Array<{ id: string; allowed_domains: string[]; tally_enabled: boolean; tally_domains: string[] | null }>
    const byId = new Map(rows.map((r) => [String(r.id), r]))
    assert.deepEqual(byId.get(casinoOnly), { id: casinoOnly, allowed_domains: ['sports'], tally_enabled: false, tally_domains: [] }, 'its only tally domain is gone')
    assert.deepEqual(byId.get(both), { id: both, allowed_domains: ['sports'], tally_enabled: true, tally_domains: ['sports'] })
    assert.deepEqual(byId.get(root), { id: root, allowed_domains: ['sports'], tally_enabled: true, tally_domains: ['sports'] })
    assert.deepEqual(byId.get(legacy), { id: legacy, allowed_domains: ['sports'], tally_enabled: true, tally_domains: [] })
  })
})
