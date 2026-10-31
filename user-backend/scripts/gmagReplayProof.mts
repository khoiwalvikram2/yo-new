/**
 * END-TO-END REPLAY PROOF for incident CS-22135.
 *
 * Drives the REAL handleGmagTransaction against bets that reproduce the incident's exact id
 * shape (bet stored as "D"+uuid, win arriving with transId "C"+uuid and referenceId = bare
 * uuid), on a throwaway sentinel player so the four genuine stuck bets of player 131 are
 * never touched — they must stay `active` for GMAG's production replay.
 *
 * Run from user-backend:  npm run verify:gmag-replay
 */
import { pool, db } from '../src/db/client.js'
import { handleGmagTransaction } from '../src/domains/casino/gmagCasinoService.js'

const TENANT = 'grandwinn-com'
const UID = 999000131
const PHONE = '9990005014'
const LAST4 = PHONE.slice(-4)
const PLAYER_ID = `${UID}_${LAST4}`
const TOKEN = 'cs22135-replay-proof-token'
const GAME_ID = 1447 // Casino Malta Roulette
const VENDOR_ID = 4
const PROVIDER_ID = 1

/** The three rounds GMAG declined with R_02, with their real amounts. */
const ROUNDS = [
  { uuid: '78df1c45-2b2f-4b79-90bc-8bb368475703', round: '18c63acefca43aeb08a4009d-replay', stake: 3600, win: 0 },
  { uuid: '0f30b773-2e4d-4f26-bafc-1004ca154b50', round: '18c63adef12b4575b7bb3866-replay', stake: 3800, win: 5400 },
  { uuid: '9302b44f-fa08-40ee-933b-b657c1a911c3', round: '18c63aeb68485294212d8be2-replay', stake: 2000, win: 3100 },
]

const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)
const money = (n: unknown) => Number(n ?? 0).toFixed(2)
let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected)
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}${ok ? '' : `, expected ${expected}`}`)
}

async function cleanup() {
  await q(`DELETE FROM wallet_ledger WHERE user_id = $1`, [UID])
  await q(`DELETE FROM ledger_entries WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = $1)`, [UID])
  await q(`DELETE FROM casino_bets WHERE user_id = $1`, [UID])
  await q(`DELETE FROM user_casino_sessions WHERE user_id = $1`, [UID])
  await q(`DELETE FROM wallets WHERE user_id = $1`, [UID])
  await q(`DELETE FROM users WHERE id = $1`, [UID])
}

async function seed() {
  await q(
    `INSERT INTO users (id, tenant, username, name, phone, password_hash, status, casino_bet_allowed, player_type)
     VALUES ($1,$2,'cs22135_replay','CS22135 Replay',$3,'x','active',true,'REGULAR')`,
    [UID, TENANT, PHONE],
  )
  await q(`INSERT INTO wallets (user_id, tenant, cash, bonus, referral_bonus, exposure, currency)
           VALUES ($1,$2,'0','0','0','0','INR')`, [UID, TENANT])
  await q(`INSERT INTO user_casino_sessions (tenant, user_id, provider_key, token, wallet_type)
           VALUES ($1,$2,'gmagcasino',$3,'cash')`, [TENANT, UID, TOKEN])
  for (const r of ROUNDS) {
    await q(
      `INSERT INTO casino_bets
         (tenant, whitelabel_id, user_id, game_id, game_name, provider_id, vendor_id, vendor_name,
          stake, status, wallet_type, currency, game_round_id, transaction_id)
       VALUES ($1,$1,$2,$3,'Casino Malta Roulette',$4,$5,'Evolution Gaming',
               $6,'active','cash','INR',$7,$8)`,
      [TENANT, UID, GAME_ID, PROVIDER_ID, VENDOR_ID, String(r.stake), r.round, `D${r.uuid}`],
    )
  }
}

/** Exactly the payload shape GMAG posts to /gmag/transaction for a win. */
const winBody = (r: (typeof ROUNDS)[number], seq = 1) => ({
  brandId: 21282,
  requestId: `req-${r.uuid}`,
  playerId: PLAYER_ID,
  playerSessionId: TOKEN,
  gameCode: 'evog_casinomaltaroulette',
  providerCode: 'evog',
  gameType: 'live',
  trans: [{
    seq,
    transId: `C${r.uuid}`,        // win id: C + uuid
    referenceId: r.uuid,          // <-- the bare uuid that used to miss the D-prefixed bet
    amount: r.win,
    transType: 'win' as const,
    transTime: '2026-07-27 19:04:42.105',
    roundId: r.round,
    roundType: 'normal',
    endRound: 1,
  }],
})

async function main() {
  console.log('=== CS-22135 end-to-end replay proof ===\n')
  await cleanup()
  await seed()

  const before = await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])
  console.log(`Sentinel player ${PLAYER_ID} seeded: 3 active bets, wallet cash ${money(before.rows[0].cash)}\n`)

  console.log('--- 1. Replaying the three declined settlements ---')
  for (const r of ROUNDS) {
    const res: any = await handleGmagTransaction(winBody(r) as any)
    const bet = await q(`SELECT status, payout, net_amount, result_transaction_id FROM casino_bets WHERE user_id=$1 AND game_round_id=$2`, [UID, r.round])
    const row = bet.rows[0]
    console.log(`\n  round ${r.round}  stake ${r.stake}  win ${r.win}`)
    check('provider error code', res?.error, '0')
    check('bet status', row.status, r.win === 0 ? 'lost' : 'won')
    check('payout', money(row.payout), money(r.win))
    check('net', money(row.net_amount), money(r.win - r.stake))
    check('result_transaction_id recorded', row.result_transaction_id, `C${r.uuid}`)
  }

  const afterWins = await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])
  const expectedCash = ROUNDS.reduce((s, r) => s + r.win, 0)
  console.log('\n--- 2. Wallet total ---')
  check('cash credited', money(afterWins.rows[0].cash), money(expectedCash))

  console.log('\n--- 3. Duplicate protection: replaying every payload again ---')
  for (const r of ROUNDS) {
    const res: any = await handleGmagTransaction(winBody(r) as any)
    check(`round ${r.round.slice(0, 12)} still SUCCESS`, res?.error, '0')
  }
  const afterDup = await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])
  check('cash UNCHANGED after replay (no double credit)', money(afterDup.rows[0].cash), money(expectedCash))

  console.log('\n--- 3b. Round-fallback replay (adversarial review finding) ---')
  // A win whose referenceId matches NO candidate is recovered via the sole active bet in the
  // round. That bet keeps its original transaction_id, so a redelivery of the SAME payload can
  // never reach it through the candidate ids. Before the fix this answered R_02 forever with
  // the money already credited — CS-22135 all over again, but paid.
  const FB = { uuid: 'fb000000-0000-0000-0000-000000000001', round: '18c63fallback-replay', stake: 1000, win: 2500 }
  await q(
    `INSERT INTO casino_bets (tenant,whitelabel_id,user_id,game_id,game_name,provider_id,vendor_id,vendor_name,
       stake,status,wallet_type,currency,game_round_id,transaction_id)
     VALUES ($1,$1,$2,$3,'Casino Malta Roulette',$4,$5,'Evolution Gaming',$6,'active','cash','INR',$7,$8)`,
    [TENANT, UID, GAME_ID, PROVIDER_ID, VENDOR_ID, String(FB.stake), FB.round, `D${FB.uuid}`],
  )
  // referenceId deliberately outside the D/C-uuid family, so no candidate can match it.
  const fbBody = (seq = 1) => ({
    ...winBody({ uuid: FB.uuid, round: FB.round, stake: FB.stake, win: FB.win }, seq),
    trans: [{ ...winBody({ uuid: FB.uuid, round: FB.round, stake: FB.stake, win: FB.win }, seq).trans[0],
      transId: 'Xfallback-result-0001', referenceId: 'vendor-session-ref-not-a-uuid' }],
  })
  const cashBeforeFb = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  const fb1: any = await handleGmagTransaction(fbBody() as any)
  check('first delivery recovered via round fallback', fb1?.error, '0')
  const fbBet = await q(`SELECT status, payout FROM casino_bets WHERE user_id=$1 AND game_round_id=$2`, [UID, FB.round])
  check('bet settled by fallback', fbBet.rows[0].status, 'won')
  const cashAfterFb1 = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  check('credited once', money(cashAfterFb1 - cashBeforeFb), money(FB.win))

  const fb2: any = await handleGmagTransaction(fbBody() as any)
  check('REDELIVERY acknowledged, NOT R_02', fb2?.error, '0')
  const cashAfterFb2 = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  check('redelivery did NOT credit again', money(cashAfterFb2), money(cashAfterFb1))

  console.log('\n--- 3c. payUp replay must not double-credit ---')
  const { handleGmagPayUp } = await import('../src/domains/casino/gmagCasinoService.js')
  const payUpBody = {
    brandId: 21282, requestId: 'payup-probe', playerId: PLAYER_ID,
    transId: 'PAYUP-TXN-0001', amount: 750, transTime: '2026-07-28 10:00:00',
    type: 'jackpot', currency: 'INR', providerCode: 'evog',
  }
  const cashBeforePay = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  const p1: any = await handleGmagPayUp(payUpBody as any)
  check('payUp accepted', p1?.error, '0')
  const cashAfterPay1 = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  check('payUp credited once', money(cashAfterPay1 - cashBeforePay), money(750))

  const p2: any = await handleGmagPayUp(payUpBody as any)
  check('payUp replay acknowledged', p2?.error, '0')
  const cashAfterPay2 = Number((await q(`SELECT cash FROM wallets WHERE user_id=$1`, [UID])).rows[0].cash)
  check('payUp replay did NOT credit again', money(cashAfterPay2), money(cashAfterPay1))
  await q(`DELETE FROM casino_callback_idempotency WHERE trans_id=$1`, ['PAYUP-TXN-0001'])

  console.log('\n--- 4. A genuinely unknown reference must still be rejected ---')
  const bogus: any = await handleGmagTransaction({
    ...winBody(ROUNDS[1]),
    trans: [{ ...winBody(ROUNDS[1]).trans[0], transId: 'Cdead0000-0000-0000-0000-000000000000', referenceId: 'dead0000-0000-0000-0000-000000000000', roundId: 'no-such-round-at-all' }],
  } as any)
  check('unknown round rejected', bogus?.error, 'R_02')

  await cleanup()
  const leftover = await q(`SELECT count(*)::int AS n FROM casino_bets WHERE user_id=$1`, [UID])
  // ORDER BY the enum's text, not its ordinal — casino_bet_status orders pending/active/won/lost.
  const real = await q(`SELECT status::text AS status, count(*)::int AS n FROM casino_bets WHERE user_id=131 GROUP BY 1 ORDER BY 1`)
  const realWallet = await q(`SELECT cash FROM wallets WHERE user_id=131`)

  console.log('\n--- 5. Cleanup + real-data safety ---')
  check('sentinel rows removed', leftover.rows[0].n, 0)
  check('player 131 bets untouched', JSON.stringify(real.rows), JSON.stringify([{ status: 'active', n: 4 }, { status: 'lost', n: 6 }, { status: 'won', n: 5 }]))
  check('player 131 wallet untouched', money(realWallet.rows[0].cash), '0.00')

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`)
  await pool.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('\nREPLAY PROOF ERROR:', e)
  try { await cleanup() } catch {}
  await pool.end()
  process.exit(1)
})
