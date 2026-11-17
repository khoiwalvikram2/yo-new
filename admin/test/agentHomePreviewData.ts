import type { FetchResult, Operation } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import { useAuthStore } from '../src/shared/core/authStore'
export type AgentScheme = 'COMMISSION' | 'SHARING' | 'CREDIT'
export function agentHomeAccount(scheme: AgentScheme = 'CREDIT', levelIndex = 1): NonNullable<ReturnType<typeof useAuthStore.getState>['agent']> {
  return { id: 'preview-agent', tenantId: 'preview-tenant', username: 'Preview Partner', phone: null, schemeType: scheme, allowedDomains: ['sports', 'casino', 'matka'], status: 'ACTIVE', parentAgentId: 'parent-agent', levelIndex, tallyEnabled: false, tallyDomains: null, createdAt: '2026-01-01T00:00:00.000Z' }
}
export interface AgentHomeFixtureState { empty?: boolean; fail?: string; effectiveZero?: boolean }
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map(item => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter(node => node.kind === 'Field').map(field => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'AgentHomeFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export function agentHomeFixtureResponse(operation: Operation, state: AgentHomeFixtureState = {}): FetchResult {
  const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  if (definition.operation !== 'query') throw new Error('AgentHome preview allows read-only queries only')
  if (state.fail === operation.operationName) throw new Error('Preview data unavailable')
  let value: Record<string, unknown>
  switch (operation.operationName) {
    case 'CurrentWhitelabel': value = { whitelabelCurrent: { id: 'preview-tenant', name: 'Preview Tenant', domain: 'preview.example.test', baseCurrency: 'INR', baseCurrencyCode: 'INR' } }; break
    case 'Currencies': value = { currencies: [{ code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2, isActive: true, exchangeRate: 1 }] }; break
    case 'AgentDashboardStats': case 'RecentPlayers': value = { agents: { agentDashboardStats: { totalPlayers: 1240, activePlayers24h: 218, newPlayersToday: 17, totalDeposits: 124500, totalWithdrawals: 48700, pendingDeposits: 12, pendingWithdrawals: 8 } } }; break
    case 'AgentKPIs': value = { agentKPIs: { totalGGR: 38750 } }; break
    case 'AgentActivity': value = { agents: { agentActivity: state.empty ? [] : [{ id: 'registered', type: 'PLAYER_REGISTERED', playerName: 'Asha Sharma', timestamp: new Date(Date.now() - 3600000).toISOString() }, { id: 'large', type: 'LARGE_BET', details: 'A large bet has been placed', timestamp: new Date(Date.now() - 1800000).toISOString() }] } }; break
    case 'GGRTrends': value = { reporting: { ggrTrends: state.empty ? [] : Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${21 + i}`, sportsGGR: 1200 + i * 80, casinoGGR: 900 + i * 60, matkaGGR: -200 + i * 15, totalGGR: 1900 + i * 155 })) } }; break
    case 'DomainBreakdown': value = { reporting: { domainBreakdown: state.empty ? [] : [{ domain: 'sports', ggr: 1200, totalBets: 85 }, { domain: 'casino', ggr: -300, totalBets: 31 }, { domain: 'matka', ggr: 100, totalBets: 19 }] } }; break
    case 'PlayerActivity': value = { reporting: { playerActivity: state.empty ? [] : Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${21 + i}`, newPlayers: 10 + i, activePlayers: 200 + i * 5, totalBets: 500 + i * 15 })) } }; break
    case 'CurrentCommissionCycle': value = { currentCommissionCycle: { from: '2026-09-21T00:00:00.000Z', to: '2026-09-27T23:59:59.999Z', status: 'OPEN' } }; break
    case 'CommissionSummary': {
      const week = operation.variables.periodFrom !== '2000-01-01'
      value = { agents: { commissionSummary: { calculatedTotal: 9000, effectiveCalculatedTotal: state.effectiveZero ? 0 : week ? -125 : 7000, sportsCommission: 4000, effectiveSportsCommission: state.effectiveZero ? 0 : week ? -100 : 3500, casinoCommission: 4000, effectiveCasinoCommission: state.effectiveZero ? 0 : week ? -50 : 3000, matkaCommission: 1000, effectiveMatkaCommission: state.effectiveZero ? 0 : week ? 25 : 500, paid: 2000, currency: 'INR' } } }; break
    }
    case 'SettlementSummary': value = { agents: { settlementSummary: { netPL: -1000, sharePercentage: 25, settlementDue: 750, lastSettlementDate: '2026-09-20T00:00:00.000Z', lastSettlementAmount: 500, currency: 'INR' } } }; break
    case 'TopPlayers': value = { reporting: { topPlayers: state.empty ? [] : Array.from({ length: 5 }, (_, i) => ({ playerId: `player-${i}`, playerName: ['Asha Sharma', 'Ravi Kumar', 'Mina Singh', 'Dev Patel', 'Sara Ali'][i], username: `player${i}`, totalGGR: i === 1 ? -500 : 1500 + i * 100, totalBets: 25 + i, status: i === 1 ? 'SUSPENDED' : 'ACTIVE', lastBetAt: new Date(Date.now() - 3600000).toISOString() })) } }; break
    case 'SubAgents': value = { agents: { agentTree: state.empty ? [] : Array.from({ length: 14 }, (_, i) => ({ id: `sub-agent-${i}`, username: `Partner ${i + 1}`, schemeType: i % 2 ? 'SHARING' : 'CREDIT', status: i % 3 ? 'ACTIVE' : 'SUSPENDED', allowedDomains: ['sports', 'casino'], createdAt: '2026-01-01T00:00:00.000Z' })) } }; break
    default: throw new Error(`Unexpected AgentHome preview operation: ${operation.operationName}`)
  }
  return { data: complete(definition.selectionSet, value) as Record<string, unknown> }
}
