import { db } from '../db/client.js'
import { awardVipApprovedDeposit } from '@shared/vip/membership.js'
import { getUserVipStatus, getVipTiers, isVipEligible } from '../repos/vipRepo.js'

/**
 * Service for VIP-related business logic. Tier qualification follows the
 * current month's approved deposits; admin-backend's VIP sweep refreshes the
 * cached automatic tier when a month rolls over.
 */
export class VipService {
  /**
   * Award VIP points from an approved deposit
   * 1 currency unit = 1 VIP point (no conversion)
   */
  async awardPointsFromDeposit(
    userId: number,
    tenant: string,
    depositAmount: number,
    depositId: number
  ): Promise<void> {
    try {
      await awardVipApprovedDeposit(db, tenant, userId, depositId)
    } catch (error) {
      console.error('[vip] Deposit award failed; safe to retry by deposit ID:', depositId, error instanceof Error ? error.message : error)
    }
  }

  /**
   * Get user's VIP status with all details
   */
  async getUserVipStatus(userId: number, tenant: string) {
    return getUserVipStatus(userId, tenant)
  }

  async isVipEligible(userId: number, tenant: string) {
    return isVipEligible(userId, tenant)
  }

  /**
   * Get all VIP tiers for display
   */
  async getAllVipTiers(tenant: string) {
    return getVipTiers(tenant)
  }
}

export const vipService = new VipService()
