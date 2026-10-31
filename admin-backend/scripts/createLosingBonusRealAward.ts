/**
 * Create a single pending losing bonus award for a PARTICULAR user + campaign using REAL bet data.
 * Uses last Monday 00:00 IST to this Monday 00:00 IST. User must have net loss in that period.
 *
 * Usage: npx tsx scripts/createLosingBonusRealAward.ts --userId <ID> --campaignId <ID> [--tenant <id>]
 *        npm run run:losing-bonus-real -- <userId> <campaignId> [tenant]
 */

import 'dotenv/config'
import { DateTime } from 'luxon'
import { getBonusCampaignDb, createLosingBonusAward } from '../src/repos/marketing/bonusesRepo.js'
import { getUserLossesByDomain, type LosingBonusDomain } from '../src/repos/marketing/losingBonusRepo.js'
import { getMondayToMondayPeriod } from '../src/domains/agents/services/SettlementPeriodUtils.js'

const IST = 'Asia/Kolkata'

function getLastWeekPeriodIST(now: Date): { from: Date; to: Date } {
  const { from: thisMonday } = getMondayToMondayPeriod(now, IST)
  const lastWeekFrom = DateTime.fromJSDate(thisMonday, { zone: IST }).minus({ weeks: 1 }).toJSDate()
  return { from: lastWeekFrom, to: thisMonday }
}

function parseArgs(): { userId: number; campaignId: number; tenant: string } {
  const args = process.argv.slice(2)
  let userId: number | null = null
  let campaignId: number | null = null
  let tenant =
    typeof process.env.LOSING_BONUS_TENANT === 'string' && process.env.LOSING_BONUS_TENANT.trim() !== ''
      ? process.env.LOSING_BONUS_TENANT.trim()
      : 'default'
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) {
      userId = parseInt(args[++i], 10)
    } else if (args[i] === '--campaignId' && args[i + 1]) {
      campaignId = parseInt(args[++i], 10)
    } else if (args[i] === '--tenant' && args[i + 1]) {
      tenant = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Create one pending losing bonus award for a user using REAL bet loss (last Mon–this Mon IST).

Usage: npx tsx scripts/createLosingBonusRealAward.ts --userId <ID> --campaignId <ID> [options]
       npm run run:losing-bonus-real -- <userId> <campaignId> [tenant]

Required:
  --userId <id>        User ID (must have net loss in period)
  --campaignId <id>    Losing bonus campaign ID

Options:
  --tenant <id>        Tenant (default: default or LOSING_BONUS_TENANT env)
  --help, -h           Show this help
`)
      process.exit(0)
    } else if (!args[i].startsWith('-') && args[i] !== '') {
      positionals.push(args[i])
    }
  }

  if (userId == null && positionals.length >= 1) userId = parseInt(positionals[0], 10)
  if (campaignId == null && positionals.length >= 2) campaignId = parseInt(positionals[1], 10)
  if (positionals.length >= 3) tenant = positionals[2]

  if (userId == null || isNaN(userId)) {
    console.error('Missing or invalid --userId (or pass positional: <userId> <campaignId> [tenant])')
    process.exit(1)
  }
  if (campaignId == null || isNaN(campaignId)) {
    console.error('Missing or invalid --campaignId')
    process.exit(1)
  }

  return { userId, campaignId, tenant }
}

async function main() {
  const { userId, campaignId, tenant } = parseArgs()

  const now = new Date()
  const { from: periodFrom, to: periodTo } = getLastWeekPeriodIST(now)
  const fromStr = DateTime.fromJSDate(periodFrom, { zone: IST }).toFormat('yyyy-MM-dd HH:mm')
  const toStr = DateTime.fromJSDate(periodTo, { zone: IST }).toFormat('yyyy-MM-dd HH:mm')

  console.log('\n=== Losing Bonus Award (REAL bet data) ===\n')
  console.log(`UserId: ${userId}`)
  console.log(`CampaignId: ${campaignId}`)
  console.log(`Tenant: ${tenant}`)
  console.log(`Bet period (IST): ${fromStr} → ${toStr}\n`)

  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) {
    console.error(`Campaign not found for tenant "${tenant}".`)
    process.exit(1)
  }
  if (campaign.type !== 'losing_bonus') {
    console.error('Campaign is not a Losing Bonus campaign.')
    process.exit(1)
  }

  const domain = (campaign.domain ?? 'global') as LosingBonusDomain
  const lossRows = await getUserLossesByDomain(tenant, tenant, periodFrom, periodTo, domain)
  const userRow = lossRows.find((r) => r.userId === userId)

  if (!userRow) {
    console.error(`User ${userId} has no net loss in this period for tenant/domain, or no settled bets.`)
    console.error(`Eligible users in period: ${lossRows.length}. Run without userId to see weekly job.`)
    process.exit(1)
  }

  const lossAmount = userRow.lossAmount
  const percentage = Number(campaign.percentage ?? 0)
  const wageringMultiplier = Number(campaign.wagering ?? 0)
  const currency = campaign.currency ?? 'INR'

  const bonusAmount = Math.round((lossAmount * percentage) / 100 * 100) / 100
  const wageringReq = Math.round(bonusAmount * wageringMultiplier * 100) / 100
  const triggerAmount = Math.round(lossAmount * 100) / 100

  if (bonusAmount <= 0) {
    console.error('Bonus amount would be 0.')
    process.exit(1)
  }

  const row = await createLosingBonusAward({
    campaignId,
    userId,
    domain,
    currency,
    amount: bonusAmount,
    wageringReq,
    triggerAmount,
  })

  console.log('✅ Pending award created (real loss):')
  console.log(`   Award ID: ${row.id}`)
  console.log(`   User net loss: ${triggerAmount} ${currency}`)
  console.log(`   Bonus (${percentage}%): ${bonusAmount} ${currency}`)
  console.log(`   Wagering: ${wageringReq}x`)
  console.log('\nUser can now activate this bonus from the app.\n')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
