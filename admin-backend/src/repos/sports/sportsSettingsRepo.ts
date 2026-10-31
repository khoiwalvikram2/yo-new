import { and, eq } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { sportsSettingsTable } from '@shared/db/schema.js'

export type SportSettings = {
  sportId: string
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

export async function getSportSettings(whitelabelId: string, sportId: string, tierId: string | null): Promise<SportSettings | null> {
  const tid = tierId || 'default'
  const rows = await db.select().from(sportsSettingsTable)
    .where(and(eq(sportsSettingsTable.whitelabelId, whitelabelId), eq(sportsSettingsTable.sportId, sportId), eq(sportsSettingsTable.tierId, tid)))
  let r: any = rows[0]
  if (!r && tid !== 'default') {
    const fallback = await db.select().from(sportsSettingsTable)
      .where(and(eq(sportsSettingsTable.whitelabelId, whitelabelId), eq(sportsSettingsTable.sportId, sportId), eq(sportsSettingsTable.tierId, 'default')))
    r = fallback[0]
  }
  if (!r) return null
  return mapRow(r)
}

export async function upsertSportSettings(params: {
  whitelabelId: string
  sportIds: string[]
  tierId: string | null
  mode: 'overwrite' | 'fill-empty' | 'replace-all'
  input: Omit<SportSettings, 'sportId' | 'tierId'>
}) {
  const tierId = params.tierId || 'default'
  let affected = 0
  for (const sportId of params.sportIds) {
    const existingRows = await db.select().from(sportsSettingsTable)
      .where(and(eq(sportsSettingsTable.whitelabelId, params.whitelabelId), eq(sportsSettingsTable.sportId, sportId), eq(sportsSettingsTable.tierId, tierId)))
    if (existingRows.length) {
      const current = existingRows[0]
      const next = buildUpdate(current, params.input, params.mode)
      await db.update(sportsSettingsTable).set({ ...next, updatedAt: new Date() })
        .where(and(eq(sportsSettingsTable.whitelabelId, params.whitelabelId), eq(sportsSettingsTable.sportId, sportId), eq(sportsSettingsTable.tierId, tierId)))
    } else {
      await db.insert(sportsSettingsTable).values({
        tenant: 'default',
        whitelabelId: params.whitelabelId,
        sportId,
        tierId,
        ...sanitize(params.input),
      })
    }
    affected++
  }
  return { affected }
}

function mapRow(r: any): SportSettings {
  return {
    sportId: String(r.sportId),
    tierId: String(r.tierId),
    exchangeMinStake: num(r.exchangeMinStake),
    exchangeMaxStake: num(r.exchangeMaxStake),
    bookmakerMinStake: num(r.bookmakerMinStake),
    bookmakerMaxStake: num(r.bookmakerMaxStake),
    fancyMinStake: num(r.fancyMinStake),
    fancyMaxStake: num(r.fancyMaxStake),
    exchangeDelay: r.exchangeDelay == null ? null : Number(r.exchangeDelay),
    bookmakerDelay: r.bookmakerDelay == null ? null : Number(r.bookmakerDelay),
    fancyDelay: r.fancyDelay == null ? null : Number(r.fancyDelay),
    exchangeCooldown: r.exchangeCooldown == null ? null : Number(r.exchangeCooldown),
    bookmakerCooldown: r.bookmakerCooldown == null ? null : Number(r.bookmakerCooldown),
    fancyCooldown: r.fancyCooldown == null ? null : Number(r.fancyCooldown),
    exchangeMinOdds: num(r.exchangeMinOdds),
    exchangeMaxOdds: num(r.exchangeMaxOdds),
    exchangeCommission: num(r.exchangeCommission),
    bookmakerCommission: num(r.bookmakerCommission),
    fancyCommission: num(r.fancyCommission),
    exchangeExposureDaily: num(r.exchangeExposureDaily),
    exchangeExposureWeekly: num(r.exchangeExposureWeekly),
    exchangeExposureCap: num(r.exchangeExposureCap),
    bookmakerExposureDaily: num(r.bookmakerExposureDaily),
    bookmakerExposureWeekly: num(r.bookmakerExposureWeekly),
    bookmakerExposureCap: num(r.bookmakerExposureCap),
    fancyExposureDaily: num(r.fancyExposureDaily),
    fancyExposureWeekly: num(r.fancyExposureWeekly),
    fancyExposureCap: num(r.fancyExposureCap),
    cashoutActive: bool(r.cashoutActive),
    riskLevel: r.riskLevel ?? null,
    riskThreshold: num(r.riskThreshold),
    volatilityThreshold: num(r.volatilityThreshold),
    alertOnBreach: bool(r.alertOnBreach),
    alertChannel: r.alertChannel ?? null,
    alertRateLimit: r.alertRateLimit == null ? null : Number(r.alertRateLimit),
  }
}

function num(v: any): number | null { return v == null ? null : Number(v) }
function bool(v: any): boolean | null { return v == null ? null : Boolean(v) }

function buildUpdate(current: any, input: any, mode: 'overwrite'|'fill-empty'|'replace-all') {
  const next: Record<string, any> = {}
  const entries = Object.entries(input)
  for (const [k, v] of entries) {
    // Skip undefined values, but include null and 0
    if (v === undefined) continue
    if (mode === 'fill-empty') {
      if (current[k] == null) next[k] = v as any
    } else {
      // For overwrite and replace-all, include the value (even if null or 0)
      next[k] = v as any
    }
  }
  return next
}

function sanitize(input: any) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

