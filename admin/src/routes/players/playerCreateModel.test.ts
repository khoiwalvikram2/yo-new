import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { adminPlayerInput, agentPlayerInput, playerCreateSchema, playerCreateValues, phoneAvailabilityValue } from './playerCreateModel'
describe('player create contracts', () => {
  test('admin phone/dial normalization and optional password match the existing input', () => {
    const value = { ...playerCreateValues('default'), name: 'Alice', phone: '9876543210', currency: 'USD' }
    assert.equal(playerCreateSchema(false).safeParse(value).success, true)
    const input = adminPlayerInput(value, 'INR')
    assert.equal(input.phone, '+919876543210'); assert.equal('password' in input, false); assert.equal(input.initialBalance, 0)
    assert.equal(input.matkaVisible, false); assert.equal(input.dailyStakeLimit, null)
    assert.equal(phoneAvailabilityValue('9876543210', '91'), '+919876543210')
    assert.equal(phoneAvailabilityValue('919876543210', '91'), '919876543210')
  })
  test('admin credit players force base currency, zero credit and no bonus', () => {
    const value = { ...playerCreateValues(), playerType: 'AGENT_CREDIT', agentId: 'credit-1', currency: 'USD', bonusAllowed: true }
    const input = adminPlayerInput(value, 'INR')
    assert.equal(input.agentId, 'credit-1'); assert.equal(input.creditLimit, 0); assert.equal(input.currency, 'INR'); assert.equal(input.bonusAllowed, false)
    // A credit limit entered by the admin is sent; a regular player never carries one.
    assert.equal(adminPlayerInput({ ...value, creditLimit: 750 }, 'INR').creditLimit, 750)
    assert.equal(adminPlayerInput({ ...value, playerType: 'WHITELABEL_CREDIT', agentId: '', creditLimit: 300 }, 'INR').creditLimit, 300)
    assert.equal(adminPlayerInput({ ...value, playerType: 'REGULAR', creditLimit: 750 }, 'INR').creditLimit, undefined)
    assert.equal(playerCreateSchema(false).safeParse({ ...value, name: 'Alice', phone: '9876543210', creditLimit: -5 }).success, false)
  })
  test('agent schemes retain direct ownership, raw phone and their separate currency rules', () => {
    const value = { ...playerCreateValues(null, 'CREDIT'), name: 'Alice', username: 'Player_A', password: 'fake-pass', phone: '9876543210' }
    assert.equal(playerCreateSchema(true).safeParse(value).success, true)
    const credit = agentPlayerInput(value, { id: 'a', schemeType: 'CREDIT' }, 'USD')
    assert.equal(credit.agentId, 'a'); assert.equal(credit.phone, '9876543210'); assert.equal(credit.currency, 'USD'); assert.equal(credit.bonusAllowed, false)
    assert.equal(credit.dailyStakeLimit, undefined)
    assert.equal(agentPlayerInput(value, { id: 'a', schemeType: 'COMMISSION' }, 'USD').currency, 'INR')
  })
  test('phone/password requirements and unavailable phone remain enforced', () => {
    const value = { ...playerCreateValues(), name: 'Alice', phone: '9876543210', password: 'short' }
    assert.equal(playerCreateSchema(false).safeParse(value).success, false)
    value.password = ''; value._phoneError = 'Already registered'
    assert.equal(playerCreateSchema(false).safeParse(value).success, false)
    assert.equal(playerCreateSchema(true).safeParse({ ...value, _phoneError: '', username: 'a', password: '123456' }).success, false)
  })
})
