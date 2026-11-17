import PgBoss from 'pg-boss';
import { DateTime } from 'luxon';
import { getSSLConfig } from '@shared/db/ssl.js';
import { getEnv } from '@src/config/env.js';
import { generateDailySnapshot } from '@src/services/reportingSnapshotService.js';
import { formatDateInTz } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { logSnapshotEvent, truncateDetailForAudit } from '@src/services/snapshotAuditLog.js';

const JOB_NAME = 'reporting/snapshot-generate';
const START_RETRIES = 3;
const START_RETRY_DELAY_MS = 2000;

let boss: PgBoss | null = null;

export interface SnapshotJobData {
  tenant: string;
  whitelabelId: string;
  date: string; // ISO string
  domain: 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global';
  currency: string;
  /** Correlates worker execution with scheduler run row */
  runId?: string;
  /** Bypass checkSnapshotExists so the snapshot is always regenerated */
  forceRefresh?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Initialize pg-boss queue for snapshot generation.
 * Retries start on failure (e.g. DB not ready). Falls back to direct generation if all retries fail.
 */
export async function startSnapshotQueue(): Promise<void> {
  const connectionString = getEnv().DATABASE_URL;

  const ssl = getSSLConfig(connectionString);
  const pgBossConfig = {
    connectionString,
    ssl: ssl === false ? undefined : ssl,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= START_RETRIES; attempt++) {
    try {
      boss = new PgBoss(pgBossConfig);
      // pg-boss re-emits pool errors; without a listener a dropped DB connection crashes the whole server
      boss.on('error', (err) => console.error('[snapshot-queue] pg-boss error:', err.message));
      await boss.start();
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      boss = null;
      console.warn(
        `[snapshot-queue] pg-boss start attempt ${attempt}/${START_RETRIES} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      if (attempt < START_RETRIES) {
        await sleep(START_RETRY_DELAY_MS * attempt);
      }
    }
  }

  if (lastError) {
    console.error('[snapshot-queue] pg-boss start failed after', START_RETRIES, 'attempts:', lastError instanceof Error ? lastError.message : String(lastError));
    boss = null;
    return;
  }

  try {
    // Register worker to process snapshot generation jobs (singletonKey on publish prevents duplicate jobs)
    await boss!.work(JOB_NAME, { teamSize: 5 }, async (job) => {
      const { tenant, whitelabelId, date, domain, currency, runId, forceRefresh } = job.data as SnapshotJobData;
      const pgBossJobId = job?.id != null ? String(job.id) : undefined;
      const tz = await getWhitelabelTimezone(tenant);
      // Calendar yyyy-MM-dd must be interpreted in the tenant timezone (not hardcoded IST).
      const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? DateTime.fromISO(date, { zone: tz }).startOf('day').toJSDate()
        : new Date(date);
      const reportingDay = formatDateInTz(snapshotDate, tz);
      const singletonKey = `${tenant}:${whitelabelId}:${reportingDay}:${domain}:${currency}`;
      const started = Date.now();

      await logSnapshotEvent({
        runId: runId ?? undefined,
        level: 'info',
        eventType: 'job_start',
        tenant,
        whitelabelId,
        currency,
        reportingDay,
        snapshotDateUtc: snapshotDate,
        domain,
        pgBossJobId,
        singletonKey,
        message: `Snapshot job started: ${domain}`,
      });

      try {
        const result = await generateDailySnapshot({
          tenant,
          whitelabelId,
          date: snapshotDate,
          domain,
          currency,
          forceRefresh: forceRefresh ?? false,
          audit: { runId: runId ?? undefined, pgBossJobId, singletonKey },
        });
        const wasSkipped = result && 'skipped' in result && result.skipped;
        const skipReason = wasSkipped && 'reason' in result ? (result as any).reason : undefined;
        await logSnapshotEvent({
          runId: runId ?? undefined,
          level: wasSkipped ? 'warn' : 'info',
          eventType: wasSkipped ? 'job_skipped' : 'job_complete',
          tenant,
          whitelabelId,
          currency,
          reportingDay,
          snapshotDateUtc: snapshotDate,
          domain,
          pgBossJobId,
          singletonKey,
          message: wasSkipped
            ? `Snapshot job skipped: ${domain} (${skipReason})`
            : `Snapshot job completed: ${domain}`,
          detailJson: { durationMs: Date.now() - started, ...(wasSkipped ? { skipReason } : {}) },
        });
      } catch (error) {
        await logSnapshotEvent({
          runId: runId ?? undefined,
          level: 'error',
          eventType: 'job_failed',
          tenant,
          whitelabelId,
          currency,
          reportingDay,
          snapshotDateUtc: snapshotDate,
          domain,
          pgBossJobId,
          singletonKey,
          message: error instanceof Error ? error.message : String(error),
          detailJson: { ...truncateDetailForAudit(error), durationMs: Date.now() - started },
        });
        throw error;
      }
    });

    console.log('[snapshot-queue] Snapshot queue started; worker registered for', JOB_NAME);
  } catch (error) {
    console.error('[snapshot-queue] Worker registration failed:', error instanceof Error ? error.message : String(error));
    boss = null;
  }
}

/**
 * Enqueue snapshot generation job
 * Uses singleton key to prevent duplicate jobs for same snapshot
 * When runDirect=true, bypasses queue and runs immediately (for manual Fix when worker may not be processing)
 */
export async function enqueueSnapshotGeneration(
  tenant: string,
  whitelabelId: string,
  date: Date,
  domain: 'sports' | 'casino' | 'matka' | 'agents' | 'bonuses' | 'global',
  currency: string,
  opts?: { runId?: string | null; runDirect?: boolean; forceRefresh?: boolean },
): Promise<void> {
  const runId = opts?.runId ?? undefined;
  const runDirect = opts?.runDirect === true;
  const forceRefresh = opts?.forceRefresh === true;
  const tz = await getWhitelabelTimezone(tenant);
  const dateStr = formatDateInTz(date, tz);
  const singletonKey = `${tenant}:${whitelabelId}:${dateStr}:${domain}:${currency}`;

  const doDirectGenerate = async () => {
    await logSnapshotEvent({
      runId,
      level: 'info',
      eventType: 'enqueue_job',
      tenant,
      whitelabelId,
      currency,
      reportingDay: dateStr,
      snapshotDateUtc: date,
      domain,
      singletonKey,
      message: runDirect ? 'Direct generate (manual Fix)' : 'Direct generate (no queue)',
    });
    await generateDailySnapshot({
      tenant,
      whitelabelId,
      date,
      domain,
      currency,
      forceRefresh,
      audit: { runId, singletonKey },
    });
  };

  if (!boss || runDirect) {
    if (!boss && !runDirect) {
      console.warn('[snapshot-queue] Queue not available (boss=null); falling back to direct generation');
    }
    try {
      await doDirectGenerate();
    } catch (error) {
      console.error('[snapshot-queue] direct generateDailySnapshot failed:', error instanceof Error ? error.message : String(error));
      await logSnapshotEvent({
        runId,
        level: 'error',
        eventType: 'job_failed',
        tenant,
        whitelabelId,
        currency,
        reportingDay: dateStr,
        snapshotDateUtc: date,
        domain,
        singletonKey,
        message: error instanceof Error ? error.message : String(error),
        detailJson: truncateDetailForAudit(error),
      });
    }
    return;
  }

  try {
    const jobId = await boss.send(
      JOB_NAME,
      {
        tenant,
        whitelabelId,
        date: date.toISOString(),
        domain,
        currency,
        ...(runId ? { runId } : {}),
        ...(forceRefresh ? { forceRefresh } : {}),
      } as SnapshotJobData,
      {
        singletonKey,
        retryLimit: 3,
        retryDelay: 60000,
      },
    );
    if (jobId == null) {
      await logSnapshotEvent({
        runId,
        level: 'warn',
        eventType: 'enqueue_duplicate',
        tenant,
        whitelabelId,
        currency,
        reportingDay: dateStr,
        snapshotDateUtc: date,
        domain,
        singletonKey,
        message: 'Job not created: singletonKey already exists in queue',
      });
      return;
    }
    await logSnapshotEvent({
      runId,
      level: 'info',
      eventType: 'enqueue_job',
      tenant,
      whitelabelId,
      currency,
      reportingDay: dateStr,
      snapshotDateUtc: date,
      domain,
      singletonKey,
      message: `Snapshot job enqueued (jobId=${jobId})`,
    });
  } catch (error) {
    console.error('[snapshot-queue] enqueueSnapshotGeneration publish failed:', error instanceof Error ? error.message : String(error));
    await logSnapshotEvent({
      runId,
      level: 'error',
      eventType: 'enqueue_failed',
      tenant,
      whitelabelId,
      currency,
      reportingDay: dateStr,
      snapshotDateUtc: date,
      domain,
      singletonKey,
      message: error instanceof Error ? error.message : String(error),
      detailJson: truncateDetailForAudit(error),
    });
    try {
      await generateDailySnapshot({
        tenant,
        whitelabelId,
        date,
        domain,
        currency,
        forceRefresh,
        audit: { runId, singletonKey },
      });
    } catch (fallbackError) {
      console.error('[snapshot-queue] enqueue fallback generateDailySnapshot failed:', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      await logSnapshotEvent({
        runId,
        level: 'error',
        eventType: 'enqueue_fallback_failed',
        tenant,
        whitelabelId,
        currency,
        reportingDay: dateStr,
        snapshotDateUtc: date,
        domain,
        singletonKey,
        message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        detailJson: truncateDetailForAudit(fallbackError),
      });
    }
  }
}

/**
 * Get queue instance (for testing or manual job management)
 */
export function getSnapshotQueue(): PgBoss | null {
  return boss;
}
