import { db } from '@src/db/client.js'
import { riskConfigTable } from '@shared/db/schema.js'
import { eq, and } from 'drizzle-orm'

export interface RiskPercentiles {
  liability75?: number
  liability90?: number
  liability95?: number
  exposure75?: number
  exposure90?: number
  betCount75?: number
  betCount90?: number
  odds75?: number
  odds90?: number
}

export interface RiskWeights {
  liability?: number
  exposure?: number
  volume?: number
  odds?: number
}

export interface RiskAmounts {
  highLiability?: number
  mediumLiability?: number
  highExposure?: number
  mediumExposure?: number
  highBetCount?: number
  mediumBetCount?: number
  highOdds?: number
  mediumOdds?: number
}

export interface RiskAlerts {
  enabled?: boolean
  triggerLevels?: string[]
  notificationEnabled?: boolean
  bannerEnabled?: boolean
  sidebarIndicatorEnabled?: boolean
  cooldownSeconds?: number
}

export interface RiskConfig {
  id: string
  tenant: string
  whitelabelId: string
  eventId: string
  percentiles: RiskPercentiles | null
  weights: RiskWeights | null
  amounts: RiskAmounts | null
  alerts: RiskAlerts | null
  createdAt: Date
  updatedAt: Date
}

export interface UpsertRiskConfigInput {
  tenant?: string
  whitelabelId: string
  eventId: string
  percentiles?: RiskPercentiles
  weights?: RiskWeights
  amounts?: RiskAmounts
  alerts?: RiskAlerts
}

/**
 * Get risk config for an event
 */
export async function getRiskConfig(
  whitelabelId: string,
  eventId: string,
  tenant: string = 'default'
): Promise<RiskConfig | null> {
  try {
    const result = await db
      .select()
      .from(riskConfigTable)
      .where(
        and(
          eq(riskConfigTable.whitelabelId, whitelabelId),
          eq(riskConfigTable.eventId, eventId),
          eq(riskConfigTable.tenant, tenant)
        )
      )
      .limit(1)

    if (result.length === 0) {
      return null
    }

    const row = result[0]
    return {
      id: row.id,
      tenant: row.tenant,
      whitelabelId: row.whitelabelId,
      eventId: row.eventId,
      percentiles: (row.percentiles as RiskPercentiles | null) || null,
      weights: (row.weights as RiskWeights | null) || null,
      amounts: (row.amounts as RiskAmounts | null) || null,
      alerts: (row.alerts as RiskAlerts | null) || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  } catch (error: any) {
    // Log error but don't throw - return null if query fails
    return null
  }
}

/**
 * Upsert risk config for an event
 */
export async function upsertRiskConfig(
  input: UpsertRiskConfigInput
): Promise<RiskConfig> {
  const tenant = input.tenant || 'default'
  const now = new Date()

  // Check if config exists
  const existing = await getRiskConfig(
    input.whitelabelId,
    input.eventId,
    tenant
  )

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(riskConfigTable)
      .set({
        percentiles: input.percentiles || null,
        weights: input.weights || null,
        amounts: input.amounts || null,
        alerts: input.alerts || null,
        updatedAt: now,
      })
      .where(
        and(
          eq(riskConfigTable.whitelabelId, input.whitelabelId),
          eq(riskConfigTable.eventId, input.eventId),
          eq(riskConfigTable.tenant, tenant)
        )
      )
      .returning()

    return {
      id: updated.id,
      tenant: updated.tenant,
      whitelabelId: updated.whitelabelId,
      eventId: updated.eventId,
      percentiles: (updated.percentiles as RiskPercentiles | null) || null,
      weights: (updated.weights as RiskWeights | null) || null,
      amounts: (updated.amounts as RiskAmounts | null) || null,
      alerts: (updated.alerts as RiskAlerts | null) || null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  } else {
    // Insert new
    const [inserted] = await db
      .insert(riskConfigTable)
      .values({
        tenant,
        whitelabelId: input.whitelabelId,
        eventId: input.eventId,
        percentiles: input.percentiles || null,
        weights: input.weights || null,
        amounts: input.amounts || null,
        alerts: input.alerts || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return {
      id: inserted.id,
      tenant: inserted.tenant,
      whitelabelId: inserted.whitelabelId,
      eventId: inserted.eventId,
      percentiles: (inserted.percentiles as RiskPercentiles | null) || null,
      weights: (inserted.weights as RiskWeights | null) || null,
      amounts: (inserted.amounts as RiskAmounts | null) || null,
      alerts: (inserted.alerts as RiskAlerts | null) || null,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    }
  }
}

