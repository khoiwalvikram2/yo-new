/**
 * User's VIP and agent fields on the resolvers the server serves, and setUserVipTier's reply, on fixture rows.
 *
 * B105: users/resolvers/index.ts held vipDepositAccess, vipTierName and parentAgent, but domains/index.ts wired User to
 * commonResolvers.User alone, so the player drawer's user(id) { vipDepositAccess parentAgent } came back null for a
 * player that has them (measured live: player 733 has agent a4e79769… and the Silver tier, both answered null).
 * B107: setUserVipTier returned the writer's row as it was (numeric id, status 'active'), so a reply selecting status
 * failed "Enum PlayerStatus cannot represent value: \"active\"".
 *
 * The schema is executed with the live resolver map (domains/index.ts) on the isolated QA database; every row is
 * written inside a transaction that is rolled back. Run:
 *   node --env-file-if-exists=.env --test --import tsx src/domains/users/__tests__/userFieldWiring.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql, type GraphQLObjectType } from 'graphql'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'

const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { typeDefs } = await import('../../../types/graphql.js')
const { domainResolvers } = await import('../../index.js')
const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
test.before(() => guard(pool))
test.after(async () => { await closeRedisEmitter().catch(() => {}); await pool.end() })
test.afterEach(() => mock.restoreAll())

/** The served schema for what these tests read: the live User field resolvers and the two root fields. */
function servedSchema() {
  const schema = buildSchema(typeDefs)
  const userFields = (schema.getType('User') as GraphQLObjectType).getFields()
  for (const [name, resolve] of Object.entries(domainResolvers.User as Record<string, any>)) userFields[name].resolve = resolve
  const root = (map: any, name: string) => (_: unknown, args: unknown, ctx: unknown, info: unknown) => map[name](undefined, args, ctx, info)
  schema.getQueryType()!.getFields().user.resolve = root(domainResolvers.Query, 'user')
  schema.getMutationType()!.getFields().setUserVipTier.resolve = root(domainResolvers.Mutation, 'setUserVipTier')
  return schema
}

const admin = (tenant: string, vip = true) => ({
  tenant,
  whitelabel: { id: tenant },
  user: { sub: '987651', name: 'vfyho admin', type: 'admin', roles: ['Whitelabel Admin'] },
  permissions: [
    { domain: 'players.profile', actions: ['view', 'update'] },
    ...(vip ? [{ domain: 'players.vip', actions: ['view', 'update'] }] : []),
  ],
  request: { headers: {} },
})

const DRAWER = `query($id: ID!) { user(id: $id) {
  id vipTierId vipTierName vipTierMode
  vipDepositAccess { eligible message tierId tierName mode monthlyDeposits }
  parentAgent { id username schemeType }
  access { canLogin }
} }`

async function seedTiers(tx: any, tenant: string) {
  const [bronze, silver] = await tx.insert(t.vipTiersTable).values([
    { tenant, name: 'vfyho Bronze', level: 1, minMonthlyDeposit: 0, color: '#aa7744' },
    { tenant, name: 'vfyho Silver', level: 2, minMonthlyDeposit: 100000, color: '#c0c0c0' },
  ]).returning()
  return { bronze, silver }
}

async function run(source: string, variableValues: Record<string, unknown>, contextValue: unknown) {
  const result = await graphql({ schema: servedSchema(), source, variableValues, contextValue })
  assert.equal(result.errors, undefined, result.errors?.map((e) => e.message).join('; '))
  return JSON.parse(JSON.stringify(result.data))
}

test('B105: user(id) answers vipDepositAccess, vipTierName and parentAgent for a player that has them', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = await f.agent('COMMISSION')
    const player = await f.player('COMMISSION_AGENT_PLAYER', agent)
    const own = await f.player('REGULAR')
    const { silver } = await seedTiers(tx, f.tenant)
    await tx.update(t.users).set({ vipTierId: silver.id, vipTierMode: 'MANUAL' }).where(eq(t.users.id, player.id))
    routeDbToTransaction(mock, db, tx)

    const { user } = await run(DRAWER, { id: String(player.id) }, admin(f.tenant))
    assert.equal(user.vipTierName, 'vfyho Silver')
    assert.deepEqual(user.parentAgent, { id: agent.id, username: user.parentAgent.username, schemeType: 'COMMISSION' })
    assert.ok(user.vipDepositAccess, 'vipDepositAccess answered null')
    assert.deepEqual([user.vipDepositAccess.eligible, user.vipDepositAccess.tierId, user.vipDepositAccess.tierName, user.vipDepositAccess.mode],
      [true, silver.id, 'vfyho Silver', 'MANUAL'])
    assert.equal(user.vipDepositAccess.monthlyDeposits, 0)
    assert.equal(user.access.canLogin, true, 'the common access resolver still answers')

    // A player with no agent: no parent agent, and the automatic tier.
    const direct = (await run(DRAWER, { id: String(own.id) }, admin(f.tenant))).user
    assert.equal(direct.parentAgent, null)
    assert.equal(direct.vipDepositAccess.tierName, 'vfyho Bronze')
    assert.equal(direct.vipDepositAccess.mode, 'AUTO')
    mock.restoreAll()
  })
})

test('B105: a credit player is not VIP-eligible, and an admin without the VIP read gets no deposit figures', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const creditAgent = await f.agent('CREDIT')
    const creditPlayer = await f.player('AGENT_CREDIT', creditAgent)
    const player = await f.player('REGULAR')
    await seedTiers(tx, f.tenant)
    routeDbToTransaction(mock, db, tx)

    const credit = (await run(DRAWER, { id: String(creditPlayer.id) }, admin(f.tenant))).user
    assert.equal(credit.vipDepositAccess.eligible, false)
    assert.match(credit.vipDepositAccess.message, /credit-agent/)
    assert.equal(credit.parentAgent.schemeType, 'CREDIT')

    const noVip = (await run(DRAWER, { id: String(player.id) }, admin(f.tenant, false))).user
    assert.equal(noVip.vipDepositAccess, null, 'monthly deposits served without players.vip:view')
    assert.equal(noVip.access.canLogin, true)
    mock.restoreAll()
  })
})

test("B107: setUserVipTier's reply is a User like the other user mutations' (string id, PlayerStatus, tier name)", async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const player = await f.player('REGULAR')
    const { silver } = await seedTiers(tx, f.tenant)
    routeDbToTransaction(mock, db, tx)

    const data = await run(`mutation($id: ID!, $tier: ID) { setUserVipTier(id: $id, vipTierId: $tier) {
      id status vipTierId vipTierName access { canLogin } } }`, { id: String(player.id), tier: silver.id }, admin(f.tenant))
    assert.deepEqual(data.setUserVipTier, { id: String(player.id), status: 'ACTIVE', vipTierId: silver.id, vipTierName: 'vfyho Silver', access: { canLogin: true } })
    const [saved] = await tx.select().from(t.users).where(eq(t.users.id, player.id))
    assert.deepEqual([saved.vipTierId, saved.vipTierMode], [silver.id, 'MANUAL'])

    // The resolver's own value, as other API callers receive it.
    const reply = await (domainResolvers.Mutation as any).setUserVipTier(undefined, { id: String(player.id), vipTierId: null }, admin(f.tenant), {})
    assert.equal(typeof reply.id, 'string')
    assert.equal(reply.status, 'ACTIVE')
    assert.equal(reply.tenant, f.tenant)
    mock.restoreAll()
  })
})
