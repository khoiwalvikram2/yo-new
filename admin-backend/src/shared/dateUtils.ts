import { DateTime } from 'luxon'

/**
 * Timezone-aware date boundary utilities. All functions accept a timezone string
 * (e.g. 'Asia/Kolkata', 'America/New_York') and return a JS Date in UTC representation.
 */

/** Start of a given date (00:00:00.000) in the given timezone */
export function getStartOfDayForDate(date: Date, timezone: string): Date {
	return DateTime.fromJSDate(date, { zone: timezone }).startOf('day').toJSDate()
}

/** End of a given date (23:59:59.999) in the given timezone */
export function getEndOfDayForDate(date: Date, timezone: string): Date {
	return DateTime.fromJSDate(date, { zone: timezone }).endOf('day').toJSDate()
}

/** Format date as yyyy-MM-dd in the given timezone (for IST-safe date strings) */
export function formatDateInTz(date: Date, timezone: string): string {
	return DateTime.fromJSDate(date, { zone: timezone }).toFormat('yyyy-MM-dd')
}

export function getStartOfDay(timezone: string): Date {
	return DateTime.now().setZone(timezone).startOf('day').toJSDate()
}

export function getEndOfDay(timezone: string): Date {
	return DateTime.now().setZone(timezone).endOf('day').toJSDate()
}

/** End of yesterday (23:59:59.999) in the given timezone */
export function getEndOfYesterday(timezone: string): Date {
	return DateTime.now().setZone(timezone).minus({ days: 1 }).endOf('day').toJSDate()
}

/** Start of week (Monday 00:00:00) in the given timezone */
export function getStartOfWeek(timezone: string): Date {
	const dt = DateTime.now().setZone(timezone)
	// Luxon: weekday 1 = Monday. If Sunday (7), go back 6 days; else go back (weekday - 1) days
	const monday = dt.weekday === 7 ? dt.minus({ days: 6 }) : dt.minus({ days: dt.weekday - 1 })
	return monday.startOf('day').toJSDate()
}

export function getStartOfMonth(timezone: string): Date {
	return DateTime.now().setZone(timezone).startOf('month').toJSDate()
}

export function getEndOfMonth(timezone: string): Date {
	return DateTime.now().setZone(timezone).endOf('month').toJSDate()
}

/**
 * Parse a date filter string (YYYY-MM-DD or ISO) as the start-of-day in the given timezone.
 * For bare YYYY-MM-DD strings, this returns 00:00:00 in the TZ (not UTC midnight).
 * For full ISO strings, it returns start-of-day of the date portion in the TZ.
 */
export function parseDateFrom(dateStr: string, timezone: string): Date {
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
		return DateTime.fromISO(dateStr, { zone: timezone }).startOf('day').toJSDate()
	}
	return DateTime.fromJSDate(new Date(dateStr), { zone: timezone }).startOf('day').toJSDate()
}

/**
 * Parse a date filter string (YYYY-MM-DD or ISO) as the end-of-day in the given timezone.
 * For bare YYYY-MM-DD strings, this returns 23:59:59.999 in the TZ (not UTC midnight).
 * For full ISO strings, it returns end-of-day of the date portion in the TZ.
 */
export function parseDateTo(dateStr: string, timezone: string): Date {
	if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
		return DateTime.fromISO(dateStr, { zone: timezone }).endOf('day').toJSDate()
	}
	return DateTime.fromJSDate(new Date(dateStr), { zone: timezone }).endOf('day').toJSDate()
}

/**
 * GraphQL resolvers pass Date boundaries from parseDateFrom/parseDateTo (whitelabel TZ).
 * Repos must not do parseDateFrom(String(dateObj), DEFAULT_TZ) — that mis-parses and breaks ranges.
 */
export function coerceReportingRangeStart(value: Date | string | undefined | null, tz: string): Date | undefined {
	if (value == null || value === '') return undefined
	if (value instanceof Date) return value
	return parseDateFrom(String(value), tz)
}

export function coerceReportingRangeEnd(value: Date | string | undefined | null, tz: string): Date | undefined {
	if (value == null || value === '') return undefined
	if (value instanceof Date) return value
	return parseDateTo(String(value), tz)
}
