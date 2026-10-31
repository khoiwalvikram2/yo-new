import { afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '@src/db/client.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { AgentListStatsService } from '@src/domains/agents/services/AgentListStatsService.js'
import { AgentSettlementTransactionsRepo } from '@src/repos/settlements/AgentSettlementTransactionsRepo.js'
import { CommissionPayoutsRepo } from '@src/repos/settlements/CommissionPayoutsRepo.js'
import { settlementsQueryResolvers } from '../resolvers/queries.js'

const context = { tenant: 'dashboard-test', user: { type: 'admin', sub: 'test' }, permissions: [{ domain: 'settlements.center', actions: ['view'] }] }
afterEach(() => mock.restoreAll())

describe('Settlement Center report reads', () => {
  it('empty scheme lists stop before fetching history, credentials or commission', async () => {
    mock.method(AgentsRepo.prototype, 'list', async () => [])
    mock.method(db, 'select', () => { throw new Error('Empty list must not run more SQL') })
    assert.deepEqual(await settlementsQueryResolvers.enhancedPendingSettlements(null, { schemeType: 'SHARING' }, context), [])
  })

  it('credit totals and domain balances include root obligations once and reuse the loaded rows', async () => {
    const row = (id: string, parentAgentId: string | null, balance: number) => ({ id, parentAgentId, tenantId: 'dashboard-test', schemeType: 'CREDIT', settlementBalance: balance,
      settlementBalanceSports: balance, settlementBalanceCasino: 0, settlementBalanceMatka: 0 })
    mock.method(AgentsRepo.prototype, 'list', async () => [row('root', null, 100), row('child', 'root', 60)] as any)
    mock.method(AgentsRepo.prototype, 'getCreditFields', async () => { throw new Error('Credit balances are already loaded') })
    mock.method(AgentListStatsService.prototype, 'getStatsForAgents', async () => { throw new Error('Dashboard must not calculate unrelated player statistics') })
    mock.method(AgentSettlementTransactionsRepo.prototype, 'list', async () => [])
    mock.method(CommissionPayoutsRepo.prototype, 'list', async () => [])
    const chain: any = { from: () => chain, where: () => chain, groupBy: async () => [], then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve) }
    mock.method(db, 'select', () => chain)
    const result = await settlementsQueryResolvers.settlementDashboard(null, {}, context)
    assert.equal(result.pendingCreditSettlements, 100)
    assert.equal(result.pendingCommissionPayouts, 0)
    assert.deepEqual(result.domainBreakdown, [
      { domain: 'sports', settlementBalance: 100 }, { domain: 'casino', settlementBalance: 0 }, { domain: 'matka', settlementBalance: 0 },
    ])
  })
})
