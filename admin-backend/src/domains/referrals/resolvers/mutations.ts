import {
  upsertReferralProgramDb,
  upsertReferralRuleDb,
  deleteReferralRuleDb,
  generateReferralLinkDb,
  recordReferralClickDb,
  getReferralLinkByCodeDb,
  createReferralAttributionDb,
  updateReferralAttributionStatusDb,
} from '@src/repos/referrals/referralsRepo.js'
import { attributionService } from '@src/services/referrals/attributionService.js'
import { couponService } from '@src/services/referrals/couponService.js'
import { raffleService } from '@src/services/referrals/raffleService.js'
import { budgetService } from '@src/services/referrals/budgetService.js'
import { settlementService } from '@src/services/referrals/settlementService.js'
import { z } from 'zod'
import { currencyService } from '@src/services/currencyService.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'

export const referralsMutationResolvers = {
  upsertReferralProgram: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          name: z.string().optional(),
          enabledModes: z.array(z.string()).optional(),
          maxDepth: z.number().int().positive().max(4).optional(), // Enforce max 4 tiers
          flags: z.any().optional(),
          minReferralBalanceForCashTransfer: z.number().min(0).optional(),
          // Deprecated fields (ignored if provided)
          attributionModel: z.enum(['LAST_CLICK', 'FIRST_CLICK', 'LINEAR', 'TIME_DECAY']).optional(),
          attributionWindowDays: z.number().int().positive().optional(),
          depositsWindowDays: z.number().int().positive().optional(),
          negativeCarryover: z.boolean().optional(),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      // Only pass non-deprecated fields to the database
      const program = await upsertReferralProgramDb(tenant, {
        name: input.name,
        enabledModes: input.enabledModes,
        maxDepth: input.maxDepth,
        flags: input.flags,
        minReferralBalanceForCashTransfer: input.minReferralBalanceForCashTransfer,
      })

      const enabledModes = ((program.enabledModes || []) as string[]).filter((m) => m !== 'REVSHARE')
      return {
        success: true,
        message: 'Referral program updated successfully',
        program: {
          ...program,
          id: String(program.id),
          enabledModes,
          flags: program.flags || {},
          minReferralBalanceForCashTransfer: program.minReferralBalanceForCashTransfer != null ? Number(program.minReferralBalanceForCashTransfer) : null,
          createdAt: program.createdAt instanceof Date ? program.createdAt.toISOString() : String(program.createdAt),
          updatedAt: program.updatedAt instanceof Date ? program.updatedAt.toISOString() : String(program.updatedAt),
        },
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update referral program',
        program: null,
      }
    }
  },

  upsertReferralRules: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          ruleId: z.string().optional(),
          ruleType: z.string().min(1),
          tierRates: z.any().optional(),
          fixedAmounts: z.any().optional(),
          caps: z.any().optional(),
          thresholds: z.any().optional(),
          payoutType: z.enum(['CASH', 'BONUS', 'SPLIT']).optional(),
          splitRatio: z.any().optional(),
          escrow: z.any().optional(),
          configJson: z.any().optional(),
          reloadDepositsCount: z
            .number({ error: 'reloadDepositsCount must be a number' })
            .int()
            .min(0, { message: 'Number of last deposits must be between 0 and 30 (0 = unlimited)' })
            .max(30, { message: 'Number of last deposits must be between 0 and 30 (0 = unlimited)' })
            .optional(),
          reloadMinDeposit: z
            .number({ error: 'reloadMinDeposit must be a number' })
            .int()
            .min(0, { message: 'Minimum deposit must be 0 or greater' })
            .optional(),
          isActive: z.boolean().optional(),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const { getReferralProgramByTenantDb } = await import('@src/repos/referrals/referralsRepo.js')
      const program = await getReferralProgramByTenantDb(tenant)
      if (!program) {
        throw new Error('Referral program not found. Please create a program first.')
      }

      // Revenue Share rule type is not supported
      if (input.ruleType === 'REVSHARE') {
        throw new Error('Revenue Share (REVSHARE) rule type is not supported. Use Loss Share for tiered commission on losses.')
      }

      // Validate tierRates only for LOSS_SHARE
      const tieredRuleTypes = ['LOSS_SHARE']
      if (input.tierRates && !tieredRuleTypes.includes(input.ruleType)) {
        throw new Error('Tier rates can only be configured for LOSS_SHARE rule type')
      }

      // Validate max depth of 4 for tier rates
      if (input.tierRates && typeof input.tierRates === 'object') {
        const tierKeys = Object.keys(input.tierRates).map(Number)
        const maxTier = Math.max(...tierKeys, 0)
        if (maxTier > 4) {
          throw new Error('Maximum tier depth is 4. Tier rates can only be set for tiers 1-4.')
        }
      }

      // Validate reloadDepositsCount only for RELOAD_DEPOSITS_PCT
      if (input.reloadDepositsCount !== undefined && input.ruleType !== 'RELOAD_DEPOSITS_PCT') {
        throw new Error('reloadDepositsCount can only be set for RELOAD_DEPOSITS_PCT rule type')
      }

      // Validate reloadMinDeposit only for RELOAD_DEPOSITS_PCT
      if (input.reloadMinDeposit !== undefined && input.ruleType !== 'RELOAD_DEPOSITS_PCT') {
        throw new Error('reloadMinDeposit can only be set for RELOAD_DEPOSITS_PCT rule type')
      }

      const rule = await upsertReferralRuleDb(
        tenant,
        program.id,
        input.ruleId ? Number(input.ruleId) : null,
        input
      )

      return {
        success: true,
        message: 'Referral rule updated successfully',
        rule: {
          ...rule,
          id: String(rule.id),
          tierRates: rule.tierRates || {},
          fixedAmounts: rule.fixedAmounts || {},
          caps: rule.caps || {},
          thresholds: rule.thresholds || {},
          splitRatio: rule.splitRatio || { cash: 100, bonus: 0 },
          escrow: rule.escrow || { untilKyc: false, untilFraudClear: false },
          configJson: rule.configJson || {},
          reloadDepositsCount: rule.reloadDepositsCount ?? null,
          reloadMinDeposit: rule.reloadMinDeposit ?? null,
          createdAt: rule.createdAt instanceof Date ? rule.createdAt.toISOString() : String(rule.createdAt),
          updatedAt: rule.updatedAt instanceof Date ? rule.updatedAt.toISOString() : String(rule.updatedAt),
        },
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update referral rule',
        rule: null,
      }
    }
  },

  generateReferralLink: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { userId, agentId, code, utmParams } = z.object({
        userId: z.string().optional(),
        agentId: z.string().uuid().optional(),
        code: z.string().regex(/^[A-Z0-9]{6,12}$/i).optional(),
        utmParams: z.any().optional(),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

      // Authorization: If agentId provided, ensure user is that agent or admin
      if (agentId) {
        // Check if logged-in user is the agent or has admin permissions
        const isAgent = ctx?.user?.type === 'agent' && ctx?.user?.agentId === agentId
        const isAdmin = ctx?.user?.roles?.some((r: string) => {
          const roleLower = r.toLowerCase()
          return r === 'Super Admin' || roleLower === 'super_admin' || 
            (roleLower.includes('super') && roleLower.includes('admin')) ||
            r === 'Whitelabel Admin' || roleLower.includes('whitelabel')
        })
        
        if (!isAgent && !isAdmin) {
          throw new Error('Unauthorized: You can only create referral links for yourself or as an admin')
        }
      }

      // If userId provided, ensure user has permission
      if (userId) {
        const isAdmin = ctx?.user?.roles?.some((r: string) => {
          const roleLower = r.toLowerCase()
          return r === 'Super Admin' || roleLower === 'super_admin' || 
            (roleLower.includes('super') && roleLower.includes('admin')) ||
            r === 'Whitelabel Admin' || roleLower.includes('whitelabel')
        })
        if (!isAdmin) {
          throw new Error('Unauthorized: Only admins can create referral links for users')
        }
        // The link is written under the caller's tenant whatever id it names, and nothing looked the user up.
        // Measured: kondareddi's admin created a live kondareddi code owned by grandwinn player 2050, which
        // user-backend then honours at sign-up as a referral by that player. The user must be in this tenant.
        const { getUserDb } = await import('@src/repos/users/usersRepo.js')
        const userIdNum = Number(userId)
        if (!Number.isSafeInteger(userIdNum) || userIdNum <= 0 || !(await getUserDb(userIdNum, tenant))) {
          throw new Error('User not found')
        }
        // Referral links belong to players. Staff share the users table, so a same-tenant support admin passed the
        // lookup above and got a live code of its own (SCO-06). Same answer as a missing user: no account kind leaks.
        const { isPlayerAccount } = await import('@src/repos/rbac/rbacRepo.js')
        if (!(await isPlayerAccount(userIdNum, tenant))) {
          throw new Error('User not found')
        }
      }

      // Use transaction for atomicity
      const { db } = await import('@/db/client.js')
      const link = await db.transaction(async (tx) => {
        return await generateReferralLinkDb(
          tenant,
          userId ? Number(userId) : null,
          agentId || null,
          code,
          utmParams,
          tx
        )
      })

      // Log successful creation

      return {
        success: true,
        message: 'Referral link generated successfully',
        link: {
          ...link,
          id: String(link.id),
          agentId: link.agentId || null,
          userId: link.userId || null,
          utmParams: link.utmParams || {},
          createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
          updatedAt: link.updatedAt instanceof Date ? link.updatedAt.toISOString() : String(link.updatedAt),
        },
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to generate referral link',
        link: null,
      }
    }
  },

  recordReferralClick: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          code: z.string().min(1),
          ipAddress: z.string().optional(),
          userAgent: z.string().optional(),
          utmSource: z.string().optional(),
          utmMedium: z.string().optional(),
          utmCampaign: z.string().optional(),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const link = await getReferralLinkByCodeDb(input.code)
      if (!link) {
        throw new Error('Invalid referral code')
      }

      const click = await recordReferralClickDb(tenant, link.id, link.userId, {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
      })

      return {
        success: true,
        message: 'Referral click recorded',
        click: {
          ...click,
          id: String(click.id),
          clickedAt: click.clickedAt instanceof Date ? click.clickedAt.toISOString() : String(click.clickedAt),
        },
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to record referral click',
        click: null,
      }
    }
  },

  attributeSignup: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          refCode: z.string().optional(),
          userId: z.string().min(1),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const refereeId = Number(input.userId)

      // If refCode provided, record click first
      if (input.refCode) {
        const link = await getReferralLinkByCodeDb(input.refCode)
        if (link) {
          await recordReferralClickDb(tenant, link.id, link.userId, {})
        }
      }

      // Attribute referral
      const attribution = await attributionService.attributeReferee(tenant, refereeId)

      if (!attribution) {
        return {
          success: false,
          message: 'No referral attribution found',
          attribution: null,
        }
      }

      // Confirm attribution
      const { getReferralAttributionByRefereeDb } = await import('@src/repos/referrals/referralsRepo.js')
      const attr = await getReferralAttributionByRefereeDb(refereeId, tenant)
      if (attr) {
        await updateReferralAttributionStatusDb(attr.id, tenant, 'confirmed')
      }

      return {
        success: true,
        message: 'Signup attributed successfully',
        attribution: attr ? {
          ...attr,
          id: String(attr.id),
          attributedAt: attr.attributedAt instanceof Date ? attr.attributedAt.toISOString() : String(attr.attributedAt),
          confirmedAt: attr.confirmedAt ? (attr.confirmedAt instanceof Date ? attr.confirmedAt.toISOString() : String(attr.confirmedAt)) : null,
        } : null,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to attribute signup',
        attribution: null,
      }
    }
  },

  triggerSettlement: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { referrerId, ruleType } = z.object({
        referrerId: z.string().optional(),
        ruleType: z.string().optional(),
      }).parse(args || {})

      if (ruleType === 'REVSHARE') {
        return {
          success: false,
          message: 'Revenue Share (REVSHARE) settlement is not supported. Use LOSS_SHARE or omit ruleType.',
        }
      }

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

      if (referrerId) {
        const result = await settlementService.settleEarnings(tenant, Number(referrerId), ruleType)
        return {
          success: true,
          message: `Settled ${result.settled} earnings, ${result.failed} failed`,
        }
      } else {
        // Process all pending settlements
        const date = new Date()
        const result = await settlementService.processScheduledSettlements(tenant, date)
        return {
          success: true,
          message: `Processed ${result.settled} settlements, ${result.failed} failed`,
        }
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to trigger settlement',
      }
    }
  },

  grantManualPayout: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { earningId } = z.object({ earningId: z.string().min(1) }).parse(args)
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

      // This would manually trigger settlement for a specific earning
      // Implementation would call settlementService.settleSingleEarning
      return {
        success: true,
        message: 'Manual payout granted',
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to grant manual payout',
      }
    }
  },

  issueReferralCoupon: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          ruleId: z.string().min(1),
          referrerId: z.string().optional(),
          refereeId: z.string().optional(),
          amount: z.number().positive(),
          currency: z.string().min(1),
          bonusCampaignId: z.string().optional(),
          expiresAt: z.string().optional(),
        }),
      }).parse(args)

      if (!currencyService.isValidCurrency(input.currency)) {
        throw new Error(`Invalid currency: ${input.currency}`)
      }

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const result = await couponService.issueCoupon(tenant, {
        ruleId: Number(input.ruleId),
        referrerId: input.referrerId ? Number(input.referrerId) : undefined,
        refereeId: input.refereeId ? Number(input.refereeId) : undefined,
        amount: input.amount,
        currency: input.currency as any,
        bonusCampaignId: input.bonusCampaignId ? Number(input.bonusCampaignId) : undefined,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      })

      const { getReferralCouponByCodeDb } = await import('@src/repos/referrals/referralCouponsRepo.js')
      const coupon = await getReferralCouponByCodeDb(result.couponCode, tenant)

      return {
        success: true,
        message: 'Referral coupon issued successfully',
        coupon: coupon ? {
          ...coupon,
          id: String(coupon.id),
          amount: Number(coupon.amount),
          expiresAt: coupon.expiresAt ? (coupon.expiresAt instanceof Date ? coupon.expiresAt.toISOString() : String(coupon.expiresAt)) : null,
          usedAt: coupon.usedAt ? (coupon.usedAt instanceof Date ? coupon.usedAt.toISOString() : String(coupon.usedAt)) : null,
          createdAt: coupon.createdAt instanceof Date ? coupon.createdAt.toISOString() : String(coupon.createdAt),
        } : null,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to issue referral coupon',
        coupon: null,
      }
    }
  },

  createRaffleDraw: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          ruleId: z.string().min(1),
          scheduledAt: z.string().min(1),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const result = await raffleService.createRaffleDraw(tenant, Number(input.ruleId), new Date(input.scheduledAt))

      const { getReferralRaffleDrawByIdDb } = await import('@src/repos/referrals/referralRaffleRepo.js')
      const draw = await getReferralRaffleDrawByIdDb(result.drawId, tenant)

      return {
        success: true,
        message: 'Raffle draw created successfully',
        draw: draw ? {
          ...draw,
          id: String(draw.id),
          scheduledAt: draw.scheduledAt instanceof Date ? draw.scheduledAt.toISOString() : String(draw.scheduledAt),
          drawnAt: draw.drawnAt ? (draw.drawnAt instanceof Date ? draw.drawnAt.toISOString() : String(draw.drawnAt)) : null,
          winners: draw.winners || [],
          createdAt: draw.createdAt instanceof Date ? draw.createdAt.toISOString() : String(draw.createdAt),
          updatedAt: draw.updatedAt instanceof Date ? draw.updatedAt.toISOString() : String(draw.updatedAt),
        } : null,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create raffle draw',
        draw: null,
      }
    }
  },

  runRaffleDraw: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          drawId: z.string().min(1),
          numberOfWinners: z.number().int().positive(),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const winners = await raffleService.runRaffleDraw(tenant, Number(input.drawId), input.numberOfWinners)

      return {
        success: true,
        message: `Raffle draw completed with ${winners.length} winners`,
        draw: null, // Would need to fetch updated draw
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to run raffle draw',
        draw: null,
      }
    }
  },

  setBudgetCaps: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          programId: z.string().optional(),
          budgetType: z.enum(['daily', 'monthly']),
          amount: z.number().positive(),
          currency: z.string().min(1),
          periodStart: z.string().min(1),
          periodEnd: z.string().min(1),
        }),
      }).parse(args)

      if (!currencyService.isValidCurrency(input.currency)) {
        throw new Error(`Invalid currency: ${input.currency}`)
      }

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      await budgetService.setBudget(tenant, {
        programId: input.programId ? Number(input.programId) : null,
        budgetType: input.budgetType,
        amount: input.amount,
        currency: input.currency as any,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
      })

      return {
        success: true,
        message: 'Budget caps set successfully',
        budget: null, // Would need to fetch updated budget
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set budget caps',
        budget: null,
      }
    }
  },

  setLadderTiers: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          ruleId: z.string().min(1),
          tiers: z.any(),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const { getReferralRuleByIdDb, upsertReferralRuleDb } = await import('@src/repos/referrals/referralsRepo.js')
      const rule = await getReferralRuleByIdDb(Number(input.ruleId), tenant)
      if (!rule) {
        throw new Error('Rule not found')
      }

      await upsertReferralRuleDb(tenant, rule.programId, Number(input.ruleId), {
        ruleType: rule.ruleType,
        configJson: { ...(rule.configJson || {}), ladderTiers: input.tiers },
      })

      return {
        success: true,
        message: 'Ladder tiers set successfully',
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set ladder tiers',
      }
    }
  },

  setCashbackShare: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { input } = z.object({
        input: z.object({
          ruleId: z.string().min(1),
          sharePercent: z.number().min(0).max(100),
        }),
      }).parse(args)

      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')
      const { getReferralRuleByIdDb, upsertReferralRuleDb } = await import('@src/repos/referrals/referralsRepo.js')
      const rule = await getReferralRuleByIdDb(Number(input.ruleId), tenant)
      if (!rule) {
        throw new Error('Rule not found')
      }

      await upsertReferralRuleDb(tenant, rule.programId, Number(input.ruleId), {
        ruleType: rule.ruleType,
        configJson: { ...(rule.configJson || {}), cashbackSharePercent: input.sharePercent },
      })

      return {
        success: true,
        message: 'Cashback share set successfully',
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to set cashback share',
      }
    }
  },

  releaseEscrow: async (_: unknown, args: unknown, ctx: any) => {
    try {
      const { settlementId } = z.object({ settlementId: z.string().min(1) }).parse(args)
      // CRITICAL: For Director Admin, use effective tenant based on mode
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.whitelabel?.id || ctx?.tenant || 'default')

      const released = await settlementService.releaseEscrow(tenant, Number(settlementId))
      return {
        success: released,
        message: released ? 'Escrow released successfully' : 'Failed to release escrow',
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to release escrow',
      }
    }
  },
}

