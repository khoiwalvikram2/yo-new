import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { agentEditorValues, agentEditorSchema, agentRateInputs, createAgentInput, eligibleParentAgents, updateAgentInput, type AgentEditorValues } from './agentEditorModel'
describe('agent editor contracts', () => {
  const valid = (): AgentEditorValues => ({ ...agentEditorValues(), username: 'agent_one', password: 'fake-pass-1', allowedDomains: ['sports'], commissionRates: { sports: 10 } })
  test('every existing agent scheme may disable all domains; creation still requires a domain', () => {
    for (const schemeType of ['CREDIT', 'SHARING', 'COMMISSION'] as const) {
      const values = { ...valid(), schemeType, levelIndex: 1, allowedDomains: [] }
      assert.equal(agentEditorSchema(true).safeParse(values).success, true)
      assert.equal(agentEditorSchema(false).safeParse(values).success, false)
      assert.deepEqual(updateAgentInput('agent', values).allowedDomains, [])
    }
  })
  test('create retains normalization, creator parent enforcement and depth suggestion', () => {
    const values = valid(); values.username = ' agent_one '; values.parentAgentId = 'other'; values.levelIndex = 1
    const input = createAgentInput(values, { id: 'creator', schemeType: 'COMMISSION', levelIndex: 2 })
    assert.equal(input.parentAgentId, 'creator'); assert.equal(input.levelIndex, 3); assert.equal(input.username, 'agent_one')
    assert.equal(createAgentInput(values).parentAgentId, 'other')
  })
  test('update does not introduce password/phone/username changes', () => {
    const input = updateAgentInput('edit', valid())
    assert.equal(input.id, 'edit'); assert.equal('password' in input, false); assert.equal('phone' in input, false); assert.equal('username' in input, false)
  })
  test('rates keep percentage conversion and send 0 (commission and sharing); blank and disallowed domains are not sent', () => {
    const values = valid(); values.allowedDomains = ['sports', 'casino', 'matka']; values.commissionRates = { sports: 10, casino: 0, matka: null, extra: 5 }
    assert.deepEqual(agentRateInputs('a', values, 'now'), [
      { agentId: 'a', domain: 'sports', commissionRate: 0.1, effectiveFrom: 'now' }, { agentId: 'a', domain: 'casino', commissionRate: 0, effectiveFrom: 'now' },
    ])
    values.allowedDomains = ['sports']
    values.schemeType = 'SHARING'; values.sharingRates = { sports: 0 }
    assert.deepEqual(agentRateInputs('a', values, 'now'), [{ agentId: 'a', domain: 'sports', shareRate: 0, effectiveFrom: 'now' }])
  })
  test('edit rate percentages round-trip without a second multiplication', () => {
    const values = agentEditorValues({ id: 'edit', username: 'agent_one', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 1,
      allowedDomains: ['sports'], commissionRates: [{ domain: 'sports', rate: 10 }], sharingRates: [] })
    assert.equal(values.commissionRates.sports, 10)
    assert.equal(agentRateInputs('edit', values, 'now')[0].commissionRate, 0.1)
  })
  test('required credentials/domains/rates and parent caps remain enforced', () => {
    assert.equal(agentEditorSchema(false).safeParse(valid()).success, true)
    const values = valid(); values._caps.limits.sports = 5
    assert.equal(agentEditorSchema(false).safeParse(values).success, false)
    values._caps.limits.sports = 100; values._usernameError = 'Username unavailable'
    assert.equal(agentEditorSchema(false).safeParse(values).success, false)
    values._usernameError = ''; values._caps.blocked = true
    assert.equal(agentEditorSchema(false).safeParse(values).success, false)
    // A domain the whitelabel has no sharing for blocks the save.
    values._caps.blocked = false; values._caps.missingWhitelabelDomains = ['sports']
    assert.equal(agentEditorSchema(false).safeParse(values).success, false)
  })
  test('a new agent defaults tally on for COMMISSION only, and an edit keeps the stored tally', () => {
    const fresh = valid(); assert.equal(fresh.tallyEnabled, true)
    assert.equal(createAgentInput(fresh).tallyEnabled, true)
    fresh.schemeType = 'SHARING'; fresh.tallyDomains = ['sports']; fresh.levelIndex = 1
    assert.equal(createAgentInput(fresh).tallyEnabled, false); assert.deepEqual(createAgentInput(fresh).tallyDomains, [])
    const stored = agentEditorValues({ id: 'edit', username: 'agent_one', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 1, tallyEnabled: false })
    assert.equal(stored.tallyEnabled, false); assert.equal(updateAgentInput('edit', stored).tallyEnabled, false)
  })
  test('credit limit at creation is sent for CREDIT only and only when set', () => {
    const values = valid(); values.schemeType = 'CREDIT'; values.levelIndex = 1
    assert.equal('creditLimit' in createAgentInput(values), false)
    values.creditLimit = 0; assert.equal(createAgentInput(values).creditLimit, 0)
    values.creditLimit = 2500; assert.equal(createAgentInput(values).creditLimit, 2500)
    values.schemeType = 'SHARING'; assert.equal('creditLimit' in createAgentInput(values), false)
    values.schemeType = 'CREDIT'; values.creditLimit = -1; assert.equal(agentEditorSchema(false).safeParse(values).success, false)
  })
  test('an agent editing a sub-agent sends domains and status only (no level, parent or tally)', () => {
    const values = agentEditorValues({ id: 'child', username: 'child', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 3, parentAgentId: 'p', tallyEnabled: true, allowedDomains: ['sports'] })
    assert.deepEqual(updateAgentInput('child', values, { agentCaller: true }), { id: 'child', allowedDomains: ['sports'], status: 'ACTIVE' })
    assert.deepEqual(Object.keys(updateAgentInput('child', values)).sort(), ['allowedDomains', 'id', 'levelIndex', 'parentAgentId', 'status', 'tallyDomains', 'tallyEnabled'])
  })
  test('parent candidates share the scheme, are ACTIVE and (SHARING/CREDIT) sit above level 4', () => {
    const options = [
      { id: 'l1', username: 'l1', levelIndex: 1, schemeType: 'SHARING', status: 'ACTIVE' }, { id: 'l4', username: 'l4', levelIndex: 4, schemeType: 'SHARING', status: 'ACTIVE' },
      { id: 'sus', username: 'sus', levelIndex: 2, schemeType: 'SHARING', status: 'SUSPENDED' }, { id: 'com', username: 'com', levelIndex: 6, schemeType: 'COMMISSION', status: 'ACTIVE' },
    ]
    assert.deepEqual(eligibleParentAgents(options, 'SHARING').map((option) => option.id), ['l1'])
    assert.deepEqual(eligibleParentAgents(options, 'COMMISSION').map((option) => option.id), ['com'])
  })
})
