/**
 * mapUserProfile (the player's UserProfile): a credit player's credit figures come from the
 * wallet (CREDIT scheme on Deposit/Withdraw chips).
 *
 * Credit players hold their chips in wallets.cash, so balance and exposure are the wallet's,
 * creditLimit is the credit reference their upline set, creditAvailable is their free chips
 * (cash - exposure, never below 0) and creditUsed is the held exposure. The retired
 * users.credit_used / credit_available values are ignored for them. Other player types keep
 * the stored users figures.
 *
 * No database: mapUserProfile maps a users row and its wallet row.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mapUserProfile } from './userRepo.js'

const user = (playerType: string, extra: Record<string, unknown> = {}) =>
  ({ id: 7, username: 'p7', name: 'P7', phone: '1', playerType, creditLimit: '5000', creditUsed: '0', creditAvailable: '0', ...extra }) as any
const wallet = (cash: string, exposure: string) =>
  ({ cash, exposure, bonus: '0', referralBalance: '0', referralBonus: '0' }) as any

for (const playerType of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) {
  test(`${playerType}: figures come from the wallet; creditLimit is the credit reference`, () => {
    const p = mapUserProfile(user(playerType, { creditUsed: '999', creditAvailable: '123' }), wallet('8000.50', '1200.25'))
    assert.equal(p.playerType, playerType)
    assert.equal(p.balance, 8000.5)
    assert.equal(p.exposure, 1200.25)
    assert.equal(p.creditLimit, 5000, 'the credit reference')
    assert.equal(p.creditAvailable, 6800.25, 'free chips, not the retired users.credit_available')
    assert.equal(p.creditUsed, 1200.25, 'the held exposure, not the retired users.credit_used')
  })
}

test('credit player: available never goes below 0, and a missing wallet reads as 0', () => {
  assert.equal(mapUserProfile(user('AGENT_CREDIT'), wallet('100', '150')).creditAvailable, 0)
  const p = mapUserProfile(user('WHITELABEL_CREDIT'), null)
  assert.deepEqual([p.balance, p.exposure, p.creditAvailable, p.creditUsed, p.creditLimit], [0, 0, 0, 0, 5000])
})

test('other player types keep the stored users figures', () => {
  for (const playerType of ['REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER']) {
    const p = mapUserProfile(user(playerType, { creditUsed: '10', creditAvailable: '20', creditLimit: '30' }), wallet('500', '100'))
    assert.deepEqual([p.creditUsed, p.creditAvailable, p.creditLimit, p.balance, p.exposure], [10, 20, 30, 500, 100], playerType)
  }
})
