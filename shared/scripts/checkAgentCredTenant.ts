import 'dotenv/config'
import { Client } from 'pg'

// Read-only: is agent_credentials.tenant_id required + does it match agents.tenant_id?
//   npx tsx scripts/checkAgentCredTenant.ts

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()

  // 1. Column definition (NOT NULL? default?)
  const col = await c.query(
    "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='agent_credentials' AND column_name='tenant_id'"
  )
  console.log('--- agent_credentials.tenant_id column ---')
  console.log(col.rowCount ? col.rows[0] : 'COLUMN DOES NOT EXIST (migration 0084 not applied)')

  // 2. Totals
  const tot = await c.query('SELECT count(*)::int n FROM agent_credentials')
  console.log('\nagent_credentials rows:', tot.rows[0].n)

  // 3. Any NULL tenant_id?
  const nul = await c.query("SELECT count(*)::int n FROM agent_credentials WHERE tenant_id IS NULL").catch(() => ({ rows: [{ n: 'n/a' }] } as any))
  console.log('rows with NULL tenant_id:', nul.rows[0].n)

  // 4. Mismatches vs the owning agent's tenant_id
  const mis = await c.query(
    `SELECT ac.agent_id, ac.username, ac.tenant_id AS cred_tenant, a.tenant_id AS agent_tenant
       FROM agent_credentials ac JOIN agents a ON a.id = ac.agent_id
      WHERE ac.tenant_id IS DISTINCT FROM a.tenant_id`
  )
  console.log('\nrows where agent_credentials.tenant_id != agents.tenant_id:', mis.rowCount)
  if (mis.rowCount) console.table(mis.rows)

  // 5. Orphan credentials (no agent) — would have no agent tenant to match
  const orph = await c.query(
    `SELECT count(*)::int n FROM agent_credentials ac LEFT JOIN agents a ON a.id = ac.agent_id WHERE a.id IS NULL`
  )
  console.log('orphan agent_credentials (no matching agent):', orph.rows[0].n)

  await c.end()
}
main().catch((e) => { console.error('check failed:', e.message); process.exit(1) })
