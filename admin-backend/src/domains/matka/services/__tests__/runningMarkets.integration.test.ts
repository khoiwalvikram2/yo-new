import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq, types } from '../../../../../../tmp/domain-visibility-integration-fixtures.js'
import { declareAndSettleMatka, reverseMatkaResult } from '@shared/matka/settlement.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../../db/client.js')
const { listRunningMatkaMarkets, listRunningMatkaBets, runningMatkaTenant } = await import('../runningMarkets.js')
const { matkaQueryResolvers } = await import('../../resolvers/queries.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())
const date = '2026-10-23'
async function seed(tx: any) {
  const f = await fixture(tx), player = await f.player()
  async function market(kind = 'worli', extra: any = {}) {
    const [row] = await tx.insert(t.matkas).values({ tenant: f.tenant, name: kind + ' QA', code: randomUUID(), timezone: 'Asia/Kolkata', status: 'active', schedule: { openTime: '23:00', closeTime: '01:00', daysOfWeek: [0,1,2,3,4,5,6] }, settings: { matkaType: kind }, limits: { minBet: 10, maxBet: 10000 }, visibility: {}, ...extra }).returning()
    return row
  }
  async function bet(market: any, extra: any = {}) {
    const [row] = await tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id, matkaType: (market.settings as any).matkaType, marketName: market.name, marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '10', payoutMultiplier: '9', potentialWin: '90', status: 'active', currency: 'INR', walletType: 'cash', runDate: date, ...extra }).returning()
    return row
  }
  return { ...f, createPlayer: f.player, player, market, bet }
}
test('all four Matka types and every player type are grouped from actual pending/active bets; settled/void/cancelled bets are absent', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx)
    for (const kind of ['worli','starline','jackpot','sattaMatka']) {
      const market = await f.market(kind, { status: 'inactive' })
      for (const type of types) {
        const owner = type.includes('AGENT') ? await f.agent(type === 'AGENT_CREDIT' ? 'CREDIT' : type.startsWith('SHARING') ? 'SHARING' : 'COMMISSION') : undefined
        const player = await f.createPlayer(type, owner)
        await f.bet(market, { userId: player.id, marketSession: kind === 'jackpot' || kind === 'sattaMatka' ? 'close' : 'open', status: type === 'REGULAR' ? 'pending' : 'active' })
      }
      for (const status of ['won','lost','void','cancelled']) await f.bet(market, { status })
    }
    const list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.total, 4); assert.equal(list.openBetCount, 20); assert.equal(list.pendingResultCount, 4)
    for (const row of list.items) { assert.equal(row.betCount, 5); assert.equal(row.playerCount, 5); assert.equal(row.totalStake, 50); assert.equal(row.potentialPayout, 450); assert.equal(row.date, date) }
  })
})
test('explicit trading dates survive midnight, legacy null dates use market timezone, overnight Close times belong to the next day', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market()
    await f.bet(market, { marketSession: 'close', createdAt: new Date('2026-10-23T20:00:00Z') })
    await f.bet(market, { runDate: null, createdAt: new Date('2026-10-23T20:00:00Z') })
    const list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.items[0].date, date); assert.equal(list.items[0].resultAt, '2026-10-23T19:30:00.000Z')
    assert.equal(list.items[0].resultStatus, 'OPEN_RESULT_REQUIRED'); assert.equal(list.items[0].declareSession, 'open')
    assert.equal(list.items[1].date, '2026-10-24')
  })
})
test('server filtering, paging and bet detail retain exact totals and cannot read another tenant', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market(), foreign = await seed(tx), other = await foreign.market()
    for (let i = 0; i < 25; i++) await f.bet(market)
    await f.bet(market, { runDate: '2026-10-22', marketSession: 'close' }); await foreign.bet(other)
    const page = await listRunningMatkaMarkets(f.tenant, { limit: 1, page: 1 }, tx)
    assert.equal(page.total, 2); assert.equal(page.openBetCount, 26); assert.equal(page.items.length, 1); assert.equal(page.items[0].date, '2026-10-22')
    const detail = await listRunningMatkaBets(f.tenant, { matkaId: market.id, date, session: 'open', limit: 20, page: 2 }, tx)
    assert.equal(detail.total, 25); assert.equal(detail.items.length, 5); assert.ok(detail.items.every((bet: any) => bet.userId === String(f.player.id)))
    assert.equal((await listRunningMatkaBets(f.tenant, { matkaId: other.id, date, session: 'open' }, tx)).total, 0)
    assert.equal((await listRunningMatkaMarkets(f.tenant, { search: "' OR 1=1 --" }, tx)).total, 0)
    assert.equal((await listRunningMatkaMarkets(f.tenant, { matkaType: 'starline' }, tx)).total, 0)
    assert.equal((await listRunningMatkaMarkets(f.tenant, { date, session: 'open' }, tx)).openBetCount, 25)
    await assert.rejects(listRunningMatkaMarkets(f.tenant, { date: '2026-02-31' }, tx))
    routeDbToTransaction(mock, db, tx)
    const ctx: any = { tenant: foreign.tenant, directorMode: 'whitelabel', directorWhitelabelId: f.tenant, user: { roles: ['Super Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }] }
    assert.equal((await matkaQueryResolvers.matkaRunningMarkets(null, {}, ctx)).openBetCount, 26)
    mock.restoreAll()
  })
})
test('mixed currency amounts are not added together, and missing legacy sessions are flagged for review', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market()
    await f.bet(market); await f.bet(market, { currency: 'USD' }); await f.bet(market, { bidType: 'UNSUPPORTED', marketSession: null })
    const list = await listRunningMatkaMarkets(f.tenant, {}, tx), mixed = list.items.find((row: any) => row.session === 'open'), unknown = list.items.find((row: any) => row.session === null)
    assert.equal(mixed.totalStake, null); assert.equal(mixed.potentialPayout, null); assert.equal(mixed.currency, null)
    assert.equal(unknown.canDeclare, false); assert.equal(unknown.resultStatus, 'REVIEW_REQUIRED')
    assert.equal((await listRunningMatkaBets(f.tenant, { matkaId: market.id, date }, tx)).total, 1)
  })
})
test('legacy Jodi/Sangam Open labels still wait for Close; missing single session matches Open settlement', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market()
    for (const bidType of ['JODI','jodi bulk','HS','half-sangam','FULL_SANGAM_DIGITS']) await f.bet(market, { bidType, marketSession: 'open' })
    await f.bet(market, { marketSession: null })
    const list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.items.find((row: any) => row.session === 'close').betCount, 5)
    assert.equal(list.items.find((row: any) => row.session === 'open').betCount, 1)
    assert.equal((await listRunningMatkaBets(f.tenant, { matkaId: market.id, date, session: 'close' }, tx)).total, 5)
  })
})
test('declaring Open then Close settles only their own sessions, removes resolved rows and rollback restores the queue', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market(), operator = { tenant: f.tenant, actorId: 'qa' }
    await f.bet(market); await f.bet(market, { marketSession: 'close', betNumbers: '8' })
    await tx.update(t.wallets).set({ cash: '9980' }).where(eq(t.wallets.userId, f.player.id))
    assert.equal((await listRunningMatkaMarkets(f.tenant, {}, tx)).total, 2)
    await declareAndSettleMatka(tx, { matkaId: market.id, date, type: 'open', result: '267' }, operator)
    let list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.total, 1); assert.equal(list.openBetCount, 1); assert.equal(list.items[0].declareSession, 'close'); assert.equal(list.items[0].resultStatus, 'RESULT_PENDING')
    const close = await declareAndSettleMatka(tx, { matkaId: market.id, date, type: 'close', result: '279' }, operator)
    assert.equal((await listRunningMatkaMarkets(f.tenant, {}, tx)).total, 0)
    assert.equal(Number((await tx.select().from(t.wallets).where(eq(t.wallets.userId, f.player.id)))[0].cash), 10160)
    await reverseMatkaResult(tx, { id: close.id, reason: 'Isolated queue regression' }, operator)
    list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.total, 1); assert.equal(list.items[0].betCount, 1); assert.equal(list.items[0].resultValue, null)
  })
})
test('recorded results with unresolved bets are shown as settlement pending and cannot be declared again', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market()
    await f.bet(market); await tx.insert(t.matkaResults).values({ tenant: f.tenant, matkaId: market.id, date, type: 'open', result: '267', declaredBy: 'qa' })
    const list = await listRunningMatkaMarkets(f.tenant, {}, tx)
    assert.equal(list.items[0].resultStatus, 'SETTLEMENT_PENDING'); assert.equal(list.items[0].canDeclare, false); assert.equal(list.pendingResultCount, 0)
  })
})
test('running result management denies agents, core mode without a whitelabel, and callers without read permission', () => {
  const permissions = [{ domain: 'matka.results', actions: ['view'] }]
  assert.throws(() => runningMatkaTenant({ tenant: 'qa', user: { sub: 'qa' }, permissions: [] }), /Forbidden/)
  assert.throws(() => runningMatkaTenant({ tenant: 'qa', permissions, user: { type: 'agent' } }), /administrators/)
  assert.throws(() => runningMatkaTenant({ tenant: 'qa', permissions, directorMode: 'core', user: { roles: ['Super Admin'] } }), /whitelabel/)
})
