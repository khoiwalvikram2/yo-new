/**
 * A bonus card activated or switched to from the player app follows the admin's rule (players/PLA-07).
 *
 * Credit players get no bonus money: their chips move only through Deposit / Withdraw. A player whose bonus
 * eligibility is off gets none either. The admin's grant, activate and switch already refuse both, but a card issued
 * before that (or before the player's eligibility was switched off) could still be activated, or switched to, from
 * the player app, which goes through the shared activateBonusAwardCore / switchBonusAwardCore. Both refuse now, with
 * nothing credited and the cards left as they were; an eligible player still activates as before.
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction
 * that is always rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/bonusActivationEligibility.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { activateBonusAward, switchBonusAward } = await import('./userAppRepo.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

const CREDIT = 'Credit players cannot receive bonuses: their chips move only through Deposit / Withdraw'
const INELIGIBLE = "This player's bonus eligibility is off"

async function card(tx: any, tenant: string, userId: number, status: 'pending' | 'active' = 'pending') {
  const [campaign] = await tx.insert(t.bonusCampaigns).values({ tenant, name: 'vfyho bonus card', domain: 'casino', type: 'direct_amount', status: 'active', currency: 'INR', distributionType: 'roll_over', rulesJson: {} }).returning()
  const [award] = await tx.insert(t.bonusAwards).values({ userId, campaignId: campaign.id, domain: 'casino', type: 'direct_amount', status, amount: '500', wageringReq: '5000', currentWagering: '0', distributionType: 'roll_over' }).returning()
  return award
}
const bonusBalance = async (tx: any, userId: number) => Number((await tx.select().from(t.wallets).where(eq(t.wallets.userId, userId)))[0].bonus)
const statusOf = async (tx: any, id: number) => (await tx.select().from(t.bonusAwards).where(eq(t.bonusAwards.id, id)))[0].status

async function refusedPlayers(tx: any, f: any) {
  const agentCredit = await f.player('AGENT_CREDIT', await f.agent('CREDIT'))
  const whitelabelCredit = await f.player('WHITELABEL_CREDIT')
  const ineligible = await f.player('REGULAR')
  await f.flags(ineligible.id, { bonusAllowed: false })
  return [['AGENT_CREDIT', agentCredit, CREDIT], ['WHITELABEL_CREDIT', whitelabelCredit, CREDIT], ['bonus eligibility off', ineligible, INELIGIBLE]] as const
}

test('the player app cannot activate a card for a credit player or a player whose bonus eligibility is off', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const players = await refusedPlayers(tx, f)
    const cards = new Map<number, any>()
    for (const [, player] of players) cards.set(player.id, await card(tx, f.tenant, player.id))
    routeDbToTransaction(mock, db, tx)
    for (const [label, player, message] of players) {
      await assert.rejects(activateBonusAward(cards.get(player.id).id, player.id, f.tenant), { message }, label)
      assert.equal(await statusOf(tx, cards.get(player.id).id), 'pending', `${label}: the card stays pending`)
      assert.equal(await bonusBalance(tx, player.id), 0, `${label}: no bonus money`)
    }
    mock.restoreAll()
  })
})

test('the player app cannot switch to another card for those players either; the active card stays as it was', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const players = await refusedPlayers(tx, f)
    const cards = new Map<number, { active: any; next: any }>()
    for (const [, player] of players) {
      cards.set(player.id, { active: await card(tx, f.tenant, player.id, 'active'), next: await card(tx, f.tenant, player.id) })
      await tx.update(t.wallets).set({ bonus: '500' }).where(eq(t.wallets.userId, player.id))
    }
    routeDbToTransaction(mock, db, tx)
    for (const [label, player, message] of players) {
      const { active, next } = cards.get(player.id)!
      await assert.rejects(switchBonusAward(next.id, player.id, f.tenant), { message }, label)
      assert.deepEqual([await statusOf(tx, active.id), await statusOf(tx, next.id)], ['active', 'pending'], `${label}: neither card moved`)
      assert.equal(await bonusBalance(tx, player.id), 500, `${label}: the bonus wallet is untouched`)
    }
    mock.restoreAll()
  })
})

test('an eligible player still activates a card into the bonus wallet', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    const player = await f.player('REGULAR')
    const award = await card(tx, f.tenant, player.id)
    routeDbToTransaction(mock, db, tx)
    await activateBonusAward(award.id, player.id, f.tenant)
    assert.equal(await statusOf(tx, award.id), 'active')
    assert.equal(await bonusBalance(tx, player.id), 500)
    mock.restoreAll()
  })
})
