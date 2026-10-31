/**
 * deriveAgentPermissions runs on every agent request, so the export rights it gained for the Export
 * Center (agent features spec §4) must add export rights and nothing else. Measured against the
 * whole permission catalogue through hasPermission, the same way every resolver asks.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/deriveAgentPermissions.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveAgentPermissions } from '../AgentPermissionsService.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { NESTED_PERMISSIONS } from '@src/config/nestedPermissions.js'

const ALL = ['sports', 'casino', 'matka'] as const
const SCHEMES = ['COMMISSION', 'SHARING', 'CREDIT'] as const

function can(perms: { domain: string; actions: string[] }[], key: string): boolean {
  const i = key.lastIndexOf(':')
  return hasPermission(perms, key.slice(0, i), key.slice(i + 1))
}

function granted(perms: { domain: string; actions: string[] }[]): Set<string> {
  return new Set(NESTED_PERMISSIONS.map((p) => `${p.domain}:${p.action}`).filter((key) => can(perms, key)))
}

describe('deriveAgentPermissions', () => {
  it('is unchanged for a caller that passes no scheme', () => {
    assert.deepEqual(deriveAgentPermissions(['sports']), [
      { domain: 'sports', actions: ['read'] },
      { domain: 'sports.events', actions: ['view'] },
      { domain: 'sports.live-analysis', actions: ['view'] },
      { domain: 'sports.bets', actions: ['view'] },
      { domain: 'reporting', actions: ['read', 'view'] },
      { domain: 'players', actions: ['view', 'manage'] },
      { domain: 'users', actions: ['read', 'write'] },
      { domain: 'agents', actions: ['view', 'manage', 'read'] },
      { domain: 'bonuses', actions: ['read', 'view'] },
    ])
  })

  it('adds only export rights for each scheme, and takes nothing away', () => {
    const domainExports = ['reporting.casino:export', 'reporting.exports:create', 'reporting.matka:export', 'reporting.sports:export']
    const expected: Record<(typeof SCHEMES)[number], string[]> = {
      COMMISSION: ['reporting.agents-commission:export', ...domainExports].sort(),
      SHARING: domainExports,
      CREDIT: domainExports,
    }
    const before = granted(deriveAgentPermissions([...ALL]))
    for (const scheme of SCHEMES) {
      const after = granted(deriveAgentPermissions([...ALL], scheme))
      assert.deepEqual([...before].filter((k) => !after.has(k)), [], `${scheme} lost a permission`)
      assert.deepEqual([...after].filter((k) => !before.has(k)).sort(), expected[scheme], scheme)
    }
  })

  it("keeps an agent's bet exports to its domains", () => {
    const perms = deriveAgentPermissions(['casino'], 'SHARING')
    assert.equal(hasPermission(perms, 'reporting.casino', 'export'), true)
    assert.equal(hasPermission(perms, 'reporting.sports', 'export'), false)
    assert.equal(hasPermission(perms, 'reporting.matka', 'export'), false)
    assert.equal(hasPermission(perms, 'reporting.exports', 'create'), true)
  })

  it('never opens a payments, settlements, audit or bonus permission', () => {
    for (const scheme of SCHEMES) {
      const perms = deriveAgentPermissions([...ALL], scheme)
      for (const key of [
        'payments.deposits:view',
        'payments.withdrawals:view',
        'settlements.center:view',
        'audit.events:export',
        'reporting.bonus-overview:export',
        'reporting:export',
        'finance:read',
        'deposits:view',
      ]) {
        assert.equal(can(perms, key), false, `${scheme} holds ${key}`)
      }
    }
  })
})
