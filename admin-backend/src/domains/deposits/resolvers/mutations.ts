import { z } from 'zod'
import { hasPermission } from '@/domains/common/auth.js'
import { attachQrUrls } from './qrUrl.js'
import { assertStorableImage, storedImageProblem } from '@/services/storage/storedImage.js'
import { isDataUri } from '@shared/utils/dataUri.js'
import { createDepositRequest, approveDepositRequest, rejectDepositRequest, getDepositRequestById } from '@/repos/deposits/depositRequestsRepo.js'
import { getWhitelabelPaymentMethods, upsertWhitelabelPaymentMethods } from '@/repos/payments/whitelabelPaymentsRepo.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { NotificationsRepo } from '@/repos/notifications/notificationsRepo.js'
import { NotificationService } from '@/domains/notifications/services/NotificationService.js'
import { getUserDb } from '@/repos/users/usersRepo.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'
import { requirePermission } from '@src/domains/common/auth.js'
import { CRYPTO_BONUS_MAX_PERCENT, cryptoWalletAddressError } from '@shared/utils/cryptoDeposit.js'

/** proof_key of a request whose screenshot is the data URI in proof_data, as user-backend writes it. */
const DEPOSIT_PROOF_INLINE = 'inline'

const CreateDepositRequestInput = z.object({
  accountId: z.string().min(1).optional(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  method: z.enum(['BANK_TRANSFER', 'UPI']),
  utr: z.string().optional().nullable(),
  referenceId: z.string().optional().nullable(),
  proofKey: z.string().min(1),
})

/**
 * The reviewing admin's numeric users.id (the session's `sub`), or null for a caller that has none.
 *
 * Approve and reject derived this before anything else, and an agent's `sub` is its uuid, so Number() was NaN and
 * a signed-in agent was told "User not authenticated" before the commission-agent and permission checks below it
 * ever ran. It is read now only once those checks have passed.
 */
function reviewerIdOf(ctx: any): number | null {
  const raw = ctx?.user?.sub
  const n = raw != null ? Number(raw) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

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
  // USDT wallets. A wallet address is checked against its network: funds sent across networks are lost.
  cryptos: z.array(z.object({
    id: z.string().optional(),
    network: z.string().trim().min(1).max(32),
    walletAddress: z.string().trim().min(1).max(128),
    displayName: z.string().trim().max(128).optional().nullable(),
    qrKey: z.string().optional().nullable(),
    minAmount: z.number().nonnegative().optional().nullable(),
    maxAmount: z.number().nonnegative().optional().nullable(),
    weight: z.number().int().optional(),
    enabled: z.boolean().optional(),
    vipTierIds: z.array(z.string().uuid()).nullable().optional(),
  }).superRefine((wallet, ctx) => {
    const addressError = cryptoWalletAddressError(wallet.network, wallet.walletAddress)
    if (addressError) ctx.addIssue({ code: 'custom', path: ['walletAddress'], message: addressError })
    if (wallet.minAmount != null && wallet.maxAmount != null && wallet.minAmount > wallet.maxAmount) {
      ctx.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Wallet maximum must be at least its minimum' })
    }
  })).optional(),
  // Deposit currency per 1 USDT. Omitted or null = keep the stored rate.
  cryptoRate: z.number().positive('The USDT rate must be above 0').max(1_000_000).optional().nullable(),
  // Extra % on approved crypto deposits. Omitted = keep; 0 or null = off.
  cryptoBonusPercent: z.number().min(0, 'Crypto bonus cannot be negative').max(CRYPTO_BONUS_MAX_PERCENT, `Crypto bonus can be at most ${CRYPTO_BONUS_MAX_PERCENT}%`).optional().nullable(),
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

    // Files are base64 now (S3 is gone): proofKey is a screenshot data URI, kept in proof_data with proof_key
    // 'inline' as the player app's requests are (user-backend depositProof.ts), or the sentinel 'manual' or
    // 'proof-missing'. An S3 key, a link or anything else is refused before anything is read or written.
    const proofSentinel = parsed.data.proofKey === 'manual' || parsed.data.proofKey === 'proof-missing'
    const proofData = proofSentinel ? null : parsed.data.proofKey
    if (proofData !== null) {
      const problem = isDataUri(proofData) ? storedImageProblem(proofData, 'Payment proof') : "Payment proof must be a screenshot image, 'manual' or 'proof-missing'"
      if (problem) throw new Error(problem)
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
    
    // Create deposit request. The screenshot is written by the same insert as the request: a second UPDATE after the
    // insert had committed could fail and leave a PENDING request marked 'inline' with no screenshot, which a retry
    // then duplicated.
    const request = await createDepositRequest({
      accountId: parsed.data.accountId,
      tenant,
      userId,
      amount,
      currency,
      method,
      utr: utr ?? null,
      referenceId: referenceId ?? null,
      proofKey: proofData === null ? proofKey : DEPOSIT_PROOF_INLINE,
      proofData,
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
        // Like every DepositRequest: whether there is a proof, never the screenshot (depositRequestProof reads it).
        proofUrl: null,
        hasProof: request.hasProof === true,
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

    if (!ctx?.user) {
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

    const reviewerId = reviewerIdOf(ctx)
    if (!reviewerId) {
      throw new Error('Forbidden: only an admin can approve deposit requests')
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
        ...(Number(request.cryptoBonusAmount) > 0
          ? { cryptoBonusAmount: Number(request.cryptoBonusAmount), bonusWalletTxnId: request.bonusWalletTxnId }
          : {}),
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
        hasProof: request.hasProof === true,
        status: request.status,
        reviewerId: request.reviewerId ? String(request.reviewerId) : null,
        reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
        note: request.note,
        walletTxnId: request.walletTxnId ? String(request.walletTxnId) : null,
        cryptoBonusAmount: request.cryptoBonusAmount != null ? Number(request.cryptoBonusAmount) : null,
        bonusWalletTxnId: request.bonusWalletTxnId ? String(request.bonusWalletTxnId) : null,
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

    if (!ctx?.user) {
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

    const reviewerId = reviewerIdOf(ctx)
    if (!reviewerId) {
      throw new Error('Forbidden: only an admin can reject deposit requests')
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
        hasProof: request.hasProof === true,
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
      // Crypto issues carry a message the admin can act on (which network, which limit).
      const cryptoIssue = parsed.error.issues.find(issue => issue.path[0] === 'cryptos' || issue.path[0] === 'cryptoRate' || issue.path[0] === 'cryptoBonusPercent')
      throw new Error(cryptoIssue ? `Invalid input: ${cryptoIssue.message}` : 'Invalid input')
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

    // QR codes are stored in the row as data URIs (S3 is gone): each is an image of at most 2 MB, or a link.
    // A replaced or removed QR is simply overwritten in the row; there is no stored file to clean up.
    for (const upi of parsed.data.upis ?? []) assertStorableImage(upi.qrKey, 'UPI QR code')
    for (const wallet of parsed.data.cryptos ?? []) assertStorableImage(wallet.qrKey, 'Wallet QR code')

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
    
    const cryptos = parsed.data.cryptos !== undefined
      ? parsed.data.cryptos.map((crypto, index) => ({
          ...crypto,
          id: crypto.id || `crypto-${Date.now()}-${index}`,
          weight: crypto.weight ?? 0,
        }))
      : undefined

    const methods = await upsertWhitelabelPaymentMethods({
      tenant,
      enabledMethods: parsed.data.enabledMethods,
      banks,
      upis,
      cryptos,
      // A GraphQL null and an omitted field both mean "not sent": the rate is only ever replaced, never cleared.
      cryptoRate: parsed.data.cryptoRate ?? undefined,
      // Unlike the rate, the bonus can be switched off: 0 or null clears it, omitted keeps it.
      cryptoBonusPercent: parsed.data.cryptoBonusPercent,
      limits: parsed.data.limits,
    })

    // QR codes for display (data URIs pass through; a legacy S3 key reads as null)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    const cryptosWithUrls = await attachQrUrls(methods.cryptos)

    return {
      success: true,
      message: 'Payment methods updated successfully',
      paymentMethods: {
        id: String(methods.id),
        tenant: methods.tenant,
        enabledMethods: methods.enabledMethods,
        banks: methods.banks || [],
        upis: upisWithUrls,
        cryptos: cryptosWithUrls,
        cryptoRate: methods.cryptoRate,
        cryptoBonusPercent: methods.cryptoBonusPercent,
        limits: methods.limits,
        createdAt: methods.createdAt.toISOString(),
        updatedAt: methods.updatedAt.toISOString(),
      },
    }
  },
}

