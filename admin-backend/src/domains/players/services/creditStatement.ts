/**
 * The credit player statement's maths, with no I/O (spec 2026-10-22 §1).
 *
 * Money rows (BET_SETTLED, SETTLEMENT) move the player's settlement balance and
 * carry `balanceAfter`; informational rows (LIMIT_CHANGE, CREDIT_USED_CHANGE,
 * ALLOCATION) never do. Every amount is in the player's P&L sign — positive =
 * the player won — the sign users.settlement_balance uses.
 *
 * The opening balance is derived backwards from today's balance:
 *   closing = current settlement_balance − Σ money movement after the range
 *   opening = closing − Σ money movement inside the range
 * and the rows are then walked forward from the opening balance.
 */

export type CreditStatementDomain = 'sports' | 'casino' | 'matka'
export type CreditStatementRowType = 'BET_SETTLED' | 'SETTLEMENT' | 'LIMIT_CHANGE' | 'CREDIT_USED_CHANGE' | 'ALLOCATION'

export interface CreditStatementEntry {
  /** Unique across sources: `sports:<bet id>`, `casino:<bet id>`, `matka:<bet id>`, `ledger:<ledger id>`. */
  id: string
  type: CreditStatementRowType
  occurredAt: Date
  domain: CreditStatementDomain | null
  /** Event, game or market name; 'Settlement' on a settlement. */
  reference: string | null
  details: string | null
  /**
   * Money rows: the change to the settlement balance.
   * LIMIT_CHANGE: new − old limit. CREDIT_USED_CHANGE: + increase / − decrease.
   * ALLOCATION: the credit given.
   */
  amount: number
  /**
   * LIMIT_CHANGE: the limit before/after. CREDIT_USED_CHANGE: credit available
   * before/after, as the ledger recorded it. SETTLEMENT: the balance settled and 0.
   */
  valueBefore: number | null
  valueAfter: number | null
}

export interface CreditStatementRow extends CreditStatementEntry {
  affectsBalance: boolean
  /** The settlement balance after this row; null on informational rows. */
  balanceAfter: number | null
}

export interface CreditStatementTotals {
  totalWon: number
  totalLost: number
  netResult: number
  settlementsTotal: number
  settlementCount: number
  betCount: number
}

export interface CreditStatementResult {
  openingBalance: number
  closingBalance: number
  totals: CreditStatementTotals
  /** One page, newest first. */
  rows: CreditStatementRow[]
  /** Every row in the range. */
  totalRows: number
}

export interface BuildCreditStatementInput {
  /** Rows in [dateFrom, dateTo], any order. Anything outside the range is ignored. */
  entries: readonly CreditStatementEntry[]
  /** users.settlement_balance now. */
  currentBalance: number
  /** Σ money movement after dateTo up to now (settled bets and settlements). */
  movementAfterRange: number
  dateFrom: Date
  dateTo: Date
  limit: number
  offset: number
}

export const STATEMENT_DEFAULT_LIMIT = 200
export const STATEMENT_MAX_LIMIT = 1000

export function isMoneyRow(type: CreditStatementRowType): boolean {
  return type === 'BET_SETTLED' || type === 'SETTLEMENT'
}

/**
 * Rounds to the cent, half away from zero, and never returns −0. Sums of many
 * two-decimal amounts drift in binary floating point; every figure the
 * statement returns goes through here.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  const cents = Math.round(Math.abs(value) * 100 + 1e-6)
  if (cents === 0) return 0
  return (value < 0 ? -cents : cents) / 100
}

/** limit defaults to 200 and is clamped to 1000; offset defaults to 0. */
export function normalizeStatementPaging(limit: unknown, offset: unknown): { limit: number; offset: number } {
  let normalizedLimit = STATEMENT_DEFAULT_LIMIT
  if (limit !== undefined && limit !== null) {
    const n = Number(limit)
    if (!Number.isInteger(n) || n < 1) throw new Error('limit must be a positive integer')
    normalizedLimit = Math.min(n, STATEMENT_MAX_LIMIT)
  }
  let normalizedOffset = 0
  if (offset !== undefined && offset !== null) {
    const n = Number(offset)
    if (!Number.isInteger(n) || n < 0) throw new Error('offset must be a non-negative integer')
    normalizedOffset = n
  }
  return { limit: normalizedLimit, offset: normalizedOffset }
}

/** Oldest first; rows at the same instant by id, so a balance never swaps between two reads. */
function chronological(a: CreditStatementEntry, b: CreditStatementEntry): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime()
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function buildCreditStatement(input: BuildCreditStatementInput): CreditStatementResult {
  const from = input.dateFrom.getTime()
  const to = input.dateTo.getTime()
  const inRange = input.entries
    .filter((entry) => {
      const t = entry.occurredAt.getTime()
      return t >= from && t <= to
    })
    .sort(chronological)

  let rangeMovement = 0
  for (const entry of inRange) {
    if (isMoneyRow(entry.type)) rangeMovement += entry.amount
  }
  const closingBalance = roundMoney(input.currentBalance - input.movementAfterRange)
  const openingBalance = roundMoney(closingBalance - rangeMovement)

  let running = openingBalance
  let totalWon = 0
  let totalLost = 0
  let settlementsTotal = 0
  let settlementCount = 0
  let betCount = 0
  const walked: CreditStatementRow[] = inRange.map((entry) => {
    if (!isMoneyRow(entry.type)) return { ...entry, affectsBalance: false, balanceAfter: null }
    running = roundMoney(running + entry.amount)
    if (entry.type === 'BET_SETTLED') {
      betCount++
      if (entry.amount > 0) totalWon += entry.amount
      else totalLost += -entry.amount
    } else {
      settlementCount++
      settlementsTotal += entry.amount
    }
    return { ...entry, affectsBalance: true, balanceAfter: running }
  })

  const newestFirst = walked.reverse()
  return {
    openingBalance,
    closingBalance,
    totals: {
      totalWon: roundMoney(totalWon),
      totalLost: roundMoney(totalLost),
      netResult: roundMoney(totalWon - totalLost),
      settlementsTotal: roundMoney(settlementsTotal),
      settlementCount,
      betCount,
    },
    rows: newestFirst.slice(input.offset, input.offset + input.limit),
    totalRows: newestFirst.length,
  }
}
