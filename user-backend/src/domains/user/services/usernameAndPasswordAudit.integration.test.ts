/**
 * Usernames and password changes on the player API (players/PLA-06, players/PLA-18).
 *
 *   - a signup cannot take a username already used in the tenant, ignoring case and spaces (createUser checks it
 *     under the same advisory lock as the admin's player creation); another tenant may use it;
 *   - the database itself refuses a second account with the same username in a tenant, ignoring case and spaces
 *     (users_tenant_username_ci_unique, migration 0021, after the 2026-11-04 rename of the old duplicates), so the
 *     login's pick-by-password branch for duplicates can no longer meet one;
 *   - a password change (and the OTP reset) writes a change_password audit row with the player as actor, which
 *     the admin profile's Activity Log lists and counts.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction
 * that is always rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/user/services/usernameAndPasswordAudit.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { and } from 'drizzle-orm'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { createUser, isUsernameTaken } = await import('../../../repos/userRepo.js')
const { loginWithPassword, changePassword } = await import('./authService.js')
const { userMutationResolvers } = await import('../resolvers/mutations.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

async function playerWith(tx: any, tenant: string, username: string, password: string, phone: string) {
  const [row] = await tx.insert(t.users).values({ tenant, name: `vfyfix ${username}`, username, phone, passwordHash: await bcrypt.hash(password, 4), status: 'active' }).returning()
  await tx.insert(t.wallets).values({ tenant, userId: row.id, cash: '0', currency: 'INR' })
  return row
}

test('a signup cannot take a username already used in the tenant, ignoring case and spaces', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), other = await fixture(tx)
    await playerWith(tx, f.tenant, 'vfyfix_taken', 'vfyfix-Passw0rd', '7419980001')
    routeDbToTransaction(mock, db, tx)
    assert.equal(await isUsernameTaken(' VFYFIX_Taken ', f.tenant), true)
    assert.equal(await isUsernameTaken('vfyfix_taken', other.tenant), false)
    await assert.rejects(createUser({ tenant: f.tenant, phone: '7419980002', username: 'VFYFIX_TAKEN', password: 'vfyfix-Passw0rd' }), { message: 'This username is already taken' })
    const elsewhere = await createUser({ tenant: other.tenant, phone: '7419980003', username: 'vfyfix_taken', password: 'vfyfix-Passw0rd' })
    assert.equal(elsewhere.username, 'vfyfix_taken')
    mock.restoreAll()
  })
})

test('the database refuses a duplicate username in the tenant, ignoring case and spaces; the username still logs in', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), other = await fixture(tx)
    const first = await playerWith(tx, f.tenant, 'vfyfix_twin', 'vfyfix-First1', '7419980011')
    // A savepoint, so the refused insert leaves the test's transaction usable.
    await assert.rejects(
      tx.transaction((sp: any) => playerWith(sp, f.tenant, ' VFYFIX_Twin ', 'vfyfix-Second2', '7419980012')),
      (error: any) => (error?.code ?? error?.cause?.code) === '23505',
    )
    // Another tenant may still use the name.
    await playerWith(tx, other.tenant, 'vfyfix_twin', 'vfyfix-Other3', '7419980013')
    routeDbToTransaction(mock, db, tx)
    assert.equal((await loginWithPassword('vfyfix_twin', 'vfyfix-First1', f.tenant)).user.id, String(first.id))
    await assert.rejects(loginWithPassword('vfyfix_twin', 'vfyfix-Wrong3', f.tenant), { message: 'Invalid credentials' })
    mock.restoreAll()
  })
})

test('a password change writes a change_password audit row with the player as actor', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const player = await playerWith(tx, f.tenant, 'vfyfix_pw', 'vfyfix-Before1', '7419980021')
    await tx.update(t.users).set({ requirePasswordReset: true }).where(eq(t.users.id, player.id))
    routeDbToTransaction(mock, db, tx)
    await changePassword(player.id, 'vfyfix-Before1', 'vfyfix-After22', f.tenant, { ip: '203.0.113.7', userAgent: 'vfyfix-agent' })
    const rows = await tx.select().from(t.auditLogs).where(and(eq(t.auditLogs.tenant, f.tenant), eq(t.auditLogs.actorId, String(player.id))))
    assert.deepEqual(rows.map((r: any) => [r.domain, r.action, r.resourceId, r.after.via, r.after.wasResetRequired, r.after.ipAddress, r.after.userAgent]), [
      ['players', 'change_password', String(player.id), 'change', true, '203.0.113.7', 'vfyfix-agent'],
    ])
    const [saved] = await tx.select().from(t.users).where(eq(t.users.id, player.id))
    assert.equal(saved.requirePasswordReset, false)
    assert.equal(await bcrypt.compare('vfyfix-After22', saved.passwordHash), true)
    mock.restoreAll()
  })
})

// The resolvers hand the request's IP and user agent to the audit row, as the login resolvers do, so the Activity
// Log shows them for a password change too. The OTP row is written directly: no OTP is sent.
test('the changePassword and resetPassword resolvers record the request IP and user agent', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const player = await playerWith(tx, f.tenant, 'vfyho_meta', 'vfyho-Before1', '7419980031')
    await tx.insert(t.userOtps).values({ tenant: f.tenant, phone: '7419980031', codeHash: await bcrypt.hash('246810', 4), purpose: 'reset', expiresAt: new Date(Date.now() + 600_000) })
    routeDbToTransaction(mock, db, tx)
    const ctx = { auth: { userId: player.id, tenant: f.tenant, requestTenant: f.tenant }, request: { headers: { 'x-forwarded-for': '198.51.100.23, 10.0.0.1', 'user-agent': 'vfyho-agent/1.0' } } } as any
    assert.equal((await userMutationResolvers.changePassword(null, { currentPassword: 'vfyho-Before1', newPassword: 'vfyho-After22' }, ctx)).success, true)
    assert.equal((await userMutationResolvers.resetPassword(null, { phone: '7419980031', otp: '246810', newPassword: 'vfyho-Reset33' }, ctx)).success, true)
    const rows = await tx.select().from(t.auditLogs).where(and(eq(t.auditLogs.tenant, f.tenant), eq(t.auditLogs.actorId, String(player.id))))
    assert.deepEqual(rows.map((r: any) => [r.action, r.after.via, r.after.ipAddress, r.after.userAgent]).sort(), [
      ['change_password', 'change', '198.51.100.23', 'vfyho-agent/1.0'],
      ['change_password', 'otp_reset', '198.51.100.23', 'vfyho-agent/1.0'],
    ])
    mock.restoreAll()
  })
})
