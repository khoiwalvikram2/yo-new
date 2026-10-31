/**
 * ExportJobProcessor for an agent (agent features spec §4).
 * - Defence in depth: the processor refuses the types no agent may export, before reading a row,
 *   even though createExportJob already refused them.
 * - It refuses an agent export whose scope was not resolved, rather than read the whitelabel.
 * - No agent rows are filtered in memory after a capped read any more: they come from the
 *   SQL-scoped builders in agentExportQueries.
 *
 * Unit: every call here throws before any query.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/exportJobProcessorAgent.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExportJobProcessor } from '../services/ExportJobProcessor.js'

const SCOPE = {
  callerAgentId: 'agent-1',
  scopeAgentId: 'agent-1',
  schemeType: 'SHARING',
  allowedDomains: ['casino'],
  tenant: 'brand-a',
  whitelabelId: 'brand-a',
  subtreeIds: ['agent-1'],
}

function fetchAs(type: string, agentContext: Record<string, unknown>, agentScope: unknown): Promise<unknown[]> {
  return (new ExportJobProcessor() as any).fetchExportData(
    type,
    {},
    { tenant: 'brand-a', whitelabelId: 'brand-a' },
    { agentContext, agentScope, tenant: 'brand-a' },
  )
}

describe('ExportJobProcessor for an agent', () => {
  it('refuses the whitelabel-level and unscoped reports before reading anything', async () => {
    const sharing = { agentId: 'agent-1', schemeType: 'SHARING', allowedDomains: ['sports', 'casino', 'matka'] }
    for (const type of ['AUDIT_LOGS', 'AUDITLOGS', 'BONUS_CAMPAIGNS', 'GGR', 'TRANSACTIONS', 'AGENTS', 'COMMISSION']) {
      await assert.rejects(fetchAs(type, sharing, SCOPE), /Forbidden: agents may not export/, type)
    }
  })

  it("refuses a bet export outside the agent's domains", async () => {
    await assert.rejects(
      fetchAs('SPORTS_BETS', { agentId: 'agent-1', schemeType: 'SHARING', allowedDomains: ['casino'] }, SCOPE),
      /agents may not export SPORTS_BETS/,
    )
  })

  it('refuses an agent export whose scope was not resolved, rather than export the whitelabel', async () => {
    await assert.rejects(fetchAs('PLAYERS', { agentId: 'agent-1', schemeType: 'CREDIT', allowedDomains: [] }, null), /scope was not resolved/)
  })

  it('reads agent rows from the SQL-scoped builders, with no in-memory player filter left', () => {
    const src = readFileSync(join('src', 'domains', 'reporting', 'services', 'ExportJobProcessor.ts'), 'utf8')
    assert.doesNotMatch(src, /playerIds/, 'the users.agent_id player list and its in-memory filters are gone')
    assert.doesNotMatch(src, /getPlayerIdsForAgents|getAgentHierarchyIds/)
    for (const builder of [
      'agentPlayersQuery',
      'agentSportsBetsQuery',
      'agentCasinoBetsQuery',
      'agentMatkaBetsQuery',
      'agentDepositsQuery',
      'agentWithdrawalsQuery',
      'agentSettlementsQuery',
    ]) {
      assert.match(src, new RegExp(`await ${builder}\\(`), `${builder} is not used`)
    }
    assert.match(src, /listCyclesForAgent\(/, 'COMMISSION rows come from the commission engine')
  })
})
