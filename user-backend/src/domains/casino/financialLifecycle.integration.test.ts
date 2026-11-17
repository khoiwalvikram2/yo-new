import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, types, t, eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../db/client.js')
const gap = await import('./gapCasinoService.js'), gmag = await import('./gmagCasinoService.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())
// Credit players hold Deposit/Withdraw chips in wallets.cash and play on the cash-wallet path, so
// they get the same cash results as a cash-funded REGULAR player. They never play from a bonus
// wallet: a bonus or referral-bonus session still stakes, pays and refunds their cash.
const credits = new Set(['AGENT_CREDIT', 'WHITELABEL_CREDIT'])
for (const provider of ['gapcasino', 'gmagcasino']) for (const type of types) for (const funding of ['cash', 'bonus', 'referralBonus']) {
  test(`${provider}/${type}/${funding}: debit, win, loss, open refund and duplicate callbacks reconcile the wallet exactly`, async () => {
    await rollback(db, async tx => {
      const f = await fixture(tx), isCredit = credits.has(type), spent = isCredit ? 'cash' : funding
      const owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined
      const player = await f.player(type, owner)
      await tx.update(t.wallets).set({ cash: '10000', bonus: '10000', referralBonus: '10000' }).where(eq(t.wallets.userId, player.id))
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
      const upline = async () => ({
        agent: owner ? (await tx.select().from(t.agents).where(eq(t.agents.id, owner.id)))[0] : null,
        whitelabel: (await tx.select().from(t.whitelabels).where(eq(t.whitelabels.id, f.tenant)))[0],
      })
      const creditBefore = await account(), uplineBefore = await upline()
      okay(await send('bet', 'stake-a', 113)); okay(await send('bet', 'stake-b', 227)); okay(await send('bet', 'stake-c', 349))
      assert.equal(Number((await wallet())[spent]), 9311)
      const replay: any = await send('bet', 'stake-a', 113)
      if (provider === 'gapcasino') assert.equal(replay.status, 'OP_DUPLICATE_TRANSACTION'); else okay(replay)
      assert.equal(Number((await wallet())[spent]), 9311)
      okay(await send('win', 'stake-a', 271)); okay(await send('win', 'stake-b', 0)); okay(await send('cancel', 'stake-c', 349))
      const beforeReplay = await wallet(), beforeCredit = await account()
      await send('win', 'stake-a', 271); await send('cancel', 'stake-c', 349)
      const after = await wallet(), afterCredit = await account()
      for (const field of ['cash', 'bonus', 'referralBonus', 'referralBalance', 'exposure']) assert.equal(after[field], beforeReplay[field], 'duplicate callback ' + field)
      for (const field of ['creditUsed', 'creditAvailable', 'settlementBalance']) assert.equal(afterCredit[field], beforeCredit[field], 'duplicate callback ' + field)
      if (isCredit) {
        // Chips: -689 staked, +271 win, +349 refund. Bonus funds are never touched.
        assert.equal(Number(after.cash), 9931); assert.equal(Number(after.bonus), 10000); assert.equal(Number(after.referralBonus), 10000)
        assert.equal(Number(after.referralBalance), 0)
        // The old credit figures do not move, and nothing is pushed to the agent or the whitelabel.
        for (const field of ['creditLimit', 'creditUsed', 'creditAvailable', 'settlementBalance', 'settlementBalanceCasino']) assert.equal(afterCredit[field], creditBefore[field], 'credit figure ' + field)
        assert.deepEqual(await upline(), uplineBefore, 'agent and whitelabel rows are untouched')
        // Every chip movement is on the player's wallet statement.
        const lines = await tx.select().from(t.walletLedger).where(eq(t.walletLedger.userId, player.id))
        assert.equal(lines.filter((line: any) => line.category === 'casino_bet').length, 3)
        assert.equal(lines.filter((line: any) => line.category === 'casino_rollback').length, 1)
        assert.ok(lines.some((line: any) => line.category === 'casino_win' && Number(line.amount) === 271))
        assert.ok(lines.every((line: any) => line.walletType === 'cash'), 'credit players move cash only')
      } else {
        // Referral bonus is promotional principal: wins convert only net profit
        // to referral balance; an open cancellation returns its original principal.
        assert.equal(Number(after[funding]), funding === 'referralBonus' ? 9660 : 9931)
        assert.equal(Number(after.referralBalance), funding === 'referralBonus' ? 158 : 0)
        for (const other of ['cash', 'bonus', 'referralBonus'].filter(value => value !== funding)) assert.equal(Number(after[other]), 10000)
      }
      const bets = await tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant, f.tenant))
      assert.equal(bets.length, 3); assert.deepEqual(bets.map(bet => bet.status).sort(), ['lost', 'void', 'won'])
      if (isCredit) assert.ok(bets.every(bet => bet.walletType === 'cash'), 'credit bets are recorded on cash')
      const realised = bets.filter(bet => ['won', 'lost'].includes(bet.status))
      assert.equal(realised.reduce((sum, bet) => sum + Number(bet.stake) - Number(bet.payout ?? bet.winAmount), 0), 69)
      mock.restoreAll()
    })
  })
}

// A credit player with too few chips is refused, and nothing is staked.
for (const provider of ['gapcasino', 'gmagcasino']) for (const type of credits) {
  test(`${provider}/${type}: a stake above cash - exposure is refused with no bet and no debit`, async () => {
    await rollback(db, async tx => {
      const f = await fixture(tx)
      const owner = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
      const player = await f.player(type, owner)
      await tx.update(t.wallets).set({ cash: '500', exposure: '200', bonus: '10000' }).where(eq(t.wallets.userId, player.id))
      const [apiProvider] = await tx.insert(t.casinoApiProviders).values({ key: provider, name: 'Isolated financial QA' }).onConflictDoUpdate({ target: t.casinoApiProviders.key, set: { name: 'Isolated financial QA' } }).returning()
      const code = randomUUID(), [vendor] = await tx.insert(t.casinoVendors).values({ name: 'Financial QA Vendor', slug: code }).returning()
      await tx.insert(t.casinoGames).values({ apiProviderId: apiProvider.id, vendorId: vendor.id, mainCategory: 'casino', externalId: code, slug: code, name: 'Financial QA Game' })
      const token = randomUUID()
      // A bonus session must not let a credit player stake bonus funds either.
      await tx.insert(t.userCasinoSessions).values({ tenant: f.tenant, userId: player.id, token, providerKey: provider, walletType: 'bonus', expiresAt: new Date(Date.now() + 3600000) })
      routeDbToTransaction(mock, db, tx)
      const response: any = provider === 'gapcasino'
        ? await gap.handleDebit({ userId: player.id, token, gameId: code, transactionId: 'short', roundId: 'round-short', debitAmount: 301 })
        : await gmag.handleGmagTransaction({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, playerSessionId: token, gameCode: code, trans: [{ seq: 1, transId: 'short', referenceId: 'short', roundId: 'round-short', transType: 'bet', amount: 301, transTime: new Date().toISOString(), endRound: 0 }] })
      assert.equal(provider === 'gapcasino' ? response.status : response.error, provider === 'gapcasino' ? 'OP_INSUFFICIENT_FUNDS' : 'T_01', JSON.stringify(response))
      assert.equal(response.balance, 300, 'the provider is told cash - exposure')
      const [walletAfter] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id))
      assert.equal(Number(walletAfter.cash), 500); assert.equal(Number(walletAfter.bonus), 10000)
      assert.equal((await tx.select().from(t.casinoBets).where(eq(t.casinoBets.tenant, f.tenant))).length, 0)
      // The balance callback reports the same cash figure, not the bonus wallet the session names.
      const balance: any = provider === 'gapcasino'
        ? await gap.handleWalletBalance({ userId: player.id, token })
        : await gmag.handleGmagBalance({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, playerSessionId: token })
      assert.equal(balance.balance, 300, JSON.stringify(balance))
      mock.restoreAll()
    })
  })
}

// A provider payUp (jackpot / promo, no bet behind it) pays a credit player's chips in cash, once.
for (const type of credits) {
  test(`gmagcasino/${type}: payUp pays cash once and leaves the credit figures and the upline alone`, async () => {
    await rollback(db, async tx => {
      const f = await fixture(tx)
      const owner = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
      const player = await f.player(type, owner)
      routeDbToTransaction(mock, db, tx)
      const account = async () => (await tx.select().from(t.users).where(eq(t.users.id, player.id)))[0]
      const upline = async () => ({
        agent: owner ? (await tx.select().from(t.agents).where(eq(t.agents.id, owner.id)))[0] : null,
        whitelabel: (await tx.select().from(t.whitelabels).where(eq(t.whitelabels.id, f.tenant)))[0],
      })
      const creditBefore = await account(), uplineBefore = await upline()
      const payUp = () => gmag.handleGmagPayUp({ brandId: 'isolated', requestId: randomUUID(), playerId: `${player.id}_0000`, transId: 'jackpot-' + player.id, amount: 50, transTime: new Date().toISOString(), type: 'jackpot', currency: 'INR' })
      const first: any = await payUp()
      assert.equal(first.error, '0', JSON.stringify(first)); assert.equal(first.balance, 10050)
      const replay: any = await payUp()
      assert.equal(replay.error, '0', JSON.stringify(replay)); assert.equal(replay.balance, 10050, 'a redelivered payUp pays nothing')
      const [walletAfter] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, player.id))
      assert.equal(Number(walletAfter.cash), 10050)
      const creditAfter = await account()
      for (const field of ['creditUsed', 'creditAvailable', 'settlementBalance', 'settlementBalanceCasino']) assert.equal(creditAfter[field], creditBefore[field], field)
      assert.deepEqual(await upline(), uplineBefore, 'agent and whitelabel rows are untouched')
      mock.restoreAll()
    })
  })
}
