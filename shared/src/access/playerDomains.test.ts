import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePlayerDomains, PLAYER_DOMAINS, type PlayerDomainRow } from './playerDomains.js'
const row = (patch: Partial<PlayerDomainRow> = {}): PlayerDomainRow => ({
  user_id: 1, player_type: 'REGULAR', player_tenant: 'qa', user_status: 'active',
  sports_visible: true, casino_visible: true, matka_visible: true, sports_bet_allowed: true, casino_bet_allowed: true, matka_bet_allowed: true,
  sports_enabled: true, casino_enabled: true, matka_enabled: true, require_password_reset: false, rg_blocked_until: null, maintenance: false,
  owner_agent_id: null, agent_id: null, agent_tenant: null, agent_status: null, allowed_domains: null, ...patch,
})
const agent = { owner_agent_id: 'agent', agent_id: 'agent', agent_tenant: 'qa', agent_status: 'ACTIVE', allowed_domains: ['sports', 'casino', 'matka'] }
for (const type of ['REGULAR', 'WHITELABEL_CREDIT', 'AGENT_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER']) {
  for (const domain of PLAYER_DOMAINS) {
    for (const visible of [false, true]) for (const allowed of [false, true]) {
      test(`${type} ${domain}: visible=${visible}, betting=${allowed}`, () => {
        const access = evaluatePlayerDomains([row({ ...(type.includes('AGENT') ? agent : {}), player_type: type,
          [`${domain}_visible`]: visible, [`${domain}_bet_allowed`]: allowed })])
        assert.equal(access[domain].visible, visible)
        assert.equal(access[domain].canBet, visible && allowed)
        for (const other of PLAYER_DOMAINS.filter(item => item !== domain)) assert.equal(access[other].canBet, true)
      })
    }
  }
}
test('an owning agent, every ancestor and the tenant bound the player flags', () => {
  const own = row(agent), parent = row({ ...agent, agent_id: 'parent', allowed_domains: ['sports'] })
  const access = evaluatePlayerDomains([own, parent])
  assert.equal(access.sports.canBet, true); assert.equal(access.casino.visible, false); assert.equal(access.matka.visible, false)
  assert.equal(evaluatePlayerDomains([own, { ...parent, agent_status: 'INACTIVE' }]).sports.canBet, false)
  assert.equal(evaluatePlayerDomains([own, { ...parent, agent_tenant: 'other' }]).sports.visible, false)
  assert.equal(evaluatePlayerDomains([row({ player_type: 'AGENT_CREDIT' })]).sports.canBet, false)
})
test('a tenant feature overrides visible flags, while betting restrictions preserve browsing', () => {
  const site = evaluatePlayerDomains([row({ casino_enabled: false })])
  assert.equal(site.casino.visible, false); assert.equal(site.casino.canBet, false)
  for (const patch of [{ user_status: 'suspended' }, { require_password_reset: true }, { rg_blocked_until: '2099-01-01' }, { maintenance: true }]) {
    const access = evaluatePlayerDomains([row(patch)])
    assert.equal(access.matka.visible, true); assert.equal(access.matka.canBet, false)
  }
  assert.equal(evaluatePlayerDomains([]).sports.visible, false)
})
