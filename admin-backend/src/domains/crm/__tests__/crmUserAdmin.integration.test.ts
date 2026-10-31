/**
 * The CRM's own privilege surface: who may edit users, grant roles, reset
 * passwords, and delete accounts.
 *
 * Every one of these operations shipped with no test at all. The code is
 * careful — `setCrmUserRoles` even documents that a role id from another
 * whitelabel is "ignored rather than trusted" — but a property stated only in a
 * comment is not enforced. Drop the tenant predicate in a refactor and nothing
 * fails; the escalation it permits is silent and total, because a borrowed role
 * carries the other whitelabel's permissions into this one.
 *
 * These are the assertions that make those claims load-bearing:
 *   - the permission gate, and the INACTIVE gate, on each operation
 *   - a user id from another tenant is not reachable through any of them
 *   - a role id from another tenant cannot be granted
 *   - the two self-inflicted lockouts the resolvers guard against
 *   - the password rules on both the reset and the self-change path
 *   - a role change invalidates the user's existing sessions immediately
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-useradmin-${randomUUID().slice(0, 8)}`
const OTHER = `crm-useradmin-other-${randomUUID().slice(0, 8)}`

const GOOD_PASSWORD = 'Str0ng-Passw0rd!'
const SHORT_PASSWORD = 'short'

let adminId = ''
let targetId = ''
let foreignUserId = ''
let plainRoleId = ''
let foreignRoleId = ''

async function makeRole(tenant: string, label: string, perms: Array<{ domain: string; action: string }>) {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system)
    VALUES (${tenant}, ${`${label}-${randomUUID().slice(0, 6)}`}, false) RETURNING id`)
  const roleId = String((r.rows[0] as { id: string }).id)
  for (const p of perms) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${p.domain}, ${p.action})`)
  }
  return roleId
}

/**
 * Built through the repo's own insert, not with raw SQL.
 *
 * `insertCrmUser` creates the credential row alongside the user in one
 * transaction, so every real CRM user has one. A fixture that inserted only the
 * `crm_users` row would be a user shape production cannot produce, and tests
 * written against it would assert behaviour nobody can reach.
 */
async function makeUser(tenant: string, name: string, roleId?: string, password = GOOD_PASSWORD) {
  const { db } = await import('@src/db/client.js')
  const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
  const { hashCrmPassword } = await import('@src/domains/crm/services/CrmAuthService.js')
  const user = await insertCrmUser(db, {
    tenant,
    name,
    username: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    passwordHash: await hashCrmPassword(password),
    roleIds: roleId ? [roleId] : [],
  })
  return String(user.id)
}

/** A context for the administrator, or for whatever permissions are named. */
function ctx(
  userId: string,
  tenant: string,
  permissions: Array<{ domain: string; actions: string[] }>,
  status = 'ACTIVE'
) {
  return {
    crmUser: { id: userId, name: 'Actor', tenant, status, requirePasswordReset: false },
    permissions,
  } as any
}

const MANAGE = [{ domain: 'crm.users', actions: ['manage'] }]
const adminCtx = () => ctx(adminId, TENANT, MANAGE)

async function tokenVersionOf(id: string): Promise<number> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`SELECT token_version FROM crm_users WHERE id = ${id}::uuid`)
  return Number((r.rows[0] as { token_version: number }).token_version)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const manageRole = await makeRole(TENANT, 'manager', [{ domain: 'crm.users', action: 'manage' }])
  adminId = await makeUser(TENANT, 'Admin', manageRole)
  targetId = await makeUser(TENANT, 'Target')
  plainRoleId = await makeRole(TENANT, 'plain', [{ domain: 'crm.players', action: 'view' }])

  // A whole other whitelabel, to prove ids do not cross.
  foreignRoleId = await makeRole(OTHER, 'foreign-power', [{ domain: 'crm.users', action: 'manage' }])
  foreignUserId = await makeUser(OTHER, 'Foreigner')
})

after(async () => {
  // Every mutation here writes an audit entry, and that path publishes the
  // event through the Redis emitter — which opens a connection and holds the
  // event loop open for as long as the process lives. Without this the file's
  // tests all pass and then hang until the runner kills them, which is very
  // likely why the audited mutations had no tests before: they could not
  // finish. `auditCrm` is deliberately fire-and-forget, so let those writes
  // land before closing, or the emitter reopens behind us.
  await new Promise((r) => setTimeout(r, 250))
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()

  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const tenant of [TENANT, OTHER]) {
    await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${tenant}`)
    await db.execute(
      sql`DELETE FROM crm_user_credentials WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`
    )
    await db.execute(
      sql`DELETE FROM crm_user_roles WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${tenant})`
    )
    await db.execute(
      sql`DELETE FROM crm_role_permissions WHERE role_id IN (SELECT id FROM crm_roles WHERE tenant = ${tenant})`
    )
    await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${tenant}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${tenant}`)
  }
})

describe('the permission gate', () => {
  it('refuses every user-administration operation without crm.users:manage', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const powerless = ctx(adminId, TENANT, [{ domain: 'crm.players', actions: ['view'] }])

    await assert.rejects(
      () => crmMutations.crmUpdateUser(null, { input: { id: targetId, name: 'x' } }, powerless),
      /Forbidden/
    )
    await assert.rejects(
      () => crmMutations.crmSetUserRoles(null, { id: targetId, roleIds: [] }, powerless),
      /Forbidden/
    )
    await assert.rejects(
      () => crmMutations.crmResetUserPassword(null, { id: targetId, newPassword: GOOD_PASSWORD }, powerless),
      /Forbidden/
    )
    await assert.rejects(() => crmMutations.crmDeleteUser(null, { id: targetId }, powerless), /Forbidden/)
  })
})

describe('the INACTIVE gate', () => {
  it('lets a deactivated administrator keep their session but not their powers', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const inactive = ctx(adminId, TENANT, MANAGE, 'INACTIVE')
    await assert.rejects(
      () => crmMutations.crmUpdateUser(null, { input: { id: targetId, name: 'x' } }, inactive),
      /inactive/i
    )
    await assert.rejects(
      () => crmMutations.crmSetUserRoles(null, { id: targetId, roleIds: [plainRoleId] }, inactive),
      /inactive/i
    )
  })
})

describe('a user id from another whitelabel is not reachable', () => {
  it('crmUpdateUser reports not-found rather than editing it', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmUpdateUser(
      null,
      { input: { id: foreignUserId, name: 'Renamed by an outsider' } },
      adminCtx()
    )
    assert.equal(res.ok, false)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(sql`SELECT name FROM crm_users WHERE id = ${foreignUserId}::uuid`)
    assert.equal((row.rows[0] as { name: string }).name, 'Foreigner', 'the foreign row was modified')
  })

  it('crmSetUserRoles, crmResetUserPassword and crmDeleteUser all refuse it', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    assert.equal(
      (await crmMutations.crmSetUserRoles(null, { id: foreignUserId, roleIds: [] }, adminCtx())).ok,
      false
    )
    assert.equal(
      (
        await crmMutations.crmResetUserPassword(
          null,
          { id: foreignUserId, newPassword: GOOD_PASSWORD },
          adminCtx()
        )
      ).ok,
      false
    )
    assert.equal((await crmMutations.crmDeleteUser(null, { id: foreignUserId }, adminCtx())).ok, false)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const still = await db.execute(sql`SELECT count(*)::int n FROM crm_users WHERE id = ${foreignUserId}::uuid`)
    assert.equal((still.rows[0] as { n: number }).n, 1, 'the foreign user was deleted')
  })
})

describe('a role id from another whitelabel cannot be granted at creation either', () => {
  it('drops it while keeping the legitimate roles in the same call', async () => {
    // `setCrmUserRoles` has always filtered by tenant and has the test below.
    // `insertCrmUser` did not, and `crm_user_roles` has no tenant column of its
    // own, so nothing downstream caught it: verified by execution, a
    // `crm.users:manage` holder created an account naming another whitelabel's
    // role id and the account came out holding that whitelabel's
    // `crm.players:view_all`. Cross-tenant privilege escalation through the
    // ordinary create form. Here the foreign role carries `crm.users:manage`,
    // so importing it would hand the new account user administration.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const { getCrmUserPermissions } = await import('@src/repos/crm/CrmUsersRepo.js')
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')

    // Unlike every other test here, creating a user claims a seat, which needs
    // the whitelabel's CRM to be switched on.
    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit)
      VALUES (${TENANT}, true, 20)
      ON CONFLICT (tenant) DO UPDATE SET enabled = true, seat_limit = 20`)

    const username = `mule-${randomUUID().slice(0, 8)}`
    const res = await crmMutations.crmCreateUser(
      null,
      {
        input: {
          name: 'Mule',
          username,
          password: GOOD_PASSWORD,
          // One foreign, one legitimate — the guard must be a filter, not a veto.
          roleIds: [foreignRoleId, plainRoleId],
        },
      },
      adminCtx()
    )
    assert.equal(res.ok, true, res.error)

    const row = await db.execute(sql`
      SELECT u.id FROM crm_users u
      JOIN crm_user_credentials c ON c.crm_user_id = u.id
      WHERE u.tenant = ${TENANT} AND c.username = ${username}`)
    const muleId = String((row.rows[0] as { id: string }).id)

    const held = (await getCrmUserPermissions(muleId)).flatMap((p) =>
      p.actions.map((a) => `${p.domain}:${a}`)
    )
    assert.equal(
      held.includes('crm.users:manage'),
      false,
      "the foreign role's permissions were imported into this whitelabel"
    )
    assert.deepEqual(
      held,
      ['crm.players:view'],
      'the legitimate role named in the same call must survive the filter'
    )
  })
})

describe('a role id from another whitelabel cannot be granted', () => {
  it('is dropped, not applied — otherwise it would import that tenant’s powers', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmSetUserRoles(
      null,
      { id: targetId, roleIds: [foreignRoleId] },
      adminCtx()
    )
    // The operation succeeds against a real local user; the foreign id inside
    // it is what must not survive.
    assert.equal(res.ok, true)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const held = await db.execute(
      sql`SELECT role_id FROM crm_user_roles WHERE crm_user_id = ${targetId}::uuid`
    )
    assert.equal(held.rows.length, 0, 'a foreign role was attached to a local user')
  })

  it('grants a local role normally, so the check is not simply refusing everything', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmSetUserRoles(
      null,
      { id: targetId, roleIds: [plainRoleId] },
      adminCtx()
    )
    assert.equal(res.ok, true)

    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const held = await db.execute(
      sql`SELECT role_id FROM crm_user_roles WHERE crm_user_id = ${targetId}::uuid`
    )
    assert.equal(held.rows.length, 1)
    assert.equal(String((held.rows[0] as { role_id: string }).role_id), plainRoleId)
  })

  it('a role change ends the user’s existing sessions at once', async () => {
    // Roles decide what a token may do, so a demotion that left old tokens
    // working would keep the removed permission alive until they expired.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const before = await tokenVersionOf(targetId)
    await crmMutations.crmSetUserRoles(null, { id: targetId, roleIds: [] }, adminCtx())
    assert.ok(
      (await tokenVersionOf(targetId)) > before,
      'token_version did not advance, so old sessions keep the old roles'
    )
  })
})

describe('the self-inflicted lockouts', () => {
  it('an administrator cannot delete their own account', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmDeleteUser(null, { id: adminId }, adminCtx())
    assert.equal(res.ok, false)
    assert.match(String(res.error), /own account/i)
  })

  it('an administrator cannot suspend themselves', async () => {
    // The only administrator suspending themselves locks out the whitelabel.
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    for (const status of ['INACTIVE', 'SUSPENDED']) {
      const res = await crmMutations.crmSetUserStatus(null, { id: adminId, status }, adminCtx())
      assert.equal(res.ok, false, `${status} on self was allowed`)
    }
    // Setting yourself back to ACTIVE is harmless and stays allowed.
    assert.equal(
      (await crmMutations.crmSetUserStatus(null, { id: adminId, status: 'ACTIVE' }, adminCtx())).ok,
      true
    )
  })

  it('rejects a status outside the known set', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const res = await crmMutations.crmSetUserStatus(null, { id: targetId, status: 'DELETED' }, adminCtx())
    assert.equal(res.ok, false)
  })
})

describe('passwords', () => {
  it('an administrator’s reset must meet the policy and forces a change on next sign-in', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const weak = await crmMutations.crmResetUserPassword(
      null,
      { id: targetId, newPassword: SHORT_PASSWORD },
      adminCtx()
    )
    assert.equal(weak.ok, false)
    assert.match(String(weak.error), /at least/i)

    // A new user already carries the flag, so clear it first — otherwise this
    // would pass without the reset having done anything.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(
      sql`UPDATE crm_users SET require_password_reset = false WHERE id = ${targetId}::uuid`
    )

    const good = await crmMutations.crmResetUserPassword(
      null,
      { id: targetId, newPassword: GOOD_PASSWORD },
      adminCtx()
    )
    assert.equal(good.ok, true)

    const row = await db.execute(
      sql`SELECT require_password_reset FROM crm_users WHERE id = ${targetId}::uuid`
    )
    assert.equal(
      (row.rows[0] as { require_password_reset: boolean }).require_password_reset,
      true,
      'a password handed over by an administrator must be changed on first use'
    )
  })

  it('changing your own password re-authenticates you first', async () => {
    const { crmMutations } = await import('@src/domains/crm/resolvers/mutations.js')
    const self = ctx(targetId, TENANT, [])

    const wrong = await crmMutations.crmChangeOwnPassword(
      null,
      { currentPassword: 'not-the-password', newPassword: 'An0ther-Passw0rd!' },
      self
    )
    assert.equal(wrong.ok, false, 'a valid session alone was enough to change the password')
    assert.match(String(wrong.error), /current password/i)

    const weak = await crmMutations.crmChangeOwnPassword(
      null,
      { currentPassword: GOOD_PASSWORD, newPassword: SHORT_PASSWORD },
      self
    )
    assert.equal(weak.ok, false)

    const done = await crmMutations.crmChangeOwnPassword(
      null,
      { currentPassword: GOOD_PASSWORD, newPassword: 'An0ther-Passw0rd!' },
      self
    )
    assert.equal(done.ok, true)

    // Changing it yourself clears the forced-reset flag the administrator set.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const row = await db.execute(
      sql`SELECT require_password_reset FROM crm_users WHERE id = ${targetId}::uuid`
    )
    assert.equal((row.rows[0] as { require_password_reset: boolean }).require_password_reset, false)
  })
})
