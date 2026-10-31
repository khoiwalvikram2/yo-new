import { DateTime } from 'luxon'
import { matkaKind, moneyMinor, normalizeBid, payoutMinor } from './rules.js'
import { matkaSchedule } from './schedule.js'

export function validateMatkaConfiguration(market: { timezone: string; schedule: any; settings: any; limits: any }) {
  matkaKind(market.settings)
  if (!DateTime.now().setZone(market.timezone).isValid) throw new Error('Invalid market timezone')
  const days = market.schedule?.daysOfWeek
  if (!Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Select valid operating days')
  for (const key of ['openSuspended', 'closeSuspended']) if (market.settings?.[key] !== undefined && typeof market.settings[key] !== 'boolean') throw new Error('Invalid session suspension')
  for (const key of ['effectiveFrom', 'effectiveTo']) if (market.schedule[key] && !DateTime.fromISO(market.schedule[key]).isValid) throw new Error('Invalid effective date')
  if (market.schedule.effectiveFrom && market.schedule.effectiveTo && market.schedule.effectiveFrom > market.schedule.effectiveTo) throw new Error('Effective dates are reversed')
  const min = moneyMinor(market.limits?.minBet ?? 1), max = moneyMinor(market.limits?.maxBet ?? 10000)
  if (min <= 0n || max < min) throw new Error('Maximum stake must be at least the positive minimum stake')
  if (market.settings?.autoPauseOnLiabilityThreshold != null && moneyMinor(market.settings.autoPauseOnLiabilityThreshold) < 0n) throw new Error('Liability limit cannot be negative')
  matkaSchedule({ ...market, status: 'active' })
}

export function validateMatkaRates<T extends { betType: string; payoutMultiplier: number }>(entries: T[]): T[] {
  if (!Array.isArray(entries) || !entries.length || entries.length > 10) throw new Error('Configure between 1 and 10 payout rates')
  const seen = new Set<string>()
  return entries.map(entry => {
    const betType = normalizeBid(entry.betType)
    if (seen.has(betType)) throw new Error(`Duplicate rate for ${betType}`)
    if (!Number.isFinite(entry.payoutMultiplier) || entry.payoutMultiplier >= 1000000) throw new Error('Payout multiplier must be below 1000000')
    seen.add(betType); payoutMinor(100n, entry.payoutMultiplier)
    return { ...entry, betType }
  })
}
