import test from 'node:test'
import assert from 'node:assert/strict'
import { decideCasinoGameAccess, CasinoGameAccessError, CASINO_GAME_ACCESS_MESSAGES, type CasinoGameAccessInput } from './casinoGameAccess.js'

// The four per-game rules a whitelabel admin sets on Casino Management. Before this the player
// side read only the stake limits, so every one of these admitted the player.

const open: CasinoGameAccessInput = { settings: null, dailyNetWin: 0, premiumOnly: false, vipTierIds: [], vip: null }
const reason = (input: Partial<CasinoGameAccessInput>) => decideCasinoGameAccess({ ...open, ...input })?.reason ?? null

test('a game with no rules admits everyone', () => {
  assert.equal(reason({}), null)
  assert.equal(reason({ settings: { betEnabled: true, maxWin: null } }), null)
})

test('"Betting enabled" switched off refuses the player, with a message they can read', () => {
  const refusal = decideCasinoGameAccess({ ...open, settings: { betEnabled: false, maxWin: null } })
  assert.deepEqual(refusal, { reason: 'bet_disabled', message: CASINO_GAME_ACCESS_MESSAGES.bet_disabled })
})

test('Max Win (daily) refuses once the day\'s net result reaches the cap, and not before', () => {
  const settings = { betEnabled: true, maxWin: 500 }
  assert.equal(reason({ settings, dailyNetWin: 499.99 }), null)
  assert.equal(reason({ settings, dailyNetWin: 500 }), 'max_win_reached')
  assert.equal(reason({ settings, dailyNetWin: 1200 }), 'max_win_reached')
  // A losing day never counts towards the cap.
  assert.equal(reason({ settings, dailyNetWin: -3000 }), null)
  // Without a cap the day's result is irrelevant.
  assert.equal(reason({ settings: { betEnabled: true, maxWin: null }, dailyNetWin: 1e9 }), null)
})

test('a premium game admits active VIP members only', () => {
  assert.equal(reason({ premiumOnly: true, vip: null }), 'premium_only')
  assert.equal(reason({ premiumOnly: true, vip: { member: false, tierId: 'gold' } }), 'premium_only')
  assert.equal(reason({ premiumOnly: true, vip: { member: true, tierId: 'gold' } }), null)
})

test('a tier-restricted game admits the selected tiers only', () => {
  const vipTierIds = ['gold', 'platinum']
  assert.equal(reason({ vipTierIds, vip: { member: true, tierId: 'gold' } }), null)
  assert.equal(reason({ vipTierIds, vip: { member: true, tierId: 'bronze' } }), 'vip_tier')
  assert.equal(reason({ vipTierIds, vip: { member: false, tierId: null } }), 'vip_tier', 'no tier at all')
  assert.equal(reason({ vipTierIds, vip: null }), 'vip_tier')
})

test('betting switched off wins over every other rule', () => {
  assert.equal(reason({
    settings: { betEnabled: false, maxWin: 10 },
    dailyNetWin: 50,
    premiumOnly: true,
    vipTierIds: ['gold'],
    vip: null,
  }), 'bet_disabled')
})

test('a refused launch is a typed refusal, so it can be told apart from a provider failure', () => {
  const error = new CasinoGameAccessError('vip_tier', CASINO_GAME_ACCESS_MESSAGES.vip_tier)
  assert.ok(error instanceof Error)
  assert.equal(error.code, 'CASINO_GAME_ACCESS')
  assert.equal(error.reason, 'vip_tier')
  assert.equal(error.message, 'This game is not available for your VIP tier')
})
