/**
 * Run the losing bonus weekly job once using REAL bet data.
 * Uses the same period as the Monday 00:00 IST cron: last Monday 00:00 IST to this Monday 00:00 IST.
 * Run this to test with real losses (e.g. when you already have data from last Monday to this Monday).
 *
 * Usage: npx tsx scripts/runLosingBonusOnce.ts
 *        npm run run:losing-bonus-once
 */

import 'dotenv/config'
import { DateTime } from 'luxon'
import { runLosingBonusWeekly } from '../src/services/losingBonusWeeklyService.js'
import { getMondayToMondayPeriod } from '../src/domains/agents/services/SettlementPeriodUtils.js'

const IST = 'Asia/Kolkata'

function getLastWeekPeriodIST(now: Date): { from: Date; to: Date } {
  const { from: thisMonday } = getMondayToMondayPeriod(now, IST)
  const lastWeekFrom = DateTime.fromJSDate(thisMonday, { zone: IST }).minus({ weeks: 1 }).toJSDate()
  return { from: lastWeekFrom, to: thisMonday }
}

async function main() {
  const now = new Date()
  const { from: periodFrom, to: periodTo } = getLastWeekPeriodIST(now)

  const fromStr = DateTime.fromJSDate(periodFrom, { zone: IST }).toFormat('yyyy-MM-dd HH:mm')
  const toStr = DateTime.fromJSDate(periodTo, { zone: IST }).toFormat('yyyy-MM-dd HH:mm')

  console.log('\n=== Losing Bonus Weekly Job (REAL bet data) ===\n')
  console.log('Bet period (IST):', fromStr, '→', toStr)
  console.log('(Last Monday 00:00 IST to this Monday 00:00 IST)\n')

  const results = await runLosingBonusWeekly()

  if (results.length === 0) {
    console.log('No active losing_bonus campaigns found, or none in date range.\n')
    return
  }

  for (const r of results) {
    if (r.error) {
      console.error(`Campaign ${r.campaignId} (${r.campaignName}): ${r.error}`)
    } else {
      console.log(`Campaign ${r.campaignId} (${r.campaignName}): created ${r.createdCount}, skipped ${r.skippedCount}`)
    }
  }
  console.log('')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
