import PgBoss from 'pg-boss';
import { DateTime } from 'luxon';
import { enqueueSnapshotGeneration } from '@src/services/snapshotQueue.js';
import { db } from '@src/db/client.js';
import { reportingDailySnapshots } from '@shared/db/schema.js';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { formatDateInTz } from '@src/shared/dateUtils.js';
import {
  getSnapshotActiveCombinations,
  insertSnapshotRun,
  finishSnapshotRun,
  listMissingSnapshotDays,
} from '@/repos/reporting/snapshotAuditRepo.js';
import { logSnapshotEvent, truncateDetailForAudit } from '@src/services/snapshotAuditLog.js';

const SNAPSHOT_TZ = process.env.SNAPSHOT_TZ || 'Asia/Kolkata';
// SNAPSHOT_RUN_AT_LOCAL_TIME = "HH:mm" e.g. "00:30" for 12:30 AM in SNAPSHOT_TZ
const SNAPSHOT_RUN_AT_LOCAL = process.env.SNAPSHOT_RUN_AT_LOCAL_TIME || '00:30';
const DEFAULT_TENANT_TZ = 'Asia/Kolkata';

const SNAPSHOT_HEALTHCHECK_CRON = '0 */6 * * *'; // Every 6 hours
const SNAPSHOT_HEALTHCHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let boss: PgBoss | null = null;
let schedulerInterval: NodeJS.Timeout | null = null;
let healthCheckInterval: NodeJS.Timeout | null = null;

function parseRunAtLocal(): { hour: number; minute: number } {
  const parts = SNAPSHOT_RUN_AT_LOCAL.trim().split(':');
  const hour = Math.min(23, Math.max(0, parseInt(parts[0] || '0', 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(parts[1] || '0', 10) || 0));
  return { hour, minute };
}

/**
 * Get tenant timezone for snapshot "yesterday"; default IST when missing.
 */
async function getTenantTimezone(tenantId: string): Promise<string> {
  try {
    const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
    const tz = await getWhitelabelTimezone(tenantId);
    return tz && tz.trim() ? tz.trim() : DEFAULT_TENANT_TZ;
  } catch {
    return DEFAULT_TENANT_TZ;
  }
}

export const SNAPSHOT_BACKFILL_LOOKBACK_DAYS = 30;

/**
 * Scan last N days for missing snapshot dates per tenant/whitelabel/currency and enqueue generation.
 * Called at startup and by the health-check cron. Uses advisory locks inside generateDailySnapshot.
 */
export async function backfillMissingSnapshots(opts?: {
  trigger?: 'health_backfill' | 'startup_backfill';
}): Promise<void> {
  const trigger = opts?.trigger ?? 'health_backfill';
  let runId: string | null = null;
  try {
    runId = await insertSnapshotRun({ trigger });
    const combinations = await getSnapshotActiveCombinations();
    let enqueuedTotal = 0;
    let failedCombos = 0;

    for (const combo of combinations) {
      try {
        const tz = await getTenantTimezone(combo.tenant);
        const yesterday = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day');
        const lookbackStart = yesterday.minus({ days: SNAPSHOT_BACKFILL_LOOKBACK_DAYS - 1 });

        // Use 'global' domain as the check — it generates all sub-domains internally
        const existingRows = await db
          .selectDistinct({
            date: reportingDailySnapshots.snapshotDate,
          })
          .from(reportingDailySnapshots)
          .where(
            and(
              eq(reportingDailySnapshots.tenant, combo.tenant),
              eq(reportingDailySnapshots.whitelabelId, combo.whitelabelId),
              eq(reportingDailySnapshots.currency, combo.currency),
              eq(reportingDailySnapshots.domain, 'global'),
              isNull(reportingDailySnapshots.playerId),
              isNull(reportingDailySnapshots.sportId),
              isNull(reportingDailySnapshots.leagueId),
              isNull(reportingDailySnapshots.eventId),
              isNull(reportingDailySnapshots.agentId),
              isNull(reportingDailySnapshots.campaignId),
              gte(reportingDailySnapshots.snapshotDate, lookbackStart.toJSDate()),
              lte(reportingDailySnapshots.snapshotDate, yesterday.toJSDate()),
            ),
          );

        const existingDateSet = new Set(
          existingRows.map((r) => {
            const d = r.date instanceof Date ? r.date : new Date(r.date);
            return formatDateInTz(d, tz);
          }),
        );

        let cursor = lookbackStart;
        let enqueuedCount = 0;
        while (cursor <= yesterday) {
          const dateStr = cursor.toFormat('yyyy-MM-dd');
          if (!existingDateSet.has(dateStr)) {
            await enqueueSnapshotGeneration(
              combo.tenant,
              combo.whitelabelId,
              cursor.toJSDate(),
              'global',
              combo.currency,
              { runId },
            );
            enqueuedCount += 1;
          }
          cursor = cursor.plus({ days: 1 });
        }
        enqueuedTotal += enqueuedCount;
        if (enqueuedCount > 0) {
          console.log(
            `[snapshot-backfill] ${combo.tenant}/${combo.whitelabelId}/${combo.currency}: enqueued ${enqueuedCount} missing date(s) for global snapshot`,
          );
        }
      } catch (err) {
        failedCombos += 1;
        console.error(
          `[snapshot-backfill] Failed for ${combo.tenant}/${combo.whitelabelId}/${combo.currency}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (enqueuedTotal === 0 && runId) {
      try {
        const gaps = await listMissingSnapshotDays({
          lookbackDays: SNAPSHOT_BACKFILL_LOOKBACK_DAYS,
          tenant: null,
          whitelabelId: null,
          currency: null,
        });
        if (gaps.length > 0) {
          await logSnapshotEvent({
            runId,
            level: 'warn',
            eventType: 'backfill_zero_enqueue_with_gaps',
            message: `Health backfill enqueued 0 jobs but ${gaps.length} missing day(s) remain in the ${SNAPSHOT_BACKFILL_LOOKBACK_DAYS}d window`,
            detailJson: {
              missingCount: gaps.length,
              lookbackDays: SNAPSHOT_BACKFILL_LOOKBACK_DAYS,
              sample: gaps.slice(0, 12).map((g) => ({
                tenant: g.tenant,
                whitelabelId: g.whitelabelId,
                currency: g.currency,
                reportingDay: g.reportingDay,
              })),
            },
          });
        }
      } catch {
        /* ignore gap-detection failures */
      }
    }
    if (runId) {
      await finishSnapshotRun({
        id: runId,
        status: failedCombos > 0 ? 'partial' : 'success',
        summaryJson: { enqueuedTotal, failedCombos, combos: combinations.length, trigger },
      });
    }
  } catch (err) {
    console.error('[snapshot-backfill] backfillMissingSnapshots failed:', err instanceof Error ? err.message : String(err));
    if (runId) {
      await finishSnapshotRun({
        id: runId,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const SNAPSHOT_DAILY_LOOKBACK_DAYS = 3;

/**
 * Generate snapshots for the last 3 days (per tenant: yesterday, yesterday-1, yesterday-2 in that tenant's TZ).
 * Uses 'global' domain which internally generates all sub-domains (sports, casino, matka, agents, bonuses) + global aggregate.
 * Idempotent: existing snapshots are skipped or safely upserted via checkSnapshotExists + onConflictDoUpdate.
 */
async function generatePreviousDaySnapshots(): Promise<void> {
  let runId: string | null = null;
  try {
    runId = await insertSnapshotRun({ trigger: 'daily_schedule' });
    const combinations = await getSnapshotActiveCombinations();
    let enqueuedCount = 0;
    let failedEnqueue = 0;
    let failedCombos = 0;

    for (const combo of combinations) {
      try {
        const tz = await getTenantTimezone(combo.tenant);
        const base = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day');

        for (let d = 0; d < SNAPSHOT_DAILY_LOOKBACK_DAYS; d++) {
          const snapshotDate = base.minus({ days: d }).toJSDate();
          try {
            await enqueueSnapshotGeneration(
              combo.tenant,
              combo.whitelabelId,
              snapshotDate,
              'global',
              combo.currency,
              { runId, forceRefresh: true },
            );
            enqueuedCount += 1;
          } catch (error) {
            failedEnqueue += 1;
            const dateStr = formatDateInTz(snapshotDate, tz);
            console.error(
              `[snapshot-scheduler] enqueue failed ${combo.tenant}/${combo.whitelabelId} ${dateStr} global:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      } catch (error) {
        failedCombos += 1;
        console.error(
          `[snapshot-scheduler] generatePreviousDaySnapshots combo failed ${combo.tenant}/${combo.whitelabelId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (runId) {
      await finishSnapshotRun({
        id: runId,
        status: failedEnqueue > 0 || failedCombos > 0 ? 'partial' : 'success',
        summaryJson: { enqueuedCount, failedEnqueue, failedCombos, combos: combinations.length },
      });
    }
  } catch (error) {
    console.error('[snapshot-scheduler] generatePreviousDaySnapshots failed:', error instanceof Error ? error.message : String(error));
    if (runId) {
      await finishSnapshotRun({
        id: runId,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Next local SNAPSHOT_TZ run time as UTC Date (for scheduling / UI). */
export function computeNextSnapshotRunUtc(): Date {
  return getNextRunTime();
}

export function getSnapshotSchedulerPublicConfig() {
  return {
    snapshotTimezone: SNAPSHOT_TZ,
    runAtLocalTime: SNAPSHOT_RUN_AT_LOCAL,
    healthCheckCron: SNAPSHOT_HEALTHCHECK_CRON,
    dailyLookbackDays: SNAPSHOT_DAILY_LOOKBACK_DAYS,
    backfillLookbackDays: SNAPSHOT_BACKFILL_LOOKBACK_DAYS,
  };
}

function getNextRunTime(): Date {
  const { hour, minute } = parseRunAtLocal();
  let runAt = DateTime.now().setZone(SNAPSHOT_TZ).set({ hour, minute, second: 0, millisecond: 0 });
  const nowInTz = DateTime.now().setZone(SNAPSHOT_TZ);
  if (runAt <= nowInTz) {
    runAt = runAt.plus({ days: 1 });
  }
  return runAt.toJSDate();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publish next reporting/snapshot-schedule with retries so one transient failure does not kill the chain.
 */
function createScheduleNext(bossRef: () => PgBoss | null): () => Promise<void> {
  return async () => {
    const b = bossRef();
    if (!b) {
      await logSnapshotEvent({
        level: 'warn',
        eventType: 'schedule_next_skipped',
        message: 'pg-boss instance null; next snapshot schedule not published',
      });
      return;
    }
    const nextRun = getNextRunTime();
    const now = new Date();
    const delayMs = nextRun.getTime() - now.getTime();
    const startAfter = delayMs > 0 ? nextRun : new Date();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await b.send(
          'reporting/snapshot-schedule',
          {},
          {
            startAfter,
            singletonKey: 'snapshot-scheduler',
          },
        );
        await logSnapshotEvent({
          level: 'info',
          eventType: 'schedule_next_publish',
          message: 'Published next reporting/snapshot-schedule',
          detailJson: { startAfter: startAfter.toISOString(), attempt },
        });
        return;
      } catch (err) {
        lastErr = err;
        console.error(
          '[snapshot-scheduler] scheduleNext failed:',
          err instanceof Error ? err.message : String(err),
        );
        if (attempt < 3) {
          await sleep(2 ** attempt * 1000);
        }
      }
    }
    await logSnapshotEvent({
      level: 'error',
      eventType: 'schedule_next_failed',
      message: lastErr instanceof Error ? lastErr.message : String(lastErr),
      detailJson: truncateDetailForAudit(lastErr),
    });
  };
}

/**
 * Start daily cron scheduler
 */
export async function startSnapshotScheduler(): Promise<void> {
  // Try to reuse pg-boss instance from snapshotQueue if available
  // Otherwise create a new instance
  const { getSnapshotQueue } = await import('@src/services/snapshotQueue.js');
  const existingBoss = getSnapshotQueue();
  
  if (existingBoss) {
    // Reuse existing pg-boss instance
    boss = existingBoss;
    const scheduleNext = createScheduleNext(() => boss);

    // Register worker for scheduled job — always try to chain next schedule
    await boss.work('reporting/snapshot-schedule', async () => {
      try {
        await generatePreviousDaySnapshots();
      } finally {
        try {
          await scheduleNext();
        } catch (err) {
          console.error(
            '[snapshot-scheduler] scheduleNext after run failed:',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    });

    // Health-check: backfill gaps every 6 hours
    await boss.work('reporting/snapshot-healthcheck', async () => {
      await backfillMissingSnapshots();
    });
    await boss.schedule('reporting/snapshot-healthcheck', SNAPSHOT_HEALTHCHECK_CRON, {}, { tz: SNAPSHOT_TZ });

    // Schedule initial run
    await scheduleNext();
    try {
      await backfillMissingSnapshots({ trigger: 'startup_backfill' });
    } catch (err) {
      console.error('[snapshot-scheduler] Startup backfill failed:', err instanceof Error ? err.message : String(err));
    }
    return;
  } else {
    // Create new pg-boss instance for scheduler
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Fall through to setInterval fallback
    } else {
      try {
        const { getSSLConfig } = await import('@shared/db/ssl.js');
        const ssl = getSSLConfig(connectionString);

        boss = new PgBoss({
          connectionString,
          ssl: ssl === false ? undefined : ssl,
        });
        await boss.start();

        const scheduleNext = createScheduleNext(() => boss);

        await boss.work('reporting/snapshot-schedule', async () => {
          try {
            await generatePreviousDaySnapshots();
          } finally {
            try {
              await scheduleNext();
            } catch (err) {
              console.error(
                '[snapshot-scheduler] scheduleNext after run failed:',
                err instanceof Error ? err.message : String(err),
              );
            }
          }
        });

        // Health-check: backfill gaps every 6 hours
        await boss.work('reporting/snapshot-healthcheck', async () => {
          await backfillMissingSnapshots();
        });
        await boss.schedule('reporting/snapshot-healthcheck', SNAPSHOT_HEALTHCHECK_CRON, {}, { tz: SNAPSHOT_TZ });

        // Schedule initial run
        await scheduleNext();
        try {
          await backfillMissingSnapshots({ trigger: 'startup_backfill' });
        } catch (err) {
          console.error('[snapshot-scheduler] Startup backfill failed:', err instanceof Error ? err.message : String(err));
        }
        return;
      } catch (error) {
        boss = null; // Reset boss on error
      }
    }
  }

  // Fallback to setInterval if pg-boss not available
  const scheduleWithInterval = () => {
    const nextRun = getNextRunTime();
    const now = new Date();
    const delayMs = nextRun.getTime() - now.getTime();

    if (delayMs > 0) {
      schedulerInterval = setTimeout(async () => {
        await generatePreviousDaySnapshots();
        // Schedule next run
        scheduleWithInterval();
      }, delayMs);
    } else {
      // If already past midnight, run immediately and schedule next
      generatePreviousDaySnapshots().then(() => {
        scheduleWithInterval();
      });
    }
  };

  scheduleWithInterval();
  // Health-check fallback: backfill gaps every 6 hours when pg-boss not available
  healthCheckInterval = setInterval(() => {
    backfillMissingSnapshots().catch((err) => {
      console.error('[snapshot-scheduler] Health-check backfill failed:', err instanceof Error ? err.message : String(err));
    });
  }, SNAPSHOT_HEALTHCHECK_INTERVAL_MS);
  try {
    await backfillMissingSnapshots({ trigger: 'startup_backfill' });
  } catch (err) {
    console.error('[snapshot-scheduler] Startup backfill failed:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Stop scheduler
 */
export function stopSnapshotScheduler(): void {
  if (schedulerInterval) {
    clearTimeout(schedulerInterval);
    schedulerInterval = null;
  }
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (boss) {
    boss.stop().catch((err) => {
      console.error('[snapshot-scheduler] stop failed:', err instanceof Error ? err.message : String(err));
    });
    boss = null;
  }
}
