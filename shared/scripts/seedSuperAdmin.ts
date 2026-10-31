import './loadEnv.js'
import { db } from '../src/db/client.js'
import { users, roles, userRoles } from '../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { assignRoleToUser } from './seedRbac.js'
import { checkWhitelabelExists, checkRoleExists, checkUserHasRole, exitWithError, logStep, logSuccess, logSkip } from './seedUtils.js'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(plain, salt)
}

async function ensureAdminUser(params: { email: string; name: string; password: string; roleName?: string; tenant?: string }): Promise<void> {
  const { email, name, password, roleName = 'Admin', tenant = 'default' } = params
  const existingByEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  let userId: number | null = existingByEmail.length ? existingByEmail[0].id : null
  let roleId: number | null = null
  const r = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, roleName), eq(roles.tenant, tenant)))
  if (r.length) roleId = r[0].id
  else {
    const inserted = await db.insert(roles).values({ name: roleName, tenant }).returning({ id: roles.id })
    roleId = inserted[0].id
  }
  if (userId == null) {
    const passwordHash = await hashPassword(password)
    const insertedUser = await db.insert(users)
      .values({ email, name, passwordHash, tenant })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (insertedUser.length) userId = insertedUser[0].id
    else {
      const fetched = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
      userId = fetched.length ? fetched[0].id : null
    }
  }
  if (roleId != null && userId != null) {
    await db.insert(userRoles).values({ userId, roleId, tenant }).onConflictDoNothing()
  }
}

export async function seedSuperAdmin() {
  const tenant = 'default'
  const roleName = 'Super Admin'
  logStep(1, 3, 'Checking prerequisites')
  const whitelabelExists = await checkWhitelabelExists(tenant)
  if (!whitelabelExists) exitWithError(`Whitelabel '${tenant}' not found. Run: npm run seed:roles first`)
  logSuccess(`Whitelabel '${tenant}' exists`)
  const roleExists = await checkRoleExists(roleName, tenant)
  if (!roleExists) exitWithError(`Role '${roleName}' not found. Run: npm run seed:roles first`)
  logSuccess(`Role '${roleName}' exists`)
  logStep(2, 3, 'Checking for existing Super Admin user')
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@example.com'
  const name = process.env.SUPER_ADMIN_NAME || 'Super Admin'
  const envPassword = process.env.SUPER_ADMIN_PASSWORD?.trim()
  /**
   * Only produced when a user is actually going to be created.
   *
   * This used to run — and print — before the existence check, so a re-run
   * against an existing Super Admin announced a password that was never
   * applied. An operator then tried to sign in with a credential that had
   * never existed, and had no way to tell that from a wrong password.
   */
  const resolvePassword = (): string => {
    if (envPassword && envPassword.length >= 8) return envPassword
    const generated = randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 16)
    console.warn(
      '[seedSuperAdmin] SUPER_ADMIN_PASSWORD not set or too short (min 8 chars). Using generated password (change after first login):'
    )
    console.warn(`   Generated password: ${generated}`)
    return generated
  }
  const existing = await db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.tenant, tenant)))
    .limit(1)
  if (existing.length > 0) {
    const userId = existing[0].id
    const hasRole = await checkUserHasRole(userId, roleName, tenant)
    if (hasRole) {
      logSkip(`Super Admin user already exists with correct role (${email})`)
      console.log('\n✅ Super Admin seeding complete! (user already exists)')
      // Say plainly that nothing changed — least of all the password, which is
      // what someone re-running this script is usually hoping for.
      console.log('   Nothing was changed, and the existing password still applies.')
      console.log('   To set a new one: cd admin-backend && npm run superadmin:set-password')
      return
    }
    logStep(3, 3, 'Assigning Super Admin role to existing user')
    await assignRoleToUser(userId, roleName, tenant)
    logSuccess(`Super Admin role assigned to existing user (${email})`)
    console.log('\n✅ Super Admin seeding complete!')
    return
  }
  logStep(3, 3, 'Creating Super Admin user')
  await ensureAdminUser({ email, name, password: resolvePassword(), roleName, tenant })
  logSuccess(`Super Admin user created: ${email}`)
  console.log('\n✅ Super Admin seeding complete!')
  console.log(`   Email: ${email}`)
  console.log(`   Name: ${name}`)
  console.log(`   Role: ${roleName}`)
}

if (process.argv[1]?.includes('seedSuperAdmin')) {
  seedSuperAdmin().catch((err) => { console.error(err); process.exit(1) })
}
