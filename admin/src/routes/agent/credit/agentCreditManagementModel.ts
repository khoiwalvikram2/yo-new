import type { StatusPillTone } from '@/ui/components/StatusPill'

export type AgentCreditTab = 'overview' | 'history' | 'settlements'

export const AGENT_CREDIT_TABS: readonly { value: AgentCreditTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'history', label: 'Adjustments' },
  { value: 'settlements', label: 'Settlements' },
]

export const AGENT_CREDIT_PAGE_SIZE = 20

export interface AgentLike {
  schemeType?: string | null
}

export type AgentCreditAccess = 'unauthenticated' | 'denied' | 'allowed'

export function agentCreditAccess(agent?: AgentLike | null): AgentCreditAccess {
  if (!agent) return 'unauthenticated'
  return agent.schemeType === 'CREDIT' ? 'allowed' : 'denied'
}

export interface AgentCredit {
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  creditAlertThreshold: number
  settlementBalance?: number | null
  settlementBalanceSports?: number | null
  settlementBalanceCasino?: number | null
  settlementBalanceMatka?: number | null
  usagePercentage?: number | null
  isNearLimit: boolean
}

export interface AgentCreditTransaction {
  id: string
  transactionType: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  reason?: string | null
  createdBy?: string | null
  createdByType?: string | null
  createdAt: string
}

export interface AgentSettlement {
  id: string
  tenant: string
  agentId: string
  settlementType: string
  amount: number
  direction: string
  previousBalance?: number | null
  newBalance?: number | null
  notes?: string | null
  settledBy?: string | null
  createdAt: string
}

export interface AgentSettlementSummary {
  agentSettlements: AgentSettlement[]
  creditTransactions: AgentCreditTransaction[]
  totalAgentSettled: number
  totalCreditTransactions: number
}

export type AgentCreditLevel = 'critical' | 'warning' | 'healthy'

export interface AgentCreditStatus {
  level: AgentCreditLevel
  label: 'Critical' | 'Warning' | 'Healthy'
  noticeTone: 'error' | 'warn' | 'ok'
  pillTone: Extract<StatusPillTone, 'neg' | 'warn' | 'ok'>
  meterTone: 'neg' | 'warn' | 'acc'
}

export function agentCreditStatus(percentage: number, threshold: number): AgentCreditStatus {
  if (percentage >= 90) {
    return { level: 'critical', label: 'Critical', noticeTone: 'error', pillTone: 'neg', meterTone: 'neg' }
  }
  if (percentage >= threshold) {
    return { level: 'warning', label: 'Warning', noticeTone: 'warn', pillTone: 'warn', meterTone: 'warn' }
  }
  return { level: 'healthy', label: 'Healthy', noticeTone: 'ok', pillTone: 'ok', meterTone: 'acc' }
}

export function agentCreditUsage(credit: Pick<AgentCredit, 'usagePercentage'>) {
  const used = credit.usagePercentage || 0
  return { used, available: 100 - used }
}

export function formatAgentCreditPercent(value: number): string {
  return value.toFixed(1)
}

export function transactionAmountTone(amount: number): 'positive' | 'negative' {
  return amount >= 0 ? 'positive' : 'negative'
}

export function transactionTypeTone(): StatusPillTone {
  return 'info'
}

export function isSettlementToAgent(direction: string): boolean {
  return direction === 'TO_AGENT'
}

export function settlementDirectionLabel(direction: string): string {
  return isSettlementToAgent(direction) ? 'To Agent' : 'From Agent'
}

export function pageSummary(page: number, pageSize: number, rowCount: number): string {
  if (page === 1 && rowCount < pageSize) return `${rowCount} ${rowCount === 1 ? 'record' : 'records'}`
  return `Page ${page} • ${rowCount} rows`
}

export function pageRange(page: number, pageSize: number, rowCount: number): string {
  const first = (page - 1) * pageSize + 1
  return rowCount > 0 ? `${first}–${first + rowCount - 1}` : '0'
}

export function canLoadNextPage(rowCount: number, pageSize: number): boolean {
  return rowCount >= pageSize
}
