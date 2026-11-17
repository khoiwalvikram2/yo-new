/**
 * A Whitelabel Admin assigns and revokes roles only for users of its own tenant (SCO-06).
 *
 * Measured before: kondareddi's admin called assignRoleToAdmin on a grandwinn support admin and was told "Role
 * assigned successfully" while a user_roles row {target, kondareddi role, kondareddi-com} was inserted;
 * revokeRoleFromAdmin on the target's grandwinn role answered "Role revoked successfully" while nothing changed,
 * and both were audited in kondareddi as if they had happened.
 *
 * Driven through the real guarded Mutation map. Two throwaway `vfyfix-` tenants with their users and roles are
 * created and removed (audit rows are left alone). Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const T = `vfyfix-rbac-${STAMP}`
const U = `vfyfix-rbac-u-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any> = {}
const ids = { operator: 0, ownSupport: 0, foreignSupport: 0, roleT: 0, roleU: 0, player: 0 }

const at = (fieldName: string) => ({ parentType: { name: 'Mutation' }, fieldName })
const run = (name: string, userId: number, roleId: number) =>
  Mutation[name](undefined, { input: { userId: String(userId), roleId: String(roleId) } }, operator(), at(name))

/** T's Whitelabel Admin on the Support Admins page. */
const operator = () => ({
  user: { sub: String(ids.operator), name: 'vfyfix wl', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [
    { domain: 'security.roles', actions: ['assign'] },
    { domain: 'security.support-admins', actions: ['create', 'update'] },
  ],
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
})

const insertUser = async (tenant: string, label: string) =>
  Number(((await db.execute(sql`INSERT INTO users (tenant, name, password_hash) VALUES (${tenant}, ${'vfyfix ' + label}, 'x') RETURNING id`)).rows[0] as any).id)
const insertRole = async (tenant: string, name: string) =>
  Number(((await db.execute(sql`INSERT INTO roles (tenant, name) VALUES (${tenant}, ${name}) RETURNING id`)).rows[0] as any).id)
const holds = async (userId: number, roleId: number, tenant: string) =>
  ((await db.execute(sql`SELECT 1 FROM user_roles WHERE user_id = ${userId} AND role_id = ${roleId} AND tenant = ${tenant}`)).rows.length > 0)

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  Mutation = (domainResolvers as any).Mutation

  ids.operator = await insertUser(T, 'wl admin')
  ids.ownSupport = await insertUser(T, 'own support')
  ids.foreignSupport = await insertUser(U, 'foreign support')
  ids.roleT = await insertRole(T, 'vfyfix viewer')
  ids.roleU = await insertRole(U, 'vfyfix viewer')
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${U}, ${ids.foreignSupport}, ${ids.roleU})`)
  // A player of T: no role, and the wallet every player is created with.
  ids.player = await insertUser(T, 'player')
  await db.execute(sql`INSERT INTO wallets (tenant, user_id) VALUES (${T}, ${ids.player})`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM wallets WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM user_roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${T}, ${U})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

describe("another tenant's admin is not found", () => {
  it('assignRoleToAdmin refuses it and inserts nothing', async () => {
    const out = await run('assignRoleToAdmin', ids.foreignSupport, ids.roleT)
    assert.equal(out.success, false)
    assert.equal(out.message, 'User not found')
    assert.equal(await holds(ids.foreignSupport, ids.roleT, T), false, 'a role row was written for a user of another tenant')
  })

  it('revokeRoleFromAdmin refuses it rather than reporting a revoke that did not happen', async () => {
    const out = await run('revokeRoleFromAdmin', ids.foreignSupport, ids.roleU)
    assert.equal(out.success, false)
    assert.equal(out.message, 'User not found')
    assert.equal(await holds(ids.foreignSupport, ids.roleU, U), true)
  })
})

describe("the tenant's own admins are unaffected", () => {
  it('assigns and revokes a role for its own support admin', async () => {
    const assigned = await run('assignRoleToAdmin', ids.ownSupport, ids.roleT)
    assert.equal(assigned.success, true, assigned.message)
    assert.equal(await holds(ids.ownSupport, ids.roleT, T), true)

    const revoked = await run('revokeRoleFromAdmin', ids.ownSupport, ids.roleT)
    assert.equal(revoked.success, true, revoked.message)
    assert.equal(await holds(ids.ownSupport, ids.roleT, T), false)
  })

  it('gives a role back to an admin whose roles were all revoked (it is staff, not a player)', async () => {
    const again = await run('assignRoleToAdmin', ids.ownSupport, ids.roleT)
    assert.equal(again.success, true, again.message)
    assert.equal(await holds(ids.ownSupport, ids.roleT, T), true)
    await run('revokeRoleFromAdmin', ids.ownSupport, ids.roleT)
  })
})

// T079: the target is in the tenant, but the answer still has to be true.
describe('within the tenant, a role goes only to staff and a revoke only reports what it removed', () => {
  it("refuses to make a player staff: the player's own credentials would open this panel", async () => {
    const out = await run('assignRoleToAdmin', ids.player, ids.roleT)
    assert.equal(out.success, false)
    assert.match(out.message, /player, not a support admin/)
    assert.equal(await holds(ids.player, ids.roleT, T), false, 'a player was given a role')
  })

  it('does not report a revoke of a role the user does not hold', async () => {
    assert.equal(await holds(ids.ownSupport, ids.roleT, T), false)
    const out = await run('revokeRoleFromAdmin', ids.ownSupport, ids.roleT)
    assert.equal(out.success, false)
    assert.equal(out.message, 'That user does not hold this role')
  })
})

// SYS-07 / T019: the player lists exclude staff by this list. It kept only roles NAMED like '%admin%', so a support
// admin in a role such as "vfyfix viewer" (or "SPORT BUILDER") counted as a player.
describe('the staff list the player lists exclude', () => {
  it('names every role holder of the tenant, whatever the role is called, and no player', async () => {
    const { getAdminUserIds } = await import('@src/repos/rbac/rbacRepo.js')
    assert.equal((await run('assignRoleToAdmin', ids.ownSupport, ids.roleT)).success, true)
    try {
      const staff = await getAdminUserIds(T)
      assert.ok(staff.includes(ids.ownSupport), 'a support admin whose role name lacks "admin" was left among the players')
      assert.ok(!staff.includes(ids.player))
      assert.ok(!staff.includes(ids.foreignSupport), "another tenant's staff is not this tenant's")
    } finally {
      await run('revokeRoleFromAdmin', ids.ownSupport, ids.roleT)
    }
  })
})
