import type PgBoss from 'pg-boss'
import { db } from '@src/db/client.js'
import { refreshAutomaticVipTiers } from '@shared/vip/membership.js'

/**
 * Moves automatic VIP players to the tier their current month earns.
 *
 * A deposit approval raises the cached tier straight away, but nothing lowered
 * it when a whitelabel's month rolled over, so bet settings, the player list
 * and exports kept reading last month's tier. Every whitelabel has its own
 * month start, so the sweep runs often rather than at one midnight; a pass
 * with nothing due is a few reads.
 *
 * Like crmSlaScheduler it runs only on the shared pg-boss instance, uses
 * `boss.schedule` (never `publish`, which creates no job here), and is
 * registered below the SERVER_ROLE=crm early return so it has one owner.
 * Verify it by finding `vip/auto-tier-refresh` in `pgboss.job`.
 */

const JOB_NAME = 'vip/auto-tier-refresh'
const CRON_EVERY_15_MINUTES = process.env.VIP_TIER_REFRESH_CRON || '*/15 * * * *'

let boss: PgBoss | null = null

export async function startVipTierRefreshScheduler(existingBoss?: PgBoss | null): Promise<void> {
  if (!existingBoss) {
    console.warn('[vipTierRefresh] no pg-boss instance; automatic VIP tiers will not refresh at month rollover')
    return
  }
  boss = existingBoss
  await boss.work(JOB_NAME, async () => {
    try {
      const res = await refreshAutomaticVipTiers(db)
      if (res.changed || res.cleared || res.failed) console.log('[vipTierRefresh]', res)
    } catch (err) {
      // Swallowed so pg-boss does not retry a sweep that runs again on the next tick.
      console.error('[vipTierRefresh] sweep failed:', err instanceof Error ? err.message : String(err))
    }
  })
  await boss.schedule(JOB_NAME, CRON_EVERY_15_MINUTES, {}, { tz: 'UTC' })
  console.log(`[vipTierRefresh] started (${CRON_EVERY_15_MINUTES})`)
}

export async function stopVipTierRefreshScheduler(): Promise<void> {
  if (!boss) return
  try {
    await boss.unschedule(JOB_NAME)
  } catch {
    // Unscheduling a job that was never scheduled is not worth raising during shutdown.
  }
  // The instance is shared with snapshot generation, so it is never stopped here.
  boss = null
}
