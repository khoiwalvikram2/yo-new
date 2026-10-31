import { db } from '@src/db/client.js'
import { referralCoupons } from '@src/db/schema.js'
import { and, eq, desc, gte, lte, sql } from 'drizzle-orm'

// ===== Referral Coupons =====

export async function createReferralCouponDb(
  tenant: string,
  data: {
    ruleId: number
    referrerId?: number
    refereeId?: number
    couponCode: string
    bonusCampaignId?: number
    amount: number
    currency: string
    expiresAt?: Date
  }
) {
  const inserted = await db
    .insert(referralCoupons)
    .values({
      tenant,
      ruleId: data.ruleId,
      referrerId: data.referrerId ?? null,
      refereeId: data.refereeId ?? null,
      couponCode: data.couponCode,
      bonusCampaignId: data.bonusCampaignId ?? null,
      amount: String(data.amount),
      currency: data.currency,
      status: 'active' as any,
      expiresAt: data.expiresAt,
    })
    .returning()
  return inserted[0]
}

export async function getReferralCouponByCodeDb(code: string, tenant: string) {
  const rows = await db
    .select()
    .from(referralCoupons)
    .where(and(eq(referralCoupons.couponCode, code), eq(referralCoupons.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralCouponByIdDb(couponId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralCoupons)
    .where(and(eq(referralCoupons.id, couponId), eq(referralCoupons.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

export async function getReferralCouponsByRuleDb(
  ruleId: number,
  tenant: string
) {
  return db
    .select()
    .from(referralCoupons)
    .where(and(eq(referralCoupons.ruleId, ruleId), eq(referralCoupons.tenant, tenant)))
    .orderBy(desc(referralCoupons.createdAt))
}

export async function getReferralCouponsByUserDb(
  userId: number,
  tenant: string,
  isReferrer: boolean
) {
  const conditions = [eq(referralCoupons.tenant, tenant)]
  if (isReferrer) {
    conditions.push(eq(referralCoupons.referrerId, userId))
  } else {
    conditions.push(eq(referralCoupons.refereeId, userId))
  }

  return db
    .select()
    .from(referralCoupons)
    .where(and(...conditions))
    .orderBy(desc(referralCoupons.createdAt))
}

export async function updateReferralCouponStatusDb(
  couponId: number,
  tenant: string,
  status: 'active' | 'used' | 'expired' | 'cancelled',
  usedAt?: Date
) {
  const updated = await db
    .update(referralCoupons)
    .set({
      status: status as any,
      ...(usedAt && { usedAt }),
    })
    .where(and(eq(referralCoupons.id, couponId), eq(referralCoupons.tenant, tenant)))
    .returning()
  return updated[0] ?? null
}

export async function getActiveReferralCouponsDb(
  tenant: string,
  ruleId?: number
) {
  const conditions = [
    eq(referralCoupons.tenant, tenant),
    eq(referralCoupons.status, 'active' as any),
    sql`(${referralCoupons.expiresAt} IS NULL OR ${referralCoupons.expiresAt} > NOW())`,
  ]
  if (ruleId) {
    conditions.push(eq(referralCoupons.ruleId, ruleId))
  }

  return db
    .select()
    .from(referralCoupons)
    .where(and(...conditions))
    .orderBy(referralCoupons.createdAt)
}

