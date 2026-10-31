/**
 * Two CRM accounts the browser tests sign in as.
 *
 * They live in `default` because that is the tenant a request to localhost
 * resolves to — `crmLogin` reads it from the context, and there is no host
 * header on a dev machine that would say anything else. So the fixture cannot
 * hide in a random tenant the way the integration tests do; it names its users
 * distinctively and recreates them from scratch on every run instead.
 *
 * The second account is the point. It holds `crm.security:view` and nothing
 * else — no `crm.players:view` — which is the exact shape that used to land a
 * user on `/players`, a screen the server then refused, with no navigation and
 * no explanation. A browser is the only place that whole path can be watched
 * end to end.
 *
 *   npx tsx scripts/seedE2eCrmUsers.ts
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db, pool } from '@src/db/client.js'

const TENANT = 'default'

export const E2E_USERS = {
  admin: { username: 'e2e-admin', password: 'E2e-Passw0rd!', name: 'E2E Admin' },
  security: { username: 'e2e-security', password: 'E2e-Passw0rd!', name: 'E2E Security' },
}

// Derived from the catalogue, not listed by hand. The hand-written version of
// this said ALL_PERMISSIONS and held nine — it predated four whole permission
// domains, so the "admin" fixture could not open the screens they gate and any
// E2E written against them would fail for the wrong reason. A hand-maintained
// list is how this repo keeps losing things; the catalogue is the source.
import { CRM_PERMISSIONS } from '@src/domains/crm/permissions.js'
const ALL_PERMISSIONS: Array<[string, string]> = CRM_PERMISSIONS.flatMap((g) =>
  g.actions.map((a): [string, string] => [a.domain, a.action])
)

/** Only the security log. Deliberately no crm.players:view. */
const SECURITY_ONLY: Array<[string, string]> = [['crm.security', 'view']]

async function makeUser(
  username: string,
  name: string,
  password: string,
  permissions: Array<[string, string]>
): Promise<void> {
  const { insertCrmUser } = await import('@src/repos/crm/CrmUsersRepo.js')
  const { hashCrmPassword } = await import('@src/domains/crm/services/CrmAuthService.js')

  const roleName = `e2e-role-${username}`
  const role = await db.execute(sql`
    INSERT INTO crm_roles (tenant, name, is_system) VALUES (${TENANT}, ${roleName}, false)
    RETURNING id`)
  const roleId = String((role.rows[0] as { id: string }).id)
  for (const [domain, action] of permissions) {
    await db.execute(sql`
      INSERT INTO crm_role_permissions (role_id, domain, action)
      VALUES (${roleId}::uuid, ${domain}, ${action})`)
  }

  const user = await insertCrmUser(db, {
    tenant: TENANT,
    name,
    username,
    passwordHash: await hashCrmPassword(password),
    roleIds: [roleId],
  })

  // `insertCrmUser` sets requirePasswordReset, which is right for a real
  // account handed over by an administrator and wrong for a fixture: the tests
  // are about the screens, not about the forced-change gate, which has its own
  // test.
  await db.execute(sql`
    UPDATE crm_users SET require_password_reset = false, status = 'ACTIVE' WHERE id = ${user.id}::uuid`)
}

async function removeIfPresent(username: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM crm_user_roles WHERE crm_user_id IN (
      SELECT crm_user_id FROM crm_user_credentials WHERE tenant = ${TENANT} AND username = ${username})`)
  await db.execute(sql`
    DELETE FROM crm_users WHERE tenant = ${TENANT} AND id IN (
      SELECT crm_user_id FROM crm_user_credentials WHERE tenant = ${TENANT} AND username = ${username})`)
  await db.execute(sql`
    DELETE FROM crm_role_permissions WHERE role_id IN (
      SELECT id FROM crm_roles WHERE tenant = ${TENANT} AND name = ${`e2e-role-${username}`})`)
  await db.execute(sql`
    DELETE FROM crm_roles WHERE tenant = ${TENANT} AND name = ${`e2e-role-${username}`}`)
}

async function main(): Promise<void> {
  // These are working credentials with a password written down in this file, so
  // there has to be a way to take them away again.
  if (process.argv.includes('--clean')) {
    for (const u of Object.values(E2E_USERS)) await removeIfPresent(u.username)
    console.log(`E2E CRM users removed from '${TENANT}'`)
    await pool.end()
    return
  }

  // CRM has to be switched on for the tenant, or every sign-in is refused
  // before it reaches the credential.
  const settings = await db.execute(
    sql`SELECT enabled, seat_limit FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`
  )
  const row = settings.rows[0] as { enabled: boolean; seat_limit: number } | undefined
  if (!row?.enabled) throw new Error(`CRM is not enabled for '${TENANT}' — run crm:setup first`)

  for (const u of Object.values(E2E_USERS)) await removeIfPresent(u.username)

  await makeUser(E2E_USERS.admin.username, E2E_USERS.admin.name, E2E_USERS.admin.password, ALL_PERMISSIONS)
  await makeUser(
    E2E_USERS.security.username,
    E2E_USERS.security.name,
    E2E_USERS.security.password,
    SECURITY_ONLY
  )

  console.log(`E2E CRM users ready in '${TENANT}':`)
  for (const [key, u] of Object.entries(E2E_USERS)) {
    console.log(`  ${key.padEnd(9)} ${u.username} / ${u.password}`)
  }
  await pool.end()
}

main().catch(async (e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  try {
    await pool.end()
  } catch {
    /* already closed */
  }
  process.exit(1)
})
