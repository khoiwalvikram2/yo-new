/**
 * Refund a hard-deleted user's allocated credit back to the whitelabel pool AND repair the
 * agent_credit_ledger chain so balance_before/after stays continuous.
 *
 * Context: when a user is hard-deleted (delete:user), the "Direct wallet deposit for player N"
 * DEPOSIT row in agent_credit_ledger is removed. That row had taken the whitelabel credit DOWN by
 * `amount`. Deleting it leaves the surrounding rows' snapshots unchanged, so:
 *   - prev.balance_after  = (level WITH the deduction still applied to later rows)
 *   - next.balance_before = prev.balance_after - amount   (gap of -amount)
 * and every row AFTER the gap is `amount` too LOW (still carrying the deleted deduction).
 *
 * Refund = remove that deduction's lingering effect:
 *   1. Detect exactly ONE gap of -amount in the whitelabel chain.
 *   2. Add +amount to balance_before AND balance_after of every row FROM the gap onward.
 *      -> closes the gap (next.before+amount == prev.after) and lifts the chain head by +amount.
 *   3. Add +amount to whitelabels.credit_available and subtract it from credit_used.
 *   4. Verify chain is continuous and latest balance_after == credit_available.
 *
 * Run AFTER delete:user has removed the player's rows.
 *
 * Usage:
 *   npm run refund-delete:credit -- --tenant grandwinn-com --amount 35000              # DRY-RUN
 *   npm run refund-delete:credit -- --tenant grandwinn-com --amount 35000 --apply      # COMMIT
 */

import 'dotenv/config'
import pg from 'pg'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const tenant = arg('tenant')
const amountStr = arg('amount')
const apply = process.argv.includes('--apply')

if (!tenant || !amountStr || Number.isNaN(Number(amountStr))) {
  console.error('Usage: npm run refund-delete:credit -- --tenant <whitelabel-id> --amount <num> [--apply]')
  process.exit(2)
}
const amount = Number(amountStr)
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }

const r2 = (n: number) => Math.round(n * 100) / 100

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

try {
  await c.query('BEGIN')

  const chain = await c.query(
    `SELECT id, created_at, balance_before, balance_after, reason
       FROM agent_credit_ledger
      WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
         OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
      ORDER BY created_at ASC, id ASC`,
    [tenant],
  )
  console.log(`Tenant: ${tenant} | chain rows: ${chain.rows.length} | refund amount: ${amount.toFixed(2)} | mode: ${apply ? '*** APPLY ***' : 'dry-run'}\n`)

  // Find gaps (prev.balance_after != next.balance_before).
  type Gap = { idx: number; nextId: string; prevAfter: number; nextBefore: number; diff: number }
  const gaps: Gap[] = []
  for (let i = 1; i < chain.rows.length; i++) {
    const prevAfter = r2(Number(chain.rows[i - 1].balance_after))
    const nextBefore = r2(Number(chain.rows[i].balance_before))
    if (prevAfter !== nextBefore) {
      gaps.push({ idx: i, nextId: chain.rows[i].id, prevAfter, nextBefore, diff: r2(nextBefore - prevAfter) })
    }
  }

  if (gaps.length === 0) {
    console.error('❌ No gap found. Did delete:user run first? Or already repaired? Aborting (no changes).')
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }
  if (gaps.length > 1) {
    console.error(`❌ Found ${gaps.length} gaps — expected exactly 1. Aborting to avoid guessing.`)
    console.table(gaps)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  const gap = gaps[0]
  console.log(`Gap @ row index ${gap.idx} (id ${gap.nextId}): prev.after=${gap.prevAfter} next.before=${gap.nextBefore} diff=${gap.diff}`)

  // A deleted DEPOSIT (credit deducted by `amount`) leaves a gap of EXACTLY -amount.
  if (r2(gap.diff) !== r2(-amount)) {
    console.error(`❌ Gap diff (${gap.diff}) != expected -${amount} (a deleted DEPOSIT of ${amount} should leave a -${amount} gap). Aborting.`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  // Rows to lift = every row FROM the gap onward (index gap.idx .. end). Add +amount to both balances.
  const liftRows = chain.rows.slice(gap.idx)
  const oldHead = r2(Number(chain.rows[chain.rows.length - 1].balance_after))
  const newHead = r2(oldHead + amount)

  const wl = await c.query('SELECT credit_limit, credit_used, credit_available FROM whitelabels WHERE id=$1', [tenant])
  if (wl.rows.length === 0) { console.error('❌ whitelabel not found'); await c.query('ROLLBACK'); await c.end(); process.exit(1) }
  const curAvail = r2(Number(wl.rows[0].credit_available))
  const curUsed = r2(Number(wl.rows[0].credit_used))
  const newAvail = r2(curAvail + amount)
  const newUsed = r2(curUsed - amount)

  console.log(`\nRows to lift (+${amount}): ${liftRows.length}`)
  console.log(`chain head : ${oldHead} -> ${newHead}`)
  console.log(`credit_available : ${curAvail} -> ${newAvail}`)
  console.log(`credit_used      : ${curUsed} -> ${newUsed}`)
  if (newAvail !== newHead) {
    console.log(`\n⚠ After refund credit_available (${newAvail}) != chain head (${newHead}); they were not in lockstep before. Review.`)
  } else {
    console.log('\n✅ After refund, credit_available will exactly match the new chain head.')
  }

  if (!apply) {
    console.log('\n(dry-run) WOULD lift the above rows by +amount and bump whitelabel credit. Re-run with --apply.')
    await c.query('ROLLBACK'); await c.end(); process.exit(0)
  }

  // Apply: lift balances on every post-gap row.
  const ids = liftRows.map((r) => r.id)
  const upd = await c.query(
    `UPDATE agent_credit_ledger
        SET balance_before = balance_before + $2::numeric,
            balance_after  = balance_after  + $2::numeric
      WHERE id = ANY($1)`,
    [ids, amount],
  )
  console.log(`\n  lifted ${upd.rowCount} ledger rows by +${amount}`)

  await c.query(
    'UPDATE whitelabels SET credit_available=$2::numeric, credit_used=$3::numeric WHERE id=$1',
    [tenant, newAvail, newUsed],
  )
  console.log(`  whitelabel credit_available -> ${newAvail}, credit_used -> ${newUsed}`)

  // Re-verify.
  const check = await c.query(
    `SELECT balance_before, balance_after FROM agent_credit_ledger
      WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
         OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
      ORDER BY created_at ASC, id ASC`,
    [tenant],
  )
  let leftGaps = 0
  for (let i = 1; i < check.rows.length; i++) {
    if (r2(Number(check.rows[i - 1].balance_after)) !== r2(Number(check.rows[i].balance_before))) leftGaps++
  }
  const finalHead = r2(Number(check.rows[check.rows.length - 1].balance_after))
  const wl2 = await c.query('SELECT credit_available FROM whitelabels WHERE id=$1', [tenant])
  const finalAvail = r2(Number(wl2.rows[0].credit_available))

  if (leftGaps !== 0 || finalHead !== finalAvail) {
    console.error(`\n❌ Post-check failed (gaps=${leftGaps}, head=${finalHead}, avail=${finalAvail}). Rolling back.`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  await c.query('COMMIT')
  console.log('\n✅ COMMITTED.')
  console.log(`   chain gaps remaining: ${leftGaps}`)
  console.log(`   chain head: ${finalHead} | credit_available: ${finalAvail} | match: YES ✅`)
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
