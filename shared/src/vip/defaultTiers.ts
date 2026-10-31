import { asc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { vipAuditTable, vipTiersTable, whitelabels } from '../db/schema.js'

/** Amounts use each whitelabel's base currency. These are qualification
 * thresholds, not deposit transaction limits or automatic reward promises. */
export const DEFAULT_VIP_TIERS = [
  { name: 'Bronze', level: 1, minMonthlyDeposit: 0, color: '#CD7F32', status: 'active' },
  { name: 'Silver', level: 2, minMonthlyDeposit: 10_000, color: '#94A3B8', status: 'active' },
  { name: 'Gold', level: 3, minMonthlyDeposit: 50_000, color: '#D4AF37', status: 'active' },
  { name: 'Platinum', level: 4, minMonthlyDeposit: 100_000, color: '#64748B', status: 'active' },
] as const

const normalizedName = (name: string) => name.trim().toLowerCase()

/** Add missing defaults for one existing whitelabel. Never overwrite an
 * administrator's edits, reset memberships, or duplicate a name/level.
 * The transaction lock serializes simultaneous seed runs for this tenant. */
export async function seedDefaultVipTiers(database: NodePgDatabase<any>, tenant: string) {
  if (!tenant.trim()) throw new Error('VIP seed requires a tenant')

  return database.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vip-default-tiers:${tenant}`}, 0))`)
    const [whitelabel] = await tx.select({ id: whitelabels.id }).from(whitelabels)
      .where(eq(whitelabels.id, tenant)).limit(1)
    if (!whitelabel) throw new Error(`VIP seed: whitelabel '${tenant}' not found`)

    const existing = await tx.select().from(vipTiersTable)
      .where(eq(vipTiersTable.tenant, tenant)).orderBy(asc(vipTiersTable.level))
    const names = new Set(existing.map(tier => normalizedName(tier.name)))
    const levels = new Set(existing.map(tier => tier.level))
    const created: string[] = []
    const preserved: string[] = []

    for (const defaults of DEFAULT_VIP_TIERS) {
      if (names.has(normalizedName(defaults.name)) || levels.has(defaults.level)) {
        preserved.push(defaults.name)
        continue
      }
      // Drizzle's timestamp-without-timezone mapping stores/reads UTC. Avoid
      // SQL now() defaults, which lose the offset in an IST database session.
      const now = new Date()
      const [tier] = await tx.insert(vipTiersTable).values({
        ...defaults, tenant, createdAt: now, updatedAt: now,
      }).returning()
      await tx.insert(vipAuditTable).values({
        tenant, actor: 'seed', action: 'seed_tier', tierId: tier.id, at: now,
        message: `Created default VIP tier ${tier.name} (level ${tier.level}, monthly deposit ${tier.minMonthlyDeposit})`,
      })
      names.add(normalizedName(tier.name))
      levels.add(tier.level)
      created.push(tier.name)
    }

    return { tenant, created, preserved }
  })
}
