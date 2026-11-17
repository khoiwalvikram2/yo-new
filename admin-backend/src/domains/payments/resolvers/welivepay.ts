import { hasPermission, ensureAgentCanMutate } from '@/domains/common/auth.js'
import { resolvePaymentTenant } from '../paymentTenant.js'
import { db } from '@/db/client.js'
import { WelivepayPayoutService, payoutView } from '@shared/services/welivepay/welivepayPayoutService.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'

const service = () => new WelivepayPayoutService(db, process.env.WELIVEPAY_BASE_URL || 'https://welivepay.in')

/** Commission agents never approve or reject withdrawals, whatever their role grants. */
async function assertNotCommissionAgent(ctx: any, verb: 'approve' | 'reject') {
  if (ctx?.user?.type === 'agent' && ctx.user.agentId) {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    if ((await new AgentsRepo().findById(ctx.user.agentId))?.schemeType === 'COMMISSION') throw new Error(`Commission agents cannot ${verb} withdrawals`)
  }
}

const actorId = (ctx: any) => String(ctx.user?.id ?? ctx.user?.sub ?? 'system')

/**
 * WeLivePay IMPS payouts for withdrawals. Each acts on the explicit payment whitelabel (a Super Admin
 * must select one) and keeps one immutable provider request per withdrawal; see WelivepayPayoutService.
 */
export const welivepayPayoutResolvers = {
  sendWelivepayPayout: async (_: unknown, { id }: { id: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'approve')) throw new Error('Forbidden: payout approval permission is required')
    await assertNotCommissionAgent(ctx, 'approve')
    const tenant = resolvePaymentTenant(ctx)
    const row = await service().submit(Number(id), tenant, Number(ctx.user?.sub ?? ctx.user?.id) || 0)
    await recordAuditDb({ tenant, actorId: actorId(ctx), domain: 'payments', action: 'welivepay_payout', resourceType: 'withdrawal_request', resourceId: id, after: { orderId: row.orderid, status: row.status }, pubsub: ctx.pubsub }).catch(() => {})
    return payoutView(row)
  },
  refreshWelivepayPayout: async (_: unknown, { id }: { id: string }, ctx: any) => {
    if (!['view', 'approve', 'reject'].some(action => hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', action))) throw new Error('Forbidden')
    const tenant = resolvePaymentTenant(ctx)
    const payouts = service()
    const row = await payouts.findByWithdrawal(Number(id), tenant)
    if (!row) throw new Error('No WeLivePay payout for this withdrawal')
    return payoutView(await payouts.reconcile(row.orderid, tenant))
  },
  rejectWelivepayPayout: async (_: unknown, { id, note }: { id: string; note: string }, ctx: any) => {
    ensureAgentCanMutate(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'payments.withdrawals', 'reject')) throw new Error('Forbidden: payout rejection permission is required')
    await assertNotCommissionAgent(ctx, 'reject')
    const tenant = resolvePaymentTenant(ctx)
    const row = await service().reject(Number(id), tenant, Number(ctx.user?.sub ?? ctx.user?.id) || 0, note)
    await recordAuditDb({ tenant, actorId: actorId(ctx), domain: 'payments', action: 'welivepay_payout_rejected', resourceType: 'withdrawal_request', resourceId: id, after: { orderId: row.orderid, status: row.status, note: row.failureReason }, pubsub: ctx.pubsub }).catch(() => {})
    try {
      const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js')
      const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js')
      await new NotificationService(new NotificationsRepo()).markNotificationsReadForWithdrawalRequest(Number(id), { tenant })
    } catch { /* Notification cleanup must not undo a committed refund. */ }
    return payoutView(row)
  },
}
