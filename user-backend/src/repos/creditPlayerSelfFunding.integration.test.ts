/**
 * Credit players cannot deposit or withdraw for themselves (CREDIT scheme on Deposit/Withdraw
 * chips, spec §5 exclusions).
 *
 * A credit player (AGENT_CREDIT / WHITELABEL_CREDIT) now holds real chips in wallets.cash, and
 * only the upline may move them (depositChips / withdrawChips). The player's own deposit and
 * withdrawal requests must stay refused: a withdrawal request would otherwise turn chips the
 * upline handed down into money paid out. A cash player with the same wallet still passes the
 * same check, so the refusal is the player type and not the balance.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts),
 * inside a transaction that is always rolled back.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { createDepositRequest, createWithdrawalRequest } = await import('./userAppRepo.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) test(`${type} holding chips cannot request a deposit or a withdrawal`, async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
    const player = await f.player(type, agent)
    await tx.update(t.wallets).set({ cash: '5000', exposure: '0' }).where(eq(t.wallets.userId, player.id))
    routeDbToTransaction(mock, db, tx)

    await assert.rejects(
      createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 1000 }),
      /Withdrawals are disabled for credit players\. Please contact your agent\./
    )
    await assert.rejects(
      createDepositRequest({ userId: player.id, tenant: f.tenant, amount: 1000, method: 'UPI', utr: 'dw-utr-1' }),
      /Deposits are disabled for credit players\. Please contact your agent\./
    )

    const [wallet] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id))
    assert.equal(Number(wallet.cash), 5000, 'the chips stay in the wallet')
    assert.equal((await tx.select().from(t.withdrawalRequests).where(eq(t.withdrawalRequests.userId, player.id))).length, 0)
    assert.equal((await tx.select().from(t.depositRequests).where(eq(t.depositRequests.userId, player.id))).length, 0)
    mock.restoreAll()
  })
})

test('a REGULAR player with the same wallet is not stopped by the credit-player refusal', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const player = await f.player('REGULAR')
    await tx.update(t.wallets).set({ cash: '5000', exposure: '0' }).where(eq(t.wallets.userId, player.id))
    routeDbToTransaction(mock, db, tx)
    // It may fail later for its own reasons (no payout account here), never as a credit player.
    const outcome = await createWithdrawalRequest({ userId: player.id, tenant: f.tenant, amount: 1000 }).then(() => 'created', (error: Error) => error.message)
    assert.doesNotMatch(outcome, /credit players/)
    mock.restoreAll()
  })
})
