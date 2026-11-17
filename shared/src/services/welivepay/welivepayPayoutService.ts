import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { welivepayPayouts, whitelabelPgSettings, withdrawalRequests, userPayoutAccounts, users, wallets, ledgerEntries } from '../../db/schema.js'
import { decrypt } from '../../security/cryptoVault.js'
import { createWalletLedgerEntry } from '../walletLedgerService.js'
import { releaseWhitelabelCredit } from '../whitelabelCreditDeduct.js'
import { createWelivepayPayout, getWelivepayPayout, validatePayoutRequest, WelivepayApiError, type PayoutDetail, type PayoutRequest } from './welivepayClient.js'

/**
 * WeLivePay IMPS payouts for withdrawals, ported from the gw project. Shared because the approving admin
 * (admin-backend) and the callbacks/reconciliation (user-backend) settle the same rows.
 *
 * Settlement follows this repo's manual withdrawal path (admin-backend updateWithdrawalStatusAdmin):
 * success marks the withdrawal COMPLETED with a zero-amount `withdrawal_completed` ledger marker and
 * releases the whitelabel credit; a failure refunds the reserved cash once with `withdrawal_refund`
 * rows. Here every step runs in one transaction under the payout row lock.
 */
export type PayoutRow = typeof welivepayPayouts.$inferSelect
export const FINAL_PAYOUT_STATUSES = ['success', 'failed', 'rejected']

function canRejectPayout(row: PayoutRow): boolean {
  // The documented funding rejection happens before provider submission. Keep ambiguous
  // network failures reserved even if a status read temporarily returns not-found.
  const balanceRejected = /^Amount \+ fee exceeds the project[’']s withdrawable balance(?:\. Refresh status before retrying the same reference\.)?$/.test(row.failureReason ?? '')
  return row.status === 'pending' && !row.payoutId && !row.merchantTransactionId && !row.utr && (!row.submittedAt || balanceRejected)
}

export function verifyPayoutDetail(request: PayoutRequest, detail: PayoutDetail): void {
  if (detail.orderId !== request.orderid || detail.amount !== request.amount || detail.beneficiaryAccount !== request.beneficiaryAccount || detail.beneficiaryIFSC !== request.beneficiaryIFSC) {
    throw new Error('Payout reference, amount or beneficiary verification mismatch')
  }
}

export function payoutView(row: PayoutRow) {
  return { orderId: row.orderid, status: row.status, amount: Number(row.amount), utr: row.utr, failureReason: row.failureReason, merchantTransactionId: row.merchantTransactionId, canReject: canRejectPayout(row) }
}

/** Shared by the approving admin and user-backend callbacks/reconciliation. */
export class WelivepayPayoutService {
  constructor(private readonly db: any, private readonly baseUrl: string) {}

  async findByOrderId(orderid: string, tenant: string): Promise<PayoutRow | null> {
    const [row] = await this.db.select().from(welivepayPayouts).where(and(eq(welivepayPayouts.orderid, orderid), eq(welivepayPayouts.tenant, tenant))).limit(1)
    return row ?? null
  }

  async findByWithdrawal(withdrawalId: number, tenant: string): Promise<PayoutRow | null> {
    const [row] = await this.db.select().from(welivepayPayouts).where(and(eq(welivepayPayouts.withdrawalRequestId, withdrawalId), eq(welivepayPayouts.tenant, tenant))).limit(1)
    return row ?? null
  }

  private async credentials(tenant: string, snapshot?: string | null) {
    const [settings] = await this.db.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
    const cipher = snapshot || settings?.secretSiteKeyEncrypted
    if (!cipher) throw new Error('WeLivePay merchant key is not configured')
    return { settings, baseUrl: this.baseUrl, key: decrypt(cipher) }
  }

  private async prepare(withdrawalId: number, tenant: string, reviewerId: number): Promise<PayoutRow> {
    return this.db.transaction(async (tx: any) => {
      const [withdrawal] = await tx.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.id, withdrawalId), eq(withdrawalRequests.tenant, tenant))).for('update').limit(1)
      if (!withdrawal) throw new Error('Withdrawal not found')
      const [existing] = await tx.select().from(welivepayPayouts).where(eq(welivepayPayouts.withdrawalRequestId, withdrawalId)).limit(1)
      if (existing) {
        if (existing.tenant !== tenant) throw new Error('Payout tenant mismatch')
        return existing
      }
      const [settings] = await tx.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
      if (!settings?.payoutEnabled || !settings.secretSiteKeyEncrypted) throw new Error('Enable WeLivePay payouts in PG settings first')
      if (withdrawal.status !== 'PENDING') throw new Error('Only a pending withdrawal can be sent to WeLivePay')
      if (withdrawal.currency !== 'INR') throw new Error('WeLivePay payouts support INR withdrawals only')
      const amount = Number(withdrawal.amount)
      if (settings.minPayout != null && amount < Number(settings.minPayout)) throw new Error('Withdrawal is below the configured gateway payout minimum')
      if (settings.maxPayout != null && amount > Number(settings.maxPayout)) throw new Error('Withdrawal exceeds the configured gateway payout maximum')
      // A deleted account is never paid to (deleting one is already refused while a withdrawal is pending or processing).
      const [account] = await tx.select().from(userPayoutAccounts).where(and(eq(userPayoutAccounts.id, withdrawal.payoutAccountId), eq(userPayoutAccounts.tenant, tenant), eq(userPayoutAccounts.userId, withdrawal.userId), isNull(userPayoutAccounts.deletedAt))).limit(1)
      if (!account || account.method !== 'BANK' || account.approvalStatus !== 'APPROVED') throw new Error('An approved bank account is required for WeLivePay IMPS payout')
      const [user] = await tx.select().from(users).where(and(eq(users.id, withdrawal.userId), eq(users.tenant, tenant))).limit(1)
      const [reservation] = withdrawal.ledgerTxnId ? await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.id, withdrawal.ledgerTxnId), eq(ledgerEntries.tenant, tenant))).limit(1) : []
      if (!withdrawal.walletId || !reservation || reservation.walletId !== withdrawal.walletId || Number(reservation.amount) !== -amount || reservation.type !== 'withdrawal_pending') throw new Error('Withdrawal funds have not been reserved')
      const request = validatePayoutRequest({
        orderid: `WLP_WD_${withdrawalId}_${randomUUID().replace(/-/g, '').slice(0, 20)}`, amount, payoutType: 'IMPS',
        beneficiaryAccount: account.accountNumber, beneficiaryIFSC: account.ifscCode ?? '', beneficiaryName: account.accountHolderName,
        beneficiaryMobNo: user?.phone ?? '', bankName: account.bankName ?? '', payoutRemark: `Withdrawal ${withdrawalId}`,
      })
      const [row] = await tx.insert(welivepayPayouts).values({ tenant, withdrawalRequestId: withdrawalId, orderid: request.orderid, gateway: settings.payoutGateway, merchantKeyEncrypted: settings.secretSiteKeyEncrypted, amount: String(amount), request }).returning()
      await tx.update(withdrawalRequests).set({ status: 'PROCESSING', reviewerId, reviewedAt: new Date(), note: `WeLivePay payout ${request.orderid}`, updatedAt: new Date() }).where(eq(withdrawalRequests.id, withdrawalId))
      return row
    })
  }

  async submit(withdrawalId: number, tenant: string, reviewerId: number): Promise<PayoutRow> {
    const row = await this.prepare(withdrawalId, tenant, reviewerId)
    if (FINAL_PAYOUT_STATUSES.includes(row.status)) return row
    const credentials = await this.credentials(tenant, row.merchantKeyEncrypted)
    if (!credentials.settings.payoutEnabled) throw new Error('New payout submissions are disabled; refresh the existing payout status')
    // Durable lease prevents concurrent admin clicks from starting concurrent submissions.
    const [claimed] = await this.db.update(welivepayPayouts).set({ submittedAt: new Date(), nextCheckAt: new Date(Date.now() + 120_000) }).where(and(
      eq(welivepayPayouts.id, row.id), inArray(welivepayPayouts.status, ['pending', 'requested', 'processing']),
      or(isNull(welivepayPayouts.submittedAt), lt(welivepayPayouts.submittedAt, new Date(Date.now() - 30_000))),
    )).returning()
    if (!claimed) return (await this.findByOrderId(row.orderid, tenant))!
    try {
      if (row.submittedAt) {
        try {
          const current = await getWelivepayPayout({ ...credentials, orderid: row.orderid })
          if (current.status !== 'requested') return this.applyDetail(row, current)
          verifyPayoutDetail(row.request, current)
        } catch (error) {
          if (!(error instanceof WelivepayApiError) || error.statusCode !== 404) throw error
        }
      }
      // Never rebuild the body from a mutable bank account or assign a new reference for a retry.
      const result = await createWelivepayPayout({ ...credentials, gateway: row.gateway, payout: row.request })
      return await this.applyDetail(row, result)
    } catch (error) {
      // An HTTP/network error is not a failed transfer. Keep the wallet reservation.
      const reason = error instanceof WelivepayApiError && error.statusCode > 0 ? `${error.message}. Refresh status before retrying the same reference.` : 'Provider outcome unconfirmed. Refresh status or retry the same payout reference.'
      await this.db.update(welivepayPayouts).set({ failureReason: reason, updatedAt: new Date() }).where(and(eq(welivepayPayouts.id, row.id), inArray(welivepayPayouts.status, ['pending', 'requested', 'processing'])))
      return (await this.findByOrderId(row.orderid, tenant))!
    }
  }

  async reconcile(orderid: string, tenant: string): Promise<PayoutRow> {
    const row = await this.findByOrderId(orderid, tenant)
    if (!row) throw new Error('Payout not found')
    if (FINAL_PAYOUT_STATUSES.includes(row.status)) return row
    const credentials = await this.credentials(tenant, row.merchantKeyEncrypted)
    const result = await getWelivepayPayout({ ...credentials, orderid })
    return this.applyDetail(row, result)
  }

  async reject(withdrawalId: number, tenant: string, reviewerId: number, note: string): Promise<PayoutRow> {
    const reason = note.trim()
    if (!reason || reason.length > 500) throw new Error('Enter a rejection reason (maximum 500 characters)')
    return this.db.transaction(async (tx: any) => {
      // Hold the same lock used by submission claims and reconciliation until refund commits.
      const [row] = await tx.select().from(welivepayPayouts).where(and(eq(welivepayPayouts.withdrawalRequestId, withdrawalId), eq(welivepayPayouts.tenant, tenant))).for('update').limit(1)
      if (!row) throw new Error('No WeLivePay payout for this withdrawal')
      if (row.status === 'rejected') return row
      if (!canRejectPayout(row)) {
        throw new Error('Only an unsent payout or a confirmed balance rejection can be rejected here. Refresh gateway status for a processing or unconfirmed payout.')
      }
      if (row.submittedAt && new Date(row.submittedAt).getTime() > Date.now() - 30_000) {
        throw new Error('A payout submission is in progress. Wait a moment and try again.')
      }
      const credentials = await this.credentials(tenant, row.merchantKeyEncrypted)
      try {
        await getWelivepayPayout({ ...credentials, orderid: row.orderid })
      } catch (error) {
        // Only an authenticated not-found confirms that this reference was never accepted.
        // Timeouts, permission errors and provider outages must retain the reservation.
        if (!(error instanceof WelivepayApiError) || error.statusCode !== 404) throw error
        return this.settleDetail(tx, row, {
          orderId: row.orderid, amount: Number(row.amount), status: 'rejected',
          beneficiaryAccount: row.request.beneficiaryAccount, beneficiaryIFSC: row.request.beneficiaryIFSC,
          payoutId: null, merchantTransactionId: null, utr: null,
          failureReason: `Rejected by admin: ${reason}`,
        }, { reviewerId, note: reason })
      }
      throw new Error('This payout exists in WeLivePay. Refresh gateway status before rejecting; the wallet has not been refunded.')
    })
  }

  private async applyDetail(snapshot: PayoutRow, detail: PayoutDetail): Promise<PayoutRow> {
    verifyPayoutDetail(snapshot.request, detail)
    return this.db.transaction(async (tx: any) => {
      const [row] = await tx.select().from(welivepayPayouts).where(eq(welivepayPayouts.id, snapshot.id)).for('update').limit(1)
      if (FINAL_PAYOUT_STATUSES.includes(row.status)) return row
      return this.settleDetail(tx, row, detail)
    })
  }

  private async settleDetail(tx: any, row: PayoutRow, detail: PayoutDetail, rejection?: { reviewerId: number; note: string }): Promise<PayoutRow> {
    const final = FINAL_PAYOUT_STATUSES.includes(detail.status)
    if (final) {
      const [withdrawal] = await tx.select().from(withdrawalRequests).where(and(eq(withdrawalRequests.id, row.withdrawalRequestId), eq(withdrawalRequests.tenant, row.tenant))).for('update').limit(1)
      if (!withdrawal || !['PENDING', 'PROCESSING'].includes(withdrawal.status)) throw new Error('Withdrawal already settled; payout requires review')
      const success = detail.status === 'success', amount = Number(row.amount)
      if (success) {
        const [player] = await tx.select().from(users).where(and(eq(users.id, withdrawal.userId), eq(users.tenant, row.tenant))).limit(1)
        await releaseWhitelabelCredit(tx, row.tenant, amount, withdrawal.currency ?? 'INR', `Player withdrawal completed (WeLivePay) - Withdrawal Request #${withdrawal.id}`, player ? {
          userId: player.id, playerName: player.name || undefined, playerEmail: player.email || undefined, playerUsername: player.username || undefined,
        } : { userId: withdrawal.userId })
      }
      const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.id, withdrawal.walletId), eq(wallets.tenant, row.tenant))).for('update').limit(1)
      if (!wallet) throw new Error('Wallet not found')
      const before = Number(wallet.cash ?? 0), after = success ? before : before + amount, exposure = Number(wallet.exposure ?? 0)
      if (!success) {
        await tx.update(wallets).set({ cash: String(after) }).where(eq(wallets.id, wallet.id))
        await tx.insert(ledgerEntries).values({ tenant: row.tenant, walletId: wallet.id, type: 'withdrawal_refund', amount: String(amount), balanceBefore: String(before), balanceAfter: String(after), meta: { withdrawalId: withdrawal.id, provider: 'WELIVEPAY', orderid: row.orderid } })
      }
      await createWalletLedgerEntry(tx, { tenant: row.tenant, walletId: wallet.id, userId: withdrawal.userId, walletType: 'cash', category: success ? 'withdrawal_completed' : 'withdrawal_refund', direction: 'credit', amount: success ? 0 : amount, balanceBefore: Math.max(0, before - exposure), balanceAfter: Math.max(0, after - exposure), description: success ? 'Withdrawal completed (WeLivePay)' : 'Withdrawal refunded (WeLivePay)', referenceType: 'withdrawal_request', referenceId: String(withdrawal.id), meta: { provider: 'WELIVEPAY', orderid: row.orderid, utr: detail.utr } })
      await tx.update(withdrawalRequests).set({
        status: rejection ? 'CANCELLED' : success ? 'COMPLETED' : 'FAILED',
        note: rejection ? `WeLivePay payout rejected: ${rejection.note}; order ${row.orderid}` : `WeLivePay ${detail.status}; order ${row.orderid}${detail.utr ? `; UTR ${detail.utr}` : ''}`,
        ...(rejection ? { reviewerId: rejection.reviewerId } : {}), updatedAt: new Date(), reviewedAt: new Date(),
      }).where(eq(withdrawalRequests.id, withdrawal.id))
    }
    const [updated] = await tx.update(welivepayPayouts).set({ status: detail.status, payoutId: detail.payoutId, merchantTransactionId: detail.merchantTransactionId, utr: detail.utr, failureReason: detail.failureReason, nextCheckAt: new Date(Date.now() + 120_000), updatedAt: new Date() }).where(eq(welivepayPayouts.id, row.id)).returning()
    return updated
  }
}
