import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { isDayString } from '@/ui/components/istDate'
import type { StatHue } from '@/ui/components/Stat'
import type { StatusPillTone } from '@/ui/components/StatusPill'

/* The React-free logic of /reporting/snapshot-health (W3 Task 126). Every rule here is the legacy
   page's own, moved out of SnapshotHealthPage.tsx and its four components so it can be tested; where
   a rule changed on purpose the function says so and the task record names it. */

export type SnapshotHealthSummary = {
  nextRunAtIso: string
  snapshotTimezone: string
  runAtLocalTime: string
  healthCheckCron: string
  dailyLookbackDays: number
  backfillLookbackDays: number
  errorsLast24h: number
  /** Present after backend deploy that adds snapshot gap warnings metric */
  backfillGapWarningsLast24h?: number
  missingDaysCount: number
  lastSchedulePublishAt?: string | null
  lastScheduleFailureAt?: string | null
  lastScheduleFailureMessage?: string | null
  lastJobCompleteAt?: string | null
  lastDailyScheduleRunAt?: string | null
  lastDailyScheduleRunStatus?: string | null
  lastHealthBackfillRunAt?: string | null
  lastHealthBackfillRunStatus?: string | null
}

export type MissingRow = {
  tenant: string
  whitelabelId: string
  currency: string
  reportingDay: string
  timezone: string
}

export type StaleSnapshotRow = {
  tenant: string
  whitelabelId: string
  currency: string
  reportingDay: string
  timezone: string
  staleBetCount: number
  snapshotCreatedAt: string
  latestSettledAt: string
}

export type RunRow = {
  id: string
  trigger: string
  status: string
  startedAt: string
  finishedAt?: string | null
  summaryJson?: unknown
  errorMessage?: string | null
}

export type EventRow = {
  id: string
  runId?: string | null
  occurredAt: string
  level: string
  eventType: string
  tenant?: string | null
  whitelabelId?: string | null
  currency?: string | null
  reportingDay?: string | null
  snapshotDateUtc?: string | null
  reportingDayLabel?: string | null
  timezoneNote?: string | null
  domain?: string | null
  message?: string | null
  detailJson?: unknown
}

export type PgBossJobCountRow = { name: string; state: string; count: number }
export type PgBossScheduleRow = { name: string; cron?: string | null; timezone?: string | null }

/* ---------- access ---------- */

/** The legacy Super Admin test, unchanged: an exact name, `super_admin`, or any role naming both words. */
export function isSuperAdminRole(roles: readonly unknown[]): boolean {
  return roles.some(
    (r) =>
      r === 'Super Admin' ||
      (typeof r === 'string' && r.toLowerCase() === 'super_admin') ||
      (typeof r === 'string' && r.toLowerCase().includes('super') && r.toLowerCase().includes('admin')),
  )
}

/** Snapshot health is only for Super Admin in core mode; in whitelabel mode the page leaves for /overview. */
export function leavesForWhitelabel(isSuperAdmin: boolean, directorMode: string | undefined): boolean {
  return isSuperAdmin && directorMode === 'whitelabel'
}

/* ---------- summary ---------- */

export type PipelineStatusKey = 'healthy' | 'warning' | 'critical'

export interface PipelineStatus {
  key: PipelineStatusKey
  label: string
  tone: StatusPillTone
}

const PIPELINE_STATUS: Record<PipelineStatusKey, PipelineStatus> = {
  healthy: { key: 'healthy', label: 'Healthy', tone: 'ok' },
  warning: { key: 'warning', label: 'Attention needed', tone: 'warn' },
  critical: { key: 'critical', label: 'Issues detected', tone: 'neg' },
}

export function hasScheduleProblem(summary?: SnapshotHealthSummary | null): boolean {
  return !!(summary?.lastScheduleFailureAt && summary?.lastScheduleFailureMessage)
}

/** Errors in the last day are critical; missing days or a failed schedule publish need attention. */
export function pipelineStatus(summary?: SnapshotHealthSummary | null): PipelineStatus {
  const hasErrors = (summary?.errorsLast24h ?? 0) > 0
  const hasMissing = (summary?.missingDaysCount ?? 0) > 0
  const key: PipelineStatusKey = hasErrors
    ? 'critical'
    : hasMissing || hasScheduleProblem(summary)
      ? 'warning'
      : 'healthy'
  return PIPELINE_STATUS[key]
}

const MINUTE_FORMAT = 'yyyy-MM-dd HH:mm'

/**
 * The next daily run as wall time in the snapshot timezone (`UTC` when none is configured), as the
 * legacy `dayjs(iso).tz(zone).format('YYYY-MM-DD HH:mm')` printed it. Named change: an unreadable
 * instant or timezone shows `—` where dayjs threw and took the page down.
 */
export function formatNextRunLocal(nextRunAtIso?: string | null, snapshotTimezone?: string | null): string {
  if (!nextRunAtIso) return '—'
  const instant = new Date(nextRunAtIso).getTime()
  if (Number.isNaN(instant)) return '—'
  try {
    return format(new TZDate(instant, snapshotTimezone || 'UTC'), MINUTE_FORMAT)
  } catch {
    return '—'
  }
}

/** The last completed job in the browser's own zone, as the legacy `dayjs(iso).format(...)` did. */
export function formatLastJobComplete(iso?: string | null): string {
  if (!iso) return '—'
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return '—'
  return format(instant, MINUTE_FORMAT)
}

export function nextRunNote(summary: SnapshotHealthSummary): string {
  return `TZ ${summary.snapshotTimezone} · cron local ${summary.runAtLocalTime}`
}

export const ERRORS_NOTE = 'Scoped to your tenant / whitelabel where applicable'

export function missingDaysNote(summary: SnapshotHealthSummary): string {
  return `Lookback ${summary.backfillLookbackDays}d · daily window ${summary.dailyLookbackDays}d${
    (summary.backfillGapWarningsLast24h ?? 0) > 0
      ? ` · ${summary.backfillGapWarningsLast24h} backfill gap warning(s) 24h`
      : ''
  }`
}

export function lastJobNote(summary: SnapshotHealthSummary): string {
  return hasScheduleProblem(summary)
    ? `Schedule issue: ${summary.lastScheduleFailureMessage ?? ''}`
    : `Health cron: ${summary.healthCheckCron}`
}

export interface SummaryHues {
  nextRun: StatHue
  errors: StatHue
  missing: StatHue
  lastJob: StatHue
}

/**
 * The legacy tile colours on the kit ramp: blue, red when there are errors, yellow (amber) when days are
 * missing, red or green for the last job. The kit has no grey tile, so the legacy grey becomes indigo.
 */
export function summaryHues(summary: SnapshotHealthSummary): SummaryHues {
  return {
    nextRun: 'blu',
    errors: summary.errorsLast24h > 0 ? 'red' : 'ind',
    missing: summary.missingDaysCount > 0 ? 'amb' : 'ind',
    lastJob: hasScheduleProblem(summary) ? 'red' : 'grn',
  }
}

/* ---------- gaps and stale days ---------- */

type DayKeyed = Pick<MissingRow, 'tenant' | 'whitelabelId' | 'reportingDay' | 'currency'>

export function snapshotRowKey(row: DayKeyed): string {
  return `${row.tenant}:${row.whitelabelId}:${row.reportingDay}:${row.currency}`
}

/** Every row's button reads "Fix"; its accessible name says which day it fixes (it starts with "Fix"). */
export function fixActionLabel(row: DayKeyed): string {
  return `Fix ${row.reportingDay} · ${row.tenant} · ${row.currency}`
}

/** The stale table's instants, cut to `yyyy-MM-dd HH:mm:ss` as the legacy cells did. */
export function formatSnapshotInstant(value?: string | null): string {
  return value?.slice(0, 19)?.replace('T', ' ') ?? ''
}

export function gapsSummary(total: number): string {
  return `${total} gap(s)`
}

export function staleSummary(total: number): string {
  return `${total} stale day(s)`
}

export function regenerateAllTitle(count: number): string {
  return `Regenerate all ${count} stale day(s)?`
}

/** antd's table defaults: 20 rows a page, with its standard size changer. */
export const TABLE_PAGE_SIZE = 20
export const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

export function clampPage(page: number, total: number, pageSize: number): number {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / size))
  return Math.min(Math.max(1, Math.trunc(page) || 1), pages)
}

/** The rows of one client-side page; an out-of-range page shows the last one, as antd did. */
export function pageRows<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const current = clampPage(page, rows.length, size)
  return rows.slice((current - 1) * size, current * size)
}

export const BACKFILL_RANGE_REQUIRED = 'Pick a range'

export interface BackfillRangeDraft {
  from: string
  to: string
}

export interface BackfillRange {
  dateFrom: string
  dateTo: string
}

/**
 * The two native date fields as the range the mutation sends. Both days are required; a reversed pair
 * is put in order, as antd's RangePicker ordered its ends. The days go out as typed (`yyyy-MM-dd`), as
 * the legacy `format('YYYY-MM-DD')` sent them.
 */
export function resolveBackfillRange(draft: BackfillRangeDraft): BackfillRange | null {
  if (!isDayString(draft.from) || !isDayString(draft.to)) return null
  return draft.from <= draft.to
    ? { dateFrom: draft.from, dateTo: draft.to }
    : { dateFrom: draft.to, dateTo: draft.from }
}

/* ---------- runs, events and pg-boss ---------- */

export function dedupeNodesById<T extends { id: string }>(nodes: T[]): T[] {
  const map = new Map<string, T>()
  for (const n of nodes) {
    map.set(n.id, n)
  }
  return [...map.values()]
}

/**
 * Run status tones: failed red, running blue, partial amber, anything else green. Named change: the run
 * drawer's tag uses this map too, so a partial run reads amber there (the legacy drawer showed it green).
 */
export function runStatusTone(status: string): StatusPillTone {
  if (status === 'failed') return 'neg'
  if (status === 'running') return 'info'
  if (status === 'partial') return 'warn'
  return 'ok'
}

export function eventLevelTone(level: string): StatusPillTone {
  if (level === 'error') return 'neg'
  if (level === 'warn') return 'warn'
  return 'neutral'
}

export function formatRunSummary(summaryJson: unknown): string {
  return summaryJson != null ? JSON.stringify(summaryJson) : '—'
}

/** The hint behind an event's reporting day; empty means no hint is offered. */
export function reportingDayHint(row: Pick<EventRow, 'timezoneNote' | 'reportingDayLabel'>): string {
  return row.timezoneNote ?? row.reportingDayLabel ?? ''
}

export function runEventsLabel(run: Pick<RunRow, 'trigger'>, startedLabel: string): string {
  return `Events for ${run.trigger} run started ${startedLabel}`
}
