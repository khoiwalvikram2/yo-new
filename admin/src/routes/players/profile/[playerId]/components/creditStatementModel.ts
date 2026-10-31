import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

/* The Credit Statement tab's logic without React: who sees the tab, what each amount means in words,
   and the CSV. Signs follow the backend (Query.playerCreditStatement): positive = the player won, the
   sign of users.settlement_balance. Money rows are coloured by sign; informational rows are worded only. */

export type CreditStatementRowType = 'BET_SETTLED' | 'SETTLEMENT' | 'LIMIT_CHANGE' | 'CREDIT_USED_CHANGE' | 'ALLOCATION'

export interface CreditStatementRowData {
  id: string
  type: CreditStatementRowType
  occurredAt: string
  domain?: string | null
  reference?: string | null
  details?: string | null
  amount: number
  affectsBalance: boolean
  balanceAfter?: number | null
  valueBefore?: number | null
  valueAfter?: number | null
}

export interface CreditStatementSummaryData {
  creditLimit: number
  creditUsed: number
  creditAvailable: number
  settlementBalance: number
  settlementBalanceSports: number
  settlementBalanceCasino: number
  settlementBalanceMatka: number
}

export interface CreditStatementTotalsData {
  totalWon: number
  totalLost: number
  netResult: number
  settlementsTotal: number
  settlementCount: number
  betCount: number
}

export interface CreditStatementData {
  playerId: string
  playerType: string
  dateFrom: string
  dateTo: string
  summary: CreditStatementSummaryData
  openingBalance: number
  closingBalance: number
  totals: CreditStatementTotalsData
  rows: CreditStatementRowData[]
  totalRows: number
  limit: number
  offset: number
}

export const CREDIT_PLAYER_TYPES: readonly string[] = ['AGENT_CREDIT', 'WHITELABEL_CREDIT']
export const CREDIT_STATEMENT_PAGE_SIZES: readonly number[] = [50, 100, 200, 500, 1000]
export const CREDIT_STATEMENT_DEFAULT_PAGE_SIZE = 200

export function isCreditPlayerType(playerType: string | null | undefined): boolean {
  return CREDIT_PLAYER_TYPES.includes(playerType ?? '')
}

/** Both credit types; admins need players.credit:view, agents only ever reach their own players' profiles. */
export function showCreditStatementTab(input: {
  playerType?: string | null
  isAgent: boolean
  permissions?: Parameters<typeof hasPermissionWithNested>[0]
}): boolean {
  if (!isCreditPlayerType(input.playerType)) return false
  return input.isAgent || hasPermissionWithNested(input.permissions, 'players.credit', 'view')
}

const TYPE_LABELS: Record<CreditStatementRowType, string> = {
  BET_SETTLED: 'Bet settled',
  SETTLEMENT: 'Settlement',
  LIMIT_CHANGE: 'Limit change',
  CREDIT_USED_CHANGE: 'Credit used change',
  ALLOCATION: 'Credit given',
}

export function creditStatementTypeLabel(type: string): string {
  return TYPE_LABELS[type as CreditStatementRowType] ?? type
}

const DOMAIN_LABELS: Record<string, string> = { sports: 'Sports', casino: 'Casino', matka: 'Matka' }

export function domainLabel(domain: string | null | undefined): string {
  if (!domain) return ''
  return DOMAIN_LABELS[domain] ?? domain
}

export type AmountTone = 'positive' | 'negative' | 'neutral'

export interface SignedAmount {
  sign: '+' | '−' | ''
  magnitude: number
  tone: AmountTone
  word: string
}

function signOf(value: number): SignedAmount['sign'] {
  return value > 0 ? '+' : value < 0 ? '−' : ''
}

function toneOf(value: number): AmountTone {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
}

/** What a row's amount means. Money rows are coloured by sign; informational rows stay neutral. */
export function rowAmountMeaning(row: { type: string; amount: number }): SignedAmount {
  const { amount } = row
  const base = { sign: signOf(amount), magnitude: Math.abs(amount) }
  switch (row.type) {
    case 'BET_SETTLED':
      return { ...base, tone: toneOf(amount), word: amount > 0 ? 'Player won' : amount < 0 ? 'Player lost' : 'Level' }
    case 'SETTLEMENT':
      return { ...base, tone: toneOf(amount), word: amount < 0 ? 'Paid to player' : amount > 0 ? 'Collected from player' : 'Settled' }
    case 'LIMIT_CHANGE':
      return { ...base, tone: 'neutral', word: amount > 0 ? 'Limit raised' : amount < 0 ? 'Limit lowered' : 'Limit unchanged' }
    case 'CREDIT_USED_CHANGE':
      return { ...base, tone: 'neutral', word: amount > 0 ? 'Credit used increased' : amount < 0 ? 'Credit used decreased' : 'Credit used unchanged' }
    case 'ALLOCATION':
      return { ...base, tone: 'neutral', word: 'Credit given' }
    default:
      return { ...base, tone: 'neutral', word: '' }
  }
}

/** A settlement balance: positive = owed to the player, negative = owed by the player. */
export function balanceMeaning(balance: number): SignedAmount {
  return {
    sign: signOf(balance),
    magnitude: Math.abs(balance),
    tone: toneOf(balance),
    word: balance > 0 ? 'Pay to player' : balance < 0 ? 'Collect from player' : 'Settled',
  }
}

export const CREDIT_STATEMENT_CSV_HEADER = ['Date', 'Type', 'Domain', 'Reference', 'Details', 'Amount', 'Meaning', 'Balance after', 'Before', 'After'] as const

/** Text that a spreadsheet would run as a formula gets a leading apostrophe. */
const FORMULA_START = /^[=+\-@\t\r]/

function csvText(value: string | null | undefined): string {
  const text = value ?? ''
  return FORMULA_START.test(text) ? `'${text}` : text
}

function csvMoney(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : value.toFixed(2)
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The loaded rows as CSV: ISO dates, signed plain numbers, the meaning in words. */
export function creditStatementCsv(rows: readonly CreditStatementRowData[]): string {
  const lines = rows.map((row) => [
    row.occurredAt,
    creditStatementTypeLabel(row.type),
    domainLabel(row.domain),
    csvText(row.reference),
    csvText(row.details),
    csvMoney(row.amount),
    rowAmountMeaning(row).word,
    csvMoney(row.balanceAfter),
    csvMoney(row.valueBefore),
    csvMoney(row.valueAfter),
  ])
  return [[...CREDIT_STATEMENT_CSV_HEADER], ...lines].map((cells) => cells.map(quote).join(',')).join('\n')
}
