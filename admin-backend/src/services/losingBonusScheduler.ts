import PgBoss from 'pg-boss'
import { getSSLConfig } from '@shared/db/ssl.js'
import { runLosingBonusWeekly } from '@src/services/losingBonusWeeklyService.js'

const JOB_NAME = 'losing-bonus/weekly'
const CRON_MONDAY_00_00_IST = '0 0 * * 1' // Every Monday at 00:00
const TZ_IST = 'Asia/Kolkata'

let boss: PgBoss | null = null
let ownBoss = false

export async function startLosingBonusScheduler(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return
  }

  try {
    const { getSnapshotQueue } = await import('@src/services/snapshotQueue.js')
    const existingBoss = getSnapshotQueue()

    if (existingBoss) {
      boss = existingBoss
      ownBoss = false
    } else {
      const ssl = getSSLConfig(connectionString)
      boss = new PgBoss({
        connectionString,
        ssl: ssl === false ? undefined : ssl,
      })
      await boss.start()
      ownBoss = true
    }

    await boss.schedule(JOB_NAME, CRON_MONDAY_00_00_IST, {}, { tz: TZ_IST })

    await boss.work(JOB_NAME, async () => {
      const results = await runLosingBonusWeekly()
      for (const r of results) {
        if (r.error) {
          console.error(`[losing-bonus] Campaign ${r.campaignId} (${r.campaignName}): ${r.error}`)
        } else {
          console.info(
            `[losing-bonus] Campaign ${r.campaignId} (${r.campaignName}): created ${r.createdCount}, skipped ${r.skippedCount}`
          )
        }
      }
    })
  } catch (err) {
    console.error(
      '[losing-bonus] startLosingBonusScheduler failed:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

export function stopLosingBonusScheduler(): void {
  if (boss && ownBoss) {
    boss.stop().catch((err) => {
      console.error('[losing-bonus] stop failed:', err instanceof Error ? err.message : String(err))
    })
  }
  boss = null
  ownBoss = false
}
