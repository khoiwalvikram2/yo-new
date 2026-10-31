import { and, desc, eq, inArray } from 'drizzle-orm'
import { bonusAwards, bonusCampaigns } from '../db/schema.js'
import type { SharedDb } from '../db/registry.js'
import { releaseRollOverBonusToCash } from '../services/bonusService.js'
import { moneyDecimal, moneyMinor } from './rules.js'

export async function activeMatkaBonus(tx: SharedDb, tenant: string, userId: number, marketId: string) {
  const candidates = await tx.select({ award: bonusAwards, campaign: bonusCampaigns }).from(bonusAwards)
    .innerJoin(bonusCampaigns, and(eq(bonusCampaigns.id, bonusAwards.campaignId), eq(bonusCampaigns.tenant, tenant)))
    .where(and(eq(bonusAwards.userId, userId), eq(bonusAwards.status, 'active'), inArray(bonusAwards.domain, ['matka', 'global']))).orderBy(desc(bonusAwards.awardedAt)).for('update')
  for (const candidate of candidates) {
    const { award, campaign } = candidate, rules = campaign.rulesJson || {}
    const now = new Date()
    if (campaign.status !== 'active' || campaign.validFrom && campaign.validFrom > now || campaign.validTo && campaign.validTo < now || campaign.startDate && campaign.startDate > now || campaign.endDate && campaign.endDate < now) continue
    if (award.firstDepositRequired && !award.firstDepositUnlocked) continue
    if (Array.isArray(rules.matkaGameIds) && rules.matkaGameIds.length && !rules.matkaGameIds.includes(marketId)) continue
    return candidate
  }
  throw new Error('No active bonus is available for this Matka market')
}

/** Pin wagering to the award which funded the bet; never advance every active
 * award. A completed/released award blocks financial rollback rather than
 * silently recreating spent/released bonus money. */
export async function updateMatkaBonusWagering(tx: SharedDb, args: { tenant: string; userId: number; awardId: number; stake: bigint; reverse?: boolean }) {
  const [row] = await tx.select({ award: bonusAwards, campaign: bonusCampaigns }).from(bonusAwards)
    .innerJoin(bonusCampaigns, and(eq(bonusCampaigns.id, bonusAwards.campaignId), eq(bonusCampaigns.tenant, args.tenant)))
    .where(and(eq(bonusAwards.id, args.awardId), eq(bonusAwards.userId, args.userId))).for('update').limit(1)
  if (!row) throw new Error('The bonus award for this bet no longer exists')
  const { award, campaign } = row
  if (args.reverse && (award.completedAt || award.status === 'completed')) throw new Error('Bonus funds were released after this result. Reverse the bonus release before rolling back this result.')
  const before = moneyMinor(award.currentWagering || '0'), after = before + (args.reverse ? -args.stake : args.stake)
  if (after < 0n) throw new Error('Bonus wagering does not reconcile with this bet')
  const requirement = moneyMinor(award.wageringReq || '0'), completed = !args.reverse && requirement > 0n && after >= requirement
  await tx.update(bonusAwards).set({ currentWagering: moneyDecimal(after), status: completed ? 'completed' : award.status }).where(eq(bonusAwards.id, award.id))
  if (completed && (award.distributionType || campaign.distributionType) === 'roll_over') await releaseRollOverBonusToCash(args.userId, args.tenant, award.id, tx)
}
