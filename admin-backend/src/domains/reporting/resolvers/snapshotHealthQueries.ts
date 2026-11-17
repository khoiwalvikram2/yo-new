import { hasPermission } from '@src/domains/common/auth.js';
import {
  eventFilterToRepoScope,
  resolveSnapshotEventFilters,
} from '@src/domains/reporting/snapshotEventFilters.js';
import {
  listSnapshotRuns,
  listSnapshotEvents,
  listMissingSnapshotDays,
  listStaleSportsBetDays,
  countSnapshotEventsSince,
  countSnapshotEventsByTypeSinceGlobal,
  lastSnapshotEventOfType,
  lastSnapshotRunByTrigger,
  listSnapshotRunsConnection,
  listSnapshotEventsConnection,
} from '@/repos/reporting/snapshotAuditRepo.js';
import {
  listPgBossSnapshotJobCounts,
  listPgBossSnapshotSchedules,
} from '@/repos/reporting/snapshotPgBossRepo.js';
import {
  computeNextSnapshotRunUtc,
  getSnapshotSchedulerPublicConfig,
} from '@src/services/snapshotScheduler.js';

function requireSnapshotHealthView(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
  if (!hasPermission(ctx.permissions ?? [], 'reporting.snapshot-health', 'view')) {
    throw new Error('Forbidden: reporting.snapshot-health view required');
  }
  // Super Admin only, as the page's superAdminRoute is. Every whitelabel role holds the view above
  // through the flat reporting:read grant, and some of these reads (pg-boss jobs and schedules, the
  // scheduler's events) cover the whole platform.
  if (!hasPermission(ctx.permissions ?? [], 'all', '*')) {
    throw new Error('Forbidden: snapshot health is only available to Super Admin');
  }
  // Snapshot health is only for Super Admin in core mode; reject whitelabel mode
  if (ctx?.directorMode === 'whitelabel') {
    throw new Error('Forbidden: snapshot health is only available in core mode');
  }
}

function mapSnapshotRun(r: {
  id: string;
  trigger: string;
  status: string;
  startedAt: Date | string;
  finishedAt: Date | string | null;
  summaryJson: unknown;
  errorMessage: string | null;
}) {
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    startedAt: (r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt)).toISOString(),
    finishedAt: r.finishedAt
      ? (r.finishedAt instanceof Date ? r.finishedAt : new Date(r.finishedAt)).toISOString()
      : null,
    summaryJson: r.summaryJson,
    errorMessage: r.errorMessage,
  };
}

function mapSnapshotEvent(e: {
  id: string;
  runId: string | null;
  occurredAt: Date | string;
  level: string;
  eventType: string;
  tenant: string | null;
  whitelabelId: string | null;
  currency: string | null;
  reportingDay: Date | string | null;
  snapshotDateUtc: Date | string | null;
  domain: string | null;
  pgBossJobId: string | null;
  singletonKey: string | null;
  message: string | null;
  detailJson: unknown;
}) {
  const reportingDayStr =
    e.reportingDay == null
      ? null
      : e.reportingDay instanceof Date
        ? e.reportingDay.toISOString().slice(0, 10)
        : String(e.reportingDay).slice(0, 10);
  return {
    id: e.id,
    runId: e.runId,
    occurredAt: (e.occurredAt instanceof Date ? e.occurredAt : new Date(e.occurredAt)).toISOString(),
    level: e.level,
    eventType: e.eventType,
    tenant: e.tenant,
    whitelabelId: e.whitelabelId,
    currency: e.currency,
    reportingDay: reportingDayStr,
    snapshotDateUtc: e.snapshotDateUtc
      ? (e.snapshotDateUtc instanceof Date ? e.snapshotDateUtc : new Date(e.snapshotDateUtc)).toISOString()
      : null,
    reportingDayLabel: reportingDayStr
      ? `${reportingDayStr} (tenant reporting day; snapshot_date UTC anchor may be prior calendar evening)`
      : null,
    timezoneNote:
      'snapshot_date in DB is start-of-day in tenant timezone stored as timestamptz (e.g. IST midnight shows as previous UTC date).',
    domain: e.domain,
    pgBossJobId: e.pgBossJobId,
    singletonKey: e.singletonKey,
    message: e.message,
    detailJson: e.detailJson,
  };
}

export const snapshotHealthQueryResolvers = {
  snapshotHealthSummary: async (_: unknown, __: unknown, ctx: any) => {
    requireSnapshotHealthView(ctx);
    const cfg = getSnapshotSchedulerPublicConfig();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const eventScope = eventFilterToRepoScope(resolveSnapshotEventFilters(ctx));
    const errors24h = await countSnapshotEventsSince({
      since: since24h,
      level: 'error',
      tenant: eventScope?.tenant ?? null,
      whitelabelId: eventScope?.whitelabelId ?? null,
    });
    const backfillGapWarningsLast24h = await countSnapshotEventsByTypeSinceGlobal({
      since: since24h,
      eventType: 'backfill_zero_enqueue_with_gaps',
    });
    const lastScheduleOk = await lastSnapshotEventOfType('schedule_next_publish');
    const lastScheduleFail = await lastSnapshotEventOfType('schedule_next_failed');
    const lastJobComplete = await lastSnapshotEventOfType('job_complete', eventScope ?? null);
    const lastDailyRun = await lastSnapshotRunByTrigger('daily_schedule', eventScope ?? null);
    const lastHealthRun = await lastSnapshotRunByTrigger('health_backfill', eventScope ?? null);

    const missingFilter = resolveSnapshotEventFilters(ctx);
    const missing = await listMissingSnapshotDays({
      lookbackDays: cfg.backfillLookbackDays,
      tenant: missingFilter?.tenant ?? null,
      whitelabelId: missingFilter?.whitelabelId ?? null,
      currency: null,
    });

    const nextAt = computeNextSnapshotRunUtc();

    return {
      nextRunAtIso: nextAt.toISOString(),
      snapshotTimezone: cfg.snapshotTimezone,
      runAtLocalTime: cfg.runAtLocalTime,
      healthCheckCron: cfg.healthCheckCron,
      dailyLookbackDays: cfg.dailyLookbackDays,
      backfillLookbackDays: cfg.backfillLookbackDays,
      errorsLast24h: errors24h,
      backfillGapWarningsLast24h,
      missingDaysCount: missing.length,
      lastSchedulePublishAt: lastScheduleOk?.occurredAt?.toISOString?.() ?? null,
      lastScheduleFailureAt: lastScheduleFail?.occurredAt?.toISOString?.() ?? null,
      lastScheduleFailureMessage: lastScheduleFail?.message ?? null,
      lastJobCompleteAt: lastJobComplete?.occurredAt?.toISOString?.() ?? null,
      lastDailyScheduleRunAt: lastDailyRun?.startedAt
        ? (lastDailyRun.startedAt instanceof Date
            ? lastDailyRun.startedAt
            : new Date(lastDailyRun.startedAt)
          ).toISOString()
        : null,
      lastDailyScheduleRunStatus: lastDailyRun?.status ?? null,
      lastHealthBackfillRunAt: lastHealthRun?.startedAt
        ? (lastHealthRun.startedAt instanceof Date
            ? lastHealthRun.startedAt
            : new Date(lastHealthRun.startedAt)
          ).toISOString()
        : null,
      lastHealthBackfillRunStatus: lastHealthRun?.status ?? null,
    };
  },

  snapshotRuns: async (
    _: unknown,
    args: { limit?: number | null; offset?: number | null; trigger?: string | null },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const eventScope = eventFilterToRepoScope(resolveSnapshotEventFilters(ctx));
    const rows = await listSnapshotRuns({
      trigger: args.trigger ?? undefined,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
      eventScope: eventScope ?? null,
    });
    return rows.map(mapSnapshotRun);
  },

  snapshotRunsConnection: async (
    _: unknown,
    args: { first?: number | null; after?: string | null; trigger?: string | null },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const eventScope = eventFilterToRepoScope(resolveSnapshotEventFilters(ctx));
    try {
      const conn = await listSnapshotRunsConnection({
        first: args.first ?? 20,
        after: args.after ?? undefined,
        trigger: args.trigger ?? undefined,
        eventScope: eventScope ?? null,
      });
      return {
        nodes: conn.nodes.map(mapSnapshotRun),
        pageInfo: conn.pageInfo,
      };
    } catch {
      throw new Error('Invalid snapshotRunsConnection cursor');
    }
  },

  snapshotEvents: async (
    _: unknown,
    args: {
      limit?: number | null;
      offset?: number | null;
      runId?: string | null;
      tenant?: string | null;
      whitelabelId?: string | null;
      errorsOnly?: boolean | null;
      eventType?: string | null;
    },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const f = resolveSnapshotEventFilters(ctx, {
      tenant: args.tenant,
      whitelabelId: args.whitelabelId,
    });
    const rows = await listSnapshotEvents({
      tenant: f?.tenant,
      whitelabelId: f?.whitelabelId,
      runId: args.runId ?? undefined,
      errorsOnly: !!args.errorsOnly,
      eventType: args.eventType ?? undefined,
      limit: args.limit ?? 100,
      offset: args.offset ?? 0,
    });
    return rows.map(mapSnapshotEvent);
  },

  snapshotEventsConnection: async (
    _: unknown,
    args: {
      first?: number | null;
      after?: string | null;
      runId?: string | null;
      tenant?: string | null;
      whitelabelId?: string | null;
      errorsOnly?: boolean | null;
      eventType?: string | null;
    },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const f = resolveSnapshotEventFilters(ctx, {
      tenant: args.tenant,
      whitelabelId: args.whitelabelId,
    });
    try {
      const conn = await listSnapshotEventsConnection({
        first: args.first ?? 25,
        after: args.after ?? undefined,
        tenant: f?.tenant,
        whitelabelId: f?.whitelabelId,
        runId: args.runId ?? undefined,
        errorsOnly: !!args.errorsOnly,
        eventType: args.eventType ?? undefined,
      });
      return {
        nodes: conn.nodes.map(mapSnapshotEvent),
        pageInfo: conn.pageInfo,
      };
    } catch {
      throw new Error('Invalid snapshotEventsConnection cursor');
    }
  },

  snapshotPgBossOverview: async (_: unknown, __: unknown, ctx: any) => {
    requireSnapshotHealthView(ctx);
    const jobs = await listPgBossSnapshotJobCounts();
    const schedules = await listPgBossSnapshotSchedules();
    const parts = [jobs.error, schedules.error].filter((x): x is string => !!x && x.length > 0);
    return {
      jobCounts: jobs.rows.map((r) => ({ name: r.name, state: r.state, count: r.count })),
      schedules: schedules.rows.map((r) => ({ name: r.name, cron: r.cron, timezone: r.timezone })),
      readError: parts.length ? parts.join(' | ') : null,
    };
  },

  snapshotMissingDays: async (
    _: unknown,
    args: {
      lookbackDays?: number | null;
      tenant?: string | null;
      whitelabelId?: string | null;
      currency?: string | null;
    },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const lookback = Math.min(Math.max(args.lookbackDays ?? 30, 1), 90);
    const f = resolveSnapshotEventFilters(ctx, {
      tenant: args.tenant,
      whitelabelId: args.whitelabelId,
    });
    const rows = await listMissingSnapshotDays({
      lookbackDays: lookback,
      tenant: f?.tenant ?? null,
      whitelabelId: f?.whitelabelId ?? null,
      currency: args.currency ?? null,
    });
    return rows.map((r) => ({
      tenant: r.tenant,
      whitelabelId: r.whitelabelId,
      currency: r.currency,
      reportingDay: r.reportingDay,
      timezone: r.timezone,
    }));
  },

  snapshotStaleDays: async (
    _: unknown,
    args: {
      lookbackDays?: number | null;
      tenant?: string | null;
      whitelabelId?: string | null;
    },
    ctx: any,
  ) => {
    requireSnapshotHealthView(ctx);
    const lookback = Math.min(Math.max(args.lookbackDays ?? 30, 1), 90);
    const f = resolveSnapshotEventFilters(ctx, {
      tenant: args.tenant,
      whitelabelId: args.whitelabelId,
    });
    const rows = await listStaleSportsBetDays({
      lookbackDays: lookback,
      tenant: f?.tenant ?? null,
      whitelabelId: f?.whitelabelId ?? null,
      currency: null,
    });
    return rows.map((r) => ({
      tenant: r.tenant,
      whitelabelId: r.whitelabelId,
      currency: r.currency,
      reportingDay: r.reportingDay,
      timezone: r.timezone,
      staleBetCount: r.staleBetCount,
      snapshotCreatedAt: r.snapshotCreatedAt.toISOString(),
      latestSettledAt: r.latestSettledAt.toISOString(),
    }));
  },
};
