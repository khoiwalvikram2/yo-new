/**
 * Reverse ONE specific deposit's DOWNSTREAM activity — while keeping the deposit itself fully
 * intact as a real, self-consistent record (its wallet_ledger row, its deposit_requests row, and
 * its "deposit_approved" audit_log entry all survive). Only what happened AFTER the deposit was
 * fully processed gets deleted. Earlier activity (an earlier deposit + its bets) is untouched too,
 * since it's all before the target deposit.
 *
 * Why "at or after the deposit" isn't good enough: a single deposit is actually written across
 * SEVERAL tables within roughly a second of each other — deposit_requests (created ~seconds BEFORE
 * the credit, when the request was raised), wallet_ledger (the credit itself, the anchor), and
 * audit_logs (the "deposit_approved" entry, written tens-to-hundreds of ms AFTER the credit). A
 * naive "created_at >= deposit time" delete would wipe the audit_log proof that the deposit was
 * ever approved and would delete the deposit_requests row — leaving a wallet balance with no
 * explaining trail. Instead:
 *   - wallet_ledger    : keep the deposit's own row, delete only rows with a HIGHER id (strictly
 *                        later — ids are allocated in insertion order, so this is exact).
 *   - deposit_requests : find the matching request (by amount, at/before the credit) and KEEP it —
 *                        never deleted.
 *   - welivepay_orders : same treatment as deposit_requests, if the gateway was used.
 *   - audit_logs       : find the "deposit_approved" style log nearest the credit (within a 2-minute
 *                        processing window) and KEEP it; delete only player-scoped logs strictly
 *                        AFTER that anchor.
 *   - agent_credit_ledger: same anchor treatment (only relevant for AGENT_CREDIT players).
 *   - everything else (bets, sessions, bonuses, notifications, reports) : deleted if strictly AFTER
 *     the deposit's wallet_ledger timestamp.
 *
 * The wallet's cash balance is set to exactly what it was the instant after the deposit landed
 * (before any bet touched it) — i.e. the deposit amount is restored, with zero betting history
 * attached to it, but a complete real paper trail (request -> approval -> ledger) explaining it.
 *
 * Usage:
 *   npm run reverse:deposit -- --userId <num> --tenant <str> --amount <num>            # DRY-RUN
 *   npm run reverse:deposit -- --userId <num> --tenant <str> --amount <num> --apply    # COMMIT
 *
 * Safety:
 *   - --userId, --tenant, --amount all required. Aborts if user's tenant doesn't match, or if no
 *     'deposit' credit of that amount is found for the user.
 *   - If more than one deposit of that amount exists, the MOST RECENT one is targeted — dry-run
 *     prints a warning listing all matches so you can confirm before applying.
 *   - Single transaction; any error -> full ROLLBACK. Default is dry-run; --apply required to commit.
 *
 * IMPORTANT: irreversible. Rewrites gambling/financial history for this user — local cleanup / test
 * data only. On production this almost certainly violates record-retention rules.
 */

import 'dotenv/config'
import pg from 'pg'

type T = { table: string; column: string; dateColumn?: string; cast?: string }

// Deleted only if created_at (or dateColumn) is STRICTLY AFTER the target deposit's timestamp.
const CUTOFF_TABLES: T[] = [
  { table: 'casino_bets',              column: 'user_id' },
  { table: 'sports_bets',              column: 'user_id' },
  { table: 'matka_bets',               column: 'user_id' },
  { table: 'betting_patterns',         column: 'user_id' },
  { table: 'user_casino_sessions',     column: 'user_id' },
  { table: 'bonus_awards',             column: 'user_id', dateColumn: 'awarded_at' },
  { table: 'bonus_credits',            column: 'user_id' },
  { table: 'notifications',            column: 'user_id' },
  { table: 'player_credit_adjustments',column: 'player_id' },
  { table: 'agent_player_credits',     column: 'player_id' },
]

const PROCESSING_WINDOW_SQL = `$2::timestamptz + interval '2 minutes'`

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const userIdStr = arg('userId')
const tenant     = arg('tenant')
const amountStr  = arg('amount')
const apply      = process.argv.includes('--apply')

if (!userIdStr || !tenant || !amountStr || Number.isNaN(parseInt(userIdStr, 10)) || Number.isNaN(Number(amountStr))) {
  console.error('Usage: npm run reverse:deposit -- --userId <num> --tenant <str> --amount <num> [--apply]')
  console.error('  Default = DRY-RUN (counts only). Add --apply to actually reverse.')
  process.exit(2)
}
const userId = parseInt(userIdStr, 10)
const amount = Number(amountStr)

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
  console.error(`User id=${userId} NOT FOUND. Aborting.`)
  await client.end()
  process.exit(1)
}
const user = u.rows[0]
if (user.tenant !== tenant) {
  console.error(`User id=${userId} belongs to tenant '${user.tenant}', not '${tenant}'. Aborting.`)
  await client.end()
  process.exit(1)
}
console.log('Target user :', { id: user.id, name: user.name, phone: user.phone, tenant: user.tenant, status: user.status })

const wallet = (await client.query(
  'SELECT id, cash FROM wallets WHERE user_id = $1',
  [userId],
)).rows[0]
if (!wallet) {
  console.error(`No wallet found for user id=${userId}. Aborting.`)
  await client.end()
  process.exit(1)
}

const matches = await client.query(
  `SELECT id, amount, balance_before, balance_after, created_at FROM wallet_ledger
   WHERE wallet_id = $1 AND direction = 'credit' AND category = 'deposit' AND amount = $2
   ORDER BY created_at DESC, id DESC`,
  [wallet.id, amount],
)
if (matches.rows.length === 0) {
  console.error(`No deposit of amount ${amount} found for user id=${userId}. Aborting.`)
  await client.end()
  process.exit(1)
}
if (matches.rows.length > 1) {
  console.log(`⚠ ${matches.rows.length} deposits of amount ${amount} found — targeting the MOST RECENT one:`)
  for (const m of matches.rows) console.log(`    ledger id=${m.id}  at ${m.created_at.toISOString()}`)
}
const target = matches.rows[0]
const cutoff = target.created_at as Date
const newCash = target.balance_after as string

console.log('')
console.log('Target deposit :', { ledgerId: target.id, amount, at: cutoff.toISOString(), balanceBefore: target.balance_before, balanceAfter: target.balance_after })
console.log('Wallet cash    :', wallet.cash, '->', newCash, '(after reversal)')
console.log('Mode           :', apply ? '*** APPLY (will COMMIT) ***' : 'dry-run (counts only, ROLLBACK)')
console.log('')

try {
  await client.query('BEGIN')

  let totalRows = 0

  // ---- wallet_ledger: KEEP the deposit's own row; delete only strictly-later ids ----
  const wlN = (await client.query(
    'SELECT COUNT(*)::int AS n FROM wallet_ledger WHERE wallet_id = $1 AND id > $2',
    [wallet.id, target.id],
  )).rows[0].n as number
  totalRows += wlN
  console.log(`  wallet_ledger (id=${target.id})      KEPT (this is the deposit's own record)`)
  if (apply) {
    const del = await client.query('DELETE FROM wallet_ledger WHERE wallet_id = $1 AND id > $2', [wallet.id, target.id])
    console.log(`  wallet_ledger                     deleted  ${del.rowCount} (strictly after the deposit)`)
  } else {
    console.log(`  wallet_ledger                     would del ${wlN} (strictly after the deposit)`)
  }

  // ---- ledger_entries (wallet_id-keyed, no direct id link to wallet_ledger — find its own
  //      sibling row for this deposit within the same-transaction processing window and KEEP it
  //      explicitly by id; a plain "created_at > cutoff" risks re-matching that sibling because
  //      cutoff round-trips through a JS Date and can truncate Postgres' sub-ms precision) ----
  const leAnchorRow = await client.query(
    `SELECT id FROM ledger_entries
     WHERE wallet_id = $1 AND type = 'credit'
       AND created_at >= $2::timestamptz - interval '1 second' AND created_at <= $2::timestamptz + interval '1 second'
     ORDER BY created_at ASC LIMIT 1`,
    [wallet.id, cutoff],
  )
  const leAnchorId: number | null = leAnchorRow.rows[0]?.id ?? null
  if (leAnchorId !== null) {
    console.log(`  ledger_entries (id=${leAnchorId})     KEPT (this deposit's own base-currency record)`)
  }
  const leExclude = leAnchorId !== null ? 'AND id <> $3' : ''
  const leParams = leAnchorId !== null ? [wallet.id, cutoff, leAnchorId] : [wallet.id, cutoff]
  const leN = (await client.query(
    `SELECT COUNT(*)::int AS n FROM ledger_entries WHERE wallet_id = $1 AND created_at > $2 ${leExclude}`,
    leParams,
  )).rows[0].n as number
  if (leN > 0) {
    totalRows += leN
    if (apply) {
      const del = await client.query(
        `DELETE FROM ledger_entries WHERE wallet_id = $1 AND created_at > $2 ${leExclude}`,
        leParams,
      )
      console.log(`  ledger_entries                    deleted  ${del.rowCount}`)
    } else {
      console.log(`  ledger_entries                    would del ${leN}`)
    }
  }

  // ---- bets / sessions / bonuses / notifications / etc: strictly after the deposit ----
  for (const { table, column, dateColumn } of CUTOFF_TABLES) {
    const dc = dateColumn ?? 'created_at'
    const countSql = `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${column} = $1 AND ${dc} > $2`
    let n = 0
    try {
      n = (await client.query(countSql, [userId, cutoff])).rows[0].n as number
    } catch (e) {
      console.log(`  ${table.padEnd(32)} ⚠ skipped (${(e as Error).message})`)
      continue
    }
    if (n === 0) continue
    totalRows += n
    if (apply) {
      const del = await client.query(`DELETE FROM "${table}" WHERE ${column} = $1 AND ${dc} > $2`, [userId, cutoff])
      console.log(`  ${table.padEnd(32)} deleted  ${del.rowCount}`)
    } else {
      console.log(`  ${table.padEnd(32)} would del ${n}`)
    }
  }

  // ---- reporting_daily_snapshots (day-level aggregate; the whole day is invalidated once any
  //      activity that day is deleted, so this stays >= the truncated deposit day, not strictly-after) ----
  try {
    const n = (await client.query(
      `SELECT COUNT(*)::int n FROM reporting_daily_snapshots WHERE player_id = $1 AND snapshot_date >= date_trunc('day', $2::timestamptz)`,
      [userId, cutoff],
    )).rows[0].n as number
    if (n > 0) {
      totalRows += n
      if (apply) {
        const del = await client.query(
          `DELETE FROM reporting_daily_snapshots WHERE player_id = $1 AND snapshot_date >= date_trunc('day', $2::timestamptz)`,
          [userId, cutoff],
        )
        console.log(`  reporting_daily_snapshots         deleted  ${del.rowCount}`)
      } else {
        console.log(`  reporting_daily_snapshots         would del ${n}`)
      }
    }
  } catch (e) {
    console.log(`  reporting_daily_snapshots         ⚠ skipped (${(e as Error).message})`)
  }

  // ---- deposit_requests / welivepay_orders: find the request BEHIND this deposit and KEEP it ----
  // (the request is created seconds BEFORE the credit — matched by amount, never deleted)
  try {
    const dr = await client.query(
      `SELECT id, created_at FROM deposit_requests WHERE user_id = $1 AND amount = $2 AND created_at <= $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, amount, cutoff],
    )
    if (dr.rows.length > 0) {
      console.log(`  deposit_requests (id=${dr.rows[0].id})        KEPT (the request behind this deposit)`)
    } else {
      console.log(`  deposit_requests                  (no matching request found — deposit may have been manual)`)
    }
  } catch (e) {
    console.log(`  deposit_requests                  ⚠ skipped (${(e as Error).message})`)
  }
  try {
    const wo = await client.query(
      `SELECT id FROM welivepay_orders WHERE user_id = $1 AND amount = $2 AND created_at <= $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, amount, cutoff],
    )
    if (wo.rows.length > 0) {
      console.log(`  welivepay_orders (id=${wo.rows[0].id})        KEPT (the gateway order behind this deposit)`)
    }
  } catch (e) {
    console.log(`  welivepay_orders                  ⚠ skipped (${(e as Error).message})`)
  }

  // ---- audit_logs: find the "deposit approved" log within a 2-min processing window of the
  //      credit, KEEP it, delete player-scoped logs strictly AFTER that anchor ----
  const auditParams = [userId, cutoff, `%"id":${userId}%`, `%"userId":${userId}%`]
  const auditWhereBase = `((resource_type='player' AND resource_id=$1::text)
           OR before::text ILIKE $3 OR after::text ILIKE $3
           OR before::text ILIKE $4 OR after::text ILIKE $4)`
  let auditAnchor: Date = cutoff
  let auditAnchorId: number | null = null
  try {
    const anchorRow = await client.query(
      `SELECT id, action, created_at FROM audit_logs
       WHERE created_at >= $2 AND created_at <= ${PROCESSING_WINDOW_SQL} AND ${auditWhereBase}
       ORDER BY created_at ASC LIMIT 1`,
      auditParams,
    )
    if (anchorRow.rows.length > 0) {
      auditAnchor = anchorRow.rows[0].created_at as Date
      auditAnchorId = anchorRow.rows[0].id as number
      console.log(`  audit_logs (id=${anchorRow.rows[0].id}, action=${anchorRow.rows[0].action})  KEPT (deposit-approval log)`)
    }
    // NOTE: auditAnchor round-trips through a JS Date, which truncates Postgres' sub-millisecond
    // precision — a naive "created_at > auditAnchor" can then re-match the anchor row itself if the
    // true stored value has non-zero microseconds beyond the truncated ms. Excluding by id sidesteps
    // that entirely instead of trying to out-precision it.
    const excludeAnchor = auditAnchorId !== null ? 'AND id <> $5' : ''
    const acParams = auditAnchorId !== null
      ? [userId, auditAnchor, `%"id":${userId}%`, `%"userId":${userId}%`, auditAnchorId]
      : [userId, auditAnchor, `%"id":${userId}%`, `%"userId":${userId}%`]
    const acCount = (await client.query(
      `SELECT COUNT(*)::int n FROM audit_logs WHERE created_at > $2 ${excludeAnchor} AND ${auditWhereBase}`,
      acParams,
    )).rows[0].n as number
    if (acCount > 0) {
      totalRows += acCount
      if (apply) {
        const del = await client.query(
          `DELETE FROM audit_logs WHERE created_at > $2 ${excludeAnchor} AND ${auditWhereBase}`,
          acParams,
        )
        console.log(`  audit_logs                        deleted  ${del.rowCount}`)
      } else {
        console.log(`  audit_logs                        would del ${acCount}`)
      }
    }
  } catch (e) {
    console.log(`  audit_logs                        ⚠ skipped (${(e as Error).message})`)
  }

  // ---- agent_credit_ledger (whitelabel/admin ledger; only relevant for AGENT_CREDIT players) ----
  // Same anchor treatment: keep any entry within the processing window, delete only strictly after.
  const reasonRegex = `\\m(player\\s+|player\\s+id:\\s*|userid[=:]?\\s*)${userId}\\M`
  try {
    const entWhere = `((from_entity_type='player' AND from_entity_id=$1::text) OR (to_entity_type='player' AND to_entity_id=$1::text))`
    const anchorEnt = await client.query(
      `SELECT id, created_at FROM agent_credit_ledger
       WHERE created_at >= $2 AND created_at <= ${PROCESSING_WINDOW_SQL} AND (${entWhere} OR reason ~* $3)
       ORDER BY created_at ASC LIMIT 1`,
      [userId, cutoff, reasonRegex],
    )
    const aclAnchor: Date = anchorEnt.rows.length > 0 ? (anchorEnt.rows[0].created_at as Date) : cutoff
    const aclAnchorId: number | null = anchorEnt.rows.length > 0 ? (anchorEnt.rows[0].id as number) : null
    if (anchorEnt.rows.length > 0) {
      console.log(`  agent_credit_ledger (id=${anchorEnt.rows[0].id})  KEPT (deposit-credit chain entry)`)
    }
    // Same JS-Date-precision-truncation guard as audit_logs above: exclude the anchor row by id.
    const excludeAclAnchor = aclAnchorId !== null ? 'AND id <> $3' : ''
    const ec = (await client.query(
      `SELECT COUNT(*)::int n FROM agent_credit_ledger WHERE created_at > $2 ${excludeAclAnchor} AND ${entWhere}`,
      aclAnchorId !== null ? [userId, aclAnchor, aclAnchorId] : [userId, aclAnchor],
    )).rows[0].n as number
    const rc = (await client.query(
      `SELECT COUNT(*)::int n FROM agent_credit_ledger WHERE created_at > $2 ${excludeAclAnchor} AND reason ~* $1`,
      aclAnchorId !== null ? [reasonRegex, aclAnchor, aclAnchorId] : [reasonRegex, aclAnchor],
    )).rows[0].n as number
    if (ec + rc > 0) {
      totalRows += ec + rc
      if (apply) {
        const d1 = await client.query(
          `DELETE FROM agent_credit_ledger WHERE created_at > $2 ${excludeAclAnchor} AND ${entWhere}`,
          aclAnchorId !== null ? [userId, aclAnchor, aclAnchorId] : [userId, aclAnchor],
        )
        const d2 = await client.query(
          `DELETE FROM agent_credit_ledger WHERE created_at > $2 ${excludeAclAnchor} AND reason ~* $1`,
          aclAnchorId !== null ? [reasonRegex, aclAnchor, aclAnchorId] : [reasonRegex, aclAnchor],
        )
        console.log(`  agent_credit_ledger               deleted  ${(d1.rowCount ?? 0) + (d2.rowCount ?? 0)}`)
      } else {
        console.log(`  agent_credit_ledger               would del ${ec + rc}`)
      }
    }
  } catch (e) {
    console.log(`  agent_credit_ledger               ⚠ skipped (${(e as Error).message})`)
  }

  // ---- wallet balance: restore to right after the deposit, before any bet touched it ----
  console.log('')
  console.log(`Wallet cash: ${wallet.cash} -> ${newCash}`)
  if (apply) {
    await client.query('UPDATE wallets SET cash = $2 WHERE id = $1', [wallet.id, newCash])
  }

  console.log('')
  console.log(`Total rows ${apply ? 'deleted' : 'would be deleted'}: ${totalRows}`)
  console.log('KEPT: the deposit\'s own wallet_ledger row, its deposit_requests row, and its deposit-approval audit_log entry.')
  console.log('(everything before the targeted deposit — including any earlier deposit and its bets — is also untouched)')

  if (apply) {
    await client.query('COMMIT')
    console.log('\n✅ COMMITTED. Downstream activity reversed; deposit trail + balance intact.')
  } else {
    await client.query('ROLLBACK')
    console.log('\n(dry-run) ROLLBACK done. Re-run with --apply to actually reverse.')
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — transaction rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await client.end()
}
