/* The logic of /credit, the admin's Chips page (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
   §8): the whitelabel pool's figures, its root accounts on chips and the pool's own statement. Kept React-free
   so each rule is unit-tested and the components only compose the kit and the chips module. */

export type ChipsPageTab = 'downline' | 'statement'

export interface ChipsPageTabOption {
  value: ChipsPageTab
  label: string
}

/* The root accounts first: that is where the admin deposits and withdraws; the pool's statement second. */
export const CHIPS_PAGE_TABS: readonly ChipsPageTabOption[] = [
  { value: 'downline', label: 'Root accounts' },
  { value: 'statement', label: 'Pool statement' },
]

export const POOL_STATEMENT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
export const POOL_STATEMENT_DEFAULT_PAGE_SIZE = 20

/** One row of the whitelabel pool's ledger (Query.myWhitelabelCreditHistory). */
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

/* The legacy role-name test that lets a whitelabel admin past the page without the RBAC guard. It lives with the
   page's whole access rule (canOpenChipsPage) in shared/core, which the sidebar link reads too (T068). */
export { isWhitelabelAdminRole } from '@/shared/core/chipsPageAccess'

/* ---------- the pool statement ---------- */

/*
 * The pool's ledger records every movement of its free chips, and its before/after are the pool's available
 * figure. A deposit of chips to a root account takes them out of the pool (USAGE; older WHITELABEL_CREDIT
 * deposits wrote DEPOSIT), a withdrawal brings them back (RELEASE), and the super admin tops the pool up
 * (ALLOCATION) or corrects it (ADJUSTMENT).
 */
const POOL_MOVEMENT_LABELS: Record<string, string> = {
  USAGE: 'Chips out',
  DEPOSIT: 'Chips out',
  RELEASE: 'Chips in',
  ALLOCATION: 'Pool top-up',
  ADJUSTMENT: 'Pool adjustment',
}

export function poolMovementLabel(transactionType: string): string {
  const label = POOL_MOVEMENT_LABELS[transactionType]
  if (label) return label
  const words = transactionType.toLowerCase().replace(/_/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Movement'
}

/**
 * Whether a movement added free chips to the pool: a top-up and a withdrawal from a root account do; an
 * adjustment does when the pool's available figure went up; everything else took chips out.
 */
export function isPoolInflow(
  transaction: Pick<WhitelabelCreditTransaction, 'transactionType' | 'balanceBefore' | 'balanceAfter'>,
): boolean {
  if (transaction.transactionType === 'ALLOCATION' || transaction.transactionType === 'RELEASE') return true
  if (transaction.transactionType === 'ADJUSTMENT') return transaction.balanceAfter > transaction.balanceBefore
  return false
}

/** The movement signed from the pool's side: + chips in, − chips out. */
export function poolSignedAmount(
  transaction: Pick<WhitelabelCreditTransaction, 'transactionType' | 'amount' | 'balanceBefore' | 'balanceAfter'>,
): number {
  const magnitude = Math.abs(Number(transaction.amount) || 0)
  return isPoolInflow(transaction) ? magnitude : -magnitude
}

export interface PoolStatementPlayerLink {
  to: string
  label: string
}

/** A profile link when the row names a player (older WHITELABEL_CREDIT rows): its username, else its phone. */
export function poolStatementPlayerLink(
  transaction: Pick<WhitelabelCreditTransaction, 'playerId' | 'playerUsername' | 'playerPhone'>,
): PoolStatementPlayerLink | null {
  if (transaction.playerId == null || String(transaction.playerId).trim() === '') return null
  const username = transaction.playerUsername?.trim()
  const phone = transaction.playerPhone != null ? String(transaction.playerPhone).trim() : ''
  return {
    to: `/players/profile/${transaction.playerId}`,
    label: username || phone || 'View player',
  }
}

/** The card subtitle: a count on a short first page, otherwise the page and its row count. */
export function poolStatementSub(page: number, pageSize: number, rowCount: number): string {
  return page === 1 && rowCount < pageSize
    ? `${rowCount} ${rowCount === 1 ? 'movement' : 'movements'}`
    : `Page ${page} • ${Math.min(rowCount, pageSize)} rows`
}

export interface PoolStatementRange {
  /** "21–40": the rows on screen. */
  range: string
  /** One extra server row confirms that another page exists. */
  more: boolean
}

/* The pool's ledger answers one page and no total, so each page asks for one row more than it shows. */
export function poolStatementRange(page: number, pageSize: number, rowCount: number): PoolStatementRange {
  const offset = (page - 1) * pageSize
  return {
    range: `${offset + 1}–${offset + Math.min(rowCount, pageSize)}`,
    more: rowCount > pageSize,
  }
}

/** Next is offered only when a lookahead row confirms more records. */
export function poolStatementHasNextPage(rowCount: number, pageSize: number): boolean {
  return rowCount > pageSize
}
