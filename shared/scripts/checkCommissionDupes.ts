import 'dotenv/config'
import { Client } from 'pg'

// Read-only pre-check for migration 0086 (agent_ledger COMMISSION uniqueness).
//   npx tsx scripts/checkCommissionDupes.ts

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const r = await c.query(
    "SELECT agent_id, domain, period_from, period_to, count(*) AS n " +
    "FROM agent_ledger WHERE line_type = 'COMMISSION' " +
    "GROUP BY 1,2,3,4 HAVING count(*) > 1"
  )
  console.log('COMMISSION duplicate groups (agent,domain,period):', r.rowCount)
  if (r.rowCount) console.table(r.rows)
  console.log(r.rowCount ? 'Duplicates exist — dedup before creating the unique index.' : 'Clean — safe to apply 0086.')
  await c.end()
}

main().catch((e) => { console.error('check failed:', e.message); process.exit(1) })
