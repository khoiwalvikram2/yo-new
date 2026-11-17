import { DateTime } from 'luxon'
import { matkaKind, type MatkaSession } from './rules.js'

type Market = { status: string; timezone: string; schedule: unknown; settings: unknown; deletedAt?: Date | null }
type SessionOverride = { side: string; status: string; scheduledLockAtUtc?: Date | null; suspendMinutesOverride?: number | null; resultPublishedAtUtc?: Date | null; actualLockAtUtc?: Date | null; actualCloseAtUtc?: Date | null }
type Settings = { matkaType?: string; betWindowMinsBeforeOpen?: number; betWindowMinsBeforeClose?: number; openSuspended?: boolean; closeSuspended?: boolean; message?: string; bettingStartTime?: string }
type Schedule = { openTime: string; closeTime: string; daysOfWeek?: number[]; closesNextDay?: boolean; effectiveFrom?: string; effectiveTo?: string }
type StoredSession = { status: string; scheduledOpenAtUtc?: Date | null; scheduledLockAtUtc?: Date | null; scheduledCloseAtUtc?: Date | null; suspendMinutesOverride?: number | null; actualLockAtUtc?: Date | null; actualCloseAtUtc?: Date | null }
function clock(value: string) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new Error('Market times must use HH:mm'); return value }
const reached = (at: Date | string | null | undefined, now: Date) => at != null && now.getTime() >= new Date(at).getTime()
/** Lock Now and Close Now stamp the moment an operator stopped a session. A stamp blocks betting whatever
 *  the status says: sessions locked before those actions wrote a status kept status OPEN. */
export function stoppedByOperator(override: Pick<SessionOverride, 'actualLockAtUtc' | 'actualCloseAtUtc'> | null | undefined, now = new Date()) {
  return reached(override?.actualLockAtUtc, now) || reached(override?.actualCloseAtUtc, now)
}
/** A stored session's lock as players get it: Adjust Suspend Minutes counts back from the close, as matkaSchedule does. */
export function worliLockAt(session: StoredSession): Date | null {
  if (session.suspendMinutesOverride != null && session.scheduledCloseAtUtc) return new Date(new Date(session.scheduledCloseAtUtc).getTime() - session.suspendMinutesOverride * 60000)
  return session.scheduledLockAtUtc ? new Date(session.scheduledLockAtUtc) : null
}
/** The status an operator should see for a stored session. Nothing writes LOCKED or CLOSED when a scheduled
 *  lock or close passes, so the stored status is moved on here by the clock and the operator stamps, the way
 *  matkaSchedule closes the player side: past the lock it is LOCKED, past the close CLOSED (awaiting result). */
export function worliSessionStatus(session: StoredSession, now = new Date()): string {
  if (!['SCHEDULED', 'OPENING_SOON', 'OPEN', 'LOCKED'].includes(session.status)) return session.status
  if (reached(session.actualCloseAtUtc, now) || reached(session.scheduledCloseAtUtc, now)) return 'CLOSED'
  if (session.status === 'LOCKED' || reached(session.actualLockAtUtc, now) || reached(worliLockAt(session), now)) return 'LOCKED'
  return session.status === 'OPEN' || reached(session.scheduledOpenAtUtc, now) ? 'OPEN' : session.status
}
/**
 * A market day's matka_results rows as players are gated on them (owner, 2026-11-04). `published` holds the results in
 * force, shown and settled on; `declared` every session that ever had a result declared, rolled back since or not, which
 * never takes entries again, as players may have seen the result. A rollback only stamps its row (settlement.ts), so pass
 * every row of the whitelabel's market and date, rolled back or not. Admin Unlock refuses on the same rule
 * (admin-backend matka-worli sessionUnlockStore.ts).
 */
export function matkaSessionResults(rows: ReadonlyArray<{ type: MatkaSession; result: string; rolledBackAt?: Date | null }>) {
  const published: Partial<Record<MatkaSession, string>> = {}, declared: Partial<Record<MatkaSession, boolean>> = {}
  for (const row of rows) {
    declared[row.type] = true
    if (!row.rolledBackAt) published[row.type] = row.result
  }
  return { published, declared }
}
/** `results` are the results in force and `declared` the sessions that ever had one (matkaSessionResults): a session in
 *  either takes no entries, whatever its stored row says, and also when it has no row. */
export function matkaSchedule(market: Market, now = new Date(), overrides: SessionOverride[] = [], results: Partial<Record<MatkaSession, string>> = {}, declared: Partial<Record<MatkaSession, boolean>> = {}) {
  const schedule = market.schedule as Schedule, settings = (market.settings || {}) as Settings, kind = matkaKind(settings)
  const local = DateTime.fromJSDate(now, { zone: market.timezone || 'Asia/Kolkata' })
  if (!local.isValid) throw new Error('Invalid market timezone')
  const openClock = clock(schedule.openTime), closeClock = clock(schedule.closeTime)
  const overnight = kind === 'worli' && (schedule.closesNextDay || closeClock <= openClock)
  let day = local.startOf('day')
  if (overnight && local.toFormat('HH:mm') < closeClock) day = day.minus({ days: 1 })
  const runDate = day.toISODate()!
  const at = (value: string) => DateTime.fromISO(`${runDate}T${value}`, { zone: local.zoneName! })
  const openAt = at(openClock), closeAt = overnight ? at(closeClock).plus({ days: 1 }) : at(closeClock)
  const start = at(settings.bettingStartTime ? clock(settings.bettingStartTime) : '00:00')
  const activeDay = !schedule.daysOfWeek?.length || schedule.daysOfWeek.includes(day.weekday % 7)
  const activeRange = (!schedule.effectiveFrom || runDate >= schedule.effectiveFrom.slice(0, 10)) && (!schedule.effectiveTo || runDate <= schedule.effectiveTo.slice(0, 10))
  const active = market.status.toLowerCase() === 'active' && !market.deletedAt && activeDay && activeRange
  const session = (side: MatkaSession) => {
    const resultAt = side === 'open' ? openAt : closeAt
    const minutes = side === 'open' ? settings.betWindowMinsBeforeOpen ?? 15 : settings.betWindowMinsBeforeClose ?? 10
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw new Error('Invalid market cutoff minutes')
    const override = overrides.find(item => item.side.toLowerCase() === side)
    const lockAt = resultAt.minus({ minutes: override?.suspendMinutesOverride ?? minutes })
    const manualBlocked = !!override && (['PAUSED', 'LOCKED', 'CLOSED', 'SETTLING', 'SETTLED', 'VOIDED'].includes(override.status) || stoppedByOperator(override, now))
    const enabled = kind === 'starline' ? side === 'open' : kind === 'jackpot' || kind === 'sattaMatka' ? side === 'close' : true
    const suspended = side === 'open' ? settings.openSuspended : settings.closeSuspended
    const accepting = !!(enabled && active && !suspended && !manualBlocked && !results[side] && !declared[side] && !override?.resultPublishedAtUtc && local >= start && local < lockAt)
    return { side, enabled, accepting, resultAt: resultAt.toUTC().toISO()!, lockAt: lockAt.toUTC().toISO()!, startsAt: start.toUTC().toISO()!, status: accepting ? 'Open' : local < start && active ? 'Upcoming' : 'Closed' }
  }
  const open = session('open'), close = session('close')
  return { operatingDay: activeDay && activeRange, runDate, timezone: local.zoneName!, kind, open, close, status: open.accepting || close.accepting ? 'Open' : local < start && active ? 'Upcoming' : 'Closed' }
}
