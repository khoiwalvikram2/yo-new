import {
  getReferralProgramByTenantDb,
  getReferralRulesByProgramDb,
  getConfirmedReferrerOfDb,
  getReferralRuleByIdDb,
} from '@src/repos/referrals/referralsRepo.js'
import { createReferralEarningDb } from '@src/repos/referrals/referralEarningsRepo.js'
import { currencyService } from '@src/services/currencyService.js'
import { CurrencyCode } from '@src/types/currency.js'
import { withoutCreditBeneficiaries } from './creditBeneficiaries.js'

export type RuleType =
  | 'SIGNUP_CPA'
  | 'FIRST_DEPOSIT_PCT'
  | 'RELOAD_DEPOSITS_PCT'
  | 'REVSHARE'
  | 'LOSS_SHARE'
  | 'TURNOVER_MILESTONE'
  // Deprecated types (kept for migration compatibility)
  | 'DEPOSITS_WINDOW_PCT'
  | 'ACTIVITY_MILESTONE'
  | 'LADDER'
  | 'CASHBACK_SHARE'
  | 'COUPON'
  | 'RAFFLE'
  | 'HYBRID'

export interface RewardCalculationInput {
  tenant: string
  refereeId: number
  eventType: 'signup' | 'deposit' | 'bet_settlement' | 'milestone'
  eventData: {
    depositAmount?: number
    netRevenue?: number
    turnover?: number
    milestoneType?: string
    [key: string]: any
  }
  currency: CurrencyCode
}

export interface RewardCalculationResult {
  earnings: Array<{
    referrerId: number
    tier: number
    ruleId: number
    ruleType: RuleType
    grossAmount: number
    netAmount: number
    currency: string
  }>
}

/** Reads who referred `userId` in the tenant (its confirmed referrer), or null. Injectable for tests. */
export type ReferrerOfReader = (userId: number, tenant: string) => Promise<number | null>

/** Most tiers a tiered rule (LOSS_SHARE) pays: the direct referrer and three levels above it. */
const MAX_UPLINE_TIERS = 4

/**
 * The referral upline a tiered rule pays: the direct referrer at tier 1, whoever referred them at tier 2, and so on
 * up to maxDepth tiers (never more than 4). Each step reads the attribution in which the current referrer is the
 * REFEREE, in the same tenant (readReferrerOf). The walk stops at the top of the chain, at an id that is not a user,
 * and at anyone already on it: a cycle (A referred B, B referred A), or the referee itself, is never paid twice for
 * one event.
 *
 * It used to read the attributions in which the current person is the REFERRER (its own referees), so tiers 2-4
 * repeated the direct referrer, the real upline never earned, and the direct referrer was paid once per tier.
 */
export async function walkReferralUpline(
  tenant: string,
  directReferrerId: number,
  maxDepth: number,
  readReferrerOf: ReferrerOfReader = getConfirmedReferrerOfDb,
  refereeId?: number
): Promise<Array<{ referrerId: number; tier: number }>> {
  const upline: Array<{ referrerId: number; tier: number }> = []
  const depth = Math.min(Math.floor(Number(maxDepth) || 0), MAX_UPLINE_TIERS)
  const seen = new Set<number>()
  if (refereeId != null) seen.add(Number(refereeId))
  let current: number | null = Number(directReferrerId)
  while (upline.length < depth && current != null && Number.isSafeInteger(current) && current > 0 && !seen.has(current)) {
    seen.add(current)
    upline.push({ referrerId: current, tier: upline.length + 1 })
    if (upline.length >= depth) break
    const parent = await readReferrerOf(current, tenant)
    current = parent == null ? null : Number(parent)
  }
  return upline
}

/**
 * A rule's rate or fixed amount for `tier`. The admin referral editor saves these maps keyed by the tier number
 * ({"1": 10, "2": 5}: referralRulesModel.ts in the admin app); older rows may be keyed "tier1", "tier2". Both shapes
 * are read, the editor's first. A missing or non-numeric entry is 0.
 */
export function tierValue(map: unknown, tier: number): number {
  if (!map || typeof map !== 'object') return 0
  const entries = map as Record<string, unknown>
  const raw = entries[String(tier)] ?? entries[`tier${tier}`]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : 0
}

/**
 * Rewards Calculator Service - Calculates referral earnings based on rules and events
 */
export class RewardsCalculatorService {
  /**
   * Calculate rewards for an event
   */
  async calculateRewards(input: RewardCalculationInput): Promise<RewardCalculationResult> {
    const program = await getReferralProgramByTenantDb(input.tenant)
    if (!program) {
      return { earnings: [] }
    }

    // Get active rules for enabled modes (exclude REVSHARE - not supported)
    const allRules = await getReferralRulesByProgramDb(program.id, input.tenant)
    const enabledModes = (program.enabledModes || []) as string[]
    const activeRules = allRules.filter(
      r => r.isActive && r.ruleType !== 'REVSHARE' && enabledModes.includes(r.ruleType)
    )

    if (activeRules.length === 0) {
      return { earnings: [] }
    }

    // Get attribution for referee
    const { getReferralAttributionByRefereeDb } = await import('@src/repos/referrals/referralsRepo.js')
    const attribution = await getReferralAttributionByRefereeDb(input.refereeId, input.tenant)
    if (!attribution || attribution.status !== 'confirmed') {
      return { earnings: [] }
    }

    const earnings: RewardCalculationResult['earnings'] = []

    // Calculate earnings for each applicable rule
    for (const rule of activeRules) {
      const ruleEarnings = await this.calculateRuleReward(
        input,
        rule,
        attribution,
        program
      )
      earnings.push(...ruleEarnings)
    }

    // A credit player earns no referral cash or loss-share (credit D/W chips, decision 7): its chips move only through
    // its upline. Its earnings are dropped before the caps, so they use up no budget either.
    const payable = await withoutCreditBeneficiaries(input.tenant, earnings)

    // Apply caps and budgets
    const cappedEarnings = await this.applyCaps(input.tenant, input.refereeId, payable, program)

    return { earnings: cappedEarnings }
  }

  /**
   * Calculate reward for a specific rule
   */
  private async calculateRuleReward(
    input: RewardCalculationInput,
    rule: any,
    attribution: any,
    program: any
  ): Promise<RewardCalculationResult['earnings']> {
    const earnings: RewardCalculationResult['earnings'] = []

    // Check if rule applies to this event type
    if (!this.ruleAppliesToEvent(rule.ruleType, input.eventType)) {
      return earnings
    }

    // Tiers only apply to LOSS_SHARE (max 4 levels)
    const tieredRuleTypes = ['LOSS_SHARE']
    const isTiered = tieredRuleTypes.includes(rule.ruleType)
    const maxDepth = isTiered ? Math.min(program.maxDepth || 4, 4) : 1

    // Tiered rules pay the upline (the direct referrer and those above it); the others only the direct referrer
    // (tier 1), so they read no upline at all.
    const tiersToProcess = isTiered
      ? await this.getUpline(input.tenant, attribution.referrerId, maxDepth, input.refereeId)
      : [{ referrerId: attribution.referrerId, tier: 1 }]

    // Calculate for each tier in upline
    for (const tierMember of tiersToProcess) {
      const tierEarning = await this.calculateTierReward(
        input,
        rule,
        tierMember.referrerId,
        tierMember.tier,
        attribution,
        program
      )
      if (tierEarning) {
        earnings.push(tierEarning)
      }
    }

    return earnings
  }

  /**
   * Check if rule applies to event type
   */
  private ruleAppliesToEvent(ruleType: string, eventType: string): boolean {
    const mapping: Record<string, string[]> = {
      SIGNUP_CPA: ['signup'],
      FIRST_DEPOSIT_PCT: ['deposit'],
      RELOAD_DEPOSITS_PCT: ['deposit'],
      REVSHARE: ['bet_settlement'],
      LOSS_SHARE: ['bet_settlement'],
      TURNOVER_MILESTONE: ['milestone'],
      // Deprecated types
      DEPOSITS_WINDOW_PCT: ['deposit'],
      LADDER: ['signup', 'deposit', 'bet_settlement'],
      ACTIVITY_MILESTONE: ['milestone'],
      CASHBACK_SHARE: ['bet_settlement'],
      COUPON: ['signup', 'deposit', 'milestone'],
      RAFFLE: ['signup', 'deposit', 'milestone'],
      HYBRID: ['signup', 'deposit', 'bet_settlement', 'milestone'],
    }
    return mapping[ruleType]?.includes(eventType) ?? false
  }

  /**
   * Get upline (referrer and their upline up to maxDepth, max 4): walkReferralUpline on the database.
   */
  private async getUpline(
    tenant: string,
    referrerId: number,
    maxDepth: number,
    refereeId: number
  ): Promise<Array<{ referrerId: number; tier: number }>> {
    return walkReferralUpline(tenant, referrerId, maxDepth, getConfirmedReferrerOfDb, refereeId)
  }

  /**
   * Calculate reward for a specific tier
   */
  private async calculateTierReward(
    input: RewardCalculationInput,
    rule: any,
    referrerId: number,
    tier: number,
    attribution: any,
    program: any
  ): Promise<RewardCalculationResult['earnings'][0] | null> {
    // Keyed the way the admin editor saves them ({"1": 10, "2": 5}), or "tier1" on older rows (tierValue).
    const rate = tierValue(rule.tierRates, tier)
    const fixedAmount = tierValue(rule.fixedAmounts, tier)

    let grossAmount = 0

    switch (rule.ruleType) {
      case 'SIGNUP_CPA':
        // Signup CPA (direct only, tier 1)
        if (tier === 1) {
          grossAmount = fixedAmount || rate
        }
        break

      case 'FIRST_DEPOSIT_PCT':
        // Only applies to first deposit (direct only, tier 1). % stored in tierRates or fixedAmounts (admin saves in fixedAmounts).
        const firstDepositPct = rate || fixedAmount
        if (tier === 1 && input.eventData.depositAmount && firstDepositPct > 0 && input.eventData.isFirstDeposit) {
          grossAmount = (input.eventData.depositAmount * firstDepositPct) / 100
        }
        break

      case 'RELOAD_DEPOSITS_PCT': {
        // Only applies to reload deposits (direct only, tier 1). % stored in tierRates or fixedAmounts (admin saves in fixedAmounts).
        // Pay on each of the first N reload deposits only (e.g. 20% on first 10 reload deposits).
        // reloadDepositsCount = 0 means unlimited (no cap on number of deposits).
        // reloadMinDeposit > 0 means deposit must be >= that amount for bonus to process.
        const reloadPct = rate || fixedAmount
        if (tier === 1 && input.eventData.depositAmount && reloadPct > 0 && !input.eventData.isFirstDeposit) {
          // Check minimum deposit requirement
          const minDeposit = rule.reloadMinDeposit ?? 0
          if (minDeposit > 0 && input.eventData.depositAmount < minDeposit) {
            // Deposit amount is below minimum threshold, skip bonus
            break
          }

          const reloadCount = rule.reloadDepositsCount ?? 0
          // 0 = unlimited - always process bonus regardless of how many deposits already earned
          if (reloadCount === 0) {
            grossAmount = (input.eventData.depositAmount * reloadPct) / 100
          } else {
            const { getReferralEarningsByRefereeDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
            const existingEarnings = await getReferralEarningsByRefereeDb(input.refereeId, input.tenant)
            const existingReloadCount = existingEarnings.filter(e => e.ruleType === 'RELOAD_DEPOSITS_PCT').length
            if (existingReloadCount < reloadCount) {
              grossAmount = (input.eventData.depositAmount * reloadPct) / 100
            }
          }
        }
        break
      }

      case 'REVSHARE':
        // Revenue Share is not supported - no earnings
        grossAmount = 0
        break

      case 'LOSS_SHARE':
        // Loss share on net losses (tiered up to 4 levels)
        // Similar to REVSHARE but specifically for losses
        if (input.eventData.netRevenue && rate > 0) {
          // Only calculate on actual losses (negative net revenue)
          if (input.eventData.netRevenue < 0) {
            const netLoss = Math.abs(input.eventData.netRevenue)
            grossAmount = (netLoss * rate) / 100
          }
        }
        break

      case 'DEPOSITS_WINDOW_PCT': {
        // Deprecated - kept for migration compatibility. % in tierRates or fixedAmounts.
        const windowPct = rate || fixedAmount
        if (input.eventData.depositAmount && windowPct > 0) {
          grossAmount = (input.eventData.depositAmount * windowPct) / 100
        }
        break
      }

      case 'TURNOVER_MILESTONE': {
        // Turnover milestone (direct only, tier 1). % stored in tierRates or fixedAmounts (admin saves in fixedAmounts).
        // Only pay when milestoneType is 'turnover' and referee turnover >= rule's turnoverTarget; pay % of target amount.
        const turnoverPct = rate || fixedAmount
        const thresholds = (rule.thresholds || {}) as { turnoverTarget?: number }
        const turnoverTarget = thresholds.turnoverTarget ?? 0
        const isTurnoverMilestone = input.eventData.milestoneType === 'turnover'
        const turnoverAmount = input.eventData.turnover ?? 0
        if (
          tier === 1 &&
          isTurnoverMilestone &&
          turnoverTarget > 0 &&
          turnoverAmount >= turnoverTarget &&
          turnoverPct > 0
        ) {
          const baseAmount = Math.min(turnoverAmount, turnoverTarget)
          grossAmount = (baseAmount * turnoverPct) / 100
        }
        break
      }

      case 'ACTIVITY_MILESTONE':
        grossAmount = fixedAmount || rate
        break

      case 'LADDER':
        // Deprecated - LADDER rule type removed
        grossAmount = 0
        break

      case 'CASHBACK_SHARE':
        // Portion of referrer's commission goes to referee
        // Calculate referrer's commission first, then allocate portion to referee
        const cashbackShare = (rule.configJson as any)?.cashbackSharePercent || 0
        if (cashbackShare > 0 && input.eventType === 'bet_settlement') {
          // Get referrer's base commission for this event
          const baseCommission = await this.calculateBaseCommission(input, rule, attribution, program)
          grossAmount = (baseCommission * cashbackShare) / 100
        } else {
          grossAmount = 0
        }
        break

      case 'COUPON':
      case 'RAFFLE':
        // These don't generate direct earnings, handled separately
        grossAmount = 0
        break

      case 'HYBRID':
        // Combine multiple rule types
        grossAmount = fixedAmount || rate
        break

      default:
        return null
    }

    if (grossAmount <= 0) {
      return null
    }

    // Apply caps
    const caps = (rule.caps || {}) as {
      perReferee?: number
      perReferrer?: number
      daily?: number
      monthly?: number
    }

    // TODO: Apply per-referee, per-referrer, daily, monthly caps
    // This would require checking existing earnings

    const netAmount = grossAmount // Net = gross for now (no deductions)

    return {
      referrerId,
      tier,
      ruleId: rule.id,
      ruleType: rule.ruleType,
      grossAmount,
      netAmount,
      currency: input.currency,
    }
  }

  /**
   * Apply caps to earnings (per-referee, per-referrer, daily, monthly)
   */
  private async applyCaps(
    tenant: string,
    refereeId: number,
    earnings: RewardCalculationResult['earnings'],
    program: any
  ): Promise<RewardCalculationResult['earnings']> {
    const { budgetService } = await import('./budgetService.js')
    const { getReferralEarningsByRefereeDb, getReferralEarningsByReferrerDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
    
    const capped: RewardCalculationResult['earnings'] = []
    
    for (const earning of earnings) {
      const rule = await getReferralRuleByIdDb(earning.ruleId, tenant)
      if (!rule) continue
      
      const caps = (rule.caps || {}) as {
        perReferee?: number
        perReferrer?: number
        daily?: number
        monthly?: number
      }
      
      let finalAmount = earning.netAmount
      
      // Check per-referee cap
      if (caps.perReferee) {
        const { getReferralEarningsByRefereeDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
        const refereeEarnings = await getReferralEarningsByRefereeDb(
          refereeId,
          tenant
        )
        // Filter by ruleId if needed
        const ruleEarnings = refereeEarnings.filter(e => e.ruleId === earning.ruleId)
        const totalRefereeEarnings = ruleEarnings.reduce((sum, e) => sum + Number(e.netAmount), 0)
        if (totalRefereeEarnings + finalAmount > caps.perReferee) {
          finalAmount = Math.max(0, caps.perReferee - totalRefereeEarnings)
        }
      }
      
      // Check per-referrer cap
      if (caps.perReferrer) {
        const referrerEarnings = await getReferralEarningsByReferrerDb(
          earning.referrerId,
          tenant,
          { ruleType: earning.ruleType }
        )
        // Filter by ruleId if needed
        const ruleEarnings = referrerEarnings.filter(e => e.ruleId === earning.ruleId)
        const totalReferrerEarnings = ruleEarnings.reduce((sum, e) => sum + Number(e.netAmount), 0)
        if (totalReferrerEarnings + finalAmount > caps.perReferrer) {
          finalAmount = Math.max(0, caps.perReferrer - totalReferrerEarnings)
        }
      }
      
      // Check budget caps
      if (caps.daily || caps.monthly) {
        const budgetType = caps.daily ? 'daily' : 'monthly'
        const budgetCheck = await budgetService.checkBudget(
          tenant,
          program.id,
          finalAmount,
          earning.currency as any,
          budgetType
        )
        
        if (!budgetCheck.allowed) {
          finalAmount = Math.max(0, budgetCheck.remaining)
        }
        
        if (finalAmount > 0 && budgetCheck.budgetId) {
          await budgetService.incrementSpent(budgetCheck.budgetId, finalAmount)
        }
      }
      
      if (finalAmount > 0) {
        capped.push({
          ...earning,
          netAmount: finalAmount,
          grossAmount: Math.min(earning.grossAmount, finalAmount),
        })
      }
    }
    
    return capped
  }
  
  /**
   * Calculate base commission for cashback share
   */
  private async calculateBaseCommission(
    input: RewardCalculationInput,
    rule: any,
    attribution: any,
    program: any
  ): Promise<number> {
    // This is a simplified version - in reality, you'd calculate the referrer's commission
    // based on the event data (net revenue, etc.)
    if (input.eventType === 'bet_settlement' && input.eventData.netRevenue) {
      // It read only "tier1" keys, which the admin editor never saves ({"1": 10}); tierValue reads both shapes.
      const tier = attribution.tier || 1
      const rate = tierValue(rule.tierRates, tier) || tierValue(rule.tierRates, 1)
      return (Math.abs(input.eventData.netRevenue) * rate) / 100
    }
    return 0
  }

  /**
   * Create earnings records in database
   */
  async createEarnings(
    tenant: string,
    attributionId: number,
    earnings: RewardCalculationResult['earnings'],
    eventData: Record<string, any>
  ): Promise<void> {
    for (const earning of earnings) {
      await createReferralEarningDb(tenant, {
        attributionId,
        ruleId: earning.ruleId,
        referrerId: earning.referrerId,
        refereeId: eventData.refereeId,
        tier: earning.tier,
        ruleType: earning.ruleType,
        grossAmount: earning.grossAmount,
        netAmount: earning.netAmount,
        currency: earning.currency,
        eventData,
      })
    }
  }
}

export const rewardsCalculatorService = new RewardsCalculatorService()

