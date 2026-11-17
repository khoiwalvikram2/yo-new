import { z } from 'zod'
import {
  listBonusCampaignsDb,
  getBonusCampaignDb,
  getEligibleUsersForDistribution,
  listBonusAwardsAdminPage,
  aggregateBonusAwardsAdminPageStats,
  type BonusAwardsAdminPageFilters,
} from '@src/repos/marketing/bonusesRepo.js'
import { resolveBonusAwardsPageScope } from '@src/domains/marketing/services/resolveBonusAwardsPageScope.js'

function mapCampaignToGraphQL(campaign: any) {
  return {
    ...campaign,
    id: String(campaign.id),
    budgetNumeric: Number(campaign.budgetNumeric || 0),
    amount: campaign.amount ? Number(campaign.amount) : null,
    percentage: campaign.percentage ? Number(campaign.percentage) : null,
    depositConditionAmount: campaign.depositConditionAmount ? Number(campaign.depositConditionAmount) : null,
    wagering: campaign.wagering ? Number(campaign.wagering) : null,
    validFrom: campaign.validFrom ? (campaign.validFrom instanceof Date ? campaign.validFrom.toISOString() : campaign.validFrom) : null,
    validTo: campaign.validTo ? (campaign.validTo instanceof Date ? campaign.validTo.toISOString() : campaign.validTo) : null,
    startDate: campaign.startDate ? (campaign.startDate instanceof Date ? campaign.startDate.toISOString() : campaign.startDate) : null,
    endDate: campaign.endDate ? (campaign.endDate instanceof Date ? campaign.endDate.toISOString() : campaign.endDate) : null,
    expiryBonusDays: campaign.expiryBonusDays ?? null,
    directSubType: campaign.directSubType ? String(campaign.directSubType) : null,
    createdAt: campaign.createdAt instanceof Date ? campaign.createdAt.toISOString() : String(campaign.createdAt),
    updatedAt: campaign.updatedAt instanceof Date ? campaign.updatedAt.toISOString() : String(campaign.updatedAt),
    casinoGameIds: (campaign.rulesJson as any)?.casinoGameIds || [],
    matkaGameIds: (campaign.rulesJson as any)?.matkaGameIds || [],
    casinoGameWeights: (campaign.rulesJson as any)?.casinoGameWeights || null,
    matkaBidTypeWeights: (campaign.rulesJson as any)?.matkaBidTypeWeights || null,
    distributedAt: campaign.distributedAt ? (campaign.distributedAt instanceof Date ? campaign.distributedAt.toISOString() : campaign.distributedAt) : null,
  }
}
import {
  listCasinoGameBundlesDb,
  getCasinoGameBundleDb,
} from '@src/repos/marketing/casinoGameBundleRepo.js'
import { getEffectiveTenant } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'

const CampaignFiltersSchema = z.object({
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  domain: z.enum(['sports', 'casino', 'matka', 'global']).optional(),
  type: z.string().optional(),
  search: z.string().optional(),
})

const BundleFiltersSchema = z.object({
  search: z.string().optional(),
  domain: z.enum(['casino', 'sports', 'matka']).optional(),
})

function parseBonusAwardsPageRepoFilters(filters: Record<string, unknown> | null | undefined): BonusAwardsAdminPageFilters {
  const f = filters ?? {}
  const statusRaw = f.status as string[] | undefined
  const domainRaw = f.domain as string | undefined
  let campaignIdParsed: number | undefined
  if (f.campaignId != null && f.campaignId !== '') {
    const n = typeof f.campaignId === 'number' ? f.campaignId : parseInt(String(f.campaignId), 10)
    if (!Number.isNaN(n)) campaignIdParsed = n
  }
  return {
    dateFrom: f.dateFrom as string | undefined,
    dateTo: f.dateTo as string | undefined,
    status: Array.isArray(statusRaw) && statusRaw.length ? statusRaw : undefined,
    domain:
      domainRaw && ['sports', 'casino', 'matka', 'global'].includes(domainRaw)
        ? (domainRaw as 'sports' | 'casino' | 'matka' | 'global')
        : undefined,
    campaignId: campaignIdParsed,
  }
}

export const marketingQueryResolvers = {
  // Promotions > Campaigns and > Content (promotions, content) were retired on 2026-11-04 (MAR-14).

  bonusCampaigns: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions for bonus campaigns')
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const filters = CampaignFiltersSchema.parse(args)
    const campaigns = await listBonusCampaignsDb(tenant || 'default', filters)
    return campaigns.map((c: any) => mapCampaignToGraphQL(c))
  },

  activeSpecialBonusCampaigns: async (_: any, _args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions for bonus campaigns')
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const campaigns = await listBonusCampaignsDb(tenant || 'default', { type: 'special', status: 'active' })
    return campaigns.map((c: any) => mapCampaignToGraphQL(c))
  },

  previewBonusDistribution: async (_: any, args: { campaignId: string }, ctx: any) => {
    if (!ctx?.user?.sub) throw new Error('Authentication required')
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) throw new Error('Forbidden: insufficient permissions for bonus campaigns')
    const tenant = getEffectiveTenant(ctx) || 'default'
    const campaignId = parseInt(args.campaignId, 10)
    if (isNaN(campaignId)) throw new Error('Invalid campaign ID')
    const campaign = await getBonusCampaignDb(campaignId, tenant || 'default')
    if (!campaign) throw new Error('Campaign not found')
    if (campaign.type !== 'direct_amount') throw new Error('Distribution only allowed for Direct Bonus campaigns')
    const eligibleIds = await getEligibleUsersForDistribution(campaignId, tenant || 'default', campaign)
    return {
      eligibleCount: eligibleIds.length,
      campaignName: campaign.name,
      campaignType: campaign.type,
      alreadyDistributed: (campaign as any).distributedAt != null,
      distributedAt: (campaign as any).distributedAt ? ((campaign as any).distributedAt instanceof Date ? (campaign as any).distributedAt.toISOString() : (campaign as any).distributedAt) : null,
    }
  },

  bonusCampaign: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions for bonus campaigns')
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const id = parseInt(args.id, 10)
    if (isNaN(id)) throw new Error('Invalid campaign ID')
    const campaign = await getBonusCampaignDb(id, tenant || 'default')
    if (!campaign) return null
    const c = campaign as any
    return {
      ...campaign,
      id: String(campaign.id),
      budgetNumeric: Number(campaign.budgetNumeric || 0),
      amount: c.amount ? Number(c.amount) : null,
      percentage: c.percentage ? Number(c.percentage) : null,
      depositConditionAmount: c.depositConditionAmount ? Number(c.depositConditionAmount) : null,
      wagering: c.wagering ? Number(c.wagering) : null,
      validFrom: c.validFrom ? (c.validFrom instanceof Date ? c.validFrom.toISOString() : c.validFrom) : null,
      validTo: c.validTo ? (c.validTo instanceof Date ? c.validTo.toISOString() : c.validTo) : null,
      startDate: c.startDate ? (c.startDate instanceof Date ? c.startDate.toISOString() : c.startDate) : null,
      endDate: c.endDate ? (c.endDate instanceof Date ? c.endDate.toISOString() : c.endDate) : null,
      expiryBonusDays: c.expiryBonusDays ?? null,
      directSubType: c.directSubType ? String(c.directSubType) : null,
      createdAt: (campaign.createdAt as Date).toISOString(),
      updatedAt: (campaign.updatedAt as Date).toISOString(),
      casinoGameIds: (campaign.rulesJson as any)?.casinoGameIds || [],
      matkaGameIds: (campaign.rulesJson as any)?.matkaGameIds || [],
      casinoGameWeights: (campaign.rulesJson as any)?.casinoGameWeights || null,
      matkaBidTypeWeights: (campaign.rulesJson as any)?.matkaBidTypeWeights || null,
      distributedAt: c.distributedAt ? (c.distributedAt instanceof Date ? c.distributedAt.toISOString() : c.distributedAt) : null,
    }
  },

  casinoGameBundles: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.bundles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for game bundles')
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    
    // Extract only the fields we need and validate
    const filters: { search?: string; domain?: 'casino' | 'sports' | 'matka' } = {}
    
    if (args.search && typeof args.search === 'string') {
      filters.search = args.search
    }
    
    if (args.domain && typeof args.domain === 'string') {
      const validDomains: ('casino' | 'sports' | 'matka')[] = ['casino', 'sports', 'matka']
      if (validDomains.includes(args.domain as 'casino' | 'sports' | 'matka')) {
        filters.domain = args.domain as 'casino' | 'sports' | 'matka'
      } else {
        throw new Error(`Invalid domain: ${args.domain}. Must be one of: ${validDomains.join(', ')}`)
      }
    }

    const bundles = await listCasinoGameBundlesDb(tenant || 'default', filters)

    return bundles.map((bundle) => ({
      ...bundle,
      id: String(bundle.id),
      gameIds: (bundle.gameIds as any) || [],
      gameWeights: bundle.gameWeights || null,
      gameCount: Array.isArray(bundle.gameIds) ? (bundle.gameIds as any).length : 0,
      createdAt: bundle.createdAt.toISOString(),
      updatedAt: bundle.updatedAt.toISOString(),
    }))
  },

  bonusAwardsPage: async (
    _: any,
    args: { filters?: Record<string, unknown> | null; offset?: number | null; limit?: number | null },
    ctx: any,
  ) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions for bonus awards')
    }
    const scope = await resolveBonusAwardsPageScope(ctx, {
      agentUsername: (args.filters?.agentUsername as string) ?? undefined,
      playerSearch: (args.filters?.playerSearch as string) ?? undefined,
    })
    if (!scope) {
      return { items: [], total: 0 }
    }
    const { tenant, userIds } = scope
    const offset = Math.max(0, args.offset ?? 0)
    const limit = Math.min(500, Math.max(1, args.limit ?? 50))
    const repoFilters = parseBonusAwardsPageRepoFilters(args.filters as Record<string, unknown> | null | undefined)
    const { items, total } = await listBonusAwardsAdminPage(tenant, repoFilters, offset, limit, userIds)
    return {
      total,
      items: items.map((r) => ({
        id: String(r.id),
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        userId: r.userId,
        userName: r.userName,
        userPhone: r.userPhone,
        domain: r.domain,
        type: r.type,
        amount: Number(r.amount || 0),
        currency: r.currency,
        wageringReq: Number(r.wageringReq || 0),
        currentWagering: Number(r.currentWagering || 0),
        status: r.status,
        awardedAt: r.awardedAt instanceof Date ? r.awardedAt.toISOString() : String(r.awardedAt),
        completedAt: r.completedAt ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : String(r.completedAt)) : null,
        triggerAmount: r.triggerAmount != null ? Number(r.triggerAmount) : null,
        firstDepositRequired: r.firstDepositRequired ?? null,
        firstDepositUnlocked: r.firstDepositUnlocked ?? null,
        distributionType: r.distributionType ?? null,
        statusUpdatedAt: r.statusUpdatedAt
          ? r.statusUpdatedAt instanceof Date
            ? r.statusUpdatedAt.toISOString()
            : String(r.statusUpdatedAt)
          : null,
        statusUpdatedByName: r.statusUpdatedByName ?? null,
        statusUpdatedByPhone: r.statusUpdatedByPhone ?? null,
        statusUpdatedByRemark: r.statusUpdatedByRemark ?? null,
        expiresAt: r.expiresAt ?? null,
      })),
    }
  },

  bonusAwardsPageStats: async (_: any, args: { filters?: Record<string, unknown> | null }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions for bonus awards')
    }
    const scope = await resolveBonusAwardsPageScope(ctx, {
      agentUsername: (args.filters?.agentUsername as string) ?? undefined,
      playerSearch: (args.filters?.playerSearch as string) ?? undefined,
    })
    if (!scope) {
      return {
        total: 0,
        pending: 0,
        active: 0,
        completed: 0,
        expired: 0,
        cancelled: 0,
        totalBonusPaid: 0,
        bonusWalletTotal: 0,
        wageringRemaining: 0,
        bonusUses: 0,
        bonusToCashTransferred: 0,
      }
    }
    const { tenant, userIds } = scope
    const repoFilters = parseBonusAwardsPageRepoFilters(args.filters as Record<string, unknown> | null | undefined)
    return aggregateBonusAwardsAdminPageStats(tenant, repoFilters, userIds)
  },

  casinoGameBundle: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.bundles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for game bundles')
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const id = parseInt(args.id, 10)

    if (isNaN(id)) {
      throw new Error('Invalid bundle ID')
    }

    const bundle = await getCasinoGameBundleDb(id, tenant || 'default')
    if (!bundle) return null
    return {
      ...bundle,
      id: String(bundle.id),
      gameIds: bundle.gameIds || [],
      gameWeights: bundle.gameWeights || null,
      gameCount: Array.isArray(bundle.gameIds) ? bundle.gameIds.length : 0,
      createdAt: bundle.createdAt.toISOString(),
      updatedAt: bundle.updatedAt.toISOString(),
    }
  },

}
