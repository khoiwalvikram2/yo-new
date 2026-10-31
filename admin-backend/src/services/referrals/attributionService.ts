import {
  getReferralClicksByRefereeDb,
  createReferralAttributionDb,
  getReferralAttributionByRefereeDb,
  updateReferralAttributionStatusDb,
  getReferralLinkByCodeDb,
} from '@src/repos/referrals/referralsRepo.js'
import { getReferralProgramByTenantDb } from '@src/repos/referrals/referralsRepo.js'

export interface AttributionResult {
  referrerId: number
  clickId: number | null
  tier: number
  confidence: number
  agentId?: string | null // NEW: Optional agent ID for agent referrals
}

/**
 * Attribution Service - Code-only permanent attribution on signup
 * Simplified: Uses referral code provided at signup, permanent assignment
 */
export class AttributionService {
  /**
   * Determine attribution for a referee based on referral code (code-only, permanent)
   */
  async attributeReferee(
    tenant: string,
    refereeId: number,
    refCode?: string
  ): Promise<AttributionResult | null> {
    const program = await getReferralProgramByTenantDb(tenant)
    if (!program) {
      return null
    }

    // Check if already attributed (permanent - no re-attribution)
    const existing = await getReferralAttributionByRefereeDb(refereeId, tenant)
    if (existing && existing.status === 'confirmed') {
      return {
        referrerId: existing.referrerId,
        clickId: existing.clickId ?? null,
        tier: existing.tier,
        confidence: 1.0,
      }
    }

    // Code-only attribution: use the referral code provided at signup
    let referrerId: number | null = null
    let clickId: number | null = null
    let agentId: string | null = null // NEW: Track if this is an agent referral

    if (refCode) {
      // Find referrer by code (normalize to uppercase for consistent lookup)
      const link = await getReferralLinkByCodeDb(refCode.toUpperCase().trim())
      if (!link || link.tenant !== tenant || !link.isActive) {
        return null // Invalid or inactive code
      }

      // NEW: Check if this is an agent referral
      if (link.agentId) {
        agentId = link.agentId
        
        // Validate agent is still active
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
        const agentsRepo = new AgentsRepo()
        if (!agentId) return null
        const agent = await agentsRepo.findById(agentId)
        
        if (!agent || agent.status !== 'ACTIVE') {
          return null
        }

        // For agent referrals, we don't create traditional referral attribution
        // Instead, we return a special result that will be handled in user creation
        return {
          referrerId: 0, // Special marker for agent referral
          clickId: null,
          tier: 1,
          confidence: 1.0,
          agentId: agentId, // Include agentId in result
        }
      }

      // Regular user referral (existing logic)
      if (link.userId) {
        referrerId = link.userId
        // Record click if not already recorded
        const { recordReferralClickDb } = await import('@src/repos/referrals/referralsRepo.js')
        const click = await recordReferralClickDb(tenant, link.id, link.userId, {})
        clickId = click.id
      }
    } else {
      // Fallback: use most recent click (for backward compatibility during migration)
      const clicks = await getReferralClicksByRefereeDb(refereeId, tenant, 365) // Large window for migration
      if (clicks.length > 0) {
        const lastClick = clicks[0] // Most recent
        referrerId = lastClick.referrerId
        clickId = lastClick.id
      }
    }

    if (!referrerId && !agentId) {
      return null
    }

    // Only create attribution for user referrals (not agent referrals)
    if (referrerId && !agentId) {
      await createReferralAttributionDb(tenant, {
        referrerId,
        refereeId,
        tier: 1, // Direct referral
        clickId: clickId ?? undefined,
        status: 'pending', // Will be confirmed after verification
      })
    }

    return {
      referrerId: referrerId || 0,
      clickId,
      tier: 1,
      confidence: 1.0,
      agentId: agentId || null, // Include agentId if present
    }
  }

  /**
   * Confirm attribution (e.g., after KYC verification)
   */
  async confirmAttribution(
    tenant: string,
    attributionId: number
  ): Promise<boolean> {
    const updated = await updateReferralAttributionStatusDb(
      attributionId,
      tenant,
      'confirmed'
    )
    return updated !== null
  }

  // Re-attribution removed - attribution is permanent (code-only)
}

export const attributionService = new AttributionService()

