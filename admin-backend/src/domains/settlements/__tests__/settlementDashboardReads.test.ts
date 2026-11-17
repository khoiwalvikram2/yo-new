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

  // CREDIT moves chips by Deposit / Withdraw since 2026-11-02. Its agents may still carry a stale
  // settlement_balance; the settlement centre must neither read nor show it.
  const creditRow = (id: string, parentAgentId: string | null, balance: number) => ({ id, parentAgentId, tenantId: 'dashboard-test', schemeType: 'CREDIT', settlementBalance: balance,
    settlementBalanceSports: balance, settlementBalanceCasino: 0, settlementBalanceMatka: 0 })

  it('the dashboard carries no CREDIT pending, no credit-player count and no CREDIT domain balances', async () => {
    mock.method(AgentsRepo.prototype, 'list', async () => [creditRow('root', null, 100), creditRow('child', 'root', 60)] as any)
    mock.method(AgentsRepo.prototype, 'getCreditFields', async () => { throw new Error('The retired CREDIT settlement balance must not be read') })
    mock.method(AgentListStatsService.prototype, 'getStatsForAgents', async () => { throw new Error('Dashboard must not calculate unrelated player statistics') })
    mock.method(AgentSettlementTransactionsRepo.prototype, 'list', async () => [])
    mock.method(CommissionPayoutsRepo.prototype, 'list', async () => [])
    const chain: any = { from: () => chain, where: () => chain, groupBy: async () => [], then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve) }
    mock.method(db, 'select', () => chain)
    const result: Record<string, unknown> = await settlementsQueryResolvers.settlementDashboard(null, {}, context)
    assert.equal(result.pendingCommissionPayouts, 0)
    // The three CREDIT fields left the schema (spec 2026-11-02 §6); the resolver no longer returns them either.
    for (const key of ['pendingCreditSettlements', 'pendingDirectCreditAdjustments', 'domainBreakdown']) {
      assert.equal(key in result, false, key)
    }
  })

  it('admin pending lists leave CREDIT root agents out without reading their balances', async () => {
    mock.method(AgentsRepo.prototype, 'list', async () => [creditRow('root', null, 100), creditRow('other', null, -40)] as any)
    mock.method(AgentsRepo.prototype, 'getCreditFields', async () => { throw new Error('The retired CREDIT settlement balance must not be read') })
    mock.method(AgentListStatsService.prototype, 'getStatsForAgents', async () => { throw new Error('No agent is left to read statistics for') })
    mock.method(db, 'select', () => { throw new Error('No agent is left: no more SQL') })
    assert.deepEqual(await settlementsQueryResolvers.pendingSettlements(null, {}, context), [])
    assert.deepEqual(await settlementsQueryResolvers.enhancedPendingSettlements(null, {}, context), [])
    assert.deepEqual(await settlementsQueryResolvers.pendingSettlements(null, { schemeType: 'CREDIT' }, context), [])
  })
})
