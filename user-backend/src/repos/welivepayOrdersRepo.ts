import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { welivepayOrders, depositRequests, wallets, ledgerEntries } from '@shared/db/schema.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { deductWhitelabelCredit } from '@shared/services/whitelabelCreditDeduct.js'
import { getRgBlockState } from '@shared/services/rgEnforcement.js'
import type { VipDatabase } from '@shared/vip/depositAccess.js'

/**
 * Best-effort, post-commit deposit side effects, mirroring admin-backend approveDepositRequest:
 * VIP points + deposit-bonus campaign awards. Never throws — failures here must not affect the
 * already-committed wallet credit (the webhook still returns 200 and the deposit stands).
 */
async function awardWelivepayDepositSideEffects(p: {
  userId: number
  tenant: string
  amount: number
  depositRequestId: number | null
}): Promise<void> {
  try {
    const { vipService } = await import('../services/vipService.js')
    await vipService.awardPointsFromDeposit(p.userId, p.tenant, p.amount, p.depositRequestId ?? 0)
  } catch {
    // VIP points are non-critical; ignore.
  }
  try {
    const { findEligibleCampaignsForDepositTriggers, awardBonus } = await import('@shared/services/bonusService.js')
    const campaigns = await findEligibleCampaignsForDepositTriggers(p.tenant, db as any)
    for (const campaign of campaigns) {
      // Pass our db as the executor so awardBonus does not fall back to a fragile cross-package import.
      await awardBonus({ userId: p.userId, tenant: p.tenant, campaignId: campaign.id, depositAmount: p.amount, tx: db as any })
    }
  } catch {
    // Bonus awards are non-critical; ignore.
  }
}

export type WelivepayOrderRow = typeof welivepayOrders.$inferSelect

type OrderStatusish = { status: string; amount: string }

/** Pure decision: should this webhook credit the wallet? Centralized for testability. */
export function shouldCreditOnWebhook(
  order: OrderStatusish,
  payloadStatus: string,
  payloadAmount: number
): { credit: boolean; reason?: 'already_processed' | 'amount_mismatch' | 'not_success' } {
  if (order.status !== 'pending') return { credit: false, reason: 'already_processed' }
  if (payloadStatus !== 'success') return { credit: false, reason: 'not_success' }
  if (Number(order.amount) !== Number(payloadAmount)) return { credit: false, reason: 'amount_mismatch' }
  return { credit: true }
}

/**
 * Create the pending gateway order at initiation. Deliberately does NOT create a
 * `deposit_requests` row yet — a PENDING deposit row here would (a) appear in the admin
 * approval queue where it could be manually approved without payment, AND then be credited
 * AGAIN by the webhook (double credit), and (b) leave orphan PENDING rows for abandoned
 * payments. The `deposit_requests` row is created as APPROVED only on webhook success
 * (see creditOrderOnSuccess). `welivepay_orders` is the source of truth for pending state.
 */
export async function createWelivepayOrder(params: {
  tenant: string; userId: number; orderid: string; amount: number; paymentLink: string | null; vipPolicySnapshot?: unknown
}, executor: VipDatabase = db): Promise<WelivepayOrderRow> {
  const [order] = await executor.insert(welivepayOrders).values({
    tenant: params.tenant, userId: params.userId, orderid: params.orderid,
    amount: String(params.amount), status: 'pending',
    paymentLink: params.paymentLink, depositRequestId: null, vipPolicySnapshot: params.vipPolicySnapshot,
  }).returning()
  return order
}

export async function findOrderByOrderId(orderid: string): Promise<WelivepayOrderRow | null> {
  const [row] = await db.select().from(welivepayOrders).where(eq(welivepayOrders.orderid, orderid)).limit(1)
  return row ?? null
}

export async function setOrderPaymentLink(orderid: string, paymentLink: string): Promise<void> {
  await db.update(welivepayOrders)
    .set({ paymentLink, updatedAt: new Date() })
    .where(eq(welivepayOrders.orderid, orderid))
}

export async function markOrderStatus(orderid: string, status: 'expired' | 'invalid', txnRef?: string | null): Promise<void> {
  await db.update(welivepayOrders)
    .set({ status, txnRef: txnRef ?? null, updatedAt: new Date() })
    .where(eq(welivepayOrders.orderid, orderid))
}

/**
 * Mark pending orders older than `olderThanMs` as expired (background cleanup).
 * Only touches status='pending' rows, so it can never override a success/credit and is
 * idempotent + safe to run on multiple instances. Returns the number of rows expired.
 */
export async function expireStaleWelivepayOrders(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const rows = await db.update(welivepayOrders)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(welivepayOrders.status, 'pending'), lt(welivepayOrders.createdAt, cutoff)))
    .returning({ id: welivepayOrders.id })
  return rows.length
}

/**
 * Credit the wallet for a successful order, in ONE transaction, mirroring the admin-backend
 * deposit-approval path (adjustWalletDb + approveDepositRequest): whitelabel-credit deduction +
 * wallet cash credit + legacy ledger_entries row + wallet_ledger row + mark depositRequest APPROVED +
 * mark order success.
 *
 * Idempotent: re-running for a non-pending order is a no-op (the FOR UPDATE lock + status recheck
 * inside the transaction prevents a concurrent double credit).
 *
 * NOTE on balances (mirrors adjustWalletDb exactly):
 *  - `wallets.cash` and the legacy `ledger_entries` row use RAW cash (cash, cash+amount).
 *  - `wallet_ledger` (createWalletLedgerEntry) uses the DISPLAY balance for cash:
 *    max(0, cash - exposure). A deposit raises both raw cash and the display balance by `amount`.
 */
export async function creditOrderOnSuccess(params: { orderid: string; txnRef: string | null }): Promise<{ credited: boolean }> {
  const result = await db.transaction(async (tx) => {
    // Lock the order row FOR UPDATE so concurrent/retried webhooks for the same
    // order serialize here: the second waits, then reads status='success' and bails
    // BEFORE any wallet credit. (Locking only the wallet is insufficient — both
    // callers could pass the pending check before either commits.)
    const [order] = await tx.select().from(welivepayOrders)
      .where(eq(welivepayOrders.orderid, params.orderid)).for('update').limit(1)
    if (!order || order.status !== 'pending') return { credited: false as const }

    const amount = Number(order.amount)
    const tenant = order.tenant
    const isWhitelabel = Boolean(tenant) && tenant !== 'default'

    // The player may have been blocked between starting the payment and the
    // gateway calling back. The money has already left their card, so the
    // order is still settled — refusing here would strand it at the provider.
    // It is recorded loudly instead, because a credit landing in a blocked
    // account is something a desk has to act on rather than discover later.
    const rgState = await getRgBlockState(tenant, order.userId, tx as never)
    if (rgState.blocked) {
      console.warn('[welivepay] credited a responsible-gambling blocked player', {
        orderid: order.orderid,
        userId: order.userId,
        tenant,
        reason: rgState.reason,
      })
    }

    if (isWhitelabel) {
      await deductWhitelabelCredit(
        tx as any, tenant, amount, 'INR',
        `Player deposit (WeLivePay) - order ${order.orderid}`,
        { userId: order.userId }
      )
    }

    // Lock the wallet row, then re-read locked state.
    const [wallet] = await tx.select().from(wallets)
      .where(and(eq(wallets.userId, order.userId), eq(wallets.tenant, tenant))).limit(1)
    if (!wallet) throw new Error('Wallet not found')
    await tx.execute(sql`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`)
    const [locked] = await tx.select().from(wallets).where(eq(wallets.id, wallet.id))
    const w = locked ?? wallet

    // Raw cash balances (for wallets.cash + legacy ledger_entries).
    const balanceBefore = Number(w.cash ?? 0)
    const balanceAfter = balanceBefore + amount
    // Display balances for wallet_ledger (cash minus sports exposure), mirroring adjustWalletDb.
    const exposure = Number(w.exposure ?? 0)
    const ledgerBefore = Math.max(0, balanceBefore - exposure)
    const ledgerAfter = Math.max(0, balanceAfter - exposure)

    await tx.update(wallets).set({ cash: String(balanceAfter) }).where(eq(wallets.id, w.id))

    // Create the deposit_requests row already APPROVED (it is never PENDING for gateway
    // deposits, so it can't be manually approved without payment). reviewerId 0 = system.
    // Created BEFORE the ledger entry so the ledger meta can carry depositRequestId.
    const [deposit] = await tx.insert(depositRequests).values({
      tenant, userId: order.userId, amount: String(amount), currency: 'INR',
      method: 'UPI', utr: params.txnRef, referenceId: order.orderid, proofKey: 'welivepay',
      status: 'APPROVED', reviewerId: 0, reviewedAt: new Date(),
      createdAt: order.createdAt, vipPolicySnapshot: order.vipPolicySnapshot,
      note: 'Auto-approved via WeLivePay webhook',
      balanceBefore: String(balanceBefore), balanceAfter: String(balanceAfter),
    }).returning()

    // Legacy ledger entry. meta.depositRequestId is REQUIRED so the admin "Transactions" view
    // dedupes the deposit_requests row against this ledger entry (deposit shows once, not twice),
    // exactly like the manual deposit-approval path (adjustWalletDb).
    const [ledger] = await tx.insert(ledgerEntries).values({
      tenant, walletId: w.id, type: 'credit', amount: String(amount),
      balanceBefore: String(balanceBefore), balanceAfter: String(balanceAfter),
      meta: {
        type: 'deposit', method: 'UPI', provider: 'WELIVEPAY',
        orderid: order.orderid, txnRef: params.txnRef,
        originalAmount: amount, depositRequestId: deposit.id,
      },
    }).returning()

    // Link the deposit row to its ledger entry.
    await tx.update(depositRequests).set({ walletTxnId: ledger.id }).where(eq(depositRequests.id, deposit.id))

    await createWalletLedgerEntry(tx as any, {
      tenant, walletId: w.id, userId: order.userId,
      walletType: 'cash', category: 'deposit', direction: 'credit',
      amount, balanceBefore: ledgerBefore, balanceAfter: ledgerAfter,
      description: 'Deposit (WeLivePay UPI)',
      referenceType: 'deposit_request', referenceId: String(deposit.id),
      meta: { provider: 'WELIVEPAY', txnRef: params.txnRef, orderid: order.orderid, depositRequestId: deposit.id },
    })

    await tx.update(welivepayOrders).set({
      status: 'success', txnRef: params.txnRef, depositRequestId: deposit.id, updatedAt: new Date(),
    }).where(and(eq(welivepayOrders.id, order.id), eq(welivepayOrders.status, 'pending')))

    return {
      credited: true as const,
      userId: order.userId,
      tenant,
      amount,
      depositRequestId: deposit.id,
    }
  })

  // Post-commit, best-effort parity with manual deposit approval (VIP points + deposit bonuses).
  if (result.credited) {
    await awardWelivepayDepositSideEffects({
      userId: result.userId,
      tenant: result.tenant,
      amount: result.amount,
      depositRequestId: result.depositRequestId,
    })
  }

  return { credited: result.credited }
}
