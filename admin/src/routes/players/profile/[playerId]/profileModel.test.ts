import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { playerPasswordSchema, playerNoteSchema, playerNoteInput, profileForModal, profilePlayerType, relativeProfileTime, type PlayerProfile } from './profileModel'

describe('Player Profile retained contracts', () => {
  test('notes preserve untrimmed content, nullable category, duplicate tags and explicit pin value', () => {
    assert.equal(playerNoteSchema.safeParse({ content: '', category: '', tags: '', isPinned: false }).success, false)
    const input = playerNoteInput('p1', { content: '  reviewed  ', category: '', tags: ' risk, risk, ,vip ', isPinned: true })
    assert.deepEqual(input, { playerId: 'p1', content: '  reviewed  ', category: null, tags: ['risk', 'risk', 'vip'], isPinned: true })
  })
  test('password change requires all three private fields, length 8 (the server minimum) and confirmation equality', () => {
    assert.equal(playerPasswordSchema.safeParse({ newPassword: '', confirmPassword: '', adminPassword: '' }).success, false)
    assert.equal(playerPasswordSchema.safeParse({ newPassword: 'short', confirmPassword: 'short', adminPassword: 'operator' }).success, false)
    assert.equal(playerPasswordSchema.safeParse({ newPassword: 'seven77', confirmPassword: 'seven77', adminPassword: 'operator' }).success, false)
    assert.equal(playerPasswordSchema.safeParse({ newPassword: 'new-pass', confirmPassword: 'other-pass', adminPassword: 'operator' }).success, false)
    assert.equal(playerPasswordSchema.safeParse({ newPassword: 'new-pass', confirmPassword: 'new-pass', adminPassword: 'operator' }).success, true)
  })
  test('all existing player-type labels and relative time units remain unchanged', () => {
    assert.equal(profilePlayerType('REGULAR'), 'Normal'); assert.equal(profilePlayerType('AGENT_CREDIT'), 'Credit')
    assert.equal(profilePlayerType('WHITELABEL_CREDIT'), 'Whitelabel Credit'); assert.equal(profilePlayerType('SHARING_AGENT_PLAYER'), 'Sharing Player'); assert.equal(profilePlayerType('COMMISSION_AGENT_PLAYER'), 'Commission Player')
    const now = Date.parse('2026-10-09T12:00:00Z')
    assert.equal(relativeProfileTime(undefined, now), 'Never'); assert.equal(relativeProfileTime('2026-10-09T12:00:00Z', now), 'Just now')
    assert.equal(relativeProfileTime('2026-10-09T11:45:00Z', now), '15m ago'); assert.equal(relativeProfileTime('2026-10-09T10:00:00Z', now), '2h ago')
    assert.equal(relativeProfileTime('2026-10-08T12:00:00Z', now), '1d ago')
  })
  test('shared finance modal receives unchanged local-currency amounts and explicit wallet metadata', () => {
    // The balance modal is for cash players; the retired credit-limit figures are not carried any more.
    const profile: PlayerProfile = { id: 'p1', name: 'Preview player', phone: '9000000000', status: 'ACTIVE', bonusAllowed: false, playerType: 'REGULAR', creditLimit: 500, creditUsed: 25, creditAvailable: 475, wallet: { userId: 'p1', currency: 'INR', balance: 123.45, bonus: 5, exposure: 25, updatedAt: '2026-10-09T00:00:00Z' } }
    assert.deepEqual(profileForModal(profile), { id: 'p1', name: 'Preview player', email: undefined, phone: '9000000000', username: undefined, status: 'ACTIVE', bonusAllowed: false, playerType: 'REGULAR', wallet: profile.wallet })
  })
})
