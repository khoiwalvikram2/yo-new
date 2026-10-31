import {
  getUnsettledReferralEarningsDb,
  createReferralSettlementIfAbsent,
  updateReferralSettlementStatusDb,
  getPendingReferralSettlementsDb,
} from '@src/repos/referrals/referralEarningsRepo.js'
import { getReferralRuleByIdDb } from '@src/repos/referrals/referralsRepo.js'
import {
  adjustWalletReferralBalanceDb,
  adjustWalletReferralBonusDb,
} from '@src/repos/players/walletsRepo.js'
import { CurrencyCode } from '@src/types/currency.js'

/**
 * Settlement Service - Handles payout of referral earnings
 */
export class SettlementService {
  /**
   * Settle earnings for a referrer (real-time or scheduled)
   */
  async settleEarnings(
    tenant: string,
    referrerId: number,
    ruleType?: string
  ): Promise<{ settled: number; failed: number }> {
    const unsettled = await getUnsettledReferralEarningsDb(tenant, referrerId, ruleType)
    let settled = 0
    let failed = 0

    for (const earning of unsettled) {
      try {
        await this.settleSingleEarning(tenant, earning)
        settled++
      } catch (error) {
        failed++
      }
    }

    return { settled, failed }
  }

  /**
   * Settle a single earning
   */
  private async settleSingleEarning(tenant: string, earning: any): Promise<void> {
    const rule = await getReferralRuleByIdDb(earning.ruleId, tenant)
    if (!rule) {
      throw new Error(`Rule ${earning.ruleId} not found`)
    }

    const payoutType = rule.payoutType || 'CASH'
    const escrow = (rule.escrow || { untilKyc: false, untilFraudClear: false }) as {
      untilKyc: boolean
      untilFraudClear: boolean
    }

    // Calculate amounts
    const netAmount = Number(earning.netAmount)
    let cashAmount = 0
    let bonusAmount = 0

    if (payoutType === 'CASH') {
      cashAmount = netAmount
    } else if (payoutType === 'BONUS') {
      bonusAmount = netAmount
    } else if (payoutType === 'SPLIT') {
      // Fixed 50-50: 50% referral balance (cash), 50% referral bonus
      cashAmount = Math.round((netAmount * 0.5) * 100) / 100
      bonusAmount = Math.round((netAmount - cashAmount) * 100) / 100
    }

    // Determine escrow status
    let escrowStatus: 'none' | 'pending_kyc' | 'pending_fraud_check' | 'released' | 'held' = 'none'
    if (escrow.untilKyc) {
      escrowStatus = 'pending_kyc'
    } else if (escrow.untilFraudClear) {
      escrowStatus = 'pending_fraud_check'
    }

    // Create settlement record, or discover that a concurrent caller already
    // did. `getUnsettledReferralEarningsDb` filters in JavaScript, so two
    // callers see the same earning as unsettled; only the one that wins the
    // row lock gets a settlement back, and only that one credits.
    const settlement = await createReferralSettlementIfAbsent(tenant, {
      earningId: earning.id,
      referrerId: earning.referrerId,
      payoutType: payoutType as 'CASH' | 'BONUS' | 'SPLIT',
      cashAmount,
      bonusAmount,
      currency: earning.currency as CurrencyCode,
      escrowStatus,
    })

    if (!settlement) return // another caller already settled this earning

    // If no escrow, settle immediately
    if (escrowStatus === 'none') {
      await this.executeSettlement(tenant, settlement, earning.currency as CurrencyCode)
    }
  }

  /**
   * Execute settlement (credit wallet/bonus).
   * Referral bonus is casino-only: full amount is credited to referralBonus so it can only be used in casino, not in sports/matka.
   */
  private async executeSettlement(
    tenant: string,
    settlement: any,
    currency: CurrencyCode
  ): Promise<void> {
    try {
      let walletTransactionId: number | undefined
      let bonusAwardId: number | undefined

      const cashAmount = Number(settlement.cashAmount)
      const bonusAmount = Number(settlement.bonusAmount)
      const meta = {
        type: 'referral_earning',
        settlementId: settlement.id,
        earningId: settlement.earningId,
      }

      // CASH → referral balance (user can then transfer to cash). BONUS → referral bonus (casino-only).
      if (cashAmount > 0) {
        await adjustWalletReferralBalanceDb(settlement.referrerId, cashAmount, meta, tenant)
      }
      if (bonusAmount > 0) {
        await adjustWalletReferralBonusDb(settlement.referrerId, bonusAmount, meta, tenant)
      }

      // Update settlement status
      await updateReferralSettlementStatusDb(settlement.id, tenant, {
        status: 'completed',
        walletTransactionId,
        bonusAwardId,
        settledAt: new Date(),
      })
    } catch (error) {
      // Mark as failed
      await updateReferralSettlementStatusDb(settlement.id, tenant, {
        status: 'failed',
      })
      throw error
    }
  }

  /**
   * Release escrow (after KYC/fraud check passes)
   */
  async releaseEscrow(
    tenant: string,
    settlementId: number
  ): Promise<boolean> {
    const { getReferralSettlementByIdDb } = await import('@src/repos/referrals/referralEarningsRepo.js')
    const target = await getReferralSettlementByIdDb(settlementId, tenant)
    if (!target) {
      return false
    }

    if (target.escrowStatus === 'pending_kyc' || target.escrowStatus === 'pending_fraud_check') {
      // Check if conditions are met
      const canRelease = await this.checkEscrowReleaseConditions(tenant, target)
      
      if (canRelease) {
        await updateReferralSettlementStatusDb(settlementId, tenant, {
          escrowStatus: 'released',
        })

        await this.executeSettlement(tenant, target, target.currency as CurrencyCode)
        return true
      }
    }

    return false
  }
  
  /**
   * Check if escrow can be released (KYC/fraud checks)
   */
  private async checkEscrowReleaseConditions(
    tenant: string,
    settlement: any
  ): Promise<boolean> {
    const { getUserDb } = await import('@src/repos/users/usersRepo.js')
    const user = await getUserDb(settlement.referrerId, tenant)
    
    if (!user) {
      return false
    }
    
    // Check KYC requirement
    if (settlement.escrowStatus === 'pending_kyc') {
      // For now, check if user is active and not suspended
      // In production, you'd check actual KYC status from a KYC service
      if (user.status !== 'active') {
        return false
      }
      
      // Check withdrawal lock (indicates potential fraud/risk)
      if ((user as any).withdrawalLock) {
        return false
      }
    }
    
    // Check fraud requirement
    if (settlement.escrowStatus === 'pending_fraud_check') {
      // Check if user is active and not suspended
      if (user.status !== 'active') {
        return false
      }
      
      // Check withdrawal lock (indicates potential fraud)
      if ((user as any).withdrawalLock) {
        return false
      }
      
      // Check risk type
      if (user.riskType === 'high') {
        return false
      }
    }
    
    return true
  }

  /**
   * Process scheduled settlements (for loss share, etc.)
   */
  async processScheduledSettlements(
    tenant: string,
    date: Date
  ): Promise<{ settled: number; failed: number }> {
    // Get all pending settlements that should be processed
    const pending = await getPendingReferralSettlementsDb(tenant)
    let settled = 0
    let failed = 0

    for (const settlement of pending) {
      try {
        // Check if escrow should be released
        if (settlement.escrowStatus !== 'none' && settlement.escrowStatus !== 'released') {
          const canRelease = await this.checkEscrowReleaseConditions(tenant, settlement)
          if (!canRelease) {
            continue
          }
          // Release escrow
          await updateReferralSettlementStatusDb(settlement.id, tenant, {
            escrowStatus: 'released',
          })
        }

        await this.executeSettlement(tenant, settlement, settlement.currency as CurrencyCode)
        settled++
      } catch (error) {
        failed++
      }
    }

    return { settled, failed }
  }
}

export const settlementService = new SettlementService()

