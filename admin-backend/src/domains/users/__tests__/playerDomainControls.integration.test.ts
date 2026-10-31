import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, types, domains, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { usersMutationResolvers } = await import('../resolvers/mutations.js')
const { deriveAgentPermissions } = await import('../../agents/services/AgentPermissionsService.js')
const { buildAgentsMutationResolvers } = await import('../../agents/resolvers/mutations.js')
const { loadPlayerDomains } = await import('@shared/access/playerDomains.js')
const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
test.before(() => guard(pool))
test.after(async () => { await closeRedisEmitter(); await pool.end() })
test.afterEach(() => mock.restoreAll())
const admin = (tenant: string) => ({ tenant, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }] })
const agentCtx = (tenant: string, agent: any, readOnly = false) => ({ tenant, user: { type: 'agent', agentId: agent.id, sub: agent.id, isReadOnly: readOnly }, permissions: deriveAgentPermissions(agent.allowedDomains) })
const call = (ctx: any, id: number, flags: any) => usersMutationResolvers.setUserDomainBets(null, { id: String(id), ...flags }, ctx)

for (const type of types) test(`admin can persist all six controls for ${type}, with other fields preserved`, async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined, player = await f.player(type, owner)
    routeDbToTransaction(mock, db, tx)
    for (const domain of domains) for (const flag of [domain, `${domain}Visible`]) {
      const key = flag === domain ? `${domain}BetAllowed` : flag
      for (const value of [false, true]) {
        const result = await call(admin(f.tenant), player.id, { [flag]: value })
        assert.equal(result.success, true); assert.equal(result.user[key], value)
        const [saved] = await tx.select().from(t.users).where(eq(t.users.id, player.id))
        assert.equal(saved[key], value); assert.equal(saved.playerType, type); assert.equal(saved.status, 'active')
      }
    }
    mock.restoreAll()
  })
})

for (const scheme of ['CREDIT', 'SHARING', 'COMMISSION']) test(`${scheme} agents can update own, child and referred players; scope, parent caps and read-only are enforced`, async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), root = await f.agent(scheme), child = await f.agent(scheme, root), stranger = await f.agent(scheme)
    const type = scheme === 'CREDIT' ? 'AGENT_CREDIT' : scheme === 'SHARING' ? 'SHARING_AGENT_PLAYER' : 'COMMISSION_AGENT_PLAYER'
    const own = await f.player(type, root), sub = await f.player(type, child), referred = await f.player(), outside = await f.player(type, stranger)
    await tx.insert(t.referralAttributions).values({ tenant: f.tenant, referrerId: sub.id, refereeId: referred.id, status: 'confirmed' })
    routeDbToTransaction(mock, db, tx)
    for (const player of [own, sub, referred]) for (const domain of domains) {
      for (const value of [false, true]) assert.equal((await call(agentCtx(f.tenant, root), player.id, { [domain]: value, [`${domain}Visible`]: value })).success, true)
    }
    await assert.rejects(call(agentCtx(f.tenant, root), outside.id, { matkaVisible: false }), /Unauthorized/)
    await assert.rejects(call(agentCtx(f.tenant, root, true), own.id, { sportsVisible: false }), /inactive/i)
    for (const domain of domains) {
      await tx.update(t.agents).set({ allowedDomains: domains.filter(d => d !== domain) }).where(eq(t.agents.id, root.id))
      await assert.rejects(call(admin(f.tenant), sub.id, { [`${domain}Visible`]: true }), /owning agent branch/)
      assert.equal((await call(admin(f.tenant), sub.id, { [`${domain}Visible`]: false })).success, true)
    }
    mock.restoreAll()
  })
})

test('invalid input, missing update permissions and other tenants never change a player', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), player = await f.player()
    routeDbToTransaction(mock, db, tx)
    await assert.rejects(call({ ...admin(f.tenant), permissions: [] }, player.id, { casinoVisible: false }))
    await assert.rejects(call(admin(f.tenant + '-foreign'), player.id, { matkaVisible: false }), /not found/)
    await assert.rejects(call(admin(f.tenant), player.id, {}), /Choose/)
    await assert.rejects(call(admin(f.tenant), -1, { sports: false }), /Invalid id/)
    const [saved] = await tx.select().from(t.users).where(eq(t.users.id, player.id))
    assert.ok(saved.matkaVisible && saved.casinoVisible && saved.sportsBetAllowed)
    mock.restoreAll()
  })
})

for (const scheme of ['CREDIT', 'SHARING', 'COMMISSION']) test(`${scheme}: real agent update can disable every domain across its branch and re-enable within parent caps`, async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), root = await f.agent(scheme), child = await f.agent(scheme, root), own = await f.player('REGULAR', root), sub = await f.player('REGULAR', child)
    routeDbToTransaction(mock, db, tx)
    const mutations = buildAgentsMutationResolvers()
    await mutations.updateAgent(null, { input: { id: root.id, allowedDomains: [] } }, admin(f.tenant))
    for (const player of [own, sub]) for (const domain of domains) assert.equal((await loadPlayerDomains(tx, f.tenant, player.id))[domain].visible, false)
    assert.deepEqual((await tx.select().from(t.agents).where(eq(t.agents.id, child.id)))[0].allowedDomains, [])
    await mutations.updateAgent(null, { input: { id: root.id, allowedDomains: [...domains] } }, admin(f.tenant))
    for (const domain of domains) assert.equal((await loadPlayerDomains(tx, f.tenant, own.id))[domain].visible, true)
    // Re-enabling a parent does not silently grant permissions back to a child.
    assert.equal((await loadPlayerDomains(tx, f.tenant, sub.id)).sports.visible, false)
    await mutations.updateAgent(null, { input: { id: child.id, allowedDomains: [...domains] } }, admin(f.tenant))
    for (const domain of domains) assert.equal((await loadPlayerDomains(tx, f.tenant, sub.id))[domain].visible, true)
    mock.restoreAll()
  })
})
