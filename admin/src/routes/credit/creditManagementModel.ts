import type { StatusPillTone } from '@/ui/components/StatusPill'

/* The logic of /credit (Credit Management) that the legacy page computed inline, kept React-free so
   it is unit-tested and the components only compose the kit. Every rule here is the legacy rule,
   moved verbatim from routes/credit/CreditManagementPage.tsx (task 106 pre-image); the tones are the
   only new thing, because the kit draws a status as a semantic pill rather than an antd colour. */

export type CreditTab = 'overview' | 'history' | 'settlements'

export interface CreditTabOption {
  value: CreditTab
  label: string
}

/* The legacy segmented control's three options, in order. `history` is labelled "Adjustments". */
export const CREDIT_TABS: readonly CreditTabOption[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'history', label: 'Adjustments' },
  { value: 'settlements', label: 'Settlements' },
]

export const CREDIT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const CREDIT_DEFAULT_PAGE_SIZE = 20

export interface WhitelabelCredit {
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  creditAlertThreshold: number
  usagePercentage?: number | null
  isNearLimit: boolean
}

export interface WhitelabelCreditTransaction {
  id: string
  transactionType: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  reason?: string | null
  createdBy?: string | null
  createdByType?: string | null
  createdAt: string
  playerId?: number | string | null
  playerName?: string | null
  playerEmail?: string | null
  playerUsername?: string | null
  playerPhone?: string | number | null
}

export interface AgentSettlement {
  id: string
  tenant?: string | null
  agentId: string
  agent?: {
    id: string
    username?: string | null
    schemeType?: string | null
  } | null
  settlementType: string
  amount: number
  direction: string
  previousBalance?: number | null
  newBalance?: number | null
  notes?: string | null
  settledBy?: string | null
  createdAt: string
}

export interface WhitelabelSettlementSummary {
  agentCount?: number
  whitelabelCount?: number
  agentSettlements: AgentSettlement[]
  whitelabelSettlements: WhitelabelCreditTransaction[]
  totalAgentSettled: number
  totalWhitelabelSettled: number
}

/** The legacy role-name test that lets a whitelabel admin past the page without the RBAC guard. */
export function isWhitelabelAdminRole(roles: readonly string[]): boolean {
  return roles.some(role =>
    role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel')
  )
}

/* ---------- overview ---------- */

export type CreditUsageLevel = 'critical' | 'warning' | 'healthy'

export interface CreditUsageStatus {
  level: CreditUsageLevel
  /** The legacy badge text. */
  label: 'Critical' | 'Warning' | 'Healthy'
  /** The banner's kit Notice tone. */
  noticeTone: 'error' | 'warn' | 'ok'
  /** The usage pill and the "% used" figure. */
  pillTone: Extract<StatusPillTone, 'neg' | 'warn' | 'ok'>
  /** The kit Meter has no green tone; a healthy bar takes the accent, as every mockup bar does (M:1091). */
  meterTone: 'neg' | 'warn' | 'acc'
}

const CRITICAL: CreditUsageStatus = {
  level: 'critical',
  label: 'Critical',
  noticeTone: 'error',
  pillTone: 'neg',
  meterTone: 'neg',
}

const WARNING: CreditUsageStatus = {
  level: 'warning',
  label: 'Warning',
  noticeTone: 'warn',
  pillTone: 'warn',
  meterTone: 'warn',
}

const HEALTHY: CreditUsageStatus = {
  level: 'healthy',
  label: 'Healthy',
  noticeTone: 'ok',
  pillTone: 'ok',
  meterTone: 'acc',
}

/** Legacy `getStatus`: 90% and above is critical whatever the threshold; the alert threshold is a warning. */
export function getCreditUsageStatus(percentage: number, threshold: number): CreditUsageStatus {
  if (percentage >= 90) return CRITICAL
  if (percentage >= threshold) return WARNING
  return HEALTHY
}

export interface CreditUsageFigures {
  usagePercentage: number
  availablePercentage: number
}

/** A missing or zero usage reads as 0, and the remainder is `100 - usage`, both as the legacy page did. */
export function creditUsageFigures(credit: Pick<WhitelabelCredit, 'usagePercentage'>): CreditUsageFigures {
  const usagePercentage = credit.usagePercentage || 0
  return { usagePercentage, availablePercentage: 100 - usagePercentage }
}

/** One decimal place, as every legacy percentage on the page was printed. */
export function formatCreditPercent(value: number): string {
  return value.toFixed(1)
}

/* ---------- adjustments (credit history) ---------- */

/** RELEASE is shown as WITHDRAW; every other type is shown as the server spells it. */
export function historyTypeLabel(transactionType: string): string {
  return transactionType === 'RELEASE' ? 'WITHDRAW' : transactionType
}

/* The legacy tag colours were green, orange, purple and cyan. The kit pill has semantic tones only,
   so each colour takes its nearest tone; the label still carries the meaning. */
export function historyTypeTone(transactionType: string): StatusPillTone {
  if (transactionType === 'DEPOSIT') return 'ok'
  if (transactionType === 'RELEASE') return 'warn'
  if (transactionType === 'USAGE') return 'neutral'
  return 'info'
}

const POSITIVE_HISTORY_TYPES = ['ALLOCATION', 'RELEASE']

/** Allocations and releases add credit; an adjustment adds credit only when the balance went up. */
export function isPositiveHistoryAmount(
  transaction: Pick<WhitelabelCreditTransaction, 'transactionType' | 'balanceBefore' | 'balanceAfter'>,
): boolean {
  return POSITIVE_HISTORY_TYPES.includes(transaction.transactionType)
    || (transaction.transactionType === 'ADJUSTMENT' && transaction.balanceAfter > transaction.balanceBefore)
}

export interface HistoryPlayerLink {
  to: string
  label: string
}

/** A profile link only when the row names a player; its text is the trimmed phone, else "View profile". */
export function historyPlayerLink(
  transaction: Pick<WhitelabelCreditTransaction, 'playerId' | 'playerPhone'>,
): HistoryPlayerLink | null {
  if (transaction.playerId == null) return null
  return {
    to: `/players/profile/${transaction.playerId}`,
    label: (transaction.playerPhone != null && String(transaction.playerPhone).trim())
      ? String(transaction.playerPhone).trim()
      : 'View profile',
  }
}

/** The card subtitle: a count on a short first page, otherwise the page and its row count. */
export function historyCardSub(page: number, pageSize: number, rowCount: number): string {
  return page === 1 && rowCount < pageSize
    ? `${rowCount} ${rowCount === 1 ? 'transaction' : 'transactions'}`
    : `Page ${page} • ${Math.min(rowCount, pageSize)} rows`
}

export interface HistoryRange {
  /** "21–40", the legacy "Showing" range. */
  range: string
  /** One extra server row confirms that another page exists. */
  more: boolean
}

export function historyRange(page: number, pageSize: number, rowCount: number): HistoryRange {
  const offset = (page - 1) * pageSize
  return {
    range: `${offset + 1}–${offset + Math.min(rowCount, pageSize)}`,
    more: rowCount > pageSize,
  }
}

/** Next is offered only when a lookahead row confirms more records. */
export function historyHasNextPage(rowCount: number, pageSize: number): boolean {
  return rowCount > pageSize
}

/* ---------- settlements ---------- */

/** The legacy client-side page of a settlement list (see the record: the server already pages it). */
export function sliceSettlementPage<T>(rows: readonly T[] | null | undefined, page: number, pageSize: number): T[] {
  if (!rows) return []
  const start = (page - 1) * pageSize
  const end = start + pageSize
  return rows.slice(start, end)
}

export function recordCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`
}

/** The agent's username, else the first eight characters of its id and an ellipsis. */
export function settlementAgentLabel(settlement: Pick<AgentSettlement, 'agent' | 'agentId'>): string {
  return settlement.agent?.username || settlement.agentId.slice(0, 8) + '...'
}

/* Legacy scheme tags: CREDIT blue, SHARING green, anything else orange. */
export function schemeTone(schemeType: string): StatusPillTone {
  if (schemeType === 'CREDIT') return 'info'
  if (schemeType === 'SHARING') return 'ok'
  return 'warn'
}

export function isToAgent(direction: string): boolean {
  return direction === 'TO_AGENT'
}

export function settlementDirectionLabel(direction: string): string {
  return isToAgent(direction) ? 'To Agent' : 'From Agent'
}

/** A whitelabel settlement shows "+" before a zero or positive amount and no sign of its own otherwise. */
export function whitelabelSettlementSign(amount: number): '+' | '' {
  return amount >= 0 ? '+' : ''
}
