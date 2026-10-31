/**
 * Repair gaps in agent_credit_ledger chain for a whitelabel entity by inserting
 * anonymized placeholder rows where rows were hard-deleted (e.g. via delete:user).
 *
 * Why: each row stores balance_before/balance_after as snapshots. Deleting a middle row
 * leaves the surrounding rows' snapshots unchanged, so prev_after != next_before — a chain
 * gap. The placeholder is a single row that bridges the gap (same delta, same surrounding
 * balances) with reason "[Deleted user adjustment]" and meta.audit_placeholder=true. The
 * actual whitelabel balance (whitelabels.credit_available) is unaffected either way.
 *
 * Usage:
 *   npm run repair:ledger-chain -- --tenant gamdaddy-com             # DRY-RUN
 *   npm run repair:ledger-chain -- --tenant gamdaddy-com --apply     # COMMIT
 */

import 'dotenv/config'
import pg from 'pg'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const tenant = arg('tenant')
const apply  = process.argv.includes('--apply')
if (!tenant) {
  console.error('Usage: npm run repair:ledger-chain -- --tenant <whitelabel-id> [--apply]')
  process.exit(2)
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

// Walk the chain for this whitelabel in chronological order
const chain = await c.query(
  `SELECT id, created_at, transaction_type, amount, balance_before, balance_after, reason
   FROM agent_credit_ledger
   WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
      OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
   ORDER BY created_at ASC, id ASC`,
  [tenant],
)
console.log(`Tenant: ${tenant} | chain rows: ${chain.rows.length} | mode: ${apply ? '*** APPLY ***' : 'dry-run'}\n`)

type Gap = {
  prevId: string; prevAt: Date; prevAfter: string
  nextId: string; nextAt: Date; nextBefore: string
  amount: string                // |nextBefore - prevAfter|
  direction: 'deduction' | 'addition'
  bridgeAt: Date                // midpoint between prev and next
}
const gaps: Gap[] = []
let prev: { id: string; at: Date; after: string } | null = null
for (const row of chain.rows) {
  const before = String(row.balance_before)
  const after  = String(row.balance_after)
  const at     = row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  if (prev && prev.after !== before) {
    const diff = Number(before) - Number(prev.after)
    gaps.push({
      prevId: prev.id, prevAt: prev.at, prevAfter: prev.after,
      nextId: row.id,  nextAt: at,      nextBefore: before,
      amount: Math.abs(diff).toFixed(2),
      direction: diff < 0 ? 'deduction' : 'addition',
      bridgeAt: new Date((prev.at.getTime() + at.getTime()) / 2),
    })
  }
  prev = { id: row.id, at, after }
}

if (gaps.length === 0) {
  console.log('✅ Chain already intact — koi gap nahi mila, kuch repair nahi karna.')
  await c.end()
  process.exit(0)
}

console.log(`Found ${gaps.length} gap(s):\n`)
console.table(gaps.map((g) => ({
  at_between: `${g.prevAt.toISOString()} → ${g.nextAt.toISOString()}`,
  bridge_at: g.bridgeAt.toISOString(),
  amount: g.amount,
  direction: g.direction,
  balance_before: g.prevAfter,
  balance_after: g.nextBefore,
})))

if (!apply) {
  console.log('\n(dry-run) Above placeholder row(s) WOULD be inserted to bridge each gap.')
  console.log('Re-run with --apply to actually insert.')
  await c.end()
  process.exit(0)
}

// APPLY: insert placeholder rows in a transaction
try {
  await c.query('BEGIN')
  for (const g of gaps) {
    // For these whitelabel self-rows, type=DEPOSIT when deducting credit (matches existing pattern),
    // RELEASE/ADJUSTMENT when adding back. Use ADJUSTMENT to make the placeholder clearly distinguishable.
    const txnType = 'ADJUSTMENT'
    const meta = JSON.stringify({
      audit_placeholder: true,
      bridges_gap: true,
      original_direction: g.direction,
      note: 'Inserted by repair:ledger-chain after a user hard-delete removed the original row.',
    })
    await c.query(
      `INSERT INTO agent_credit_ledger
         (tenant_id, from_entity_type, from_entity_id, to_entity_type, to_entity_id,
          transaction_type, amount, currency, balance_before, balance_after, reason, meta, created_at)
       VALUES
         ($1, 'whitelabel', $1, 'whitelabel', $1,
          $2::credit_transaction_type, $3::numeric, 'INR', $4::numeric, $5::numeric, $6, $7::jsonb, $8)`,
      [tenant, txnType, g.amount, g.prevAfter, g.nextBefore,
       '[Deleted user adjustment] (audit placeholder — bridges chain gap)',
       meta, g.bridgeAt],
    )
    console.log(`  inserted placeholder @ ${g.bridgeAt.toISOString()}  amount=${g.amount}  ${g.prevAfter} → ${g.nextBefore}`)
  }
  await c.query('COMMIT')
  console.log('\n✅ COMMITTED. Re-verifying chain...')

  // Re-walk to confirm
  const check = await c.query(
    `SELECT balance_before, balance_after
     FROM agent_credit_ledger
     WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
        OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
     ORDER BY created_at ASC, id ASC`,
    [tenant],
  )
  let prev2: string | null = null
  let leftGaps = 0
  for (const r of check.rows) {
    if (prev2 !== null && prev2 !== String(r.balance_before)) leftGaps++
    prev2 = String(r.balance_after)
  }
  console.log(leftGaps === 0
    ? '✅ Chain ab fully intact — koi gap nahi.'
    : `❌ ${leftGaps} gap abhi bhi hai — investigate.`)
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('❌ FAILED, rolled back:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
