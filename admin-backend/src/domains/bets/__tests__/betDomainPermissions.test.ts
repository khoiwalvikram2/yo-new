/**
 * The bets list reads each bet table only with that table's own permission (W4).
 *
 * The gate was `sports.bets OR casino.bets OR matka.bets`, after which all
 * three tables were read — one bet permission opened all three. An agent is
 * additionally limited to its allowedDomains.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/bets/__tests__/betDomainPermissions.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { allowedBetDomains } from '@src/domains/bets/resolvers/queries.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const p = (...pairs: Array<[string, string[]]>) => pairs.map(([domain, actions]) => ({ domain, actions }))

describe('allowedBetDomains', () => {
  it('one bet permission opens one table, not three', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['sports.bets', ['view']]) }), {
      sports: true,
      casino: false,
      matka: false,
    })
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['casino.bets', ['view']]) }), {
      sports: false,
      casino: true,
      matka: false,
    })
  })

  it('honours the flat permission that grants a nested one (casino:read → casino.bets:view)', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['casino', ['read']]) }), {
      sports: false,
      casino: true,
      matka: false,
    })
  })

  it('a platform admin reads all three', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['all', ['*']]) }), {
      sports: true,
      casino: true,
      matka: true,
    })
  })

  it('an agent reads the tables of its allowed domains only', () => {
    const permissions = deriveAgentPermissions(['sports', 'matka'] as any)
    assert.deepEqual(
      allowedBetDomains({ user: { type: 'agent', agentId: 'a1', agentAllowedDomains: ['sports', 'matka'] }, permissions }),
      { sports: true, casino: false, matka: true },
    )
  })

  it('an agent whose permissions drifted from its domains is held to its domains', () => {
    const permissions = deriveAgentPermissions(['sports', 'casino', 'matka'] as any)
    assert.deepEqual(
      allowedBetDomains({ user: { type: 'agent', agentId: 'a1', agentAllowedDomains: ['casino'] }, permissions }),
      { sports: false, casino: true, matka: false },
    )
  })

  it('nothing at all without a bet permission', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['players.bets', ['view']]) }), {
      sports: false,
      casino: false,
      matka: false,
    })
  })
})

describe('betsPage', () => {
  it('a caller with casino bets only gets nothing from the sports table', async () => {
    const { betsQueryResolvers } = await import('@src/domains/bets/resolvers/queries.js')
    const ctx = {
      tenant: 'w4-test-no-such-tenant',
      whitelabel: { id: 'w4-test-no-such-tenant' },
      user: { sub: '1', roles: [] },
      permissions: p(['players.bets', ['view']], ['casino.bets', ['view']]),
    }
    const res = await betsQueryResolvers.betsPage(undefined, { domain: 'SPORTS' }, ctx)
    assert.deepEqual(res, { items: [], total: 0 })
  })
})
