const IST = 'Asia/Kolkata'

/** Set whitelabel timezone (from app settings). Currently date helpers use IST; this is for future use. */
export function setWhitelabelTimezone(_tz: string): void {
  // Reserved for future: use _tz in getTodayKolkata, getStartOfDayKolkata, etc.
}

/** Today's date string (YYYY-MM-DD) in Asia/Kolkata. */
export function getTodayKolkata(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST })
}

/** Start of a day 00:00:00 in Asia/Kolkata as a Date (UTC). Pass YYYY-MM-DD for a specific day, omit for today. */
export function getStartOfDayKolkata(dateStr?: string): Date {
  const ymd = dateStr || getTodayKolkata()
  return new Date(`${ymd}T00:00:00+05:30`)
}

/** End of a day 23:59:59.999 in Asia/Kolkata as a Date (UTC). Pass YYYY-MM-DD for a specific day, omit for today. */
export function getEndOfDayKolkata(dateStr?: string): Date {
  const ymd = dateStr || getTodayKolkata()
  return new Date(`${ymd}T23:59:59.999+05:30`)
}

/** Add days to a YYYY-MM-DD string (interpreted in IST) and return YYYY-MM-DD. */
export function addDaysKolkata(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00+05:30')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}

/** Yesterday's date string (YYYY-MM-DD) in Asia/Kolkata. */
export function getYesterdayKolkata(): string {
  return addDaysKolkata(getTodayKolkata(), -1)
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { timeZone: IST }
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { timeZone: IST, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }

/** Format a date in IST for display (date part). */
export function formatDateIST(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString(undefined, DATE_OPTIONS)
}

/** Format a time in IST for display. */
export function formatTimeIST(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString(undefined, TIME_OPTIONS)
}
