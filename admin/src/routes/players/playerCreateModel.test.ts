import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { adminPlayerInput, agentPlayerInput, givesOpeningChips, playerCreateSchema, playerCreateValues, phoneAvailabilityValue } from './playerCreateModel'
describe('player create contracts', () => {
  test('admin phone/dial normalization and the required password match the existing input', () => {
    const value = { ...playerCreateValues('default'), name: 'Alice', phone: '9876543210', currency: 'USD', password: ' fake-pass-1 ' }
    assert.equal(playerCreateSchema(false).safeParse(value).success, true)
    const input = adminPlayerInput(value, 'INR')
    assert.equal(input.phone, '+919876543210'); assert.equal(input.password, 'fake-pass-1'); assert.equal(input.initialBalance, 0)
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
    assert.equal(playerCreateSchema(false).safeParse({ ...value, name: 'Alice', phone: '9876543210', password: 'fake-pass-1', creditLimit: -5 }).success, false)
  })
  test('agent schemes retain direct ownership, raw phone and their separate currency rules', () => {
    const value = { ...playerCreateValues(null, 'CREDIT'), name: 'Alice', username: 'Player_A', password: 'fake-pass', phone: '9876543210' }
    assert.equal(playerCreateSchema(true).safeParse(value).success, true)
    const credit = agentPlayerInput(value, { id: 'a', schemeType: 'CREDIT' }, 'USD')
    assert.equal(credit.agentId, 'a'); assert.equal(credit.phone, '9876543210'); assert.equal(credit.currency, 'USD'); assert.equal(credit.bonusAllowed, false)
    assert.equal(credit.dailyStakeLimit, undefined)
    assert.equal(agentPlayerInput(value, { id: 'a', schemeType: 'COMMISSION' }, 'USD').currency, 'INR')
  })
  test('credit players carry a credit reference and opening chips; opening chips are sent only above 0', () => {
    const admin = { ...playerCreateValues(), name: 'Alice', phone: '9876543210', playerType: 'WHITELABEL_CREDIT', creditLimit: 1000, openingChips: 400 }
    const input = adminPlayerInput(admin, 'INR')
    assert.equal(input.creditLimit, 1000); assert.equal(input.openingChips, 400)
    assert.equal('openingChips' in adminPlayerInput({ ...admin, openingChips: 0 }, 'INR'), false)
    assert.equal('openingChips' in adminPlayerInput({ ...admin, playerType: 'REGULAR' }, 'INR'), false)
    // An agent credit player under its chosen CREDIT agent gets both, its chips from that agent (owner decision 2026-11-04).
    const agentCredit = adminPlayerInput({ ...admin, playerType: 'AGENT_CREDIT', agentId: 'credit-1' }, 'INR')
    assert.equal(agentCredit.agentId, 'credit-1'); assert.equal(agentCredit.creditLimit, 1000); assert.equal(agentCredit.openingChips, 400)
    // A sharing or commission agent's player is no credit player: neither is sent.
    const sharing = adminPlayerInput({ ...admin, playerType: 'SHARING_AGENT_PLAYER', agentId: 'sharing-1' }, 'INR')
    assert.equal(sharing.creditLimit, undefined); assert.equal('openingChips' in sharing, false)
    // A CREDIT agent gives them to its own player; a sub-agent's player starts at zero.
    const agentValue = { ...playerCreateValues(null, 'CREDIT'), name: 'Alice', username: 'Player_A', password: 'fake-pass', phone: '9876543210', creditLimit: 2000, openingChips: 500 }
    const own = agentPlayerInput(agentValue, { id: 'a', schemeType: 'CREDIT' }, 'INR')
    assert.equal(own.creditLimit, 2000); assert.equal(own.openingChips, 500)
    const forSub = agentPlayerInput({ ...agentValue, targetAgentId: 'sub-1' }, { id: 'a', schemeType: 'CREDIT' }, 'INR')
    assert.equal(forSub.agentId, 'sub-1'); assert.equal(forSub.creditLimit, 0); assert.equal('openingChips' in forSub, false)
    assert.equal('openingChips' in agentPlayerInput(agentValue, { id: 'a', schemeType: 'SHARING' }, 'INR'), false)
  })
  test('opening chips cannot exceed the parent\'s free chips when they are known', () => {
    const value = { ...playerCreateValues(), name: 'Alice', phone: '9876543210', password: 'fake-pass-1', playerType: 'WHITELABEL_CREDIT', openingChips: 600, _chipsFree: null as number | null }
    assert.equal(playerCreateSchema(false).safeParse(value).success, true)
    value._chipsFree = 500
    const refused = playerCreateSchema(false).safeParse(value)
    assert.equal(refused.success, false)
    assert.equal(refused.error?.issues.find((issue) => issue.path[0] === 'openingChips')?.message, 'Not enough chips: 500.00 free')
    assert.equal(playerCreateSchema(false).safeParse({ ...value, openingChips: 500 }).success, true)
    assert.equal(playerCreateSchema(false).safeParse({ ...value, openingChips: -1 }).success, false)
    // An agent's player for a sub-agent gets no opening chips, so the check does not apply.
    const agentValue = { ...playerCreateValues(null, 'CREDIT'), name: 'Alice', username: 'Player_A', password: 'fake-pass', phone: '9876543210', openingChips: 600, _chipsFree: 500 }
    assert.equal(playerCreateSchema(true).safeParse(agentValue).success, false)
    assert.equal(playerCreateSchema(true).safeParse({ ...agentValue, targetAgentId: 'sub-1' }).success, true)
    // An agent credit player an admin creates: limited by its chosen agent's free chips (owner decision 2026-11-04).
    const agentCredit = { ...value, playerType: 'AGENT_CREDIT', agentId: 'credit-1' }
    assert.equal(playerCreateSchema(false).safeParse({ ...agentCredit, openingChips: 600 }).error?.issues.find((issue) => issue.path[0] === 'openingChips')?.message, 'Not enough chips: 500.00 free')
    assert.equal(playerCreateSchema(false).safeParse({ ...agentCredit, openingChips: 500 }).success, true)
    assert.equal(playerCreateSchema(false).safeParse({ ...agentCredit, openingChips: 600, _chipsFree: null }).success, true, 'unknown: the server checks it')
  })
  test('opening chips come only from the direct parent: the pool or the chosen CREDIT agent for an admin, an agent for its own player', () => {
    const admin = playerCreateValues()
    assert.equal(givesOpeningChips({ ...admin, playerType: 'WHITELABEL_CREDIT' }, false), true)
    // An agent credit player's fields wait for its agent: that agent's chips fund them.
    assert.equal(givesOpeningChips({ ...admin, playerType: 'AGENT_CREDIT' }, false), false)
    assert.equal(givesOpeningChips({ ...admin, playerType: 'AGENT_CREDIT', agentId: 'credit-1' }, false), true)
    assert.equal(givesOpeningChips({ ...admin, playerType: 'SHARING_AGENT_PLAYER', agentId: 'sharing-1' }, false), false)
    assert.equal(givesOpeningChips({ ...admin, playerType: 'COMMISSION_AGENT_PLAYER', agentId: 'commission-1' }, false), false)
    assert.equal(givesOpeningChips({ ...admin, playerType: 'REGULAR' }, false), false)
    const agent = playerCreateValues(null, 'CREDIT')
    assert.equal(givesOpeningChips(agent, true), true)
    assert.equal(givesOpeningChips({ ...agent, targetAgentId: 'sub-1' }, true), false)
    assert.equal(givesOpeningChips(playerCreateValues(null, 'SHARING'), true), false)
  })
  test('phone/password requirements and unavailable phone remain enforced', () => {
    const value = { ...playerCreateValues(), name: 'Alice', phone: '9876543210', password: 'short' }
    assert.equal(playerCreateSchema(false).safeParse(value).success, false)
    value.password = ''; value._phoneError = 'Already registered'
    assert.equal(playerCreateSchema(false).safeParse(value).success, false)
    assert.equal(playerCreateSchema(true).safeParse({ ...value, _phoneError: '', username: 'a', password: '123456' }).success, false)
    // One rule in both forms, the server's: a password is required and has at least 8 characters, spaces not counted.
    const message = (agentMode: boolean, password: string) => playerCreateSchema(agentMode).safeParse({ ...value, _phoneError: '', username: 'Player_A', password }).error?.issues.find((issue) => issue.path[0] === 'password')?.message
    assert.equal(message(false, ''), 'Password is required'); assert.equal(message(false, '   '), 'Password is required')
    assert.equal(message(false, 'seven77'), 'Password must be at least 8 characters'); assert.equal(message(true, '123456'), 'Password must be at least 8 characters')
    assert.equal(message(false, 'fake-pass-1'), undefined); assert.equal(message(true, 'fake-pass-1'), undefined)
  })
})
