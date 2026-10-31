/**
 * Whose rows an agent's export holds (agent features spec §4): the caller's subtree, or a
 * sub-agent's when the caller names one inside it (any other is ignored). Also: the export periods
 * and the row count's refusals.
 *
 * Unit: nothing here reads the database. The refusals throw before any query, and SUBAGENTS is
 * counted from the scope.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentExportScope.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  betExportWindow,
  countAgentExportRows,
  countAgentExportRowsForCaller,
  instantExportWindow,
  parseExportFilters,
  resolveAgentScopeRoot,
} from '../services/agentExportScope.js'

const SUBTREE = ['agent-1', 'agent-2', 'agent-3']

describe('resolveAgentScopeRoot', () => {
  it('is the caller by default', () => {
    assert.equal(resolveAgentScopeRoot('agent-1', undefined, SUBTREE), 'agent-1')
    assert.equal(resolveAgentScopeRoot('agent-1', '', SUBTREE), 'agent-1')
    assert.equal(resolveAgentScopeRoot('agent-1', 'agent-1', SUBTREE), 'agent-1')
  })

  it("narrows to a sub-agent inside the caller's subtree", () => {
    assert.equal(resolveAgentScopeRoot('agent-1', 'agent-3', SUBTREE), 'agent-3')
    assert.equal(resolveAgentScopeRoot('agent-1', ' agent-2 ', SUBTREE), 'agent-2')
  })

  it('ignores an agent outside the subtree, and a value that is not an id', () => {
    assert.equal(resolveAgentScopeRoot('agent-1', 'agent-9', SUBTREE), 'agent-1')
    assert.equal(resolveAgentScopeRoot('agent-1', 42, SUBTREE), 'agent-1')
    assert.equal(resolveAgentScopeRoot('agent-1', ['agent-2'], SUBTREE), 'agent-1')
  })
})

describe('parseExportFilters', () => {
  it('reads an object or JSON text, and anything else as no filters', () => {
    assert.deepEqual(parseExportFilters({ status: 'won' }), { status: 'won' })
    assert.deepEqual(parseExportFilters('{"status":"won"}'), { status: 'won' })
    assert.deepEqual(parseExportFilters('not json'), {})
    assert.deepEqual(parseExportFilters(null), {})
    assert.deepEqual(parseExportFilters(['status']), {})
  })
})

describe('export periods', () => {
  it('bets: the whitelabel-zone day bounds, as the bet repos read them', () => {
    const w = betExportWindow({ dateFrom: '2026-10-01', dateTo: '2026-10-07' }, 'Asia/Kolkata')
    assert.equal(w.from?.toISOString(), '2026-09-30T18:30:00.000Z')
    assert.equal(w.to?.toISOString(), '2026-10-07T18:29:59.999Z')
  })

  it('payments and settlements: the instants the page sent', () => {
    const w = instantExportWindow({ dateFrom: '2026-09-30T18:30:00.000Z', dateTo: '2026-10-07T18:29:59.999Z' })
    assert.equal(w.from?.toISOString(), '2026-09-30T18:30:00.000Z')
    assert.equal(w.to?.toISOString(), '2026-10-07T18:29:59.999Z')
  })

  it('an absent or unreadable date leaves that end open', () => {
    for (const w of [betExportWindow({ dateFrom: 'soon', dateTo: 42 }, 'Asia/Kolkata'), instantExportWindow({ dateFrom: 'soon' }), instantExportWindow({})]) {
      assert.equal(w.from, undefined)
      assert.equal(w.to, undefined)
    }
  })
})

describe('the row count', () => {
  const agent = (over: Record<string, unknown> = {}) => ({
    tenant: 'brand-a',
    user: { type: 'agent', agentId: 'agent-1', agentSchemeType: 'SHARING', agentAllowedDomains: ['casino'], ...over },
  })

  it('answers null to an admin, whose estimates keep their own queries', async () => {
    assert.equal(await countAgentExportRowsForCaller({ tenant: 'brand-a', user: { sub: '1' } }, 'players', {}), null)
  })

  it('refuses a type the agent may not export, before reading anything', async () => {
    await assert.rejects(countAgentExportRowsForCaller(agent(), 'audit-logs', {}), /agents may not export AUDIT_LOGS/)
    await assert.rejects(countAgentExportRowsForCaller(agent(), 'sports-bets', {}), /agents may not export SPORTS_BETS/)
    await assert.rejects(countAgentExportRowsForCaller(agent(), 'commission', {}), /agents may not export COMMISSION/)
  })

  it('refuses an agent session with no agent id', async () => {
    await assert.rejects(countAgentExportRowsForCaller(agent({ agentId: '' }), 'players', {}), /without an agent id/)
  })

  it("re-checks the policy against the scope, and counts sub-agents without the agent", async () => {
    const scope = {
      callerAgentId: 'agent-1',
      scopeAgentId: 'agent-1',
      schemeType: 'COMMISSION' as const,
      allowedDomains: [],
      tenant: 'brand-a',
      whitelabelId: 'brand-a',
      subtreeIds: ['agent-1', 'agent-2', 'agent-3'],
    }
    await assert.rejects(countAgentExportRows('settlement', {}, scope), /agents may not export SETTLEMENT/)
    assert.equal(await countAgentExportRows('subagents', {}, scope), 2)
  })
})
