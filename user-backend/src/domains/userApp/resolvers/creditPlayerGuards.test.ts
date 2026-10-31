/**
 * Credit-player guards on player resolvers (plan W5, D1 and D7).
 *
 *  - myReferralLink / claimReferralBonus / transferReferralBalanceToCash refuse credit
 *    players: they cannot withdraw, so referral cash minted for them could never leave.
 *  - recalculateExposure is read-only for credit players: it must never rewrite
 *    credit_used (it used to erase the casino credit locks).
 *
 * No database: db.execute answers the player-type lookup; every other db entry point
 * throws, so reaching the repo layer fails the test.
 */
import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'
import { db } from '../../../db/client.js'
import { userAppMutationResolvers } from './mutations.js'
import { userAppQueryResolvers } from './queries.js'
import { userMutationResolvers } from '../../user/resolvers/mutations.js'
import { CREDIT_PLAYER_REFERRAL_MESSAGE, isCreditPlayerUser } from '../services/playerCreditState.js'

const ctx = { auth: { userId: 4242, tenant: 'w5test', requestTenant: 'w5test' } } as any

function stubPlayer(playerType: string, creditUsed = '0') {
  const statements: string[] = []
  mock.method(db as any, 'execute', async (q: any) => {
    statements.push(JSON.stringify(q?.queryChunks ?? q))
    return { rows: [{ player_type: playerType, credit_used: creditUsed }] }
  })
  for (const name of ['select', 'insert', 'update', 'delete', 'transaction']) {
    mock.method(db as any, name, () => {
      throw new Error(`db.${name} must not be reached`)
    })
  }
  return statements
}

afterEach(() => mock.restoreAll())

for (const playerType of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) {
  test(`myReferralLink refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userAppQueryResolvers.myReferralLink(null, null, ctx)
    assert.equal(res.meta.code, 403)
    assert.equal(res.meta.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
    assert.equal(res.data, null)
  })

  test(`claimReferralBonus refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userAppMutationResolvers.claimReferralBonus(null, { amount: 100 }, ctx)
    assert.equal(res.meta.code, 403)
    assert.equal(res.meta.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
    assert.equal(res.data, null)
  })

  test(`transferReferralBalanceToCash refuses ${playerType}`, async () => {
    stubPlayer(playerType)
    const res = await userMutationResolvers.transferReferralBalanceToCash(null, { amount: 100 }, ctx)
    assert.equal(res.success, false)
    assert.equal(res.message, CREDIT_PLAYER_REFERRAL_MESSAGE)
  })

  test(`recalculateExposure is a read-only no-op for ${playerType}`, async () => {
    const statements = stubPlayer(playerType, '750.00')
    const res = await userAppMutationResolvers.recalculateExposure(null, null, ctx)
    assert.equal(res.success, true)
    assert.equal(res.exposure, 750, 'reports the stored credit_used')
    assert.equal(statements.length, 1, 'only the player-type read ran')
    assert.doesNotMatch(statements[0], /update/i)
  })
}

test('isCreditPlayerUser: cash and agent-cash players are not credit players', async () => {
  for (const playerType of ['REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER']) {
    stubPlayer(playerType)
    assert.equal(await isCreditPlayerUser(4242, 'w5test'), false, playerType)
    mock.restoreAll()
  }
  stubPlayer('AGENT_CREDIT')
  assert.equal(await isCreditPlayerUser(4242, 'w5test'), true)
})
