import { attributionService } from './attributionService.js'
import { rewardsCalculatorService } from './rewardsCalculator.js'
import { settlementService } from './settlementService.js'
import { couponService } from './couponService.js'
import { raffleService } from './raffleService.js'
import {
  getReferralAttributionByRefereeDb,
  updateReferralAttributionStatusDb,
  getReferralProgramByTenantDb,
  getReferralRulesByProgramDb,
  getTotalTurnoverForUserDb,
} from '@src/repos/referrals/referralsRepo.js'
import { getReferralEarningsByRefereeDb } from '@src/repos/referrals/referralEarningsRepo.js'
import { CurrencyCode } from '@src/types/currency.js'

/**
 * Referral Integration Service - Hooks into user events to trigger referral rewards
 */
export class ReferralIntegrationService {
  /**
   * Handle user signup - attribute referral and trigger signup CPA rewards
   * Also handles agent referral codes by updating user's agentId and playerType
   */
  async handleSignup(
    tenant: string,
    userId: number,
    refCode?: string,
    currency: CurrencyCode = 'INR'
  ): Promise<void> {
    try {
      // Check if this is an agent referral code (single lookup, reuse result)
      let link = null
      if (refCode) {
        const { getReferralLinkByCodeDb } = await import('@src/repos/referrals/referralsRepo.js')
        // Normalize refCode to uppercase for consistent lookup
        link = await getReferralLinkByCodeDb(refCode.toUpperCase().trim())
      }
      
      if (link && link.tenant === tenant && link.isActive) {
        // Check if this is an agent referral
        // Handle case where agent was deleted (agentId would be NULL due to ON DELETE SET NULL)
        if (!link.agentId && !link.userId) {
          return // Skip processing orphaned links
        }
        
        if (link.agentId) {
          // This is an agent referral code
          const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
          const agentsRepo = new AgentsRepo()
          const agent = await agentsRepo.findById(link.agentId)
          
          if (agent && agent.status === 'ACTIVE' && 
              (agent.schemeType === 'SHARING' || agent.schemeType === 'COMMISSION') &&
              agent.tenantId === tenant) {
            
            // Check if user already has an agentId (don't override existing assignment)
            const { db } = await import('@/db/client.js')
            const { users } = await import('@shared/db/schema.js')
            const { eq, and } = await import('drizzle-orm')
            
            const existingUser = await db
              .select({ agentId: users.agentId, playerType: users.playerType })
              .from(users)
              .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
              .limit(1)
            
            if (existingUser[0]?.agentId && existingUser[0].agentId !== link.agentId) {
              return // Don't override existing assignment
            }
            
            // Only update if user doesn't already have the correct agentId
            if (existingUser[0]?.agentId !== link.agentId || 
                (existingUser[0]?.playerType !== 'SHARING_AGENT_PLAYER' && existingUser[0]?.playerType !== 'COMMISSION_AGENT_PLAYER')) {
              const playerType = agent.schemeType === 'SHARING' 
                ? 'SHARING_AGENT_PLAYER' 
                : 'COMMISSION_AGENT_PLAYER'
              
              await db
                .update(users)
                .set({
                  agentId: link.agentId,
                  playerType: playerType as any,
                })
                .where(
                  and(
                    eq(users.id, userId),
                    eq(users.tenant, tenant)
                  )
                )
              
              
              // Record audit trail
              const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js')
              recordAuditDb({
                tenant,
                actorId: link.agentId,
                domain: 'players',
                action: 'create_player_via_referral',
                resourceType: 'player',
                resourceId: String(userId),
                after: {
                  agentId: link.agentId,
                  playerType: playerType,
                  referralCode: refCode,
                },
              }).catch(() => {})
            }
            
            // Don't create traditional referral attribution for agent referrals
            return
          }
        }
        
        // Regular user referral attribution (reuse same link object)
        if (link.userId) {
          const { recordReferralClickDb } = await import('@src/repos/referrals/referralsRepo.js')
          await recordReferralClickDb(tenant, link.id, link.userId, {})
        }
      }

      // Attribute referral (code-only, permanent)
      const attribution = await attributionService.attributeReferee(tenant, userId, refCode)
      if (!attribution) {
        return // No referral found
      }

      // Confirm attribution
      const attr = await getReferralAttributionByRefereeDb(userId, tenant)
      if (attr) {
        await updateReferralAttributionStatusDb(attr.id, tenant, 'confirmed')
      }

      // Calculate signup rewards
      const calculation = await rewardsCalculatorService.calculateRewards({
        tenant,
        refereeId: userId,
        eventType: 'signup',
        eventData: {
          refereeId: userId,
        },
        currency,
      })

      if (calculation.earnings.length > 0) {
        // Create earnings records
        await rewardsCalculatorService.createEarnings(
          tenant,
          attr!.id,
          calculation.earnings,
          { refereeId: userId, eventType: 'signup' }
        )
        // Settle immediately (instant payout to referral balance / referral bonus wallet)
        const referrerIds = [...new Set(calculation.earnings.map((e) => e.referrerId))]
        for (const referrerId of referrerIds) {
          await settlementService.settleEarnings(tenant, referrerId)
        }
      }

      // Check for coupon/raffle rules
      const program = await getReferralProgramByTenantDb(tenant)
      if (program && (program.enabledModes || []).includes('COUPON')) {
        // Issue signup coupon if rule exists
        // This would need to find the coupon rule and issue
      }

      if (program && (program.enabledModes || []).includes('RAFFLE')) {
        // Add raffle entries if rule exists
        // This would need to find the raffle rule and add entries
      }
    } catch (error) {
      // Don't throw - referral should not block signup
    }
  }

  /**
   * Process signup referral rewards for a referee (internal API).
   * Used when user-backend has already created referral_attribution; this runs rewards + settlement only.
   */
  async processSignupForReferee(
    tenant: string,
    refereeId: number,
    currency: CurrencyCode = 'INR'
  ): Promise<void> {
    try {
      const attr = await getReferralAttributionByRefereeDb(refereeId, tenant)
      if (!attr || attr.status !== 'confirmed') {
        return
      }

      const calculation = await rewardsCalculatorService.calculateRewards({
        tenant,
        refereeId,
        eventType: 'signup',
        eventData: { refereeId },
        currency,
      })

      if (calculation.earnings.length > 0) {
        await rewardsCalculatorService.createEarnings(
          tenant,
          attr.id,
          calculation.earnings,
          { refereeId, eventType: 'signup' }
        )
        const referrerIds = [...new Set(calculation.earnings.map((e) => e.referrerId))]
        for (const referrerId of referrerIds) {
          await settlementService.settleEarnings(tenant, referrerId)
        }
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Handle deposit - trigger first deposit % and deposits window % rewards
   */
  async handleDeposit(
    tenant: string,
    userId: number,
    depositAmount: number,
    currency: CurrencyCode,
    isFirstDeposit: boolean = false
  ): Promise<void> {
    try {
      // Check if user has referral attribution
      const attribution = await getReferralAttributionByRefereeDb(userId, tenant)
      if (!attribution || attribution.status !== 'confirmed') {
        return // No referral
      }

      // Calculate deposit rewards
      const calculation = await rewardsCalculatorService.calculateRewards({
        tenant,
        refereeId: userId,
        eventType: 'deposit',
        eventData: {
          depositAmount,
          isFirstDeposit,
          refereeId: userId,
        },
        currency,
      })

      if (calculation.earnings.length > 0) {
        // Create earnings records
        await rewardsCalculatorService.createEarnings(
          tenant,
          attribution.id,
          calculation.earnings,
          { refereeId: userId, eventType: 'deposit', depositAmount, isFirstDeposit }
        )
        // Settle immediately (instant payout to referral balance / referral bonus wallet)
        const referrerIds = [...new Set(calculation.earnings.map((e) => e.referrerId))]
        for (const referrerId of referrerIds) {
          await settlementService.settleEarnings(tenant, referrerId)
        }
      }

      // Process referral deposit bonus for referrer
      try {
        const { findEligibleCampaigns, awardBonus } = await import('@shared/services/bonusService.js')
        const campaigns = await findEligibleCampaigns(tenant, 'referral_deposit')
        
        for (const campaign of campaigns) {
          const result = await awardBonus({
            userId: attribution.referrerId,
            tenant,
            campaignId: campaign.id,
            depositAmount: depositAmount, // Use referee's deposit amount
          })
          
          if (result.success) {
          }
        }
      } catch (bonusError: any) {
        // Don't throw - bonus should not block referral processing
      }
    } catch (error) {
      // Don't throw - referral should not block deposit
    }
  }

  /**
   * Handle bet settlement - trigger loss share (and other bet-based) rewards.
   * Optional betId stored in eventData for reversal on result rollback.
   */
  async handleBetSettlement(
    tenant: string,
    userId: number,
    netRevenue: number,
    currency: CurrencyCode,
    domain: 'sports' | 'casino' | 'matka',
    betId?: string
  ): Promise<void> {
    try {
      // Check if user has referral attribution
      const attribution = await getReferralAttributionByRefereeDb(userId, tenant)
      if (!attribution || attribution.status !== 'confirmed') {
        return // No referral
      }

      // After any bet settlement, check if referee crossed a turnover milestone (async, non-blocking)
      setImmediate(() => {
        this.checkTurnoverMilestone(tenant, userId, currency).catch(() => {})
      })

      // Loss share is on losses (negative netRevenue). Only calculate if player lost money.
      if (netRevenue >= 0) {
        return // Player won, no revenue/loss share
      }

      // Calculate loss share rewards
      const calculation = await rewardsCalculatorService.calculateRewards({
        tenant,
        refereeId: userId,
        eventType: 'bet_settlement',
        eventData: {
          netRevenue,
          domain,
          refereeId: userId,
        },
        currency,
      })

      if (calculation.earnings.length > 0) {
        await rewardsCalculatorService.createEarnings(
          tenant,
          attribution.id,
          calculation.earnings,
          { refereeId: userId, eventType: 'bet_settlement', netRevenue, domain, ...(betId && { betId }) }
        )
        // Settle immediately (instant payout to referral balance / referral bonus wallet)
        const referrerIds = [...new Set(calculation.earnings.map((e) => e.referrerId))]
        for (const referrerId of referrerIds) {
          await settlementService.settleEarnings(tenant, referrerId)
        }
      }
    } catch (error) {
      // Don't throw - referral should not block bet settlement
    }
  }

  /**
   * Check if referee crossed a TURNOVER_MILESTONE target and trigger handleMilestone once per rule.
   */
  private async checkTurnoverMilestone(
    tenant: string,
    userId: number,
    currency: CurrencyCode
  ): Promise<void> {
    const attribution = await getReferralAttributionByRefereeDb(userId, tenant)
    if (!attribution || attribution.status !== 'confirmed') return

    const program = await getReferralProgramByTenantDb(tenant)
    if (!program) return

    const allRules = await getReferralRulesByProgramDb(program.id, tenant)
    const enabledModes = (program.enabledModes || []) as string[]
    const turnoverRules = allRules.filter(
      (r) =>
        r.ruleType === 'TURNOVER_MILESTONE' &&
        r.isActive &&
        enabledModes.includes(r.ruleType)
    )
    if (turnoverRules.length === 0) return

    const totalTurnover = await getTotalTurnoverForUserDb(userId, tenant)
    const existingEarnings = await getReferralEarningsByRefereeDb(userId, tenant)

    for (const rule of turnoverRules) {
      const thresholds = (rule.thresholds || {}) as { turnoverTarget?: number }
      const target = thresholds.turnoverTarget ?? 0
      if (target <= 0 || totalTurnover < target) continue
      const alreadyPaid = existingEarnings.some(
        (e) => e.ruleType === 'TURNOVER_MILESTONE' && e.ruleId === rule.id
      )
      if (alreadyPaid) continue
      await this.handleMilestone(tenant, userId, 'turnover', { turnover: totalTurnover }, currency)
      break // Pay only one milestone per check; next bet may trigger next rule if any
    }
  }

  /**
   * Reverse referral earnings for a rolled-back bet settlement.
   * Creates negative earnings that offset originals (same referrer/rule); settlement sums both.
   */
  async handleBetSettlementReversal(
    tenant: string,
    userId: number,
    betId: string,
    domain: 'sports' | 'casino' | 'matka'
  ): Promise<void> {
    try {
      const { getReferralEarningsByBetIdDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
      const { createReferralEarningDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
      const earnings = await getReferralEarningsByBetIdDb(tenant, userId, betId)
      if (!earnings.length) return
      for (const e of earnings) {
        await createReferralEarningDb(tenant, {
          attributionId: e.attributionId,
          ruleId: e.ruleId,
          referrerId: e.referrerId,
          refereeId: e.refereeId,
          tier: e.tier,
          ruleType: e.ruleType,
          grossAmount: -Number(e.grossAmount),
          netAmount: -Number(e.netAmount),
          currency: e.currency,
          eventData: {
            eventType: 'bet_settlement_reversal',
            betId,
            domain,
            reversalOf: e.id,
          },
        })
      }
    } catch (error) {
      // Don't throw - reversal should not block rollback
    }
  }

  /**
   * Handle milestone achievement - trigger milestone rewards
   */
  async handleMilestone(
    tenant: string,
    userId: number,
    milestoneType: 'kyc_complete' | 'first_bet' | 'first_win' | 'turnover',
    milestoneData: {
      turnover?: number
      [key: string]: any
    },
    currency: CurrencyCode = 'INR'
  ): Promise<void> {
    try {
      // Check if user has referral attribution
      const attribution = await getReferralAttributionByRefereeDb(userId, tenant)
      if (!attribution || attribution.status !== 'confirmed') {
        return // No referral
      }

      // Calculate milestone rewards
      const calculation = await rewardsCalculatorService.calculateRewards({
        tenant,
        refereeId: userId,
        eventType: 'milestone',
        eventData: {
          milestoneType,
          ...milestoneData,
          refereeId: userId,
        },
        currency,
      })

      if (calculation.earnings.length > 0) {
        // Create earnings records
        await rewardsCalculatorService.createEarnings(
          tenant,
          attribution.id,
          calculation.earnings,
          { refereeId: userId, eventType: 'milestone', milestoneType, ...milestoneData }
        )
        // Settle immediately (instant payout to referral balance / referral bonus wallet)
        const referrerIds = [...new Set(calculation.earnings.map((e) => e.referrerId))]
        for (const referrerId of referrerIds) {
          await settlementService.settleEarnings(tenant, referrerId)
        }
      }
    } catch (error) {
      // Don't throw - referral should not block milestone
    }
  }
}

export const referralIntegrationService = new ReferralIntegrationService()

