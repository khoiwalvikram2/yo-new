/**
 * Two money paths that could be made to pay twice.
 *
 * **Deposit approval.** `approveDepositRequest` read the request with a plain
 * `SELECT ... WHERE status = 'PENDING'`, then deducted whitelabel credit,
 * credited the wallet, and finished with `UPDATE ... WHERE id = $1` — no status
 * predicate, no tenant predicate, no row lock. Two approvals arriving together
 * both saw PENDING and both ran the whole body, so one deposit credited the
 * player twice and drew down the whitelabel's credit twice.
 *
 * **Withdrawal status.** `updateWithdrawalStatusAdmin` guarded only the
 * transitions *to* FAILED, CANCELLED and COMPLETED, requiring the request to be
 * PENDING or PROCESSING. Transitions the other way were unguarded, so a settled
 * withdrawal could be moved back to PENDING — and the next FAILED then passed
 * that same guard and refunded the player again, repeatably.
 *
 * Both are asserted here by their effect on the balance, not by inspecting the
 * code that changed.
 *
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'payments-race-tenant'

let db: (typeof import('@src/db/client.js'))['db']
let userId = 0
let walletId = 0
/** The player's approved payout account: a request is paid out only to one (FIN-05). */
let accountId = 0

const money = (v: unknown) => Number(v ?? 0)

async function cash(): Promise<number> {
  const r = await db.execute(sql`SELECT cash FROM wallets WHERE id = ${walletId}`)
  return money((r.rows[0] as { cash: string } | undefined)?.cash)
}

async function newDeposit(amount: number): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO deposit_requests (tenant, user_id, amount, currency, method, utr, proof_key, status)
    VALUES (${TENANT}, ${userId}, ${amount}, 'INR', 'UPI', ${'utr-' + Date.now()}, 'k', 'PENDING')
    RETURNING id`)
  return Number((r.rows[0] as { id: number }).id)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))

  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'Payments Race', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)
  // The whitelabel credit line has to cover the deposit, or the approval fails
  // on credit rather than on the guard under test.
  await db.execute(sql`
    UPDATE whitelabels SET credit_limit = 1000000, credit_used = 0, credit_available = 1000000
    WHERE id = ${TENANT}`)

  const u = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT}, 'Racer', ${'racer-' + Date.now()}, 'active', 'x') RETURNING id`)
  userId = Number((u.rows[0] as { id: number }).id)

  const w = await db.execute(sql`
    INSERT INTO wallets (tenant, user_id, currency, cash) VALUES (${TENANT}, ${userId}, 'INR', 0)
    RETURNING id`)
  walletId = Number((w.rows[0] as { id: number }).id)

  const a = await db.execute(sql`
    INSERT INTO user_payout_accounts (tenant, user_id, method, account_number, ifsc_code, account_holder_name, approval_status)
    VALUES (${TENANT}, ${userId}, 'BANK', '555000000001', 'SBIN0000001', 'Racer', 'APPROVED') RETURNING id`)
  accountId = Number((a.rows[0] as { id: number }).id)

  // Warm the pool. On cold connections the two approvals below do not actually
  // overlap — the second waits on a TCP connect and a handshake while the first
  // has already committed — and the test passes without exercising the race.
  await Promise.all(Array.from({ length: 6 }, () => db.execute(sql`SELECT 1`)))
})

after(async () => {
  if (db) {
    // The deposit approvals and the COMPLETED withdrawal write wallet_ledger rows too; they were left behind on every run.
    await db.execute(sql`DELETE FROM wallet_ledger WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM ledger_entries WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM deposit_requests WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM withdrawal_requests WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM user_payout_accounts WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM wallets WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('a deposit is approved at most once', () => {
  it('credits the wallet once when two approvals race', async () => {
    const { approveDepositRequest } = await import('@src/repos/deposits/depositRequestsRepo.js')
    const id = await newDeposit(500)
    const before = await cash()

    const results = await Promise.allSettled([
      approveDepositRequest(id, TENANT, 1, 'a'),
      approveDepositRequest(id, TENANT, 1, 'b'),
    ])

    const won = results.filter((r) => r.status === 'fulfilled').length
    assert.equal(won, 1, `${won} approvals succeeded; exactly one must win`)
    assert.equal(
      await cash(),
      before + 500,
      'the wallet was credited more than once for a single deposit'
    )

    const rows = await db.execute(sql`SELECT status FROM deposit_requests WHERE id = ${id}`)
    assert.equal((rows.rows[0] as { status: string }).status, 'APPROVED')
  })

  it('refuses to approve an already-approved request', async () => {
    const { approveDepositRequest } = await import('@src/repos/deposits/depositRequestsRepo.js')
    const id = await newDeposit(200)
    await approveDepositRequest(id, TENANT, 1, 'first')
    const after = await cash()

    await assert.rejects(
      () => approveDepositRequest(id, TENANT, 1, 'second'),
      /not found or already processed/i,
      'a second approval of the same request was accepted'
    )
    assert.equal(await cash(), after, 'the second approval still moved money')
  })
})

describe('a settled withdrawal cannot be reopened', () => {
  it('refuses to move a COMPLETED request back to PENDING', async () => {
    const repo = await import('@src/repos/payments/withdrawalRequestsRepo.js')
    const w = await db.execute(sql`
      INSERT INTO withdrawal_requests (tenant, user_id, wallet_id, payout_account_id, amount, currency, status)
      VALUES (${TENANT}, ${userId}, ${walletId}, ${accountId}, 100, 'INR', 'PENDING')
      RETURNING id`)
    const id = Number((w.rows[0] as { id: number }).id)

    await repo.updateWithdrawalStatusAdmin(id, TENANT, 'COMPLETED', 1, 'done')
    await repo.updateWithdrawalStatusAdmin(id, TENANT, 'PENDING', 1, 'reopen')

    const rows = await db.execute(sql`SELECT status FROM withdrawal_requests WHERE id = ${id}`)
    assert.equal(
      (rows.rows[0] as { status: string }).status,
      'COMPLETED',
      'a terminal withdrawal was reopened — the repeated-refund path is open again'
    )
  })

  it('refuses to move a CANCELLED request back to PROCESSING', async () => {
    const repo = await import('@src/repos/payments/withdrawalRequestsRepo.js')
    const w = await db.execute(sql`
      INSERT INTO withdrawal_requests (tenant, user_id, wallet_id, amount, currency, status)
      VALUES (${TENANT}, ${userId}, ${walletId}, 100, 'INR', 'CANCELLED')
      RETURNING id`)
    const id = Number((w.rows[0] as { id: number }).id)

    await repo.updateWithdrawalStatusAdmin(id, TENANT, 'PROCESSING', 1, 'reopen')

    const rows = await db.execute(sql`SELECT status FROM withdrawal_requests WHERE id = ${id}`)
    assert.equal((rows.rows[0] as { status: string }).status, 'CANCELLED')
  })

  it('still allows PENDING to PROCESSING, which is a live transition', async () => {
    const repo = await import('@src/repos/payments/withdrawalRequestsRepo.js')
    const w = await db.execute(sql`
      INSERT INTO withdrawal_requests (tenant, user_id, wallet_id, payout_account_id, amount, currency, status)
      VALUES (${TENANT}, ${userId}, ${walletId}, ${accountId}, 100, 'INR', 'PENDING')
      RETURNING id`)
    const id = Number((w.rows[0] as { id: number }).id)

    await repo.updateWithdrawalStatusAdmin(id, TENANT, 'PROCESSING', 1, 'picked up')

    const rows = await db.execute(sql`SELECT status FROM withdrawal_requests WHERE id = ${id}`)
    assert.equal(
      (rows.rows[0] as { status: string }).status,
      'PROCESSING',
      'the guard is too tight — it now blocks a legitimate transition'
    )
  })
})
