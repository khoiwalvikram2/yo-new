import type { ListboxOption } from './useListbox'

/* The times TimeField's clock button lists, and the `HH:mm` helpers behind them. Kept out of TimeField.tsx so
 * that file exports components only (fast refresh). */

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
export const DAY_MINUTES = 24 * 60
/** The list's interval when the input's own step is a single minute. */
export const LIST_MINUTES = 30

/** True for a real 24-hour `HH:mm` time (no seconds). */
export function isTimeString(value: string): boolean {
  return TIME_PATTERN.test(value)
}

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * The times the clock button lists, within min..max. A step coarser than a minute is counted from `min`,
 * as the native input's step base is; the 30-minute default sits on the hour and the half hour.
 */
export function timeOptions(step: number, min?: string, max?: string): ListboxOption[] {
  const low = min !== undefined && isTimeString(min) ? minutesOf(min) : 0
  const high = max !== undefined && isTimeString(max) ? minutesOf(max) : DAY_MINUTES - 1
  const every = step > 60 ? step / 60 : LIST_MINUTES
  const start = step > 60 ? low : Math.ceil(low / every) * every
  const options: ListboxOption[] = []
  for (let minutes = start; minutes <= high; minutes += every) {
    const time = timeOf(minutes)
    options.push({ value: time, label: time })
  }
  return options
}
