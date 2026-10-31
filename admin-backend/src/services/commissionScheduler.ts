/**
 * Commission accrual scheduler — weekly IST cycles.
 * Runs once per day and accrues COMMISSION lines into agent_ledger for the last
 * completed Monday→Monday IST cycles. accrueCommission is idempotent (skips an
 * existing line for the exact periodFrom/periodTo), so repeated runs are no-ops.
 *
 * What is posted is exactly the cycle's payable: GROSS per domain after tally
 * rules, from live bets over [Monday, next Monday) IST (CommissionCalculationService).
 * A cycle with bets still open is deferred, and a later daily run posts it once
 * they settle — the lookback covers the last COMMISSION_ACCRUAL_LOOKBACK_WEEKS cycles.
 *
 * Scheduling is pg-boss cron (`boss.schedule`), as losingBonusScheduler does. The
 * old code re-sent the next run with `boss.send(..., { singletonKey })` from
 * INSIDE the running job; pg-boss 9 inserts with ON CONFLICT DO NOTHING on the
 * singleton key, and the running job still held it, so every re-send was dropped
 * and accrual ran once per server start. A cron schedule is a row in
 * pgboss.schedule (upserted by name, so idempotent across restarts) that the
 * timekeeper turns into one job per tick, deduplicated across instances.
 *
 * Idempotency: Re-running for the same cycle only increments "skipped" (existing lines).
 * To validate consistency, run: RECONCILE_TENANT=<id> npm run reconcile:commission
 *
 * Env:
 *   COMMISSION_SCHEDULER_TZ          Optional. Timezone for run time (e.g. Asia/Kolkata). Default: Asia/Kolkata.
 *   COMMISSION_RUN_AT_LOCAL_TIME     Optional. "HH:mm" when to run (e.g. 00:30). Default: 00:30.
 *   COMMISSION_DRY_RUN               Optional. "true" = log only, no ledger writes. Default: false.
 *   COMMISSION_ACCRUAL_LOOKBACK_WEEKS Optional. Completed cycles each daily run accrues. Default: 2.
 *   COMMISSION_CATCH_UP_WEEKS        Optional. On startup, backfill this many past completed cycles.
 *                                    Default: 2 (unconditional — ensures missed-run gaps are closed
 *                                    automatically on every restart; accrual is idempotent so
 *                                    already-complete cycles are no-ops). Set to 0 to disable.
 */

import PgBoss from 'pg-boss';
import { DateTime } from 'luxon';
import { listWhitelabelsDb } from '@src/repos/common/whitelabelRepo.js';
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '@src/repos/agents/AgentConfigsRepo.js';
import { AgentLedgerRepo } from '@src/repos/agents/AgentLedgerRepo.js';
import { HybridGGRReader } from '@src/domains/agents/services/HybridGGRReader.js';
import { CommissionCalculationService } from '@src/domains/agents/services/CommissionCalculationService.js';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';
import { getLastNCompletedCycles, COMMISSION_SETTLEMENT_IST } from '@src/domains/agents/services/CommissionCycleUtils.js';
export { getLastNCompletedCycles } from '@src/domains/agents/services/CommissionCycleUtils.js';

const COMMISSION_TZ = process.env.COMMISSION_SCHEDULER_TZ || 'Asia/Kolkata';
const COMMISSION_RUN_AT_LOCAL = process.env.COMMISSION_RUN_AT_LOCAL_TIME || '00:30';
const PAGE_SIZE = 200;

export const COMMISSION_ACCRUAL_JOB = 'reporting/commission-accrual';

let boss: PgBoss | null = null;
let ownBoss = false; // true only when we created our own PgBoss (do not stop shared instance)
let schedulerInterval: NodeJS.Timeout | null = null;

export interface CommissionAccrualRunStats {
  tenantsProcessed: number;
  agentsScanned: number;
  inserted: number;
  skipped: number;
  deferred: number;
  errors: number;
  dryRun: boolean;
}

export function parseRunAtLocal(value: string = COMMISSION_RUN_AT_LOCAL): { hour: number; minute: number } {
  const parts = value.trim().split(':');
  const hour = Math.min(23, Math.max(0, parseInt(parts[0] || '0', 10) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(parts[1] || '0', 10) || 0));
  return { hour, minute };
}

/** Daily cron for "HH:mm" (minute hour * * *), interpreted in the schedule's tz. */
export function buildCommissionAccrualCron(runAtLocal: string = COMMISSION_RUN_AT_LOCAL): string {
  const { hour, minute } = parseRunAtLocal(runAtLocal);
  return `${minute} ${hour} * * *`;
}

function getNextRunTime(): Date {
  const { hour, minute } = parseRunAtLocal();
  let runAt = DateTime.now().setZone(COMMISSION_TZ).set({ hour, minute, second: 0, millisecond: 0 });
  const nowInTz = DateTime.now().setZone(COMMISSION_TZ);
  if (runAt <= nowInTz) {
    runAt = runAt.plus({ days: 1 });
  }
  return runAt.toJSDate();
}

function logSchedulerConfig(): void {
  const nextRun = DateTime.fromJSDate(getNextRunTime()).setZone(COMMISSION_TZ);
  console.log(
    `[commissionScheduler] Trigger schedule: cron "${buildCommissionAccrualCron()}" ${COMMISSION_TZ}. Next run: ${nextRun.toFormat('yyyy-LL-dd HH:mm ZZZZ')}.`
  );
  console.log(
    '[commissionScheduler] Accrual uses weekly Monday→Monday IST cycles aligned with settlement.'
  );
}

function lookbackWeeks(): number {
  const raw = process.env.COMMISSION_ACCRUAL_LOOKBACK_WEEKS;
  if (raw !== undefined && raw !== '') return Math.max(1, parseInt(raw, 10) || 1);
  return 2;
}

/**
 * Accrue the given completed cycles for every ACTIVE COMMISSION agent of every
 * tenant. A cycle whose bets are still open is deferred (nothing posted).
 */
async function accrueCycles(
  cycles: Array<{ periodFrom: Date; periodTo: Date }>,
  dryRun: boolean,
): Promise<CommissionAccrualRunStats> {
  const stats: CommissionAccrualRunStats = {
    tenantsProcessed: 0,
    agentsScanned: 0,
    inserted: 0,
    skipped: 0,
    deferred: 0,
    errors: 0,
    dryRun,
  };
  if (cycles.length === 0) return stats;

  const agentsRepo = new AgentsRepo();
  const configsRepo = new AgentConfigsRepo();
  const ledgerRepo = new AgentLedgerRepo();
  // Live bets — the same reader payable, readiness and payCommission use.
  const ggrReaders = new HybridGGRReader();
  const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReaders);

  const tenants = await listWhitelabelsDb();
  if (tenants.length === 0) {
    return stats;
  }

  for (const { periodFrom, periodTo } of cycles) {
    const fromIST = DateTime.fromJSDate(periodFrom, { zone: COMMISSION_SETTLEMENT_IST }).toFormat('yyyy-MM-dd');
    const toIST = DateTime.fromJSDate(periodTo, { zone: COMMISSION_SETTLEMENT_IST }).toFormat('yyyy-MM-dd');
    console.log(`[commissionScheduler] Accruing for cycle: ${fromIST} → ${toIST} (IST)`);
  }

  for (const tenant of tenants) {
    const tenantId = tenant.id;
    const currency = await getWhitelabelCurrency(tenantId).catch(() => 'USD');

    let offset = 0;
    let agentsPage: Awaited<ReturnType<AgentsRepo['list']>>;

    do {
      agentsPage = await agentsRepo.list(tenantId, { schemeType: 'COMMISSION', status: 'ACTIVE' }, { offset, limit: PAGE_SIZE });

      for (const agent of agentsPage) {
        stats.agentsScanned++;
        if (dryRun) {
          continue;
        }
        for (const { periodFrom, periodTo } of cycles) {
          try {
            const result = await commissionService.accrueCommission(agent.id, periodFrom, periodTo, currency, { deferIfOpenBets: true });
            stats.inserted += result.inserted;
            stats.skipped += result.skipped;
            if (result.deferred) stats.deferred++;
          } catch (err) {
            stats.errors++;
            if (stats.errors <= 5) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`[commissionScheduler] accrual failed agent=${agent.id} tenant=${tenantId}: ${msg}`);
            }
          }
        }
      }

      offset += PAGE_SIZE;
    } while (agentsPage.length === PAGE_SIZE);

    stats.tenantsProcessed++;
  }

  return stats;
}

/**
 * Run commission accrual for the last completed weekly IST cycles (lookback,
 * default 2, so a cycle deferred for open bets is retried the following days).
 * accrueCommission is idempotent (exact periodFrom/periodTo match), so running
 * this multiple times in the same week is safe — subsequent runs skip.
 */
export async function runDailyCommissionAccrual(dryRun: boolean): Promise<CommissionAccrualRunStats> {
  return accrueCycles(getLastNCompletedCycles(lookbackWeeks()), dryRun);
}

/**
 * Optional catch-up: accrue last N weeks (e.g. after deployment). Uses same idempotent accrual.
 */
async function runCatchUpAccrual(weeks: number): Promise<void> {
  if (weeks <= 0) return;
  await accrueCycles(getLastNCompletedCycles(weeks), false);
}

export async function executeCommissionAccrualJob(): Promise<void> {
  const dryRun = String(process.env.COMMISSION_DRY_RUN || 'false').toLowerCase() === 'true';

  const stats = await runDailyCommissionAccrual(dryRun);

  // Structured log for observability
  console.log(JSON.stringify({
    msg: 'Commission accrual run completed',
    tenantsProcessed: stats.tenantsProcessed,
    agentsScanned: stats.agentsScanned,
    inserted: stats.inserted,
    skipped: stats.skipped,
    deferred: stats.deferred,
    errors: stats.errors,
    dryRun: stats.dryRun,
  }));

  if (stats.errors > 0 && stats.errors <= 5) {
    console.warn(`[commissionScheduler] ${stats.errors} agent(s) had accrual errors this run.`);
  }
}

/** The part of PgBoss this scheduler uses (lets the registration be tested without a database). */
export type CommissionAccrualBoss = Pick<PgBoss, 'schedule' | 'work'>;

/**
 * Register the daily accrual on pg-boss: a cron schedule in COMMISSION_TZ plus the
 * worker that runs it. The worker never enqueues anything itself.
 */
export async function registerCommissionAccrualJob(
  target: CommissionAccrualBoss,
  run: () => Promise<void> = executeCommissionAccrualJob,
): Promise<void> {
  await target.schedule(COMMISSION_ACCRUAL_JOB, buildCommissionAccrualCron(), {}, { tz: COMMISSION_TZ });
  await target.work(COMMISSION_ACCRUAL_JOB, async () => {
    try {
      await run();
    } catch (err) {
      // Swallow so pg-boss does not retry a run that simply happens again on the next tick.
      console.error('[commissionScheduler] accrual run failed:', err instanceof Error ? err.message : String(err));
    }
  });
}

/**
 * Start daily commission accrual scheduler.
 * Uses pg-boss from snapshot queue when available; otherwise setTimeout fallback.
 */
export async function startCommissionScheduler(): Promise<void> {
  const dryRun = String(process.env.COMMISSION_DRY_RUN || 'false').toLowerCase() === 'true';
  if (dryRun) {
    console.log('[commissionScheduler] Started in DRY-RUN mode (no ledger writes). Set COMMISSION_DRY_RUN=false to enable writes.');
  }
  logSchedulerConfig();

  // Startup backfill: unconditionally accrue the last N completed cycles on every restart.
  // Default N=2 so a server outage spanning one daily run slot is automatically recovered.
  // Accrual is idempotent (existsCommissionLine guard), so already-complete cycles are no-ops.
  // COMMISSION_CATCH_UP_WEEKS=0 disables the backfill; any positive integer overrides N.
  const catchUpWeeks = (() => {
    const raw = process.env.COMMISSION_CATCH_UP_WEEKS ?? process.env.COMMISSION_CATCH_UP_DAYS;
    if (raw !== undefined && raw !== '') {
      return Math.max(0, parseInt(raw, 10) || 0);
    }
    return 2; // default: backfill last 2 completed cycles on every startup
  })();
  try {
    if (!dryRun) await runCatchUpAccrual(catchUpWeeks);
    if (catchUpWeeks > 0) {
      console.log(`[commissionScheduler] Startup backfill completed for last ${catchUpWeeks} completed cycle(s) (idempotent).`);
    }
  } catch (err) {
    console.error('[commissionScheduler] Startup backfill failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  const { getSnapshotQueue } = await import('@src/services/snapshotQueue.js');
  const existingBoss = getSnapshotQueue();

  if (existingBoss) {
    boss = existingBoss;
    ownBoss = false;
    try {
      await registerCommissionAccrualJob(boss);
      return;
    } catch (err) {
      console.error('[commissionScheduler] pg-boss schedule failed, falling back to a timer:', err instanceof Error ? err.message : err);
      boss = null;
    }
  }

  const connectionString = process.env.DATABASE_URL;
  if (!boss && !existingBoss && connectionString) {
    try {
      const { getSSLConfig } = await import('@shared/db/ssl.js');
      const ssl = getSSLConfig(connectionString);
      boss = new PgBoss({
        connectionString,
        ssl: ssl === false ? undefined : ssl,
      });
      await boss.start();
      ownBoss = true;
      await registerCommissionAccrualJob(boss);
      return;
    } catch (error) {
      if (boss && ownBoss) boss.stop().catch(() => {});
      boss = null;
      ownBoss = false;
    }
  }

  const scheduleWithInterval = () => {
    const nextRun = getNextRunTime();
    const now = new Date();
    const delayMs = nextRun.getTime() - now.getTime();

    if (delayMs > 0) {
      schedulerInterval = setTimeout(async () => {
        await executeCommissionAccrualJob().catch(() => {});
        scheduleWithInterval();
      }, delayMs);
    } else {
      executeCommissionAccrualJob().catch(() => {}).then(() => {
        scheduleWithInterval();
      });
    }
  };

  scheduleWithInterval();
}

export function stopCommissionScheduler(): void {
  if (schedulerInterval) {
    clearTimeout(schedulerInterval);
    schedulerInterval = null;
  }
  if (boss && ownBoss) {
    boss.stop().catch(() => {});
  }
  boss = null;
  ownBoss = false;
}
