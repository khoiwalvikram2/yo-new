import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { wallets, ledgerEntries, walletLedger } from '@shared/db/schema.js'
import { getWalletByUserIdWithExecutor, ensureWalletWithExecutor } from './userRepo.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'

type Executor = typeof db

export type CasinoWalletType = 'cash' | 'bonus' | 'referralBonus'

export interface CasinoLedgerMeta {
  type: 'casino_bet' | 'casino_win' | 'casino_rollback' | 'casino_payup' | 'bonus_to_cash' | 'referral_balance_to_cash'
  remark?: string
  transactionId?: string
  roundId?: string
  bonusAwardId?: number
  campaignId?: number
  [key: string]: unknown
}

/**
 * Raw balance for the given wallet type (for actual DB updates).
 */
function getBalanceForWalletType(wallet: { cash?: string | null; bonus?: string | null; referralBonus?: string | null }, walletType: CasinoWalletType): number {
  if (walletType === 'cash') return Number(wallet.cash ?? 0)
  if (walletType === 'bonus') return Number(wallet.bonus ?? 0)
  return Number(wallet.referralBonus ?? 0)
}

/**
 * Ledger display balance: for cash use available (cash - exposure) for timeline continuity; for others use raw.
 */
function getLedgerBalanceForWalletType(
  wallet: { cash?: string | null; bonus?: string | null; referralBonus?: string | null; exposure?: string | null },
  walletType: CasinoWalletType
): number {
  if (walletType === 'cash') {
    return Math.max(0, getCasinoSpendableCashBalance(wallet))
  }
  if (walletType === 'bonus') return Number(wallet.bonus ?? 0)
  return Number(wallet.referralBonus ?? 0)
}

/** Spendable cash for casino debit (GAP / bet-tool): raw cash minus sports exposure. */
export function getCasinoSpendableCashBalance(wallet: {
  cash?: string | null
  exposure?: string | null
}): number {
  const cash = Number(wallet.cash ?? 0)
  const exposure = Number(wallet.exposure ?? 0)
  return cash - exposure
}

/** Throws if stake exceeds spendable cash (same rule as GAP cash path). */
export function assertCasinoCashStakeWithinSpendable(
  wallet: { cash?: string | null; exposure?: string | null },
  stake: number
): void {
  const available = getCasinoSpendableCashBalance(wallet)
  if (stake > available) {
    throw new Error(
      `Insufficient available balance for casino stake. Available: ${available.toFixed(2)}, required: ${stake.toFixed(2)}`
    )
  }
}

export async function debitWalletForCasino(
  executor: Executor,
  userId: number,
  tenant: string,
  amount: number,
  walletType: CasinoWalletType,
  meta: CasinoLedgerMeta,
  currency = 'INR'
): Promise<number> {
  const walletRow = await ensureWalletWithExecutor(executor, userId, tenant, currency)
  await executor.execute(sql`SELECT id FROM wallets WHERE id = ${walletRow.id} FOR UPDATE`)
  const [lockedDebit] = await executor.select().from(wallets).where(eq(wallets.id, walletRow.id))
  const wallet = lockedDebit ?? walletRow
  const balanceBefore = getBalanceForWalletType(wallet, walletType)
  if (balanceBefore < amount) {
    throw new Error(`Insufficient balance for casino debit (available ${balanceBefore.toFixed(2)}, required ${amount.toFixed(2)})`)
  }
  const balanceAfter = balanceBefore - amount
  const ledgerBefore = walletType === 'cash' ? getLedgerBalanceForWalletType(wallet, walletType) : balanceBefore
  const ledgerAfter = walletType === 'cash' ? ledgerBefore - amount : balanceAfter
  if (walletType === 'cash') {
    await executor.update(wallets).set({ cash: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  } else if (walletType === 'bonus') {
    await executor.update(wallets).set({ bonus: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  } else {
    await executor.update(wallets).set({ referralBonus: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  }
  await executor.insert(ledgerEntries).values({
    tenant,
    walletId: wallet.id,
    type: 'debit',
    amount: String(amount),
    balanceBefore: String(balanceBefore),
    balanceAfter: String(balanceAfter),
    meta: meta as Record<string, unknown>,
  })
  const wlType = walletType === 'cash' ? 'cash' : walletType === 'bonus' ? 'bonus' : 'referralBonus'
  await createWalletLedgerEntry(executor, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: wlType,
    category: 'casino_bet',
    direction: 'debit',
    amount,
    balanceBefore: ledgerBefore,
    balanceAfter: ledgerAfter,
    description: 'Casino bet',
    referenceType: 'casino_bet',
    referenceId: meta.transactionId ?? undefined,
    meta: meta as Record<string, unknown>,
  })
  return balanceAfter
}

/**
 * Bet-tool / integration delete: put stake back on the wallet without creating new ledger rows.
 * Removes the original placement lines from `ledger_entries` and `wallet_ledger` (casino_bet debit).
 */
export async function restoreCasinoStakeAndStripPlacementLedgers(
  executor: Executor,
  userId: number,
  tenant: string,
  stake: number,
  walletType: CasinoWalletType,
  transactionId: string | null | undefined
): Promise<void> {
  if (!Number.isFinite(stake) || stake <= 0) return
  const tid = transactionId?.trim()
  if (!tid) {
    throw new Error('transactionId is required to restore stake and remove placement ledger rows')
  }
  const walletRow = await getWalletByUserIdWithExecutor(executor, userId, tenant)
  if (!walletRow) {
    throw new Error('Wallet not found')
  }
  await executor.execute(sql`SELECT id FROM wallets WHERE id = ${walletRow.id} FOR UPDATE`)
  const [lockedRestore] = await executor.select().from(wallets).where(eq(wallets.id, walletRow.id))
  const wallet = lockedRestore ?? walletRow
  const before = getBalanceForWalletType(wallet, walletType)
  const after = before + stake
  if (walletType === 'cash') {
    await executor.update(wallets).set({ cash: String(after) }).where(eq(wallets.id, wallet.id))
  } else if (walletType === 'bonus') {
    await executor.update(wallets).set({ bonus: String(after) }).where(eq(wallets.id, wallet.id))
  } else {
    await executor.update(wallets).set({ referralBonus: String(after) }).where(eq(wallets.id, wallet.id))
  }

  await executor.delete(ledgerEntries).where(
    and(
      eq(ledgerEntries.walletId, wallet.id),
      eq(ledgerEntries.tenant, tenant),
      sql`${ledgerEntries.meta}->>'type' = 'casino_bet'`,
      sql`${ledgerEntries.meta}->>'transactionId' = ${tid}`
    )
  )

  const wlConds = [
    eq(walletLedger.walletId, wallet.id),
    eq(walletLedger.tenant, tenant),
    eq(walletLedger.category, 'casino_bet'),
    eq(walletLedger.direction, 'debit'),
    eq(walletLedger.referenceType, 'casino_bet'),
    eq(walletLedger.referenceId, tid),
  ]
  await executor.delete(walletLedger).where(and(...wlConds))
}

export async function creditWalletForCasino(
  executor: Executor,
  userId: number,
  tenant: string,
  amount: number,
  walletType: CasinoWalletType,
  meta: CasinoLedgerMeta
): Promise<number> {
  const walletRow = await getWalletByUserIdWithExecutor(executor, userId, tenant)
  if (!walletRow) {
    throw new Error('Wallet not found')
  }
  await executor.execute(sql`SELECT id FROM wallets WHERE id = ${walletRow.id} FOR UPDATE`)
  const [lockedCredit] = await executor.select().from(wallets).where(eq(wallets.id, walletRow.id))
  const wallet = lockedCredit ?? walletRow
  const balanceBefore = getBalanceForWalletType(wallet, walletType)
  const balanceAfter = balanceBefore + amount
  const ledgerBefore = walletType === 'cash' ? getLedgerBalanceForWalletType(wallet, walletType) : balanceBefore
  const ledgerAfter = walletType === 'cash' ? ledgerBefore + amount : balanceAfter
  if (walletType === 'cash') {
    await executor.update(wallets).set({ cash: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  } else if (walletType === 'bonus') {
    await executor.update(wallets).set({ bonus: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  } else {
    await executor.update(wallets).set({ referralBonus: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  }
  await executor.insert(ledgerEntries).values({
    tenant,
    walletId: wallet.id,
    type: 'credit',
    amount: String(amount),
    balanceBefore: String(balanceBefore),
    balanceAfter: String(balanceAfter),
    meta: meta as Record<string, unknown>,
  })
  const wlType = walletType === 'cash' ? 'cash' : walletType === 'bonus' ? 'bonus' : 'referralBonus'
  const category = meta.type === 'casino_rollback' ? 'casino_rollback' : meta.type === 'bonus_to_cash' ? 'bonus_transfer' : 'casino_win'
  await createWalletLedgerEntry(executor, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: wlType,
    category,
    direction: 'credit',
    amount,
    balanceBefore: ledgerBefore,
    balanceAfter: ledgerAfter,
    description: meta.type === 'casino_rollback' ? 'Casino rollback' : meta.type === 'bonus_to_cash' ? 'Bonus to cash' : 'Casino win',
    referenceType: meta.type,
    referenceId: meta.transactionId ?? undefined,
    meta: meta as Record<string, unknown>,
  })
  return balanceAfter
}

export async function creditReferralBalanceForCasino(
  executor: Executor,
  userId: number,
  tenant: string,
  amount: number,
  meta: CasinoLedgerMeta
): Promise<number> {
  const walletRow = await getWalletByUserIdWithExecutor(executor, userId, tenant)
  if (!walletRow) {
    throw new Error('Wallet not found')
  }
  await executor.execute(sql`SELECT id FROM wallets WHERE id = ${walletRow.id} FOR UPDATE`)
  const [lockedRef] = await executor.select().from(wallets).where(eq(wallets.id, walletRow.id))
  const wallet = lockedRef ?? walletRow
  const balanceBefore = Number(wallet.referralBalance ?? 0)
  const balanceAfter = balanceBefore + amount
  await executor.update(wallets).set({ referralBalance: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
  await executor.insert(ledgerEntries).values({
    tenant,
    walletId: wallet.id,
    type: 'credit',
    amount: String(amount),
    balanceBefore: String(balanceBefore),
    balanceAfter: String(balanceAfter),
    meta: meta as Record<string, unknown>,
  })
  await createWalletLedgerEntry(executor, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: 'referralBalance',
    category: 'referral_transfer',
    direction: 'credit',
    amount,
    balanceBefore,
    balanceAfter,
    description: 'Casino win to referral balance',
    referenceType: 'casino_win',
    referenceId: meta.transactionId ?? undefined,
    meta: meta as Record<string, unknown>,
  })
  return balanceAfter
}
