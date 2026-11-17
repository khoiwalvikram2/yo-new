import { hasPermission } from '@src/domains/common/auth.js';
import {
  getEffectiveTenantForDirector,
  shouldSkipTenantFiltering,
} from '@src/domains/common/directorModeUtils.js';
import { parseDateFrom } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { DateTime } from 'luxon';
import { enqueueSnapshotGeneration } from '@src/services/snapshotQueue.js';
import {
  insertSnapshotRun,
  finishSnapshotRun,
} from '@/repos/reporting/snapshotAuditRepo.js';

const MAX_BACKFILL_RANGE_DAYS = 31;

function requireSnapshotHealthTrigger(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
  if (!hasPermission(ctx.permissions ?? [], 'reporting.snapshot-health', 'trigger')) {
    throw new Error('Forbidden: reporting.snapshot-health trigger required');
  }
  // Super Admin only, the same rule as the Snapshot Health reads (snapshotHealthQueries.ts). Every whitelabel role
  // can hold the trigger through the flat reporting:write grant, and these mutations queue rebuilds for any tenant.
  if (!hasPermission(ctx.permissions ?? [], 'all', '*')) {
    throw new Error('Forbidden: snapshot health is only available to Super Admin');
  }
  // Snapshot health is only for Super Admin in core mode; reject whitelabel mode
  if (ctx?.directorMode === 'whitelabel') {
    throw new Error('Forbidden: snapshot health is only available in core mode');
  }
}

// Only a platform caller (Super Admin in core mode) may name the tenant and whitelabel to rebuild. Any other caller
// gets its own whatever the arguments say, so it can never queue rebuilds for another whitelabel. Exported for tests.
export function resolveTenantForMutation(ctx: any, tenantArg?: string | null): string {
  if (shouldSkipTenantFiltering(ctx)) {
    return tenantArg ?? ctx?.tenant ?? 'default';
  }
  const directorWl = getEffectiveTenantForDirector(ctx);
  if (directorWl) return directorWl;
  return ctx?.tenant ?? 'default';
}

export function resolveWhitelabelForMutation(ctx: any, wlArg?: string | null): string {
  if (shouldSkipTenantFiltering(ctx)) {
    return wlArg ?? ctx?.whitelabelId ?? ctx?.whitelabel?.id ?? 'default';
  }
  const directorWl = getEffectiveTenantForDirector(ctx);
  if (directorWl) return directorWl;
  return ctx?.whitelabelId ?? ctx?.whitelabel?.id ?? 'default';
}

export const snapshotHealthMutationResolvers = {
  enqueueSnapshotForReportingDay: async (
    _: unknown,
    args: { tenant?: string | null; whitelabelId?: string | null; reportingDay: string; currency: string },
    ctx: any,
  ) => {
    requireSnapshotHealthTrigger(ctx);
    const tenant = resolveTenantForMutation(ctx, args.tenant);
    const whitelabelId = resolveWhitelabelForMutation(ctx, args.whitelabelId);
    const tz = await getWhitelabelTimezone(tenant);
    const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
    if (args.reportingDay >= todayStr) {
      throw new Error(`Cannot generate snapshot for ${args.reportingDay} — the day is not yet complete. Only past dates are allowed.`);
    }
    const date = parseDateFrom(args.reportingDay, tz);
    let runId: string | null = null;
    try {
      runId = await insertSnapshotRun({ trigger: 'manual', summaryJson: { reportingDay: args.reportingDay, tenant, whitelabelId } });
      await enqueueSnapshotGeneration(tenant, whitelabelId, date, 'global', args.currency, { runId });
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'success',
          summaryJson: { enqueued: 1 },
        });
      }
      return { success: true, message: 'Snapshot generation enqueued. It will complete shortly. Refresh to see updates.' };
    } catch (e) {
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
      throw e;
    }
  },

  enqueueSnapshotBackfillRange: async (
    _: unknown,
    args: {
      tenant?: string | null;
      whitelabelId?: string | null;
      dateFrom: string;
      dateTo: string;
      currency: string;
    },
    ctx: any,
  ) => {
    requireSnapshotHealthTrigger(ctx);
    const tenant = resolveTenantForMutation(ctx, args.tenant);
    const whitelabelId = resolveWhitelabelForMutation(ctx, args.whitelabelId);
    const tz = await getWhitelabelTimezone(tenant);
    const from = DateTime.fromISO(args.dateFrom, { zone: tz }).startOf('day');
    let to = DateTime.fromISO(args.dateTo, { zone: tz }).startOf('day');
    if (!from.isValid || !to.isValid) {
      throw new Error('Invalid dateFrom or dateTo');
    }
    // Clamp to yesterday — never generate for today (incomplete) or future dates
    const yesterday = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day');
    if (to > yesterday) {
      to = yesterday;
    }
    if (to < from) {
      throw new Error('dateTo must be on or after dateFrom (after clamping to yesterday)');
    }
    const span = Math.floor(to.diff(from, 'days').days) + 1;
    if (span > MAX_BACKFILL_RANGE_DAYS) {
      throw new Error(`Range too large (max ${MAX_BACKFILL_RANGE_DAYS} days)`);
    }

    let runId: string | null = null;
    try {
      runId = await insertSnapshotRun({
        trigger: 'manual',
        summaryJson: { dateFrom: args.dateFrom, dateTo: args.dateTo, tenant, whitelabelId },
      });
      let n = 0;
      for (let d = from; d <= to; d = d.plus({ days: 1 })) {
        await enqueueSnapshotGeneration(tenant, whitelabelId, d.toJSDate(), 'global', args.currency, {
          runId,
        });
        n += 1;
      }
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'success',
          summaryJson: { enqueuedDays: n },
        });
      }
      return { success: true, message: `Enqueued ${n} day(s). Jobs will process shortly. Refresh to see updates.` };
    } catch (e) {
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
      throw e;
    }
  },

  regenerateStaleSnapshot: async (
    _: unknown,
    args: { tenant: string; whitelabelId: string; reportingDay: string; currency: string },
    ctx: any,
  ) => {
    requireSnapshotHealthTrigger(ctx);
    const tenant = resolveTenantForMutation(ctx, args.tenant);
    const whitelabelId = resolveWhitelabelForMutation(ctx, args.whitelabelId);
    const tz = await getWhitelabelTimezone(tenant);
    const date = parseDateFrom(args.reportingDay, tz);
    let runId: string | null = null;
    try {
      runId = await insertSnapshotRun({
        trigger: 'manual',
        summaryJson: {
          reportingDay: args.reportingDay,
          tenant,
          whitelabelId,
          currency: args.currency,
          action: 'regenerateStaleSnapshot',
        },
      });
      const { regenerateSnapshotsForDateAfterRollback } = await import('@/services/reportingSnapshotService.js');
      await regenerateSnapshotsForDateAfterRollback(tenant, whitelabelId, date, 'sports', args.currency);
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'success',
          summaryJson: { regenerated: true },
        });
      }
      return {
        success: true,
        message: 'Sports snapshot and global rollup regenerated for that reporting day.',
      };
    } catch (e) {
      if (runId) {
        await finishSnapshotRun({
          id: runId,
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }
      throw e;
    }
  },
};
