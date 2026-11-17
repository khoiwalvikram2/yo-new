import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  BACKFILL_RANGE_REQUIRED,
  ERRORS_NOTE,
  TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  clampPage,
  dedupeNodesById,
  eventLevelTone,
  fixActionLabel,
  formatLastJobComplete,
  formatNextRunLocal,
  formatRunSummary,
  formatSnapshotInstant,
  gapsSummary,
  hasScheduleProblem,
  isSuperAdminRole,
  lastJobNote,
  leavesForWhitelabel,
  missingDaysNote,
  nextRunNote,
  pageRows,
  pipelineStatus,
  regenerateAllTitle,
  reportingDayHint,
  resolveBackfillRange,
  backfillRefusalMessage,
  backfillTargetText,
  runEventsLabel,
  runStatusTone,
  snapshotRowKey,
  staleSummary,
  summaryHues,
  type SnapshotHealthSummary,
} from './snapshotHealthModel'

function summary(overrides: Partial<SnapshotHealthSummary> = {}): SnapshotHealthSummary {
  return {
    nextRunAtIso: '2026-10-07T20:30:00.000Z',
    snapshotTimezone: 'Asia/Kolkata',
    runAtLocalTime: '02:00',
    healthCheckCron: '15 * * * *',
    dailyLookbackDays: 3,
    backfillLookbackDays: 30,
    errorsLast24h: 0,
    backfillGapWarningsLast24h: 0,
    missingDaysCount: 0,
    lastScheduleFailureAt: null,
    lastScheduleFailureMessage: null,
    lastJobCompleteAt: '2026-10-06T20:31:12.000Z',
    ...overrides,
  }
}

/** The browser-local wall time, built from Date's own getters so the oracle is not date-fns. */
function localMinute(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

describe('snapshotHealthModel', () => {
  test('recognises a Super Admin role exactly as the legacy page did', () => {
    assert.equal(isSuperAdminRole(['Super Admin']), true)
    assert.equal(isSuperAdminRole(['super_admin']), true)
    assert.equal(isSuperAdminRole(['SUPER_ADMIN']), true)
    assert.equal(isSuperAdminRole(['Regional Super-Administrator']), true)
    assert.equal(isSuperAdminRole(['Admin', 'Support']), false)
    assert.equal(isSuperAdminRole([null, 42, { role: 'Super Admin' }]), false)
    assert.equal(isSuperAdminRole([]), false)

    assert.equal(leavesForWhitelabel(true, 'whitelabel'), true)
    assert.equal(leavesForWhitelabel(true, 'core'), false)
    assert.equal(leavesForWhitelabel(false, 'whitelabel'), false)
    assert.equal(leavesForWhitelabel(true, undefined), false)
  })

  test('pipeline status: errors are critical, missing days or a failed publish need attention', () => {
    assert.deepEqual(pipelineStatus(summary()), { key: 'healthy', label: 'Healthy', tone: 'ok' })
    assert.deepEqual(pipelineStatus(null), { key: 'healthy', label: 'Healthy', tone: 'ok' })
    assert.equal(pipelineStatus(summary({ missingDaysCount: 2 })).label, 'Attention needed')
    assert.equal(pipelineStatus(summary({ missingDaysCount: 2 })).tone, 'warn')
    assert.equal(
      pipelineStatus(summary({ lastScheduleFailureAt: '2026-10-06T00:00:00Z', lastScheduleFailureMessage: 'boom' })).key,
      'warning',
    )
    // a failure time without a message is not a schedule problem
    assert.equal(hasScheduleProblem(summary({ lastScheduleFailureAt: '2026-10-06T00:00:00Z' })), false)
    assert.equal(pipelineStatus(summary({ lastScheduleFailureAt: '2026-10-06T00:00:00Z' })).key, 'healthy')
    assert.deepEqual(pipelineStatus(summary({ errorsLast24h: 1, missingDaysCount: 4 })), {
      key: 'critical',
      label: 'Issues detected',
      tone: 'neg',
    })
  })

  test('next run is wall time in the snapshot timezone, across offsets and a DST change', () => {
    const iso = '2026-10-07T20:30:00.000Z'
    assert.equal(formatNextRunLocal(iso, 'Asia/Kolkata'), '2026-10-08 02:00')
    assert.equal(formatNextRunLocal(iso, 'Asia/Kathmandu'), '2026-10-08 02:15')
    assert.equal(formatNextRunLocal(iso, 'America/New_York'), '2026-10-07 16:30')
    assert.equal(formatNextRunLocal(iso, 'UTC'), '2026-10-07 20:30')
    // New York springs forward at 07:00Z on 8 March 2026: 07:30Z is 03:30 EDT, not 02:30
    assert.equal(formatNextRunLocal('2026-03-08T07:30:00.000Z', 'America/New_York'), '2026-03-08 03:30')
    // no configured zone falls back to UTC, as before
    assert.equal(formatNextRunLocal(iso, ''), '2026-10-07 20:30')
    assert.equal(formatNextRunLocal(iso, null), '2026-10-07 20:30')
    assert.equal(formatNextRunLocal('', 'Asia/Kolkata'), '—')
    assert.equal(formatNextRunLocal(null, 'Asia/Kolkata'), '—')
    // named change: unreadable input shows a dash instead of throwing
    assert.equal(formatNextRunLocal('not a date', 'Asia/Kolkata'), '—')
    assert.equal(formatNextRunLocal(iso, 'Mars/Olympus_Mons'), '—')
  })

  test('last job complete is browser-local minute time', () => {
    for (const iso of ['2026-10-06T20:31:12.000Z', '2026-01-01T00:00:00.000Z', '2026-03-29T01:30:00.000Z']) {
      assert.equal(formatLastJobComplete(iso), localMinute(iso))
    }
    assert.equal(formatLastJobComplete(null), '—')
    assert.equal(formatLastJobComplete(''), '—')
    assert.equal(formatLastJobComplete('garbage'), '—')
  })

  test('tile notes keep the legacy copy word for word', () => {
    assert.equal(nextRunNote(summary()), 'TZ Asia/Kolkata · cron local 02:00')
    assert.equal(ERRORS_NOTE, 'Scoped to your tenant / whitelabel where applicable')
    assert.equal(missingDaysNote(summary()), 'Lookback 30d · daily window 3d')
    assert.equal(missingDaysNote(summary({ backfillGapWarningsLast24h: undefined })), 'Lookback 30d · daily window 3d')
    assert.equal(
      missingDaysNote(summary({ backfillGapWarningsLast24h: 3 })),
      'Lookback 30d · daily window 3d · 3 backfill gap warning(s) 24h',
    )
    assert.equal(lastJobNote(summary()), 'Health cron: 15 * * * *')
    assert.equal(
      lastJobNote(summary({ lastScheduleFailureAt: '2026-10-06T00:00:00Z', lastScheduleFailureMessage: 'publish failed' })),
      'Schedule issue: publish failed',
    )
  })

  test('tile hues follow the legacy colours on the kit ramp', () => {
    assert.deepEqual(summaryHues(summary()), { nextRun: 'blu', errors: 'ind', missing: 'ind', lastJob: 'grn' })
    assert.deepEqual(
      summaryHues(summary({
        errorsLast24h: 2,
        missingDaysCount: 1,
        lastScheduleFailureAt: '2026-10-06T00:00:00Z',
        lastScheduleFailureMessage: 'x',
      })),
      { nextRun: 'blu', errors: 'red', missing: 'amb', lastJob: 'red' },
    )
  })

  test('row keys, action names and the cut instants', () => {
    const row = { tenant: 'core', whitelabelId: 'wl-7', reportingDay: '2026-10-01', currency: 'INR' }
    assert.equal(snapshotRowKey(row), 'core:wl-7:2026-10-01:INR')
    assert.equal(fixActionLabel(row), 'Fix 2026-10-01 · core · INR')
    assert.ok(fixActionLabel(row).startsWith('Fix'))
    assert.equal(formatSnapshotInstant('2026-10-01T18:29:59.999Z'), '2026-10-01 18:29:59')
    assert.equal(formatSnapshotInstant('2026-10-01'), '2026-10-01')
    assert.equal(formatSnapshotInstant(null), '')
    assert.equal(formatSnapshotInstant(undefined), '')
  })

  test('table copy and antd page defaults', () => {
    assert.equal(gapsSummary(1), '1 gap(s)')
    assert.equal(staleSummary(12), '12 stale day(s)')
    assert.equal(regenerateAllTitle(3), 'Regenerate all 3 stale day(s)?')
    assert.equal(TABLE_PAGE_SIZE, 20)
    assert.deepEqual([...TABLE_PAGE_SIZE_OPTIONS], [10, 20, 50, 100])
  })

  test('client paging clamps to the last page and never to zero', () => {
    const rows = Array.from({ length: 45 }, (_, index) => index)
    assert.deepEqual(pageRows(rows, 1, 20), rows.slice(0, 20))
    assert.deepEqual(pageRows(rows, 3, 20), rows.slice(40))
    assert.deepEqual(pageRows(rows, 9, 20), rows.slice(40))
    assert.deepEqual(pageRows(rows, 0, 20), rows.slice(0, 20))
    assert.deepEqual(pageRows([], 4, 20), [])
    assert.equal(clampPage(5, 45, 20), 3)
    assert.equal(clampPage(2, 0, 20), 1)
    assert.equal(clampPage(Number.NaN, 45, 20), 1)
  })

  test('a refused backfill says why, and the form names the book it backfills (F-REP-11)', () => {
    assert.equal(backfillRefusalMessage(new Error('Range too large (max 31 days)')), 'Range too large (max 31 days)')
    assert.equal(backfillRefusalMessage({}), 'The backfill could not be queued. Please try again.')
    assert.equal(backfillRefusalMessage(null), 'The backfill could not be queued. Please try again.')
    assert.equal(
      backfillTargetText({ tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com', currency: 'INR' }),
      'Backfills grandwinn-com (INR), the first tenant listed below; at most 31 days at a time.',
    )
  })

  test('backfill range needs both days and orders a reversed pair', () => {
    assert.equal(BACKFILL_RANGE_REQUIRED, 'Pick a range')
    assert.equal(resolveBackfillRange({ from: '', to: '' }), null)
    assert.equal(resolveBackfillRange({ from: '2026-09-01', to: '' }), null)
    assert.equal(resolveBackfillRange({ from: '', to: '2026-09-01' }), null)
    assert.equal(resolveBackfillRange({ from: '2026-02-30', to: '2026-03-02' }), null)
    assert.deepEqual(resolveBackfillRange({ from: '2026-09-01', to: '2026-09-30' }), {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })
    assert.deepEqual(resolveBackfillRange({ from: '2026-09-30', to: '2026-09-01' }), {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })
    assert.deepEqual(resolveBackfillRange({ from: '2026-09-05', to: '2026-09-05' }), {
      dateFrom: '2026-09-05',
      dateTo: '2026-09-05',
    })
  })

  test('merged connection pages keep one node per id, the newest copy in the first position', () => {
    const merged = dedupeNodesById([
      { id: 'a', v: 1 },
      { id: 'b', v: 1 },
      { id: 'a', v: 2 },
      { id: 'c', v: 1 },
    ])
    assert.deepEqual(merged, [
      { id: 'a', v: 2 },
      { id: 'b', v: 1 },
      { id: 'c', v: 1 },
    ])
  })

  test('run and event tones, summaries and labels', () => {
    assert.equal(runStatusTone('failed'), 'neg')
    assert.equal(runStatusTone('running'), 'info')
    assert.equal(runStatusTone('partial'), 'warn')
    assert.equal(runStatusTone('completed'), 'ok')
    assert.equal(runStatusTone('anything'), 'ok')
    assert.equal(eventLevelTone('error'), 'neg')
    assert.equal(eventLevelTone('warn'), 'warn')
    assert.equal(eventLevelTone('info'), 'neutral')
    assert.equal(formatRunSummary(null), '—')
    assert.equal(formatRunSummary(undefined), '—')
    assert.equal(formatRunSummary({ days: 2, ok: true }), '{"days":2,"ok":true}')
    assert.equal(formatRunSummary(0), '0')
    assert.equal(reportingDayHint({ timezoneNote: 'IST day', reportingDayLabel: 'label' }), 'IST day')
    assert.equal(reportingDayHint({ timezoneNote: null, reportingDayLabel: 'label' }), 'label')
    assert.equal(reportingDayHint({ timezoneNote: null, reportingDayLabel: null }), '')
    assert.equal(runEventsLabel({ trigger: 'daily' }, '07 Oct 2026, 02:00'), 'Events for daily run started 07 Oct 2026, 02:00')
  })
})
