import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, renderHook } from '@testing-library/react'
import {
  REPORTING_DATE_PRESET_OPTIONS,
  REPORTING_QUICK_PRESET_OPTIONS,
  computeReportingCustomRange,
  computeReportingDateRange,
  formatReportingDay,
  isReportingDatePreset,
  reportingPeriodLabel,
  reportingPresetPeriod,
  useReportingDateFilter,
  type ReportingDatePreset,
} from './reportingDateFilter'

/* Each row is what the dayjs version (`nowIST()`, `.subtract(n, 'day')`, `.format('YYYY-MM-DD')`)
   returned at that instant. The values were produced by running the legacy dayjs code at each instant
   (D:/MERN/codex-temp/task120/legacy-proof.cjs; identical under TZ=UTC, America/Los_Angeles and
   Asia/Tokyo) and are pinned here so the date-fns port has to match them. */
const LEGACY: Record<string, Record<ReportingDatePreset, [string, string]>> = {
  // IST 23:59:59.999 on 6 Oct, then IST midnight starting 7 Oct
  '2026-10-06T18:29:59.999Z': {
    allTime: ['2000-01-01', '2026-10-06'],
    today: ['2026-10-06', '2026-10-06'],
    yesterday: ['2026-10-05', '2026-10-05'],
    custom: ['2026-09-06', '2026-10-06'],
  },
  '2026-10-06T18:30:00.000Z': {
    allTime: ['2000-01-01', '2026-10-07'],
    today: ['2026-10-07', '2026-10-07'],
    yesterday: ['2026-10-06', '2026-10-06'],
    custom: ['2026-09-07', '2026-10-07'],
  },
  // UTC midnight is already 05:30 in IST: the IST day, not the UTC one
  '2026-03-01T00:00:00.000Z': {
    allTime: ['2000-01-01', '2026-03-01'],
    today: ['2026-03-01', '2026-03-01'],
    yesterday: ['2026-02-28', '2026-02-28'],
    custom: ['2026-01-30', '2026-03-01'],
  },
  // a leap year, either side of IST midnight
  '2024-03-01T18:29:59.999Z': {
    allTime: ['2000-01-01', '2024-03-01'],
    today: ['2024-03-01', '2024-03-01'],
    yesterday: ['2024-02-29', '2024-02-29'],
    custom: ['2024-01-31', '2024-03-01'],
  },
  '2024-03-01T18:30:00.000Z': {
    allTime: ['2000-01-01', '2024-03-02'],
    today: ['2024-03-02', '2024-03-02'],
    yesterday: ['2024-03-01', '2024-03-01'],
    custom: ['2024-02-01', '2024-03-02'],
  },
  // a year end, either side of IST midnight
  '2025-12-31T18:29:59.999Z': {
    allTime: ['2000-01-01', '2025-12-31'],
    today: ['2025-12-31', '2025-12-31'],
    yesterday: ['2025-12-30', '2025-12-30'],
    custom: ['2025-12-01', '2025-12-31'],
  },
  '2025-12-31T18:30:00.000Z': {
    allTime: ['2000-01-01', '2026-01-01'],
    today: ['2026-01-01', '2026-01-01'],
    yesterday: ['2025-12-31', '2025-12-31'],
    custom: ['2025-12-02', '2026-01-01'],
  },
}

const range = ([dateFrom, dateTo]: [string, string]) => ({ dateFrom, dateTo })

function at(instant: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('reporting date ranges match the dayjs version', () => {
  for (const [instant, expected] of Object.entries(LEGACY)) {
    test(`at ${instant}`, () => {
      at(instant)
      assert.deepEqual(computeReportingDateRange('allTime'), range(expected.allTime))
      assert.deepEqual(computeReportingDateRange('today'), range(expected.today))
      assert.deepEqual(computeReportingDateRange('yesterday'), range(expected.yesterday))
      assert.deepEqual(computeReportingCustomRange(), range(expected.custom))
      for (const preset of ['allTime', 'today', 'yesterday', 'custom'] as const) {
        assert.deepEqual(reportingPresetPeriod(preset), { ...range(expected[preset]), preset })
      }
    })
  }

  test('an explicit IST day gives the same ranges as the clock', () => {
    assert.deepEqual(computeReportingDateRange('yesterday', '2026-03-01'), range(['2026-02-28', '2026-02-28']))
    assert.deepEqual(computeReportingCustomRange('2024-03-02'), range(['2024-02-01', '2024-03-02']))
    assert.deepEqual(reportingPresetPeriod('allTime', '2026-10-07'), {
      dateFrom: '2000-01-01',
      dateTo: '2026-10-07',
      preset: 'allTime',
    })
  })

  test('an unexpected preset falls back to today, as the dayjs switch did', () => {
    const unexpected = 'custom' as unknown as Exclude<ReportingDatePreset, 'custom'>
    assert.deepEqual(computeReportingDateRange(unexpected, '2026-10-07'), range(['2026-10-07', '2026-10-07']))
  })
})

describe('preset options and labels', () => {
  test('the legacy options keep their order and wording; the quick presets leave out Custom', () => {
    assert.deepEqual(REPORTING_DATE_PRESET_OPTIONS, [
      { label: 'All time', value: 'allTime' },
      { label: 'Today', value: 'today' },
      { label: 'Yesterday', value: 'yesterday' },
      { label: 'Custom', value: 'custom' },
    ])
    assert.deepEqual(REPORTING_QUICK_PRESET_OPTIONS, REPORTING_DATE_PRESET_OPTIONS.slice(0, 3))
  })

  test('recognises only the four presets', () => {
    for (const preset of ['allTime', 'today', 'yesterday', 'custom']) assert.equal(isReportingDatePreset(preset), true)
    for (const other of ['last7days', '', undefined, null, 1]) assert.equal(isReportingDatePreset(other), false)
  })

  test('formats a day on its own calendar date and leaves anything else alone', () => {
    assert.equal(formatReportingDay('2026-09-07'), '07 Sep 2026')
    assert.equal(formatReportingDay('2024-02-29'), '29 Feb 2024')
    assert.equal(formatReportingDay('2026-02-30'), '2026-02-30')
    assert.equal(formatReportingDay(''), '')
  })

  test('states the applied range, "All time" for the open-ended preset, and the label for unusable days', () => {
    assert.equal(reportingPeriodLabel({ preset: 'allTime', dateFrom: '2000-01-01', dateTo: '2026-10-07' }), 'All time')
    assert.equal(
      reportingPeriodLabel({ preset: 'today', dateFrom: '2026-10-07', dateTo: '2026-10-07' }),
      '07 Oct 2026 – 07 Oct 2026',
    )
    assert.equal(
      reportingPeriodLabel({ preset: 'custom', dateFrom: '2026-09-07', dateTo: '2026-10-07' }),
      '07 Sep 2026 – 07 Oct 2026',
    )
    assert.equal(reportingPeriodLabel({ preset: 'custom', dateFrom: '', dateTo: '2026-10-07' }), 'Custom')
    assert.equal(reportingPeriodLabel({ preset: 'yesterday', dateFrom: 'x', dateTo: 'y' }), 'Yesterday')
  })
})

describe('useReportingDateFilter', () => {
  test('starts on All time by default and resets to it', () => {
    at('2026-10-06T18:30:00.000Z')
    const { result } = renderHook(() => useReportingDateFilter())
    assert.equal(result.current.preset, 'allTime')
    assert.equal(result.current.dateFrom, '2000-01-01')
    assert.equal(result.current.dateTo, '2026-10-07')

    act(() => result.current.handleChange('2026-09-01', '2026-09-30', 'custom'))
    assert.deepEqual(
      [result.current.dateFrom, result.current.dateTo, result.current.preset],
      ['2026-09-01', '2026-09-30', 'custom'],
    )

    act(() => result.current.reset())
    assert.deepEqual(
      [result.current.dateFrom, result.current.dateTo, result.current.preset],
      ['2000-01-01', '2026-10-07', 'allTime'],
    )
  })

  test('starts on a given preset, Custom seeded with the last 30 days', () => {
    at('2026-10-06T18:29:59.999Z')
    const yesterday = renderHook(() => useReportingDateFilter('yesterday')).result.current
    assert.deepEqual([yesterday.dateFrom, yesterday.dateTo, yesterday.preset], ['2026-10-05', '2026-10-05', 'yesterday'])

    const custom = renderHook(() => useReportingDateFilter('custom')).result.current
    assert.deepEqual([custom.dateFrom, custom.dateTo, custom.preset], ['2026-09-06', '2026-10-06', 'custom'])
  })
})
