// Date utility functions
// For timezone-aware formatting, use formatDate/formatDateTime/formatTime from shared/services/formatting.ts with timeZone from useAppConfig().

import { format as formatFns } from 'date-fns'
import { tz, TZDate, constructFromSymbol } from '@date-fns/tz'
import dayjs from 'dayjs'

/** Default timezone for admin date boundaries and comparisons (IST). */
export const DEFAULT_ADMIN_TZ = 'Asia/Kolkata'

/** Get a dayjs instance representing "now" in IST. Use instead of dayjs() for timezone-correct boundaries. */
export function nowIST(): dayjs.Dayjs {
  return dayjs.tz(undefined, DEFAULT_ADMIN_TZ)
}

/** Get today's date string ('YYYY-MM-DD') in IST. Use instead of dayjs().format('YYYY-MM-DD'). */
export function todayISTString(): string {
  return dayjs.tz(undefined, DEFAULT_ADMIN_TZ).format('YYYY-MM-DD')
}

/** Format a date in a given IANA timezone (e.g. 'Asia/Kolkata'). Use for display only. */
export function formatInTimeZone(
  date: Date | string,
  formatStr: string,
  timeZone: string
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return 'Invalid Date'
  return formatFns(d, formatStr, { in: tz(timeZone) })
}

// Format date to ISO string
export const toISOString = (date: Date | string): string => {
  return new Date(date).toISOString()
}

// Get start of day (optional timezone; default IST)
export function startOfDay(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const y = tzDate.getFullYear()
  const m = tzDate.getMonth()
  const day = tzDate.getDate()
  const startInTz = tzDate[constructFromSymbol](new Date(y, m, day, 0, 0, 0, 0))
  return new Date(startInTz.getTime())
}

// Get end of day (optional timezone; default IST)
export function endOfDay(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const y = tzDate.getFullYear()
  const m = tzDate.getMonth()
  const day = tzDate.getDate()
  const endInTz = tzDate[constructFromSymbol](new Date(y, m, day, 23, 59, 59, 999))
  return new Date(endInTz.getTime())
}

// Get start of week (Monday) in timezone (optional; default IST)
export function startOfWeek(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const day = tzDate.getDay()
  const diff = tzDate.getDate() - day + (day === 0 ? -6 : 1)
  const monday = tzDate[constructFromSymbol](
    new Date(tzDate.getFullYear(), tzDate.getMonth(), diff, 0, 0, 0, 0)
  )
  return new Date(monday.getTime())
}

// Get end of week (Sunday) in timezone (optional; default IST)
export function endOfWeek(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const day = tzDate.getDay()
  const diff = tzDate.getDate() - day + (day === 0 ? 0 : 7)
  const sunday = tzDate[constructFromSymbol](
    new Date(tzDate.getFullYear(), tzDate.getMonth(), diff, 23, 59, 59, 999)
  )
  return new Date(sunday.getTime())
}

// Get start of month in timezone (optional; default IST)
export function startOfMonth(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const first = tzDate[constructFromSymbol](
    new Date(tzDate.getFullYear(), tzDate.getMonth(), 1, 0, 0, 0, 0)
  )
  return new Date(first.getTime())
}

// Get end of month in timezone (optional; default IST)
export function endOfMonth(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): Date {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return d
  const tzDate = new TZDate(d, timeZone)
  const last = tzDate[constructFromSymbol](
    new Date(tzDate.getFullYear(), tzDate.getMonth() + 1, 0, 23, 59, 59, 999)
  )
  return new Date(last.getTime())
}

// Add days to date
export const addDays = (date: Date | string, days: number): Date => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// Add months to date
export const addMonths = (date: Date | string, months: number): Date => {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

// Add years to date
export const addYears = (date: Date | string, years: number): Date => {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + years)
  return d
}

// Get difference in days
export const differenceInDays = (date1: Date | string, date2: Date | string): number => {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

// Get difference in hours
export const differenceInHours = (date1: Date | string, date2: Date | string): number => {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60))
}

// Get difference in minutes
export const differenceInMinutes = (date1: Date | string, date2: Date | string): number => {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  const diffTime = Math.abs(d2.getTime() - d1.getTime())
  return Math.ceil(diffTime / (1000 * 60))
}

// Check if date is today in the given timezone (default IST)
export function isToday(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return false
  const todayStr = formatInTimeZone(new Date(), 'yyyy-MM-dd', timeZone)
  return formatInTimeZone(d, 'yyyy-MM-dd', timeZone) === todayStr
}

// Check if date is yesterday in the given timezone (default IST)
export function isYesterday(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return false
  const nowTz = new TZDate(new Date(), timeZone)
  const yesterdayTz = nowTz[constructFromSymbol](
    new Date(nowTz.getFullYear(), nowTz.getMonth(), nowTz.getDate() - 1, 12, 0, 0)
  )
  const yesterdayStr = formatInTimeZone(new Date(yesterdayTz.getTime()), 'yyyy-MM-dd', timeZone)
  return formatInTimeZone(d, 'yyyy-MM-dd', timeZone) === yesterdayStr
}

// Check if date is tomorrow in the given timezone (default IST)
export function isTomorrow(date: Date | string, timeZone: string = DEFAULT_ADMIN_TZ): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return false
  const nowTz = new TZDate(new Date(), timeZone)
  const tomorrowTz = nowTz[constructFromSymbol](
    new Date(nowTz.getFullYear(), nowTz.getMonth(), nowTz.getDate() + 1, 12, 0, 0)
  )
  const tomorrowStr = formatInTimeZone(new Date(tomorrowTz.getTime()), 'yyyy-MM-dd', timeZone)
  return formatInTimeZone(d, 'yyyy-MM-dd', timeZone) === tomorrowStr
}

// Check if date is in the past
export const isPast = (date: Date | string): boolean => {
  return new Date(date) < new Date()
}

// Check if date is in the future
export const isFuture = (date: Date | string): boolean => {
  return new Date(date) > new Date()
}

// Check if date is within range
export const isWithinRange = (
  date: Date | string,
  startDate: Date | string,
  endDate: Date | string
): boolean => {
  const d = new Date(date)
  const start = new Date(startDate)
  const end = new Date(endDate)
  return d >= start && d <= end
}

// Get relative time string
export const getRelativeTime = (date: Date | string): string => {
  const now = new Date()
  const target = new Date(date)
  const diffInSeconds = Math.floor((now.getTime() - target.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'Just now'
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  } else if (diffInSeconds < 2592000) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days} day${days > 1 ? 's' : ''} ago`
  } else if (diffInSeconds < 31536000) {
    const months = Math.floor(diffInSeconds / 2592000)
    return `${months} month${months > 1 ? 's' : ''} ago`
  } else {
    const years = Math.floor(diffInSeconds / 31536000)
    return `${years} year${years > 1 ? 's' : ''} ago`
  }
}

// Parse date string with multiple formats
export const parseDate = (dateString: string): Date | null => {
  const formats = [
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO format
    /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/, // MM-DD-YYYY
  ]

  for (const format of formats) {
    if (format.test(dateString)) {
      const date = new Date(dateString)
      if (!isNaN(date.getTime())) {
        return date
      }
    }
  }

  return null
}

// Get timezone offset in minutes
export const getTimezoneOffset = (): number => {
  return new Date().getTimezoneOffset()
}

// Convert to UTC
export const toUTC = (date: Date | string): Date => {
  const d = new Date(date)
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000)
}

// Convert from UTC
export const fromUTC = (date: Date | string): Date => {
  const d = new Date(date)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
}
