import test from 'node:test'
import assert from 'node:assert/strict'
import { casinoWalletTypeFor, isCasinoCreditPlayer } from './casinoCreditPlayer.js'

// Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold Deposit/Withdraw chips in wallets.cash,
// so every casino stake, payout and refund of theirs moves cash, whatever wallet is named.

test('casinoWalletTypeFor: a credit player always uses cash', () => {
  for (const requested of ['cash', 'bonus', 'referralBonus', 'referral_bonus', 'balance', null, undefined]) {
    assert.equal(casinoWalletTypeFor(true, requested), 'cash', String(requested))
  }
})

test('casinoWalletTypeFor: other players keep the wallet they asked for', () => {
  assert.equal(casinoWalletTypeFor(false, 'bonus'), 'bonus')
  assert.equal(casinoWalletTypeFor(false, 'referralBonus'), 'referralBonus')
  assert.equal(casinoWalletTypeFor(false, 'cash'), 'cash')
  // Anything else has always meant cash (a legacy snake_case value included).
  assert.equal(casinoWalletTypeFor(false, 'referral_bonus'), 'cash')
  assert.equal(casinoWalletTypeFor(false, null), 'cash')
  assert.equal(casinoWalletTypeFor(false, undefined), 'cash')
})

// select().from().where().limit() resolving to the given rows.
const executorReturning = (rows: Array<{ playerType: string | null }>) =>
  ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) }) as any

test('isCasinoCreditPlayer: true only for the two credit player types', async () => {
  assert.equal(await isCasinoCreditPlayer(executorReturning([{ playerType: 'AGENT_CREDIT' }]), 1, 't'), true)
  assert.equal(await isCasinoCreditPlayer(executorReturning([{ playerType: 'WHITELABEL_CREDIT' }]), 1, 't'), true)
  for (const playerType of ['REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER', null]) {
    assert.equal(await isCasinoCreditPlayer(executorReturning([{ playerType }]), 1, 't'), false, String(playerType))
  }
  assert.equal(await isCasinoCreditPlayer(executorReturning([]), 1, 't'), false, 'unknown player')
})
