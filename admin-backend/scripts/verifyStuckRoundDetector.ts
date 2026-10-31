/**
 * Verify the casino stuck-round detector against live data, WITHOUT writing notifications.
 *
 * Calls the read-only scan directly so it can be run safely at any time:
 *   npm run verify:stuck-rounds
 */
import 'dotenv/config'
import { findStuckCasinoRounds } from '@src/services/casinoStuckRoundService.js'
import { pool } from '@src/db/client.js'

const minutes = Number(process.argv[process.argv.indexOf('--minutes') + 1]) || 30

const groups = await findStuckCasinoRounds(minutes)

console.log(`Stuck-round scan (open longer than ${minutes} minutes)\n`)
if (!groups.length) {
  console.log('No stuck casino rounds. ✅')
} else {
  console.table(
    groups.map((g) => ({
      tenant: g.tenant,
      bets: g.stuckCount,
      players: g.playerCount,
      stakeAtRisk: g.stuckStake.toFixed(2),
      oldest: `${(g.oldestAgeMinutes / 60).toFixed(1)}h`,
      vendors: g.vendors.join(", "),
      zeroStakeNoise: g.zeroStakeCount,
    }))
  )
  for (const g of groups) {
    console.log(`\n${g.tenant} sample bet ids:`)
    g.sampleBetIds.forEach((id) => console.log('  ' + id))
  }
}

await pool.end()
