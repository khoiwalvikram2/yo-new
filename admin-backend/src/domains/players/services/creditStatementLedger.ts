import { roundMoney, type CreditStatementEntry } from './creditStatement.js'

/**
 * agent_credit_ledger rows as the credit statement reads them, and how each
 * becomes a statement row (spec 2026-10-22 §1).
 *
 *   SETTLEMENT          ADJUSTMENT to the player whose reason starts with
 *                       "Player credit settlement:" (SETTLE in adjustPlayerCredit).
 *                       amount = −(balance settled): the running balance returns to 0.
 *   LIMIT_CHANGE        CREDIT_LIMIT_ADJUSTMENT, and the WHITELABEL_CREDIT limit moves
 *                       CreditService writes as DEPOSIT (to the player), WITHDRAWAL
 *                       (from the player) and non-settlement ADJUSTMENT; balance
 *                       before/after is the limit in all of them.
 *   CREDIT_USED_CHANGE  CREDIT_USED_INCREASE (+) / CREDIT_USED_DECREASE (−).
 *   ALLOCATION          the credit given at creation.
 * Everything else (USAGE, RELEASE, TRANSFER, agent-side rows) is not a statement row.
 */

export interface CreditLedgerSourceRow {
  id: string
  transactionType: string
  fromEntityType: string
  fromEntityId: string
  toEntityType: string
  toEntityId: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  reason: string | null
  metadata: unknown
  createdAt: Date
}

/** The start of every SETTLE ledger row's reason: `Player credit settlement: ${total} → 0`. */
export const SETTLEMENT_REASON_PREFIX = 'Player credit settlement:'

/** The ledger types that can become a statement row; the repo's SQL reads only these. */
export const STATEMENT_LEDGER_TYPES = [
  'ALLOCATION',
  'DEPOSIT',
  'WITHDRAWAL',
  'ADJUSTMENT',
  'CREDIT_LIMIT_ADJUSTMENT',
  'CREDIT_USED_INCREASE',
  'CREDIT_USED_DECREASE',
] as const

export function isSettlementLedgerRow(row: Pick<CreditLedgerSourceRow, 'transactionType' | 'reason'>): boolean {
  return row.transactionType === 'ADJUSTMENT' && typeof row.reason === 'string' && row.reason.startsWith(SETTLEMENT_REASON_PREFIX)
}

function metadataOf(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

/**
 * The settlement balance a SETTLE row cleared, in the player's P&L sign:
 * metadata.settlementBalanceBefore first, else the number in the reason.
 * Null when neither can be read.
 */
export function settledBalanceOf(row: Pick<CreditLedgerSourceRow, 'reason' | 'metadata'>): number | null {
  const raw = metadataOf(row.metadata)?.settlementBalanceBefore
  if (raw !== undefined && raw !== null && raw !== '') {
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  const match = /^Player credit settlement:\s*(-?\d+(?:\.\d+)?)/.exec(row.reason ?? '')
  return match ? Number(match[1]) : null
}

export function ledgerRowToEntry(row: CreditLedgerSourceRow, playerId: string): CreditStatementEntry | null {
  const toPlayer = row.toEntityType === 'player' && row.toEntityId === playerId
  const fromPlayer = row.fromEntityType === 'player' && row.fromEntityId === playerId
  const base = { id: `ledger:${row.id}`, occurredAt: row.createdAt, domain: null, reference: null, details: row.reason }
  const limitChange = (): CreditStatementEntry => ({
    ...base,
    type: 'LIMIT_CHANGE',
    amount: roundMoney(row.balanceAfter - row.balanceBefore),
    valueBefore: row.balanceBefore,
    valueAfter: row.balanceAfter,
  })

  switch (row.transactionType) {
    case 'ADJUSTMENT': {
      if (!toPlayer) return null
      if (!isSettlementLedgerRow(row)) return limitChange()
      const settled = settledBalanceOf(row)
      if (settled === null) return null
      return { ...base, type: 'SETTLEMENT', reference: 'Settlement', amount: roundMoney(-settled), valueBefore: settled, valueAfter: 0 }
    }
    case 'CREDIT_LIMIT_ADJUSTMENT':
    case 'DEPOSIT':
      return toPlayer ? limitChange() : null
    case 'WITHDRAWAL':
      return fromPlayer ? limitChange() : null
    case 'CREDIT_USED_INCREASE':
      return toPlayer
        ? { ...base, type: 'CREDIT_USED_CHANGE', amount: roundMoney(row.amount), valueBefore: row.balanceBefore, valueAfter: row.balanceAfter }
        : null
    case 'CREDIT_USED_DECREASE':
      return toPlayer
        ? { ...base, type: 'CREDIT_USED_CHANGE', amount: roundMoney(-row.amount), valueBefore: row.balanceBefore, valueAfter: row.balanceAfter }
        : null
    case 'ALLOCATION':
      return toPlayer ? { ...base, type: 'ALLOCATION', amount: roundMoney(row.amount), valueBefore: null, valueAfter: null } : null
    default:
      return null
  }
}
