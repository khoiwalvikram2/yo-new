/**
 * applySportsSingleBetSettlement on D/W chips: a credit player (AGENT_CREDIT /
 * WHITELABEL_CREDIT) settles into wallets.cash exactly like a cash player (cash + profit on a
 * win, cash − loss on a loss, nothing on a void). What stays different is the exclusions: no
 * instant-OTP bonus lookup, no referral hook and no bonus-wagering hook. Nothing touches the
 * users credit columns, agent_player_credits, the agent or the whitelabel.
 *
 * No database: a drizzle pg-proxy answers every statement from a scripted router and records it.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { applySportsSingleBetSettlement, type SportsSingleBetSettlementRow } from './sportsSingleBetSettlementApply.js'

type Stmt = { flat: string; params: unknown[] }

function fakeTx(playerType: string) {
  const log: Stmt[] = []
  const tx = drizzle(async (sqlText: string, params: unknown[], method: string) => {
    const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
    log.push({ flat, params })
    let rows: unknown[][] = []
    // select() of the whole row: the first column is the wallet id, the only one apply needs.
    if (method === 'all' && flat.includes('from "wallets"')) rows = [[7]]
    if (method === 'all' && flat.includes('from "users"')) rows = [[playerType]]
    return { rows }
  })
  return { tx, log }
}

const bet = (side: 'back' | 'lay' = 'back'): SportsSingleBetSettlementRow => ({
  id: '00000000-0000-0000-0000-00000000b001',
  userId: 77,
  stake: '100',
  liability: side === 'back' ? '100' : '200',
  price: '3',
  oddsSize: null,
  side,
  currency: 'INR',
  status: 'matched',
})

async function apply(playerType: string, outcome: 'won' | 'lost' | 'void', preload: boolean, side: 'back' | 'lay' = 'back') {
  const { tx, log } = fakeTx(playerType)
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
  const res = await applySportsSingleBetSettlement(
    tx,
    {
      bet: bet(side),
      outcome,
      marketType: 'exchange',
      tenant: 'dwtest',
      marketId: 'm1',
      eventId: 'e1',
      resultId: 'r1',
      fallbackCurrency: 'INR',
      ...(preload ? { preload: { wallet: { id: 7, cash: '1000', currency: 'INR' }, isCreditPlayer } } : {}),
    },
    async (_tx, betId) => ({ id: betId, userId: 77 }),
    (amount) => amount,
    () => 'INR'
  )
  assert.equal(res.ok, true)
  return { res: res as Extract<typeof res, { ok: true }>, log }
}

const walletWrites = (log: Stmt[]) => log.filter((s) => s.flat.startsWith('update "wallets"'))
const creditModel = (log: Stmt[]) =>
  log.filter((s) => /credit_used|credit_available|settlement_balance|agent_player_credits|agent_credit_ledger|\bagents\b|whitelabels/.test(s.flat))

for (const playerType of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) {
  for (const preload of [true, false]) {
    const how = preload ? 'preloaded' : 'looked up'
    test(`${playerType} (${how}): a win adds the profit to wallets.cash; no bonus lookup, no referral or bonus hook`, async () => {
      const { res, log } = await apply(playerType, 'won', preload)
      assert.equal(res.isCreditPlayer, true)
      const w = walletWrites(log)
      assert.equal(w.length, 1)
      assert.match(w[0].flat, /set "cash" = "wallets"\."cash" \+ \$1/)
      assert.equal(Number(w[0].params[0]), 200, 'back 100 at 3.0 wins 200')
      assert.equal(res.userMarketPnlDelta, 200)
      assert.equal(log.filter((s) => s.flat.includes('bonus_awards')).length, 0, 'credit players hold no bonus')
      assert.equal(res.postReferral, undefined)
      assert.equal(res.postBonus, undefined)
      assert.deepEqual(creditModel(log).map((s) => s.flat), [])
    })

    test(`${playerType} (${how}): a loss takes the liability off wallets.cash; no hooks`, async () => {
      const { res, log } = await apply(playerType, 'lost', preload, 'lay')
      const w = walletWrites(log)
      assert.equal(w.length, 1)
      assert.match(w[0].flat, /set "cash" = "wallets"\."cash" - \$1/)
      assert.equal(Number(w[0].params[0]), 200, 'lay 100 at 3.0 loses its 200 liability')
      assert.equal(res.userMarketPnlDelta, -200)
      assert.equal(res.postReferral, undefined)
      assert.equal(res.postBonus, undefined)
      assert.deepEqual(creditModel(log).map((s) => s.flat), [])
    })
  }

  test(`${playerType}: a void moves no cash and queues no hook`, async () => {
    const { res, log } = await apply(playerType, 'void', true)
    assert.equal(walletWrites(log).length, 0)
    assert.equal(res.settlementCounts.voids, 1)
    assert.equal(res.postReferral, undefined)
    assert.equal(res.postBonus, undefined)
  })
}

test('REGULAR keeps the bonus lookup and both hooks', async () => {
  const { res, log } = await apply('REGULAR', 'won', true)
  assert.equal(res.isCreditPlayer, false)
  assert.equal(log.filter((s) => s.flat.includes('bonus_awards')).length, 1)
  assert.equal(walletWrites(log).length, 1)
  assert.deepEqual(res.postReferral, { tenant: 'dwtest', userId: 77, netRevenue: 200, currency: 'INR', betId: bet().id })
  assert.deepEqual(res.postBonus, { userId: 77, tenant: 'dwtest', betAmount: 100 })
})
