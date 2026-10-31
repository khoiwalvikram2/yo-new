import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { sportsSettingsTable, leagueSettingsTable, eventSettingsTable } from '@shared/db/schema.js'

export type AlertConfig = {
  id: string
  riskThreshold?: number | null
  alertOnBreach?: boolean | null
  alertChannel?: string | null
  alertRateLimit?: number | null
  exchangeExposureCap?: number | null
  bookmakerExposureCap?: number | null
  fancyExposureCap?: number | null
}

const DEFAULT_TIER = 'default'

export async function getSportAlertConfigs(whitelabelId: string, sportIds: string[], tierId: string = DEFAULT_TIER): Promise<Record<string, AlertConfig>> {
  if (!sportIds.length) return {}
  const rows = await db.select({
    sportId: sportsSettingsTable.sportId,
    riskThreshold: sportsSettingsTable.riskThreshold,
    alertOnBreach: sportsSettingsTable.alertOnBreach,
    alertChannel: sportsSettingsTable.alertChannel,
    alertRateLimit: sportsSettingsTable.alertRateLimit,
    exchangeExposureCap: sportsSettingsTable.exchangeExposureCap,
    bookmakerExposureCap: sportsSettingsTable.bookmakerExposureCap,
    fancyExposureCap: sportsSettingsTable.fancyExposureCap,
  })
    .from(sportsSettingsTable)
    .where(and(
      eq(sportsSettingsTable.whitelabelId, whitelabelId),
      eq(sportsSettingsTable.tierId, tierId),
      inArray(sportsSettingsTable.sportId, sportIds),
    ))

  return rows.reduce<Record<string, AlertConfig>>((acc, row) => {
    const key = String(row.sportId)
    acc[key] = {
      id: key,
      riskThreshold: toNumber(row.riskThreshold),
      alertOnBreach: toBool(row.alertOnBreach),
      alertChannel: row.alertChannel ?? null,
      alertRateLimit: row.alertRateLimit != null ? Number(row.alertRateLimit) : null,
      exchangeExposureCap: toNumber(row.exchangeExposureCap),
      bookmakerExposureCap: toNumber(row.bookmakerExposureCap),
      fancyExposureCap: toNumber(row.fancyExposureCap),
    }
    return acc
  }, {})
}

export async function getLeagueAlertConfigs(whitelabelId: string, leagueIds: string[], tierId: string = DEFAULT_TIER): Promise<Record<string, AlertConfig>> {
  if (!leagueIds.length) return {}
  const rows = await db.select({
    leagueId: leagueSettingsTable.leagueId,
    riskThreshold: leagueSettingsTable.riskThreshold,
    alertOnBreach: leagueSettingsTable.alertOnBreach,
    alertChannel: leagueSettingsTable.alertChannel,
    alertRateLimit: leagueSettingsTable.alertRateLimit,
    exchangeExposureCap: leagueSettingsTable.exchangeExposureCap,
    bookmakerExposureCap: leagueSettingsTable.bookmakerExposureCap,
    fancyExposureCap: leagueSettingsTable.fancyExposureCap,
  })
    .from(leagueSettingsTable)
    .where(and(
      eq(leagueSettingsTable.whitelabelId, whitelabelId),
      eq(leagueSettingsTable.tierId, tierId),
      inArray(leagueSettingsTable.leagueId, leagueIds),
    ))

  return rows.reduce<Record<string, AlertConfig>>((acc, row) => {
    const key = String(row.leagueId)
    acc[key] = {
      id: key,
      riskThreshold: toNumber(row.riskThreshold),
      alertOnBreach: toBool(row.alertOnBreach),
      alertChannel: row.alertChannel ?? null,
      alertRateLimit: row.alertRateLimit != null ? Number(row.alertRateLimit) : null,
      exchangeExposureCap: toNumber(row.exchangeExposureCap),
      bookmakerExposureCap: toNumber(row.bookmakerExposureCap),
      fancyExposureCap: toNumber(row.fancyExposureCap),
    }
    return acc
  }, {})
}

export async function getEventAlertConfigs(whitelabelId: string, eventIds: string[], tierId: string = DEFAULT_TIER): Promise<Record<string, AlertConfig>> {
  if (!eventIds.length) return {}
  const rows = await db.select({
    eventId: eventSettingsTable.eventId,
    riskThreshold: eventSettingsTable.riskThreshold,
    alertOnBreach: eventSettingsTable.alertOnBreach,
    alertChannel: eventSettingsTable.alertChannel,
    alertRateLimit: eventSettingsTable.alertRateLimit,
    exchangeExposureCap: eventSettingsTable.exchangeExposureCap,
    bookmakerExposureCap: eventSettingsTable.bookmakerExposureCap,
    fancyExposureCap: eventSettingsTable.fancyExposureCap,
  })
    .from(eventSettingsTable)
    .where(and(
      eq(eventSettingsTable.whitelabelId, whitelabelId),
      eq(eventSettingsTable.tierId, tierId),
      inArray(eventSettingsTable.eventId, eventIds),
    ))

  return rows.reduce<Record<string, AlertConfig>>((acc, row) => {
    const key = String(row.eventId)
    acc[key] = {
      id: key,
      riskThreshold: toNumber(row.riskThreshold),
      alertOnBreach: toBool(row.alertOnBreach),
      alertChannel: row.alertChannel ?? null,
      alertRateLimit: row.alertRateLimit != null ? Number(row.alertRateLimit) : null,
      exchangeExposureCap: toNumber(row.exchangeExposureCap),
      bookmakerExposureCap: toNumber(row.bookmakerExposureCap),
      fancyExposureCap: toNumber(row.fancyExposureCap),
    }
    return acc
  }, {})
}

function toNumber(value: unknown): number | null {
  if (value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toBool(value: unknown): boolean | null {
  if (value == null) return null
  return Boolean(value)
}

