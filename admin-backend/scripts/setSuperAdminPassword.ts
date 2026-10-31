/**
 * Sets the Super Admin's password, using the application's own hashing and
 * verifying the result through the real login resolver.
 *
 * Written as a script rather than a hand-run SQL update because the hash has to
 * come from `hashPassword` — a bcrypt cost or algorithm chosen by hand here and
 * a `verifyPassword` that disagrees with it would lock the highest-privilege
 * account out of the platform, with nothing to fall back on.
 *
 * Usage:
 *   npx tsx src/scripts/setSuperAdminPassword.ts <email> <new-password>
 *
 * It refuses to run against an account that is not a Super Admin, and it does
 * not bump `token_version`: an existing signed-in session stays valid, so a
 * mistake here is recoverable from the browser that is already open. Pass
 * --revoke-sessions to end them instead.
 */
import 'dotenv/config'
import { db, pool } from '@src/db/client.js'
import { users, roles, userRoles } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'
import { hashPassword, verifyPassword } from '@src/domains/common/auth.js'
import { sql } from 'drizzle-orm'

async function main(): Promise<void> {
  const [email, newPassword] = process.argv.slice(2)
  const revokeSessions = process.argv.includes('--revoke-sessions')

  if (!email || !newPassword) {
    throw new Error('usage: setSuperAdminPassword.ts <email> <new-password> [--revoke-sessions]')
  }
  if (newPassword.length < 12) {
    // The login schema only requires 6. This is the account that can reach
    // every whitelabel, so it does not get to use the floor.
    throw new Error('refusing: the Super Admin password must be at least 12 characters')
  }

  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      tenant: users.tenant,
      status: users.status,
      tokenVersion: users.tokenVersion,
      currentHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)

  if (!account) throw new Error(`no account with email ${email}`)

  const roleRows = await db
    .select({ name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, account.id))
  const roleNames = roleRows.map((r) => r.name)

  if (!roleNames.includes('Super Admin')) {
    throw new Error(
      `refusing: ${email} holds [${roleNames.join(', ') || 'no roles'}], not Super Admin`
    )
  }

  if (await verifyPassword(newPassword, account.currentHash ?? '')) {
    console.log('That is already the password. Nothing to do.')
    return
  }

  const hash = await hashPassword(newPassword)

  // Verify the hash before it is written, not after: a hash this process cannot
  // itself verify must never reach the column.
  if (!(await verifyPassword(newPassword, hash))) {
    throw new Error('refusing: the freshly generated hash does not verify')
  }

  await db
    .update(users)
    .set({
      passwordHash: hash,
      requirePasswordReset: false,
      ...(revokeSessions ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
    })
    .where(and(eq(users.id, account.id), eq(users.email, email)))

  // Read it back and check the stored value, so "it worked" is a fact about the
  // database rather than about the variable in this process.
  const [after] = await db
    .select({ hash: users.passwordHash, tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, account.id))
    .limit(1)

  const nowWorks = await verifyPassword(newPassword, after.hash ?? '')
  const oldStillWorks = await verifyPassword('GwAdmin@2026', after.hash ?? '')

  console.log(JSON.stringify(
    {
      account: { id: account.id, name: account.name, email: account.email, tenant: account.tenant },
      roles: roleNames,
      newPasswordVerifies: nowWorks,
      oldTemporaryPasswordStillWorks: oldStillWorks,
      tokenVersion: { before: account.tokenVersion, after: after.tokenVersion },
      sessionsRevoked: revokeSessions,
    },
    null,
    2
  ))

  if (!nowWorks) throw new Error('the stored hash does not verify — restore from the backup')
  if (oldStillWorks) throw new Error('the old password still works — the update did not land')
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('failed:', err instanceof Error ? err.message : err)
    await pool.end()
    process.exit(1)
  })
