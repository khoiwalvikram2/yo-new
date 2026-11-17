import { hasPermission } from '@/domains/common/auth.js'
import { getWhitelabelPaymentMethods } from '@/repos/payments/whitelabelPaymentsRepo.js'
import { listDepositRequests, getDepositRequestById, getDepositRequestProof, listDepositRequestsWithGatewayOrders, getGatewayOrdersByDepositId, gatewayOrderStatus, GATEWAY_PROOF_KEY, type DepositListEntry, type WelivepayOrderRow } from '@/repos/deposits/depositRequestsRepo.js'
import { gatewayDisplayName, PAYIN_LINK_TTL_MS } from '@shared/services/welivepay/welivepayClient.js'

/** The gateway pay-in behind a deposit, as the admin list shows it. */
function gatewayInfo(order: WelivepayOrderRow) {
  const status = gatewayOrderStatus(order)
  return {
    provider: 'WELIVEPAY',
    gateway: order.gateway,
    gatewayName: gatewayDisplayName(order.gateway),
    orderId: order.orderid,
    status,
    txnRef: order.txnRef,
    expiresAt: status === 'pending' ? new Date(order.createdAt.getTime() + PAYIN_LINK_TTL_MS).toISOString() : null,
  }
}

const CRYPTO_NONE = { cryptoAmount: null, cryptoRate: null, cryptoNetwork: null, cryptoBonusPercent: null, cryptoBonusAmount: null, bonusWalletTxnId: null }
import { attachQrUrls } from './qrUrl.js'
import { depositProofUrl } from './proofUrl.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

import { readDepositRequestStats } from '@src/repos/payments/paymentReadStats.js'
import { getUsersByIdsForExclusion } from '@src/repos/users/usersRepo.js'

async function requireDepositRequestsRead(ctx: any) {
    // Block commission agents from accessing payment requests
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (agent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access payment requests')
      }
    }
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.deposits', 'view')) {
      throw new Error('Forbidden: insufficient permissions for deposit requests')
    }

}

/**
 * The gate on the brand's receiving accounts (bank account numbers, IFSC codes, UPI ids and their QR codes).
 *
 * `myDepositMethods` returns the same rows as `whitelabelPaymentMethods` but checked nothing: it read the tenant
 * from the X-Whitelabel-ID header, so a request with no session at all got grandwinn's bank account and six UPI
 * ids. Its comment said players read it, but players use user-backend, which gives an anonymous caller no
 * accounts, and nothing in the admin panel calls it. So both fields now ask what `whitelabelPaymentMethods`
 * always asked: a session, not a commission agent, and payments.methods:view.
 */
async function requirePaymentMethodsRead(ctx: any) {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  // Block commission agents from accessing payment methods
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const agentsRepo = new AgentsRepo()
    const agent = await agentsRepo.findById(ctx.user.agentId)
    if (agent?.schemeType === 'COMMISSION') {
      throw new Error('Commission agents cannot access payment methods')
    }
  }

  if (!hasPermission(ctx?.permissions ?? [], 'payments.methods', 'view')) {
    throw new Error('Forbidden: insufficient permissions for payment methods')
  }
}

export const depositsQueryResolvers = {
  adminDepositRequestStats: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    await requireDepositRequestsRead(ctx)
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    return readDepositRequestStats(tenant)
  },
  myDepositMethods: async (_: any, __: any, ctx: any) => {
    await requirePaymentMethodsRead(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const methods = await getWhitelabelPaymentMethods(tenant)
    
    if (!methods) {
      // Return default structure if not configured
      return {
        id: '0',
        tenant,
        enabledMethods: [],
        banks: [],
        upis: [],
        cryptos: [],
        cryptoRate: null,
        cryptoBonusPercent: null,
        limits: { min: 100, max: 500000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }

    // QR codes for display (data URIs pass through; a legacy S3 key reads as null)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    const cryptosWithUrls = await attachQrUrls(methods.cryptos as any[])

    return {
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
    }
  },

  adminDepositRequests: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    await requireDepositRequestsRead(ctx)

    const input = args.input || {}
    const tz = await getWhitelabelTimezone(tenant)
    const filter: any = {
      // A task link (?depositId=…) names one request, whatever its age or status (FIN-04).
      id: input.id != null ? Number(input.id) : undefined,
      status: input.status,
      userId: input.userId ? Number(input.userId) : undefined,
      method: input.method,
      source: input.source === 'GATEWAY' || input.source === 'MANUAL' ? input.source : undefined,
      fromDate: input.fromDate ? parseDateFrom(input.fromDate, tz) : undefined,
      toDate: input.toDate ? parseDateTo(input.toDate, tz) : undefined,
      query: input.query,
    }
    const page = { offset: input.offset ?? 0, limit: input.limit ?? 100 }

    // Uncredited gateway pay-ins are opt-in, so badge counts and stats stay the manual review queue.
    const { items: entries, total }: { items: DepositListEntry[]; total: number } = input.includeGatewayOrders
      ? await listDepositRequestsWithGatewayOrders(filter, tenant, page)
      : await listDepositRequests(filter, tenant, page).then((r) => ({ total: r.total, items: r.items.map((row) => ({ kind: 'request' as const, row })) }))
    const items = entries.flatMap((entry) => entry.kind === 'request' ? [entry.row] : [])
    const orders = entries.flatMap((entry) => entry.kind === 'gatewayOrder' ? [entry.row] : [])
    const creditedOrders = await getGatewayOrdersByDepositId(items.filter((item) => item.proofKey === GATEWAY_PROOF_KEY).map((item) => item.id), tenant)

    const people = await getUsersByIdsForExclusion([...new Set([...items, ...orders].map(item => item.userId))], tenant).catch(() => [])
    const peopleById = new Map(people.map(person => [person.id, person]))
    const userInfo = (userId: number) => {
      const userData = peopleById.get(userId)
      return userData ? { id: String(userData.id), name: userData.name, email: userData.email, phone: userData.phone } : null
    }
    // Enrich with the one tenant-scoped user batch and gateway details. A row says whether it has a proof (hasProof)
    // but never carries it: the page asks depositRequestProof for one screenshot when a reviewer opens it.
    const enriched = await Promise.all(entries.map(async (entry) => {
      if (entry.kind === 'gatewayOrder') {
        const order = entry.row
        const gateway = gatewayInfo(order)
        // Never approved or rejected by hand: credited only when WeLivePay confirms the payment.
        return {
          id: `GW-${order.id}`,
          tenant: order.tenant,
          userId: String(order.userId),
          amount: Number(order.amount),
          currency: 'INR',
          method: 'UPI',
          utr: order.txnRef,
          referenceId: order.orderid,
          proofKey: GATEWAY_PROOF_KEY,
          proofUrl: null,
          hasProof: false,
          status: gateway.status === 'pending' ? 'PENDING' : 'REJECTED',
          reviewerId: null,
          reviewedAt: null,
          note: null,
          walletTxnId: null,
          ...CRYPTO_NONE,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          user: userInfo(order.userId),
          gateway,
        }
      }

      const item = entry.row
      const isGateway = item.proofKey === GATEWAY_PROOF_KEY
      const creditedOrder = isGateway ? creditedOrders.get(item.id) : undefined
      const user = userInfo(item.userId)

      return {
        gateway: creditedOrder ? gatewayInfo(creditedOrder) : null,
        id: String(item.id),
        tenant: item.tenant,
        userId: String(item.userId),
        amount: Number(item.amount),
        currency: item.currency,
        method: item.method,
        utr: item.utr,
        referenceId: item.referenceId,
        proofKey: item.proofKey,
        proofUrl: null,
        hasProof: item.hasProof === true,
        status: item.status,
        reviewerId: item.reviewerId ? String(item.reviewerId) : null,
        reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
        note: item.note,
        walletTxnId: item.walletTxnId ? String(item.walletTxnId) : null,
        cryptoAmount: item.cryptoAmount != null ? Number(item.cryptoAmount) : null,
        cryptoRate: item.cryptoRate != null ? Number(item.cryptoRate) : null,
        cryptoNetwork: item.cryptoNetwork ?? null,
        cryptoBonusPercent: item.cryptoBonusPercent != null ? Number(item.cryptoBonusPercent) : null,
        cryptoBonusAmount: item.cryptoBonusAmount != null ? Number(item.cryptoBonusAmount) : null,
        bonusWalletTxnId: item.bonusWalletTxnId ? String(item.bonusWalletTxnId) : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        user,
      }
    }))

    return {
      items: enriched,
      total,
    }
  },

  /**
   * One request's payment proof: its screenshot as a data URI, or a link; null when it has none to show (a sentinel,
   * a legacy S3 key) or when the caller's tenant has no such request. The list carries only hasProof, so this is read
   * once per request a reviewer opens. Gated and scoped exactly as adminDepositRequests: the same permission and
   * commission-agent refusal, the same tenant (director mode included).
   */
  depositRequestProof: async (_: any, args: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    await requireDepositRequestsRead(ctx)

    const stored = await getDepositRequestProof(Number(args?.id), tenant)
    return stored ? depositProofUrl(stored) : null
  },

  whitelabelPaymentMethods: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    await requirePaymentMethodsRead(ctx)

    const methods = await getWhitelabelPaymentMethods(tenant)
    
    if (!methods) {
      return null
    }
    
    // QR codes for display (data URIs pass through; a legacy S3 key reads as null)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    const cryptosWithUrls = await attachQrUrls(methods.cryptos as any[])

    return {
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
    }
  },
}

