/**
 * D/W chips, sports placement (spec §5): a credit player (AGENT_CREDIT / WHITELABEL_CREDIT)
 * holds its chips in wallets.cash and stakes against cash − exposure like a cash player.
 * Its credit limit is only a reference: a large one lets nothing through. Placing a bet
 * holds the liability in wallets.exposure, leaves cash alone, and moves nothing from the old
 * credit model (users.credit_used / credit_available / settlement_balance*, the agent, the
 * whitelabel, agent_player_credits, agent_credit_ledger).
 *
 * placeSportsBetForUser needs live provider odds, so this drives the two transaction steps it
 * runs for every player type: the locked cash check and the insert + exposure recalculation.
 *
 * The last test joins the three bet domains on one wallet: the liability a sports bet holds as
 * exposure limits the same player's casino and matka stakes, which come off cash on the locked
 * wallet row (debitWalletForCasino, changeMatkaWallet), to cash − exposure.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts),
 * inside a transaction that is always rolled back.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { assertCashWalletCoversProjectedBookExposureInTx, insertSportsBetsAndRecalcExposureLedgerInTx } = await import('./sportsBetPlacementTx.js')
const { placeSportsBetForUser } = await import('./sportsBetService.js')
const { userAppMutationResolvers } = await import('../resolvers/mutations.js')
const { debitWalletForCasino } = await import('../../../repos/casinoWalletRepo.js')
const { changeMatkaWallet } = await import('@shared/matka/wallet.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

async function sportsMarket(tx: any) {
  const code = 'dw-' + randomUUID()
  const [sport] = await tx.insert(t.sportsTable).values({ sportCode: code, key: code, name: 'D/W QA sport' }).returning()
  const [league] = await tx.insert(t.sportsLeaguesTable).values({ sportId: sport.id, leagueCode: code, key: code, name: 'D/W QA league' }).returning()
  const [event] = await tx.insert(t.sportsEventsTable).values({ leagueId: league.id, eventCode: code, key: code, name: 'D/W QA event' }).returning()
  const [market] = await tx.insert(t.sportsMarketsTable).values({ eventId: event.id, marketCode: code, name: 'Match Odds', type: 'match_odds' }).returning()
  const [a] = await tx.insert(t.sportsRunnersTable).values({ marketId: market.id, selectionCode: 'A', name: 'Team A' }).returning()
  const [b] = await tx.insert(t.sportsRunnersTable).values({ marketId: market.id, selectionCode: 'B', name: 'Team B' }).returning()
  return { sport, league, event, market, a, b }
}

type Market = Awaited<ReturnType<typeof sportsMarket>>
function leg(m: Market, runner: any, side: 'back' | 'lay', odds: number, stake: number, tenant: string) {
  return {
    leg: { selectionId: runner.selectionCode, oddsSize: null, selection: runner.name, isLive: false },
    side,
    odds,
    stake,
    liability: side === 'lay' ? (odds - 1) * stake : stake,
    marketType: 'exchange' as const,
    marketId: m.market.id,
    eventId: m.event.id,
    leagueId: m.league.id,
    sportId: m.sport.id,
    runnerId: runner.id,
    whitelabelId: tenant,
    currency: 'INR',
  }
}

/** Every figure of the old credit model that a bet used to move. */
async function creditModelSnapshot(tx: any, tenant: string, playerId: number, agentId?: string) {
  const [user] = await tx.select({
    creditLimit: t.users.creditLimit, creditUsed: t.users.creditUsed, creditAvailable: t.users.creditAvailable,
    settlement: t.users.settlementBalance, sports: t.users.settlementBalanceSports,
    casino: t.users.settlementBalanceCasino, matka: t.users.settlementBalanceMatka,
  }).from(t.users).where(eq(t.users.id, playerId))
  const agent = agentId
    ? (await tx.select({
        chipBalance: t.agents.chipBalance, creditUsed: t.agents.creditUsed, creditAvailable: t.agents.creditAvailable,
        settlement: t.agents.settlementBalance, sports: t.agents.settlementBalanceSports,
      }).from(t.agents).where(eq(t.agents.id, agentId)))[0]
    : null
  const [whitelabel] = await tx.select({
    creditUsed: t.whitelabels.creditUsed, creditAvailable: t.whitelabels.creditAvailable,
    settlement: t.whitelabels.settlementBalance, sports: t.whitelabels.settlementBalanceSports,
  }).from(t.whitelabels).where(eq(t.whitelabels.id, tenant))
  const apc = await tx.select({
    currentBalance: t.agentPlayerCredits.currentBalance, openExposure: t.agentPlayerCredits.openExposure,
    creditUsed: t.agentPlayerCredits.creditUsed, creditAvailable: t.agentPlayerCredits.creditAvailable,
  }).from(t.agentPlayerCredits).where(eq(t.agentPlayerCredits.playerId, playerId))
  const agentCreditLedgerRows = (await tx.select({ id: t.agentCreditLedger.id }).from(t.agentCreditLedger).where(eq(t.agentCreditLedger.tenantId, tenant))).length
  return { user, agent, whitelabel, apc, agentCreditLedgerRows }
}

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) test(`${type}: sports bets stake against cash − exposure; the credit reference gates nothing`, async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
    const player = await f.player(type, agent)
    // 500 chips; a credit reference (and stale old-model figures) far above them.
    await tx.update(t.users).set({
      creditLimit: '100000', creditUsed: '0', creditAvailable: '100000', settlementBalance: '50000', settlementBalanceSports: '50000',
    }).where(eq(t.users.id, player.id))
    const [wallet] = await tx.update(t.wallets).set({ cash: '500', exposure: '0' }).where(eq(t.wallets.userId, player.id)).returning()
    if (agent) {
      await tx.insert(t.agentPlayerCredits).values({ agentId: agent.id, playerId: player.id, creditLimit: '100000', currentBalance: '50000', creditAvailable: '100000' })
    }
    const m = await sportsMarket(tx)
    routeDbToTransaction(mock, db, tx)
    const check = (legs: any[]) =>
      assertCashWalletCoversProjectedBookExposureInTx(tx, { walletId: wallet.id, tenant: f.tenant, userId: player.id, validatedLegs: legs })
    const before = await creditModelSnapshot(tx, f.tenant, player.id, agent?.id)

    // 600 on A at 2.0 needs 600: more than the 500 chips, whatever the credit reference says.
    await assert.rejects(check([leg(m, m.a, 'back', 2, 600, f.tenant)]), /Insufficient available balance/)

    // 400 fits: the bet is matched, its liability is held in wallets.exposure, cash is untouched.
    const legs = [leg(m, m.a, 'back', 2, 400, f.tenant)]
    await check(legs)
    const rows = await insertSportsBetsAndRecalcExposureLedgerInTx(tx, {
      userId: player.id, tenant: f.tenant, wallet, slipId: 'dw-' + randomUUID().slice(0, 8), validatedLegs: legs,
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'matched')
    const [afterBet] = await tx.select().from(t.wallets).where(eq(t.wallets.id, wallet.id))
    assert.equal(Number(afterBet.cash), 500, 'nothing is taken off the chips at placement')
    assert.equal(Number(afterBet.exposure), 400)

    // The exposure trail is the cash player's: one sports_bet wallet_ledger row, cash − exposure.
    const trail = await tx.select().from(t.walletLedger).where(eq(t.walletLedger.walletId, wallet.id))
    assert.equal(trail.length, 1)
    assert.equal(trail[0].category, 'sports_bet')
    assert.deepEqual([Number(trail[0].balanceBefore), Number(trail[0].balanceAfter)], [500, 100])

    // 400 of 500 is 80%: the high exposure alert now covers credit players and does not
    // break the placement transaction.
    const alerts = await tx.select().from(t.notifications).where(eq(t.notifications.userId, player.id))
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].title, 'High player exposure alert')

    // Available is now 100: another 200 on A needs 600 in total and is refused...
    await assert.rejects(check([leg(m, m.a, 'back', 2, 200, f.tenant)]), /Insufficient available balance\. Available: \D*100\.00,/)
    // ...while a hedge that lowers the book (lay A) still fits.
    await check([leg(m, m.a, 'lay', 2, 300, f.tenant)])

    // The player's own recalculation treats the credit player like a cash player.
    const res = await userAppMutationResolvers.recalculateExposure(null, null, { auth: { userId: player.id, tenant: f.tenant, requestTenant: f.tenant } } as any)
    assert.equal(res.success, true, res.message)
    assert.equal(res.exposure, 400)

    // Nothing from the old credit model moved.
    assert.deepEqual(await creditModelSnapshot(tx, f.tenant, player.id, agent?.id), before)
    mock.restoreAll()
  })
})

/**
 * The real placeSportsBetForUser, with the provider odds answered by a fetch stub. Each call
 * stops with an error before the placement transaction, so nothing is written.
 */
for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) test(`${type}: placeSportsBetForUser checks cash − exposure, not the credit figures`, async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
    const player = await f.player(type, agent)
    await tx.update(t.wallets).set({ cash: '500', exposure: '0' }).where(eq(t.wallets.userId, player.id))
    const m = await sportsMarket(tx)
    routeDbToTransaction(mock, db, tx)
    const odds = { data: [{ marketCode: m.market.marketCode, status: 'OPEN', runners: [{ selectionId: 'A', ex: { availableToBack: [{ price: 2 }], availableToLay: [{ price: 2.02 }] } }] }] }
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(odds), { status: 200, headers: { 'content-type': 'application/json' } }))
    const ctx: any = { auth: { userId: player.id, tenant: f.tenant, requestTenant: f.tenant } }
    const place = (stake: number) => placeSportsBetForUser(ctx, {
      input: { legs: [{ eventId: m.event.id, marketId: m.market.id, marketCode: m.market.marketCode, selectionId: 'A', selection: 'Team A', selectionType: 'back', odds: 2, stake, marketType: 'exchange' }] },
    })

    // A credit reference and settlement far above the chips do not let a 600 bet through on 500 chips.
    await tx.update(t.users).set({ creditLimit: '100000', creditUsed: '0', creditAvailable: '100000', settlementBalance: '50000' }).where(eq(t.users.id, player.id))
    await assert.rejects(place(600), /Insufficient available balance\. Available: \D*500\.00 \(Cash: \D*500\.00, Exposure: \D*0\.00\), Required \(book-based\): \D*600\.00/)

    // With no credit at all (the old code refused here: "Credit limit reached"), 400 of 500
    // chips passes the balance check and stops at the next one, the player's own stake limit.
    await tx.update(t.users).set({ creditLimit: '0', creditUsed: '0', creditAvailable: '0', settlementBalance: '0' }).where(eq(t.users.id, player.id))
    await tx.insert(t.playerLimits).values({ tenant: f.tenant, userId: player.id, maxBetSports: '300' })
    await assert.rejects(place(400), /Single bet stake exceeds your configured limit of 300/)

    assert.equal((await tx.select().from(t.sportsBets).where(eq(t.sportsBets.userId, player.id))).length, 0, 'nothing was placed')
    mock.restoreAll()
  })
})

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) test(`${type}: open sports exposure limits casino and matka stakes to cash − exposure`, async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
    const player = await f.player(type, agent)
    // 500 chips; stale old-model figures far above them must not let anything through.
    await tx.update(t.users).set({ creditLimit: '100000', creditUsed: '0', creditAvailable: '100000', settlementBalance: '50000' }).where(eq(t.users.id, player.id))
    const [wallet] = await tx.update(t.wallets).set({ cash: '500', exposure: '0' }).where(eq(t.wallets.userId, player.id)).returning()
    const m = await sportsMarket(tx)
    routeDbToTransaction(mock, db, tx)
    const before = await creditModelSnapshot(tx, f.tenant, player.id, agent?.id)

    // A sports bet holds 400 of the 500 chips as exposure; 100 are free.
    await insertSportsBetsAndRecalcExposureLedgerInTx(tx, {
      userId: player.id, tenant: f.tenant, wallet, slipId: 'dw-' + randomUUID().slice(0, 8), validatedLegs: [leg(m, m.a, 'back', 2, 400, f.tenant)],
    })

    // Casino: the stake comes off cash, but only out of the free chips.
    const casinoMeta = { type: 'casino_bet' as const, transactionId: 'dw-' + randomUUID(), roundId: 'dw-round' }
    await assert.rejects(debitWalletForCasino(tx, player.id, f.tenant, 101, 'cash', casinoMeta), /available 100\.00, required 101\.00/)
    assert.equal(await debitWalletForCasino(tx, player.id, f.tenant, 60, 'cash', casinoMeta), 440)

    // Matka: the same wallet, with 40 free chips left (amounts in paise).
    const matka = (delta: bigint) => changeMatkaWallet(tx, {
      tenant: f.tenant, userId: player.id, walletType: 'cash', delta, referenceId: randomUUID(), category: 'matka_bet', description: 'Matka stake',
    })
    await assert.rejects(matka(-4001n), /Insufficient available balance/)
    assert.equal((await matka(-4000n)).balance, 0)

    // The sports liability is still covered: cash 400 against exposure 400.
    const [after] = await tx.select().from(t.wallets).where(eq(t.wallets.id, wallet.id))
    assert.deepEqual([Number(after.cash), Number(after.exposure)], [400, 400])
    // Nothing from the old credit model moved, on the player, the agent or the whitelabel.
    assert.deepEqual(await creditModelSnapshot(tx, f.tenant, player.id, agent?.id), before)
    mock.restoreAll()
  })
})
