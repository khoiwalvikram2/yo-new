/**
 * adjustWalletDb's withdrawal check (players/PLA-02) works in whole cents. Cash and exposure are numeric(18,2), and the
 * float subtraction 0.30 - 0.10 is 0.19999999999999998, so a withdrawal of exactly the available 0.20 was refused
 * ("Available: 0.20, Requested: 0.20"). A cent more than the available balance, or a fraction of one, is still refused.
 *
 * Runs on the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction that is
 * rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/players/__tests__/adjustWalletAvailableBalance.integration.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { adjustWalletDb } = await import('../walletsRepo.js')
test.before(() => guard(pool))
test.after(async () => { await pool.end() })

const meta = { type: 'admin_adjustment', reason: 'vfyfix full withdrawal' }

test('a withdrawal of exactly the available balance is taken to the cent; a cent more, or a fraction of one, is refused', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx), player = await f.player()
    const cashOf = async () => Number((await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id)))[0].cash)

    // Cash and exposure as stored, and the whole available balance taken. The first two were refused by the float check.
    for (const [cash, exposure, take] of [['0.30', '0.10', 0.2], ['0.30', '0.20', 0.1], ['100.20', '30.10', 70.1]] as const) {
      await tx.update(t.wallets).set({ cash, exposure }).where(eq(t.wallets.userId, player.id))
      assert.ok(await adjustWalletDb(player.id, -take, meta, f.tenant, tx), `${cash} cash, ${exposure} exposure: the wallet was found`)
      assert.equal(await cashOf(), Math.round((Number(cash) - take) * 100) / 100, `${cash} cash, ${exposure} exposure: ${take} is taken`)
    }

    // Cash 30.10 with 30.10 held: nothing is available, not a cent and not a fraction of one.
    await assert.rejects(adjustWalletDb(player.id, -0.01, meta, f.tenant, tx), { message: 'Insufficient available balance. Available: 0.00 (Cash: 30.10, Exposure: 30.10), Requested: 0.01' })
    await assert.rejects(adjustWalletDb(player.id, -0.004, meta, f.tenant, tx), { message: 'Insufficient available balance. Available: 0.00 (Cash: 30.10, Exposure: 30.10), Requested: 0.01' })
    assert.equal(await cashOf(), 30.1)
  })
})
