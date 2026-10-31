import { db } from '@src/db/client.js'
import {
  referralRaffleEntries,
  referralRaffleDraws,
} from '@src/db/schema.js'
import { and, eq, desc, gte, lte, sql, inArray } from 'drizzle-orm'

// ===== Referral Raffle Entries =====

export async function createReferralRaffleEntryDb(
  tenant: string,
  data: {
    ruleId: number
    referrerId?: number
    refereeId?: number
    entries: number
    reason?: string
  }
) {
  const inserted = await db
    .insert(referralRaffleEntries)
    .values({
      tenant,
      ruleId: data.ruleId,
      referrerId: data.referrerId ?? null,
      refereeId: data.refereeId ?? null,
      entries: data.entries,
      reason: data.reason,
    })
    .returning()
  return inserted[0]
}

export async function getReferralRaffleEntriesByRuleDb(
  ruleId: number,
  tenant: string
) {
  return db
    .select()
    .from(referralRaffleEntries)
    .where(and(eq(referralRaffleEntries.ruleId, ruleId), eq(referralRaffleEntries.tenant, tenant)))
    .orderBy(desc(referralRaffleEntries.createdAt))
}

export async function getReferralRaffleEntriesByUserDb(
  userId: number,
  tenant: string,
  isReferrer: boolean
) {
  const conditions = [eq(referralRaffleEntries.tenant, tenant)]
  if (isReferrer) {
    conditions.push(eq(referralRaffleEntries.referrerId, userId))
  } else {
    conditions.push(eq(referralRaffleEntries.refereeId, userId))
  }

  return db
    .select()
    .from(referralRaffleEntries)
    .where(and(...conditions))
    .orderBy(desc(referralRaffleEntries.createdAt))
}

export async function getTotalRaffleEntriesByRuleDb(ruleId: number, tenant: string) {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${referralRaffleEntries.entries}), 0)`.as('total'),
    })
    .from(referralRaffleEntries)
    .where(and(eq(referralRaffleEntries.ruleId, ruleId), eq(referralRaffleEntries.tenant, tenant)))
  return Number(rows[0]?.total || 0)
}

// ===== Referral Raffle Draws =====

export async function createReferralRaffleDrawDb(
  tenant: string,
  data: {
    ruleId: number
    scheduledAt: Date
  }
) {
  const totalEntries = await getTotalRaffleEntriesByRuleDb(data.ruleId, tenant)

  const inserted = await db
    .insert(referralRaffleDraws)
    .values({
      tenant,
      ruleId: data.ruleId,
      scheduledAt: data.scheduledAt,
      status: 'scheduled' as any,
      totalEntries,
      winners: [] as any,
    })
    .returning()
  return inserted[0]
}

export async function getReferralRaffleDrawByIdDb(drawId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralRaffleDraws)
    .where(and(eq(referralRaffleDraws.id, drawId), eq(referralRaffleDraws.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralRaffleDrawsByRuleDb(
  ruleId: number,
  tenant: string
) {
  return db
    .select()
    .from(referralRaffleDraws)
    .where(and(eq(referralRaffleDraws.ruleId, ruleId), eq(referralRaffleDraws.tenant, tenant)))
    .orderBy(desc(referralRaffleDraws.scheduledAt))
}

export async function getScheduledReferralRaffleDrawsDb(
  tenant: string,
  upToDate?: Date
) {
  const conditions = [
    eq(referralRaffleDraws.tenant, tenant),
    eq(referralRaffleDraws.status, 'scheduled' as any),
  ]
  if (upToDate) {
    conditions.push(lte(referralRaffleDraws.scheduledAt, upToDate))
  }

  return db
    .select()
    .from(referralRaffleDraws)
    .where(and(...conditions))
    .orderBy(referralRaffleDraws.scheduledAt)
}

export async function updateReferralRaffleDrawDb(
  drawId: number,
  tenant: string,
  data: {
    status?: 'scheduled' | 'running' | 'completed' | 'cancelled'
    winners?: Array<{ userId: number; prize: number; currency: string }>
    drawnAt?: Date
  }
) {
  const updated = await db
    .update(referralRaffleDraws)
    .set({
      ...(data.status && { status: data.status as any }),
      ...(data.winners && { winners: data.winners as any }),
      ...(data.drawnAt && { drawnAt: data.drawnAt }),
      updatedAt: new Date(),
    })
    .where(and(eq(referralRaffleDraws.id, drawId), eq(referralRaffleDraws.tenant, tenant)))
    .returning()
  return updated[0] ?? null
}

