import { useCallback } from 'react'
import type { DateRangePreset } from '@/state/dashboardStore'
import { useCurrency } from '@/shared/core/CurrencyContext'

/* Shared formatting for the dashboard's figure sections and insight cards. */

/** The period in the words a section's sub line uses. */
export const PERIOD: Record<DateRangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7days: 'Last 7 days',
  last30days: 'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  custom: 'Selected period',
}

export const periodLabel = (preset?: DateRangePreset) => PERIOD[preset ?? 'custom'] ?? PERIOD.custom

/** Whole rupees, as the KPI cards print them; a negative keeps its minus in front of the currency. */
export function useWholeMoney() {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  return useCallback(
    (value: number) => `${value < 0 ? '-' : ''}${formatAmount(convertFromWhitelabelCurrency(Math.abs(value)), undefined, { fractionDigits: 0 })}`,
    [formatAmount, convertFromWhitelabelCurrency],
  )
}

export const count = (value: number) => value.toLocaleString('en-IN')

/** A count with its noun: "1 bet", "12 bets". */
export const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`

/** A wait or a duration in minutes, in the two largest units: "45 sec", "12 min", "3 h 20 min", "13 d 4 h". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = Math.round(minutes - hours * 60)
    return rest ? `${hours} h ${rest} min` : `${hours} h`
  }
  const days = Math.floor(hours / 24)
  const rest = hours - days * 24
  return rest ? `${days} d ${rest} h` : `${days} d`
}

/** A 0..1 share as a percent with one decimal; "—" when there is nothing to divide. */
export function formatShare(share: number | null | undefined): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return '—'
  return `${(share * 100).toFixed(1)}%`
}

/** part / whole as a 0..1 share, or null when the whole is 0. */
export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null)

/** Indian short units for an axis: 2.5 Cr, 40 L, 12 K. */
export function compactAmount(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const trim = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: n < 10 ? 1 : 0 })
  if (abs >= 1e7) return `${sign}${trim(abs / 1e7)} Cr`
  if (abs >= 1e5) return `${sign}${trim(abs / 1e5)} L`
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)} K`
  return `${sign}${trim(abs)}`
}

/** ISO weekdays 1..7 as short names, Monday first. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** An hour of the day as "17:00". */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
