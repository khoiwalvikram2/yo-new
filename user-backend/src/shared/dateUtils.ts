import { DateTime } from 'luxon'

/**
 * Timezone-aware date boundary utilities. All functions accept a timezone string
 * (e.g. 'Asia/Kolkata', 'America/New_York') and return a JS Date in UTC representation.
 */

/** Format a date in the given IANA timezone for display (e.g. "17 Mar 2025, 15:30"). */
export function formatInTimeZone(
	date: Date | string,
	timeZone: string,
	formatStr: string = 'dd MMM yyyy, HH:mm'
): string {
	const d = typeof date === 'string' ? new Date(date) : date
	if (isNaN(d.getTime())) return ''
	const dt = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(timeZone)
	return dt.toFormat(formatStr)
}

export function getStartOfDay(timezone: string): Date {
	return DateTime.now().setZone(timezone).startOf('day').toJSDate()
}

export function getEndOfDay(timezone: string): Date {
	return DateTime.now().setZone(timezone).endOf('day').toJSDate()
}

/** Start of week (Sunday 00:00:00) in the given timezone - for stake limits */
export function getStartOfWeek(timezone: string): Date {
	const dt = DateTime.now().setZone(timezone)
	// Luxon weekday 1=Mon..7=Sun. Most recent Sunday: go back weekday days when Mon(1)-Sat(6), 0 when Sun(7)
	const daysBack = dt.weekday === 7 ? 0 : dt.weekday
	const sunday = dt.minus({ days: daysBack })
	return sunday.startOf('day').toJSDate()
}

export function getStartOfMonth(timezone: string): Date {
	return DateTime.now().setZone(timezone).startOf('month').toJSDate()
}

export function getEndOfMonth(timezone: string): Date {
	return DateTime.now().setZone(timezone).endOf('month').toJSDate()
}
