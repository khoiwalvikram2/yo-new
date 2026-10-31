import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, types, t, eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../db/client.js')
const gap = await import('./gapCasinoService.js'), gmag = await import('./gmagCasinoService.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())
const credits = new Set(['AGENT_CREDIT', 'WHITELABEL_CREDIT'])
for (const provider of ['gapcasino', 'gmagcasino']) for (const type of types) for (const funding of credits.has(type) ? ['cash'] : ['cash', 'bonus', 'referralBonus']) {
  test(`${provider}/${type}/${funding}: debit, win, loss, open refund and duplicate callbacks reconcile wallet and credit exactly`, async () => {
    await rollback(db, async tx => {
      const f = await fixture(tx), isCredit = credits.has(type)
      const owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined
      const player = await f.player(type, owner)
      await tx.update(t.wallets).set({ cash: isCredit ? '0' : '10000', bonus: '10000', referralBonus: '10000' }).where(eq(t.wallets.userId, player.id))
      const [apiProvider] = await tx.insert(t.casinoApiProviders).values({ key: provider, name: 'Isolated financial QA' }).onConflictDoUpdate({ target: t.casinoApiProviders.key, set: { name: 'Isolated financial QA' } }).returning()
      const code = randomUUID(), [vendor] = await tx.insert(t.casinoVendors).values({ name: 'Financial QA Vendor', slug: code }).returning()
      await tx.insert(t.casinoGames).values({ apiProviderId: apiProvider.id, vendorId: vendor.id, mainCategory: 'casino', externalId: code, slug: code, name: 'Financial QA Game' })
      const token = randomUUID()
      await tx.insert(t.userCasinoSessions).values({ tenant: f.tenant, userId: player.id, token, providerKey: provider, walletType: funding, expiresAt: new Date(Date.now() + 3600000) })
      routeDbToTransaction(mock, db, tx)
      const send = async (kind: 'bet' | 'win' | 'cancel', id: string, amount: number) => {
        if (provider === 'gapcasino') {
          const body = { userId: player.id, token, gameId: code, transactionId: id, roundId: 'round-' + id }
          return kind === 'bet' ? gap.handleDebit({ ...body, debitAmount: amount }) : kind === 'win' ? gap.handleCredit({ ...body, creditAmount: amount, reqId: 'win-' + id }) : gap.handleRollback({ ...body, reqId: 'cancel-' + id })
        }
        return gmag.handleGmagTransaction({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, playerSessionId: token, gameCode: code, trans: [{ seq: 1, transId: kind === 'bet' ? id : kind + '-' + id, referenceId: id, roundId: 'round-' + id, transType: kind, amount, transTime: new Date().toISOString(), endRound: kind === 'win' ? 1 : 0 }] })
      }
      const okay = (response: any) => assert.equal(provider === 'gapcasino' ? response.status : response.error, provider === 'gapcasino' ? 'OP_SUCCESS' : '0', JSON.stringify(response))
      const wallet = async () => (await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id)))[0]
      const account = async () => (await tx.select().from(t.users).where(eq(t.users.id, player.id)))[0]
      okay(await send('bet', 'stake-a', 113)); okay(await send('bet', 'stake-b', 227)); okay(await send('bet', 'stake-c', 349))
      if (isCredit) assert.equal(Number((await account()).creditUsed), 689)
      else assert.equal(Number((await wallet())[funding]), 9311)
      const replay: any = await send('bet', 'stake-a', 113)
      if (provider === 'gapcasino') assert.equal(replay.status, 'OP_DUPLICATE_TRANSACTION'); else okay(replay)
      if (isCredit) assert.equal(Number((await account()).creditUsed), 689)
      else assert.equal(Number((await wallet())[funding]), 9311)
      okay(await send('win', 'stake-a', 271)); okay(await send('win', 'stake-b', 0)); okay(await send('cancel', 'stake-c', 349))
      const beforeReplay = await wallet(), beforeCredit = await account()
      await send('win', 'stake-a', 271); await send('cancel', 'stake-c', 349)
      const after = await wallet(), afterCredit = await account()
      for (const field of ['cash', 'bonus', 'referralBonus', 'referralBalance', 'exposure']) assert.equal(after[field], beforeReplay[field], 'duplicate callback ' + field)
      for (const field of ['creditUsed', 'creditAvailable', 'settlementBalance']) assert.equal(afterCredit[field], beforeCredit[field], 'duplicate callback ' + field)
      if (isCredit) {
        assert.equal(Number(after.cash), 0); assert.equal(Number(afterCredit.creditUsed), 0)
        assert.equal(Number(afterCredit.settlementBalance), -69); assert.equal(Number(afterCredit.creditAvailable), 9931)
      } else {
        // Referral bonus is promotional principal: wins convert only net profit
        // to referral balance; an open cancellation returns its original principal.
        assert.equal(Number(after[funding]), funding === 'referralBonus' ? 9660 : 9931)
        assert.equal(Number(after.referralBalance), funding === 'referralBonus' ? 158 : 0)
        for (const other of ['cash', 'bonus', 'referralBonus'].filter(value => value !== funding)) assert.equal(Number(after[other]), 10000)
      }
      const bets = await tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant, f.tenant))
      assert.equal(bets.length, 3); assert.deepEqual(bets.map(bet => bet.status).sort(), ['lost', 'void', 'won'])
      const realised = bets.filter(bet => ['won', 'lost'].includes(bet.status))
      assert.equal(realised.reduce((sum, bet) => sum + Number(bet.stake) - Number(bet.payout ?? bet.winAmount), 0), 69)
      mock.restoreAll()
    })
  })
}
