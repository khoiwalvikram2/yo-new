import { getVipDepositContext } from '@shared/vip/depositAccess.js'
import { vipEligiblePlayer } from '@shared/vip/depositPolicy.js'
import { and, eq, asc, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  vipTiersTable,
  vipTierBenefitsTable,
  vipTierPerksTable,
  vipMembersTable,
  users,
  agents,
} from '@shared/db/schema.js'
import type { InferModel } from 'drizzle-orm'

// Tier qualification, points and enrolment live in @shared/vip. The old
// reward-points upgrade/downgrade helpers that used to sit here were never
// scheduled and contradicted the monthly-deposit rules, so they were removed.

type VipTierRow = InferModel<typeof vipTiersTable>
type VipTierWithDetails = VipTierRow & {
  benefits: string[]
  perks: Array<{ name: string; description: string; icon?: string | null }>
}

/**
 * Get all active VIP tiers for a tenant
 */
export async function getVipTiers(tenant: string): Promise<VipTierWithDetails[]> {
  const tiers = await db
    .select()
    .from(vipTiersTable)
    .where(and(eq(vipTiersTable.tenant, tenant), eq(vipTiersTable.status, 'active')))
    .orderBy(asc(vipTiersTable.level))

  if (!tiers.length) return []

  const tierIds = tiers.map((t) => t.id)
  const [benefits, perks] = await Promise.all([
    db.select().from(vipTierBenefitsTable).where(inArray(vipTierBenefitsTable.tierId, tierIds)),
    db.select().from(vipTierPerksTable).where(inArray(vipTierPerksTable.tierId, tierIds)),
  ])

  const benefitsByTier = new Map<string, string[]>()
  for (const b of benefits) {
    const arr = benefitsByTier.get(b.tierId) || []
    arr.push(b.benefit)
    benefitsByTier.set(b.tierId, arr)
  }

  const perksByTier = new Map<string, Array<{ name: string; description: string; icon?: string | null }>>()
  for (const p of perks) {
    const arr = perksByTier.get(p.tierId) || []
    arr.push({ name: p.name, description: p.description, icon: p.icon || undefined })
    perksByTier.set(p.tierId, arr)
  }

  return tiers.map((t) => ({
    ...t,
    benefits: benefitsByTier.get(t.id) || [],
    perks: perksByTier.get(t.id) || [],
  }))
}

/** Credit players have no VIP programme, including a player owned by a CREDIT agent
 * whose own type says otherwise; the player site only knows the player type. */
export async function isVipEligible(userId: number, tenant: string) {
  const [row] = await db.select({ type: users.playerType, scheme: agents.schemeType }).from(users)
    .leftJoin(agents, and(eq(agents.id, users.agentId), eq(agents.tenantId, users.tenant)))
    .where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  return !!row && vipEligiblePlayer(row.type, row.scheme)
}

/**
 * Get user's current VIP membership status
 */
export async function getUserVipStatus(userId: number, tenant: string) {
  const context = await getVipDepositContext(db, tenant, userId).catch(() => null)
  if (!context) return null
  const [member] = await db.select().from(vipMembersTable).where(and(eq(vipMembersTable.userId, String(userId)), eq(vipMembersTable.tenant, tenant))).limit(1)
  const tier = context.tier
  const allTiers = await getVipTiers(tenant)
  const details = allTiers.find(item => item.id === tier.id)!
  // A manually assigned tier does not move with deposits, so there is no next tier to work towards.
  const manual = context.user.vipTierMode === 'MANUAL' && !context.manualTierUnavailable
  const nextTier = manual ? null : allTiers.find(item => item.level > tier.level) || null
  return {
    id: member?.id || `auto:${userId}`, tierId: tier.id, tierName: tier.name, tierLevel: tier.level,
    tierColor: tier.color, currentPoints: member?.currentPoints || 0, lifetimePoints: member?.lifetimePoints || 0,
    monthlyDeposits: context.monthlyDeposits, nextTier,
    pointsToNextTier: nextTier ? Math.max(0, nextTier.minMonthlyDeposit - context.monthlyDeposits) : null,
    joinedAt: member?.joinedAt || context.startsAt, benefits: details.benefits, perks: details.perks,
  }
}
