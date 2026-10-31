import { DateTime } from 'luxon'
import { matkaKind, type MatkaSession } from './rules.js'

type Market = { status: string; timezone: string; schedule: unknown; settings: unknown; deletedAt?: Date | null }
type SessionOverride = { side: string; status: string; scheduledLockAtUtc?: Date | null; suspendMinutesOverride?: number | null; resultPublishedAtUtc?: Date | null }
type Settings = { matkaType?: string; betWindowMinsBeforeOpen?: number; betWindowMinsBeforeClose?: number; openSuspended?: boolean; closeSuspended?: boolean; message?: string; bettingStartTime?: string }
type Schedule = { openTime: string; closeTime: string; daysOfWeek?: number[]; closesNextDay?: boolean; effectiveFrom?: string; effectiveTo?: string }
function clock(value: string) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) throw new Error('Market times must use HH:mm'); return value }
export function matkaSchedule(market: Market, now = new Date(), overrides: SessionOverride[] = [], results: Partial<Record<MatkaSession, string>> = {}) {
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
    const manualBlocked = !!override && ['PAUSED', 'LOCKED', 'CLOSED', 'SETTLING', 'SETTLED', 'VOIDED'].includes(override.status)
    const enabled = kind === 'starline' ? side === 'open' : kind === 'jackpot' || kind === 'sattaMatka' ? side === 'close' : true
    const suspended = side === 'open' ? settings.openSuspended : settings.closeSuspended
    const accepting = !!(enabled && active && !suspended && !manualBlocked && !results[side] && !override?.resultPublishedAtUtc && local >= start && local < lockAt)
    return { side, enabled, accepting, resultAt: resultAt.toUTC().toISO()!, lockAt: lockAt.toUTC().toISO()!, startsAt: start.toUTC().toISO()!, status: accepting ? 'Open' : local < start && active ? 'Upcoming' : 'Closed' }
  }
  const open = session('open'), close = session('close')
  return { operatingDay: activeDay && activeRange, runDate, timezone: local.zoneName!, kind, open, close, status: open.accepting || close.accepting ? 'Open' : local < start && active ? 'Upcoming' : 'Closed' }
}
