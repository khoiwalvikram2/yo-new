/**
 * Void open casino bets and refund the stake back to the player's wallet.
 *
 * Why this exists: the admin path (`updateCasinoBetStatus` / `settleTestCasinoBet`) flips a
 * casino bet to `void` and moves no money. The stake was really taken off the wallet by
 * `debitWalletForCasino`, so an admin-side void leaves the money gone. The provider-driven
 * path that DOES refund is GAP's `handleRollback` (user-backend); this script reproduces
 * exactly what that rollback does, for bets the provider will never roll back itself.
 *
 * Per bet, inside ONE transaction covering the whole run:
 *   1. Lock the player's wallet row (FOR UPDATE) — same as the debit/credit repos.
 *   2. casino_bets  -> status='void', rollback_transaction_id='ADMINVOID-<betId>',
 *                      settled_at=now(), exclude_from_admin_running=false.
 *      Guarded by `AND status = ANY(<open statuses>)` so a re-run can never double-refund.
 *   3. wallets      -> cash / bonus / referral_bonus += stake (matching the bet's wallet_type).
 *   4. ledger_entries -> credit row, meta.type='casino_rollback' (mirrors creditWalletForCasino).
 *   5. wallet_ledger  -> category='casino_rollback', direction='credit'.
 *   6. audit_logs     -> casino / void_casino_bet_refund with before+after snapshots.
 *
 * Safety rails:
 *   - DRY-RUN by default; everything runs for real inside a transaction and is ROLLBACKed
 *     unless --apply is passed, so the printed numbers are the true numbers.
 *   - Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) are refunded like any player: on
 *     Deposit/Withdraw chips their casino stake is a cash debit with its `casino_bet` DEBIT row.
 *     A bet from before D/W, whose stake was locked as credit and never debited, has no such
 *     row and is caught by the debit proof below.
 *   - Debit proof: a bet is only refunded when a matching `casino_bet` DEBIT exists in
 *     ledger_entries for its transaction_id. No debit = the money was never taken = no refund.
 *     Override with --allow-missing-debit (voids the bet without crediting the wallet).
 *   - instant_otp bonus bets are voided but NOT credited (same rule as GAP rollback).
 *   - Bet-tool / integration bets (`exclude_from_admin_running`) are never touched in --all
 *     mode; they are staged manually and legitimately stay open.
 *   - --max-total caps the run, so a wrong filter cannot quietly refund a fortune.
 *   - Post-check: every target bet must be `void` and each wallet delta must equal that
 *     player's refunded stake, else the whole run rolls back.
 *
 * Usage:
 *   # one player
 *   npm run void:casino-bets -- --user 131                                  # DRY-RUN
 *   npm run void:casino-bets -- --user 131 --apply                          # COMMIT
 *
 *   # specific bets
 *   npm run void:casino-bets -- --bets <uuid>,<uuid> --apply
 *
 *   # EVERY open bet in a tenant  (tenant is mandatory here — no accidental cross-tenant run)
 *   npm run void:casino-bets -- --all --tenant grandwinn-com                # DRY-RUN
 *   npm run void:casino-bets -- --all --tenant grandwinn-com --apply        # COMMIT
 *
 *   # only rounds stuck longer than 24h, capped at 50k
 *   npm run void:casino-bets -- --all --tenant grandwinn-com --older-than-hours 24 --max-total 50000
 *
 * Flags:
 *   --all                    every open bet in --tenant (required with --all).
 *   --user <id>              a single player (users.id).
 *   --bets <id,id>           explicit casino_bets.id list.
 *   --tenant <whitelabel>    scope guard; required for --all, optional otherwise.
 *   --older-than-hours <n>   only bets older than n hours.
 *   --vendor <name>          only this vendor (e.g. "Evolution Gaming").
 *   --max-total <amount>     abort if the total refund would exceed this.
 *   --include-pending        also target status='pending' (default: 'active' only).
 *   --actor <id>             audit_logs.actor_id (default 'system').
 *   --reason <text>          stored in ledger/audit meta.
 *   --allow-missing-debit    void bets that have no casino_bet debit row (no wallet credit).
 *   --apply                  commit. Without it nothing is written.
 */

import 'dotenv/config'
import pg from 'pg'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

const all = has('all') || has('all-tenants')
const allTenants = has('all-tenants')
const userIdStr = arg('user')
const betsCsv = arg('bets')
const tenantArg = arg('tenant')
const vendorArg = arg('vendor')
const olderThanHoursStr = arg('older-than-hours')
const maxTotalStr = arg('max-total')
const actorId = arg('actor') || 'system'
const reason = arg('reason') || 'Admin void — stake refunded'
const includePending = has('include-pending')
const allowMissingDebit = has('allow-missing-debit')
const apply = has('apply')

const betIds = (betsCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const USAGE =
  'Usage:\n' +
  '  npm run void:casino-bets -- --user <id> [--apply]\n' +
  '  npm run void:casino-bets -- --bets <uuid,uuid> [--apply]\n' +
  '  npm run void:casino-bets -- --all --tenant <whitelabel> [--older-than-hours n] [--vendor X] [--max-total n] [--apply]'

if (!all && !userIdStr && betIds.length === 0) {
  console.error(USAGE)
  process.exit(2)
}
if (all && !tenantArg && !allTenants) {
  console.error(
    '--all requires --tenant, so a run can never cross whitelabels by accident.\n' +
    'Use --all-tenants if you deliberately mean EVERY whitelabel in the database.\n\n' + USAGE
  )
  process.exit(2)
}
if (userIdStr && Number.isNaN(Number(userIdStr))) {
  console.error('--user must be a numeric users.id')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(2)
}

const userId = userIdStr ? Number(userIdStr) : null
const olderThanHours = olderThanHoursStr ? Number(olderThanHoursStr) : null
const maxTotal = maxTotalStr ? Number(maxTotalStr) : null
if (olderThanHoursStr && !Number.isFinite(olderThanHours!)) {
  console.error('--older-than-hours must be a number'); process.exit(2)
}
if (maxTotalStr && !Number.isFinite(maxTotal!)) {
  console.error('--max-total must be a number'); process.exit(2)
}

const OPEN_STATUSES = includePending ? ['active', 'pending'] : ['active']

const r2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2)

const BALANCE_COLUMN: Record<string, 'cash' | 'bonus' | 'referral_bonus'> = {
  cash: 'cash', bonus: 'bonus', referralBonus: 'referral_bonus', referral_bonus: 'referral_bonus',
}
const normaliseWalletType = (wt: string | null): 'cash' | 'bonus' | 'referralBonus' => {
  const v = String(wt ?? 'cash').toLowerCase().replace(/_/g, '')
  return v === 'referralbonus' ? 'referralBonus' : v === 'bonus' ? 'bonus' : 'cash'
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

type BetRow = {
  id: string; tenant: string; user_id: number; game_name: string | null; vendor_name: string
  stake: string; status: string; wallet_type: string | null; bonus_award_id: number | null
  currency: string; game_round_id: string | null; transaction_id: string | null
  username: string | null
}
type Plan = { bet: BetRow; stake: number; walletType: 'cash' | 'bonus' | 'referralBonus'; refund: boolean; note: string }

try {
  await c.query('BEGIN')

  // ------------------------------------------------------------------ bets
  const conds: string[] = [`b.status = ANY($1::casino_bet_status[])`]
  const params: unknown[] = [OPEN_STATUSES]
  const add = (sql: string, val: unknown) => { params.push(val); conds.push(sql.replace('$?', `$${params.length}`)) }

  if (userId != null) add('b.user_id = $?', userId)
  if (tenantArg) add('b.tenant = $?', tenantArg)
  if (betIds.length > 0) add('b.id = ANY($?::uuid[])', betIds)
  if (vendorArg) add('b.vendor_name = $?', vendorArg)
  if (olderThanHours != null) add(`b.created_at < now() - ($? || ' hours')::interval`, String(olderThanHours))
  // Bet-tool / integration bets are staged by operators and legitimately stay open. Never sweep
  // them up in a bulk run; an explicit --bets/--user targeting still reaches them.
  if (all) conds.push('b.exclude_from_admin_running = false')

  const betsRes = await c.query<BetRow>(
    `SELECT b.id, b.tenant, b.user_id, b.game_name, b.vendor_name, b.stake, b.status,
            b.wallet_type, b.bonus_award_id, b.currency, b.game_round_id, b.transaction_id,
            u.username
       FROM casino_bets b
       JOIN users u ON u.id = b.user_id
      WHERE ${conds.join(' AND ')}
      ORDER BY b.user_id ASC, b.created_at ASC, b.id ASC
        FOR UPDATE OF b`,
    params,
  )
  const bets = betsRes.rows

  if (betIds.length > 0 && bets.length !== betIds.length) {
    const found = new Set(bets.map((b) => b.id))
    const missing = betIds.filter((id) => !found.has(id))
    console.error(`❌ ${missing.length} of the requested --bets are not open / not found: ${missing.join(', ')}`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }
  if (bets.length === 0) {
    console.log('Nothing to do: no open casino bets matched. (Already voided/settled?)')
    await c.query('ROLLBACK'); await c.end(); process.exit(0)
  }

  const scope = allTenants
    ? `ALL open bets in EVERY tenant (${[...new Set(bets.map((b) => b.tenant))].join(', ')})`
    : all
      ? `ALL open bets in ${tenantArg}`
      : userId != null
        ? `player ${userId}`
        : `${betIds.length} explicit bet(s)`
  console.log(`Scope   : ${scope}`)
  if (vendorArg) console.log(`Vendor  : ${vendorArg}`)
  if (olderThanHours != null) console.log(`Age     : older than ${olderThanHours}h`)
  console.log(`Statuses: ${OPEN_STATUSES.join(', ')}`)
  console.log(`Mode    : ${apply ? '*** APPLY ***' : 'dry-run'}\n`)

  // --------------------------------------------------------------- planning
  const plans: Plan[] = []
  for (const bet of bets) {
    const stake = r2(Number(bet.stake ?? 0))
    const walletType = normaliseWalletType(bet.wallet_type)
    let refund = true
    let note = ''

    if (stake <= 0) { refund = false; note = 'stake <= 0 — void only' }

    if (refund) {
      const debit = await c.query(
        `SELECT 1 FROM ledger_entries
          WHERE tenant = $1 AND type = 'debit'
            AND meta->>'type' = 'casino_bet'
            AND meta->>'transactionId' = $2
          LIMIT 1`,
        [bet.tenant, bet.transaction_id ?? ''],
      )
      if (debit.rows.length === 0) {
        if (allowMissingDebit) { refund = false; note = 'NO casino_bet debit — void only (--allow-missing-debit)' }
        else {
          console.error(
            `❌ Bet ${bet.id} (player ${bet.user_id}, stake ${money(stake)}) has no casino_bet DEBIT in ledger_entries ` +
            `for transaction_id=${bet.transaction_id}. Refunding it would create money out of nothing.\n` +
            `   Re-run with --allow-missing-debit to void such bets WITHOUT a wallet credit.`,
          )
          await c.query('ROLLBACK'); await c.end(); process.exit(1)
        }
      }
    }

    if (refund && walletType === 'bonus' && bet.bonus_award_id != null) {
      const camp = await c.query(
        `SELECT bc.distribution_type FROM bonus_awards ba
           JOIN bonus_campaigns bc ON bc.id = ba.campaign_id
          WHERE ba.id = $1 AND bc.tenant = $2 LIMIT 1`,
        [bet.bonus_award_id, bet.tenant],
      )
      if (camp.rows[0]?.distribution_type === 'instant_otp') { refund = false; note = 'instant_otp bonus — void only' }
    }

    plans.push({ bet, stake, walletType, refund, note })
  }

  const totalRefund = r2(plans.filter((p) => p.refund).reduce((s, p) => s + p.stake, 0))

  // Group by player so each wallet is locked once and its ledger chain stays continuous.
  const byPlayer = new Map<number, Plan[]>()
  for (const p of plans) {
    if (!byPlayer.has(p.bet.user_id)) byPlayer.set(p.bet.user_id, [])
    byPlayer.get(p.bet.user_id)!.push(p)
  }

  console.log(`Players : ${byPlayer.size}   Bets: ${plans.length}   Refund total: ${money(totalRefund)} ${bets[0].currency}\n`)
  console.table(
    [...byPlayer.entries()].map(([uid, ps]) => ({
      player: uid,
      username: ps[0].bet.username,
      bets: ps.length,
      refund: money(r2(ps.filter((p) => p.refund).reduce((s, p) => s + p.stake, 0))),
      vendors: [...new Set(ps.map((p) => p.bet.vendor_name))].join(', '),
      skipped: ps.filter((p) => !p.refund).length || '',
    })),
  )

  if (maxTotal != null && totalRefund > maxTotal) {
    console.error(`\n❌ Refund total ${money(totalRefund)} exceeds --max-total ${money(maxTotal)}. Aborting (no changes).`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  // ---------------------------------------------------------------- execute
  let voided = 0
  let refunded = 0
  const walletBefore = new Map<number, { id: number; cash: number; bonus: number; referral_bonus: number }>()
  const expectedDelta = new Map<number, Record<string, number>>()

  for (const [uid, playerPlans] of byPlayer) {
    const tenantOfPlayer = playerPlans[0].bet.tenant
    const wRes = await c.query(
      `SELECT id, cash, bonus, referral_bonus, exposure FROM wallets
        WHERE user_id = $1 AND tenant = $2 FOR UPDATE`,
      [uid, tenantOfPlayer],
    )
    if (wRes.rows.length === 0) {
      console.error(`❌ No wallet for user ${uid} / tenant ${tenantOfPlayer}. Aborting.`)
      await c.query('ROLLBACK'); await c.end(); process.exit(1)
    }
    const walletId: number = wRes.rows[0].id
    const exposure = r2(Number(wRes.rows[0].exposure ?? 0))
    const before = {
      id: walletId,
      cash: r2(Number(wRes.rows[0].cash ?? 0)),
      bonus: r2(Number(wRes.rows[0].bonus ?? 0)),
      referral_bonus: r2(Number(wRes.rows[0].referral_bonus ?? 0)),
    }
    walletBefore.set(uid, before)
    const running = { cash: before.cash, bonus: before.bonus, referral_bonus: before.referral_bonus }
    const delta: Record<string, number> = {}

    for (const plan of playerPlans) {
      const { bet, stake, walletType } = plan
      const marker = `ADMINVOID-${bet.id}`.slice(0, 128)

      const upd = await c.query(
        `UPDATE casino_bets
            SET status='void', rollback_transaction_id=$2, settled_at=now(),
                exclude_from_admin_running=false, updated_at=now()
          WHERE id = $1 AND status = ANY($3::casino_bet_status[])
        RETURNING id`,
        [bet.id, marker, OPEN_STATUSES],
      )
      if (upd.rowCount === 0) continue
      voided++
      if (!plan.refund) continue

      const col = BALANCE_COLUMN[walletType]
      const rawBefore = running[col]
      const rawAfter = r2(rawBefore + stake)
      const ledgerBefore = walletType === 'cash' ? Math.max(0, r2(rawBefore - exposure)) : rawBefore
      const ledgerAfter = r2(ledgerBefore + stake)

      await c.query(`UPDATE wallets SET ${col} = $2::numeric WHERE id = $1`, [walletId, rawAfter])
      running[col] = rawAfter
      delta[col] = r2((delta[col] ?? 0) + stake)

      const meta = {
        type: 'casino_rollback', transactionId: bet.transaction_id, roundId: bet.game_round_id,
        adminVoid: true, betId: bet.id, reason, actorId,
      }

      await c.query(
        `INSERT INTO ledger_entries (tenant, wallet_id, type, amount, balance_before, balance_after, meta)
         VALUES ($1,$2,'credit',$3::numeric,$4::numeric,$5::numeric,$6::jsonb)`,
        [bet.tenant, walletId, stake, rawBefore, rawAfter, JSON.stringify(meta)],
      )
      await c.query(
        `INSERT INTO wallet_ledger
           (tenant, wallet_id, user_id, wallet_type, category, direction, amount,
            balance_before, balance_after, description, reference_type, reference_id, meta)
         VALUES ($1,$2,$3,$4,'casino_rollback','credit',$5::numeric,$6::numeric,$7::numeric,$8,'casino_rollback',$9,$10::jsonb)`,
        [bet.tenant, walletId, bet.user_id, walletType, stake, ledgerBefore, ledgerAfter,
         'Casino bet void refund', bet.transaction_id, JSON.stringify(meta)],
      )
      await c.query(
        `INSERT INTO audit_logs (tenant, actor_id, domain, action, resource_type, resource_id, before, after)
         VALUES ($1,$2,'casino','void_casino_bet_refund','casino_bet',$3,$4::jsonb,$5::jsonb)`,
        [bet.tenant, actorId, bet.id,
         JSON.stringify({ status: bet.status, stake, walletType, [`${col}Balance`]: rawBefore }),
         JSON.stringify({ status: 'void', refunded: stake, walletType, [`${col}Balance`]: rawAfter, reason })],
      )
      refunded++
    }
    expectedDelta.set(uid, delta)
  }

  // ------------------------------------------------------------- post-check
  const stillOpen = await c.query(
    `SELECT id FROM casino_bets WHERE id = ANY($1::uuid[]) AND status <> 'void'`,
    [plans.map((p) => p.bet.id)],
  )
  let deltaOk = true
  for (const [uid, before] of walletBefore) {
    const after = await c.query(`SELECT cash, bonus, referral_bonus FROM wallets WHERE id = $1`, [before.id])
    const exp = expectedDelta.get(uid) ?? {}
    for (const col of ['cash', 'bonus', 'referral_bonus'] as const) {
      const actual = r2(Number(after.rows[0][col] ?? 0) - before[col])
      if (actual !== r2(exp[col] ?? 0)) {
        console.error(`❌ wallet delta mismatch for player ${uid} ${col}: got ${actual}, expected ${r2(exp[col] ?? 0)}`)
        deltaOk = false
      }
    }
  }

  console.log(`\nBets voided  : ${voided}/${plans.length}`)
  console.log(`Bets refunded: ${refunded}   Total: ${money(totalRefund)}`)

  if (stillOpen.rowCount !== 0 || !deltaOk) {
    console.error(`\n❌ Post-check FAILED (stillOpen=${stillOpen.rowCount}, deltasMatch=${deltaOk}). Rolling back.`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }
  console.log('✅ Post-check passed: all target bets are void and every wallet delta equals its refunded stake.')

  if (!apply) {
    await c.query('ROLLBACK')
    console.log('\n(dry-run) Nothing was written. Re-run with --apply to commit.')
    await c.end(); process.exit(0)
  }

  await c.query('COMMIT')
  console.log('\n✅ COMMITTED.')
  console.log('   Note: daily casino snapshots store open-bet exposure — if reports for the affected')
  console.log('   dates look stale, regenerate them with: npm run generate:snapshots')
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — rolled back. Error:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await c.end()
}
