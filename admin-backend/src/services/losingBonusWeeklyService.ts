import { DateTime } from 'luxon'
import { db } from '@src/db/client.js'
import { bonusCampaigns } from '@shared/db/schema.js'
import { and, eq, gte, lte, or, isNull } from 'drizzle-orm'
import { getMondayToMondayPeriod } from '@src/domains/agents/services/SettlementPeriodUtils.js'
import { getUserLossesByDomain, type LosingBonusDomain } from '@src/repos/marketing/losingBonusRepo.js'
import {
  countAwardsByCampaignAndUser,
  countAwardsByCampaignAndUserSince,
  createLosingBonusAward,
} from '@src/repos/marketing/bonusesRepo.js'

const IST = 'Asia/Kolkata'

/**
 * Get the "last week" period (Monday 00:00 IST to this Monday 00:00 IST) for the given date.
 * When run at Monday 00:00 IST, returns the week that just ended.
 */
function getLastWeekPeriodIST(now: Date): { from: Date; to: Date } {
  const { from: thisMonday } = getMondayToMondayPeriod(now, IST)
  const lastWeekFrom = DateTime.fromJSDate(thisMonday, { zone: IST }).minus({ weeks: 1 }).toJSDate()
  return { from: lastWeekFrom, to: thisMonday }
}

/** Start of today in IST (for same-day idempotency). */
function getStartOfTodayIST(now: Date): Date {
  return DateTime.fromJSDate(now, { zone: IST }).startOf('day').toJSDate()
}

export interface LosingBonusRunResult {
  campaignId: number
  campaignName: string
  createdCount: number
  skippedCount: number
  error?: string
}

/**
 * Run the weekly losing bonus job: for each active losing_bonus campaign (tenant-scoped),
 * compute last week's user losses, apply per-week cap (top N by loss) and usagePerPlayer,
 * and create pending bonus awards. Idempotent per run (same day): skips if award already created today.
 */
export async function runLosingBonusWeekly(): Promise<LosingBonusRunResult[]> {
  const now = new Date()
  const { from: periodFrom, to: periodTo } = getLastWeekPeriodIST(now)
  const startOfTodayIST = getStartOfTodayIST(now)

  const campaigns = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.type, 'losing_bonus'),
        eq(bonusCampaigns.status, 'active'),
        or(isNull(bonusCampaigns.startDate), lte(bonusCampaigns.startDate, now)),
        or(isNull(bonusCampaigns.endDate), gte(bonusCampaigns.endDate, now))
      )
    )

  const results: LosingBonusRunResult[] = []

  for (const campaign of campaigns) {
    const tenant = campaign.tenant
    const whitelabelId = tenant
    const domain = (campaign.domain ?? 'global') as LosingBonusDomain
    const percentage = Number(campaign.percentage ?? 0)
    const wageringMultiplier = Number(campaign.wagering ?? 0)
    const currency = campaign.currency ?? 'INR'
    const numberOfPlayers = campaign.numberOfPlayers ?? 0
    const usagePerPlayer = campaign.usagePerPlayer ?? 1

    try {
      const lossRows = await getUserLossesByDomain(
        tenant,
        whitelabelId,
        periodFrom,
        periodTo,
        domain
      )

      const toCreate: { userId: number; lossAmount: number }[] = []
      for (const row of lossRows) {
        if (numberOfPlayers > 0 && toCreate.length >= numberOfPlayers) break

        const existingCount = await countAwardsByCampaignAndUser(campaign.id, row.userId)
        if (existingCount >= usagePerPlayer) continue

        const alreadyAwardedToday = await countAwardsByCampaignAndUserSince(
          campaign.id,
          row.userId,
          startOfTodayIST
        )
        if (alreadyAwardedToday > 0) continue

        toCreate.push({ userId: row.userId, lossAmount: row.lossAmount })
      }

      let createdCount = 0
      for (const { userId, lossAmount } of toCreate) {
        const bonusAmount = Math.round((lossAmount * percentage) / 100 * 100) / 100
        if (bonusAmount <= 0) continue

        const wageringReq = Math.round(bonusAmount * wageringMultiplier * 100) / 100

        await createLosingBonusAward({
          campaignId: campaign.id,
          userId,
          domain,
          currency,
          amount: bonusAmount,
          wageringReq,
          triggerAmount: Math.round(lossAmount * 100) / 100,
        })
        createdCount++
      }

      results.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        createdCount,
        skippedCount: Math.max(0, lossRows.length - toCreate.length),
      })
    } catch (err) {
      results.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        createdCount: 0,
        skippedCount: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
