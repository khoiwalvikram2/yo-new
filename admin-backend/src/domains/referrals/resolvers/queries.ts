import {
  getReferralProgramByTenantDb,
  getReferralRulesByProgramDb,
  getReferralLinkByUserDb,
  getReferralLinkByCodeDb,
  getReferralLinkByAgentDb,
  getReferralClicksByLinkDb,
  getReferralAttributionByRefereeDb,
  getReferralAttributionsByReferrerDb,
} from '@src/repos/referrals/referralsRepo.js'
import {
  getReferralEarningsByReferrerDb,
  getReferralEarningsByRefereeDb,
  getReferralEarningsAllDb,
  getReferralSettlementsByReferrerDb,
  getTopReferrersDb,
  getReferrerStatsDb,
} from '@src/repos/referrals/referralEarningsRepo.js'
import { getUsersByIdsBasicDb } from '@src/repos/users/usersRepo.js'
import { z } from 'zod'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { requireReadPermission } from '@src/domains/common/auth.js'

export const referralsQueryResolvers = {
  referralProgramByTenant: async (_: unknown, args: unknown, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'referrals.program', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view referral program')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
    const program = await getReferralProgramByTenantDb(tenant)
    if (!program) return null

    const enabledModes = ((program.enabledModes || []) as string[]).filter((m) => m !== 'REVSHARE')
    return {
      ...program,
      id: String(program.id),
      enabledModes,
      flags: program.flags || {},
      minReferralBalanceForCashTransfer: program.minReferralBalanceForCashTransfer != null ? Number(program.minReferralBalanceForCashTransfer) : null,
      createdAt: program.createdAt instanceof Date ? program.createdAt.toISOString() : String(program.createdAt),
      updatedAt: program.updatedAt instanceof Date ? program.updatedAt.toISOString() : String(program.updatedAt),
    }
  },

  referralRules: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.program', 'view')
    const { programId } = z.object({ programId: z.string().optional() }).parse(args || {})
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    if (programId) {
      const rules = await getReferralRulesByProgramDb(Number(programId), tenant)
      return rules.map(r => ({
        ...r,
        id: String(r.id),
        tierRates: r.tierRates || {},
        fixedAmounts: r.fixedAmounts || {},
        caps: r.caps || {},
        thresholds: r.thresholds || {},
        splitRatio: r.splitRatio || { cash: 100, bonus: 0 },
        escrow: r.escrow || { untilKyc: false, untilFraudClear: false },
        configJson: r.configJson || {},
        reloadDepositsCount: r.reloadDepositsCount ?? null,
        reloadMinDeposit: r.reloadMinDeposit ?? null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
      }))
    }

    // Get program first
    const program = await getReferralProgramByTenantDb(tenant)
    if (!program) return []

    const rules = await getReferralRulesByProgramDb(program.id, tenant)
    return rules.map(r => ({
      ...r,
      id: String(r.id),
      tierRates: r.tierRates || {},
      fixedAmounts: r.fixedAmounts || {},
      caps: r.caps || {},
      thresholds: r.thresholds || {},
      splitRatio: r.splitRatio || { cash: 100, bonus: 0 },
      escrow: r.escrow || { untilKyc: false, untilFraudClear: false },
      configJson: r.configJson || {},
      reloadDepositsCount: r.reloadDepositsCount ?? null,
      reloadMinDeposit: r.reloadMinDeposit ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    }))
  },

  referralLink: async (_: unknown, args: unknown, ctx: any) => {
    const { userId, code, agentId } = z.object({
      userId: z.string().optional(),
      code: z.string().optional(),
      agentId: z.string().uuid().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    if (code) {
      const link = await getReferralLinkByCodeDb(code)
      if (!link || link.tenant !== tenant) return null
      return {
        ...link,
        id: String(link.id),
        agentId: link.agentId || null,
        userId: link.userId || null,
        utmParams: link.utmParams || {},
        createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
        updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : String(link.updatedAt),
      }
    }

    if (userId) {
      const link = await getReferralLinkByUserDb(Number(userId), tenant)
      if (!link) return null
      return {
        ...link,
        id: String(link.id),
        agentId: link.agentId || null,
        userId: link.userId || null,
        utmParams: link.utmParams || {},
        createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
        updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : String(link.updatedAt),
      }
    }

    if (agentId) {
      const link = await getReferralLinkByAgentDb(agentId, tenant)
      if (!link) return null
      return {
        ...link,
        id: String(link.id),
        agentId: link.agentId || null,
        userId: link.userId || null,
        utmParams: link.utmParams || {},
        createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
        updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : String(link.updatedAt),
      }
    }

    return null
  },

  agentReferralLink: async (_: unknown, args: unknown, ctx: any) => {
    try {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

      // If agent is logged in and no agentId provided in args, use their own agentId
      // Otherwise, require agentId in args
      let agentId: string
      const argsAgentId = (args as any)?.agentId
      if (ctx?.user?.type === 'agent' && ctx?.user?.agentId && !argsAgentId) {
        // Agent viewing their own link - use logged-in agent's ID
        agentId = String(ctx.user.agentId).trim()
      } else {
        // Parse agentId from args (required)
        const parsed = z.object({
          agentId: z.string().uuid(),
        }).parse(args)
        agentId = parsed.agentId.trim()
      }

      // Authorization: Ensure user is the agent or has admin permissions
      // For agents, agentId might be in ctx.user.agentId or ctx.user.sub (both are set during login)
      // Normalize agentId values for comparison (handle UUID strings, trim whitespace, case-insensitive)
      const loggedInAgentIdFromField = ctx?.user?.agentId ? String(ctx?.user?.agentId).trim().toLowerCase() : null
      const loggedInAgentIdFromSub = ctx?.user?.type === 'agent' && ctx?.user?.sub ? String(ctx?.user?.sub).trim().toLowerCase() : null
      const loggedInAgentId = loggedInAgentIdFromField || loggedInAgentIdFromSub
      const requestedAgentId = String(agentId).trim().toLowerCase()
      const isAgent = ctx?.user?.type === 'agent' && loggedInAgentId && loggedInAgentId === requestedAgentId
      const isAdmin = ctx?.user?.roles?.some((r: string) => {
        const roleLower = r.toLowerCase()
        return r === 'Super Admin' || roleLower === 'super_admin' ||
          (roleLower.includes('super') && roleLower.includes('admin')) ||
          r === 'Whitelabel Admin' || roleLower.includes('whitelabel')
      })

      if (!isAgent && !isAdmin) {
        throw new Error('Unauthorized: You can only view your own referral link or as an admin')
      }

      const link = await getReferralLinkByAgentDb(agentId, tenant)
      if (!link) {
        return null
      }

      // Handle case where agent was deleted (agentId would be NULL due to ON DELETE SET NULL)
      if (!link.agentId) {
        return null
      }

      // Calculate stats - for agent referrals, we need to count players with this agentId
      // Note: Agent referral clicks are NOT recorded in referral_clicks table (see referralRedirect.ts)
      // So clicks.length will be 0 for agent referrals. We use signups count as the primary metric.
      const { getReferralClicksByLinkDb } = await import('@src/repos/referrals/referralsRepo.js')
      const clicks = await getReferralClicksByLinkDb(link.id, tenant)
      
      // Count total signups (players with this agentId)
      // For agent referrals, we count players directly linked via agentId
      // This includes SHARING_AGENT_PLAYER and COMMISSION_AGENT_PLAYER types
      const { db } = await import('@/db/client.js')
      const { users } = await import('@shared/db/schema.js')
      const { eq, and, count } = await import('drizzle-orm')
      
      const signupsResult = await db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.agentId, agentId),
            eq(users.tenant, tenant)
          )
        )
      
      const totalClicks = clicks.length
      const totalSignups = signupsResult[0]?.count || 0
      // For agent referrals, clicks may be 0 (not tracked), so use signups as primary metric
      // Conversion rate is calculated as signups/clicks, but if clicks=0, we show 0% or N/A
      const conversionRate = totalClicks > 0 ? (totalSignups / totalClicks) * 100 : 0

      return {
        ...link,
        id: String(link.id),
        agentId: link.agentId || null,
        userId: link.userId || null,
        utmParams: link.utmParams || {},
        totalClicks,
        totalSignups,
        conversionRate: Math.round(conversionRate * 100) / 100,
        createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
        updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : String(link.updatedAt),
      }
    } catch (error) {
      throw error
    }
  },

  referralClicks: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const { linkId, limit } = z.object({
      linkId: z.string().min(1),
      limit: z.number().int().positive().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
    const clicks = await getReferralClicksByLinkDb(Number(linkId), tenant, limit || 100)

    return clicks.map(c => ({
      ...c,
      id: String(c.id),
      clickedAt: c.clickedAt instanceof Date ? c.clickedAt.toISOString() : String(c.clickedAt),
    }))
  },

  referralAttribution: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const { refereeId } = z.object({ refereeId: z.string().min(1) }).parse(args)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    const attribution = await getReferralAttributionByRefereeDb(Number(refereeId), tenant)
    if (!attribution) return null

    return {
      ...attribution,
      id: String(attribution.id),
      attributedAt: attribution.attributedAt instanceof Date ? attribution.attributedAt.toISOString() : String(attribution.attributedAt),
      confirmedAt: attribution.confirmedAt ? (attribution.confirmedAt instanceof Date ? attribution.confirmedAt.toISOString() : String(attribution.confirmedAt)) : null,
    }
  },

  referralReferees: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const parsed = z.object({
      referrerId: z.string().min(1),
      query: z.string().optional(),
    }).parse(args)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    const attributions = await getReferralAttributionsByReferrerDb(Number(parsed.referrerId), tenant)
    const refereeIds = [...new Set(attributions.map(a => a.refereeId))]
    if (refereeIds.length === 0) return []

    const users = await getUsersByIdsBasicDb(refereeIds, tenant, parsed.query)
    return users.map(u => ({
      id: String(u.id),
      name: u.name,
      phone: u.phone ?? undefined,
      username: u.username ?? undefined,
    }))
  },

  batchReferralAttributions: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const { refereeIds } = z.object({ refereeIds: z.array(z.string()) }).parse(args)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    if (!refereeIds || refereeIds.length === 0) return []

    // Fetch attributions for all referee IDs
    const results = await Promise.all(
      refereeIds.map(async (refereeId) => {
        try {
          const attribution = await getReferralAttributionByRefereeDb(Number(refereeId), tenant)
          if (!attribution) {
            return null
          }
          return {
            ...attribution,
            id: String(attribution.id),
            attributedAt: attribution.attributedAt instanceof Date ? attribution.attributedAt.toISOString() : String(attribution.attributedAt),
            confirmedAt: attribution.confirmedAt ? (attribution.confirmedAt instanceof Date ? attribution.confirmedAt.toISOString() : String(attribution.confirmedAt)) : null,
          }
        } catch (err) {
          return null
        }
      })
    )

    const filtered = results.filter(Boolean)
    return filtered
  },

  referralTree: async (_: unknown, args: unknown, ctx: any): Promise<any> => {
    // Re-checked on each recursion below, which costs nothing: the context is
    // the same object every time.
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const { userId } = z.object({ userId: z.string().min(1) }).parse(args)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    // Get direct referrals (downline)
    const attributions = await getReferralAttributionsByReferrerDb(Number(userId), tenant, 1)

    const children: any[] = await Promise.all(
      attributions.map(async (attr): Promise<any> => {
        // Recursively get children
        const childTree: any = await referralsQueryResolvers.referralTree(
          _,
          { userId: String(attr.refereeId) },
          ctx
        )
        return {
          userId: attr.refereeId,
          referrerId: attr.referrerId,
          tier: attr.tier,
          children: childTree?.children || [],
        }
      })
    )

    return {
      userId: Number(userId),
      referrerId: null, // Would need to look up who referred this user
      tier: 0,
      children,
    }
  },

  referralEarnings: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.earnings', 'view')
    const parsed = z.object({
      referrerId: z.string().optional(),
      refereeId: z.string().optional(),
      ruleType: z.string().optional(),
      tier: z.number().int().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).parse(args || {})

    // Treat empty string as absent so we don't query with NaN
    const referrerId = parsed.referrerId?.trim() || undefined
    const refereeId = parsed.refereeId?.trim() || undefined
    const filterOpts = {
      ruleType: parsed.ruleType,
      tier: parsed.tier,
      fromDate: parsed.fromDate ? new Date(parsed.fromDate) : undefined,
      toDate: parsed.toDate ? new Date(parsed.toDate) : undefined,
    }

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    const enrichEarningsWithUsers = async (
      earnings: Awaited<ReturnType<typeof getReferralEarningsByReferrerDb>>
    ) => {
      const referrerIds = [...new Set(earnings.map(e => e.referrerId))]
      const refereeIds = [...new Set(earnings.map(e => e.refereeId))]
      const allIds = [...new Set([...referrerIds, ...refereeIds])]
      const users = allIds.length ? await getUsersByIdsBasicDb(allIds, tenant) : []
      const userMap = new Map(users.map(u => [u.id, { name: u.name ?? '', phone: u.phone ?? '' }]))

      return earnings.map(e => ({
        ...e,
        id: String(e.id),
        grossAmount: Number(e.grossAmount),
        netAmount: Number(e.netAmount),
        eventData: e.eventData || {},
        calculatedAt: e.calculatedAt instanceof Date ? e.calculatedAt.toISOString() : String(e.calculatedAt),
        referrerName: userMap.get(e.referrerId)?.name ?? null,
        referrerPhone: userMap.get(e.referrerId)?.phone ?? null,
        refereeName: userMap.get(e.refereeId)?.name ?? null,
        refereePhone: userMap.get(e.refereeId)?.phone ?? null,
      }))
    }

    if (referrerId) {
      const earnings = await getReferralEarningsByReferrerDb(Number(referrerId), tenant, filterOpts)
      return enrichEarningsWithUsers(earnings)
    }

    if (refereeId) {
      const earnings = await getReferralEarningsByRefereeDb(Number(refereeId), tenant, filterOpts)
      return enrichEarningsWithUsers(earnings)
    }

    // List all earnings for tenant (with optional filters)
    const earnings = await getReferralEarningsAllDb(tenant, filterOpts)
    return enrichEarningsWithUsers(earnings)
  },

  referralSettlements: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.settlements', 'view')
    const filters = z.object({
      referrerId: z.string().min(1),
      status: z.string().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
    const settlements = await getReferralSettlementsByReferrerDb(Number(filters.referrerId), tenant, {
      status: filters.status,
      fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters.toDate ? new Date(filters.toDate) : undefined,
    })

    return settlements.map(s => ({
      ...s,
      id: String(s.id),
      cashAmount: Number(s.cashAmount),
      bonusAmount: Number(s.bonusAmount),
      settledAt: s.settledAt ? (s.settledAt instanceof Date ? s.settledAt.toISOString() : String(s.settledAt)) : null,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    }))
  },

  referralStats: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const { fromDate, toDate } = z.object({
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js')
    const currency = await getWhitelabelCurrency(tenant)

    // TODO: Implement stats aggregation
    // This would query clicks, attributions, earnings, settlements
    return {
      totalClicks: 0,
      totalSignups: 0,
      totalAttributions: 0,
      totalEarnings: 0,
      totalSettled: 0,
      totalPending: 0,
      currency,
      periodStart: fromDate,
      periodEnd: toDate,
    }
  },

  topReferrers: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const filters = z.object({
      limit: z.number().int().positive().optional(),
      sortBy: z.enum(['referrals', 'earnings', 'conversion']).optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    const topReferrers = await getTopReferrersDb(tenant, {
      limit: filters.limit,
      sortBy: filters.sortBy || 'earnings',
      fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters.toDate ? new Date(filters.toDate) : undefined,
    })

    const referrerIds = [...new Set(topReferrers.map(r => r.referrerId))]
    const users = referrerIds.length ? await getUsersByIdsBasicDb(referrerIds, tenant) : []
    const userMap = new Map(users.map(u => [u.id, { name: u.name ?? '', phone: u.phone ?? '' }]))

    return topReferrers.map(r => ({
      referrerId: r.referrerId,
      referrerName: userMap.get(r.referrerId)?.name ?? null,
      referrerPhone: userMap.get(r.referrerId)?.phone ?? null,
      totalEarnings: r.totalEarnings,
      totalReferrals: r.totalReferrals,
      activeReferrals: r.activeReferrals,
      totalTransactions: r.totalTransactions,
      totalClicks: r.totalClicks,
      conversionRate: r.conversionRate,
    }))
  },

  referrerStats: async (_: unknown, args: unknown, ctx: any) => {
    requireReadPermission(ctx, 'referrals.overview', 'view')
    const filters = z.object({
      referrerId: z.string().min(1),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
    }).parse(args || {})

    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

    const stats = await getReferrerStatsDb(Number(filters.referrerId), tenant, {
      fromDate: filters.fromDate ? new Date(filters.fromDate) : undefined,
      toDate: filters.toDate ? new Date(filters.toDate) : undefined,
    })

    return {
      referrerId: stats.referrerId,
      totalEarnings: stats.totalEarnings,
      grossEarnings: stats.grossEarnings,
      totalReferrals: stats.totalReferrals,
      activeReferrals: stats.activeReferrals,
      totalTransactions: stats.totalTransactions,
      totalClicks: stats.totalClicks,
      totalAttributions: stats.totalAttributions,
      conversionRate: stats.conversionRate,
      earningsByRuleType: stats.earningsByRuleType
        .filter(e => e.ruleType !== 'REVSHARE')
        .map(e => ({
          ruleType: e.ruleType,
          totalEarnings: e.totalEarnings,
          count: e.count,
        })),
    }
  },
}

