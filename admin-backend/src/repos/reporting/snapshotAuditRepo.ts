import { db } from '@/db/client.js';
import {
  reportingSnapshotRuns,
  reportingSnapshotEvents,
  reportingDailySnapshots,
  sportsBets,
  casinoBets,
  matkaBets,
} from '@shared/db/schema.js';
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { formatDateInTz } from '@src/shared/dateUtils.js';
import {
  decodeSnapshotEventCursor,
  decodeSnapshotRunCursor,
  encodeSnapshotEventCursor,
  encodeSnapshotRunCursor,
} from './snapshotAuditCursorCodec.js';

export {
  decodeSnapshotEventCursor,
  decodeSnapshotRunCursor,
  encodeSnapshotEventCursor,
  encodeSnapshotRunCursor,
};

export type SnapshotRunTrigger =
  | 'daily_schedule'
  | 'health_backfill'
  | 'manual'
  | 'startup_backfill'
  | 'direct_enqueue';

export type SnapshotRunStatus = 'running' | 'success' | 'partial' | 'failed';

export type SnapshotEventLevel = 'info' | 'warn' | 'error';

export interface InsertSnapshotEventInput {
  runId?: string | null;
  level?: SnapshotEventLevel;
  eventType: string;
  tenant?: string | null;
  whitelabelId?: string | null;
  currency?: string | null;
  reportingDay?: string | null;
  snapshotDateUtc?: Date | null;
  domain?: string | null;
  pgBossJobId?: string | null;
  singletonKey?: string | null;
  message?: string | null;
  detailJson?: Record<string, unknown> | null;
}

export async function insertSnapshotRun(params: {
  trigger: SnapshotRunTrigger;
  summaryJson?: Record<string, unknown> | null;
}): Promise<string> {
  const [row] = await db
    .insert(reportingSnapshotRuns)
    .values({
      trigger: params.trigger,
      status: 'running',
      summaryJson: params.summaryJson ?? null,
    })
    .returning({ id: reportingSnapshotRuns.id });
  return row.id;
}

export async function finishSnapshotRun(params: {
  id: string;
  status: SnapshotRunStatus;
  summaryJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
}): Promise<void> {
  await db
    .update(reportingSnapshotRuns)
    .set({
      status: params.status,
      finishedAt: new Date(),
      summaryJson: params.summaryJson ?? undefined,
      errorMessage: params.errorMessage ?? null,
    })
    .where(eq(reportingSnapshotRuns.id, params.id));
}

export async function insertSnapshotEvent(input: InsertSnapshotEventInput): Promise<string> {
  const [row] = await db
    .insert(reportingSnapshotEvents)
    .values({
      runId: input.runId ?? null,
      level: input.level ?? 'info',
      eventType: input.eventType,
      tenant: input.tenant ?? null,
      whitelabelId: input.whitelabelId ?? null,
      currency: input.currency ?? null,
      reportingDay: input.reportingDay ?? null,
      snapshotDateUtc: input.snapshotDateUtc ?? null,
      domain: input.domain ?? null,
      pgBossJobId: input.pgBossJobId ?? null,
      singletonKey: input.singletonKey ?? null,
      message: input.message ?? null,
      detailJson: input.detailJson ?? null,
    })
    .returning({ id: reportingSnapshotEvents.id });
  return row.id;
}

export interface ListRunsFilter {
  tenant?: string | null;
  trigger?: string | null;
  limit?: number;
  offset?: number;
  /** When set, only runs that have at least one child event matching these columns. */
  eventScope?: { tenant?: string; whitelabelId?: string } | null;
}

function runMatchesEventScope(scope: { tenant?: string; whitelabelId?: string }) {
  const parts = [sql`e.run_id = ${reportingSnapshotRuns.id}`];
  if (scope.tenant) {
    parts.push(sql`e.tenant = ${scope.tenant}`);
  }
  if (scope.whitelabelId) {
    parts.push(sql`e.whitelabel_id = ${scope.whitelabelId}`);
  }
  return sql`exists (select 1 from reporting_snapshot_events e where ${sql.join(parts, sql` and `)})`;
}

export async function listSnapshotRuns(filter: ListRunsFilter) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = filter.offset ?? 0;
  const conditions = [];
  if (filter.trigger) {
    conditions.push(eq(reportingSnapshotRuns.trigger, filter.trigger));
  }
  if (filter.eventScope && (filter.eventScope.tenant || filter.eventScope.whitelabelId)) {
    conditions.push(runMatchesEventScope(filter.eventScope));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;
  return db
    .select()
    .from(reportingSnapshotRuns)
    .where(whereClause)
    .orderBy(desc(reportingSnapshotRuns.startedAt))
    .limit(limit)
    .offset(offset);
}

export interface ListEventsFilter {
  tenant?: string | null;
  whitelabelId?: string | null;
  runId?: string | null;
  level?: SnapshotEventLevel | null;
  errorsOnly?: boolean;
  eventType?: string | null;
  limit?: number;
  offset?: number;
}

export async function listSnapshotEvents(filter: ListEventsFilter) {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = filter.offset ?? 0;
  const conditions = [];
  if (filter.tenant != null && filter.tenant !== '') {
    conditions.push(eq(reportingSnapshotEvents.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingSnapshotEvents.whitelabelId, filter.whitelabelId));
  }
  if (filter.runId) {
    conditions.push(eq(reportingSnapshotEvents.runId, filter.runId));
  }
  if (filter.level) {
    conditions.push(eq(reportingSnapshotEvents.level, filter.level));
  }
  if (filter.errorsOnly) {
    conditions.push(eq(reportingSnapshotEvents.level, 'error'));
  }
  if (filter.eventType) {
    conditions.push(eq(reportingSnapshotEvents.eventType, filter.eventType));
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;
  return db
    .select()
    .from(reportingSnapshotEvents)
    .where(whereClause)
    .orderBy(desc(reportingSnapshotEvents.occurredAt))
    .limit(limit)
    .offset(offset);
}

export async function countSnapshotEventsSince(params: {
  since: Date;
  level?: SnapshotEventLevel;
  eventType?: string | null;
  tenant?: string | null;
  whitelabelId?: string | null;
}): Promise<number> {
  const conditions = [gte(reportingSnapshotEvents.occurredAt, params.since)];
  if (params.level) {
    conditions.push(eq(reportingSnapshotEvents.level, params.level));
  }
  if (params.eventType) {
    conditions.push(eq(reportingSnapshotEvents.eventType, params.eventType));
  }
  if (params.tenant) {
    conditions.push(eq(reportingSnapshotEvents.tenant, params.tenant));
  }
  if (params.whitelabelId) {
    conditions.push(eq(reportingSnapshotEvents.whitelabelId, params.whitelabelId));
  }
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reportingSnapshotEvents)
    .where(and(...conditions));
  return Number(row?.c ?? 0);
}

/** Platform-wide count (ignores tenant/wl) — for pipeline-level warnings with null dimensions on the event row. */
export async function countSnapshotEventsByTypeSinceGlobal(params: {
  since: Date;
  eventType: string;
}): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(reportingSnapshotEvents)
    .where(
      and(
        gte(reportingSnapshotEvents.occurredAt, params.since),
        eq(reportingSnapshotEvents.eventType, params.eventType),
      ),
    );
  return Number(row?.c ?? 0);
}

export async function lastSnapshotRunByTrigger(
  trigger: string,
  eventScope?: { tenant?: string; whitelabelId?: string } | null,
) {
  const conditions = [eq(reportingSnapshotRuns.trigger, trigger)];
  if (eventScope && (eventScope.tenant || eventScope.whitelabelId)) {
    conditions.push(runMatchesEventScope(eventScope));
  }
  const [row] = await db
    .select()
    .from(reportingSnapshotRuns)
    .where(and(...conditions))
    .orderBy(desc(reportingSnapshotRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export async function lastSnapshotEventOfType(
  eventType: string,
  scope?: { tenant?: string; whitelabelId?: string } | null,
): Promise<{
  occurredAt: Date;
  level: string;
  message: string | null;
  detailJson: unknown;
} | null> {
  const conditions = [eq(reportingSnapshotEvents.eventType, eventType)];
  if (scope?.tenant) {
    conditions.push(eq(reportingSnapshotEvents.tenant, scope.tenant));
  }
  if (scope?.whitelabelId) {
    conditions.push(eq(reportingSnapshotEvents.whitelabelId, scope.whitelabelId));
  }
  const [row] = await db
    .select({
      occurredAt: reportingSnapshotEvents.occurredAt,
      level: reportingSnapshotEvents.level,
      message: reportingSnapshotEvents.message,
      detailJson: reportingSnapshotEvents.detailJson,
    })
    .from(reportingSnapshotEvents)
    .where(and(...conditions))
    .orderBy(desc(reportingSnapshotEvents.occurredAt))
    .limit(1);
  if (!row) return null;
  return {
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt),
    level: row.level,
    message: row.message,
    detailJson: row.detailJson,
  };
}

/** Same combo discovery as snapshot scheduler (exported for health GraphQL). */
export async function getSnapshotActiveCombinations(): Promise<
  Array<{ tenant: string; whitelabelId: string; currency: string }>
> {
  const uniqueMap = new Map<string, { tenant: string; whitelabelId: string; currency: string }>();

  const addCombos = (
    combos: Array<{ tenant: string | null; whitelabelId: string | null; currency: string | null }>,
  ) => {
    for (const combo of combos) {
      if (!combo.tenant || !combo.whitelabelId) continue;
      const currency = combo.currency || 'USD';
      const key = `${combo.tenant}:${combo.whitelabelId}:${currency}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          tenant: combo.tenant,
          whitelabelId: combo.whitelabelId,
          currency,
        });
      }
    }
  };

  try {
    const sportsCombos = await db
      .selectDistinct({
        tenant: sportsBets.tenant,
        whitelabelId: sportsBets.whitelabelId,
        currency: sportsBets.currency,
      })
      .from(sportsBets)
      .where(sql`${sportsBets.currency} IS NOT NULL`);
    addCombos(sportsCombos);
  } catch {
    /* ignore */
  }

  try {
    const casinoCombos = await db
      .selectDistinct({
        tenant: casinoBets.tenant,
        whitelabelId: casinoBets.whitelabelId,
        currency: casinoBets.currency,
      })
      .from(casinoBets);
    addCombos(casinoCombos);
  } catch {
    /* ignore */
  }

  try {
    const matkaCombos = await db
      .selectDistinct({
        tenant: matkaBets.tenant,
        whitelabelId: matkaBets.whitelabelId,
        currency: matkaBets.currency,
      })
      .from(matkaBets);
    addCombos(matkaCombos);
  } catch {
    /* ignore */
  }

  const combinations = Array.from(uniqueMap.values());
  if (combinations.length === 0) {
    return [{ tenant: 'example-com', whitelabelId: 'example-com', currency: 'USD' }];
  }
  return combinations;
}

async function getTenantTimezone(tenantId: string): Promise<string> {
  try {
    const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
    const tz = await getWhitelabelTimezone(tenantId);
    return tz && tz.trim() ? tz.trim() : 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

export interface MissingSnapshotDayRow {
  tenant: string;
  whitelabelId: string;
  currency: string;
  reportingDay: string;
  timezone: string;
}

/**
 * Dates (yyyy-MM-dd in tenant TZ) missing a global rollup row, same definition as scheduler backfill.
 */
export async function listMissingSnapshotDays(params: {
  lookbackDays: number;
  tenant?: string | null;
  whitelabelId?: string | null;
  currency?: string | null;
}): Promise<MissingSnapshotDayRow[]> {
  const lookback = Math.min(Math.max(params.lookbackDays, 1), 90);
  const combinations = await getSnapshotActiveCombinations();
  const filtered = combinations.filter((c) => {
    if (params.tenant && c.tenant !== params.tenant) return false;
    if (params.whitelabelId && c.whitelabelId !== params.whitelabelId) return false;
    if (params.currency && c.currency !== params.currency) return false;
    return true;
  });

  const out: MissingSnapshotDayRow[] = [];

  for (const combo of filtered) {
    const tz = await getTenantTimezone(combo.tenant);
    const yesterday = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day');
    const lookbackStart = yesterday.minus({ days: lookback - 1 });

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
    while (cursor <= yesterday) {
      const dateStr = cursor.toFormat('yyyy-MM-dd');
      if (!existingDateSet.has(dateStr)) {
        out.push({
          tenant: combo.tenant,
          whitelabelId: combo.whitelabelId,
          currency: combo.currency,
          reportingDay: dateStr,
          timezone: tz,
        });
      }
      cursor = cursor.plus({ days: 1 });
    }
  }

  return out;
}

function escapeIanaTimezoneForSql(tz: string): string {
  const t = tz?.trim() || 'Asia/Kolkata';
  return /^[A-Za-z0-9_/+-]+$/.test(t) ? t : 'Asia/Kolkata';
}

export interface StaleSportsBetDayRow {
  tenant: string;
  whitelabelId: string;
  currency: string;
  reportingDay: string;
  timezone: string;
  staleBetCount: number;
  snapshotCreatedAt: Date;
  latestSettledAt: Date;
}

/**
 * Reporting days where the sports aggregate snapshot row was written before at least one bet
 * on that day was settled (late result declaration / stale snapshot).
 */
export async function listStaleSportsBetDays(params: {
  lookbackDays: number;
  tenant?: string | null;
  whitelabelId?: string | null;
  currency?: string | null;
}): Promise<StaleSportsBetDayRow[]> {
  const lookback = Math.min(Math.max(params.lookbackDays, 1), 90);
  const combinations = await getSnapshotActiveCombinations();
  const filtered = combinations.filter((c) => {
    if (params.tenant && c.tenant !== params.tenant) return false;
    if (params.whitelabelId && c.whitelabelId !== params.whitelabelId) return false;
    if (params.currency && c.currency !== params.currency) return false;
    return true;
  });

  const out: StaleSportsBetDayRow[] = [];

  for (const combo of filtered) {
    const tz = escapeIanaTimezoneForSql(await getTenantTimezone(combo.tenant));
    const zoneSql = sql.raw(`'${tz.replace(/'/g, "''")}'`);
    const yesterday = DateTime.now().setZone(tz).minus({ days: 1 }).startOf('day');
    const lookbackStart = yesterday.minus({ days: lookback - 1 });
    const dateFromStr = lookbackStart.toFormat('yyyy-MM-dd');
    const dateToStr = yesterday.toFormat('yyyy-MM-dd');

    const result = await db.execute(sql`
      SELECT
        to_char((b.created_at AT TIME ZONE ${zoneSql})::date, 'YYYY-MM-DD') AS reporting_day,
        COUNT(*)::int AS stale_bet_count,
        MAX(snap.created_at) AS snapshot_created_at,
        MAX(b.settled_at) AS latest_settled_at
      FROM sports_bets b
      INNER JOIN reporting_daily_snapshots snap ON
        snap.tenant = b.tenant
        AND snap.whitelabel_id = b.whitelabel_id
        AND snap.currency = b.currency
        AND snap.domain = 'sports'
        AND snap.sport_id IS NULL
        AND snap.league_id IS NULL
        AND snap.event_id IS NULL
        AND snap.agent_id IS NULL
        AND snap.campaign_id IS NULL
        AND snap.player_id IS NULL
        AND snap.snapshot_date = (
          ((b.created_at AT TIME ZONE ${zoneSql})::date)::timestamp AT TIME ZONE ${zoneSql}
        )
      WHERE b.tenant = ${combo.tenant}
        AND b.whitelabel_id = ${combo.whitelabelId}
        AND b.currency = ${combo.currency}
        AND b.settled_at IS NOT NULL
        AND b.settled_at > snap.created_at
        AND b.status IN ('won', 'lost', 'settled')
        AND b.exclude_from_admin_running = false
        AND (b.created_at AT TIME ZONE ${zoneSql})::date >= ${dateFromStr}::date
        AND (b.created_at AT TIME ZONE ${zoneSql})::date <= ${dateToStr}::date
      GROUP BY 1
      ORDER BY 1 DESC
    `);

    const rows = (result as { rows?: Record<string, unknown>[] }).rows ?? [];
    for (const row of rows) {
      const reportingDay = String(row.reporting_day ?? '');
      const staleBetCount = Number(row.stale_bet_count ?? 0);
      const snapCreated = row.snapshot_created_at;
      const latestSettled = row.latest_settled_at;
      if (!reportingDay || staleBetCount <= 0) continue;
      out.push({
        tenant: combo.tenant,
        whitelabelId: combo.whitelabelId,
        currency: combo.currency,
        reportingDay,
        timezone: tz,
        staleBetCount,
        snapshotCreatedAt:
          snapCreated instanceof Date ? snapCreated : new Date(String(snapCreated)),
        latestSettledAt:
          latestSettled instanceof Date ? latestSettled : new Date(String(latestSettled)),
      });
    }
  }

  out.sort((a, b) => {
    if (a.reportingDay !== b.reportingDay) return b.reportingDay.localeCompare(a.reportingDay);
    return `${a.tenant}:${a.whitelabelId}`.localeCompare(`${b.tenant}:${b.whitelabelId}`);
  });

  return out;
}

export async function listSnapshotRunsConnection(filter: {
  first?: number | null;
  after?: string | null;
  trigger?: string | null;
  eventScope?: { tenant?: string; whitelabelId?: string } | null;
}): Promise<{
  nodes: (typeof reportingSnapshotRuns.$inferSelect)[];
  pageInfo: {
    startCursor: string | null;
    endCursor: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}> {
  const first = Math.min(Math.max(filter.first ?? 20, 1), 100);
  const conditions: SQL[] = [];
  if (filter.trigger) {
    conditions.push(eq(reportingSnapshotRuns.trigger, filter.trigger));
  }
  if (filter.eventScope && (filter.eventScope.tenant || filter.eventScope.whitelabelId)) {
    conditions.push(runMatchesEventScope(filter.eventScope));
  }
  if (filter.after) {
    const { s, i } = decodeSnapshotRunCursor(filter.after);
    const t = new Date(s);
    conditions.push(
      sql`(${reportingSnapshotRuns.startedAt} < ${t} OR (${reportingSnapshotRuns.startedAt} = ${t} AND ${reportingSnapshotRuns.id}::text < ${i}))`,
    );
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(reportingSnapshotRuns)
    .where(whereClause)
    .orderBy(desc(reportingSnapshotRuns.startedAt), desc(reportingSnapshotRuns.id))
    .limit(first + 1);
  const hasNextPage = rows.length > first;
  const page = hasNextPage ? rows.slice(0, first) : rows;
  const startCursor = page[0] ? encodeSnapshotRunCursor({ startedAt: page[0].startedAt, id: page[0].id }) : null;
  const endRow = page[page.length - 1];
  const endCursor = endRow ? encodeSnapshotRunCursor({ startedAt: endRow.startedAt, id: endRow.id }) : null;
  return {
    nodes: page,
    pageInfo: {
      startCursor,
      endCursor,
      hasNextPage,
      hasPreviousPage: !!filter.after,
    },
  };
}

export async function listSnapshotEventsConnection(filter: {
  first?: number | null;
  after?: string | null;
  tenant?: string | null;
  whitelabelId?: string | null;
  runId?: string | null;
  errorsOnly?: boolean;
  eventType?: string | null;
}): Promise<{
  nodes: (typeof reportingSnapshotEvents.$inferSelect)[];
  pageInfo: {
    startCursor: string | null;
    endCursor: string | null;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}> {
  const first = Math.min(Math.max(filter.first ?? 25, 1), 150);
  const conditions: SQL[] = [];
  if (filter.tenant != null && filter.tenant !== '') {
    conditions.push(eq(reportingSnapshotEvents.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingSnapshotEvents.whitelabelId, filter.whitelabelId));
  }
  if (filter.runId) {
    conditions.push(eq(reportingSnapshotEvents.runId, filter.runId));
  }
  if (filter.errorsOnly) {
    conditions.push(eq(reportingSnapshotEvents.level, 'error'));
  }
  if (filter.eventType) {
    conditions.push(eq(reportingSnapshotEvents.eventType, filter.eventType));
  }
  if (filter.after) {
    const { s, i } = decodeSnapshotEventCursor(filter.after);
    const t = new Date(s);
    conditions.push(
      sql`(${reportingSnapshotEvents.occurredAt} < ${t} OR (${reportingSnapshotEvents.occurredAt} = ${t} AND ${reportingSnapshotEvents.id}::text < ${i}))`,
    );
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(reportingSnapshotEvents)
    .where(whereClause)
    .orderBy(desc(reportingSnapshotEvents.occurredAt), desc(reportingSnapshotEvents.id))
    .limit(first + 1);
  const hasNextPage = rows.length > first;
  const page = hasNextPage ? rows.slice(0, first) : rows;
  const startCursor = page[0]
    ? encodeSnapshotEventCursor({ occurredAt: page[0].occurredAt, id: page[0].id })
    : null;
  const endRow = page[page.length - 1];
  const endCursor = endRow
    ? encodeSnapshotEventCursor({ occurredAt: endRow.occurredAt, id: endRow.id })
    : null;
  return {
    nodes: page,
    pageInfo: {
      startCursor,
      endCursor,
      hasNextPage,
      hasPreviousPage: !!filter.after,
    },
  };
}
