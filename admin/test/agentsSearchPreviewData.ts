import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import type { AgentListRow, AgentListStats } from '../src/routes/agents/components/agentsSearchModel'
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(item => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'AgentSearchFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface AgentsSearchFixtureState { refused?: boolean; queryError?: boolean }
export const agentListStatsFixture: AgentListStats = {
  activePlayers: 17, lastLogin: '2026-10-08T09:00:00Z', daysSinceLastBet: 2, totalDeposits: 250000,
  totalWithdrawals: 110000, ggr: 14000, totalExposure: 2500, profitLoss: -8000, plTrend: 'down', betCount: 12,
  pendingSettlement: 4000, totalSettled: 21000, lastSettlementDate: '2026-10-01', turnover: 450000,
  commissionEarned: 1200, commissionTrend: 'up',
}
export function agentsSearchRow(scheme: string, id = 'root1'): AgentListRow {
  return { id, username: id === 'root1' ? 'Root Partner' : 'Child Partner', phone: '9876543210', schemeType: scheme, status: 'ACTIVE',
    parentAgentId: id === 'root1' ? null : 'root1', parentAgent: id === 'root1' ? null : { id: 'root1', username: 'Root Partner' }, levelIndex: id === 'root1' ? 1 : 2,
    tallyEnabled: true, tallyDomains: ['sports'], allowedDomains: ['sports', 'casino', 'matka'], createdAt: '2026-09-22',
    commissionRates: [{ domain: 'sports', rate: 2 }, { domain: 'casino', rate: 3 }, { domain: 'matka', rate: 1.5 }],
    sharingRates: [{ domain: 'sports', rate: 40 }, { domain: 'casino', rate: 30 }, { domain: 'matka', rate: 20 }],
    creditLimit: 10000, creditUsed: 3000, creditAvailable: 7000 }
}
export function agentsSearchResponse(operation: Operation, state: AgentsSearchFixtureState = {}): FetchResult {
  let result: Record<string, unknown>
  const scheme = String(operation.variables.schemeType || 'COMMISSION')
  switch (operation.operationName) {
    case 'AgentsPage': result = { agents: { agentsPage: { items: [agentsSearchRow(scheme, operation.variables.parentAgentId ? 'child1' : 'root1')], total: 21 } } }; break
    case 'AgentsStats': result = { agents: { agentsPage: { itemsWithStats: [{ agent: { id: operation.variables.parentAgentId ? 'child1' : 'root1' }, stats: agentListStatsFixture }] } } }; break
    case 'AgentsForSelector': result = { agents: { agentsPage: { items: [{ id: 'root1', username: 'Root Partner' }, { id: 'child1', username: 'Child Partner' }] } } }; break
    // Per scheme: a top-level agent and its suspended sub-agent. Only the top level counts in credit and pending totals.
    case 'AgentOverviewStats': result = { agents: { agentsPage: { total: 6, items: ['SHARING', 'CREDIT', 'COMMISSION'].flatMap(type => [
      { ...agentsSearchRow(type, type.toLowerCase() + 'root'), parentAgentId: null, levelIndex: 1, creditLimit: 500000, creditUsed: 420000, settlementBalance: -6500 },
      { ...agentsSearchRow(type, type.toLowerCase() + 'child'), status: 'SUSPENDED', parentAgentId: type.toLowerCase() + 'root', levelIndex: 2, creditLimit: 100000, creditUsed: 20000, settlementBalance: 900 },
    ]) } } }; break
    // The stats cards' money totals: the same two agents with their downline stats.
    case 'AgentSchemeTotals': result = { agents: { agentsPage: { itemsWithStats: [
      { agent: { id: scheme.toLowerCase() + 'root', parentAgentId: null }, stats: { ...agentListStatsFixture, turnover: 900000, commissionEarned: 2500, profitLoss: 64000, pendingSettlement: -7000 } },
      { agent: { id: scheme.toLowerCase() + 'child', parentAgentId: scheme.toLowerCase() + 'root' }, stats: { ...agentListStatsFixture, turnover: 400000, commissionEarned: 500, profitLoss: 1000, pendingSettlement: 3000 } },
    ] } } }; break
    case 'UpdateAgentStatus': result = { agents: { updateAgentStatus: !state.refused } }; break
    case 'SettleAgent': result = { settleAgent: { success: !state.refused, message: state.refused ? 'Settlement refused' : 'Settlement recorded' } }; break
    case 'PayCommission': result = { payCommission: { success: !state.refused, message: state.refused ? 'Payment refused' : 'Commission paid' } }; break
    // The agent's pending row, fetched when Settle Now opens: SHARING positive = TO_AGENT, with the window end the settle posts.
    case 'PendingSettlements': result = { pendingSettlements: [{ agentId: 'root1', schemeType: scheme, pendingAmount: 3500, settlementDirection: 'TO_AGENT', periodFrom: '2026-10-01T00:00:00.000Z', periodTo: '2026-10-09T10:00:00.000Z', settlementType: scheme === 'CREDIT' ? 'CREDIT' : 'P_L',
      settlementBreakdownByDomain: [{ domain: 'sports', amount: -8750, percentage: 100, shareRate: 40, agentShare: 3500, cutAmount: 5250, cutPercentage: 60 }] }] }; break
    // Commission payout: the closed, unpaid IST week is payable; the open week is not.
    case 'CommissionCyclesForAgent': result = { commissionCyclesForAgent: [
      { from: '2026-09-27T18:30:00.000Z', to: '2026-10-04T18:30:00.000Z', status: 'CLOSED_UNSETTLED', paidAmount: 0, payableAmount: 1200, calculatedTotal: 1200, adjustmentAmount: 0, zeroCommission: false, fromDate: '2026-09-28', toDate: '2026-10-05' },
      { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'OPEN', paidAmount: 0, payableAmount: 0, zeroCommission: false, fromDate: '2026-10-05', toDate: '2026-10-12' },
    ] }; break
    case 'CommissionCycleReadiness': result = { commissionCycleReadiness: { ready: true, reasons: ['READY'], calculatedTotal: 1200, postedTotal: 1200, paidInCycle: 0, payableAmount: 1200, currency: 'INR', openBets: 0, unresolvedAdjustments: 0 } }; break
    case 'CommissionSummary': result = { agents: { commissionSummary: { currency: 'INR', sportsGGR: 40000, casinoGGR: 10000, matkaGGR: 0, sportsCommissionRate: .02, casinoCommissionRate: .03, matkaCommissionRate: .015, sportsCommission: 800, casinoCommission: 300, matkaCommission: 0, grossSportsCommission: 800, grossCasinoCommission: 300, grossMatkaCommission: 0, grossEffectiveSportsCommission: 900, grossEffectiveCasinoCommission: 300, grossEffectiveMatkaCommission: 0, grossEffectiveCalculatedTotal: 1200, effectiveCalculatedTotal: 1200, effectiveSportsCommission: 900, effectiveCasinoCommission: 300, effectiveMatkaCommission: 0, totalEarned: 1200, pending: 1200, paid: 0, tallyApplied: { enabled: false, domains: [] } } } }; break
    case 'CommissionHistory': result = { agents: { commissionHistory: { entries: [], total: 3 } } }; break
    case 'AdjustSubAgentCredit': result = { agents: { adjustSubAgentCredit: { success: !state.refused, message: state.refused ? 'Credit update refused' : 'Credit limit updated', agent: { id: operation.variables.agentId, creditLimit: operation.variables.creditLimit, creditUsed: 3000, creditAvailable: Number(operation.variables.creditLimit) - 3000 } } } }; break
    case 'AdjustAgentCredit': result = { agents: { adjustAgentCredit: { success: !state.refused, message: state.refused ? 'Credit update refused' : 'Credit adjusted', adjustment: { id: 'adjustment1', ...operation.variables.input } } } }; break
    case 'CurrentWhitelabel': result = { whitelabelCurrent: null }; break
    case 'Currencies': result = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    default: throw new Error(`Unexpected agents operation: ${operation.operationName}`)
  }
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
