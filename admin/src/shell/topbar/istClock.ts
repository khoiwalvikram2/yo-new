import type { Dayjs } from 'dayjs'

/** Refresh interval for the shell's IST clock, shared with useIstClock's setInterval. */
export const IST_CLOCK_REFRESH_MS = 30_000

export interface IstClock {
  /** e.g. 'Fri, 04 Sep 2026' */
  date: string
  /** e.g. '17:19 IST' */
  time: string
}

/**
 * Converts `now` to Asia/Kolkata before formatting, so a UTC instant (tests) and an
 * already-IST instant (nowIST() in the app) both produce the same IST-zoned labels.
 * 'IST' is a hard-coded literal, not dayjs's offsetName(), which would print 'GMT+5:30'.
 */
export function formatIstClock(now: Dayjs): IstClock {
  const ist = now.tz('Asia/Kolkata')
  return {
    date: ist.format('ddd, DD MMM YYYY'),
    time: ist.format('HH:mm [IST]'),
  }
}
