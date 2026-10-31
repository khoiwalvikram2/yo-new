import { db } from '@src/db/client.js'
import { awardVipApprovedDeposit } from '@shared/vip/membership.js'

export class VipIntegrationService {
  async awardPointsFromDeposit(userId: number, tenant: string, _amount: number, depositId: number): Promise<void> {
    try {
      await awardVipApprovedDeposit(db, tenant, userId, depositId)
    } catch (error) {
      console.error('[vip] Deposit award failed; safe to retry by deposit ID:', depositId, error instanceof Error ? error.message : error)
    }
  }
}
export const vipIntegrationService = new VipIntegrationService()
