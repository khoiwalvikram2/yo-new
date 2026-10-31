import { z } from 'zod'
import { hasPermission } from '@/domains/common/auth.js'
import { attachQrUrls } from './qrUrl.js'
import { createDepositRequest, approveDepositRequest, rejectDepositRequest, getDepositRequestById } from '@/repos/deposits/depositRequestsRepo.js'
import { getWhitelabelPaymentMethods, upsertWhitelabelPaymentMethods } from '@/repos/payments/whitelabelPaymentsRepo.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { NotificationsRepo } from '@/repos/notifications/notificationsRepo.js'
import { NotificationService } from '@/domains/notifications/services/NotificationService.js'
import { getUserDb } from '@/repos/users/usersRepo.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'
import { requirePermission } from '@src/domains/common/auth.js'

const CreateDepositRequestInput = z.object({
  accountId: z.string().min(1).optional(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  method: z.enum(['BANK_TRANSFER', 'UPI']),
  utr: z.string().optional().nullable(),
  referenceId: z.string().optional().nullable(),
  proofKey: z.string().min(1),
})

const ApproveDepositRequestInput = z.object({
  id: z.string().min(1),
  note: z.string().optional().nullable(),
})

const RejectDepositRequestInput = z.object({
  id: z.string().min(1),
  note: z.string().optional().nullable(),
})

const UpsertWhitelabelPaymentMethodsInput = z.object({
  enabledMethods: z.array(z.string()).optional(),
  banks: z.array(z.object({
    id: z.string().optional(),
    accountName: z.string().min(1),
    accountNumber: z.string().min(1),
    ifsc: z.string().min(1),
    bankName: z.string().min(1),
    branch: z.string().min(1),
    notes: z.string().optional().nullable(),
    minAmount: z.number().optional().nullable(),
    maxAmount: z.number().optional().nullable(),
    weight: z.number().int().optional(),
    enabled: z.boolean().optional(), // Add enabled field
    vipTierIds: z.array(z.string().uuid()).nullable().optional(),
  })).optional(),
  upis: z.array(z.object({
    id: z.string().optional(),
    upiId: z.string().min(1),
    displayName: z.string().optional().nullable(),
    qrKey: z.string().optional().nullable(),
    minAmount: z.number().optional().nullable(),
    maxAmount: z.number().optional().nullable(),
    weight: z.number().int().optional(),
    enabled: z.boolean().optional(), // Add enabled field
    vipTierIds: z.array(z.string().uuid()).nullable().optional(),
  })).optional(),
  limits: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
  }).optional(),
})

export const depositsMutationResolvers = {
  createDepositRequest: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'payments.deposits', 'view')
    const parsed = CreateDepositRequestInput.safeParse(args.input)
    if (!parsed.success) {
      throw new Error('Invalid input')
    }
    
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!userId) {
      throw new Error('User not authenticated')
    }

    // Mirror sibling deposit mutations: require a deposits permission gate.
    if (!hasPermission(ctx?.permissions ?? [], 'payments.deposits', 'view')) {
      throw new Error('Forbidden: insufficient permissions to create deposit requests')
    }

    // CR-8: Block credit players from receiving raw cash via self-deposit.
    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) must have cash=0 / no deposits.
    const depositingUser = await getUserDb(userId, tenant)
    if (!depositingUser) {
      throw new Error('User not found')
    }
    if (isCreditPlayer((depositingUser as { playerType?: string | null }).playerType)) {
      throw new Error('Deposits are disabled for credit players. Please contact your agent.')
    }

    const { amount, currency, method, utr, referenceId, proofKey } = parsed.data

    // Validate UTR requirement for UPI
    if (method === 'UPI' && !utr) {
      throw new Error('UTR is required for UPI deposits')
    }
    
    // Check whitelabel payment methods and limits
    const methods = await getWhitelabelPaymentMethods(tenant)
    if (!methods) {
      throw new Error('Payment methods not configured for this whitelabel')
    }
    
    // Check if method is enabled
    if (!methods.enabledMethods.includes(method)) {
      throw new Error(`Payment method ${method} is not enabled`)
    }
    
    // Validate limits
    const limits = methods.limits
    if (amount < limits.min) {
      throw new Error(`Minimum deposit amount is ${limits.min}`)
    }
    if (amount > limits.max) {
      throw new Error(`Maximum deposit amount is ${limits.max}`)
    }
    
    // Create deposit request
    const request = await createDepositRequest({
      accountId: parsed.data.accountId,
      tenant,
      userId,
      amount,
      currency,
      method,
      utr: utr ?? null,
      referenceId: referenceId ?? null,
      proofKey,
    })

    // Create notification for Tasks (filtered by whitelabel/agent)
    try {
      const user = await getUserDb(userId, tenant)
      const agentId = (user as { agentId?: string | null })?.agentId ?? null
      const whitelabelId = directorTenant ?? tenant
      const notificationsRepo = new NotificationsRepo()
      const notificationService = new NotificationService(notificationsRepo)
      const formattedAmount = typeof amount === 'number' ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(amount)
      const userName = user?.name || user?.username || `User ID ${userId}`
      const userPhone = user?.phone || 'N/A'
      await notificationService.createNotification(
        {
          tenant,
          whitelabelId: whitelabelId || tenant,
          agentId,
          type: 'DEPOSIT',
          category: 'task',
          title: 'Deposit request pending',
          message: `Deposit of ${formattedAmount} ${currency} (${method}) from ${userName} (${userPhone}) requires review.`,
          actionUrl: `/payments/deposits?depositId=${request.id}`,
          metadata: { depositRequestId: request.id, userId, userName, userPhone, amount, currency, method },
        },
        ctx?.pubsub
      )
    } catch (err: any) {
    }
    
    return {
      success: true,
      message: 'Deposit request created successfully',
      depositRequest: {
        id: String(request.id),
        tenant: request.tenant,
        userId: String(request.userId),
        amount: Number(request.amount),
        currency: request.currency,
        method: request.method,
        utr: request.utr,
        referenceId: request.referenceId,
        proofKey: request.proofKey,
        proofUrl: null, // Will be generated on query
        status: request.status,
        reviewerId: null,
        reviewedAt: null,
        note: null,
        walletTxnId: null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      },
    }
  },

  approveDepositRequest: async (_: any, args: any, ctx: any) => {
    const parsed = ApproveDepositRequestInput.safeParse(args.input)
    if (!parsed.success) {
      throw new Error('Invalid input')
    }
    
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const reviewerId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!reviewerId) {
      throw new Error('User not authenticated')
    }
    
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.deposits', 'approve')) {
      throw new Error('Forbidden: insufficient permissions to approve deposit requests')
    }
    
    const id = Number(parsed.data.id)
    if (!Number.isFinite(id)) {
      throw new Error('Invalid deposit request ID')
    }
    
    // Approve the request (this will credit the wallet)
    const request = await approveDepositRequest(id, tenant, reviewerId, parsed.data.note ?? null)
    
    // Publish whitelabel credit subscription when deposit is approved and whitelabel credit was adjusted
    const isWhitelabel = tenant && tenant !== 'default'
    if (request.amount && isWhitelabel && ctx?.pubsub) {
      try {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js')
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js')
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo())
        
        // Use effectiveWhitelabelId (same logic as subscription resolver) to ensure topic matches
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
        
        const publishResult = ctx.pubsub.publish({
          topic,
          payload: { whitelabelCreditUpdated: whitelabelCreditInfo },
        })
        if (publishResult && typeof publishResult.catch === 'function') {
          publishResult.catch((err: Error) => {
          })
        }
      } catch (err: any) {
        // Don't fail mutation if subscription fails
      }
    }
    
    // Audit log
    await recordAuditDb({
      tenant,
      actorId: String(reviewerId),
      domain: 'deposits',
      action: 'approve_deposit',
      resourceType: 'deposit_request',
      resourceId: String(id),
      after: {
        status: 'APPROVED',
        amount: Number(request.amount),
        currency: request.currency,
        walletTxnId: request.walletTxnId,
      },
    }).catch(() => {})

    // Also log under players domain so agent dashboard Recent Activity shows "Deposit made"
    await recordAuditDb({
      tenant,
      actorId: String(reviewerId),
      domain: 'players',
      action: 'deposit_approved',
      resourceType: 'player',
      resourceId: String(request.userId),
      after: {
        amount: Number(request.amount),
        currency: request.currency ?? 'INR',
      },
    }).catch(() => {})

    // Mark related task notifications as read
    try {
      const notificationsRepo = new NotificationsRepo()
      const notificationService = new NotificationService(notificationsRepo)
      await notificationService.markNotificationsReadForDepositRequest(id, { tenant })
    } catch (err: any) {
    }
    
    return {
      success: true,
      message: 'Deposit request approved and wallet credited',
      depositRequest: {
        id: String(request.id),
        tenant: request.tenant,
        userId: String(request.userId),
        amount: Number(request.amount),
        currency: request.currency,
        method: request.method,
        utr: request.utr,
        referenceId: request.referenceId,
        proofKey: request.proofKey,
        proofUrl: null,
        status: request.status,
        reviewerId: request.reviewerId ? String(request.reviewerId) : null,
        reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
        note: request.note,
        walletTxnId: request.walletTxnId ? String(request.walletTxnId) : null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      },
    }
  },

  rejectDepositRequest: async (_: any, args: any, ctx: any) => {
    const parsed = RejectDepositRequestInput.safeParse(args.input)
    if (!parsed.success) {
      throw new Error('Invalid input')
    }
    
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const reviewerId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!reviewerId) {
      throw new Error('User not authenticated')
    }
    
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.deposits', 'reject')) {
      throw new Error('Forbidden: insufficient permissions to reject deposit requests')
    }
    
    const id = Number(parsed.data.id)
    if (!Number.isFinite(id)) {
      throw new Error('Invalid deposit request ID')
    }
    
    // Reject the request
    const request = await rejectDepositRequest(id, tenant, reviewerId, parsed.data.note)
    
    // Audit log
    await recordAuditDb({
      tenant,
      actorId: String(reviewerId),
      domain: 'deposits',
      action: 'reject_deposit',
      resourceType: 'deposit_request',
      resourceId: String(id),
      after: {
        status: 'REJECTED',
        note: parsed.data.note,
      },
    }).catch(() => {})

    // Mark related task notifications as read
    try {
      const notificationsRepo = new NotificationsRepo()
      const notificationService = new NotificationService(notificationsRepo)
      await notificationService.markNotificationsReadForDepositRequest(id, { tenant })
    } catch (err: any) {
    }
    
    return {
      success: true,
      message: 'Deposit request rejected',
      depositRequest: {
        id: String(request.id),
        tenant: request.tenant,
        userId: String(request.userId),
        amount: Number(request.amount),
        currency: request.currency,
        method: request.method,
        utr: request.utr,
        referenceId: request.referenceId,
        proofKey: request.proofKey,
        proofUrl: null,
        status: request.status,
        reviewerId: request.reviewerId ? String(request.reviewerId) : null,
        reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
        note: request.note,
        walletTxnId: null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      },
    }
  },

  upsertWhitelabelPaymentMethods: async (_: any, args: any, ctx: any) => {
    const parsed = UpsertWhitelabelPaymentMethodsInput.safeParse(args.input)
    if (!parsed.success) {
      throw new Error('Invalid input')
    }
    
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Block commission agents from accessing payment methods
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment methods')
      }
    }
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.methods', 'update') && !hasPermission(ctx?.permissions ?? [], 'payments.methods', 'create')) {
      throw new Error('Forbidden: insufficient permissions for payment methods')
    }
    
    // Validate limits if provided
    if (parsed.data.limits) {
      if (parsed.data.limits.min >= parsed.data.limits.max) {
        throw new Error('Minimum limit must be less than maximum limit')
      }
    }
    
    // Generate IDs for new banks/UPIs if not provided
    // If banks/upis is provided (even if empty array), process it; if undefined, keep existing
    const banks = parsed.data.banks !== undefined 
      ? parsed.data.banks.map((bank, index) => ({
          ...bank,
          id: bank.id || `bank-${Date.now()}-${index}`,
          weight: bank.weight ?? 0,
        }))
      : undefined
    
    const upis = parsed.data.upis !== undefined
      ? parsed.data.upis.map((upi, index) => ({
          ...upi,
          id: upi.id || `upi-${Date.now()}-${index}`,
          weight: upi.weight ?? 0,
        }))
      : undefined
    
    const methods = await upsertWhitelabelPaymentMethods({
      tenant,
      enabledMethods: parsed.data.enabledMethods,
      banks,
      upis,
      limits: parsed.data.limits,
    })
    
    // Resolve QR codes for display (base64 passes through, legacy S3 keys are signed)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    
    return {
      success: true,
      message: 'Payment methods updated successfully',
      paymentMethods: {
        id: String(methods.id),
        tenant: methods.tenant,
        enabledMethods: methods.enabledMethods,
        banks: methods.banks || [],
        upis: upisWithUrls,
        limits: methods.limits,
        createdAt: methods.createdAt.toISOString(),
        updatedAt: methods.updatedAt.toISOString(),
      },
    }
  },
}

