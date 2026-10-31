import {
  createReferralRaffleEntryDb,
  getReferralRaffleEntriesByRuleDb,
  getTotalRaffleEntriesByRuleDb,
  createReferralRaffleDrawDb,
  getScheduledReferralRaffleDrawsDb,
  updateReferralRaffleDrawDb,
} from '@src/repos/referrals/referralRaffleRepo.js'
import { getReferralRuleByIdDb } from '@src/repos/referrals/referralsRepo.js'
import { CurrencyCode } from '@src/types/currency.js'

/**
 * Raffle Service - Manages referral raffle entries and draws
 */
export class RaffleService {
  /**
   * Add raffle entries for a user
   */
  async addRaffleEntries(
    tenant: string,
    data: {
      ruleId: number
      referrerId?: number
      refereeId?: number
      entries: number
      reason?: string
    }
  ): Promise<void> {
    await createReferralRaffleEntryDb(tenant, data)
  }

  /**
   * Create a raffle draw
   */
  async createRaffleDraw(
    tenant: string,
    ruleId: number,
    scheduledAt: Date
  ): Promise<{ drawId: number }> {
    const draw = await createReferralRaffleDrawDb(tenant, {
      ruleId,
      scheduledAt,
    })
    return { drawId: draw.id }
  }

  /**
   * Run a raffle draw (pick winners)
   */
  async runRaffleDraw(
    tenant: string,
    drawId: number,
    numberOfWinners: number
  ): Promise<Array<{ userId: number; prize: number; currency: string }>> {
    // Get draw
    const { getReferralRaffleDrawByIdDb } = await import('@src/repos/referrals/referralRaffleRepo.js')
    const draw = await getReferralRaffleDrawByIdDb(drawId, tenant)
    if (!draw) {
      throw new Error(`Draw ${drawId} not found`)
    }

    if (draw.status !== 'scheduled' && draw.status !== 'running') {
      throw new Error(`Draw ${drawId} is not in a runnable state`)
    }

    // Mark as running
    await updateReferralRaffleDrawDb(drawId, tenant, {
      status: 'running',
    })

    // Get all entries for this rule
    const entries = await getReferralRaffleEntriesByRuleDb(draw.ruleId, tenant)

    // Build weighted entry list (entries can have multiple entries per user)
    const userEntries: Array<{ userId: number; entries: number }> = []
    const entryMap = new Map<number, number>()

    entries.forEach(entry => {
      const userId = entry.referrerId || entry.refereeId
      if (userId) {
        entryMap.set(userId, (entryMap.get(userId) || 0) + entry.entries)
      }
    })

    entryMap.forEach((count, userId) => {
      userEntries.push({ userId, entries: count })
    })

    // Pick winners (weighted random selection)
    const winners = this.pickWinners(userEntries, numberOfWinners)

    // Get rule to determine prize
    const rule = await getReferralRuleByIdDb(draw.ruleId, tenant)
    const configJson = (rule?.configJson || {}) as Record<string, any>
    const prizeAmount = configJson.prizeAmount || 0
    const currency = configJson.currency || 'INR'

    const winnerData = winners.map(userId => ({
      userId,
      prize: prizeAmount,
      currency,
    }))

    // Update draw with winners
    await updateReferralRaffleDrawDb(drawId, tenant, {
      status: 'completed',
      winners: winnerData as any,
      drawnAt: new Date(),
    })

    return winnerData
  }

  /**
   * Pick winners using weighted random selection
   */
  private pickWinners(
    userEntries: Array<{ userId: number; entries: number }>,
    numberOfWinners: number
  ): number[] {
    if (userEntries.length === 0) {
      return []
    }

    const winners: number[] = []
    const remaining = [...userEntries]

    for (let i = 0; i < numberOfWinners && remaining.length > 0; i++) {
      // Calculate total entries
      const totalEntries = remaining.reduce((sum, u) => sum + u.entries, 0)

      // Pick random number
      let random = Math.random() * totalEntries

      // Find winner
      let winnerIndex = 0
      for (let j = 0; j < remaining.length; j++) {
        random -= remaining[j].entries
        if (random <= 0) {
          winnerIndex = j
          break
        }
      }

      const winner = remaining[winnerIndex]
      winners.push(winner.userId)

      // Remove winner from pool (no duplicate winners)
      remaining.splice(winnerIndex, 1)
    }

    return winners
  }

  /**
   * Process scheduled draws
   */
  async processScheduledDraws(tenant: string): Promise<number> {
    const now = new Date()
    const scheduled = await getScheduledReferralRaffleDrawsDb(tenant, now)

    let processed = 0
    for (const draw of scheduled) {
      try {
        const rule = await getReferralRuleByIdDb(draw.ruleId, tenant)
        const configJson = (rule?.configJson || {}) as Record<string, any>
        const numberOfWinners = configJson.numberOfWinners || 1

        await this.runRaffleDraw(tenant, draw.id, numberOfWinners)
        processed++
      } catch (error) {
      }
    }

    return processed
  }
}

export const raffleService = new RaffleService()

