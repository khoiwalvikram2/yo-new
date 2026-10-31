/**
 * Reset a user back to "just created" state: keep the user row and their INITIAL deposit amount,
 * hard-delete every other related row across all dependent tables (bets, sessions, bonuses, other
 * ledger entries, requests, etc.).
 *
 * "Initial deposit" = the earliest credit entry ever recorded in wallet_ledger for the user's wallet.
 * That one wallet_ledger row (and its sibling ledger_entries row) is kept; every other ledger/history
 * row is deleted, and the wallet balance is reset to exactly that initial amount (bonus/exposure/
 * referral balances zeroed).
 *
 * Usage:
 *   npm run reset:user -- --userId <num> --tenant <str>            # DRY-RUN: counts only, no changes
 *   npm run reset:user -- --userId <num> --tenant <str> --apply    # COMMIT: actually resets
 *
 * Safety:
 *   - Both --userId and --tenant required (script aborts if user's tenant doesn't match).
 *   - User must currently exist (this is a reset, not an orphan-cleanup — unlike delete:user).
 *   - All changes wrapped in a single transaction; any error -> full ROLLBACK.
 *   - Default is dry-run; --apply is required to commit.
 *
 * IMPORTANT: irreversible. deposit_requests / welivepay_orders history for the user is deleted too —
 * only the running wallet balance + one wallet_ledger/ledger_entries row survive as evidence of the
 * initial deposit. If the wallet has NO deposit history at all, the balance is left untouched
 * (nothing to reset to) and only bonus/exposure/referral balances are zeroed.
 */

import 'dotenv/config'
import pg from 'pg'

type T = { table: string; column: string; cast?: string }

// Order matters: children first. users / user_roles / wallets / wallet_ledger / ledger_entries are
// handled separately (kept or reset, not blanket-deleted).
const TABLES: T[] = [
  { table: 'sports_bets',                column: 'user_id' },
  { table: 'casino_bets',                column: 'user_id' },
  { table: 'matka_bets',                 column: 'user_id' },
  { table: 'betting_patterns',           column: 'user_id' },
  { table: 'user_casino_sessions',       column: 'user_id' },
  { table: 'reporting_daily_snapshots',  column: 'player_id' },
  { table: 'bonus_awards',               column: 'user_id' },
  { table: 'bonus_credits',              column: 'user_id' },
  { table: 'deposit_requests',           column: 'user_id' },
  { table: 'welivepay_orders',           column: 'user_id' },
  { table: 'casino_callback_idempotency',column: 'user_id' },
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
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const userIdStr = arg('userId')
const tenant    = arg('tenant')
const apply     = process.argv.includes('--apply')

if (!userIdStr || !tenant || Number.isNaN(parseInt(userIdStr, 10))) {
  console.error('Usage: npm run reset:user -- --userId <num> --tenant <str> [--apply]')
  console.error('  Default = DRY-RUN (counts only). Add --apply to actually reset.')
  process.exit(2)
}
const userId = parseInt(userIdStr, 10)

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(2)
}

const client = new pg.Client({ connectionString })
await client.connect()

const u = await client.query(
  'SELECT id, name, email, phone, tenant, status FROM users WHERE id = $1',
  [userId],
)
if (u.rows.length === 0) {
  console.error(`User id=${userId} NOT FOUND. This script only resets an existing user — aborting.`)
  await client.end()
  process.exit(1)
}
const user = u.rows[0]
if (user.tenant !== tenant) {
  console.error(`User id=${userId} belongs to tenant '${user.tenant}', not '${tenant}'. Aborting.`)
  await client.end()
  process.exit(1)
}
console.log('Target user :', { id: user.id, name: user.name, email: user.email, phone: user.phone, tenant: user.tenant, status: user.status })
console.log('Mode        :', apply ? '*** APPLY (will COMMIT reset) ***' : 'dry-run (counts only, ROLLBACK)')
console.log('')

try {
  await client.query('BEGIN')

  let totalRows = 0

  // ---- wallet(s): find initial deposit, keep it, delete every other ledger row, reset balance ----
  const wallets = await client.query(
    'SELECT id, cash, bonus, exposure, referral_bonus, referral_balance FROM wallets WHERE user_id = $1',
    [userId],
  )
  if (wallets.rows.length === 0) {
    console.log('  wallets                          (none found for this user — nothing to reset)')
  }
  for (const wallet of wallets.rows) {
    const walletId = wallet.id as number
    const initialRow = await client.query(
      `SELECT id, amount FROM wallet_ledger
       WHERE wallet_id = $1 AND direction = 'credit'
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [walletId],
    )
    const initialLedgerRow = await client.query(
      `SELECT id FROM ledger_entries
       WHERE wallet_id = $1 AND type = 'credit'
       ORDER BY created_at ASC, id ASC LIMIT 1`,
      [walletId],
    )
    const keepWalletLedgerId = initialRow.rows[0]?.id as number | undefined
    const keepLedgerEntryId = initialLedgerRow.rows[0]?.id as number | undefined
    const initialAmount = initialRow.rows[0]?.amount as string | undefined

    // delete every other wallet_ledger row for this wallet
    const wlCountSql = keepWalletLedgerId
      ? 'SELECT COUNT(*)::int AS n FROM wallet_ledger WHERE wallet_id = $1 AND id <> $2'
      : 'SELECT COUNT(*)::int AS n FROM wallet_ledger WHERE wallet_id = $1'
    const wlParams = keepWalletLedgerId ? [walletId, keepWalletLedgerId] : [walletId]
    const wlN = (await client.query(wlCountSql, wlParams)).rows[0].n as number
    if (wlN > 0) {
      totalRows += wlN
      if (apply) {
        const del = await client.query(wlCountSql.replace('SELECT COUNT(*)::int AS n', 'DELETE'), wlParams)
        console.log(`  wallet_ledger                    wallet_id=${walletId} deleted  ${del.rowCount} (kept initial-deposit row)`)
      } else {
        console.log(`  wallet_ledger                    wallet_id=${walletId} would del ${wlN} (would keep initial-deposit row)`)
      }
    }

    // delete every other ledger_entries row for this wallet
    const leCountSql = keepLedgerEntryId
      ? 'SELECT COUNT(*)::int AS n FROM ledger_entries WHERE wallet_id = $1 AND id <> $2'
      : 'SELECT COUNT(*)::int AS n FROM ledger_entries WHERE wallet_id = $1'
    const leParams = keepLedgerEntryId ? [walletId, keepLedgerEntryId] : [walletId]
    const leN = (await client.query(leCountSql, leParams)).rows[0].n as number
    if (leN > 0) {
      totalRows += leN
      if (apply) {
        const del = await client.query(leCountSql.replace('SELECT COUNT(*)::int AS n', 'DELETE'), leParams)
        console.log(`  ledger_entries                   wallet_id=${walletId} deleted  ${del.rowCount} (kept initial-deposit row)`)
      } else {
        console.log(`  ledger_entries                   wallet_id=${walletId} would del ${leN} (would keep initial-deposit row)`)
      }
    }

    // reset the wallet balance
    if (initialAmount !== undefined) {
      console.log(`  wallets[${walletId}].cash             ${wallet.cash} -> ${initialAmount} (initial deposit)`)
    } else {
      console.log(`  wallets[${walletId}].cash             ${wallet.cash} -> unchanged (no deposit history found)`)
    }
    console.log(`  wallets[${walletId}].bonus/exposure/referral -> 0`)
    if (apply) {
      if (initialAmount !== undefined) {
        await client.query(
          'UPDATE wallets SET cash = $2, bonus = 0, exposure = 0, referral_bonus = 0, referral_balance = 0 WHERE id = $1',
          [walletId, initialAmount],
        )
      } else {
        await client.query(
          'UPDATE wallets SET bonus = 0, exposure = 0, referral_bonus = 0, referral_balance = 0 WHERE id = $1',
          [walletId],
        )
      }
    }
  }
  console.log('')

  // ---- every other related table: full delete for this user ----
  for (const { table, column, cast } of TABLES) {
    const placeholder = cast ? `$1${cast}` : '$1'
    const countSql = `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${column} = ${placeholder}`
    let n = 0
    try {
      const r = await client.query(countSql, [userId])
      n = r.rows[0].n as number
    } catch (e) {
      console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} ⚠ skipped (${(e as Error).message})`)
      continue
    }
    if (n === 0) continue
    totalRows += n
    if (apply) {
      const del = await client.query(
        `DELETE FROM "${table}" WHERE ${column} = ${placeholder}`,
        [userId],
      )
      console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} deleted  ${del.rowCount}`)
    } else {
      console.log(`  ${table.padEnd(32)} ${column.padEnd(12)} would del ${n}`)
    }
  }

  // ---- audit_logs (action history for the player) ----
  try {
    const acCount = (await client.query(
      `SELECT COUNT(*)::int n FROM audit_logs
       WHERE (resource_type='player' AND resource_id=$1::text)
          OR before::text ILIKE $2 OR after::text ILIKE $2
          OR (before::text ILIKE $3 OR after::text ILIKE $3)`,
      [userId, `%"id":${userId}%`, `%"userId":${userId}%`],
    )).rows[0].n as number
    if (acCount > 0) {
      totalRows += acCount
      if (apply) {
        const del = await client.query(
          `DELETE FROM audit_logs
           WHERE (resource_type='player' AND resource_id=$1::text)
              OR before::text ILIKE $2 OR after::text ILIKE $2
              OR (before::text ILIKE $3 OR after::text ILIKE $3)`,
          [userId, `%"id":${userId}%`, `%"userId":${userId}%`],
        )
        console.log(`  audit_logs                       player refs  deleted  ${del.rowCount}`)
      } else {
        console.log(`  audit_logs                       player refs  would del ${acCount}`)
      }
    }
  } catch (e) {
    console.log(`  audit_logs                       ⚠ skipped (${(e as Error).message})`)
  }

  // ---- agent_credit_ledger (whitelabel/admin ledger) ----
  const entityCountSql = `SELECT COUNT(*)::int AS n FROM agent_credit_ledger
    WHERE (from_entity_type='player' AND from_entity_id=$1::text)
       OR (to_entity_type='player'   AND to_entity_id=$1::text)`
  const reasonRegex = `\\m(player\\s+|player\\s+id:\\s*|userid[=:]?\\s*)${userId}\\M`
  const reasonCountSql = `SELECT COUNT(*)::int AS n FROM agent_credit_ledger WHERE reason ~* $1`
  try {
    const ec = (await client.query(entityCountSql, [userId])).rows[0].n as number
    const rc = (await client.query(reasonCountSql, [reasonRegex])).rows[0].n as number
    const total = ec + rc
    if (total > 0) {
      totalRows += total
      if (apply) {
        const d1 = await client.query(
          `DELETE FROM agent_credit_ledger
           WHERE (from_entity_type='player' AND from_entity_id=$1::text)
              OR (to_entity_type='player'   AND to_entity_id=$1::text)`,
          [userId],
        )
        const d2 = await client.query(
          `DELETE FROM agent_credit_ledger WHERE reason ~* $1`,
          [reasonRegex],
        )
        console.log(`  agent_credit_ledger              entity refs  deleted  ${d1.rowCount}`)
        console.log(`  agent_credit_ledger              reason text  deleted  ${d2.rowCount}`)
      } else {
        console.log(`  agent_credit_ledger              entity refs  would del ${ec}`)
        console.log(`  agent_credit_ledger              reason text  would del ${rc}`)
      }
    }
  } catch (e) {
    console.log(`  agent_credit_ledger              ⚠ skipped (${(e as Error).message})`)
  }

  console.log('')
  console.log(`Total rows ${apply ? 'deleted' : 'would be deleted'} across all tables: ${totalRows}`)
  console.log('(users, user_roles, and the wallet itself are kept — wallet balance reset to initial deposit)')

  if (apply) {
    await client.query('COMMIT')
    console.log('\n✅ COMMITTED. User reset to initial-deposit state — all other data gone.')
  } else {
    await client.query('ROLLBACK')
    console.log('\n(dry-run) ROLLBACK done. Re-run with --apply to actually reset.')
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — transaction rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await client.end()
}
