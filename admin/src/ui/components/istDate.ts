import { TZDate } from '@date-fns/tz'

/* Kit date fields carry calendar days as plain `yyyy-MM-dd` strings, which is what a native
 * `<input type="date">` reads and writes. The admin's day boundaries are IST, wherever the browser
 * sits (shared/utils/date.ts `DEFAULT_ADMIN_TZ`), so a day string becomes an instant only here.
 *
 * These are on `@date-fns/tz`, not dayjs: dayjs is not declared in admin/package.json and resolves
 * only because antd pulls it in, so it leaves with antd (page migration C, D6).
 *
 * The instants are the ones the old antd pickers sent, so a migrated page queries the same window:
 *   istDayStart('2026-09-22') === '2026-09-21T18:30:00.000Z'
 *   istDayEnd('2026-09-22')   === '2026-09-22T18:29:59.999Z'
 */

export const ADMIN_TZ = 'Asia/Kolkata'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** True when a native datetime-local step represents one or more whole minutes. */
export function isWholeMinuteStep(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value > 0
    && value % 60 === 0
}

/** True for a `yyyy-MM-dd` string that names a real day. */
export function isDayString(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new TZDate(year, month - 1, day, ADMIN_TZ)
  // a day that rolled over (31 April) comes back as a different date
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

/** True for a minute-precision `yyyy-MM-ddTHH:mm` string naming a real IST calendar moment. */
export function isDateTimeString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_TIME_PATTERN.exec(value)
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return false

  const probe = new TZDate(year, month - 1, day, hour, minute, 0, 0, ADMIN_TZ)
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day &&
    probe.getHours() === hour &&
    probe.getMinutes() === minute
  )
}

function parts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number)
  return [year, month - 1, date]
}

/* A TZDate prints its own zone ("2026-09-22T00:00:00.000+05:30"), and the API wants the UTC form the
   old pickers sent, so the instant goes through a plain Date on its way out. */
const utc = (moment: TZDate): string => new Date(moment.getTime()).toISOString()

/** The first instant of an IST day, as a UTC ISO string. Throws on anything that is not a day. */
export function istDayStart(day: string): string {
  if (!isDayString(day)) throw new Error(`istDayStart: not a yyyy-MM-dd day: ${String(day)}`)
  const [year, month, date] = parts(day)
  return utc(new TZDate(year, month, date, 0, 0, 0, 0, ADMIN_TZ))
}

/** The last instant of an IST day (23:59:59.999), as a UTC ISO string. */
export function istDayEnd(day: string): string {
  if (!isDayString(day)) throw new Error(`istDayEnd: not a yyyy-MM-dd day: ${String(day)}`)
  const [year, month, date] = parts(day)
  return utc(new TZDate(year, month, date, 23, 59, 59, 999, ADMIN_TZ))
}

/**
 * Converts an IST calendar value from a native `datetime-local` control into the UTC ISO instant
 * sent to the API. This deliberately does not use the browser's local timezone.
 */
export function istDateTimeToIso(value: string): string {
  if (!isDateTimeString(value)) {
    throw new Error(`istDateTimeToIso: not a yyyy-MM-ddTHH:mm date-time: ${String(value)}`)
  }
  const match = DATE_TIME_PATTERN.exec(value) as RegExpExecArray
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  return utc(
    new TZDate(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      Number(hourText),
      Number(minuteText),
      0,
      0,
      ADMIN_TZ,
    ),
  )
}

/** Which IST day an instant falls in, as `yyyy-MM-dd`. Empty string for an unusable input. */
export function istDayOf(instant: string | number | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const ist = new TZDate(date, ADMIN_TZ)
  const month = String(ist.getMonth() + 1).padStart(2, '0')
  const day = String(ist.getDate()).padStart(2, '0')
  return `${ist.getFullYear()}-${month}-${day}`
}

/** Today in IST, as `yyyy-MM-dd`. */
export function istToday(): string {
  return istDayOf(new Date())
}
