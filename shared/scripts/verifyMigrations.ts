import 'dotenv/config'
import { Client } from 'pg'

// Read-only verification that migrations 0083/0084/0085 are in place.
//   npx tsx scripts/verifyMigrations.ts

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const checks: { name: string; ok: boolean; detail: string }[] = []

  // 0083: partial unique index on agent_settlements
  const i83 = await c.query(
    "SELECT indexdef FROM pg_indexes WHERE indexname = 'agent_settlements_agent_period_open_key'"
  )
  checks.push({ name: '0083 agent_settlements OPEN unique', ok: i83.rowCount === 1, detail: i83.rows[0]?.indexdef || 'MISSING' })

  // 0084a: tenant_id column on agent_credentials
  const col = await c.query(
    "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='agent_credentials' AND column_name='tenant_id'"
  )
  checks.push({ name: '0084 agent_credentials.tenant_id NOT NULL', ok: col.rowCount === 1 && col.rows[0].is_nullable === 'NO', detail: JSON.stringify(col.rows[0] || 'MISSING') })

  // 0084b: new composite unique present
  const i84 = await c.query(
    "SELECT indexdef FROM pg_indexes WHERE indexname = 'agent_credentials_tenant_username_key'"
  )
  checks.push({ name: '0084 (tenant_id, lower(username)) unique', ok: i84.rowCount === 1, detail: i84.rows[0]?.indexdef || 'MISSING' })

  // 0084c: old global unique gone
  const oldU = await c.query(
    "SELECT 1 FROM pg_indexes WHERE indexname = 'agent_credentials_username_unique' " +
    "UNION SELECT 1 FROM pg_constraint WHERE conname = 'agent_credentials_username_unique'"
  )
  checks.push({ name: '0084 old global username unique removed', ok: oldU.rowCount === 0, detail: oldU.rowCount ? 'STILL PRESENT' : 'gone' })

  // 0085: partial unique index on casino_bets
  const i85 = await c.query(
    "SELECT indexdef FROM pg_indexes WHERE indexname = 'casino_bets_user_transaction_key'"
  )
  checks.push({ name: '0085 casino_bets placement unique', ok: i85.rowCount === 1, detail: i85.rows[0]?.indexdef || 'MISSING' })

  console.log('')
  for (const ch of checks) console.log(`${ch.ok ? 'PASS' : 'FAIL'}  ${ch.name}\n      ${ch.detail}`)
  const allOk = checks.every((c) => c.ok)
  console.log('\n' + (allOk ? 'ALL GOOD: 0083/0084/0085 are correctly applied.' : 'SOME CHECKS FAILED (see FAIL above).'))
  await c.end()
  if (!allOk) process.exit(1)
}

main().catch((e) => { console.error('verify failed:', e.message); process.exit(1) })
