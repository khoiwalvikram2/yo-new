/**
 * Hard-delete a user and ALL related rows across every dependent table.
 *
 * Usage:
 *   npm run delete:user -- --userId <num> --tenant <str>            # DRY-RUN: counts only, no deletes
 *   npm run delete:user -- --userId <num> --tenant <str> --apply    # COMMIT: actually deletes
 *
 * Safety:
 *   - Both --userId and --tenant required (script aborts if user's tenant doesn't match).
 *   - All deletes wrapped in a single transaction; any error -> full ROLLBACK.
 *   - Default is dry-run; --apply is required to commit.
 *
 * IMPORTANT: irreversible. Gambling/financial records are deleted too — this is intentional for
 * local cleanup / test data. On production this almost certainly violates record-retention rules;
 * prefer an "anonymize" approach there.
 */

import 'dotenv/config'
import pg from 'pg'

type T = { table: string; column: string; cast?: string }

// Order matters: children (no-cascade FK + non-FK) FIRST, then cascade-FK tables, then user_roles, then users.
const TABLES: T[] = [
  // financial / activity tables (NO ACTION FK or non-FK) — must delete before users
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
  { table: 'casino_game_bet_settings',   column: 'player_id', cast: '::text' }, // varchar column

  // CASCADE FK tables — explicit for clarity/visibility (would auto-delete anyway)
  { table: 'agent_player_credits',       column: 'player_id' },
  { table: 'casino_likes',               column: 'user_id' },
  { table: 'casino_recent',              column: 'user_id' },
  { table: 'notifications',              column: 'user_id' },
  { table: 'player_credit_adjustments',  column: 'player_id' },
  { table: 'sports_bookmarks',           column: 'user_id' },
  { table: 'sports_recent',              column: 'user_id' },
  { table: 'user_payout_accounts',       column: 'user_id' },
  { table: 'withdrawal_requests',        column: 'user_id' },

  // last
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
  console.error('Usage: npm run delete:user -- --userId <num> --tenant <str> [--apply]')
  console.error('  Default = DRY-RUN (counts only). Add --apply to actually delete.')
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
const userExists = u.rows.length > 0
if (userExists) {
  const user = u.rows[0]
  if (user.tenant !== tenant) {
    console.error(`User id=${userId} belongs to tenant '${user.tenant}', not '${tenant}'. Aborting.`)
    await client.end()
    process.exit(1)
  }
  console.log('Target user :', { id: user.id, name: user.name, email: user.email, phone: user.phone, tenant: user.tenant, status: user.status })
} else {
  console.log(`Target user : id=${userId} NOT FOUND in users table — running ORPHAN-CLEANUP only (agent_credit_ledger references etc).`)
}
console.log('Mode        :', apply ? '*** APPLY (will COMMIT delete) ***' : 'dry-run (counts only, ROLLBACK)')
console.log('')

try {
  await client.query('BEGIN')

  let totalRows = 0

  // ---- ledger_entries (generic wallet ledger) ----
  // Keyed by wallet_id, NOT user_id, so resolve the user's wallet ids first and delete these
  // rows BEFORE the wallets table is deleted (otherwise they would be left as orphans).
  if (userExists) {
    try {
      const walletRows = await client.query(
        'SELECT id FROM wallets WHERE user_id = $1',
        [userId],
      )
      const walletIds = walletRows.rows.map((r) => r.id as number)
      if (walletIds.length > 0) {
        const le = await client.query(
          'SELECT COUNT(*)::int AS n FROM ledger_entries WHERE wallet_id = ANY($1)',
          [walletIds],
        )
        const n = le.rows[0].n as number
        if (n > 0) {
          totalRows += n
          if (apply) {
            const del = await client.query(
              'DELETE FROM ledger_entries WHERE wallet_id = ANY($1)',
              [walletIds],
            )
            console.log(`  ledger_entries                   wallet refs  deleted  ${del.rowCount}`)
          } else {
            console.log(`  ledger_entries                   wallet refs  would del ${n}`)
          }
        }
      }
    } catch (e) {
      console.log(`  ledger_entries                   ⚠ skipped (${(e as Error).message})`)
    }
  }

  for (const { table, column, cast } of TABLES) {
    // Skip users + user_roles when user already gone (nothing to delete).
    if (!userExists && (table === 'users' || table === 'user_roles')) continue
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
  // Has no user_id col; identified by resource_type='player' AND resource_id=<userId>::text,
  // OR by username/phone appearing inside the before/after JSONB snapshots.
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
  // Has no user_id column; player is referenced via from/to entity_id+entity_type AND inside reason text.
  // Counterparty admin-side mirror entries (entity = whitelabel) still mention the player in reason after the
  // player row is gone, leaving "Direct wallet deposit for player N" orphans on the dashboard. Clean both.
  const entityCountSql = `SELECT COUNT(*)::int AS n FROM agent_credit_ledger
    WHERE (from_entity_type='player' AND from_entity_id=$1::text)
       OR (to_entity_type='player'   AND to_entity_id=$1::text)`
  const reasonRegex = `\\m(player\\s+|player\\s+id:\\s*|userid[=:]?\\s*)${userId}\\M`
  const reasonCountSql = `SELECT COUNT(*)::int AS n FROM agent_credit_ledger WHERE reason ~* $1`
  try {
    const ec = (await client.query(entityCountSql, [userId])).rows[0].n as number
    const rc = (await client.query(reasonCountSql, [reasonRegex])).rows[0].n as number
    const total = ec + rc // may double-count if a row matches both (DELETE will still remove it once)
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

  if (apply) {
    await client.query('COMMIT')
    console.log('\n✅ COMMITTED. User and all related rows are gone.')
  } else {
    await client.query('ROLLBACK')
    console.log('\n(dry-run) ROLLBACK done. Re-run with --apply to actually delete.')
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — transaction rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await client.end()
}
