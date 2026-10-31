import { walletLedger } from '../db/schema.js'

export type WalletLedgerWalletType = 'cash' | 'bonus' | 'referralBonus' | 'referralBalance'
export type WalletLedgerDirection = 'credit' | 'debit'

export interface CreateWalletLedgerEntryParams {
  tenant: string
  walletId: number
  userId: number
  walletType: WalletLedgerWalletType
  category: string
  direction: WalletLedgerDirection
  amount: number
  balanceBefore: number
  balanceAfter: number
  description: string
  referenceType?: string
  referenceId?: string
  meta?: Record<string, unknown>
}

/**
 * Insert a single row into wallet_ledger. Used by all wallet-changing operations.
 * Executor is the caller's db or transaction (admin-backend or user-backend).
 *
 * Never throws. Most call sites run inside the transaction that moves the money,
 * and aborting a settled bet because its audit row failed would be worse than
 * the missing row. Failures are reported instead of being discarded: an empty
 * catch previously hid them completely, so money could move with no ledger
 * record and nothing anywhere would say so.
 */
export async function createWalletLedgerEntry(
  executor: any,
  params: CreateWalletLedgerEntryParams
): Promise<void> {
  const where = `${params.category}/${params.walletType} wallet=${params.walletId} user=${params.userId}`
  try {
    if (!Number.isFinite(params.amount) || params.amount < 0) {
      console.error(`[walletLedger] refusing entry with invalid amount (${params.amount}) — ${where}`)
      return
    }
    if (params.balanceBefore != null && !Number.isFinite(params.balanceBefore)) {
      console.error(`[walletLedger] refusing entry with invalid balanceBefore (${params.balanceBefore}) — ${where}`)
      return
    }
    if (params.balanceAfter != null && !Number.isFinite(params.balanceAfter)) {
      console.error(`[walletLedger] refusing entry with invalid balanceAfter (${params.balanceAfter}) — ${where}`)
      return
    }

    // The ledger is the audit trail: balanceAfter must equal balanceBefore moved
    // by amount in the stated direction. Rows that break this are what made a
    // historical drift invisible for months, so report the mismatch rather than
    // storing a row nobody can reconcile.
    assertLedgerArithmetic(params, where)

    const desc = params.description ? String(params.description).slice(0, 256) : null
    const refType = params.referenceType ? String(params.referenceType).slice(0, 64) : null
    const refId = params.referenceId != null ? String(params.referenceId).slice(0, 128) : null
    await executor.insert(walletLedger).values({
      tenant: params.tenant.length > 128 ? params.tenant.slice(0, 128) : params.tenant,
      walletId: params.walletId,
      userId: params.userId,
      walletType: params.walletType,
      category: params.category.length > 64 ? params.category.slice(0, 64) : params.category,
      direction: params.direction,
      amount: String(params.amount),
      balanceBefore: params.balanceBefore != null ? String(params.balanceBefore) : null,
      balanceAfter: params.balanceAfter != null ? String(params.balanceAfter) : null,
      description: desc,
      referenceType: refType,
      referenceId: refId,
      meta: params.meta ?? null,
    })
  } catch (err) {
    console.error(
      `[walletLedger] failed to record ${where}:`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Rounding tolerance for the 2-decimal numeric columns. */
const LEDGER_EPSILON = 0.005

/**
 * Report a row whose stated movement does not match its balances.
 * Returns true when the arithmetic holds.
 */
export function checkLedgerArithmetic(params: {
  direction: WalletLedgerDirection
  amount: number
  balanceBefore: number | null | undefined
  balanceAfter: number | null | undefined
}): boolean {
  const { balanceBefore, balanceAfter } = params
  if (balanceBefore == null || balanceAfter == null) return true
  const signed = params.direction === 'debit' ? -params.amount : params.amount
  return Math.abs(balanceBefore + signed - balanceAfter) <= LEDGER_EPSILON
}

function assertLedgerArithmetic(params: CreateWalletLedgerEntryParams, where: string): void {
  if (checkLedgerArithmetic(params)) return
  const signed = params.direction === 'debit' ? -params.amount : params.amount
  console.error(
    `[walletLedger] arithmetic mismatch — ${where}: ` +
      `${params.balanceBefore} ${signed >= 0 ? '+' : '-'} ${Math.abs(signed)} ` +
      `should be ${(params.balanceBefore ?? 0) + signed} but row says ${params.balanceAfter}`
  )
}
