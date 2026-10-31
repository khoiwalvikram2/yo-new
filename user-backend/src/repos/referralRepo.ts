import { and, eq, isNull, desc, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  referralLinks,
  referralAttributions,
  referralEarnings,
  referralSettlements,
  referralRules,
  referralClicks,
  referralPrograms,
  wallets,
  ledgerEntries,
} from '@shared/db/schema.js'
import { getWalletByUserIdWithExecutor, ensureWalletWithExecutor } from './userRepo.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { getWhitelabelCurrency } from '../shared/whitelabelConfig.js'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CODE_LENGTH = 8
const MAX_CODE_ATTEMPTS = 20

function generateReferralCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARS.charAt(Math.floor(Math.random() * CHARS.length))
  }
  return code.toUpperCase()
}

/**
 * Sum of unsettled referral earnings for the user (as referrer).
 */
export async function getUnsettledReferralBalance(userId: number, tenant: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${referralEarnings.netAmount}::numeric), 0)`,
    })
    .from(referralEarnings)
    .leftJoin(
      referralSettlements,
      and(
        eq(referralSettlements.earningId, referralEarnings.id),
        eq(referralSettlements.tenant, tenant)
      )
    )
    .where(
      and(
        eq(referralEarnings.referrerId, userId),
        eq(referralEarnings.tenant, tenant),
        isNull(referralSettlements.id)
      )
    )
  const total = rows[0]?.total
  const raw = total != null ? Number(total) : 0
  return Math.round(raw * 100) / 100
}

export async function getReferralLinkByUserId(userId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralLinks)
    .where(and(eq(referralLinks.userId, userId), eq(referralLinks.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Look up referral link by code (case-insensitive, trimmed). */
export async function getReferralLinkByCode(code: string) {
  if (!code || !code.trim()) return null
  const normalized = code.trim().toUpperCase()
  const rows = await db
    .select()
    .from(referralLinks)
    .where(eq(referralLinks.code, normalized))
    .limit(1)
  return rows[0] ?? null
}

export async function getOrCreateMyReferralLink(
  userId: number,
  tenant: string,
  baseUrl: string
): Promise<{ code: string; url: string; id: number }> {
  if (!tenant || typeof tenant !== 'string' || !tenant.trim()) {
    throw new Error('Tenant is required')
  }
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error('Invalid user')
  }
  const existing = await getReferralLinkByUserId(userId, tenant)
  if (existing) {
    const url = `${baseUrl.replace(/\/$/, '')}/r?ref=${existing.code}`
    return { code: existing.code, url, id: existing.id }
  }
  let attempts = 0
  while (attempts < MAX_CODE_ATTEMPTS) {
    const code = generateReferralCode()
    const existingByCode = await getReferralLinkByCode(code)
    if (existingByCode) {
      attempts++
      continue
    }
    try {
      const inserted = await db
        .insert(referralLinks)
        .values({
          tenant,
          userId,
          code,
          isActive: true,
        })
        .returning()
      const row = inserted[0]
      if (!row) throw new Error('Insert failed')
      const url = `${baseUrl.replace(/\/$/, '')}/r?ref=${row.code}`
      return { code: row.code, url, id: row.id }
    } catch (err: any) {
      if (err?.code === '23505') {
        attempts++
        continue
      }
      throw err
    }
  }
  throw new Error('Failed to generate unique referral code after multiple attempts')
}

/**
 * Create referral attribution for a referee. Returns null if referrer and referee are the same (self-referral guard).
 */
export async function createReferralAttribution(
  tenant: string,
  referrerId: number,
  refereeId: number,
  tier: number = 1,
  clickId?: number
) {
  if (referrerId === refereeId) return null
  const inserted = await db
    .insert(referralAttributions)
    .values({
      tenant,
      referrerId,
      refereeId,
      tier,
      clickId: clickId ?? null,
      status: 'confirmed',
    })
    .onConflictDoNothing({ target: referralAttributions.refereeId })
    .returning()
  return inserted[0] ?? null
}

type DbOrTx = typeof db

/**
 * Get earnings for referrer that have no settlement yet. Pass executor for use inside transaction.
 */
export async function getUnsettledEarnings(
  userId: number,
  tenant: string,
  executor: DbOrTx = db
) {
  const exec = executor as DbOrTx
  const earnings = await exec
    .select()
    .from(referralEarnings)
    .where(and(eq(referralEarnings.referrerId, userId), eq(referralEarnings.tenant, tenant)))
    .orderBy(desc(referralEarnings.calculatedAt))
  const settledIds = await exec
    .select({ earningId: referralSettlements.earningId })
    .from(referralSettlements)
    .where(eq(referralSettlements.tenant, tenant))
  const settledSet = new Set(settledIds.map((s: { earningId: number }) => s.earningId))
  return earnings.filter((e: { id: number }) => !settledSet.has(e.id))
}

export async function getReferralRuleById(ruleId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralRules)
    .where(and(eq(referralRules.id, ruleId), eq(referralRules.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Round to 2 decimal places for currency. */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100
}

function computeCashBonusFromEarning(
  netAmount: number,
  payoutType: string,
  _splitRatio: { cash: number; bonus: number } | null // not used for SPLIT; SPLIT uses fixed 50-50
): { cashAmount: number; bonusAmount: number } {
  if (payoutType === 'CASH') return { cashAmount: roundCurrency(netAmount), bonusAmount: 0 }
  if (payoutType === 'BONUS') return { cashAmount: 0, bonusAmount: roundCurrency(netAmount) }
  if (payoutType === 'SPLIT') {
    // Fixed 50-50: 50% referral balance (cash), 50% referral bonus
    const cashAmount = roundCurrency(netAmount * 0.5)
    const bonusAmount = roundCurrency(netAmount - cashAmount)
    return { cashAmount, bonusAmount }
  }
  return { cashAmount: roundCurrency(netAmount), bonusAmount: 0 }
}

/**
 * Credit referral balance or referral bonus wallet and create ledger entry. Use inside transaction.
 * CASH portion goes to referralBalance, BONUS portion goes to referralBonus column.
 */
async function creditReferralBalanceOrBonusForReferral(
  executor: DbOrTx,
  userId: number,
  tenant: string,
  amount: number,
  target: 'referralBalance' | 'referralBonus',
  meta: { type: string; settlementId?: number; earningId?: number }
): Promise<void> {
  const wallet = await getWalletByUserIdWithExecutor(executor as unknown as Parameters<typeof getWalletByUserIdWithExecutor>[0], userId, tenant)
  if (!wallet) throw new Error('Wallet not found')
  const balanceBefore =
    target === 'referralBalance' ? Number(wallet.referralBalance ?? 0) : Number(wallet.referralBonus ?? 0)
  const balanceAfter = balanceBefore + amount
  if (target === 'referralBalance') {
    await executor.update(wallets).set({ referralBalance: String(balanceAfter) }).where(eq(wallets.id, wallet.id))
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
  await createWalletLedgerEntry(executor, {
    tenant,
    walletId: wallet.id,
    userId,
    walletType: target,
    category: 'referral_earning',
    direction: 'credit',
    amount,
    balanceBefore,
    balanceAfter,
    description: 'Referral earning',
    referenceType: 'referral_settlement',
    referenceId: meta.settlementId != null ? String(meta.settlementId) : '',
    meta: meta as Record<string, unknown>,
  })
}

export interface ClaimResult {
  count: number
  totalCash: number
  totalBonus: number
}

export interface TransferReferralBalanceResult {
  success: boolean
  message: string
  newReferralBalance?: number
  newCashBalance?: number
}

/**
 * Transfer amount from referral balance (winnings) to cash wallet.
 * Referral bonus wallet stays casino-only; referral balance is allowed to transfer to cash when >= program minimum.
 */
export async function transferReferralBalanceToCash(
  userId: number,
  amount: number,
  tenant: string
): Promise<TransferReferralBalanceResult> {
  if (amount <= 0 || !Number.isFinite(amount)) {
    return { success: false, message: 'Amount must be a positive number' }
  }
  const roundedAmount = roundCurrency(amount)
  if (roundedAmount <= 0) {
    return { success: false, message: 'Amount must be positive' }
  }

  const tenantKey = tenant || 'default'
  const [programRow] = await db
    .select({ minReferralBalanceForCashTransfer: referralPrograms.minReferralBalanceForCashTransfer })
    .from(referralPrograms)
    .where(eq(referralPrograms.tenant, tenantKey))
    .limit(1)
  const minTransfer = programRow?.minReferralBalanceForCashTransfer != null ? Number(programRow.minReferralBalanceForCashTransfer) : 0
  if (roundedAmount < minTransfer) {
    return { success: false, message: `Minimum transfer amount is ${minTransfer}` }
  }

  try {
    const currencyForKey = await getWhitelabelCurrency(tenantKey)
    const result = await db.transaction(async (tx) => {
      await ensureWalletWithExecutor(tx as unknown as Parameters<typeof ensureWalletWithExecutor>[0], userId, tenantKey, currencyForKey)
      const wallet = await getWalletByUserIdWithExecutor(tx as unknown as Parameters<typeof getWalletByUserIdWithExecutor>[0], userId, tenantKey)
      if (!wallet) {
        throw new Error('Wallet not found')
      }
      const refBalance = Number(wallet.referralBalance ?? 0)
      const cashBefore = Number(wallet.cash ?? 0)
      const exposure = Number(wallet.exposure ?? 0)
      if (refBalance < roundedAmount) {
        return { success: false as const, message: 'Insufficient referral balance' }
      }

      // Atomic update: only deduct if balance still >= amount (avoids race when two transfers run together)
      const [updated] = await tx
        .update(wallets)
        .set({
          referralBalance: sql`${wallets.referralBalance} - ${roundedAmount}`,
          cash: sql`${wallets.cash} + ${roundedAmount}`,
        })
        .where(and(eq(wallets.id, wallet.id), sql`${wallets.referralBalance} >= ${roundedAmount}`))
        .returning({ referralBalance: wallets.referralBalance, cash: wallets.cash })

      if (!updated) {
        return { success: false as const, message: 'Insufficient referral balance' }
      }

      const refBalanceAfter = Number(updated.referralBalance ?? 0)
      const cashAfter = Number(updated.cash ?? 0)
      const cashLedgerBefore = Math.max(0, cashBefore - exposure)
      const cashLedgerAfter = Math.max(0, cashAfter - exposure)

      await tx.insert(ledgerEntries).values({
        tenant: tenantKey,
        walletId: wallet.id,
        type: 'debit',
        amount: String(roundedAmount),
        balanceBefore: String(refBalance),
        balanceAfter: String(refBalanceAfter),
        meta: {
          type: 'referral_balance_to_cash',
          remark: 'REFERRAL BALANCE TO CASH',
          source: 'referral_balance',
        } as Record<string, unknown>,
      })
      await tx.insert(ledgerEntries).values({
        tenant: tenantKey,
        walletId: wallet.id,
        type: 'credit',
        amount: String(roundedAmount),
        balanceBefore: String(cashBefore),
        balanceAfter: String(cashAfter),
        meta: {
          type: 'referral_balance_to_cash',
          remark: 'REFERRAL BALANCE TO CASH',
          destination: 'cash',
        } as Record<string, unknown>,
      })
      await createWalletLedgerEntry(tx, {
        tenant: tenantKey,
        walletId: wallet.id,
        userId,
        walletType: 'referralBalance',
        category: 'referral_transfer',
        direction: 'debit',
        amount: roundedAmount,
        balanceBefore: refBalance,
        balanceAfter: refBalanceAfter,
        description: 'Transfer to cash',
        referenceType: 'referral_transfer',
        referenceId: '',
        meta: {},
      })
      await createWalletLedgerEntry(tx, {
        tenant: tenantKey,
        walletId: wallet.id,
        userId,
        walletType: 'cash',
        category: 'referral_transfer',
        direction: 'credit',
        amount: roundedAmount,
        balanceBefore: cashLedgerBefore,
        balanceAfter: cashLedgerAfter,
        description: 'From referral balance',
        referenceType: 'referral_transfer',
        referenceId: '',
        meta: {},
      })

      const { deductWhitelabelCredit } = await import('@shared/services/whitelabelCreditDeduct.js')
      const currency = await getWhitelabelCurrency(tenantKey)
      await deductWhitelabelCredit(tx as any, tenantKey, roundedAmount, currency, `Referral balance to cash - userId=${userId}`, { userId })

      return { success: true as const, newReferralBalance: refBalanceAfter, newCashBalance: cashAfter }
    })

    if (!result.success) {
      return { success: false, message: result.message }
    }
    return {
      success: true,
      message: 'Transferred to cash wallet',
      newReferralBalance: result.newReferralBalance,
      newCashBalance: result.newCashBalance,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed'
    return { success: false, message }
  }
}

/**
 * Claim all unsettled referral earnings: create settlements, credit wallet, update status. Single transaction.
 */
export async function executeClaimReferralBonus(userId: number, tenant: string): Promise<ClaimResult> {
  const whitelabelCurrency = await getWhitelabelCurrency(tenant)
  const result = await db.transaction(async (tx) => {
    await ensureWalletWithExecutor(tx as unknown as Parameters<typeof ensureWalletWithExecutor>[0], userId, tenant, whitelabelCurrency)
    const unsettled = await getUnsettledEarnings(userId, tenant, tx as unknown as DbOrTx)
    if (unsettled.length === 0) {
      return { count: 0, totalCash: 0, totalBonus: 0 }
    }
    let totalCash = 0
    let totalBonus = 0
    for (const earning of unsettled) {
      const rule = await getReferralRuleById(earning.ruleId, tenant)
      const payoutType = rule?.payoutType ?? 'CASH'
      const splitRatio = (rule?.splitRatio ?? { cash: 100, bonus: 0 }) as { cash: number; bonus: number }
      const netAmount = Number(earning.netAmount ?? 0)
      const { cashAmount, bonusAmount } = computeCashBonusFromEarning(netAmount, payoutType, splitRatio)
      const currency = (earning.currency ?? whitelabelCurrency) as string
      const settlement = await tx
        .insert(referralSettlements)
        .values({
          tenant,
          earningId: earning.id,
          referrerId: userId,
          payoutType: payoutType as 'CASH' | 'BONUS' | 'SPLIT',
          cashAmount: String(cashAmount),
          bonusAmount: String(bonusAmount),
          currency,
          status: 'pending',
          escrowStatus: 'none',
        })
        .returning()
      const sett = settlement[0]
      if (!sett) continue
      const meta = { type: 'referral_earning', settlementId: sett.id, earningId: earning.id }
      // CASH → referral balance (user can transfer to cash). BONUS → referral bonus (casino-only).
      if (cashAmount > 0) {
        await creditReferralBalanceOrBonusForReferral(tx as unknown as DbOrTx, userId, tenant, cashAmount, 'referralBalance', meta)
        totalCash += cashAmount
      }
      if (bonusAmount > 0) {
        await creditReferralBalanceOrBonusForReferral(tx as unknown as DbOrTx, userId, tenant, bonusAmount, 'referralBonus', meta)
        totalBonus += bonusAmount
      }
      await tx
        .update(referralSettlements)
        .set({
          status: 'completed',
          settledAt: new Date(),
        })
        .where(and(eq(referralSettlements.id, sett.id), eq(referralSettlements.tenant, tenant)))
    }
    return {
      count: unsettled.length,
      totalCash,
      totalBonus,
    }
  })
  return result
}

/**
 * Record a referral click by code (no auth). Resolves link by code, then inserts into referral_clicks.
 */
export async function recordReferralClickByCode(
  tenant: string,
  code: string,
  opts: { ip?: string; userAgent?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string }
) {
  if (!tenant || !tenant.trim()) return false
  const link = await getReferralLinkByCode(code)
  if (!link || !link.isActive || link.tenant !== tenant || link.userId == null) {
    return false
  }
  await db.insert(referralClicks).values({
    tenant,
    linkId: link.id,
    referrerId: link.userId,
    ipAddress: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    utmSource: opts.utmSource ?? null,
    utmMedium: opts.utmMedium ?? null,
    utmCampaign: opts.utmCampaign ?? null,
  })
  return true
}
