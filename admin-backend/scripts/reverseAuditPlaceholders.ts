/**
 * Reverse audit-placeholder rows in agent_credit_ledger and restore the whitelabel credit.
 *
 * For each placeholder (rows where meta.audit_placeholder=true) belonging to the given
 * whitelabel, this script:
 *   1. SHIFTs every subsequent ledger row's balance_before/balance_after by the placeholder's
 *      amount (so the chain stays intact AFTER removal).
 *   2. UPDATEs the whitelabel: credit_available += amount, credit_used -= amount.
 *   3. DELETEs the placeholder row.
 *
 * Net effect: the deleted player's transactions are treated as if they NEVER happened. No
 * visible "[Deleted user adjustment]" row in history; chain stays consistent; whitelabel
 * gets its credit back.
 *
 * Usage:
 *   npm run reverse:placeholders -- --tenant gamdaddy-com             # DRY-RUN
 *   npm run reverse:placeholders -- --tenant gamdaddy-com --apply     # COMMIT
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
  console.error('Usage: npm run reverse:placeholders -- --tenant <wl-id> [--apply]')
  process.exit(2)
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

// 1. Find all audit-placeholder rows for this whitelabel (chronological)
const phs = await c.query(
  `SELECT id, created_at, amount, balance_before, balance_after, reason
   FROM agent_credit_ledger
   WHERE ((from_entity_type='whitelabel' AND from_entity_id=$1)
       OR (to_entity_type='whitelabel'   AND to_entity_id=$1))
     AND meta->>'audit_placeholder' = 'true'
   ORDER BY created_at ASC, id ASC`,
  [tenant],
)

if (phs.rows.length === 0) {
  console.log(`Tenant ${tenant}: 0 audit-placeholders found. Nothing to reverse.`)
  await c.end()
  process.exit(0)
}

console.log(`Tenant: ${tenant}  |  placeholders: ${phs.rows.length}  |  mode: ${apply ? '*** APPLY ***' : 'dry-run'}\n`)

// 2. Preview: for each placeholder, count subsequent rows that would shift
const previews: Array<{ at: string; amount: string; will_shift_rows: number }> = []
for (const p of phs.rows) {
  const cnt = await c.query(
    `SELECT COUNT(*)::int n FROM agent_credit_ledger
     WHERE ((from_entity_type='whitelabel' AND from_entity_id=$1)
         OR (to_entity_type='whitelabel'   AND to_entity_id=$1))
       AND created_at > $2 AND id != $3`,
    [tenant, p.created_at, p.id],
  )
  previews.push({ at: p.created_at.toISOString(), amount: p.amount, will_shift_rows: cnt.rows[0].n })
}
console.table(previews)

const totalAmount = phs.rows.reduce((s, p) => s + Number(p.amount), 0)
const wlBefore = await c.query(
  `SELECT credit_available, credit_used FROM whitelabels WHERE id=$1`, [tenant],
)
const ca0 = Number(wlBefore.rows[0].credit_available)
const cu0 = Number(wlBefore.rows[0].credit_used)
console.log(`\nTotal amount to restore: ₹${totalAmount.toFixed(2)}`)
console.log(`Whitelabel BEFORE: credit_available=₹${ca0.toFixed(2)}  credit_used=₹${cu0.toFixed(2)}`)
console.log(`Whitelabel AFTER : credit_available=₹${(ca0 + totalAmount).toFixed(2)}  credit_used=₹${(cu0 - totalAmount).toFixed(2)}`)

if (!apply) {
  console.log('\n(dry-run) Above changes WOULD be made. Re-run with --apply to commit.')
  await c.end()
  process.exit(0)
}

// 3. Apply in a transaction
try {
  await c.query('BEGIN')
  for (const p of phs.rows) {
    const amt = p.amount  // numeric string, passed straight to pg as ::numeric
    const shift = await c.query(
      `UPDATE agent_credit_ledger
       SET balance_before = balance_before + $1::numeric,
           balance_after  = balance_after  + $1::numeric
       WHERE ((from_entity_type='whitelabel' AND from_entity_id=$2)
           OR (to_entity_type='whitelabel'   AND to_entity_id=$2))
         AND created_at > $3
         AND id != $4`,
      [amt, tenant, p.created_at, p.id],
    )
    await c.query(`DELETE FROM agent_credit_ledger WHERE id=$1`, [p.id])
    console.log(`  Placeholder ${p.id.slice(0,8)} @ ${p.created_at.toISOString()} amount=${amt}: shifted ${shift.rowCount} rows, deleted placeholder`)
  }
  const wlUpd = await c.query(
    `UPDATE whitelabels
     SET credit_available = (credit_available::numeric + $1::numeric),
         credit_used      = (credit_used::numeric      - $1::numeric)
     WHERE id = $2`,
    [totalAmount.toString(), tenant],
  )
  console.log(`  Whitelabel updated: +₹${totalAmount.toFixed(2)} to credit_available, -₹${totalAmount.toFixed(2)} from credit_used  (${wlUpd.rowCount} row)`)

  await c.query('COMMIT')
  console.log('\n✅ COMMITTED. Verifying...')

  // 4. Verify chain intact + ledger-latest matches whitelabel
  const chk = await c.query(
    `SELECT balance_before, balance_after
     FROM agent_credit_ledger
     WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
        OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
     ORDER BY created_at ASC, id ASC`,
    [tenant],
  )
  let prev: string | null = null
  let gaps = 0
  for (const r of chk.rows) {
    if (prev !== null && prev !== String(r.balance_before)) gaps++
    prev = String(r.balance_after)
  }
  const wlAfter = await c.query(
    `SELECT credit_available, credit_used FROM whitelabels WHERE id=$1`, [tenant],
  )
  const ca1 = String(wlAfter.rows[0].credit_available)
  const cu1 = String(wlAfter.rows[0].credit_used)
  console.log(`  Chain gaps                : ${gaps}  ${gaps === 0 ? '✓' : '❌'}`)
  console.log(`  Latest ledger after       : ${prev}`)
  console.log(`  Whitelabel credit_available: ${ca1}  ${prev === ca1 ? '✓ matches' : '❌ MISMATCH'}`)
  console.log(`  Whitelabel credit_used     : ${cu1}`)

  // Also check no audit-placeholders remain
  const leftover = await c.query(
    `SELECT COUNT(*)::int n FROM agent_credit_ledger
     WHERE ((from_entity_type='whitelabel' AND from_entity_id=$1)
         OR (to_entity_type='whitelabel'   AND to_entity_id=$1))
       AND meta->>'audit_placeholder' = 'true'`,
    [tenant],
  )
  console.log(`  Remaining audit-placeholders: ${leftover.rows[0].n}  ${leftover.rows[0].n === 0 ? '✓' : '❌'}`)
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('❌ FAILED, rolled back:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
