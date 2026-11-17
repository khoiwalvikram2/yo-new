import { z } from 'zod'
import {
  createBonusCampaignDb,
  updateBonusCampaignDb,
  getBonusCampaignDb,
  saveBonusCampaignGamesDb,
  saveBonusCampaignMatkasDb,
  distributeBonusCampaignDb,
  createBonusCodeDb,
} from '@src/repos/marketing/bonusesRepo.js'
import {
  createCasinoGameBundleDb,
  updateCasinoGameBundleDb,
  deleteCasinoGameBundleDb,
} from '@src/repos/marketing/casinoGameBundleRepo.js'
import { getEffectiveTenant } from '@src/domains/common/directorModeUtils.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'
import { currencyService } from '@src/services/currencyService.js'

const BonusCampaignCreateInputSchema = z.object({
  name: z.string().min(3).max(256),
  domain: z.enum(['sports', 'casino', 'matka', 'global']),
  type: z.string(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  budgetNumeric: z.number().min(0).optional(),
  currency: z.string().length(3),
  rulesJson: z.any().optional(),
  codeMode: z.enum(['auto', 'claim', 'code']).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  limitsJson: z.any().optional(),
  directSubType: z.string().nullable().optional(),
  depositConditionType: z.enum(['greater_than', 'equal_to', 'less_than', 'greater_equal', 'less_equal']).optional(),
  depositConditionAmount: z.number().min(0).optional(),
  distributionType: z.enum(['instant_otp', 'instant_cash', 'roll_over']).optional(),
  amountType: z.enum(['fixed', 'percentage']).optional(),
  amount: z.number().min(0).optional(),
  percentage: z.number().min(0).max(100).optional(),
  numberOfPlayers: z.number().int().min(1).optional(),
  usagePerPlayer: z.number().int().min(1).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  wagering: z.number().min(0).optional(),
  expiryBonusDays: z.number().int().min(1).optional().nullable(),
  depositRequired: z.boolean().optional(),
  releaseType: z.enum(['bonus_amount_only', 'total_bonus_wallet']).optional(),
})

const BonusCampaignUpdateInputSchema = BonusCampaignCreateInputSchema.partial().extend({
  id: z.string(),
})

const CasinoGameBundleInputSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  domain: z.enum(['casino', 'sports', 'matka']),
  gameIds: z.array(z.string()).min(1),
  gameWeights: z.record(z.string(), z.coerce.number()).optional(),
})

const CasinoGameBundleUpdateInputSchema = CasinoGameBundleInputSchema.partial()

export const marketingMutationResolvers = {
  // Promotions > Campaigns and > Content (createPromotion, publishPromotion, pausePromotion, createContent,
  // updateContent, publishContent, deleteContent) were retired on 2026-11-04 (MAR-14).

  createBonusCampaignV2: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx) || 'default'
    try {
      const input = BonusCampaignCreateInputSchema.parse(args.input)
      if (!currencyService.isValidCurrency(input.currency)) {
        return {
          success: false,
          message: `Invalid currency: ${input.currency}`,
          campaign: null,
        }
      }
      if (input.amountType === 'fixed' && input.amount == null && input.type !== 'special') {
        return { success: false, message: 'Amount is required when amount type is fixed', campaign: null }
      }
      if (input.type === 'special') {
        if (!input.distributionType) {
          return { success: false, message: 'Special bonus requires a distribution type', campaign: null }
        }
      }
      if (input.amountType === 'percentage' && input.percentage == null) {
        return { success: false, message: 'Percentage is required when amount type is percentage', campaign: null }
      }
      if (input.type === 'losing_bonus') {
        if (input.distributionType !== 'roll_over') {
          return { success: false, message: 'Losing bonus requires distribution type Roll Over', campaign: null }
        }
        if (input.amountType !== 'percentage' || input.percentage == null) {
          return { success: false, message: 'Losing bonus requires amount type Percentage and a percentage value', campaign: null }
        }
        if (!input.domain) {
          return { success: false, message: 'Losing bonus requires a domain (All/Sports/Casino/Matka)', campaign: null }
        }
        if (!input.releaseType || !['bonus_amount_only', 'total_bonus_wallet'].includes(input.releaseType)) {
          return { success: false, message: 'Losing bonus requires a release type (Roll Over)', campaign: null }
        }
      }
      const campaign = await createBonusCampaignDb({
        ...input,
        tenant,
        directSubType: input.directSubType ?? undefined,
      })
      return {
        success: true,
        message: 'Bonus campaign created successfully',
        campaign: {
          ...campaign,
          id: String(campaign.id),
          budgetNumeric: Number(campaign.budgetNumeric || 0),
          amount: campaign.amount ? Number(campaign.amount) : null,
          percentage: campaign.percentage ? Number(campaign.percentage) : null,
          depositConditionAmount: campaign.depositConditionAmount
            ? Number(campaign.depositConditionAmount)
            : null,
          wagering: campaign.wagering ? Number(campaign.wagering) : null,
          validFrom: campaign.validFrom ? campaign.validFrom.toISOString() : null,
          validTo: campaign.validTo ? campaign.validTo.toISOString() : null,
          startDate: campaign.startDate ? campaign.startDate.toISOString() : null,
          endDate: campaign.endDate ? campaign.endDate.toISOString() : null,
          expiryBonusDays: campaign.expiryBonusDays ?? null,
          createdAt: campaign.createdAt.toISOString(),
          updatedAt: campaign.updatedAt.toISOString(),
          casinoGameIds: [],
          matkaGameIds: [],
          casinoGameWeights: null,
          matkaBidTypeWeights: null,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to create bonus campaign',
        campaign: null,
      }
    }
  },

  updateBonusCampaign: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx) || 'default'
    const input = BonusCampaignUpdateInputSchema.parse(args.input)
    const id = parseInt(input.id, 10)
    if (isNaN(id)) {
      return { success: false, message: 'Invalid campaign ID', campaign: null }
    }
    if (input.currency && !currencyService.isValidCurrency(input.currency)) {
      return { success: false, message: `Invalid currency: ${input.currency}`, campaign: null }
    }
    if (input.type === 'losing_bonus') {
      if (input.distributionType !== undefined && input.distributionType !== 'roll_over') {
        return { success: false, message: 'Losing bonus requires distribution type Roll Over', campaign: null }
      }
      if (input.amountType !== undefined && input.amountType !== 'percentage') {
        return { success: false, message: 'Losing bonus requires amount type Percentage', campaign: null }
      }
      if (input.releaseType !== undefined && !['bonus_amount_only', 'total_bonus_wallet'].includes(input.releaseType)) {
        return { success: false, message: 'Losing bonus requires a valid release type', campaign: null }
      }
    }
    try {
      const { id: _id, ...updateData } = input
      const campaign = await updateBonusCampaignDb(id, tenant, {
        ...updateData,
        directSubType: updateData.directSubType ?? undefined,
        id,
      })
      if (!campaign) {
        return { success: false, message: 'Campaign not found', campaign: null }
      }
      return {
        success: true,
        message: 'Bonus campaign updated successfully',
        campaign: {
          ...campaign,
          id: String(campaign.id),
          budgetNumeric: Number(campaign.budgetNumeric || 0),
          amount: campaign.amount ? Number(campaign.amount) : null,
          percentage: campaign.percentage ? Number(campaign.percentage) : null,
          depositConditionAmount: campaign.depositConditionAmount
            ? Number(campaign.depositConditionAmount)
            : null,
          wagering: campaign.wagering ? Number(campaign.wagering) : null,
          validFrom: campaign.validFrom ? campaign.validFrom.toISOString() : null,
          validTo: campaign.validTo ? campaign.validTo.toISOString() : null,
          startDate: campaign.startDate ? campaign.startDate.toISOString() : null,
          endDate: campaign.endDate ? campaign.endDate.toISOString() : null,
          expiryBonusDays: campaign.expiryBonusDays ?? null,
          createdAt: campaign.createdAt.toISOString(),
          updatedAt: campaign.updatedAt.toISOString(),
          casinoGameIds: (campaign.rulesJson as any)?.casinoGameIds || [],
          matkaGameIds: (campaign.rulesJson as any)?.matkaGameIds || [],
          casinoGameWeights: (campaign.rulesJson as any)?.casinoGameWeights || null,
          matkaBidTypeWeights: (campaign.rulesJson as any)?.matkaBidTypeWeights || null,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update bonus campaign',
        campaign: null,
      }
    }
  },

  deleteBonusCampaign: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx) || 'default'
    const id = parseInt(args.id, 10)

    if (isNaN(id)) {
      return {
        success: false,
        message: 'Invalid campaign ID',
      }
    }

    try {
      // Soft delete: only change status to 'ended', do not remove from database
      const campaign = await updateBonusCampaignDb(id, tenant || 'default', { id, status: 'ended' })
      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found',
        }
      }
      return {
        success: true,
        message: 'Bonus campaign ended successfully',
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to end bonus campaign',
      }
    }
  },

  saveBonusCampaignGames: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx) || 'default'
    const campaignId = parseInt(args.campaignId, 10)
    if (isNaN(campaignId)) {
      return { success: false, message: 'Invalid campaign ID', campaign: null }
    }
    try {
      const campaign = await saveBonusCampaignGamesDb(
        campaignId,
        tenant,
        args.gameIds || [],
        args.gameWeights || undefined
      )

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found',
          campaign: null,
        }
      }

      return {
        success: true,
        message: 'Games saved successfully',
        campaign: {
          ...campaign,
          id: String(campaign.id),
          budgetNumeric: Number(campaign.budgetNumeric || 0),
          casinoGameIds: (campaign.rulesJson as any)?.casinoGameIds || [],
          casinoGameWeights: (campaign.rulesJson as any)?.casinoGameWeights || null,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to save games',
        campaign: null,
      }
    }
  },

  saveBonusCampaignMatkas: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx) || 'default'
    const campaignId = parseInt(args.campaignId, 10)

    if (isNaN(campaignId)) {
      return {
        success: false,
        message: 'Invalid campaign ID',
        campaign: null,
      }
    }

    try {
      const campaign = await saveBonusCampaignMatkasDb(
        campaignId,
        tenant || 'default',
        args.matkaIds || [],
        args.matkaBidTypeWeights || undefined
      )

      if (!campaign) {
        return {
          success: false,
          message: 'Campaign not found',
          campaign: null,
        }
      }

      return {
        success: true,
        message: 'Matka markets saved successfully',
        campaign: {
          ...campaign,
          id: String(campaign.id),
          budgetNumeric: Number(campaign.budgetNumeric || 0),
          matkaGameIds: (campaign.rulesJson as any)?.matkaGameIds || [],
          matkaBidTypeWeights: (campaign.rulesJson as any)?.matkaBidTypeWeights || null,
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to save Matka markets',
        campaign: null,
      }
    }
  },

  createCasinoGameBundle: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.bundles', 'create')) {
      return { success: false, message: 'Forbidden: insufficient permissions for game bundles', bundle: null }
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    
    // Preprocess gameWeights to ensure all values are numbers
    const processedInput = { ...args.input }
    if (processedInput.gameWeights && typeof processedInput.gameWeights === 'object') {
      const weights: Record<string, number> = {}
      Object.keys(processedInput.gameWeights).forEach((key) => {
        const value = processedInput.gameWeights[key]
        weights[key] = typeof value === 'number' ? value : parseFloat(String(value)) || 1
      })
      processedInput.gameWeights = weights
    }
    
    const input = CasinoGameBundleInputSchema.parse(processedInput)

    try {
      const bundle = await createCasinoGameBundleDb({
        ...input,
        tenant: tenant || 'default',
        createdBy: ctx?.user?.id ? String(ctx.user.id) : undefined,
      })

      return {
        success: true,
        message: 'Bundle created successfully',
        bundle: {
          ...bundle,
          id: String(bundle.id),
          gameIds: (bundle.gameIds as any) || [],
          gameWeights: bundle.gameWeights || null,
          gameCount: Array.isArray(bundle.gameIds) ? (bundle.gameIds as any).length : 0,
          createdAt: bundle.createdAt.toISOString(),
          updatedAt: bundle.updatedAt.toISOString(),
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to create bundle',
        bundle: null,
      }
    }
  },

  updateCasinoGameBundle: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.bundles', 'update')) {
      return { success: false, message: 'Forbidden: insufficient permissions for game bundles', bundle: null }
    }
    const tenant = getEffectiveTenant(ctx) ?? 'default'
    const id = parseInt(args.id, 10)
    
    // Preprocess gameWeights to ensure all values are numbers
    const processedInput = { ...args.input }
    if (processedInput.gameWeights && typeof processedInput.gameWeights === 'object') {
      const weights: Record<string, number> = {}
      Object.keys(processedInput.gameWeights).forEach((key) => {
        const value = processedInput.gameWeights[key]
        weights[key] = typeof value === 'number' ? value : parseFloat(String(value)) || 1
      })
      processedInput.gameWeights = weights
    }
    
    const input = CasinoGameBundleUpdateInputSchema.parse(processedInput)

    if (isNaN(id)) {
      return {
        success: false,
        message: 'Invalid bundle ID',
        bundle: null,
      }
    }

    try {
      const bundle = await updateCasinoGameBundleDb(id, tenant, input)
      if (!bundle) {
        return { success: false, message: 'Bundle not found', bundle: null }
      }
      return {
        success: true,
        message: 'Bundle updated successfully',
        bundle: {
          ...bundle,
          id: String(bundle.id),
          gameIds: bundle.gameIds || [],
          gameWeights: bundle.gameWeights || null,
          gameCount: Array.isArray(bundle.gameIds) ? bundle.gameIds.length : 0,
          createdAt: bundle.createdAt.toISOString(),
          updatedAt: bundle.updatedAt.toISOString(),
        },
      }
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update bundle',
        bundle: null,
      }
    }
  },

  deleteCasinoGameBundle: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.bundles', 'delete')) {
      return { success: false, message: 'Forbidden: insufficient permissions for game bundles' }
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const id = parseInt(args.id, 10)
    if (isNaN(id)) {
      return { success: false, message: 'Invalid bundle ID' }
    }
    try {
      // false when this tenant has no such bundle (another whitelabel's id, or one already
      // deleted); reporting success there told the admin something was deleted (MAR-08).
      const deleted = await deleteCasinoGameBundleDb(id, tenant)
      if (!deleted) return { success: false, message: 'Bundle not found' }
      return { success: true, message: 'Bundle deleted successfully' }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to delete bundle' }
    }
  },

  distributeBonusCampaign: async (_: any, args: { campaignId: string }, ctx: any) => {
    const actorId = ctx?.user?.sub ? String(ctx.user.sub) : null
    if (!actorId) {
      return { success: false, message: 'Authentication required', distributedCount: null }
    }
    if (!hasPermission(ctx?.permissions ?? [], 'bonuses.detail', 'update')) {
      return { success: false, message: 'Forbidden: insufficient permissions to distribute bonus campaign', distributedCount: null }
    }
    const tenant = getEffectiveTenant(ctx) || 'default'
    const campaignId = parseInt(args.campaignId, 10)
    if (isNaN(campaignId)) {
      return { success: false, message: 'Invalid campaign ID', distributedCount: null }
    }
    try {
      const { distributedCount } = await distributeBonusCampaignDb(campaignId, tenant)
      const distributedAt = new Date().toISOString()
      await recordAuditDb({
        tenant,
        actorId,
        domain: 'bonuses',
        action: 'bonus_distribute',
        resourceType: 'bonus_campaign',
        resourceId: String(campaignId),
        after: { distributedCount, distributedAt },
      }).catch(() => {})
      return { success: true, message: 'Bonus distributed successfully', distributedCount }
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Failed to distribute bonus',
        distributedCount: null,
      }
    }
  },

}
