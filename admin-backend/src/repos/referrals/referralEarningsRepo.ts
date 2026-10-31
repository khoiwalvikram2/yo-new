import { db } from '@src/db/client.js'
import {
  referralEarnings,
  referralSettlements,
} from '@src/db/schema.js'
import { and, eq, desc, gte, lte, sql, between, count } from 'drizzle-orm'

// ===== Referral Earnings =====

export async function createReferralEarningDb(
  tenant: string,
  data: {
    attributionId: number
    ruleId: number
    referrerId: number
    refereeId: number
    tier: number
    ruleType: string
    grossAmount: number
    netAmount: number
    currency: string
    eventData?: Record<string, any>
  }
) {
  const inserted = await db
    .insert(referralEarnings)
    .values({
      tenant,
      attributionId: data.attributionId,
      ruleId: data.ruleId,
      referrerId: data.referrerId,
      refereeId: data.refereeId,
      tier: data.tier,
      ruleType: data.ruleType as any,
      grossAmount: String(data.grossAmount),
      netAmount: String(data.netAmount),
      currency: data.currency,
      eventData: (data.eventData || {}) as any,
    })
    .returning()
  return inserted[0]
}

export async function getReferralEarningsByReferrerDb(
  referrerId: number,
  tenant: string,
  filters?: {
    ruleType?: string
    tier?: number
    fromDate?: Date
    toDate?: Date
  }
) {
  const conditions = [
    eq(referralEarnings.referrerId, referrerId),
    eq(referralEarnings.tenant, tenant),
  ]

  if (filters?.ruleType) {
    conditions.push(eq(referralEarnings.ruleType, filters.ruleType as any))
  }
  if (filters?.tier !== undefined) {
    conditions.push(eq(referralEarnings.tier, filters.tier))
  }
  if (filters?.fromDate) {
    conditions.push(gte(referralEarnings.calculatedAt, filters.fromDate))
  }
  if (filters?.toDate) {
    conditions.push(lte(referralEarnings.calculatedAt, filters.toDate))
  }

  return db
    .select()
    .from(referralEarnings)
    .where(and(...conditions))
    .orderBy(desc(referralEarnings.calculatedAt))
}

export async function getReferralEarningsByRefereeDb(
  refereeId: number,
  tenant: string,
  filters?: {
    ruleType?: string
    tier?: number
    fromDate?: Date
    toDate?: Date
  }
) {
  const conditions = [
    eq(referralEarnings.refereeId, refereeId),
    eq(referralEarnings.tenant, tenant),
  ]
  if (filters?.ruleType) {
    conditions.push(eq(referralEarnings.ruleType, filters.ruleType as any))
  }
  if (filters?.tier !== undefined) {
    conditions.push(eq(referralEarnings.tier, filters.tier))
  }
  if (filters?.fromDate) {
    conditions.push(gte(referralEarnings.calculatedAt, filters.fromDate))
  }
  if (filters?.toDate) {
    conditions.push(lte(referralEarnings.calculatedAt, filters.toDate))
  }

  return db
    .select()
    .from(referralEarnings)
    .where(and(...conditions))
    .orderBy(desc(referralEarnings.calculatedAt))
}

/** All referral earnings for tenant (optional filters). Used when no referrerId/refereeId is provided. */
export async function getReferralEarningsAllDb(
  tenant: string,
  filters?: {
    ruleType?: string
    tier?: number
    fromDate?: Date
    toDate?: Date
  }
) {
  const conditions = [eq(referralEarnings.tenant, tenant)]
  if (filters?.ruleType) {
    conditions.push(eq(referralEarnings.ruleType, filters.ruleType as any))
  }
  if (filters?.tier !== undefined) {
    conditions.push(eq(referralEarnings.tier, filters.tier))
  }
  if (filters?.fromDate) {
    conditions.push(gte(referralEarnings.calculatedAt, filters.fromDate))
  }
  if (filters?.toDate) {
    conditions.push(lte(referralEarnings.calculatedAt, filters.toDate))
  }

  return db
    .select()
    .from(referralEarnings)
    .where(and(...conditions))
    .orderBy(desc(referralEarnings.calculatedAt))
}

export async function getReferralEarningsByRuleDb(
  ruleId: number,
  tenant: string,
  fromDate?: Date,
  toDate?: Date
) {
  const conditions = [
    eq(referralEarnings.ruleId, ruleId),
    eq(referralEarnings.tenant, tenant),
  ]
  if (fromDate) {
    conditions.push(gte(referralEarnings.calculatedAt, fromDate))
  }
  if (toDate) {
    conditions.push(lte(referralEarnings.calculatedAt, toDate))
  }

  return db
    .select()
    .from(referralEarnings)
    .where(and(...conditions))
    .orderBy(desc(referralEarnings.calculatedAt))
}

export async function getReferralEarningByIdDb(earningId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralEarnings)
    .where(and(eq(referralEarnings.id, earningId), eq(referralEarnings.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Earnings for a specific bet (eventData.betId, eventType bet_settlement). Used for rollback reversal. */
export async function getReferralEarningsByBetIdDb(
  tenant: string,
  refereeId: number,
  betId: string
) {
  return db
    .select()
    .from(referralEarnings)
    .where(
      and(
        eq(referralEarnings.tenant, tenant),
        eq(referralEarnings.refereeId, refereeId),
        sql`${referralEarnings.eventData}->>'eventType' = 'bet_settlement'`,
        sql`${referralEarnings.eventData}->>'betId' = ${betId}`
      )
    )
}

export async function getUnsettledReferralEarningsDb(
  tenant: string,
  referrerId?: number,
  ruleType?: string
) {
  // Get earnings that don't have settlements
  const conditions = [eq(referralEarnings.tenant, tenant)]
  if (referrerId) {
    conditions.push(eq(referralEarnings.referrerId, referrerId))
  }
  if (ruleType) {
    conditions.push(eq(referralEarnings.ruleType, ruleType as any))
  }

  const earnings = await db
    .select()
    .from(referralEarnings)
    .where(and(...conditions))
    .orderBy(desc(referralEarnings.calculatedAt))

  // Filter out earnings that already have settlements
  const settledEarningIds = await db
    .select({ earningId: referralSettlements.earningId })
    .from(referralSettlements)
    .where(eq(referralSettlements.tenant, tenant))

  const settledIds = new Set(settledEarningIds.map(s => s.earningId))
  return earnings.filter(e => !settledIds.has(e.id))
}

// ===== Referral Settlements =====

/**
 * Creates a settlement for an earning, or returns null if one already exists.
 *
 * `getUnsettledReferralEarningsDb` decides what is unsettled by reading every
 * earning, reading every settlement, and filtering in JavaScript. Two concurrent
 * `settleEarnings` calls for the same referrer therefore both saw the same
 * earning as unsettled, both inserted a settlement, and both credited the
 * referrer's wallet — the same earning paid twice.
 *
 * The lock is taken on the EARNING row, which is the unit of work: whoever
 * holds it re-reads the settlements table and finds the winner's row, so the
 * loser gets null and credits nothing. A unique index on `earning_id` would say
 * the same thing in the schema; this needs no migration.
 */
export async function createReferralSettlementIfAbsent(
  tenant: string,
  data: {
    earningId: number
    referrerId: number
    payoutType: 'CASH' | 'BONUS' | 'SPLIT'
    cashAmount: number
    bonusAmount: number
    currency: string
    escrowStatus?: 'none' | 'pending_kyc' | 'pending_fraud_check' | 'released' | 'held'
  }
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM referral_earnings WHERE id = ${data.earningId} AND tenant = ${tenant} FOR UPDATE`
    )
    const existing = await tx
      .select({ id: referralSettlements.id })
      .from(referralSettlements)
      .where(
        and(
          eq(referralSettlements.tenant, tenant),
          eq(referralSettlements.earningId, data.earningId)
        )
      )
      .limit(1)
    if (existing.length) return null

    const inserted = await tx
      .insert(referralSettlements)
      .values({
        tenant,
        earningId: data.earningId,
        referrerId: data.referrerId,
        payoutType: data.payoutType as any,
        cashAmount: String(data.cashAmount),
        bonusAmount: String(data.bonusAmount),
        currency: data.currency,
        status: 'pending' as any,
        escrowStatus: (data.escrowStatus || 'none') as any,
      })
      .returning()
    return inserted[0] ?? null
  })
}

export async function createReferralSettlementDb(
  tenant: string,
  data: {
    earningId: number
    referrerId: number
    payoutType: 'CASH' | 'BONUS' | 'SPLIT'
    cashAmount: number
    bonusAmount: number
    currency: string
    escrowStatus?: 'none' | 'pending_kyc' | 'pending_fraud_check' | 'released' | 'held'
  }
) {
  const inserted = await db
    .insert(referralSettlements)
    .values({
      tenant,
      earningId: data.earningId,
      referrerId: data.referrerId,
      payoutType: data.payoutType as any,
      cashAmount: String(data.cashAmount),
      bonusAmount: String(data.bonusAmount),
      currency: data.currency,
      status: 'pending' as any,
      escrowStatus: (data.escrowStatus || 'none') as any,
    })
    .returning()
  return inserted[0]
}

export async function getReferralSettlementByIdDb(settlementId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralSettlements)
    .where(and(eq(referralSettlements.id, settlementId), eq(referralSettlements.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralSettlementByEarningDb(earningId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralSettlements)
    .where(and(eq(referralSettlements.earningId, earningId), eq(referralSettlements.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralSettlementsByReferrerDb(
  referrerId: number,
  tenant: string,
  filters?: {
    status?: string
    fromDate?: Date
    toDate?: Date
  }
) {
  const conditions = [
    eq(referralSettlements.referrerId, referrerId),
    eq(referralSettlements.tenant, tenant),
  ]

  if (filters?.status) {
    conditions.push(eq(referralSettlements.status, filters.status as any))
  }
  if (filters?.fromDate) {
    conditions.push(gte(referralSettlements.createdAt, filters.fromDate))
  }
  if (filters?.toDate) {
    conditions.push(lte(referralSettlements.createdAt, filters.toDate))
  }

  return db
    .select()
    .from(referralSettlements)
    .where(and(...conditions))
    .orderBy(desc(referralSettlements.createdAt))
}

export async function updateReferralSettlementStatusDb(
  settlementId: number,
  tenant: string,
  data: {
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
    escrowStatus?: 'none' | 'pending_kyc' | 'pending_fraud_check' | 'released' | 'held'
    walletTransactionId?: number
    bonusAwardId?: number
    settledAt?: Date
  }
) {
  const updated = await db
    .update(referralSettlements)
    .set({
      ...(data.status && { status: data.status as any }),
      ...(data.escrowStatus && { escrowStatus: data.escrowStatus as any }),
      ...(data.walletTransactionId && { walletTransactionId: data.walletTransactionId }),
      ...(data.bonusAwardId && { bonusAwardId: data.bonusAwardId }),
      ...(data.settledAt && { settledAt: data.settledAt }),
    })
    .where(and(eq(referralSettlements.id, settlementId), eq(referralSettlements.tenant, tenant)))
    .returning()
  return updated[0] ?? null
}

export async function getPendingReferralSettlementsDb(
  tenant: string,
  escrowStatus?: 'none' | 'pending_kyc' | 'pending_fraud_check'
) {
  const conditions = [
    eq(referralSettlements.tenant, tenant),
    eq(referralSettlements.status, 'pending' as any),
  ]
  if (escrowStatus) {
    conditions.push(eq(referralSettlements.escrowStatus, escrowStatus as any))
  } else {
    conditions.push(eq(referralSettlements.escrowStatus, 'none' as any))
  }

  return db
    .select()
    .from(referralSettlements)
    .where(and(...conditions))
    .orderBy(referralSettlements.createdAt)
}

// ===== Top Referrers Stats =====

export async function getTopReferrersDb(
  tenant: string,
  options?: {
    limit?: number
    sortBy?: 'referrals' | 'earnings' | 'conversion'
    fromDate?: Date
    toDate?: Date
  }
) {
  const limit = options?.limit || 100
  const sortBy = options?.sortBy || 'earnings'
  const fromDate = options?.fromDate
  const toDate = options?.toDate

  // Get all earnings grouped by referrer
  const conditions = [eq(referralEarnings.tenant, tenant)]
  if (fromDate) {
    conditions.push(gte(referralEarnings.calculatedAt, fromDate))
  }
  if (toDate) {
    conditions.push(lte(referralEarnings.calculatedAt, toDate))
  }

  const earnings = await db
    .select({
      referrerId: referralEarnings.referrerId,
      totalEarnings: sql<number>`SUM(CAST(${referralEarnings.netAmount} AS DECIMAL))`.as('totalEarnings'),
      totalReferrals: sql<number>`COUNT(DISTINCT ${referralEarnings.refereeId})`.as('totalReferrals'),
      totalTransactions: sql<number>`COUNT(*)`.as('totalTransactions'),
    })
    .from(referralEarnings)
    .where(and(...conditions))
    .groupBy(referralEarnings.referrerId)

  // Get clicks and attributions for conversion rate
  const { referralClicks, referralAttributions } = await import('@src/db/schema.js')

  const clicksConditions = [eq(referralClicks.tenant, tenant)]
  if (fromDate) {
    clicksConditions.push(gte(referralClicks.clickedAt, fromDate))
  }
  if (toDate) {
    clicksConditions.push(lte(referralClicks.clickedAt, toDate))
  }

  const clicksByReferrer = await db
    .select({
      referrerId: referralClicks.referrerId,
      totalClicks: count(),
    })
    .from(referralClicks)
    .where(and(...clicksConditions))
    .groupBy(referralClicks.referrerId)

  const attributionsConditions = [eq(referralAttributions.tenant, tenant)]
  if (fromDate) {
    attributionsConditions.push(gte(referralAttributions.attributedAt, fromDate))
  }
  if (toDate) {
    attributionsConditions.push(lte(referralAttributions.attributedAt, toDate))
  }

  const attributionsByReferrer = await db
    .select({
      referrerId: referralAttributions.referrerId,
      totalAttributions: count(),
      activeReferrals: sql<number>`COUNT(DISTINCT CASE WHEN ${referralAttributions.status} = 'confirmed' THEN ${referralAttributions.refereeId} END)`.as('activeReferrals'),
    })
    .from(referralAttributions)
    .where(and(...attributionsConditions))
    .groupBy(referralAttributions.referrerId)

  // Combine data
  const clicksMap = new Map(clicksByReferrer.map(c => [c.referrerId, Number(c.totalClicks)]))
  const attributionsMap = new Map(attributionsByReferrer.map(a => [a.referrerId, {
    total: Number(a.totalAttributions),
    active: Number(a.activeReferrals),
  }]))

  const topReferrers = earnings.map(e => {
    const clicks = clicksMap.get(e.referrerId) || 0
    const attributions = attributionsMap.get(e.referrerId) || { total: 0, active: 0 }
    const conversionRate = clicks > 0 ? (attributions.total / clicks) * 100 : 0

    return {
      referrerId: e.referrerId,
      totalEarnings: Number(e.totalEarnings) || 0,
      totalReferrals: Number(e.totalReferrals) || 0,
      activeReferrals: attributions.active,
      totalTransactions: Number(e.totalTransactions) || 0,
      totalClicks: clicks,
      conversionRate: Number(conversionRate.toFixed(2)),
    }
  })

  // Sort by selected criteria
  if (sortBy === 'referrals') {
    topReferrers.sort((a, b) => b.totalReferrals - a.totalReferrals)
  } else if (sortBy === 'conversion') {
    topReferrers.sort((a, b) => b.conversionRate - a.conversionRate)
  } else {
    topReferrers.sort((a, b) => b.totalEarnings - a.totalEarnings)
  }

  return topReferrers.slice(0, limit)
}

export async function getReferrerStatsDb(
  referrerId: number,
  tenant: string,
  options?: {
    fromDate?: Date
    toDate?: Date
  }
) {
  const fromDate = options?.fromDate
  const toDate = options?.toDate

  // Get earnings stats
  const earningsConditions = [
    eq(referralEarnings.referrerId, referrerId),
    eq(referralEarnings.tenant, tenant),
  ]
  if (fromDate) {
    earningsConditions.push(gte(referralEarnings.calculatedAt, fromDate))
  }
  if (toDate) {
    earningsConditions.push(lte(referralEarnings.calculatedAt, toDate))
  }

  const earningsStats = await db
    .select({
      totalEarnings: sql<number>`SUM(CAST(${referralEarnings.netAmount} AS DECIMAL))`.as('totalEarnings'),
      grossEarnings: sql<number>`SUM(CAST(${referralEarnings.grossAmount} AS DECIMAL))`.as('grossEarnings'),
      totalReferrals: sql<number>`COUNT(DISTINCT ${referralEarnings.refereeId})`.as('totalReferrals'),
      totalTransactions: sql<number>`COUNT(*)`.as('totalTransactions'),
    })
    .from(referralEarnings)
    .where(and(...earningsConditions))

  // Get clicks and attributions
  const { referralClicks, referralAttributions } = await import('@src/db/schema.js')

  const clicksConditions = [
    eq(referralClicks.referrerId, referrerId),
    eq(referralClicks.tenant, tenant),
  ]
  if (fromDate) {
    clicksConditions.push(gte(referralClicks.clickedAt, fromDate))
  }
  if (toDate) {
    clicksConditions.push(lte(referralClicks.clickedAt, toDate))
  }

  const clicksStats = await db
    .select({
      totalClicks: count(),
    })
    .from(referralClicks)
    .where(and(...clicksConditions))

  const attributionsConditions = [
    eq(referralAttributions.referrerId, referrerId),
    eq(referralAttributions.tenant, tenant),
  ]
  if (fromDate) {
    attributionsConditions.push(gte(referralAttributions.attributedAt, fromDate))
  }
  if (toDate) {
    attributionsConditions.push(lte(referralAttributions.attributedAt, toDate))
  }

  const attributionsStats = await db
    .select({
      totalAttributions: count(),
      activeReferrals: sql<number>`COUNT(DISTINCT CASE WHEN ${referralAttributions.status} = 'confirmed' THEN ${referralAttributions.refereeId} END)`.as('activeReferrals'),
    })
    .from(referralAttributions)
    .where(and(...attributionsConditions))

  // Get earnings by rule type
  const earningsByRule = await db
    .select({
      ruleType: referralEarnings.ruleType,
      totalEarnings: sql<number>`SUM(CAST(${referralEarnings.netAmount} AS DECIMAL))`.as('totalEarnings'),
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(referralEarnings)
    .where(and(...earningsConditions))
    .groupBy(referralEarnings.ruleType)

  const stats = earningsStats[0] || {
    totalEarnings: 0,
    grossEarnings: 0,
    totalReferrals: 0,
    totalTransactions: 0,
  }
  const clicks = clicksStats[0]?.totalClicks || 0
  const attributions = attributionsStats[0] || { totalAttributions: 0, activeReferrals: 0 }
  const conversionRate = clicks > 0 ? (Number(attributions.totalAttributions) / clicks) * 100 : 0

  return {
    referrerId,
    totalEarnings: Number(stats.totalEarnings) || 0,
    grossEarnings: Number(stats.grossEarnings) || 0,
    totalReferrals: Number(stats.totalReferrals) || 0,
    activeReferrals: Number(attributions.activeReferrals) || 0,
    totalTransactions: Number(stats.totalTransactions) || 0,
    totalClicks: clicks,
    totalAttributions: Number(attributions.totalAttributions) || 0,
    conversionRate: Number(conversionRate.toFixed(2)),
    earningsByRuleType: earningsByRule.map(e => ({
      ruleType: e.ruleType,
      totalEarnings: Number(e.totalEarnings) || 0,
      count: Number(e.count) || 0,
    })),
  }
}

