/**
 * D/W chips, sports settlement (spec §5): a credit player's (AGENT_CREDIT / WHITELABEL_CREDIT)
 * settled sports bet moves only its own wallets.cash, exactly like a cash player's: + profit on
 * a win, − loss on a loss, nothing on a void, and the liability leaves wallets.exposure.
 * Nothing is pushed to the agent or the whitelabel (settlement_balance*), users.credit_used /
 * settlement_balance* and agent_player_credits stay as they are, no agent_credit_ledger row is
 * written, and no referral or bonus-wagering hook is queued for the credit player (a REGULAR
 * player on the same market still gets both). A result rollback reverses in cash under the
 * cash rules, including the refusal when the won profit is no longer in cash.
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
const { settleSportsBetsForResult, reverseSportsBetSettlements, recalculateUserExposure } = await import('../sportsSettlementService.js')
const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
test.before(() => guard(pool))
test.after(async () => { await closeRedisEmitter(); await pool.end() })
test.afterEach(() => mock.restoreAll())

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

/** One event with three match-odds markets, each with runners A and B. */
async function sportsEvent(tx: any) {
  const code = 'dw-' + randomUUID()
  const [sport] = await tx.insert(t.sportsTable).values({ sportCode: code, key: code, name: 'D/W QA sport' }).returning()
  const [league] = await tx.insert(t.sportsLeaguesTable).values({ sportId: sport.id, leagueCode: code, key: code, name: 'D/W QA league' }).returning()
  const [event] = await tx.insert(t.sportsEventsTable).values({ leagueId: league.id, eventCode: code, key: code, name: 'D/W QA event' }).returning()
  const market = async (n: number) => {
    const [row] = await tx.insert(t.sportsMarketsTable).values({ eventId: event.id, marketCode: `${code}-${n}`, name: `Match Odds ${n}`, type: 'match_odds' }).returning()
    const [a] = await tx.insert(t.sportsRunnersTable).values({ marketId: row.id, selectionCode: 'A', name: 'Team A' }).returning()
    const [b] = await tx.insert(t.sportsRunnersTable).values({ marketId: row.id, selectionCode: 'B', name: 'Team B' }).returning()
    return { market: row, a, b }
  }
  return { sport, league, event, m1: await market(1), m2: await market(2), m3: await market(3) }
}
type SportsEvent = Awaited<ReturnType<typeof sportsEvent>>
type Market = SportsEvent['m1']

async function openBackBet(tx: any, tenant: string, ev: SportsEvent, mk: Market, userId: number, stake: number, price: number) {
  const [bet] = await tx.insert(t.sportsBets).values({
    tenant, whitelabelId: tenant, userId, sportId: ev.sport.id, leagueId: ev.league.id, marketId: mk.market.id, eventId: ev.event.id,
    runnerId: mk.a.id, selectionId: 'A', side: 'back', price: String(price), size: String(stake), stake: String(stake),
    liability: String(stake), status: 'matched', matchedAt: new Date(), currency: 'INR',
  }).returning()
  return bet
}

async function declare(tx: any, tenant: string, ev: SportsEvent, mk: Market, runnerId: string | null, declaredAt: Date, selectionName?: string) {
  const [row] = await tx.insert(t.sportsResultsTable).values({
    tenant, whitelabelId: tenant, sportId: ev.sport.id, leagueId: ev.league.id, eventId: ev.event.id, marketId: mk.market.id,
    marketType: 'exchange', runnerId, selectionName: selectionName ?? null, declaredBy: 'dw-qa', declaredAt,
  }).returning()
  return row
}

/** Every figure of the old credit model that a settled bet used to move. */
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

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) test(`${type}: sports settlement and rollback move only the player's wallet cash`, async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const agent = type === 'AGENT_CREDIT' ? await f.agent('CREDIT') : undefined
    const player = await f.player(type, agent)
    const cashPlayer = await f.player('REGULAR')
    await tx.update(t.users).set({ creditLimit: '5000', creditUsed: '0', creditAvailable: '5000' }).where(eq(t.users.id, player.id))
    const [playerWallet] = await tx.update(t.wallets).set({ cash: '1000', exposure: '0' }).where(eq(t.wallets.userId, player.id)).returning()
    if (agent) {
      await tx.insert(t.agentPlayerCredits).values({ agentId: agent.id, playerId: player.id, creditLimit: '5000', creditAvailable: '5000' })
    }
    const ev = await sportsEvent(tx)
    routeDbToTransaction(mock, db, tx)

    const wallet = async (userId: number) => {
      const [w] = await tx.select().from(t.wallets).where(eq(t.wallets.userId, userId))
      return { cash: Number(w.cash), exposure: Number(w.exposure) }
    }
    const bet = async (id: string) => (await tx.select({ status: t.sportsBets.status, pl: t.sportsBets.pl }).from(t.sportsBets).where(eq(t.sportsBets.id, id)))[0]
    const settle = (mk: Market, data: { runnerId?: string | null; selectionName?: string | null }, resultId: string) =>
      settleSportsBetsForResult(resultId, mk.market.id, ev.event.id, 'exchange', data, f.tenant, f.tenant, tx)

    const won = await openBackBet(tx, f.tenant, ev, ev.m1, player.id, 100, 3)
    const lost = await openBackBet(tx, f.tenant, ev, ev.m2, player.id, 100, 2)
    const voided = await openBackBet(tx, f.tenant, ev, ev.m3, player.id, 100, 2)
    await openBackBet(tx, f.tenant, ev, ev.m1, cashPlayer.id, 100, 3)
    await recalculateUserExposure(player.id, f.tenant, tx)
    assert.deepEqual(await wallet(player.id), { cash: 1000, exposure: 300 })
    const before = await creditModelSnapshot(tx, f.tenant, player.id, agent?.id)

    // Won: back A at 3.0 for 100 -> +200 into cash, and its 100 of exposure is released.
    const r1 = await declare(tx, f.tenant, ev, ev.m1, ev.m1.a.id, minutesAgo(10))
    const s1 = await settle(ev.m1, { runnerId: ev.m1.a.id }, r1.id)
    assert.deepEqual(s1.errors, [])
    assert.equal(s1.betsSettled, 2)
    assert.deepEqual(await wallet(player.id), { cash: 1200, exposure: 200 })
    assert.deepEqual(await bet(won.id), { status: 'won', pl: '200.00' })
    // Referral loss-share and bonus wagering are queued for the cash player only.
    assert.deepEqual(s1.postReferral!.map((p) => p.userId), [cashPlayer.id])
    assert.deepEqual(s1.postBonus!.map((p) => p.userId), [cashPlayer.id])

    // Lost: B wins market 2 -> -100 off cash.
    const r2 = await declare(tx, f.tenant, ev, ev.m2, ev.m2.b.id, minutesAgo(10))
    const s2 = await settle(ev.m2, { runnerId: ev.m2.b.id }, r2.id)
    assert.deepEqual(s2.errors, [])
    assert.deepEqual(await wallet(player.id), { cash: 1100, exposure: 100 })
    assert.deepEqual(await bet(lost.id), { status: 'lost', pl: '-100.00' })
    assert.deepEqual([s2.postReferral, s2.postBonus], [[], []])

    // Void: cash stays, only the exposure goes.
    const r3 = await declare(tx, f.tenant, ev, ev.m3, null, minutesAgo(10), 'VOID')
    const s3 = await settle(ev.m3, { runnerId: null, selectionName: 'VOID' }, r3.id)
    assert.deepEqual(s3.errors, [])
    assert.deepEqual(await wallet(player.id), { cash: 1100, exposure: 0 })
    assert.equal((await bet(voided.id)).status, 'void')

    // The player's statement has the cash player's rows: one per settled bet...
    const entries = await tx.select({ type: t.ledgerEntries.type, meta: t.ledgerEntries.meta }).from(t.ledgerEntries).where(eq(t.ledgerEntries.walletId, playerWallet.id))
    assert.deepEqual(
      entries.filter((e: any) => e.meta?.type === 'sports_bet_settlement').map((e: any) => e.type).sort(),
      ['credit', 'debit', 'void']
    )
    // ...and the wallet_ledger settle rows that credit players used to be skipped for.
    const trail = await tx.select({ category: t.walletLedger.category }).from(t.walletLedger).where(eq(t.walletLedger.walletId, playerWallet.id))
    assert.equal(trail.filter((r: any) => r.category === 'sports_settle').length, 3)

    // Nothing from the old credit model moved.
    assert.deepEqual(await creditModelSnapshot(tx, f.tenant, player.id, agent?.id), before)

    // Rollback of the won result: the 200 profit comes back out of cash and the bet reopens.
    const rev = await reverseSportsBetSettlements(r1.id, ev.m1.market.id, ev.event.id, f.tenant, f.tenant)
    assert.deepEqual(rev.errors, [])
    assert.deepEqual(await wallet(player.id), { cash: 900, exposure: 100 })
    assert.equal((await bet(won.id)).status, 'matched')
    assert.deepEqual(await creditModelSnapshot(tx, f.tenant, player.id, agent?.id), before)

    // Cash rule: re-settled (+200), then chips are withdrawn down to 150. Reversing the 200
    // profit is refused and nothing moves.
    const r1b = await declare(tx, f.tenant, ev, ev.m1, ev.m1.a.id, minutesAgo(5))
    assert.deepEqual((await settle(ev.m1, { runnerId: ev.m1.a.id }, r1b.id)).errors, [])
    assert.deepEqual(await wallet(player.id), { cash: 1100, exposure: 0 })
    await tx.update(t.wallets).set({ cash: '150' }).where(eq(t.wallets.id, playerWallet.id))
    const refused = await reverseSportsBetSettlements(r1b.id, ev.m1.market.id, ev.event.id, f.tenant, f.tenant)
    assert.ok(refused.errors.some((e) => /Insufficient cash to reverse profit/.test(e)), refused.errors.join('; '))
    assert.deepEqual(await wallet(player.id), { cash: 150, exposure: 0 })
    assert.equal((await bet(won.id)).status, 'won')
    assert.deepEqual(await creditModelSnapshot(tx, f.tenant, player.id, agent?.id), before)
    mock.restoreAll()
  })
})
