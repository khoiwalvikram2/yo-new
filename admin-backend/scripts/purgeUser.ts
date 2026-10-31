/**
 * Purge a user — single-command "treat as if this player never existed".
 *
 * Combines delete:user + repair:ledger-chain + reverse:placeholders into ONE atomic transaction:
 *   1. DELETE all rows for the user across every dependent table (27 tables + audit_logs).
 *   2. DELETE agent_credit_ledger rows that reference the user (entity refs + reason text).
 *   3. Walk the whitelabel's ledger chain; for each gap left by step 2:
 *        a. SHIFT every subsequent row's balance_before/balance_after by the gap amount.
 *        b. Accumulate the offset to restore to the whitelabel.
 *   4. UPDATE whitelabels.credit_available += total offset, credit_used -= total offset.
 *   5. Verify chain intact + whitelabel balance == latest ledger after.
 *
 * Net effect: player + all data gone, no audit-placeholder rows visible, history reads as
 * if the player never existed, whitelabel credit restored.
 *
 * Usage:
 *   npm run purge:user -- --userId <num> --tenant <wl-id>             # DRY-RUN (counts only)
 *   npm run purge:user -- --userId <num> --tenant <wl-id> --apply     # COMMIT (atomic)
 *
 * Irreversible. Local cleanup / test data only — gambling production usually requires
 * record retention; verify with compliance before running on live.
 */

import 'dotenv/config'
import pg from 'pg'

type T = { table: string; column: string; cast?: string }

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
const userIdStr = arg('userId')
const tenant    = arg('tenant')
const apply     = process.argv.includes('--apply')
if (!userIdStr || !tenant || Number.isNaN(parseInt(userIdStr, 10))) {
  console.error('Usage: npm run purge:user -- --userId <num> --tenant <wl-id> [--apply]')
  console.error('  DRY-RUN by default (counts only). Add --apply to commit.')
  process.exit(2)
}
const userId = parseInt(userIdStr, 10)
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(2) }

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

const u = await c.query('SELECT id, name, email, phone, tenant, status FROM users WHERE id=$1', [userId])
const userExists = u.rows.length > 0
if (userExists) {
  if (u.rows[0].tenant !== tenant) {
    console.error(`User ${userId} belongs to tenant '${u.rows[0].tenant}', not '${tenant}'. Abort.`)
    await c.end(); process.exit(1)
  }
  console.log('Target user:', { id: u.rows[0].id, name: u.rows[0].name, phone: u.rows[0].phone, tenant: u.rows[0].tenant, status: u.rows[0].status })
} else {
  console.log(`Target user: id=${userId} NOT FOUND in users table — running ORPHAN-CLEANUP only.`)
}
console.log(`Mode: ${apply ? '*** APPLY (will COMMIT) ***' : 'DRY-RUN (will ROLLBACK)'}\n`)

try {
  await c.query('BEGIN')

  // ---------- Phase 0: pre-fetch user's wallet IDs ----------
  // ledger_entries / other wallet-linked tables key off wallet_id, not user_id. We must collect
  // these BEFORE deleting from wallets (else the link is gone and rows become unrecoverable orphans).
  let userWalletIds: number[] = []
  if (userExists) {
    const wq = await c.query('SELECT id FROM wallets WHERE user_id=$1', [userId])
    userWalletIds = wq.rows.map((r: any) => r.id)
    if (userWalletIds.length) console.log(`--- Phase 0: user's wallet IDs: [${userWalletIds.join(', ')}] ---\n`)
  }
  // Orphan-cleanup mode: pick up ledger_entries whose wallet_id no longer references a wallet.
  // We can't tell from user_id (user already gone) so we clean all dangling rows for the tenant.
  // (Safe — they're orphans by definition; no live user owns them.)

  // ---------- Phase 1: delete user rows from all 27 tables ----------
  console.log('--- Phase 1: delete from user tables ---')
  let phase1 = 0
  for (const { table, column, cast } of TABLES) {
    if (!userExists && (table === 'users' || table === 'user_roles')) continue
    const ph = cast ? `$1${cast}` : '$1'
    try {
      const cnt = (await c.query(`SELECT COUNT(*)::int n FROM "${table}" WHERE ${column}=${ph}`, [userId])).rows[0].n
      if (!cnt) continue
      phase1 += cnt
      const del = await c.query(`DELETE FROM "${table}" WHERE ${column}=${ph}`, [userId])
      console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} ${apply ? 'deleted' : 'would del'} ${apply ? del.rowCount : cnt}`)
    } catch (e) { console.log(`  ${table.padEnd(32)} ⚠ ${(e as Error).message}`) }
  }

  // ---------- Phase 1b: ledger_entries (linked via wallet_id, NOT user_id) ----------
  // wallet_ledger and ledger_entries are two separate tables. The Phase-1 loop handles wallet_ledger
  // (which has user_id). ledger_entries only has wallet_id — we delete by the captured wallet IDs
  // for an existing user, or by orphan-detection (wallet no longer exists) for an already-deleted user.
  let leCnt = 0
  try {
    if (userWalletIds.length > 0) {
      const cnt = (await c.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE tenant=$1 AND wallet_id = ANY($2::int[])`, [tenant, userWalletIds])).rows[0].n
      leCnt = cnt
      if (cnt) {
        if (apply) await c.query(`DELETE FROM ledger_entries WHERE tenant=$1 AND wallet_id = ANY($2::int[])`, [tenant, userWalletIds])
        console.log(`  ledger_entries (by wallet_id)    ${'wallet_id'.padEnd(12)} ${apply ? 'deleted' : 'would del'} ${cnt}`)
      }
    } else if (!userExists) {
      // orphan mode: rows whose wallet_id doesn't reference any wallet
      const cnt = (await c.query(
        `SELECT COUNT(*)::int n FROM ledger_entries le
         WHERE le.tenant=$1
           AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.id = le.wallet_id)`, [tenant])).rows[0].n
      leCnt = cnt
      if (cnt) {
        if (apply) await c.query(
          `DELETE FROM ledger_entries le
           WHERE le.tenant=$1
             AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.id = le.wallet_id)`, [tenant])
        console.log(`  ledger_entries (orphans)         ${'wallet_id'.padEnd(12)} ${apply ? 'deleted' : 'would del'} ${cnt}`)
      }
    }
  } catch (e) {
    console.log(`  ledger_entries ⚠ ${(e as Error).message}`)
  }
  phase1 += leCnt

  // ---------- Phase 2: agent_credit_ledger orphan refs (entity + reason text) ----------
  console.log('\n--- Phase 2: agent_credit_ledger orphan refs ---')
  const rgx = `\\m(player\\s+|player\\s+id:\\s*|userid[=:]?\\s*)${userId}\\M`
  const acDel = await c.query(
    `DELETE FROM agent_credit_ledger
     WHERE (from_entity_type='player' AND from_entity_id=$1::text)
        OR (to_entity_type='player'   AND to_entity_id=$1::text)
        OR reason ~* $2`,
    [userId, rgx],
  )
  console.log(`  agent_credit_ledger              ${apply ? 'deleted' : 'would del'} ${acDel.rowCount}`)

  // ---------- Phase 3: audit_logs ----------
  console.log('\n--- Phase 3: audit_logs ---')
  try {
    const alDel = await c.query(
      `DELETE FROM audit_logs
       WHERE (resource_type='player' AND resource_id=$1::text)
          OR before::text ILIKE $2 OR after::text ILIKE $2`,
      [userId, `%"id":${userId}%`],
    )
    console.log(`  audit_logs                       ${apply ? 'deleted' : 'would del'} ${alDel.rowCount}`)
  } catch (e) { console.log(`  audit_logs ⚠ ${(e as Error).message}`) }

  // ---------- Phase 4: walk whitelabel ledger chain, find gaps, shift subsequent rows ----------
  console.log('\n--- Phase 4: chain repair (shift subsequent rows) ---')
  const chain = await c.query(
    `SELECT id, created_at, balance_before, balance_after
     FROM agent_credit_ledger
     WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
        OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
     ORDER BY created_at ASC, id ASC`,
    [tenant],
  )
  type Gap = { afterTs: Date; offset: number; rowsToShift: number }
  const gaps: Gap[] = []
  let prev: { after: string; ts: Date } | null = null
  for (const r of chain.rows) {
    const before = String(r.balance_before)
    const at = r.created_at instanceof Date ? r.created_at : new Date(r.created_at)
    if (prev && prev.after !== before) {
      // gap: subsequent rows need to be shifted to close it
      const delta = Number(before) - Number(prev.after)
      const offset = -delta // amount to ADD to subsequent rows so chain reconnects
      gaps.push({ afterTs: prev.ts, offset, rowsToShift: 0 })
    }
    prev = { after: String(r.balance_after), ts: at }
  }

  let totalOffset = 0
  for (const g of gaps) {
    const cntQ = await c.query(
      `SELECT COUNT(*)::int n FROM agent_credit_ledger
       WHERE ((from_entity_type='whitelabel' AND from_entity_id=$1)
           OR (to_entity_type='whitelabel'   AND to_entity_id=$1))
         AND created_at > $2`,
      [tenant, g.afterTs],
    )
    g.rowsToShift = cntQ.rows[0].n
    totalOffset += g.offset
    if (apply) {
      await c.query(
        `UPDATE agent_credit_ledger
         SET balance_before = balance_before + $1::numeric,
             balance_after  = balance_after  + $1::numeric
         WHERE ((from_entity_type='whitelabel' AND from_entity_id=$2)
             OR (to_entity_type='whitelabel'   AND to_entity_id=$2))
           AND created_at > $3`,
        [g.offset.toString(), tenant, g.afterTs],
      )
    }
    console.log(`  gap after ${g.afterTs.toISOString()}: offset ${g.offset > 0 ? '+' : ''}${g.offset}  | ${apply ? 'shifted' : 'would shift'} ${g.rowsToShift} subsequent rows`)
  }
  if (gaps.length === 0) console.log('  (no chain gaps detected)')

  // ---------- Phase 5: whitelabel credit reconciliation ----------
  console.log('\n--- Phase 5: whitelabel credit restore ---')
  const wlBefore = await c.query('SELECT credit_available, credit_used FROM whitelabels WHERE id=$1', [tenant])
  const ca0 = Number(wlBefore.rows[0].credit_available)
  const cu0 = Number(wlBefore.rows[0].credit_used)
  console.log(`  before: credit_available=₹${ca0}  credit_used=₹${cu0}`)
  if (totalOffset !== 0) {
    if (apply) {
      await c.query(
        `UPDATE whitelabels
         SET credit_available = credit_available::numeric + $1::numeric,
             credit_used      = credit_used::numeric      - $1::numeric
         WHERE id = $2`,
        [totalOffset.toString(), tenant],
      )
    }
    console.log(`  ${apply ? 'applied' : 'would apply'} offset: ${totalOffset > 0 ? '+' : ''}₹${totalOffset} to credit_available (and inverse to credit_used)`)
    console.log(`  after : credit_available=₹${ca0 + totalOffset}  credit_used=₹${cu0 - totalOffset}`)
  } else {
    console.log(`  no offset needed.`)
  }

  // ---------- Phase 6: verify ----------
  if (apply) {
    console.log('\n--- Phase 6: verify ---')
    const chk = await c.query(
      `SELECT balance_before, balance_after FROM agent_credit_ledger
       WHERE (from_entity_type='whitelabel' AND from_entity_id=$1)
          OR (to_entity_type='whitelabel'   AND to_entity_id=$1)
       ORDER BY created_at ASC, id ASC`, [tenant])
    let p: string | null = null, leftGaps = 0
    for (const r of chk.rows) { if (p !== null && p !== String(r.balance_before)) leftGaps++; p = String(r.balance_after) }
    const wlA = await c.query('SELECT credit_available, credit_used FROM whitelabels WHERE id=$1', [tenant])
    const matches = p === String(wlA.rows[0].credit_available)
    console.log(`  chain gaps      : ${leftGaps}  ${leftGaps === 0 ? '✓' : '❌'}`)
    console.log(`  latest after    : ₹${p}`)
    console.log(`  wl.credit_avail : ₹${wlA.rows[0].credit_available}  ${matches ? '✓ matches' : '❌'}`)
    console.log(`  wl.credit_used  : ₹${wlA.rows[0].credit_used}`)
  }

  if (apply) {
    await c.query('COMMIT')
    console.log(`\n✅ COMMITTED. Total rows touched in user tables: ${phase1}. Player ${userId} fully purged.`)
  } else {
    await c.query('ROLLBACK')
    console.log(`\n(DRY-RUN) ROLLBACK done. Re-run with --apply to commit.`)
  }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — transaction rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
