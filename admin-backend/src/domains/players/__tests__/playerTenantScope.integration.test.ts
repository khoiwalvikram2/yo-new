/**
 * Admin player mutations stay inside the caller's tenant, and bonuses respect the player's type and eligibility,
 * through the real resolvers on the isolated QA database (tmp/domain-visibility-integration-fixtures.ts). Every
 * test runs in a transaction that is rolled back, audit rows included.
 *
 *   - another tenant's player: refused with "not found", no PII in the reply, no row or audit entry written, the
 *     foreign row unchanged (players/PLA-01); same-tenant calls keep working;
 *   - grantSpecialBonus refuses another tenant's player and an id that names nobody (PLA-08), a credit player
 *     and a player whose bonus eligibility is off (PLA-07), and still issues a card to an eligible player;
 *   - both limit mutations refuse negative figures (PLA-19);
 *   - terminatePlayerSessions no longer reports sessions it never ended (PLA-21);
 *   - the profile says only an active player can log in, as the player API enforces (PLA-09).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/players/__tests__/playerTenantScope.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { and } from 'drizzle-orm'
import { buildSchema, graphql, type GraphQLObjectType } from 'graphql'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { usersMutationResolvers } = await import('../../users/resolvers/mutations.js')
const { playersMutationResolvers } = await import('../resolvers/mutations.js')
const { playersQueryResolvers } = await import('../resolvers/queries.js')
const { commonResolvers } = await import('../../common/resolvers/index.js')
const { referralsQueryResolvers } = await import('../../referrals/resolvers/queries.js')
const { typeDefs } = await import('../../../types/graphql.js')
const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
test.before(() => guard(pool))
test.after(async () => { await closeRedisEmitter(); await pool.end() })
test.afterEach(() => mock.restoreAll())

const admin = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }] })
const users = usersMutationResolvers as any
const players = playersMutationResolvers as any
/** The resolvers write some audit rows without awaiting them: let those land on the test transaction first. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))
const auditRowsFor = (tx: any, tenant: string, playerId: number) =>
  tx.select().from(t.auditLogs).where(and(eq(t.auditLogs.tenant, tenant), eq(t.auditLogs.resourceId, String(playerId))))

test("another tenant's player is refused by every player mutation, with nothing written and nothing about the player returned", async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), other = await fixture(tx)
    const foreign = await other.player()
    const [before] = await tx.select().from(t.users).where(eq(t.users.id, foreign.id))
    routeDbToTransaction(mock, db, tx)
    const ctx = admin(f.tenant), id = String(foreign.id)

    const refusals: Array<[string, () => Promise<unknown>, string]> = [
      ['setUserStatus', () => users.setUserStatus(null, { id, status: 'ACTIVE' }, ctx), 'User not found'],
      ['setUserBonusAllowed', () => users.setUserBonusAllowed(null, { id, allow: false }, ctx), 'User not found'],
      ['forceLogoutUser', () => users.forceLogoutUser(null, { id }, ctx), 'User not found'],
      ['upsertPlayerLimits', () => users.upsertPlayerLimits(null, { input: { userId: id, dailyStakeLimit: 7 } }, ctx), 'Player not found'],
      ['setPlayerLimits', () => players.setPlayerLimits(null, { input: { playerId: id, dailyStakeLimit: 7 } }, ctx), 'Player not found'],
      ['terminatePlayerSessions', () => players.terminatePlayerSessions(null, { input: { playerId: id, allSessions: true } }, ctx), 'Player not found'],
      ['suspendPlayer', () => players.suspendPlayer(null, { playerId: id, reason: 'vfyfix' }, ctx), 'Player not found'],
      ['blockPlayer', () => players.blockPlayer(null, { playerId: id, reason: 'vfyfix' }, ctx), 'Player not found'],
      ['unblockPlayer', () => players.unblockPlayer(null, { playerId: id, reason: 'vfyfix' }, ctx), 'Player not found'],
      ['lockPlayerAccount', () => players.lockPlayerAccount(null, { playerId: id, reason: 'vfyfix' }, ctx), 'Player not found'],
    ]
    for (const [name, call, message] of refusals) {
      await assert.rejects(call(), (err: any) => {
        assert.equal(err?.message, message, `${name} refuses with "${message}"`)
        return true
      })
    }
    await settle()
    const [after] = await tx.select().from(t.users).where(eq(t.users.id, foreign.id))
    assert.deepEqual([after.status, after.bonusAllowed, after.tokenVersion], [before.status, before.bonusAllowed, before.tokenVersion], 'the foreign row is unchanged')
    assert.equal((await tx.select().from(t.playerLimits).where(eq(t.playerLimits.userId, foreign.id))).length, 0, 'no limits row was written for it')
    assert.equal((await auditRowsFor(tx, f.tenant, foreign.id)).length, 0, "no audit row in the caller's tenant names it")
    mock.restoreAll()
  })
})

test('the same mutations keep working on a player of the caller tenant', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), mine = await f.player()
    routeDbToTransaction(mock, db, tx)
    const ctx = admin(f.tenant), id = String(mine.id)
    const status = await users.setUserStatus(null, { id, status: 'INACTIVE' }, ctx)
    assert.equal(status.success, true); assert.equal(status.user.name, 'Isolated visibility fixture')
    assert.equal((await users.setUserBonusAllowed(null, { id, allow: false }, ctx)).success, true)
    assert.equal((await users.forceLogoutUser(null, { id }, ctx)).success, true)
    assert.equal((await users.upsertPlayerLimits(null, { input: { userId: id, dailyStakeLimit: 7, cooldownSeconds: 0 } }, ctx)).success, true)
    assert.equal((await players.suspendPlayer(null, { playerId: id, reason: 'vfyfix' }, ctx)).success, true)
    assert.equal((await players.unblockPlayer(null, { playerId: id, reason: 'vfyfix' }, ctx)).success, true)
    const [saved] = await tx.select().from(t.users).where(eq(t.users.id, mine.id))
    assert.deepEqual([saved.status, saved.bonusAllowed], ['active', false])
    await settle()
    // The admin is named on the audit rows (it used to be recorded as "system").
    const audits = await auditRowsFor(tx, f.tenant, mine.id)
    assert.ok(audits.length >= 5, `audit rows were written (${audits.length})`)
    assert.deepEqual([...new Set(audits.map((a: any) => a.actorId))], ['1'])
    mock.restoreAll()
  })
})

test('grantSpecialBonus: refused for another tenant, a missing id, a credit player and a bonus-ineligible player; issued to an eligible one', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), other = await fixture(tx)
    const [campaign] = await tx.insert(t.bonusCampaigns).values({ tenant: f.tenant, name: 'vfyfix special', type: 'special', status: 'active' }).returning()
    const regular = await f.player('REGULAR'), credit = await f.player('WHITELABEL_CREDIT'), ineligible = await f.player('REGULAR'), foreign = await other.player()
    await f.flags(ineligible.id, { bonusAllowed: false })
    routeDbToTransaction(mock, db, tx)
    const grant = (playerId: number) => players.grantSpecialBonus(null, { input: { playerId: String(playerId), campaignId: String(campaign.id), amount: 1 } }, admin(f.tenant))

    await assert.rejects(grant(foreign.id), { message: 'Player not found' })
    await assert.rejects(grant(987654321), { message: 'Player not found' })
    await assert.rejects(grant(credit.id), { message: 'Credit players cannot receive bonuses: their chips move only through Deposit / Withdraw' })
    await assert.rejects(grant(ineligible.id), { message: "This player's bonus eligibility is off" })
    const awarded = await grant(regular.id)
    assert.equal(awarded.success, true)
    const awards = await tx.select().from(t.bonusAwards).where(eq(t.bonusAwards.campaignId, campaign.id))
    assert.deepEqual(awards.map((a: any) => a.userId), [regular.id], 'only the eligible player got a card')
    mock.restoreAll()
  })
})

test('both limit mutations refuse negative figures', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), mine = await f.player()
    routeDbToTransaction(mock, db, tx)
    const ctx = admin(f.tenant), id = String(mine.id)
    await assert.rejects(users.upsertPlayerLimits(null, { input: { userId: id, dailyStakeLimit: -5, maxBetSports: -1, cooldownSeconds: -10 } }, ctx), /Limits cannot be negative/)
    await assert.rejects(players.setPlayerLimits(null, { input: { playerId: id, dailyStakeLimit: -6, weeklyStakeLimit: -7 } }, ctx), /Limits cannot be negative/)
    assert.equal((await tx.select().from(t.playerLimits).where(eq(t.playerLimits.userId, mine.id))).length, 0)
    mock.restoreAll()
  })
})

test('terminatePlayerSessions no longer reports sessions it never ended', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), mine = await f.player()
    const [before] = await tx.select().from(t.users).where(eq(t.users.id, mine.id))
    routeDbToTransaction(mock, db, tx)
    await assert.rejects(players.terminatePlayerSessions(null, { input: { playerId: String(mine.id), allSessions: true } }, admin(f.tenant)), /Sessions are not tracked/)
    const [after] = await tx.select().from(t.users).where(eq(t.users.id, mine.id))
    assert.equal(after.tokenVersion, before.tokenVersion)
    await settle()
    assert.equal((await auditRowsFor(tx, f.tenant, mine.id)).length, 0, 'no "terminate_sessions" audit row')
    mock.restoreAll()
  })
})

test('the profile reports login as allowed for an active player only, as the player API enforces', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), mine = await f.player()
    routeDbToTransaction(mock, db, tx)
    const canLogin = async (status: 'active' | 'inactive' | 'suspended') => {
      await tx.update(t.users).set({ status }).where(eq(t.users.id, mine.id))
      const profile = await (playersQueryResolvers as any).playerProfile(null, { id: String(mine.id) }, admin(f.tenant))
      return profile.access.canLogin
    }
    assert.equal(await canLogin('active'), true)
    assert.equal(await canLogin('inactive'), false, 'an inactive player is refused at login ("Account is not active")')
    assert.equal(await canLogin('suspended'), false)
    mock.restoreAll()
  })
})

// User.access had no live resolver (domains/index.ts wires commonResolvers.User), so selecting user { access } on
// setUserStatus's reply failed with "Cannot return null for non-nullable field User.access".
test("setUserStatus's user reports the profile's access, for every status", async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), mine = await f.player()
    await f.flags(mine.id, { withdrawalLock: true, casinoBetAllowed: false, matkaVisible: false })
    routeDbToTransaction(mock, db, tx)
    const ctx = admin(f.tenant), id = String(mine.id), access = (commonResolvers.User as any).access
    for (const status of ['INACTIVE', 'SUSPENDED', 'ACTIVE'] as const) {
      const reply = await users.setUserStatus(null, { id, status }, ctx)
      const profile = await (playersQueryResolvers as any).playerProfile(null, { id }, ctx)
      assert.deepEqual(access(reply.user), profile.access, `${status}: User.access and PlayerProfile.access agree`)
      assert.equal(access(reply.user).canLogin, status === 'ACTIVE', `${status}: only an active player may log in`)
    }
    const active = (await users.setUserStatus(null, { id, status: 'ACTIVE' }, ctx)).user
    assert.equal(active.withdrawalLock, true, 'the reply states the real withdrawal lock (it said false)')
    assert.deepEqual(access(active), {
      canLogin: true, canDeposit: true, canWithdraw: false, bonusEligible: true,
      sports: { visible: true, canBet: true }, casino: { visible: true, canBet: false }, matka: { visible: false, canBet: true },
    }, "an active player's own switches: withdrawal lock, casino betting off, matka hidden")
    // The other player-control writers answer a User from the same row.
    const noBonus = (await users.setUserBonusAllowed(null, { id, allow: false }, ctx)).user
    assert.equal(noBonus.withdrawalLock, true)
    assert.deepEqual(access(noBonus), (await (playersQueryResolvers as any).playerProfile(null, { id }, ctx)).access)
    assert.deepEqual([access(noBonus).bonusEligible, access(noBonus).canWithdraw], [false, false])
    await settle()
    mock.restoreAll()
  })
})

// E102: referralReferees rows carry no status or switches, so User.access said an active referee could not log in,
// deposit or withdraw. The missing fields are read by id, once for the whole list, in the caller's tenant.
test("referralReferees rows answer the profile's access, read once for the list and in the caller's tenant only", async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx), other = await fixture(tx)
    const referrer = await f.player(), active = await f.player(), inactive = await f.player(), locked = await f.player(), foreign = await other.player()
    await f.flags(inactive.id, { status: 'inactive' })
    await f.flags(locked.id, { withdrawalLock: true, bonusAllowed: false, casinoBetAllowed: false, matkaVisible: false })
    for (const referee of [active, inactive, locked]) await tx.insert(t.referralAttributions).values({ tenant: f.tenant, referrerId: referrer.id, refereeId: referee.id })
    routeDbToTransaction(mock, db, tx)
    // The real referralReferees resolver and the User field resolvers the server uses (commonResolvers.User).
    const schema = buildSchema(typeDefs)
    const userFields = (schema.getType('User') as GraphQLObjectType).getFields()
    for (const [name, resolve] of Object.entries(commonResolvers.User as Record<string, any>)) userFields[name].resolve = resolve
    ;(schema.getType('Query') as GraphQLObjectType).getFields().referralReferees.resolve = (_: unknown, args: unknown, ctx: any) => referralsQueryResolvers.referralReferees(null, args, ctx)
    const ACCESS = 'access { canLogin canDeposit canWithdraw bonusEligible sports { visible canBet } casino { visible canBet } matka { visible canBet } }'
    const selects = (db.select as any).mock.callCount()
    const result = await graphql({ schema, contextValue: admin(f.tenant), variableValues: { id: String(referrer.id) },
      source: `query($id: ID!) { referralReferees(referrerId: $id) { id username ${ACCESS} } }` })
    assert.equal(result.errors, undefined, result.errors?.map((e) => e.message).join('; '))
    assert.equal((db.select as any).mock.callCount() - selects, 3, 'the attributions, the referees, and one read of their access fields')
    const rows = JSON.parse(JSON.stringify(result.data)).referralReferees as Array<{ id: string; access: any }>
    assert.deepEqual(rows.map((row) => row.id).sort(), [active.id, inactive.id, locked.id].map(String).sort())
    for (const row of rows) {
      const profile = await (playersQueryResolvers as any).playerProfile(null, { id: row.id }, admin(f.tenant))
      assert.deepEqual(row.access, JSON.parse(JSON.stringify(profile.access)), `referee ${row.id}: User.access and PlayerProfile.access agree`)
    }
    const byId = new Map(rows.map((row) => [row.id, row.access]))
    assert.deepEqual([byId.get(String(active.id)).canLogin, byId.get(String(active.id)).canDeposit, byId.get(String(active.id)).canWithdraw], [true, true, true],
      'an active referee may log in, deposit and withdraw (all three read false)')
    assert.equal(byId.get(String(inactive.id)).canLogin, false)
    assert.deepEqual([byId.get(String(locked.id)).canWithdraw, byId.get(String(locked.id)).bonusEligible, byId.get(String(locked.id)).casino.canBet,
      byId.get(String(locked.id)).matka.visible], [false, false, false, false], "the referee's own lock and switches")
    // A row naming another whitelabel's player is read in the caller's whitelabel only: nothing is granted there.
    const access = (commonResolvers.User as any).access
    assert.equal((await access({ id: String(foreign.id), name: 'x' }, {}, admin(f.tenant))).canLogin, false)
    assert.equal((await access({ id: String(foreign.id), name: 'x' }, {}, admin(other.tenant))).canLogin, true, 'its own whitelabel reads it')
    mock.restoreAll()
  })
})
