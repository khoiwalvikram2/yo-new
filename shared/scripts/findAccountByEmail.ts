import 'dotenv/config'
import { Client } from 'pg'

// Read-only: locate an account by email/username across credential tables.
//   npx tsx scripts/findAccountByEmail.ts admin@thetitanbook.fun
// Prints which table + id/tenant/role (NEVER the password hash).

async function main() {
  const needle = process.argv[2]
  if (!needle) { console.error('usage: findAccountByEmail.ts <email-or-username>'); process.exit(1) }
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  // users table (email or username/phone). Do not select password_hash.
  const u = await c.query(
    `SELECT id, tenant, email, username, player_type, agent_id, status
       FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)`,
    [needle]
  ).catch((e) => ({ rows: [], err: e.message } as any))
  console.log('--- users ---', (u as any).err ? `(err: ${(u as any).err})` : `${u.rowCount} match`)
  if (u.rows?.length) console.table(u.rows)

  // agent_credentials (username) joined to agents for tenant.
  const a = await c.query(
    `SELECT ac.agent_id, ac.username, ac.tenant_id, ag.scheme_type, ag.status
       FROM agent_credentials ac JOIN agents ag ON ag.id = ac.agent_id
      WHERE lower(ac.username) = lower($1)`,
    [needle]
  ).catch((e) => ({ rows: [], err: e.message } as any))
  console.log('--- agent_credentials ---', (a as any).err ? `(err: ${(a as any).err})` : `${a.rowCount} match`)
  if (a.rows?.length) console.table(a.rows)

  await c.end()
}

main().catch((e) => { console.error('failed:', e.message); process.exit(1) })
