import { isDayString } from './istDate'

/* Calendar arithmetic on `yyyy-MM-dd` strings (whole days on a UTC Date, so no zone is involved), shared by
 * Calendar and its tests. Kept out of Calendar.tsx so that file exports components only (fast refresh). */

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const pad = (value: number) => String(value).padStart(2, '0')

function toDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

function fromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The day `amount` days from `day` (negative goes back). */
export function addDays(day: string, amount: number): string {
  const date = toDate(day)
  date.setUTCDate(date.getUTCDate() + amount)
  return fromDate(date)
}

/** The same day of the month `amount` months on, held to the last day of a shorter month. */
export function addMonths(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + amount, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date, lastDay))
  return fromDate(target)
}

/** 0 for Monday … 6 for Sunday. */
export function weekday(day: string): number {
  return (toDate(day).getUTCDay() + 6) % 7
}

export function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/** "17 October 2026": the day's accessible name, without the ", today" suffix. */
export function formatDayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return `${date} ${MONTHS[month - 1]} ${year}`
}

/* Bounds that contradict each other (min after max) are not used to steer focus; every day is then
   disabled, which is what such bounds say. */
export function clampDay(day: string, min: string | undefined, max: string | undefined): string {
  if (min && max && min > max) return day
  if (min && day < min) return min
  if (max && day > max) return max
  return day
}

export const validDay = (value: string | undefined): string | undefined => (isDayString(value) ? value : undefined)
