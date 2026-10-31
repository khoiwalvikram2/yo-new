import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import type { ProfileAgent, ProfileStats } from '../src/modules/agents/AgentProfilePage/components/agentProfileModel'
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(item => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'AgentProfileFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface AgentProfileFixtureState { scheme: string; refused?: boolean; missing?: boolean; profileError?: boolean; threshold?: number; referralMissing?: boolean; status?: string; creditLimit?: number }
export function profileAgentFixture(scheme: string): ProfileAgent {
  return { id: 'root1', tenantId: 'preview', username: 'Root Partner', phone: '9876543210', schemeType: scheme, status: 'ACTIVE', parentAgentId: 'parent1', levelIndex: 1,
    tallyEnabled: true, tallyDomains: ['sports'], allowedDomains: ['sports', 'casino', 'matka'], sharingRates: [{ domain: 'sports', rate: 40 }, { domain: 'casino', rate: 30 }, { domain: 'matka', rate: 20 }],
    commissionRates: [{ domain: 'sports', rate: 2 }, { domain: 'casino', rate: 3 }, { domain: 'matka', rate: 1.5 }], creditLimit: 10000, creditUsed: 3000, creditAvailable: 7000, creditAlertThreshold: 80, createdAt: '2026-09-22' }
}
export const profileStatsFixture: ProfileStats = { totalPlayers: 17, activePlayers24h: 12, newPlayersToday: 3, pendingDeposits: 2, pendingDepositsAmount: 2000, pendingWithdrawals: 1, pendingWithdrawalsAmount: 500,
  totalDeposits: 25000, totalWithdrawals: 10000, directDeposits: 20000, directWithdrawals: 7000, manualDeposits: 5000, manualWithdrawals: 3000, ggr: 5000, profitLoss: 1200,
  ggrByWalletType: { cash: 5000, bonus: 700, referralBonus: 80 }, plByWalletType: { cash: 1200, bonus: -200, referralBonus: 40 },
  directPlayerCount: 10, subAgentPlayerCount: 7, totalSubAgents: 2, totalDownlineBalance: 80000, totalDownlineExposure: 12000,
  sportsGgr: 3000, sportsPl: 700, casinoGgr: 1800, casinoPl: 450, matkaGgr: 200, matkaPl: 50 }
export function agentProfileResponse(operation: Operation, state: AgentProfileFixtureState): FetchResult {
  let result: Record<string, unknown>
  const allocation = { agentId: 'root1', creditLimit: state.creditLimit || 10000, creditUsed: 3000, creditAvailable: 7000, creditAlertThreshold: state.threshold ?? 80, usagePercentage: 30, isOverLimit: false, isNearThreshold: false }
  switch (operation.operationName) {
    case 'AgentProfile': result = { agents: { agentProfile: state.missing ? null : { ...profileAgentFixture(state.scheme), status: state.status || 'ACTIVE', creditLimit: state.creditLimit || 10000 } } }; break
    case 'AgentDashboardStats': result = { agents: { agentDashboardStats: profileStatsFixture } }; break
    case 'ParentAgent': result = { agents: { agentProfile: { id: 'parent1', username: 'Parent Partner', phone: '9870000000' } } }; break
    case 'SubAgentsCount': result = { agents: { agentTree: [{ id: 'child1' }] } }; break
    case 'AgentTree': result = { agents: { agentTree: operation.variables.rootId === 'root1' ? [{ ...profileAgentFixture(state.scheme), id: 'child1', username: 'Child Partner', parentAgentId: 'root1', levelIndex: 2 }] : [{ ...profileAgentFixture(state.scheme), id: 'grandchild1', username: 'Nested Partner', parentAgentId: 'child1', levelIndex: 3 }] } }; break
    case 'AgentSecurityAudit': result = { agents: { agentSecurityAudit: [{ id: 'audit1', type: 'login', success: true, description: 'Successful sign in', timestamp: '2026-10-08T09:00:00Z', ipAddress: '127.0.0.1', userAgent: 'Preview browser' }, { id: 'audit2', type: 'login', success: false, description: 'Failed sign in', timestamp: '2026-10-08T08:00:00Z', ipAddress: null }, { id: 'audit3', type: 'password_change', success: true, description: 'Password reset', timestamp: '2026-10-01T09:00:00Z' }] } }; break
    case 'CreditAllocation': result = { agents: { creditAllocation: allocation } }; break
    case 'AgentCreditAlerts': result = { agents: { agentCreditAlerts: [{ id: 'alert1', alertType: 'THRESHOLD', threshold: 80, currentValue: 8500 }] } }; break
    case 'AgentPlayerCredits': result = { agents: { agentPlayerCredits: [{ playerId: 'player1', playerName: 'Credit Player', creditLimit: 4000, currentBalance: 2000, openExposure: 500, creditUsed: 2500, creditAvailable: 1500 }] } }; break
    case 'AgentCreditTransactions': result = { agents: { agentCreditTransactions: [{ id: 'credit-tx1', createdAt: '2026-10-01T09:00:00Z', transactionType: 'DEPOSIT', amount: 500, balanceBefore: 3000, balanceAfter: 3500, reason: 'Funding credit', toEntityType: 'player', toEntityId: 'player1' }] } }; break
    case 'SetAgentCreditAlertThreshold': if (!state.refused) state.threshold = operation.variables.threshold; result = { agents: { setAgentCreditAlertThreshold: state.refused ? null : allocation } }; break
    case 'ResolveAgentCreditAlert': result = { agents: { resolveAgentCreditAlert: !state.refused } }; break
    case 'UpdateAgentStatus': if (!state.refused) state.status = operation.variables.status; result = { agents: { updateAgentStatus: !state.refused } }; break
    case 'AdminResetAgentPassword': result = { agents: { adminResetAgentPassword: { success: !state.refused, message: state.refused ? 'Password reset refused' : 'Password reset complete' } } }; break
    case 'AdjustSubAgentCredit': if (!state.refused) state.creditLimit = operation.variables.creditLimit; result = { agents: { adjustSubAgentCredit: { success: !state.refused, message: state.refused ? 'Credit change refused' : 'Credit limit changed', agent: { id: 'root1', ...allocation } } } }; break
    case 'AdjustAgentCredit': result = { agents: { adjustAgentCredit: { success: !state.refused, message: state.refused ? 'Credit change refused' : 'Credit adjusted', adjustment: { id: 'adjustment1', ...operation.variables.input } } } }; break
    // SHARING pending: positive = TO_AGENT (the agent is paid its share); periodTo = the end of the window it covers.
    case 'PendingSettlements': result = { pendingSettlements: [{ agentId: 'root1', schemeType: state.scheme, pendingAmount: 4000, settlementDirection: 'TO_AGENT', periodFrom: '2026-10-01T00:00:00.000Z', periodTo: '2026-10-09T10:00:00.000Z', settlementType: state.scheme === 'CREDIT' ? 'CREDIT' : 'P_L' }] }; break
    case 'AgentSettlementTransactionsPage':
    case 'AgentSettlementTransactions': result = { agentSettlementTransactions: [{ id: 'settle1', createdAt: '2026-10-01', amount: 1000, direction: 'TO_AGENT', settlementType: state.scheme === 'CREDIT' ? 'CREDIT' : 'P_L', previousBalance: 5000, newBalance: 4000, notes: 'Weekly settlement' }, { id: 'settle2', createdAt: '2026-09-24', amount: 500, direction: 'FROM_AGENT', previousBalance: 1000, newBalance: 500, notes: 'Collected settlement' }] }; break
    case 'SettleAgent': result = { settleAgent: { success: !state.refused, message: state.refused ? 'Settlement refused' : 'Settlement recorded' } }; break
    case 'SettlementSummary': result = { agents: { settlementSummary: { netPL: 10000, sharePercentage: 40, settlementDue: 4000, lastSettlementDate: '2026-10-01', lastSettlementAmount: 1000, currency: 'INR' } } }; break
    case 'AgentLedgers': result = { agents: { agentLedgers: [{ id: 'ledger1', createdAt: '2026-10-01', domain: 'sports', lineType: 'SHARE', periodFrom: '2026-09-22', periodTo: '2026-09-29', amount: 1000, currency: 'INR' }] } }; break
    case 'AgentSettlements': result = { agents: { agentSettlements: [{ id: 'history1', periodFrom: '2026-09-22', periodTo: '2026-09-29', totalAmount: 1000, currency: 'INR', status: 'POSTED', postedAt: '2026-10-01' }] } }; break
    case 'CommissionSummary': result = { agents: { commissionSummary: { currency: 'INR', sportsGGR: 3000, casinoGGR: 1800, matkaGGR: 200, sportsCommissionRate: .02, casinoCommissionRate: .03, matkaCommissionRate: .015, sportsCommission: 200, casinoCommission: 300, matkaCommission: 100, netSportsCommission: 160, netCasinoCommission: 200, netMatkaCommission: 50, totalEarned: 800, pending: 100, paid: 700,
      // Receivable = the gross after tally (600); My Share = the net (410 = 600 − the sub-agents' 190).
      grossSportsCommission: 200, grossCasinoCommission: 300, grossMatkaCommission: 100, grossEffectiveSportsCommission: 200, grossEffectiveCasinoCommission: 300, grossEffectiveMatkaCommission: 100, grossEffectiveCalculatedTotal: 600,
      netEffectiveSportsCommission: 160, netEffectiveCasinoCommission: 200, netEffectiveMatkaCommission: 50, netEffectiveCalculatedTotal: 410 } } }; break
    case 'CommissionPayoutsPage':
    case 'CommissionPayouts': result = { commissionPayouts: [{ id: 'payout1', createdAt: '2026-10-01', periodFrom: '2026-09-22', periodTo: '2026-09-29', turnover: 25000, amount: 700, notes: 'Weekly commission' }] }; break
    case 'SubAgentCommissionSummaries': result = { subAgentCommissionSummaries: [{ agentId: 'child1', username: 'Child Partner', pendingCommission: 100, totalPaid: 50, lastPaidAt: '2026-10-01', sportsGGR: 3000, casinoGGR: 1000, matkaGGR: 500, sportsCommission: 20, casinoCommission: 30, matkaCommission: 10, sportsCommissionRate: .02, casinoCommissionRate: .03, matkaCommissionRate: .015, tallyEnabled: true, tallyDomains: ['sports'],
      // effective* = the child's gross after tally: what this agent pays it (the parent's Payable).
      effectiveSportsCommission: 40, effectiveCasinoCommission: 100, effectiveMatkaCommission: 50, effectiveCalculatedTotal: 190 }] }; break
    case 'DirectPlayerCommissionSummaries': result = { agents: { directPlayerCommissionSummaries: [{ playerId: 'player1', playerName: 'Preview Player', subAgentId: 'child1', subAgentUsername: 'Child Partner', subAgentSportsRate: .02, subAgentCasinoRate: .03, subAgentMatkaRate: .015, sportsGGR: 3000, casinoGGR: 1000, matkaGGR: 500, sportsCommission: 20, casinoCommission: 30, matkaCommission: 10, totalCommission: 60 }] } }; break
    case 'AgentPlayers': result = { usersPage: { total: 21, itemsWithStats: [{ player: { id: 'player1', name: 'Preview Player', username: 'preview_player', email: 'preview@example.invalid', phone: '9000000001', status: 'active', playerType: 'REGULAR', parentAgent: { id: 'child1', username: 'Child Partner' }, wallet: { balance: 5000, exposure: 500, currency: 'INR' }, referredBy: { id: 'referrer1', name: 'Referrer Partner', phone: '9000000002' } }, stats: { lastActivityAt: '2026-10-08T09:00:00Z', lastBetAt: '2026-10-07T09:00:00Z', daysSinceLastBet: 2, totalExposure: 500 } }, { player: { id: 'player2', name: 'Credit Player', username: 'credit_player', status: 'active', playerType: 'AGENT_CREDIT', creditLimit: 4000, creditUsed: 2500, creditAvailable: 1500, wallet: { balance: 0, exposure: 300 } }, stats: { daysSinceLastBet: 1 } }] } }; break
    case 'AgentPlayerCounts': result = { active: { total: 15 } }; break
    case 'AgentReferralLink': result = { agentReferralLink: state.referralMissing ? null : { id: 'referral1', code: 'PREVIEW42', isActive: true, totalClicks: 100, totalSignups: 12, conversionRate: 12 } }; break
    case 'GenerateAgentReferralLink': if (!state.refused) state.referralMissing = false; result = { generateReferralLink: { success: !state.refused, message: state.refused ? 'Generation refused' : 'Referral link generated' } }; break
    case 'CommissionAdjustmentsPage':
    case 'CommissionAdjustments': result = { commissionAdjustments: [] }; break
    case 'CommissionCyclesForAgent': result = { commissionCyclesForAgent: [] }; break
    case 'CommissionHistory': result = { agents: { commissionHistory: { entries: [{ id: 'bet1', date: '2026-10-08', playerId: 'player1', playerName: 'Preview Player', domain: 'sports', betAmount: 100, ggr: 20, commissionRate: .02, commissionEarned: .4, currency: 'INR', status: 'settled' }], total: 1 } } }; break
    case 'CurrentWhitelabel': result = { whitelabelCurrent: null }; break
    case 'Currencies': result = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    default: throw new Error(`Unexpected agent profile operation: ${operation.operationName}`)
  }
  if (operation.operationName === 'AgentSettlementTransactionsPage') { const all = result.agentSettlementTransactions ?? []; result.agentSettlementTransactionsPage = { items: all.slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)), total: all.length }; }
  if (operation.operationName === 'CommissionPayoutsPage') { const all = result.commissionPayouts ?? []; result.commissionPayoutsPage = { items: all.slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)), total: all.length }; }
  if (operation.operationName === 'CommissionAdjustmentsPage') { const all = result.commissionAdjustments ?? []; result.commissionAdjustmentsPage = { items: all.slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)), total: all.length }; }
  if (result.agents?.agentCreditTransactions) result.agents.agentCreditTransactionsCount = result.agents.agentCreditTransactions.length
  if (result.agentSettlementTransactionsPage) Object.assign(result.agentSettlementTransactionsPage, { totalAmount: 1500, toAgent: 1000, fromAgent: 500, toCount: 1, fromCount: 1 })
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
