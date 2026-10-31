import type PgBoss from 'pg-boss'
import { db } from '@src/db/client.js'
import { crmWhitelabelSettings } from '@shared/db/schema.js'
import { eq } from 'drizzle-orm'
import { runEscalationSweep } from '@src/repos/crm/CrmEscalationRepo.js'
import { expireLapsedRgFlags } from '@src/repos/crm/CrmRgRepo.js'

/**
 * Sweeps every enabled whitelabel's CRM for breaching tasks and lapsed
 * responsible-gambling episodes.
 *
 * Two things worth knowing about where this runs:
 *
 *   - It registers in the bootstrap block that returns early when
 *     `SERVER_ROLE=crm`, so it runs in the **full** process, not in a
 *     CRM-only one. That is deliberate: scheduled work has exactly one owner,
 *     and a CRM deployment scaled to three processes must not sweep three times.
 *   - It uses `boss.schedule`, never `boss.publish`. In pg-boss 9 `publish` is
 *     the pub/sub event API and creates no job when nothing has subscribed —
 *     two schedulers in this codebase were written that way and silently never
 *     ran. Verify a new job by finding its name in `pgboss.job`.
 *
 * The RG half is for reporting only. A block is a timestamp and lapses without
 * this running, so a missed sweep can delay a status label and never trap a
 * player.
 */

const JOB_NAME = 'crm/sla-sweep'
const CRON_EVERY_5_MINUTES = '*/5 * * * *'

let boss: PgBoss | null = null
let ownBoss = false

/** Whitelabels whose CRM is switched on. Nothing else is worth sweeping. */
async function enabledTenants(): Promise<string[]> {
  const rows = await db
    .select({ tenant: crmWhitelabelSettings.tenant })
    .from(crmWhitelabelSettings)
    .where(eq(crmWhitelabelSettings.enabled, true))
  return rows.map((r) => r.tenant)
}

/**
 * One pass. Exported so a test can run it directly without a scheduler, which
 * is the only honest way to assert what the sweep does.
 */
export async function runCrmSweep(): Promise<{
  tenants: number
  escalated: number
  failed: number
  expired: number
}> {
  let escalated = 0
  let failed = 0
  let expired = 0

  const tenants = await enabledTenants()
  for (const tenant of tenants) {
    try {
      const res = await runEscalationSweep(tenant)
      escalated += res.escalated
      failed += res.failed
      expired += await expireLapsedRgFlags(tenant)
    } catch (err) {
      // One whitelabel's failure must not stop the rest. Logged rather than
      // swallowed, because a sweep that silently does nothing is the failure
      // mode this whole file exists to avoid.
      console.error('[crmSlaScheduler] sweep failed for a tenant', {
        tenant,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { tenants: tenants.length, escalated, failed, expired }
}

export async function startCrmSlaScheduler(existingBoss?: PgBoss | null): Promise<void> {
  if (existingBoss) {
    boss = existingBoss
    ownBoss = false
  } else {
    // Without a shared instance there is nothing to schedule on. Running the
    // sweep on a timer instead would mean every process running it.
    console.warn('[crmSlaScheduler] no pg-boss instance; the CRM SLA sweep will not run')
    return
  }

  await boss.work(JOB_NAME, async () => {
    const res = await runCrmSweep()
    if (res.escalated || res.failed || res.expired) {
      console.log('[crmSlaScheduler]', res)
    }
  })
  await boss.schedule(JOB_NAME, CRON_EVERY_5_MINUTES, {}, { tz: 'UTC' })
  console.log(`[crmSlaScheduler] started (${CRON_EVERY_5_MINUTES})`)
}

export async function stopCrmSlaScheduler(): Promise<void> {
  if (!boss) return
  try {
    await boss.unschedule(JOB_NAME)
  } catch {
    // Unscheduling a job that was never scheduled is not an error worth raising
    // during shutdown.
  }
  // Only stop the instance if this module created it. Stopping a shared one
  // would take snapshot generation and commission accrual down with it.
  if (ownBoss) await boss.stop()
  boss = null
  ownBoss = false
}
