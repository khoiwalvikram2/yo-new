import 'dotenv/config'
import { Client } from 'pg'

// Read-only pre-check for migrations 0083 + 0085.
// Run from the `shared` folder against the LIVE DB:
//   npx tsx scripts/checkMigrationDupes.ts
// Safe to run anytime — it only SELECTs, never writes.

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL not set (expected in shared/.env)')
    process.exit(1)
  }
  const c = new Client({ connectionString: url })
  await c.connect()

  const a = await c.query(
    "SELECT agent_id, period_from, period_to, count(*) AS n " +
    "FROM agent_settlements WHERE status = 'OPEN' " +
    "GROUP BY 1,2,3 HAVING count(*) > 1"
  )
  console.log('--- 0083 (agent_settlements OPEN duplicates) ---')
  console.log('duplicate groups:', a.rowCount)
  if (a.rowCount) console.table(a.rows)

  const b = await c.query(
    "SELECT user_id, transaction_id, count(*) AS n " +
    "FROM casino_bets WHERE transaction_id IS NOT NULL " +
    "GROUP BY 1,2 HAVING count(*) > 1"
  )
  console.log('--- 0085 (casino_bets placement duplicates) ---')
  console.log('duplicate groups:', b.rowCount)
  if (b.rowCount) console.table(b.rows)

  console.log('')
  if (!a.rowCount && !b.rowCount) {
    console.log('RESULT: 0 duplicates for both. Safe to apply 0083 and 0085.')
  } else {
    console.log('RESULT: duplicates found above. Do NOT apply that index yet — send this output.')
  }

  await c.end()
}

main().catch((e) => {
  console.error('check failed:', e.message)
  process.exit(1)
})
