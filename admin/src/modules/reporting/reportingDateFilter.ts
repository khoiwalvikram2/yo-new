import { useState } from 'react'
import { TZDate } from '@date-fns/tz'
import { format, subDays } from 'date-fns'
import { ADMIN_TZ, isDayString, istToday } from '@/ui/components/istDate'

/* The reporting date filter's logic, without its antd UI (page migration C, W3 Task 120).
 *
 * These parts lived in components/ReportingDateFilter.tsx, which also draws the antd Select and
 * pickers. They moved here so a migrated report can use them without antd in its import closure, and
 * ReportingDateFilter.tsx re-exports them, so every existing importer compiles unchanged.
 *
 * The maths moved from dayjs (undeclared in admin/package.json; it leaves with antd, D6) to date-fns
 * and @date-fns/tz on the kit's IST helpers. The strings are the ones the dayjs code produced: "today"
 * is the IST calendar day of the moment the function runs, wherever the browser sits, and a day is a
 * plain `yyyy-MM-dd` string. reportingDateFilter.test.ts pins the outputs at both sides of IST
 * midnight, on a leap day and across a year end, against values taken from the dayjs version. */

export type ReportingDatePreset = 'allTime' | 'today' | 'yesterday' | 'custom'

export interface ReportingDateRange {
  dateFrom: string
  dateTo: string
}

/** One applied period: what every reporting date control reports through `onChange`. */
export interface ReportingPeriod extends ReportingDateRange {
  preset: ReportingDatePreset
}

export interface ReportingDateFilterProps {
  dateFrom: string
  dateTo: string
  preset?: ReportingDatePreset
  onChange: (dateFrom: string, dateTo: string, preset: ReportingDatePreset) => void
}

/** The legacy option list, in its order and wording. */
export const REPORTING_DATE_PRESET_OPTIONS: Array<{ label: string; value: ReportingDatePreset }> = [
  { label: 'All time', value: 'allTime' },
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Custom', value: 'custom' },
]

/** The presets that apply in one step; Custom needs its two dates first. */
export const REPORTING_QUICK_PRESET_OPTIONS: Array<{
  label: string
  value: Exclude<ReportingDatePreset, 'custom'>
}> = [
  { label: 'All time', value: 'allTime' },
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
]

/** The first day "All time" asks for; the reports treat it as no lower bound. */
export const REPORTING_ALL_TIME_FROM = '2000-01-01'

/** Choosing Custom starts from today and the 30 calendar days before it. */
const CUSTOM_SEED_DAYS = 30

export function isReportingDatePreset(value: unknown): value is ReportingDatePreset {
  return value === 'allTime' || value === 'today' || value === 'yesterday' || value === 'custom'
}

/* A `yyyy-MM-dd` day as midnight in IST. date-fns reads a TZDate through its own zone, so subtracting
   days and formatting it stay on IST calendar days whatever the browser's zone is. */
function istDayDate(day: string): TZDate {
  const [year, month, date] = day.split('-').map(Number)
  return new TZDate(year, month - 1, date, ADMIN_TZ)
}

function istDaysBefore(day: string, days: number): string {
  return format(subDays(istDayDate(day), days), 'yyyy-MM-dd')
}

/**
 * The range a preset stands for. `todayDay` is the IST day to count from, today by default; it is a
 * parameter so the boundaries can be tested.
 */
export function computeReportingDateRange(
  preset: Exclude<ReportingDatePreset, 'custom'>,
  todayDay: string = istToday(),
): ReportingDateRange {
  switch (preset) {
    case 'allTime':
      return { dateFrom: REPORTING_ALL_TIME_FROM, dateTo: todayDay }
    case 'today':
      return { dateFrom: todayDay, dateTo: todayDay }
    case 'yesterday': {
      const yesterday = istDaysBefore(todayDay, 1)
      return { dateFrom: yesterday, dateTo: yesterday }
    }
    default:
      return { dateFrom: todayDay, dateTo: todayDay }
  }
}

/** The range Custom opens on before a date is picked: the last 30 days through today. */
export function computeReportingCustomRange(todayDay: string = istToday()): ReportingDateRange {
  return { dateFrom: istDaysBefore(todayDay, CUSTOM_SEED_DAYS), dateTo: todayDay }
}

/** What choosing a preset applies, Custom included (the legacy filter applied Custom's seed at once). */
export function reportingPresetPeriod(
  preset: ReportingDatePreset,
  todayDay: string = istToday(),
): ReportingPeriod {
  const range = preset === 'custom'
    ? computeReportingCustomRange(todayDay)
    : computeReportingDateRange(preset, todayDay)
  return { ...range, preset }
}

/** `2026-09-22` → `22 Sep 2026`, the app's date format (the mockup's range pill, M:1739). */
export function formatReportingDay(day: string): string {
  return isDayString(day) ? format(istDayDate(day), 'dd MMM yyyy') : day
}

/**
 * The text a period control shows for the applied period: "All time" for the open-ended preset, the
 * two days otherwise (M:1739 states the range, never the preset's name, beside the preset buttons),
 * and the preset's own label when the days are not usable.
 */
export function reportingPeriodLabel({ preset, dateFrom, dateTo }: ReportingPeriod): string {
  const option = REPORTING_DATE_PRESET_OPTIONS.find((candidate) => candidate.value === preset)
  if (preset === 'allTime') return option?.label ?? 'All time'
  if (isDayString(dateFrom) && isDayString(dateTo)) {
    return `${formatReportingDay(dateFrom)} – ${formatReportingDay(dateTo)}`
  }
  return option?.label ?? 'Custom'
}

export function useReportingDateFilter(initialPreset: ReportingDatePreset = 'allTime') {
  const initial = initialPreset === 'custom'
    ? computeReportingCustomRange()
    : computeReportingDateRange(initialPreset)

  const [dateFrom, setDateFrom] = useState(initial.dateFrom)
  const [dateTo, setDateTo] = useState(initial.dateTo)
  const [preset, setPreset] = useState<ReportingDatePreset>(initialPreset)

  const handleChange = (from: string, to: string, p: ReportingDatePreset) => {
    setDateFrom(from)
    setDateTo(to)
    setPreset(p)
  }

  const reset = () => {
    const r = computeReportingDateRange('allTime')
    setDateFrom(r.dateFrom)
    setDateTo(r.dateTo)
    setPreset('allTime')
  }

  return { dateFrom, dateTo, preset, handleChange, reset }
}
