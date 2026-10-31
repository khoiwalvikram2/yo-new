import {
  createReferralCouponDb,
  getReferralCouponByCodeDb,
  updateReferralCouponStatusDb,
} from '@src/repos/referrals/referralCouponsRepo.js'
import { getReferralRuleByIdDb } from '@src/repos/referrals/referralsRepo.js'
import { getBonusCampaignDb } from '@src/repos/marketing/bonusesRepo.js'
import { CurrencyCode } from '@src/types/currency.js'

/**
 * Coupon Service - Issues referral coupons/vouchers
 */
export class CouponService {
  /**
   * Issue a referral coupon
   */
  async issueCoupon(
    tenant: string,
    data: {
      ruleId: number
      referrerId?: number
      refereeId?: number
      amount: number
      currency: CurrencyCode
      bonusCampaignId?: number
      expiresAt?: Date
    }
  ): Promise<{ couponCode: string; couponId: number }> {
    const rule = await getReferralRuleByIdDb(data.ruleId, tenant)
    if (!rule) {
      throw new Error(`Rule ${data.ruleId} not found`)
    }

    if (data.bonusCampaignId != null) {
      const campaign = await getBonusCampaignDb(data.bonusCampaignId, tenant)
      if (!campaign) {
        throw new Error(`Bonus campaign ${data.bonusCampaignId} not found or does not belong to this tenant`)
      }
    }

    // Generate unique coupon code
    const couponCode = await this.generateCouponCode(tenant)

    const coupon = await createReferralCouponDb(tenant, {
      ruleId: data.ruleId,
      referrerId: data.referrerId,
      refereeId: data.refereeId,
      couponCode,
      bonusCampaignId: data.bonusCampaignId,
      amount: data.amount,
      currency: data.currency,
      expiresAt: data.expiresAt,
    })

    return {
      couponCode: coupon.couponCode,
      couponId: coupon.id,
    }
  }

  /**
   * Generate unique coupon code
   */
  private async generateCouponCode(tenant: string): Promise<string> {
    let attempts = 0
    const maxAttempts = 10

    while (attempts < maxAttempts) {
      // Generate code: REF + random string
      const random = Math.random().toString(36).substring(2, 10).toUpperCase()
      const code = `REF${random}`

      const existing = await getReferralCouponByCodeDb(code, tenant)
      if (!existing) {
        return code
      }

      attempts++
    }

    throw new Error('Failed to generate unique coupon code')
  }

  /**
   * Mark coupon as used
   */
  async markCouponUsed(
    tenant: string,
    couponCode: string
  ): Promise<boolean> {
    const coupon = await getReferralCouponByCodeDb(couponCode, tenant)
    if (!coupon || coupon.status !== 'active') {
      return false
    }

    await updateReferralCouponStatusDb(coupon.id, tenant, 'used', new Date())
    return true
  }

  /**
   * Expire old coupons
   */
  async expireOldCoupons(tenant: string): Promise<number> {
    // This would be called by a scheduled job
    // For now, return 0
    // TODO: Implement expiration logic
    return 0
  }
}

export const couponService = new CouponService()

