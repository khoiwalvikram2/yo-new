/**
 * Which kind of account an audited "user" is (SYS-14 residual).
 *
 * Staff and players share the users table, and the users.security rows of setUserStatus, setRequirePasswordReset,
 * forceLogoutUser and the admin sign-in looked the same for both: the Audit Trail's "View Resource" could not tell
 * a support admin (Support Admins) from a player (the player profile), and the admin sign-in, which looks accounts
 * up across tenants, can name a player's account. New rows record after.accountKind, 'admin' or 'player'.
 *
 * Driven through the real resolvers on a throwaway `vfyho-` tenant. Its users, roles and wallets are removed
 * afterwards; its audit rows are left alone (audit rows are never deleted). Requires DATABASE_URL.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/users/__tests__/auditAccountKind.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const TENANT = `vfyho-acct-${STAMP}`
const PASSWORD = 'Vfyho-Passw0rd!'
const emailOf = (label: string) => `vfyho-${label}-${STAMP}@example.invalid`

let db: (typeof import('@src/db/client.js'))['db']
let users: any
const ids = { operator: 0, admin: 0, exAdmin: 0, player: 0 }

/** The whitelabel admin working Support Admins or a player's profile. */
const operator = () => ({
  user: { sub: String(ids.operator), name: 'vfyho operator', roles: ['vfyho support'], type: 'admin' },
  permissions: [
    { domain: 'players.profile', actions: ['update'] },
    { domain: 'players.sessions', actions: ['delete'] },
  ],
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
})
const signIn = (email: string, password: string) =>
  users.login(null, { input: { email, password } }, { tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: { 'x-forwarded-for': '203.0.113.7' } } })

type AuditData = Record<string, unknown> | null
/** The newest users.security row of `action` naming the account (the account actions write theirs without waiting). */
async function auditRow(action: string, id: number): Promise<{ before: AuditData; after: AuditData } | null> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = await db.execute(sql`
      SELECT before, after FROM audit_logs
      WHERE tenant = ${TENANT} AND domain = 'users.security' AND action = ${action} AND resource_id = ${String(id)}
      ORDER BY id DESC LIMIT 1`)
    if (r.rows.length) return r.rows[0] as { before: AuditData; after: AuditData }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}
const auditAfter = async (action: string, id: number) => (await auditRow(action, id))?.after ?? null

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const auth = await import('@src/domains/common/auth.js')
  ;({ usersMutationResolvers: users } = await import('@src/domains/users/resolvers/mutations.js'))

  const hash = await auth.hashPassword(PASSWORD)
  const roleId = Number(((await db.execute(sql`INSERT INTO roles (tenant, name) VALUES (${TENANT}, 'vfyho support') RETURNING id`)).rows[0] as any).id)
  const newUser = async (label: string) => Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, email, status, password_hash)
    VALUES (${TENANT}, ${'vfyho ' + label}, ${emailOf(label)}, 'active', ${hash}) RETURNING id`)).rows[0] as any).id)
  ids.operator = await newUser('operator')
  ids.admin = await newUser('admin')
  // Staff whose roles were all revoked: no role and, like all staff, no wallet.
  ids.exAdmin = await newUser('ex-admin')
  ids.player = await newUser('player')
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${TENANT}, ${ids.operator}, ${roleId}), (${TENANT}, ${ids.admin}, ${roleId})`)
  await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${TENANT}, ${ids.player}, 'INR')`)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM wallets WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM user_roles WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM roles WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('the account actions record which kind of account they name', () => {
  const act = async (id: number) => {
    await users.setUserStatus(null, { id: String(id), status: 'ACTIVE' }, operator())
    await users.setRequirePasswordReset(null, { id: String(id), require: false }, operator())
    await users.forceLogoutUser(null, { id: String(id) }, operator())
  }

  it('a support admin (Support Admins uses these too) is recorded as an admin', async () => {
    await act(ids.admin)
    // The kind is on both sides of a status change, so the trail's change summary still names only the status.
    assert.deepEqual(await auditRow('reactivate_user', ids.admin), {
      before: { status: 'active', accountKind: 'admin' },
      after: { status: 'ACTIVE', accountKind: 'admin' },
    })
    assert.deepEqual(await auditAfter('clear_password_reset', ids.admin), { requirePasswordReset: false, accountKind: 'admin' })
    assert.deepEqual(await auditAfter('force_logout', ids.admin), { userId: ids.admin, accountKind: 'admin' })
  })

  it('a player is recorded as a player', async () => {
    await act(ids.player)
    assert.deepEqual(await auditAfter('reactivate_user', ids.player), { status: 'ACTIVE', accountKind: 'player' })
    assert.deepEqual(await auditAfter('clear_password_reset', ids.player), { requirePasswordReset: false, accountKind: 'player' })
    assert.deepEqual(await auditAfter('force_logout', ids.player), { userId: ids.player, accountKind: 'player' })
  })

  it('staff with every role revoked is still recorded as an admin (it has no wallet)', async () => {
    await users.forceLogoutUser(null, { id: String(ids.exAdmin) }, operator())
    assert.equal((await auditAfter('force_logout', ids.exAdmin))?.accountKind, 'admin')
  })
})

describe('the admin sign-in records which kind of account it named', () => {
  it("a player's credentials typed into the admin panel are refused, and the row names a player", async () => {
    await assert.rejects(signIn(emailOf('player'), PASSWORD), /Invalid credentials/)
    const refused = await auditAfter('login_failed', ids.player)
    assert.equal(refused?.accountKind, 'player')
    assert.equal(refused?.success, false)
    await assert.rejects(signIn(emailOf('player'), 'Wrong-Passw0rd!'), /Invalid credentials/)
    assert.equal((await auditAfter('login_failed', ids.player))?.accountKind, 'player')
  })

  it("an admin's sign-in and failed sign-in name an admin", async () => {
    const session = await signIn(emailOf('admin'), PASSWORD)
    assert.ok(session?.token, 'the admin could not sign in')
    const signedIn = await auditAfter('login', ids.admin)
    assert.equal(signedIn?.accountKind, 'admin')
    assert.equal(signedIn?.success, true)
    await assert.rejects(signIn(emailOf('admin'), 'Wrong-Passw0rd!'), /Invalid credentials/)
    assert.equal((await auditAfter('login_failed', ids.admin))?.accountKind, 'admin')
  })
})
