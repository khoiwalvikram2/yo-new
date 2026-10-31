/**
 * Recurring scan for casino rounds that took money and never settled.
 *
 * Modelled on losingBonusScheduler.ts — the pg-boss cron API (`boss.schedule`) rather than a
 * self-rescheduling `boss.send` chain, because cron dedupes across instances internally
 * (singletonKey + singletonSeconds in the timekeeper), so N pods still produce ONE run.
 *
 * Tuning:
 *   CASINO_STUCK_ROUND_CRON            cron expression (default every 15 minutes)
 *   CASINO_STUCK_ROUND_MINUTES         age at which an open round counts as stuck (default 30)
 *   CASINO_STUCK_ROUND_REALERT_MINUTES dedupe window per tenant (default 360)
 */

import PgBoss from 'pg-boss'
import { getSSLConfig } from '@shared/db/ssl.js'
import { runStuckCasinoRoundScan, runCallbackRejectionSpikeScan } from '@src/services/casinoStuckRoundService.js'

const JOB_NAME = 'casino/stuck-round-scan'
const CRON_EVERY_15_MIN = process.env.CASINO_STUCK_ROUND_CRON || '*/15 * * * *'
const TZ_IST = 'Asia/Kolkata'

let boss: PgBoss | null = null
let ownBoss = false // true only when we created our own PgBoss (do not stop shared instance)

export async function startCasinoStuckRoundScheduler(): Promise<void> {
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

    await boss.schedule(JOB_NAME, CRON_EVERY_15_MIN, {}, { tz: TZ_IST })

    await boss.work(JOB_NAME, async () => {
      // Two independent health checks, each isolated: a failure in one must not skip the other.
      // Stuck rounds catch the OUTCOME (money taken, never resolved); rejection spikes catch the
      // CAUSE earlier (we are refusing the provider). Either alone would have caught CS-22135.
      try {
        const result = await runStuckCasinoRoundScan()
        if (result.groups.length > 0) {
          const total = result.groups.reduce((s, g) => s + g.stuckCount, 0)
          const stake = result.groups.reduce((s, g) => s + g.stuckStake, 0)
          console.warn(
            `[casino-stuck-rounds] ${total} bet(s) open >${result.stuckAfterMinutes}m across ` +
              `${result.groups.length} tenant(s), stake ${stake.toFixed(2)} — ` +
              `alerts created ${result.alertsCreated}, suppressed ${result.alertsSuppressed}`
          )
        }
      } catch (err) {
        // Swallow so pg-boss does not retry a scan that will simply run again on the next tick.
        console.error('[casino-stuck-rounds] scan failed:', err instanceof Error ? err.message : String(err))
      }

      try {
        const rej = await runCallbackRejectionSpikeScan()
        if (rej.spikes.length > 0) {
          console.warn(
            `[casino-rejection-spike] ${rej.spikes.length} spike(s): ` +
              rej.spikes.map((s) => `${s.providerKey}/${s.errorCode} x${s.count}`).join(', ') +
              ` — alerts created ${rej.alertsCreated}, suppressed ${rej.alertsSuppressed}`
          )
        }
      } catch (err) {
        console.error('[casino-rejection-spike] scan failed:', err instanceof Error ? err.message : String(err))
      }
    })
  } catch (err) {
    console.error(
      '[casino-stuck-rounds] startCasinoStuckRoundScheduler failed:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

export function stopCasinoStuckRoundScheduler(): void {
  if (boss && ownBoss) {
    boss.stop().catch((err) => {
      console.error('[casino-stuck-rounds] stop failed:', err instanceof Error ? err.message : String(err))
    })
  }
  boss = null
  ownBoss = false
}
