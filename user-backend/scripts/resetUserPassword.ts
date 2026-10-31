import 'dotenv/config'
import bcrypt from 'bcryptjs'
import pg from 'pg'

// Reset a users-table password by email (scoped to a tenant), using the same
// bcrypt cost (10) the app uses. Local/dev use.
//   npx tsx scripts/resetUserPassword.ts <email> <tenant> <newPassword>
// Prints which DB host it hit + a verify result. Never prints the hash.

async function main() {
  const [email, tenant, newPassword] = process.argv.slice(2)
  if (!email || !tenant || !newPassword) {
    console.error('usage: resetUserPassword.ts <email> <tenant> <newPassword>')
    process.exit(1)
  }
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
  // Show host only (no creds) so we can confirm we are NOT on production by accident.
  try { console.log('DB host:', new URL(url).host) } catch {}

  const hash = await bcrypt.hash(newPassword, 10)
  const c = new pg.Client({ connectionString: url })
  await c.connect()

  const r = await c.query(
    `UPDATE users SET password_hash = $1
      WHERE lower(email) = lower($2) AND tenant = $3
      RETURNING id, email, tenant`,
    [hash, email, tenant]
  )
  console.log('rows updated:', r.rowCount)
  if (r.rowCount) console.table(r.rows)

  // Verify the new password validates against the stored hash.
  const v = await c.query(
    `SELECT password_hash FROM users WHERE lower(email) = lower($1) AND tenant = $2`,
    [email, tenant]
  )
  const ok = v.rows[0] ? await bcrypt.compare(newPassword, v.rows[0].password_hash) : false
  console.log('verify (new password matches stored hash):', ok)

  await c.end()
  if (!r.rowCount || !ok) process.exit(1)
}

main().catch((e) => { console.error('reset failed:', e.message); process.exit(1) })
