/** Isolated preview/test data. Never imported by the production application. */
import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'

// The open IST week, with the backend's IST calendar dates of it and of the last closed week.
export const CURRENT_CYCLE = { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'OPEN', fromDate: '2026-10-05', toDate: '2026-10-12', previousFromDate: '2026-09-28', previousToDate: '2026-10-05' }
// The closed, unpaid week a payout is made for (payable = the payee's gross after tally and payouts).
export const CLOSED_CYCLE = { from: '2026-09-27T18:30:00.000Z', to: CURRENT_CYCLE.from, status: 'CLOSED_UNSETTLED', paidAmount: 0, payableAmount: 250.25, calculatedTotal: 250.25, adjustmentAmount: 0, zeroCommission: false, fromDate: '2026-09-28', toDate: '2026-10-05' }
// Adjustments of sub-1: a pending deduction raised against the closed week, an older week's correction applied to it, a cancelled refund.
export const ADJUSTMENT_PENDING = { id: 'adj-pending', agentId: 'sub-1', amount: -25.5, sourceCycleFrom: CLOSED_CYCLE.from, sourceCycleTo: CLOSED_CYCLE.to, targetCycleFrom: null, targetCycleTo: null, reason: 'Void', status: 'PENDING', createdAt: '2026-10-06T05:00:00.000Z', appliedAt: null }
export const ADJUSTMENT_APPLIED = { id: 'adj-applied', agentId: 'sub-1', amount: 40, sourceCycleFrom: '2026-09-20T18:30:00.000Z', sourceCycleTo: CLOSED_CYCLE.from, targetCycleFrom: CLOSED_CYCLE.from, targetCycleTo: CLOSED_CYCLE.to, reason: 'Correction', status: 'APPLIED', createdAt: '2026-10-01T05:00:00.000Z', appliedAt: '2026-10-02T05:00:00.000Z' }
export const ADJUSTMENT_CANCELLED = { id: 'adj-cancelled', agentId: 'sub-1', amount: 10, sourceCycleFrom: '2026-09-20T18:30:00.000Z', sourceCycleTo: CLOSED_CYCLE.from, targetCycleFrom: null, targetCycleTo: null, reason: 'Refund', status: 'CANCELLED', createdAt: '2026-09-30T05:00:00.000Z', appliedAt: null }
// Receivable = grossEffective* (what the agent's payer owes it), Payable = the sub-agents' effective* (each child's gross),
// My Share = netEffective* = Receivable − Payable. The GGR x rate figures (100 / 10 / −10) are deliberately different.
export const SUMMARY = { sportsGGR: 1000, casinoGGR: 200, matkaGGR: -50, directSportsGGR: 100, directCasinoGGR: 50, directMatkaGGR: -10,
  sportsCommissionRate: 0.1, casinoCommissionRate: 0.05, matkaCommissionRate: 0.2,
  sportsCommission: 10, casinoCommission: 20, matkaCommission: -5, currency: 'INR',
  effectiveCalculatedTotal: 25, effectiveSportsCommission: 10, effectiveCasinoCommission: 20, effectiveMatkaCommission: -5,
  grossSportsCommission: 30, grossCasinoCommission: 15, grossMatkaCommission: -5,
  grossEffectiveSportsCommission: 30, grossEffectiveCasinoCommission: 15, grossEffectiveMatkaCommission: -5, grossEffectiveCalculatedTotal: 40,
  netEffectiveSportsCommission: 10, netEffectiveCasinoCommission: 20, netEffectiveMatkaCommission: -5, netEffectiveCalculatedTotal: 25,
  tallyApplied: { enabled: true, domains: ['sports', 'casino'] } }
export const SUB_AGENT = { agentId: 'sub-1', username: 'Partner with a descriptive account name', pendingCommission: 250.25, totalPaid: 90,
  sportsGGR: 200, casinoGGR: -100, matkaGGR: 0, sportsCommission: 20, casinoCommission: -5, matkaCommission: 0,
  effectiveSportsCommission: 20, effectiveCasinoCommission: -5, effectiveMatkaCommission: 0, effectiveCalculatedTotal: 15,
  sportsCommissionRate: 0.1, casinoCommissionRate: 0.05, matkaCommissionRate: 0.2, tallyEnabled: true, tallyDomains: ['sports'], currency: 'INR' }
export const PLAYER = { playerId: 'player-1', playerName: 'Alice', subAgentId: SUB_AGENT.agentId, subAgentUsername: SUB_AGENT.username,
  subAgentSportsRate: 0.1, subAgentCasinoRate: 0.05, subAgentMatkaRate: 0.2,
  sportsGGR: 100, casinoGGR: -20, matkaGGR: 5, sportsCommission: 10, casinoCommission: -2, matkaCommission: 0.5, totalCommission: 8.5 }
export const BETS = [
  { id: 'sports-1', playerId: PLAYER.playerId, playerName: PLAYER.playerName, domain: 'sports', date: '2026-09-29T10:00:00Z', betAmount: 50,
    ggr: 100, commissionRate: 0.1, commissionEarned: 10, currency: 'INR', status: 'lost', side: 'back', odds: 2, eventName: 'Cricket championship', marketName: 'Match winner', selectionName: 'India' },
  { id: 'casino-1', playerId: PLAYER.playerId, playerName: PLAYER.playerName, domain: 'casino', date: '2026-09-30T10:00:00Z', betAmount: 100,
    ggr: -20, commissionRate: 0.1, commissionEarned: -2, currency: 'INR', status: 'won', gameName: 'Roulette', vendorName: 'Live games', payout: 120 },
  { id: 'matka-1', playerId: PLAYER.playerId, playerName: PLAYER.playerName, domain: 'matka', date: '2026-10-01T10:00:00Z', betAmount: 25,
    ggr: 5, commissionRate: 0.1, commissionEarned: 0.5, currency: 'INR', status: 'lost', marketName: 'Morning Market', matkaType: 'single', bidType: 'open', betNumbers: '1', marketSession: 'open', payoutMultiplier: 9, actualWin: 0 },
]

/** Fill omitted fixture fields with null so Apollo receives complete selections. */
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((item) => complete(selection, item))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter((node) => node.kind === 'Field').map((field) => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'CommissionFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export interface CommissionFixtureOptions { ready?: boolean; payableAmount?: number; paySuccess?: boolean; empty?: boolean; noCycles?: boolean; cycles?: Array<Record<string, unknown>>; adjustmentRefused?: boolean; unresolvedAdjustments?: number 
  carry?: { carriedLoss?: number; carryApplied?: number; lossThisCycle?: number }
  openBets?: number; previousCycleOpenBets?: number
}
export function commissionResponse(operation: Operation, options: CommissionFixtureOptions = {}): FetchResult {
  let result: Record<string, unknown>
  switch (operation.operationName) {
    case 'CurrentCommissionCycle': result = { currentCommissionCycle: CURRENT_CYCLE }; break
    case 'CommissionSummary': result = { agents: { commissionSummary: { ...SUMMARY, ...options.carry } } }; break
    case 'SubAgentCommissionSummaries': result = { subAgentCommissionSummaries: options.empty ? [] : [SUB_AGENT] }; break
    case 'DirectPlayerCommissionSummaries': result = { agents: { directPlayerCommissionSummaries: options.empty ? [] : [PLAYER] } }; break
    case 'CommissionCyclesForAgent': result = { commissionCyclesForAgent: options.cycles ?? (options.noCycles ? [] : [CLOSED_CYCLE, { ...CURRENT_CYCLE, paidAmount: 0 }]) }; break
    case 'CommissionCycleReadiness': {
      // A pending adjustment raised against the week blocks it (UNRESOLVED_ADJUSTMENT), whatever else is set.
      const unresolved = options.unresolvedAdjustments ?? 0
      result = { commissionCycleReadiness: {
        ready: unresolved > 0 ? false : options.ready ?? true, payableAmount: options.payableAmount ?? 250.25, currency: 'INR',
        reasons: unresolved > 0 ? ['UNRESOLVED_ADJUSTMENT'] : options.ready === false ? ['MISSING_BETS'] : ['LEDGER_GAP'],
        openBets: options.ready === false ? (options.openBets ?? 2) : 0, unresolvedAdjustments: unresolved, previousCycleOpenBets: options.previousCycleOpenBets ?? 0,
      } }; break
    }
    case 'CommissionHistory': {
      const entries = options.empty ? [] : BETS.filter((bet) => !operation.variables.domain || bet.domain === operation.variables.domain)
      result = { agents: { commissionHistory: { entries, total: entries.length } } }; break
    }
    case 'PayCommission': result = { payCommission: { success: options.paySuccess ?? true, message: options.paySuccess === false ? 'Payment refused' : 'Commission paid successfully', payout: null } }; break
    case 'CommissionAdjustmentsPage':
    case 'CommissionAdjustments': result = { commissionAdjustments: [ADJUSTMENT_PENDING, ADJUSTMENT_APPLIED, ADJUSTMENT_CANCELLED] }; break
    case 'CreateCommissionAdjustment': result = { createCommissionAdjustment: { success: !options.adjustmentRefused, message: options.adjustmentRefused ? 'Adjustment refused' : 'Adjustment created; apply to a cycle to affect payable', adjustment: null } }; break
    case 'ApplyCommissionAdjustment': result = { applyCommissionAdjustment: { success: !options.adjustmentRefused, message: options.adjustmentRefused ? 'Cannot adjust an already-paid cycle' : 'Adjustment applied to cycle', adjustment: null } }; break
    case 'CancelCommissionAdjustment': result = { cancelCommissionAdjustment: { success: !options.adjustmentRefused, message: options.adjustmentRefused ? 'Only a PENDING adjustment can be cancelled (this one is APPLIED)' : 'Adjustment cancelled', adjustment: null } }; break
    default: throw new Error(`Unexpected commission operation: ${operation.operationName}`)
  }
  if (operation.operationName === 'CommissionAdjustmentsPage') { const all = (result.commissionAdjustments ?? []) as unknown[]; result.commissionAdjustmentsPage = { items: all.slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)), total: all.length }; }
  const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing operation')
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
