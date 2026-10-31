import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { updateWithdrawalStatusAdmin, getWithdrawalRequestById, getPayoutAccount, getUserBasic } from '@/repos/payments/withdrawalRequestsRepo.js'
import { approvePayoutAccount as approvePayoutAccountRepo, rejectPayoutAccount as rejectPayoutAccountRepo } from '@/repos/payments/payoutAccountsRepo.js'
import { NotificationsRepo } from '@/repos/notifications/notificationsRepo.js'
import { NotificationService } from '@/domains/notifications/services/NotificationService.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { pgSettingsMutationResolvers } from './pgSettings.js'

/**
 * The acting admin's numeric id.
 *
 * The context puts it in `sub`; `id` is never set. Three call sites here read
 * only `ctx.user.id`, so a withdrawal approval, a payout-account approval and a
 * payout-account rejection each recorded no reviewer at all.
 */
function reviewerIdOf(ctx: any): number | null {
  const raw = ctx?.user?.sub ?? ctx?.user?.id
  const n = raw != null ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export const paymentsMutationResolvers = {
  ...pgSettingsMutationResolvers,
  setWithdrawalStatus: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'approve') && !hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'reject')) {
      throw new Error('Forbidden: insufficient permissions to update withdrawal status')
    }
    const input = args?.input ?? args
    const nextStatus = String(input?.status || '').toUpperCase()
    const allowed = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
    if (!allowed.has(nextStatus)) {
      throw new Error('Invalid status')
    }
    const before = await getWithdrawalRequestById(Number(input?.id), tenant)
    const updated = await updateWithdrawalStatusAdmin(
      Number(input?.id),
      tenant,
      nextStatus,
      // `ctx.user` carries the admin id as `sub`; `id` is never populated, so
      // every withdrawal approval and rejection was stored with a null reviewer.
      // The siblings below already fall back to `sub` — these did not.
      reviewerIdOf(ctx) ?? undefined,
      input?.note
    )
    if (!updated) {
      return { success: false, message: 'Not found' }
    }
    
    // Publish whitelabel credit subscription when withdrawal is completed and whitelabel credit was adjusted
    const isWhitelabel = tenant && tenant !== 'default'
    if (nextStatus === 'COMPLETED' && updated.amount && isWhitelabel && ctx?.pubsub) {
      try {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        
        // Use effectiveWhitelabelId (same logic as subscription resolver) to ensure topic matches
        const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
        const directorTenant = getEffectiveTenantForDirector(ctx)
        const effectiveWhitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? tenant)
        const updatedCredit = await whitelabelCreditService.getCreditAllocation(effectiveWhitelabelId)
        const topic = `WHITELABEL_CREDIT_${effectiveWhitelabelId}`
        
        // Map isNearThreshold to isNearLimit for GraphQL schema compatibility
        const whitelabelCreditInfo = {
          creditLimit: updatedCredit.creditLimit,
          creditUsed: updatedCredit.creditUsed,
          creditAvailable: updatedCredit.creditAvailable,
          creditAlertThreshold: updatedCredit.creditAlertThreshold,
          usagePercentage: Math.round(updatedCredit.usagePercentage * 100) / 100,
          isNearLimit: updatedCredit.isNearThreshold, // Map isNearThreshold to isNearLimit
        }
        
        ctx.pubsub.publish({
          topic,
          payload: { whitelabelCreditUpdated: whitelabelCreditInfo },
        }).catch((err: Error) => {
        })
      } catch (err: any) {
        // Don't fail mutation if subscription fails
      }
    }
    // Record audit
    await recordAuditDb({
      tenant,
      actorId: ctx?.user?.id ? String(ctx.user.id) : ctx?.user?.sub ? String(ctx.user.sub) : 'system',
      domain: 'payments',
      action: 'withdrawal_status_update',
      resourceType: 'withdrawal_request',
      resourceId: String(input?.id),
      before: before
        ? {
            status: before.status,
            note: before.note ?? null,
            amount: Number(before.amount ?? 0),
            payoutAccountId: before.payoutAccountId ? String(before.payoutAccountId) : null,
          }
        : null,
      after: {
        status: nextStatus,
        note: input?.note ?? null,
        amount: Number(updated.amount ?? 0),
        payoutAccountId: updated.payoutAccountId ? String(updated.payoutAccountId) : null,
        reviewerId: ctx?.user?.id ? String(ctx.user.id) : ctx?.user?.sub ? String(ctx.user.sub) : null,
        reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
      },
    })

    // Also log under players domain so agent dashboard Recent Activity shows withdrawal activity
    if (nextStatus !== 'PENDING' && nextStatus !== 'PROCESSING' && updated.userId) {
      recordAuditDb({
        tenant,
        actorId: ctx?.user?.id ? String(ctx.user.id) : ctx?.user?.sub ? String(ctx.user.sub) : 'system',
        domain: 'players',
        action: 'withdrawal_status_update',
        resourceType: 'player',
        resourceId: String(updated.userId),
        after: {
          status: nextStatus,
          amount: Number(updated.amount ?? 0),
        },
      }).catch(() => {})
    }

    // Mark related task notifications as read when withdrawal is no longer pending
    if (nextStatus !== 'PENDING' && nextStatus !== 'PROCESSING') {
      try {
        const notificationsRepo = new NotificationsRepo()
        const notificationService = new NotificationService(notificationsRepo)
        await notificationService.markNotificationsReadForWithdrawalRequest(Number(input?.id), { tenant })
      } catch (err: any) {
      }
    }

    const account = updated.payoutAccountId ? await getPayoutAccount(updated.payoutAccountId, tenant) : null
    const user = await getUserBasic(updated.userId, tenant).catch(() => null)
    return {
      success: true,
      message: `Updated to ${nextStatus}`,
      request: {
        id: String(updated.id),
        userId: String(updated.userId),
        amount: Number(updated.amount ?? 0),
        currency: updated.currency,
        status: updated.status,
        reviewerId: updated.reviewerId ? String(updated.reviewerId) : null,
        reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
        note: updated.note,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        account: account
          ? {
              id: String(account.id),
              method: account.method,
              accountNumber: account.accountNumber,
              ifscCode: account.ifscCode,
              bankName: account.bankName,
              accountHolderName: account.accountHolderName,
            }
          : null,
        user: user
          ? {
              id: String(user.id),
              name: user.name,
              phone: user.phone,
              email: user.email,
            }
          : null,
      },
    }
  },

  approvePayoutAccount: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'approve')) {
      throw new Error('Forbidden: insufficient permissions to approve payout accounts')
    }
    const input = args?.input ?? args
    const id = Number(input?.id)
    if (!id) return { success: false, message: 'Invalid account id', account: null }
    const rawReviewerId = reviewerIdOf(ctx)
    const reviewerId = rawReviewerId && rawReviewerId > 0 ? rawReviewerId : null
    const account = await approvePayoutAccountRepo(id, tenant, reviewerId)
    if (!account) return { success: false, message: 'Payout account not found', account: null }
    return {
      success: true,
      message: 'Account approved',
      account: {
        id: String(account.id),
        userId: String(account.userId),
        method: account.method,
        accountNumber: account.accountNumber,
        ifscCode: account.ifscCode,
        bankName: account.bankName,
        accountHolderName: account.accountHolderName,
        approvalStatus: account.approvalStatus,
        rejectionReason: account.rejectionReason,
        approvedBy: account.approvedBy ? String(account.approvedBy) : null,
        approvedAt: account.approvedAt ? account.approvedAt.toISOString() : null,
        createdAt: account.createdAt.toISOString(),
        user: {
          id: String(account.userId),
          name: account.userName,
          phone: account.userPhone,
          email: account.userEmail,
        },
      },
    }
  },

  rejectPayoutAccount: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    if (!hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'reject')) {
      throw new Error('Forbidden: insufficient permissions to reject payout accounts')
    }
    const input = args?.input ?? args
    const id = Number(input?.id)
    if (!id) return { success: false, message: 'Invalid account id', account: null }
    const rawReviewerId = reviewerIdOf(ctx)
    const reviewerId = rawReviewerId && rawReviewerId > 0 ? rawReviewerId : null
    const reason = input?.reason ?? null
    const account = await rejectPayoutAccountRepo(id, tenant, reviewerId, reason)
    if (!account) return { success: false, message: 'Payout account not found', account: null }
    return {
      success: true,
      message: 'Account rejected',
      account: {
        id: String(account.id),
        userId: String(account.userId),
        method: account.method,
        accountNumber: account.accountNumber,
        ifscCode: account.ifscCode,
        bankName: account.bankName,
        accountHolderName: account.accountHolderName,
        approvalStatus: account.approvalStatus,
        rejectionReason: account.rejectionReason,
        approvedBy: account.approvedBy ? String(account.approvedBy) : null,
        approvedAt: account.approvedAt ? account.approvedAt.toISOString() : null,
        createdAt: account.createdAt.toISOString(),
        user: {
          id: String(account.userId),
          name: account.userName,
          phone: account.userPhone,
          email: account.userEmail,
        },
      },
    }
  },
}


