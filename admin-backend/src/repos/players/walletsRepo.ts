import { db } from '@src/db/client.js'
import { wallets, ledgerEntries, depositRequests, withdrawalRequests } from '@src/db/schema.js'
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { currencyService } from '@src/services/currencyService.js'
import { CurrencyCode } from '@src/types/currency.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { settlementDateExpr } from '@src/shared/reportingSql.js'

type PlayerWalletRow = InferSelectModel<typeof wallets>

export async function getWalletDb(userId: number, tenant = 'default') {
  try {
    const [w] = await db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    return w ?? null
  } catch { return null }
}

/** Ensure a player cash wallet row exists (same pattern as user-backend ensureWallet). */
export async function ensurePlayerWalletDb(userId: number, tenant = 'default', currency = 'INR'): Promise<PlayerWalletRow> {
  const existing = await getWalletDb(userId, tenant)
  if (existing) return existing
  const inserted = await db
    .insert(wallets)
    .values({ tenant, userId, currency, cash: '0', bonus: '0', exposure: '0' })
    .returning()
  const row = inserted[0]
  if (!row) throw new Error('Failed to create wallet')
  return row
}

/** Batch fetch wallets for many users. Returns Map<userId, wallet>. Use for list pages to avoid N queries. */
export async function getWalletsForUserIdsDb(userIds: number[], tenant = 'default'): Promise<Map<number, Awaited<ReturnType<typeof getWalletDb>>>> {
  const map = new Map<number, Awaited<ReturnType<typeof getWalletDb>>>()
  if (!userIds.length) return map
  const uniqueIds = [...new Set(userIds)]
  const rows = await db
    .select()
    .from(wallets)
    .where(and(inArray(wallets.userId, uniqueIds), eq(wallets.tenant, tenant)))
  for (const row of rows) {
    map.set(row.userId, row)
  }
  return map
}

export async function adjustWalletDb(userId: number, amount: number, meta?: any, tenant = 'default', executor?: any) {
  const executeAdjustment = async (tx: any) => {
    // MONEY-CRITICAL: the row is locked (FOR UPDATE) so the balance check below and the write see the same
    // cash. A player's wallet is its lowest-id row for the tenant (wallets has no unique (user_id, tenant)).
    const [existing] = await tx
      .select({ id: wallets.id, currency: wallets.currency, cash: wallets.cash, exposure: wallets.exposure })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
      .orderBy(wallets.id)
      .limit(1)
      .for('update')

    if (!existing) return null

    const walletCurrency = existing.currency as CurrencyCode
    if (!currencyService.isValidCurrency(walletCurrency)) {
      throw new Error(`Invalid currency: ${walletCurrency}`)
    }

    // Store balance before/after (raw cash for legacy ledger_entries)
    const balanceBefore = Number(existing.cash || 0)
    const exposureBefore = Number(existing.exposure ?? 0)

    // A debit never takes more than the player's available balance: cash less the open sports exposure held
    // against it, the same figure a player's own withdrawal request is checked against. Nothing else stopped
    // cash going negative here, and a whitelabel admin's withdrawal from a zero balance released pool credit
    // that had never been used.
    // Compared in whole cents: cash and exposure are numeric(18,2), and the float subtraction 0.30 - 0.10 is
    // 0.19999999999999998, which refused a withdrawal of exactly the available 0.20. A fraction of a cent in the
    // request counts as a whole cent, so it cannot release pool credit while the wallet rounds it away.
    if (amount < 0) {
      const availableCents = Math.max(0, Math.round(balanceBefore * 100) - Math.round(exposureBefore * 100))
      const requestedCents = Math.ceil(Math.abs(amount) * 100 - 0.001)
      if (requestedCents > availableCents) {
        const held = exposureBefore > 0 ? ` (Cash: ${balanceBefore.toFixed(2)}, Exposure: ${exposureBefore.toFixed(2)})` : ''
        throw new Error(`Insufficient available balance. Available: ${(availableCents / 100).toFixed(2)}${held}, Requested: ${(requestedCents / 100).toFixed(2)}`)
      }
    }

    const updatedRows = await tx
      .update(wallets)
      .set({ cash: sql`${wallets.cash} + ${amount}` })
      .where(eq(wallets.id, existing.id))
      .returning({ id: wallets.id, userId: wallets.userId, currency: wallets.currency, cash: wallets.cash, exposure: wallets.exposure })

    const updated = updatedRows[0]
    const balanceAfter = Number(updated.cash || 0)
    const exposureAfter = Number(updated.exposure ?? 0)
    const ledgerBefore = Math.max(0, balanceBefore - exposureBefore)
    const ledgerAfter = Math.max(0, balanceAfter - exposureAfter)

    const baseAmount = currencyService.toBaseCurrency(Math.abs(amount), walletCurrency)

    // Check first deposit BEFORE inserting (query would include our new row after insert)
    let isFirstDeposit = false
    if (amount > 0 && meta?.type === 'deposit') {
      const previousDeposits = await tx
        .select()
        .from(ledgerEntries)
        .where(and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.walletId, existing.id),
          eq(ledgerEntries.type, 'credit'),
          sql`${ledgerEntries.meta}->>'type' = 'deposit'`
        ))
        .limit(1)
      isFirstDeposit = previousDeposits.length === 0
    }

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: updated.id,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: String(baseAmount),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      meta: {
        ...meta,
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: updated.id,
      userId,
      walletType: 'cash',
      category: meta?.type ?? 'admin_adjustment',
      direction: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      balanceBefore: ledgerBefore,
      balanceAfter: ledgerAfter,
      description: meta?.type ?? 'Admin adjustment',
      referenceType: meta?.depositRequestId ? 'deposit_request' : meta?.withdrawalRequestId ? 'withdrawal_request' : undefined,
      referenceId: meta?.depositRequestId ? String(meta.depositRequestId) : meta?.withdrawalRequestId ? String(meta.withdrawalRequestId) : undefined,
      meta: meta ?? undefined,
    })

    // Handle referral deposit (if positive amount and type is deposit)
    if (amount > 0 && meta?.type === 'deposit') {
      const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
      
      // Trigger referral deposit handling (async, non-blocking, after transaction)
      setImmediate(() => {
        referralIntegrationService.handleDeposit(tenant, userId, amount, walletCurrency, isFirstDeposit)
          .catch(() => {})
      })
    }

    return updated
  }
  
  // Use provided executor (transaction) or create new transaction
  if (executor) {
    return executeAdjustment(executor)
  } else {
    return db.transaction(executeAdjustment)
  }
}

export async function adjustWalletBonusDb(userId: number, amount: number, meta?: any, tenant = 'default') {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: wallets.id, currency: wallets.currency, bonus: wallets.bonus })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

    if (!existing) return null

    const walletCurrency = existing.currency as CurrencyCode
    if (!currencyService.isValidCurrency(walletCurrency)) {
      throw new Error(`Invalid currency: ${walletCurrency}`)
    }

    const updatedRows = await tx
      .update(wallets)
      .set({ bonus: sql`${wallets.bonus} + ${amount}` })
      .where(eq(wallets.id, existing.id))
      .returning({ id: wallets.id, userId: wallets.userId, currency: wallets.currency, bonus: wallets.bonus })

    const updated = updatedRows[0]
    const balanceBefore = Number(existing.bonus ?? 0)
    const balanceAfter = Number(updated.bonus ?? 0)
    const baseAmount = currencyService.toBaseCurrency(Math.abs(amount), walletCurrency)

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: updated.id,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: String(baseAmount),
      meta: {
        ...meta,
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: updated.id,
      userId,
      walletType: 'bonus',
      category: meta?.type ?? 'admin_adjustment',
      direction: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      balanceBefore,
      balanceAfter,
      description: meta?.type ?? 'Bonus adjustment',
      meta: meta ?? undefined,
    })

    return updated
  })
}

export async function adjustWalletReferralBonusDb(userId: number, amount: number, meta?: any, tenant = 'default') {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: wallets.id, currency: wallets.currency, referralBonus: wallets.referralBonus })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

    if (!existing) return null

    const walletCurrency = existing.currency as CurrencyCode
    if (!currencyService.isValidCurrency(walletCurrency)) {
      throw new Error(`Invalid currency: ${walletCurrency}`)
    }

    const balanceBefore = Number(existing.referralBonus ?? 0)
    const balanceAfter = balanceBefore + amount

    const updatedRows = await tx
      .update(wallets)
      .set({ referralBonus: sql`${wallets.referralBonus} + ${amount}` })
      .where(eq(wallets.id, existing.id))
      .returning({ id: wallets.id, userId: wallets.userId, currency: wallets.currency, referralBonus: wallets.referralBonus })

    const updated = updatedRows[0]
    const baseAmount = currencyService.toBaseCurrency(Math.abs(amount), walletCurrency)

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: updated.id,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: String(baseAmount),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      meta: {
        ...meta,
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: updated.id,
      userId,
      walletType: 'referralBonus',
      category: meta?.type ?? 'referral_earning',
      direction: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      balanceBefore,
      balanceAfter,
      description: meta?.type ?? 'Referral bonus adjustment',
      meta: meta ?? undefined,
    })

    return updated
  })
}

export async function adjustWalletReferralBalanceDb(userId: number, amount: number, meta?: any, tenant = 'default') {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: wallets.id, currency: wallets.currency, referralBalance: wallets.referralBalance })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

    if (!existing) return null

    const walletCurrency = existing.currency as CurrencyCode
    if (!currencyService.isValidCurrency(walletCurrency)) {
      throw new Error(`Invalid currency: ${walletCurrency}`)
    }

    const balanceBefore = Number(existing.referralBalance ?? 0)
    const balanceAfter = balanceBefore + amount

    const updatedRows = await tx
      .update(wallets)
      .set({ referralBalance: sql`${wallets.referralBalance} + ${amount}` })
      .where(eq(wallets.id, existing.id))
      .returning({ id: wallets.id, userId: wallets.userId, currency: wallets.currency, referralBalance: wallets.referralBalance })

    const updated = updatedRows[0]
    const baseAmount = currencyService.toBaseCurrency(Math.abs(amount), walletCurrency)

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: updated.id,
      type: amount >= 0 ? 'credit' : 'debit',
      amount: String(baseAmount),
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
      meta: {
        ...meta,
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: updated.id,
      userId,
      walletType: 'referralBalance',
      category: meta?.type ?? 'referral_earning',
      direction: amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(amount),
      balanceBefore,
      balanceAfter,
      description: meta?.type ?? 'Referral balance adjustment',
      meta: meta ?? undefined,
    })

    return updated
  })
}

export async function transferReferralBalanceToCashDb(userId: number, amount: number, tenant = 'default') {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: wallets.id,
        currency: wallets.currency,
        cash: wallets.cash,
        exposure: wallets.exposure,
        referralBalance: wallets.referralBalance,
      })
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

    if (!existing) return null

    const refBalance = Number(existing.referralBalance ?? 0)
    if (refBalance < amount) {
      throw new Error('Insufficient referral balance')
    }

    const walletCurrency = existing.currency as CurrencyCode
    if (!currencyService.isValidCurrency(walletCurrency)) {
      throw new Error(`Invalid currency: ${walletCurrency}`)
    }

    const baseAmount = currencyService.toBaseCurrency(amount, walletCurrency)

    await tx
      .update(wallets)
      .set({
        referralBalance: sql`${wallets.referralBalance} - ${amount}`,
        cash: sql`${wallets.cash} + ${amount}`,
      })
      .where(eq(wallets.id, existing.id))

    const refBalanceAfter = refBalance - amount
    const cashBefore = Number(existing.cash ?? 0)
    const cashAfter = cashBefore + amount
    const exposure = Number(existing.exposure ?? 0)
    const cashLedgerBefore = Math.max(0, cashBefore - exposure)
    const cashLedgerAfter = Math.max(0, cashAfter - exposure)

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: existing.id,
      type: 'debit',
      amount: String(baseAmount),
      balanceBefore: String(refBalance),
      balanceAfter: String(refBalanceAfter),
      meta: {
        type: 'referral_balance_to_cash',
        remark: 'REFERRAL BALANCE TO CASH',
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await tx.insert(ledgerEntries).values({
      tenant,
      walletId: existing.id,
      type: 'credit',
      amount: String(baseAmount),
      balanceBefore: String(cashBefore),
      balanceAfter: String(cashAfter),
      meta: {
        type: 'referral_balance_to_cash',
        remark: 'REFERRAL BALANCE TO CASH',
        source: 'referral_balance',
        originalAmount: amount,
        originalCurrency: walletCurrency,
        baseAmount,
        baseCurrency: currencyService.getBaseCurrency(),
      } as any,
    })

    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: existing.id,
      userId,
      walletType: 'referralBalance',
      category: 'referral_transfer',
      direction: 'debit',
      amount,
      balanceBefore: refBalance,
      balanceAfter: refBalanceAfter,
      description: 'Referral balance to cash',
    })
    await createWalletLedgerEntry(tx, {
      tenant,
      walletId: existing.id,
      userId,
      walletType: 'cash',
      category: 'referral_transfer',
      direction: 'credit',
      amount,
      balanceBefore: cashLedgerBefore,
      balanceAfter: cashLedgerAfter,
      description: 'Referral balance to cash',
    })

    const { deductWhitelabelCredit } = await import('@shared/services/whitelabelCreditDeduct.js')
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
    const currency = await getWhitelabelCurrency(tenant)
    await deductWhitelabelCredit(tx, tenant, amount, currency, `Referral balance to cash (admin) - userId=${userId}`, {
      userId,
    })

    const [updated] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, existing.id))
      .limit(1)
    return updated ?? null
  })
}

type LedgerFilter = {
  tenant: string
  walletId?: number
  type?: string
  dateFrom?: Date
  dateTo?: Date
}

const buildLedgerWhere = ({ tenant, walletId, type, dateFrom, dateTo }: LedgerFilter) => {
  const clauses: any[] = [eq(ledgerEntries.tenant, tenant)]
  
  if (walletId !== undefined) {
    clauses.push(eq(ledgerEntries.walletId, walletId))
  }
  
  if (type) {
    const normalized = String(type).toLowerCase()
    if (normalized === 'deposit') {
      clauses.push(sql`(${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' = 'deposit')`)
    } else if (normalized === 'all_deposit') {
      clauses.push(sql`((${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' = 'deposit') OR (${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' = 'admin_adjustment'))`)
    } else if (normalized === 'withdrawal') {
      clauses.push(sql`((${ledgerEntries.type} = 'debit' AND ${ledgerEntries.meta}->>'type' = 'withdrawal') OR ${ledgerEntries.type} = 'withdrawal_pending')`)
    } else if (normalized === 'all_withdrawal') {
      clauses.push(sql`((${ledgerEntries.type} = 'debit' AND ${ledgerEntries.meta}->>'type' = 'withdrawal') OR ${ledgerEntries.type} = 'withdrawal_pending' OR (${ledgerEntries.type} = 'debit' AND ${ledgerEntries.meta}->>'type' = 'admin_adjustment'))`)
    } else if (normalized === 'transfer') {
      clauses.push(
        sql`(${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' IN ('bonus_release', 'bonus_instant_cash', 'bonus_instant_cash_transfer', 'bonus_to_cash', 'referral_balance_to_cash'))`
      )
    } else if (normalized === 'manual_deposit') {
      clauses.push(
        sql`(${ledgerEntries.type} = 'credit' AND ${ledgerEntries.meta}->>'type' = 'admin_adjustment')`
      )
    } else if (normalized === 'manual_withdrawal') {
      clauses.push(
        sql`(${ledgerEntries.type} = 'debit' AND ${ledgerEntries.meta}->>'type' = 'admin_adjustment')`
      )
    } else {
      clauses.push(eq(ledgerEntries.type, type))
    }
  }
  if (dateFrom) clauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) clauses.push(lte(ledgerEntries.createdAt, dateTo))
  return and(...clauses)
}

export async function getFirstLedgerEntryByTypeDb(params: LedgerFilter): Promise<Date | null> {
  const where = buildLedgerWhere(params)
  const rows = await db
    .select({ createdAt: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .where(where)
    .orderBy(ledgerEntries.createdAt)
    .limit(1)
  return rows[0]?.createdAt ?? null
}

export async function listLedgerEntriesByWalletDb(params: LedgerFilter & { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 1000)
  const offset = Math.max(params.offset ?? 0, 0)
  const where = buildLedgerWhere(params)

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: ledgerEntries.id,
        tenant: ledgerEntries.tenant,
        walletId: ledgerEntries.walletId,
        type: ledgerEntries.type,
        amount: ledgerEntries.amount,
        balanceBefore: ledgerEntries.balanceBefore,
        balanceAfter: ledgerEntries.balanceAfter,
        meta: ledgerEntries.meta,
        createdAt: ledgerEntries.createdAt,
      })
      .from(ledgerEntries)
      .where(where)
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(ledgerEntries).where(where),
  ])

  const mapped = items.map(item => ({
    id: item.id,
    tenant: item.tenant,
    walletId: item.walletId,
    type: item.type,
    amount: Number(item.amount ?? 0),
    balanceBefore: item.balanceBefore ? Number(item.balanceBefore) : null,
    balanceAfter: item.balanceAfter ? Number(item.balanceAfter) : null,
    meta: item.meta ?? null,
    createdAt: item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt),
  }))

  return {
    items: mapped,
    total: Number(total ?? 0),
    hasMore: offset + mapped.length < Number(total ?? 0),
  }
}

export type BonusToCashTransferParams = {
  tenant: string
  walletId: number
  dateFrom?: Date
  dateTo?: Date
}

/** Sum of credit amounts where meta.type is bonus_release, bonus_instant_cash_transfer, bonus_instant_cash, or bonus_to_cash (bonus-to-cash transfers). */
export async function getBonusToCashTransferStatsDb(
  params: BonusToCashTransferParams
): Promise<{ amount: number }> {
  const { tenant, walletId, dateFrom, dateTo } = params
  const clauses = [
    eq(ledgerEntries.tenant, tenant),
    eq(ledgerEntries.walletId, walletId),
    eq(ledgerEntries.type, 'credit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' IN ('bonus_release', 'bonus_instant_cash_transfer', 'bonus_instant_cash', 'bonus_to_cash'))`,
  ]
  if (dateFrom) clauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) clauses.push(lte(ledgerEntries.createdAt, dateTo))
  const [row] = await db
    .select({
      amount: sql<number>`COALESCE(SUM((${ledgerEntries.amount})::numeric), 0)`,
    })
    .from(ledgerEntries)
    .where(and(...clauses))
  return { amount: Number(row?.amount ?? 0) }
}

/** Sum of credit amounts where meta.type is referral_balance_to_cash (referral balance transferred to cash). */
export async function getReferralToCashTransferStatsDb(
  params: BonusToCashTransferParams
): Promise<{ amount: number }> {
  const { tenant, walletId, dateFrom, dateTo } = params
  const clauses = [
    eq(ledgerEntries.tenant, tenant),
    eq(ledgerEntries.walletId, walletId),
    eq(ledgerEntries.type, 'credit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' = 'referral_balance_to_cash')`,
  ]
  if (dateFrom) clauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) clauses.push(lte(ledgerEntries.createdAt, dateTo))
  const [row] = await db
    .select({
      amount: sql<number>`COALESCE(SUM((${ledgerEntries.amount})::numeric), 0)`,
    })
    .from(ledgerEntries)
    .where(and(...clauses))
  return { amount: Number(row?.amount ?? 0) }
}

export async function getLedgerAggregatesByWalletDb(params: LedgerFilter) {
  // Query deposit and withdrawal request tables directly for accurate stats
  // This matches the same source of truth used by the player list
  const { tenant, dateFrom, dateTo } = params
  
  // Deposits/withdrawals are bucketed by the date money actually moved (admin approval),
  // not the request date. A withdrawal requested on day 1 but approved on day 3 counts on day 3.
  const depositSettledAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt)
  const withdrawalSettledAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt)

  // Build deposit conditions
  const depositConditions: any[] = [
    eq(depositRequests.tenant, tenant),
    eq(depositRequests.status, 'APPROVED' as any)
  ]
  if (dateFrom) depositConditions.push(gte(depositSettledAt, dateFrom))
  if (dateTo) depositConditions.push(lte(depositSettledAt, dateTo))

  // Build withdrawal conditions
  const withdrawalConditions: any[] = [
    eq(withdrawalRequests.tenant, tenant),
    eq(withdrawalRequests.status, 'COMPLETED' as any)
  ]
  if (dateFrom) withdrawalConditions.push(gte(withdrawalSettledAt, dateFrom))
  if (dateTo) withdrawalConditions.push(lte(withdrawalSettledAt, dateTo))
  
  // Query both tables in parallel
  const [depositResult, withdrawalResult] = await Promise.all([
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        volume: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
      })
      .from(depositRequests)
      .where(and(...depositConditions)),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        volume: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
      })
      .from(withdrawalRequests)
      .where(and(...withdrawalConditions)),
  ])

  return {
    depositCount: Number(depositResult[0]?.count ?? 0),
    depositVolume: Number(depositResult[0]?.volume ?? 0),
    withdrawalCount: Number(withdrawalResult[0]?.count ?? 0),
    withdrawalVolume: Number(withdrawalResult[0]?.volume ?? 0),
  }
}

export type ManualDepositWithdrawalParams = {
  tenant: string
  walletId: number
  dateFrom?: Date
  dateTo?: Date
}

export type ManualDepositWithdrawalTenantParams = {
  tenant: string
  dateFrom?: Date
  dateTo?: Date
}

/**
 * Tenant-wide manual deposit/withdrawal stats (for dashboard KPIs).
 * Sums all admin-initiated deposits and withdrawals across all wallets for a tenant.
 */
export async function getManualDepositWithdrawalStatsTenantDb(
  params: ManualDepositWithdrawalTenantParams
): Promise<{
  manualDepositCount: number
  manualDepositVolume: number
  manualWithdrawalCount: number
  manualWithdrawalVolume: number
}> {
  const { tenant, dateFrom, dateTo } = params
  const baseClauses = [eq(ledgerEntries.tenant, tenant)]

  const manualDepositClauses = [
    ...baseClauses,
    eq(ledgerEntries.type, 'credit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
    sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
  ]
  if (dateFrom) manualDepositClauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) manualDepositClauses.push(lte(ledgerEntries.createdAt, dateTo))

  const manualWithdrawalClauses = [
    ...baseClauses,
    eq(ledgerEntries.type, 'debit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
  ]
  if (dateFrom) manualWithdrawalClauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) manualWithdrawalClauses.push(lte(ledgerEntries.createdAt, dateTo))

  const [manualDepositResult, manualWithdrawalResult] = await Promise.all([
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(and(...manualDepositClauses)),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(and(...manualWithdrawalClauses)),
  ])

  return {
    manualDepositCount: Number(manualDepositResult[0]?.count ?? 0),
    manualDepositVolume: Number(manualDepositResult[0]?.volume ?? 0),
    manualWithdrawalCount: Number(manualWithdrawalResult[0]?.count ?? 0),
    manualWithdrawalVolume: Number(manualWithdrawalResult[0]?.volume ?? 0),
  }
}

export async function getManualDepositWithdrawalStatsDb(
  params: ManualDepositWithdrawalParams
): Promise<{
  manualDepositCount: number
  manualDepositVolume: number
  manualWithdrawalCount: number
  manualWithdrawalVolume: number
}> {
  const { tenant, walletId, dateFrom, dateTo } = params
  const baseClauses = [eq(ledgerEntries.tenant, tenant), eq(ledgerEntries.walletId, walletId)]

  // Manual deposits: credit with (meta.type='deposit' OR meta.type='admin_adjustment') and NO depositRequestId
  // (not from deposit_requests approval - those have depositRequestId)
  const manualDepositClauses = [
    ...baseClauses,
    eq(ledgerEntries.type, 'credit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
    sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
  ]
  if (dateFrom) manualDepositClauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) manualDepositClauses.push(lte(ledgerEntries.createdAt, dateTo))

  // Manual withdrawals: debit with meta.type='withdrawal' or 'admin_adjustment'
  // (adjustWallet; direct withdrawals use type='withdrawal_pending' and are in withdrawal_requests)
  const manualWithdrawalClauses = [
    ...baseClauses,
    eq(ledgerEntries.type, 'debit'),
    sql`${ledgerEntries.meta} IS NOT NULL`,
    sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
  ]
  if (dateFrom) manualWithdrawalClauses.push(gte(ledgerEntries.createdAt, dateFrom))
  if (dateTo) manualWithdrawalClauses.push(lte(ledgerEntries.createdAt, dateTo))

  // Use meta.originalAmount - the exact amount entered at transaction time (avoids base-currency conversion errors).
  // adjustWalletDb always sets originalAmount; NULLIF handles empty string before numeric cast.
  const [manualDepositResult, manualWithdrawalResult] = await Promise.all([
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(and(...manualDepositClauses)),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(and(...manualWithdrawalClauses)),
  ])

  return {
    manualDepositCount: Number(manualDepositResult[0]?.count ?? 0),
    manualDepositVolume: Number(manualDepositResult[0]?.volume ?? 0),
    manualWithdrawalCount: Number(manualWithdrawalResult[0]?.count ?? 0),
    manualWithdrawalVolume: Number(manualWithdrawalResult[0]?.volume ?? 0),
  }
}

