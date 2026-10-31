import { hasPermission } from '@/domains/common/auth.js'
import { getWhitelabelPaymentMethods } from '@/repos/payments/whitelabelPaymentsRepo.js'
import { listDepositRequests, getDepositRequestById } from '@/repos/deposits/depositRequestsRepo.js'
import { generatePresignedGetUrl } from '@/services/storage/s3.js'
import { attachQrUrls } from './qrUrl.js'
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

export const depositsQueryResolvers = {
  adminDepositRequestStats: async (_: any, __: any, ctx: any) => {
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    await requireDepositRequestsRead(ctx)
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    return readDepositRequestStats(tenant)
  },
  myDepositMethods: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Players can view their own deposit methods
    const methods = await getWhitelabelPaymentMethods(tenant)
    
    if (!methods) {
      // Return default structure if not configured
      return {
        id: '0',
        tenant,
        enabledMethods: [],
        banks: [],
        upis: [],
        limits: { min: 100, max: 500000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    
    // Resolve QR codes for display (base64 passes through, legacy S3 keys are signed)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    
    return {
      id: String(methods.id),
      tenant: methods.tenant,
      enabledMethods: methods.enabledMethods,
      banks: methods.banks || [],
      upis: upisWithUrls,
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
      status: input.status,
      userId: input.userId ? Number(input.userId) : undefined,
      method: input.method,
      fromDate: input.fromDate ? parseDateFrom(input.fromDate, tz) : undefined,
      toDate: input.toDate ? parseDateTo(input.toDate, tz) : undefined,
      query: input.query,
    }
    
    const { items, total } = await listDepositRequests(
      filter,
      tenant,
      {
        offset: input.offset ?? 0,
        limit: input.limit ?? 100,
      }
    )
    
    const people = await getUsersByIdsForExclusion([...new Set(items.map(item => item.userId))], tenant).catch(() => [])
    const peopleById = new Map(people.map(person => [person.id, person]))
    // Enrich with proof URLs and the one tenant-scoped user batch.
    const enriched = await Promise.all(items.map(async (item) => {
      let proofUrl = null
      try {
        proofUrl = await generatePresignedGetUrl(item.proofKey, 3600)
      } catch {
        // Ignore errors
      }
      
      let user = null
      try {
        const userData = peopleById.get(item.userId)
        if (userData) {
          user = {
            id: String(userData.id),
            name: userData.name,
            email: userData.email,
            phone: userData.phone,
          }
        }
      } catch {
        // Ignore errors
      }
      
      return {
        id: String(item.id),
        tenant: item.tenant,
        userId: String(item.userId),
        amount: Number(item.amount),
        currency: item.currency,
        method: item.method,
        utr: item.utr,
        referenceId: item.referenceId,
        proofKey: item.proofKey,
        proofUrl,
        status: item.status,
        reviewerId: item.reviewerId ? String(item.reviewerId) : null,
        reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
        note: item.note,
        walletTxnId: item.walletTxnId ? String(item.walletTxnId) : null,
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

  whitelabelPaymentMethods: async (_: any, __: any, ctx: any) => {
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
    
    if (!hasPermission(ctx?.permissions ?? [], 'payments.methods', 'view')) {
      throw new Error('Forbidden: insufficient permissions for payment methods')
    }
    
    const methods = await getWhitelabelPaymentMethods(tenant)
    
    if (!methods) {
      return null
    }
    
    // Resolve QR codes for display (base64 passes through, legacy S3 keys are signed)
    const upisWithUrls = await attachQrUrls(methods.upis as any[])
    
    return {
      id: String(methods.id),
      tenant: methods.tenant,
      enabledMethods: methods.enabledMethods,
      banks: methods.banks || [],
      upis: upisWithUrls,
      limits: methods.limits,
      createdAt: methods.createdAt.toISOString(),
      updatedAt: methods.updatedAt.toISOString(),
    }
  },
}

