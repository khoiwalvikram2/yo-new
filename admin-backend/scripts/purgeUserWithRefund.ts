/**
 * Hard-delete a user AND refund their allocated credit back to the whitelabel pool AND repair the
 * agent_credit_ledger running-balance chain — all in ONE transaction.
 *
 * What it does:
 *   1. Validates the user + tenant.
 *   2. Deletes every related row across all dependent tables (incl. ledger_entries by wallet_id).
 *      This removes the "Direct wallet deposit for player N" rows from agent_credit_ledger too,
 *      which leaves running-balance gaps in the whitelabel chain.
 *   3. Walks the whitelabel agent_credit_ledger chain, finds the gap(s), and rewrites the
 *      balance_before/after of every following row so the chain is continuous again (auto-detected
 *      amount — no need to pass it).
 *   4. Sets whitelabels.credit_available = repaired chain head, credit_used = credit_limit - available
 *      (i.e. the deleted user's deducted credit is returned to the pool).
 *   5. Verifies: no gaps remain AND chain head == credit_available, else ROLLBACK.
 *
 * Usage (DRY-RUN prints what would change, no commit):
 *   npm run purge:user-refund -- --userId 487 --tenant grandwinn-com
 * Commit:
 *   npm run purge:user-refund -- --userId 487 --tenant grandwinn-com --apply
 *
 * Safety: default dry-run; --apply required. Single transaction; any error -> full ROLLBACK.
 * Irreversible on --apply. Take a pg_dump backup first on production.
 */

import 'dotenv/config'
import pg from 'pg'

type T = { table: string; column: string; cast?: string }

// children first, then users last. (ledger_entries handled separately via wallet_id.)
const TABLES: T[] = [
  { table: 'sports_bets',                column: 'user_id' },
  { table: 'casino_bets',                column: 'user_id' },
  { table: 'matka_bets',                 column: 'user_id' },
  { table: 'betting_patterns',           column: 'user_id' },
  { table: 'user_casino_sessions',       column: 'user_id' },
  { table: 'reporting_daily_snapshots',  column: 'player_id' },
  { table: 'wallet_ledger',              column: 'user_id' },
  { table: 'wallets',                    column: 'user_id' },
  { table: 'bonus_awards',               column: 'user_id' },
  { table: 'bonus_credits',              column: 'user_id' },
  { table: 'deposit_requests',           column: 'user_id' },
  { table: 'referral_links',             column: 'user_id' },
  { table: 'player_limits',              column: 'user_id' },
  { table: 'vip_members',                column: 'user_id' },
  { table: 'admin_ip_allowlist',         column: 'user_id' },
  { table: 'casino_game_bet_settings',   column: 'player_id', cast: '::text' },
  { table: 'agent_player_credits',       column: 'player_id' },
  { table: 'casino_likes',               column: 'user_id' },
  { table: 'casino_recent',              column: 'user_id' },
  { table: 'notifications',              column: 'user_id' },
  { table: 'player_credit_adjustments',  column: 'player_id' },
  { table: 'sports_bookmarks',           column: 'user_id' },
  { table: 'sports_recent',              column: 'user_id' },
  { table: 'user_payout_accounts',       column: 'user_id' },
  { table: 'withdrawal_requests',        column: 'user_id' },
  { table: 'user_roles',                 column: 'user_id' },
  { table: 'users',                      column: 'id' },
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const r2 = (n: number) => Math.round(n * 100) / 100

const userIdStr = arg('userId')
const tenant = arg('tenant')
const apply = process.argv.includes('--apply')

if (!userIdStr || !tenant || Number.isNaN(parseInt(userIdStr, 10))) {
  console.error('Usage: npm run purge:user-refund -- --userId <num> --tenant <str> [--apply]')
  process.exit(2)
}
const userId = parseInt(userIdStr, 10)
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const u = await client.query('SELECT id, name, phone, tenant, status FROM users WHERE id=$1', [userId])
if (u.rows.length === 0) { console.error(`User id=${userId} NOT FOUND. Aborting.`); await client.end(); process.exit(1) }
if (u.rows[0].tenant !== tenant) {
  console.error(`User id=${userId} belongs to tenant '${u.rows[0].tenant}', not '${tenant}'. Aborting.`)
  await client.end(); process.exit(1)
}
console.log('Target user :', u.rows[0])
console.log('Mode        :', apply ? '*** APPLY (will COMMIT) ***' : 'dry-run (no commit, ROLLBACK)')
console.log('')

const chainSql =
  `SELECT id, created_at, balance_before, balance_after FROM agent_credit_ledger
    WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
       OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
    ORDER BY created_at ASC, id ASC`

function findGaps(rows: any[]): { idx: number; diff: number }[] {
  const gaps: { idx: number; diff: number }[] = []
  for (let i = 1; i < rows.length; i++) {
    const prevAfter = r2(Number(rows[i - 1].balance_after))
    const nextBefore = r2(Number(rows[i].balance_before))
    if (prevAfter !== nextBefore) gaps.push({ idx: i, diff: r2(nextBefore - prevAfter) })
  }
  return gaps
}

try {
  await client.query('BEGIN')

  // --- snapshot chain BEFORE delete (for reporting) ---
  const before = await client.query(chainSql, [tenant])
  const headBefore = before.rows.length ? r2(Number(before.rows[before.rows.length - 1].balance_after)) : 0

  // ===== 1. DELETE user rows =====
  // ledger_entries by wallet_id (before wallets are gone)
  let totalDeleted = 0
  const wr = await client.query('SELECT id FROM wallets WHERE user_id=$1', [userId])
  const walletIds = wr.rows.map((r) => r.id as number)
  if (walletIds.length) {
    const n = (await client.query('SELECT COUNT(*)::int n FROM ledger_entries WHERE wallet_id = ANY($1)', [walletIds])).rows[0].n as number
    if (n > 0) {
      totalDeleted += n
      if (apply) {
        const d = await client.query('DELETE FROM ledger_entries WHERE wallet_id = ANY($1)', [walletIds])
        console.log(`  ledger_entries                   wallet refs  deleted  ${d.rowCount}`)
      } else console.log(`  ledger_entries                   wallet refs  would del ${n}`)
    }
  }
  for (const { table, column, cast } of TABLES) {
    const ph = cast ? `$1${cast}` : '$1'
    let n = 0
    try { n = (await client.query(`SELECT COUNT(*)::int n FROM "${table}" WHERE ${column}=${ph}`, [userId])).rows[0].n as number }
    catch (e) { console.log(`  ${table.padEnd(32)} ⚠ skipped (${(e as Error).message})`); continue }
    if (n === 0) continue
    totalDeleted += n
    if (apply) {
      const d = await client.query(`DELETE FROM "${table}" WHERE ${column}=${ph}`, [userId])
      console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} deleted  ${d.rowCount}`)
    } else console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} would del ${n}`)
  }
  // audit_logs (player refs)
  try {
    const params = [userId, `%"id":${userId}%`, `%"userId":${userId}%`]
    const whereAudit = `(resource_type='player' AND resource_id=$1::text) OR before::text ILIKE $2 OR after::text ILIKE $2 OR before::text ILIKE $3 OR after::text ILIKE $3`
    const n = (await client.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE ${whereAudit}`, params)).rows[0].n as number
    if (n > 0) {
      totalDeleted += n
      if (apply) { const d = await client.query(`DELETE FROM audit_logs WHERE ${whereAudit}`, params); console.log(`  audit_logs                       player refs  deleted  ${d.rowCount}`) }
      else console.log(`  audit_logs                       player refs  would del ${n}`)
    }
  } catch (e) { console.log(`  audit_logs                       ⚠ skipped (${(e as Error).message})`) }
  // agent_credit_ledger player rows (entity + reason) — these are the deposit rows that create the gap
  const reasonRx = `\\m(player\\s+|player\\s+id:\\s*|userid[=:]?\\s*)${userId}\\M`
  try {
    const entSql = `(from_entity_type='player' AND from_entity_id=$1::text) OR (to_entity_type='player' AND to_entity_id=$1::text)`
    const ne = (await client.query(`SELECT COUNT(*)::int n FROM agent_credit_ledger WHERE ${entSql}`, [userId])).rows[0].n as number
    const nr = (await client.query(`SELECT COUNT(*)::int n FROM agent_credit_ledger WHERE reason ~* $1`, [reasonRx])).rows[0].n as number
    totalDeleted += ne + nr
    if (apply) {
      const d1 = await client.query(`DELETE FROM agent_credit_ledger WHERE ${entSql}`, [userId])
      const d2 = await client.query(`DELETE FROM agent_credit_ledger WHERE reason ~* $1`, [reasonRx])
      console.log(`  agent_credit_ledger              entity refs  deleted  ${d1.rowCount}`)
      console.log(`  agent_credit_ledger              reason text  deleted  ${d2.rowCount}`)
    } else {
      console.log(`  agent_credit_ledger              entity refs  would del ${ne}`)
      console.log(`  agent_credit_ledger              reason text  would del ${nr}`)
    }
  } catch (e) { console.log(`  agent_credit_ledger              ⚠ skipped (${(e as Error).message})`) }

  console.log(`\nTotal rows ${apply ? 'deleted' : 'would delete'}: ${totalDeleted}`)

  // ===== 2. REPAIR chain + REFUND credit =====
  // In dry-run, the deletes were not executed, so simulate the effect by removing the player's
  // deposit rows from the in-memory chain before computing gaps.
  let chainRows: any[]
  if (apply) {
    chainRows = (await client.query(chainSql, [tenant])).rows
  } else {
    const delIds = new Set(
      (await client.query(
        `SELECT id FROM agent_credit_ledger
          WHERE ((from_entity_type='whitelabel' AND from_entity_id=$1) OR (to_entity_type='whitelabel' AND to_entity_id=$1))
            AND ( (from_entity_type='player' AND from_entity_id=$2::text)
               OR (to_entity_type='player'   AND to_entity_id=$2::text)
               OR reason ~* $3 )`,
        [tenant, userId, reasonRx],
      )).rows.map((r) => r.id),
    )
    chainRows = before.rows.filter((r) => !delIds.has(r.id))
  }

  const gaps = findGaps(chainRows)
  if (gaps.length === 0) {
    console.log('\nNo ledger gap — nothing to refund (user had no whitelabel credit deposit). Credit pool unchanged.')
  } else {
    // Cumulative shift: each gap of diff d needs all following rows shifted by -d to close it.
    let cumShift = 0
    const newBalById = new Map<string, { before: number; after: number }>()
    for (let i = 0; i < chainRows.length; i++) {
      if (gaps.length && gaps.find((g) => g.idx === i)) {
        const g = gaps.find((gg) => gg.idx === i)!
        cumShift = r2(cumShift - g.diff)
      }
      newBalById.set(chainRows[i].id, {
        before: r2(Number(chainRows[i].balance_before) + cumShift),
        after: r2(Number(chainRows[i].balance_after) + cumShift),
      })
    }
    const newHead = r2(Number(chainRows[chainRows.length - 1].balance_after) + cumShift)
    const refund = r2(cumShift) // net credit returned to pool

    const wl = await client.query('SELECT credit_limit, credit_used, credit_available FROM whitelabels WHERE id=$1', [tenant])
    const limit = r2(Number(wl.rows[0].credit_limit))
    const curAvail = r2(Number(wl.rows[0].credit_available))
    const newAvail = r2(curAvail + refund)
    const newUsed = r2(limit - newAvail)

    console.log(`\nLedger gaps found: ${gaps.length} | net refund to pool: ${refund}`)
    console.log(`chain head: ${headBefore} -> ${newHead}`)
    console.log(`credit_available: ${curAvail} -> ${newAvail} | credit_used -> ${newUsed}`)

    if (apply) {
      for (const [id, b] of newBalById) {
        await client.query('UPDATE agent_credit_ledger SET balance_before=$2::numeric, balance_after=$3::numeric WHERE id=$1', [id, b.before, b.after])
      }
      await client.query('UPDATE whitelabels SET credit_available=$2::numeric, credit_used=$3::numeric WHERE id=$1', [tenant, newAvail, newUsed])

      const check = (await client.query(chainSql, [tenant])).rows
      const leftGaps = findGaps(check).length
      const finalHead = check.length ? r2(Number(check[check.length - 1].balance_after)) : 0
      const finalAvail = r2(Number((await client.query('SELECT credit_available FROM whitelabels WHERE id=$1', [tenant])).rows[0].credit_available))
      if (leftGaps !== 0 || finalHead !== finalAvail) {
        console.error(`\n❌ Post-check failed (gaps=${leftGaps}, head=${finalHead}, avail=${finalAvail}). Rolling back.`)
        await client.query('ROLLBACK'); await client.end(); process.exit(1)
      }
      console.log(`\n✅ chain gaps remaining: ${leftGaps} | head: ${finalHead} == credit_available: ${finalAvail} ✅`)
    }
  }

  if (apply) { await client.query('COMMIT'); console.log('\n✅ COMMITTED. User purged + credit refunded + ledger repaired.') }
  else { await client.query('ROLLBACK'); console.log('\n(dry-run) ROLLBACK. Re-run with --apply to commit.') }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await client.end()
}
