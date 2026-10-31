/**
 * TEST ONLY: Create a single pending losing bonus award for a particular user (fake amount).
 * Use this to test activate/claim flow without waiting for the weekly job.
 *
 * Usage (from admin-backend folder):
 *   npm run test:losing-bonus-award -- --userId <ID> --campaignId <ID>
 *   npx tsx scripts/createLosingBonusTestAward.ts --userId <ID> --campaignId <ID>
 * (PowerShell: do not use "&&"; run from admin-backend or use "cd admin-backend; npm run ...")
 */

import 'dotenv/config'
import {
  getBonusCampaignDb,
  createLosingBonusAward,
} from '../src/repos/marketing/bonusesRepo.js'

type Domain = 'sports' | 'casino' | 'matka' | 'global'

function parseArgs(): { userId: number; campaignId: number; tenant: string; testLossAmount: number } {
  const args = process.argv.slice(2)
  let userId: number | null = null
  let campaignId: number | null = null
  let tenant =
    typeof process.env.LOSING_BONUS_TENANT === 'string' && process.env.LOSING_BONUS_TENANT.trim() !== ''
      ? process.env.LOSING_BONUS_TENANT.trim()
      : 'default'
  let testLossAmount = 1000
  const positionals: string[] = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) {
      userId = parseInt(args[++i], 10)
    } else if (args[i] === '--campaignId' && args[i + 1]) {
      campaignId = parseInt(args[++i], 10)
    } else if (args[i] === '--tenant' && args[i + 1]) {
      tenant = args[++i]
    } else if (args[i] === '--loss' && args[i + 1]) {
      testLossAmount = parseFloat(args[++i])
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
TEST ONLY: Create one pending losing bonus award for a user (fake trigger amount).

Usage: npx tsx scripts/createLosingBonusTestAward.ts --userId <ID> --campaignId <ID> [options]
       npm run test:losing-bonus-award -- <userId> <campaignId> [tenant]   (positional, for Windows)

Required:
  --userId <id>        User ID to award
  --campaignId <id>   Losing bonus campaign ID

Options:
  --tenant <id>       Tenant (default: default or LOSING_BONUS_TENANT env)
  --loss <amount>      Fake net loss amount used to compute bonus (default: 1000)
  --help, -h          Show this help
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
    console.error('Missing or invalid --userId (or pass positional: <userId> <campaignId>)')
    process.exit(1)
  }
  if (campaignId == null || isNaN(campaignId)) {
    console.error('Missing or invalid --campaignId (or pass positional: <userId> <campaignId>)')
    process.exit(1)
  }
  if (testLossAmount <= 0 || !Number.isFinite(testLossAmount)) {
    console.error('--loss must be a positive number')
    process.exit(1)
  }

  return { userId, campaignId, tenant, testLossAmount }
}

async function main() {
  const { userId, campaignId, tenant, testLossAmount } = parseArgs()

  console.log('\n=== Create Losing Bonus Test Award (TEST ONLY) ===\n')
  console.log(`UserId: ${userId}`)
  console.log(`CampaignId: ${campaignId}`)
  console.log(`Tenant: ${tenant}`)
  console.log(`Test loss amount: ${testLossAmount}\n`)

  const campaign = await getBonusCampaignDb(campaignId, tenant)
  if (!campaign) {
    console.error(`Campaign not found for tenant "${tenant}".`)
    console.error('If your campaign is under another tenant (e.g. grandwinn-com), run with: --tenant grandwinn-com')
    process.exit(1)
  }
  if (campaign.type !== 'losing_bonus') {
    console.error('Campaign is not a Losing Bonus campaign.')
    process.exit(1)
  }

  const percentage = Number(campaign.percentage ?? 0)
  const wageringMultiplier = Number(campaign.wagering ?? 0)
  const currency = campaign.currency ?? 'INR'
  const domain = (campaign.domain ?? 'global') as Domain

  const bonusAmount = Math.round((testLossAmount * percentage) / 100 * 100) / 100
  const wageringReq = Math.round(bonusAmount * wageringMultiplier * 100) / 100
  const triggerAmount = Math.round(testLossAmount * 100) / 100

  if (bonusAmount <= 0) {
    console.error('Bonus amount would be 0 (check campaign percentage).')
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

  console.log('✅ Pending award created:')
  console.log(`   Award ID: ${row.id}`)
  console.log(`   Amount: ${bonusAmount} ${currency}`)
  console.log(`   Wagering: ${wageringReq}x`)
  console.log(`   Trigger (fake loss): ${triggerAmount}`)
  console.log('\nUser can now activate this bonus from the app.\n')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
