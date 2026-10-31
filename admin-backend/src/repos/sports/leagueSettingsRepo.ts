import { db } from '@src/db/client'
import { leagueSettingsTable } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'

export async function getLeagueSettings(whitelabelId: string, leagueId: string, tierId: string) {
  const rows = await db.select().from(leagueSettingsTable).where(
    and(
      eq(leagueSettingsTable.whitelabelId, whitelabelId),
      eq(leagueSettingsTable.leagueId, leagueId),
      eq(leagueSettingsTable.tierId, tierId),
    )
  )
  if (!rows.length) return null
  const r = rows[0]
  return {
    id: String(r.id),
    leagueId: String(r.leagueId),
    tierId: String(r.tierId),
    exchangeMinStake: r.exchangeMinStake != null ? Number(r.exchangeMinStake) : null,
    exchangeMaxStake: r.exchangeMaxStake != null ? Number(r.exchangeMaxStake) : null,
    bookmakerMinStake: r.bookmakerMinStake != null ? Number(r.bookmakerMinStake) : null,
    bookmakerMaxStake: r.bookmakerMaxStake != null ? Number(r.bookmakerMaxStake) : null,
    fancyMinStake: r.fancyMinStake != null ? Number(r.fancyMinStake) : null,
    fancyMaxStake: r.fancyMaxStake != null ? Number(r.fancyMaxStake) : null,
    exchangeDelay: r.exchangeDelay == null ? null : Number(r.exchangeDelay),
    bookmakerDelay: r.bookmakerDelay == null ? null : Number(r.bookmakerDelay),
    fancyDelay: r.fancyDelay == null ? null : Number(r.fancyDelay),
    exchangeCooldown: r.exchangeCooldown == null ? null : Number(r.exchangeCooldown),
    bookmakerCooldown: r.bookmakerCooldown == null ? null : Number(r.bookmakerCooldown),
    fancyCooldown: r.fancyCooldown == null ? null : Number(r.fancyCooldown),
    exchangeMinOdds: r.exchangeMinOdds != null ? Number(r.exchangeMinOdds) : null,
    exchangeMaxOdds: r.exchangeMaxOdds != null ? Number(r.exchangeMaxOdds) : null,
    exchangeCommission: r.exchangeCommission != null ? Number(r.exchangeCommission) : null,
    bookmakerCommission: r.bookmakerCommission != null ? Number(r.bookmakerCommission) : null,
    fancyCommission: r.fancyCommission != null ? Number(r.fancyCommission) : null,
    exchangeExposureDaily: r.exchangeExposureDaily != null ? Number(r.exchangeExposureDaily) : null,
    exchangeExposureWeekly: r.exchangeExposureWeekly != null ? Number(r.exchangeExposureWeekly) : null,
    exchangeExposureCap: r.exchangeExposureCap != null ? Number(r.exchangeExposureCap) : null,
    bookmakerExposureDaily: r.bookmakerExposureDaily != null ? Number(r.bookmakerExposureDaily) : null,
    bookmakerExposureWeekly: r.bookmakerExposureWeekly != null ? Number(r.bookmakerExposureWeekly) : null,
    bookmakerExposureCap: r.bookmakerExposureCap != null ? Number(r.bookmakerExposureCap) : null,
    fancyExposureDaily: r.fancyExposureDaily != null ? Number(r.fancyExposureDaily) : null,
    fancyExposureWeekly: r.fancyExposureWeekly != null ? Number(r.fancyExposureWeekly) : null,
    fancyExposureCap: r.fancyExposureCap != null ? Number(r.fancyExposureCap) : null,
    cashoutActive: r.cashoutActive ?? null,
    riskLevel: r.riskLevel ?? null,
    riskThreshold: r.riskThreshold != null ? Number(r.riskThreshold) : null,
    volatilityThreshold: r.volatilityThreshold != null ? Number(r.volatilityThreshold) : null,
    alertOnBreach: r.alertOnBreach ?? null,
    alertChannel: r.alertChannel ?? null,
    alertRateLimit: r.alertRateLimit != null ? Number(r.alertRateLimit) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export type UpsertLeagueSettingsInput = {
  whitelabelId: string
  leagueId: string
  tierId: string
  exchangeMinStake?: number | null
  exchangeMaxStake?: number | null
  bookmakerMinStake?: number | null
  bookmakerMaxStake?: number | null
  fancyMinStake?: number | null
  fancyMaxStake?: number | null
  exchangeDelay?: number | null
  bookmakerDelay?: number | null
  fancyDelay?: number | null
  exchangeCooldown?: number | null
  bookmakerCooldown?: number | null
  fancyCooldown?: number | null
  exchangeMinOdds?: number | null
  exchangeMaxOdds?: number | null
  exchangeCommission?: number | null
  bookmakerCommission?: number | null
  fancyCommission?: number | null
  exchangeExposureDaily?: number | null
  exchangeExposureWeekly?: number | null
  exchangeExposureCap?: number | null
  bookmakerExposureDaily?: number | null
  bookmakerExposureWeekly?: number | null
  bookmakerExposureCap?: number | null
  fancyExposureDaily?: number | null
  fancyExposureWeekly?: number | null
  fancyExposureCap?: number | null
  cashoutActive?: boolean | null
  riskLevel?: string | null
  riskThreshold?: number | null
  volatilityThreshold?: number | null
  alertOnBreach?: boolean | null
  alertChannel?: string | null
  alertRateLimit?: number | null
}

export async function upsertLeagueSettingsRepo(input: UpsertLeagueSettingsInput) {
  const existing = await db.select().from(leagueSettingsTable).where(
    and(
      eq(leagueSettingsTable.whitelabelId, input.whitelabelId),
      eq(leagueSettingsTable.leagueId, input.leagueId),
      eq(leagueSettingsTable.tierId, input.tierId),
    )
  )

  const data = {
    whitelabelId: input.whitelabelId,
    leagueId: input.leagueId,
    tierId: input.tierId,
    exchangeMinStake: input.exchangeMinStake != null ? String(input.exchangeMinStake) : null,
    exchangeMaxStake: input.exchangeMaxStake != null ? String(input.exchangeMaxStake) : null,
    bookmakerMinStake: input.bookmakerMinStake != null ? String(input.bookmakerMinStake) : null,
    bookmakerMaxStake: input.bookmakerMaxStake != null ? String(input.bookmakerMaxStake) : null,
    fancyMinStake: input.fancyMinStake != null ? String(input.fancyMinStake) : null,
    fancyMaxStake: input.fancyMaxStake != null ? String(input.fancyMaxStake) : null,
    exchangeDelay: input.exchangeDelay ?? null,
    bookmakerDelay: input.bookmakerDelay ?? null,
    fancyDelay: input.fancyDelay ?? null,
    exchangeCooldown: input.exchangeCooldown ?? null,
    bookmakerCooldown: input.bookmakerCooldown ?? null,
    fancyCooldown: input.fancyCooldown ?? null,
    exchangeMinOdds: input.exchangeMinOdds != null ? String(input.exchangeMinOdds) : null,
    exchangeMaxOdds: input.exchangeMaxOdds != null ? String(input.exchangeMaxOdds) : null,
    exchangeCommission: input.exchangeCommission != null ? String(input.exchangeCommission) : null,
    bookmakerCommission: input.bookmakerCommission != null ? String(input.bookmakerCommission) : null,
    fancyCommission: input.fancyCommission != null ? String(input.fancyCommission) : null,
    exchangeExposureDaily: input.exchangeExposureDaily != null ? String(input.exchangeExposureDaily) : null,
    exchangeExposureWeekly: input.exchangeExposureWeekly != null ? String(input.exchangeExposureWeekly) : null,
    exchangeExposureCap: input.exchangeExposureCap != null ? String(input.exchangeExposureCap) : null,
    bookmakerExposureDaily: input.bookmakerExposureDaily != null ? String(input.bookmakerExposureDaily) : null,
    bookmakerExposureWeekly: input.bookmakerExposureWeekly != null ? String(input.bookmakerExposureWeekly) : null,
    bookmakerExposureCap: input.bookmakerExposureCap != null ? String(input.bookmakerExposureCap) : null,
    fancyExposureDaily: input.fancyExposureDaily != null ? String(input.fancyExposureDaily) : null,
    fancyExposureWeekly: input.fancyExposureWeekly != null ? String(input.fancyExposureWeekly) : null,
    fancyExposureCap: input.fancyExposureCap != null ? String(input.fancyExposureCap) : null,
    cashoutActive: input.cashoutActive ?? null,
    riskLevel: input.riskLevel ?? null,
    riskThreshold: input.riskThreshold != null ? String(input.riskThreshold) : null,
    volatilityThreshold: input.volatilityThreshold != null ? String(input.volatilityThreshold) : null,
    alertOnBreach: input.alertOnBreach ?? null,
    alertChannel: input.alertChannel ?? null,
    alertRateLimit: input.alertRateLimit ?? null,
    updatedAt: new Date(),
  }

  if (existing.length) {
    await db.update(leagueSettingsTable).set(data).where(eq(leagueSettingsTable.id, existing[0].id))
  } else {
    await db.insert(leagueSettingsTable).values({ ...data, createdAt: new Date() })
  }
}

