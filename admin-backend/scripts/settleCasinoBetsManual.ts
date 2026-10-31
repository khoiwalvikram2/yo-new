/**
 * Settle stuck open casino bets with a known P/L, and credit the winnings to the wallet.
 *
 * Why this exists: when a provider's credit callback never arrives, a round is left at
 * `status='active'` forever. The stake WAS really debited (`ledger_entries` holds a
 * `casino_bet` DEBIT), but `payout` / `win_amount` / `net_amount` stay NULL, so every
 * report shows P/L 0.00 and the player's money is simply gone.
 *
 * Neither existing path fixes that:
 *   - `settleTestCasinoBet` (GraphQL) writes the bet row only — it never credits the
 *     wallet, so the player stays short the stake.
 *   - `void:casino-bets` refunds the stake but VOIDS the round — it cannot express
 *     "the player actually won 10,000 on this round".
 *
 * This script books the real outcome the operator read off the provider's round history,
 * reproducing what GAP's credit callback does (see gapCasinoService.handleCredit):
 *
 *   payout = win_amount = stake + pl
 *   net_amount          = pl
 *   status              = payout > 0 ? 'won' : 'lost'
 *
 * A negative P/L with a positive payout settles as 'won' — that is GAP's own rule
 * (`creditAmount === 0 ? 'lost' : 'won'`), and every organically settled bet in the
 * database follows it. Reports then show Result "Won" with a red negative P/L.
 *
 * Per bet, inside ONE transaction covering the whole run:
 *   1. Lock the player's wallet row (FOR UPDATE) — once per player, so that player's
 *      ledger chain stays continuous across their bets.
 *   2. casino_bets    -> status, payout, win_amount, net_amount, settled_at=now(),
 *                        result_transaction_id='ADMINSETTLE-<betId>'.
 *      Guarded by `AND status = ANY(<open>) AND result_transaction_id IS NULL` so a
 *      re-run can never double-credit.
 *   3. wallets        -> cash += payout (skipped when payout = 0).
 *   4. ledger_entries -> credit row, meta.type='casino_win' (mirrors creditWalletForCasino).
 *   5. wallet_ledger  -> category='casino_win', direction='credit'.
 *   6. audit_logs     -> casino / settle_casino_bet_manual with before+after snapshots.
 *
 * After COMMIT it regenerates the reporting snapshots for every affected day, because
 * reporting_daily_snapshots aggregates casino by the bet's created_at day and counts only
 * status IN ('won','lost') — a stuck bet contributes to total_exposure and nothing else.
 *
 * Safety rails:
 *   - DRY-RUN by default; everything runs for real inside a transaction and is ROLLBACKed
 *     unless --apply is passed, so the printed numbers are the true numbers.
 *   - Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) are REFUSED: their stake was
 *     locked exposure, not cash. Settling them needs releaseCasinoCreditForBet.
 *   - Non-cash wallets (bonus / referralBonus) are REFUSED: their winnings route through
 *     bonus_transfer / referral_transfer plus a whitelabel credit deduction, which this
 *     script does not reproduce.
 *   - Debit proof: a bet is only credited when a matching `casino_bet` DEBIT exists in
 *     ledger_entries for its transaction_id. No debit = the money was never taken.
 *     Override with --allow-missing-debit (settles the bet without crediting the wallet).
 *   - A derived payout below zero (|negative pl| > stake) aborts the run.
 *   - --max-credit caps the run, so a mistyped P/L cannot quietly credit a fortune.
 *   - Post-check: every target bet must carry its expected status / payout / net_amount, and
 *     each wallet's cash delta must equal that player's total payout, else the run rolls back.
 *
 * Usage:
 *   # DRY-RUN — prints the real numbers, writes nothing
 *   npm run settle:casino-bets -- --user 665 \
 *     --bet 0c3720ca-1afa-4875-b535-6a25e1481f01=10000 \
 *     --bet b56c2bae-52d6-4020-9230-621ad039f7db=-3750
 *
 *   # COMMIT
 *   npm run settle:casino-bets -- --user 665 \
 *     --bet 0c3720ca-1afa-4875-b535-6a25e1481f01=10000 \
 *     --bet b56c2bae-52d6-4020-9230-621ad039f7db=-3750 \
 *     --max-credit 25000 --apply
 *
 * Flags:
 *   --bet <uuid>=<pl>        REQUIRED, repeatable. Bet id and its true P/L (net_amount).
 *   --user <id>              guard: every --bet must belong to this users.id.
 *   --tenant <whitelabel>    guard: every --bet must belong to this tenant.
 *   --max-credit <amount>    abort if the total wallet credit would exceed this.
 *   --include-pending        also accept status='pending' (default: 'active' only).
 *   --allow-missing-debit    settle bets with no casino_bet debit row (no wallet credit).
 *   --no-snapshots           skip snapshot regeneration; print the command instead.
 *   --actor <id>             audit_logs.actor_id (default 'system').
 *   --reason <text>          stored in ledger/audit meta.
 *   --apply                  commit. Without it nothing is written.
 */

import 'dotenv/config'
import pg from 'pg'
import { DateTime } from 'luxon'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

/** Collect every `--bet <uuid>=<pl>` occurrence, in order. */
function collectBetArgs(): Array<{ id: string; pl: number }> {
  const out: Array<{ id: string; pl: number }> = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== '--bet') continue
    const raw = process.argv[i + 1]
    if (!raw) {
      console.error('--bet needs a value in the form <uuid>=<pl>')
      process.exit(2)
    }
    const eq = raw.lastIndexOf('=')
    if (eq <= 0) {
      console.error(`--bet ${raw} is malformed. Expected <uuid>=<pl>, e.g. --bet 0c3720ca-...=10000`)
      process.exit(2)
    }
    const id = raw.slice(0, eq).trim()
    const plStr = raw.slice(eq + 1).trim()
    const pl = Number(plStr)
    if (!Number.isFinite(pl)) {
      console.error(`--bet ${raw}: "${plStr}" is not a number. P/L may be negative, e.g. =-3750`)
      process.exit(2)
    }
    out.push({ id, pl })
  }
  return out
}

const userIdStr = arg('user')
const tenantArg = arg('tenant')
const maxCreditStr = arg('max-credit')
const actorId = arg('actor') || 'system'
const reason = arg('reason') || 'Manual settlement — provider callback never arrived'
const includePending = has('include-pending')
const allowMissingDebit = has('allow-missing-debit')
const noSnapshots = has('no-snapshots')
const apply = has('apply')

const requested = collectBetArgs()

const USAGE =
  'Usage:\n' +
  '  npm run settle:casino-bets -- --bet <uuid>=<pl> [--bet <uuid>=<pl> ...] [--user <id>] [--max-credit <amt>] [--apply]\n\n' +
  'P/L is the number the reports show (casino_bets.net_amount); payout is derived as stake + pl.\n' +
  'Example:\n' +
  '  npm run settle:casino-bets -- --user 665 \\\n' +
  '    --bet 0c3720ca-1afa-4875-b535-6a25e1481f01=10000 \\\n' +
  '    --bet b56c2bae-52d6-4020-9230-621ad039f7db=-3750'

if (requested.length === 0) {
  console.error(USAGE)
  process.exit(2)
}
const dupes = requested.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupes.length > 0) {
  console.error(`❌ Bet id repeated in --bet: ${[...new Set(dupes)].join(', ')}. Each bet may be settled once.`)
  process.exit(2)
}
if (userIdStr && Number.isNaN(Number(userIdStr))) {
  console.error('--user must be a numeric users.id')
  process.exit(2)
}
const maxCredit = maxCreditStr ? Number(maxCreditStr) : null
if (maxCreditStr && !Number.isFinite(maxCredit!)) {
  console.error('--max-credit must be a number')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set')
  process.exit(2)
}

const userId = userIdStr ? Number(userIdStr) : null
const OPEN_STATUSES = includePending ? ['active', 'pending'] : ['active']
const CREDIT_PLAYER_TYPES = ['AGENT_CREDIT', 'WHITELABEL_CREDIT']

const r2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2)
const signed = (n: number) => (n >= 0 ? `+${money(n)}` : money(n))

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()

type BetRow = {
  id: string; tenant: string; whitelabel_id: string; user_id: number
  game_name: string | null; vendor_name: string; stake: string; status: string
  wallet_type: string | null; bonus_award_id: number | null; currency: string
  game_round_id: string | null; transaction_id: string | null
  created_at: Date; username: string | null; player_type: string
}
type Plan = {
  bet: BetRow; stake: number; pl: number; payout: number
  status: 'won' | 'lost'; credit: boolean; note: string
}

/** Days (IST) whose reporting snapshots this run invalidates. */
const affectedDays = new Map<string, { tenant: string; whitelabelId: string; currency: string; date: Date; ist: string }>()

let totalCreditPlanned = 0
let currencyLabel = ''

try {
  await c.query('BEGIN')

  // ------------------------------------------------------------------ bets
  const betIds = requested.map((r) => r.id)
  const betsRes = await c.query<BetRow>(
    `SELECT b.id, b.tenant, b.whitelabel_id, b.user_id, b.game_name, b.vendor_name, b.stake, b.status,
            b.wallet_type, b.bonus_award_id, b.currency, b.game_round_id, b.transaction_id, b.created_at,
            u.username, u.player_type
       FROM casino_bets b
       JOIN users u ON u.id = b.user_id
      WHERE b.id = ANY($1::uuid[])
        AND b.status = ANY($2::casino_bet_status[])
      ORDER BY b.user_id ASC, b.created_at ASC, b.id ASC
        FOR UPDATE OF b`,
    [betIds, OPEN_STATUSES],
  )
  const bets = betsRes.rows
  currencyLabel = bets[0]?.currency ?? ''

  if (bets.length !== betIds.length) {
    const found = new Set(bets.map((b) => b.id))
    const missing = betIds.filter((id) => !found.has(id))
    console.error(
      `❌ ${missing.length} of the requested --bet ids are not open / not found: ${missing.join(', ')}\n` +
      `   Only ${OPEN_STATUSES.join('/')} bets can be settled` +
      (includePending ? '.' : ' (add --include-pending for pending ones).'),
    )
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  // ---------------------------------------------------------------- guards
  if (userId != null) {
    const wrong = bets.filter((b) => b.user_id !== userId)
    if (wrong.length > 0) {
      console.error(
        `❌ --user ${userId} does not own ${wrong.length} of these bets: ` +
        wrong.map((b) => `${b.id} (player ${b.user_id})`).join(', '),
      )
      await c.query('ROLLBACK'); await c.end(); process.exit(1)
    }
  }
  if (tenantArg) {
    const wrong = bets.filter((b) => b.tenant !== tenantArg)
    if (wrong.length > 0) {
      console.error(
        `❌ --tenant ${tenantArg} does not match ${wrong.length} of these bets: ` +
        wrong.map((b) => `${b.id} (${b.tenant})`).join(', '),
      )
      await c.query('ROLLBACK'); await c.end(); process.exit(1)
    }
  }

  const creditPlayers = [...new Set(
    bets.filter((b) => CREDIT_PLAYER_TYPES.includes(b.player_type)).map((b) => `${b.user_id} (${b.player_type})`),
  )]
  if (creditPlayers.length > 0) {
    console.error(
      `❌ ${creditPlayers.length} credit player(s) in scope: ${creditPlayers.join(', ')}\n` +
      `   Their stake was locked as agent/whitelabel exposure, not debited from a cash wallet — ` +
      `crediting the wallet would create money. Settle them via releaseCasinoCreditForBet.`,
    )
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  const nonCash = bets.filter((b) => String(b.wallet_type ?? 'cash').toLowerCase() !== 'cash')
  if (nonCash.length > 0) {
    console.error(
      `❌ ${nonCash.length} bet(s) are not on the cash wallet: ` +
      nonCash.map((b) => `${b.id} (${b.wallet_type})`).join(', ') + '\n' +
      `   Bonus / referralBonus winnings route through bonus_transfer / referral_transfer plus a\n` +
      `   whitelabel credit deduction (see gapCasinoService.handleCredit). This script does not\n` +
      `   reproduce that, and a plain cash credit would corrupt the bonus ledger.`,
    )
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  // -------------------------------------------------------------- planning
  const plById = new Map(requested.map((r) => [r.id, r.pl]))
  const plans: Plan[] = []

  for (const bet of bets) {
    const stake = r2(Number(bet.stake ?? 0))
    const pl = r2(plById.get(bet.id)!)
    const payout = r2(stake + pl)

    if (payout < 0) {
      console.error(
        `❌ Bet ${bet.id}: P/L ${signed(pl)} against stake ${money(stake)} implies a payout of ${money(payout)}.\n` +
        `   A loss can at worst be the whole stake, so P/L cannot go below ${money(-stake)}.`,
      )
      await c.query('ROLLBACK'); await c.end(); process.exit(1)
    }

    // GAP's own rule: any credit back to the player settles the round as 'won'.
    const status: 'won' | 'lost' = payout > 0 ? 'won' : 'lost'
    let credit = payout > 0
    let note = payout === 0 ? 'total loss — no credit' : ''

    if (credit) {
      const debit = await c.query(
        `SELECT 1 FROM ledger_entries
          WHERE tenant = $1 AND type = 'debit'
            AND meta->>'type' = 'casino_bet'
            AND meta->>'transactionId' = $2
          LIMIT 1`,
        [bet.tenant, bet.transaction_id ?? ''],
      )
      if (debit.rows.length === 0) {
        if (allowMissingDebit) { credit = false; note = 'NO casino_bet debit — settled without credit (--allow-missing-debit)' }
        else {
          console.error(
            `❌ Bet ${bet.id} (player ${bet.user_id}, stake ${money(stake)}) has no casino_bet DEBIT in\n` +
            `   ledger_entries for transaction_id=${bet.transaction_id}. Paying out a stake that was never\n` +
            `   taken would create money out of nothing.\n` +
            `   Re-run with --allow-missing-debit to settle such bets WITHOUT a wallet credit.`,
          )
          await c.query('ROLLBACK'); await c.end(); process.exit(1)
        }
      }
    }

    plans.push({ bet, stake, pl, payout, status, credit, note })
  }

  const totalStake = r2(plans.reduce((s, p) => s + p.stake, 0))
  const totalCredit = r2(plans.filter((p) => p.credit).reduce((s, p) => s + p.payout, 0))
  const totalPl = r2(plans.reduce((s, p) => s + p.pl, 0))
  totalCreditPlanned = totalCredit

  console.log(`Bets    : ${plans.length}`)
  console.log(`Statuses: ${OPEN_STATUSES.join(', ')}`)
  console.log(`Mode    : ${apply ? '*** APPLY ***' : 'dry-run'}\n`)
  console.table(
    plans.map((p) => ({
      bet: p.bet.id.slice(0, 8),
      player: p.bet.user_id,
      username: p.bet.username,
      game: p.bet.game_name,
      placed: DateTime.fromJSDate(p.bet.created_at, { zone: 'Asia/Kolkata' }).toFormat('dd LLL yy HH:mm'),
      stake: money(p.stake),
      payout: money(p.payout),
      'P/L': signed(p.pl),
      status: p.status,
      credit: p.credit ? money(p.payout) : '—',
      note: p.note,
    })),
  )
  console.log(
    `\nTotals  : stake ${money(totalStake)}   payout ${money(totalCredit)}   ` +
    `player P/L ${signed(totalPl)}   house GGR ${signed(r2(-totalPl))} ${currencyLabel}`,
  )

  if (maxCredit != null && totalCredit > maxCredit) {
    console.error(`\n❌ Wallet credit total ${money(totalCredit)} exceeds --max-credit ${money(maxCredit)}. Aborting (no changes).`)
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }

  // Group by player so each wallet is locked once and its ledger chain stays continuous.
  const byPlayer = new Map<number, Plan[]>()
  for (const p of plans) {
    if (!byPlayer.has(p.bet.user_id)) byPlayer.set(p.bet.user_id, [])
    byPlayer.get(p.bet.user_id)!.push(p)
  }

  // --------------------------------------------------------------- execute
  let settled = 0
  let credited = 0
  const walletBefore = new Map<number, { id: number; cash: number }>()
  const expectedDelta = new Map<number, number>()

  for (const [uid, playerPlans] of byPlayer) {
    const tenantOfPlayer = playerPlans[0].bet.tenant
    const wRes = await c.query(
      `SELECT id, cash, exposure FROM wallets WHERE user_id = $1 AND tenant = $2 FOR UPDATE`,
      [uid, tenantOfPlayer],
    )
    if (wRes.rows.length === 0) {
      console.error(`❌ No wallet for user ${uid} / tenant ${tenantOfPlayer}. Aborting.`)
      await c.query('ROLLBACK'); await c.end(); process.exit(1)
    }
    const walletId: number = wRes.rows[0].id
    const exposure = r2(Number(wRes.rows[0].exposure ?? 0))
    const cashBefore = r2(Number(wRes.rows[0].cash ?? 0))
    walletBefore.set(uid, { id: walletId, cash: cashBefore })

    let running = cashBefore
    let delta = 0

    for (const plan of playerPlans) {
      const { bet, stake, pl, payout, status } = plan
      const marker = `ADMINSETTLE-${bet.id}`.slice(0, 128)

      // result_transaction_id IS NULL is the idempotency guard: a second run matches nothing.
      const upd = await c.query(
        `UPDATE casino_bets
            SET status = $2::casino_bet_status,
                payout = $3::numeric, win_amount = $3::numeric, net_amount = $4::numeric,
                result_transaction_id = $5, settled_at = now(), updated_at = now()
          WHERE id = $1
            AND status = ANY($6::casino_bet_status[])
            AND result_transaction_id IS NULL
        RETURNING id`,
        [bet.id, status, payout, pl, marker, OPEN_STATUSES],
      )
      if (upd.rowCount === 0) continue
      settled++

      // Reporting snapshots bucket casino by the bet's created_at day, so that is the day
      // whose numbers this settlement changes — not today.
      const ist = DateTime.fromJSDate(bet.created_at, { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd')
      const dayKey = `${bet.tenant}:${bet.whitelabel_id}:${bet.currency}:${ist}`
      if (!affectedDays.has(dayKey)) {
        affectedDays.set(dayKey, {
          tenant: bet.tenant, whitelabelId: bet.whitelabel_id, currency: bet.currency,
          date: bet.created_at, ist,
        })
      }

      if (!plan.credit) continue

      const rawBefore = running
      const rawAfter = r2(rawBefore + payout)
      // wallet_ledger tracks withdrawable cash, which excludes exposure — same arithmetic
      // as creditWalletForCasino / voidCasinoBetsRefund.
      const ledgerBefore = Math.max(0, r2(rawBefore - exposure))
      const ledgerAfter = r2(ledgerBefore + payout)

      await c.query(`UPDATE wallets SET cash = $2::numeric WHERE id = $1`, [walletId, rawAfter])
      running = rawAfter
      delta = r2(delta + payout)

      const meta = {
        type: 'casino_win',
        transactionId: bet.transaction_id,
        roundId: bet.game_round_id,
        adminSettle: true,
        betId: bet.id,
        stake,
        netAmount: pl,
        reason,
        actorId,
      }

      await c.query(
        `INSERT INTO ledger_entries (tenant, wallet_id, type, amount, balance_before, balance_after, meta)
         VALUES ($1,$2,'credit',$3::numeric,$4::numeric,$5::numeric,$6::jsonb)`,
        [bet.tenant, walletId, payout, rawBefore, rawAfter, JSON.stringify(meta)],
      )
      await c.query(
        `INSERT INTO wallet_ledger
           (tenant, wallet_id, user_id, wallet_type, category, direction, amount,
            balance_before, balance_after, description, reference_type, reference_id, meta)
         VALUES ($1,$2,$3,'cash','casino_win','credit',$4::numeric,$5::numeric,$6::numeric,$7,'casino_win',$8,$9::jsonb)`,
        [bet.tenant, walletId, bet.user_id, payout, ledgerBefore, ledgerAfter,
         'Casino win', bet.transaction_id, JSON.stringify(meta)],
      )
      credited++
    }

    // One audit row per bet, written after the wallet math so `after` carries the real balance.
    for (const plan of playerPlans) {
      const { bet, stake, pl, payout, status } = plan
      await c.query(
        `INSERT INTO audit_logs (tenant, actor_id, domain, action, resource_type, resource_id, before, after)
         VALUES ($1,$2,'casino','settle_casino_bet_manual','casino_bet',$3,$4::jsonb,$5::jsonb)`,
        [bet.tenant, actorId, bet.id,
         JSON.stringify({ status: bet.status, stake, payout: null, winAmount: null, netAmount: null, cashBalance: cashBefore }),
         JSON.stringify({ status, stake, payout, winAmount: payout, netAmount: pl, credited: plan.credit ? payout : 0, cashBalance: running, reason })],
      )
    }

    expectedDelta.set(uid, delta)
  }

  // ------------------------------------------------------------ post-check
  let ok = true

  const after = await c.query<{ id: string; status: string; net_amount: string | null; payout: string | null }>(
    `SELECT id, status, net_amount, payout FROM casino_bets WHERE id = ANY($1::uuid[])`,
    [plans.map((p) => p.bet.id)],
  )
  const afterById = new Map(after.rows.map((r) => [r.id, r]))
  for (const plan of plans) {
    const row = afterById.get(plan.bet.id)
    if (!row) { console.error(`❌ bet ${plan.bet.id} vanished`); ok = false; continue }
    if (row.status !== plan.status) {
      console.error(`❌ bet ${plan.bet.id} status is '${row.status}', expected '${plan.status}'`); ok = false
    }
    if (r2(Number(row.net_amount ?? NaN)) !== plan.pl) {
      console.error(`❌ bet ${plan.bet.id} net_amount is ${row.net_amount}, expected ${money(plan.pl)}`); ok = false
    }
    if (r2(Number(row.payout ?? NaN)) !== plan.payout) {
      console.error(`❌ bet ${plan.bet.id} payout is ${row.payout}, expected ${money(plan.payout)}`); ok = false
    }
  }

  for (const [uid, before] of walletBefore) {
    const w = await c.query(`SELECT cash FROM wallets WHERE id = $1`, [before.id])
    const actual = r2(Number(w.rows[0].cash ?? 0) - before.cash)
    const expected = r2(expectedDelta.get(uid) ?? 0)
    if (actual !== expected) {
      console.error(`❌ wallet cash delta for player ${uid}: got ${money(actual)}, expected ${money(expected)}`); ok = false
    } else {
      console.log(`\nPlayer ${uid} cash: ${money(before.cash)} → ${money(r2(before.cash + expected))}  (+${money(expected)})`)
    }
  }

  console.log(`\nBets settled  : ${settled}/${plans.length}`)
  console.log(`Bets credited : ${credited}   Total credit: ${money(totalCredit)} ${currencyLabel}`)

  if (settled !== plans.length) {
    console.error(
      `❌ ${plans.length - settled} bet(s) did not transition — they already carry a result_transaction_id ` +
      `(settled by another run?). Rolling back.`,
    )
    ok = false
  }

  if (!ok) {
    console.error('\n❌ Post-check FAILED. Rolling back — nothing was written.')
    await c.query('ROLLBACK'); await c.end(); process.exit(1)
  }
  console.log('✅ Post-check passed: every bet carries its expected P/L and every wallet delta equals its payout.')

  if (!apply) {
    await c.query('ROLLBACK')
    console.log('\n(dry-run) Nothing was written. Re-run with --apply to commit.')
    await c.end(); process.exit(0)
  }

  await c.query('COMMIT')
  console.log('\n✅ COMMITTED.')
} catch (e) {
  await c.query('ROLLBACK').catch(() => {})
  console.error('\n❌ FAILED — rolled back. Error:', e instanceof Error ? e.message : String(e))
  await c.end().catch(() => {})
  process.exit(1)
}

await c.end()

// ---------------------------------------------------------------- reports
// reporting_daily_snapshots counts casino only for status IN ('won','lost') and buckets by the
// bet's created_at day, so the days these bets were PLACED are the days whose GGR just changed.
// regenerateSnapshotsForDateAfterRollback drops that day's casino + global rows and rebuilds the
// whole day through the 'global' domain (sports, casino, matka, agents, bonuses + the aggregate),
// which is exactly what a settlement correction needs.
const days = [...affectedDays.values()].sort((a, b) => a.ist.localeCompare(b.ist))
const manualCmd = (d: { tenant: string; whitelabelId: string; currency: string; ist: string }) =>
  `npm run generate:snapshots -- --tenant ${d.tenant} --whitelabel ${d.whitelabelId} --currency ${d.currency} --from ${d.ist} --to ${d.ist}`

if (days.length === 0) {
  process.exit(0)
}

if (noSnapshots) {
  console.log('\n⚠️  Snapshots NOT regenerated (--no-snapshots). Reports stay stale until you run:')
  for (const d of days) console.log(`   ${manualCmd(d)}`)
  process.exit(0)
}

console.log(`\nRegenerating reporting snapshots for ${days.length} day(s): ${days.map((d) => d.ist).join(', ')}`)
try {
  const { regenerateSnapshotsForDateAfterRollback } = await import('../src/services/reportingSnapshotService.js')
  for (const d of days) {
    const res = await regenerateSnapshotsForDateAfterRollback(d.tenant, d.whitelabelId, d.date, 'casino', d.currency)
    console.log(`   ${d.ist}  deleted ${res.deleted} row(s), regenerated: ${res.generated ? 'yes' : 'NO'}`)
    if (!res.generated) console.log(`      ↳ retry by hand: ${manualCmd(d)}`)
  }
  console.log('\n✅ Snapshots regenerated. Reports, player profile and agent GGR now reflect the settlement.')
} catch (e) {
  console.error('\n⚠️  Snapshot regeneration failed:', e instanceof Error ? e.message : String(e))
  console.error('   The settlement itself IS committed. Run these by hand:')
  for (const d of days) console.error(`   ${manualCmd(d)}`)
}

console.log('\nAgent commission accrues from these snapshots, so re-run it for the affected weeks:')
console.log(`   RECONCILE_TENANT=${days[0].tenant} npm run reconcile:commission`)
console.log(
  `   COMMISSION_BACKFILL_TENANT=${days[0].tenant} COMMISSION_BACKFILL_FROM=${days[0].ist} ` +
  `COMMISSION_BACKFILL_TO=${days[days.length - 1].ist} npm run backfill:commission`,
)

process.exit(0)
