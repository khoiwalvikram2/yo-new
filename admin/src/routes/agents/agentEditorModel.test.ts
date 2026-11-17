import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { agentEditorValues, agentEditorSchema, agentRateInputs, createAgentInput, eligibleParentAgents, givesOpeningChips, tallyIsOn, updateAgentInput, type AgentEditorValues } from './agentEditorModel'
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
  test('a new agent starts with the tally off; it is sent on for COMMISSION only, and only with a domain (AGE-09)', () => {
    // It started "on" with no domain: every screen showed Tally while commission was paid as off.
    const fresh = valid(); assert.equal(fresh.tallyEnabled, false); assert.equal(createAgentInput(fresh).tallyEnabled, false)
    fresh.tallyEnabled = true; fresh.tallyDomains = ['sports']
    assert.equal(createAgentInput(fresh).tallyEnabled, true); assert.deepEqual(createAgentInput(fresh).tallyDomains, ['sports'])
    fresh.tallyDomains = []
    assert.equal(createAgentInput(fresh).tallyEnabled, false, 'on with no domain is sent as off')
    fresh.schemeType = 'SHARING'; fresh.tallyEnabled = true; fresh.tallyDomains = ['sports']; fresh.levelIndex = 1
    assert.equal(createAgentInput(fresh).tallyEnabled, false); assert.deepEqual(createAgentInput(fresh).tallyDomains, [])
    const stored = agentEditorValues({ id: 'edit', username: 'agent_one', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 1, tallyEnabled: false })
    assert.equal(stored.tallyEnabled, false); assert.equal(updateAgentInput('edit', stored).tallyEnabled, false)
  })
  test('an edit shows a stored tally as it is paid: on only with domains (AGE-09)', () => {
    const record = { id: 'edit', username: 'agent_one', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 1, tallyEnabled: true }
    assert.equal(agentEditorValues({ ...record, tallyDomains: [] }).tallyEnabled, false, '12 live agents were stored on with no domain')
    assert.equal(agentEditorValues({ ...record, tallyDomains: null }).tallyEnabled, false)
    assert.equal(agentEditorValues({ ...record, tallyDomains: ['sports', 'casino'] }).tallyEnabled, true)
    assert.equal(tallyIsOn(true, ['matka']), true); assert.equal(tallyIsOn(true, []), false); assert.equal(tallyIsOn(false, ['matka']), false); assert.equal(tallyIsOn(undefined, null), false)
  })
  test('a COMMISSION tally switched on needs a domain; off needs none (AGE-09)', () => {
    const values = { ...valid(), levelIndex: 1, tallyEnabled: true, tallyDomains: [] as string[] }
    const parsed = agentEditorSchema(false).safeParse(values)
    assert.equal(parsed.success, false)
    assert.ok(!parsed.success && parsed.error.issues.some((issue) => issue.path.join('.') === 'tallyDomains' && /at least one domain/.test(issue.message)))
    assert.equal(agentEditorSchema(false).safeParse({ ...values, tallyDomains: ['sports'] }).success, true)
    assert.equal(agentEditorSchema(false).safeParse({ ...values, tallyEnabled: false }).success, true)
    assert.equal(agentEditorSchema(true).safeParse(values).success, false, 'an edit too')
  })
  test('an edit sends only the rates that changed (AGE-18): an unchanged one added another identical rate row', () => {
    const record = { id: 'edit', username: 'agent_one', schemeType: 'COMMISSION', status: 'ACTIVE', levelIndex: 1, allowedDomains: ['sports', 'casino', 'matka'],
      commissionRates: [{ domain: 'sports', rate: 2 }, { domain: 'casino', rate: 3 }, { domain: 'matka', rate: 1.5 }], sharingRates: [] }
    const values = agentEditorValues(record)
    assert.deepEqual(agentRateInputs('edit', values, 'now', record), [], 'nothing changed, nothing sent')
    values.commissionRates.sports = 2.5
    assert.deepEqual(agentRateInputs('edit', values, 'now', record), [{ agentId: 'edit', domain: 'sports', commissionRate: 0.025, effectiveFrom: 'now' }])
    // A domain with no rate yet is sent; and without the record (creation) every rate is.
    const noMatka = { ...record, commissionRates: record.commissionRates.filter((row) => row.domain !== 'matka') }
    assert.deepEqual(agentRateInputs('edit', values, 'now', noMatka).map((input) => input.domain), ['sports', 'matka'])
    assert.equal(agentRateInputs('edit', values, 'now').length, 3)
    // SHARING compares against the sharing rates, to 2 decimals.
    const sharing = { ...record, schemeType: 'SHARING', commissionRates: [], sharingRates: [{ domain: 'sports', rate: 30.004 }] }
    const sharingValues = { ...agentEditorValues(sharing), allowedDomains: ['sports'] }
    assert.deepEqual(agentRateInputs('edit', sharingValues, 'now', sharing), [])
  })
  test('the credit reference (creditLimit) at creation is sent for CREDIT only and only when set', () => {
    const values = valid(); values.schemeType = 'CREDIT'; values.levelIndex = 1
    assert.equal('creditLimit' in createAgentInput(values), false)
    values.creditLimit = 0; assert.equal(createAgentInput(values).creditLimit, 0)
    values.creditLimit = 2500; assert.equal(createAgentInput(values).creditLimit, 2500)
    values.schemeType = 'SHARING'; assert.equal('creditLimit' in createAgentInput(values), false)
    values.schemeType = 'CREDIT'; values.creditLimit = -1; assert.equal(agentEditorSchema(false).safeParse(values).success, false)
  })
  test('opening chips are sent for CREDIT only when above 0, and cannot exceed the parent\'s free chips', () => {
    const values = valid(); values.schemeType = 'CREDIT'; values.levelIndex = 1; values.sharingRates = { sports: 5 }
    assert.equal('openingChips' in createAgentInput(values), false)
    values.openingChips = 0; assert.equal('openingChips' in createAgentInput(values), false)
    values.openingChips = 1500; assert.equal(createAgentInput(values).openingChips, 1500)
    values.schemeType = 'SHARING'; assert.equal('openingChips' in createAgentInput(values), false)
    values.schemeType = 'CREDIT'
    // The parent's free chips unknown: the server decides. Known: no more than they are.
    values._chipsFree = null; assert.equal(agentEditorSchema(false).safeParse(values).success, true)
    values._chipsFree = 1000
    const refused = agentEditorSchema(false).safeParse(values)
    assert.equal(refused.success, false)
    assert.equal(refused.error?.issues.find((issue) => issue.path[0] === 'openingChips')?.message, 'Not enough chips: 1000.00 free')
    values._chipsFree = 1500; assert.equal(agentEditorSchema(false).safeParse(values).success, true)
    values.openingChips = -5; assert.equal(agentEditorSchema(false).safeParse(values).success, false)
  })
  test('opening chips come only from the direct upline: an agent for its own sub-agent, an admin for a root agent', () => {
    const values = valid(); values.schemeType = 'CREDIT'; values.levelIndex = 1; values.sharingRates = { sports: 5 }; values.openingChips = 1500
    assert.equal(givesOpeningChips(values), true, 'an admin creating a root agent gives them from the whitelabel pool')
    assert.equal(createAgentInput(values).openingChips, 1500)
    values.parentAgentId = 'parent-1'; values.levelIndex = 3
    assert.equal(givesOpeningChips(values), false, 'under a parent an admin picked, that agent deposits them')
    assert.equal('openingChips' in createAgentInput(values), false, 'whatever the form still holds')
    assert.equal(createAgentInput(values).parentAgentId, 'parent-1')
    // An agent always creates its own direct sub-agent, so it gives them from its own chips.
    const creator = { id: 'agent-9', schemeType: 'CREDIT', levelIndex: 2 }
    assert.equal(givesOpeningChips(values, creator), true)
    const input = createAgentInput(values, creator)
    assert.equal(input.parentAgentId, 'agent-9'); assert.equal(input.openingChips, 1500)
    values.schemeType = 'SHARING'; assert.equal(givesOpeningChips(values, creator), false)
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
