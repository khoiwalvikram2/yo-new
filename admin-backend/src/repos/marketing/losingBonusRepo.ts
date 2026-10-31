import { db } from '@src/db/client.js'
import { sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js'
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm'

export type LosingBonusDomain = 'sports' | 'casino' | 'matka' | 'global'

export interface UserLossRow {
  userId: number
  lossAmount: number
}

const SPORTS_SETTLED = ['won', 'lost', 'settled'] as const
const CASINO_SETTLED = ['won', 'lost'] as const
const MATKA_SETTLED = ['won', 'lost'] as const

/**
 * Get users with net loss in the given period, scoped by tenant, whitelabel, and domain.
 * Returns rows sorted by loss amount descending (largest loss first) for per-week cap (top N).
 * Only includes users who have at least one bet on the whitelabel in the period and net P/L < 0.
 */
export async function getUserLossesByDomain(
  tenant: string,
  whitelabelId: string,
  periodFrom: Date,
  periodTo: Date,
  domain: LosingBonusDomain
): Promise<UserLossRow[]> {
  if (domain === 'sports') {
    const rows = await db
      .select({
        userId: sportsBets.userId,
        pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          eq(sportsBets.whitelabelId, whitelabelId),
          inArray(sportsBets.status, SPORTS_SETTLED),
          gte(sportsBets.createdAt, periodFrom),
          lte(sportsBets.createdAt, periodTo)
        )
      )
      .groupBy(sportsBets.userId)
      .having(sql`COALESCE(SUM(${sportsBets.pl}::numeric), 0) < 0`)

    return rows
      .map((r) => ({ userId: r.userId, lossAmount: Math.abs(Number(r.pl)) }))
      .sort((a, b) => b.lossAmount - a.lossAmount)
  }

  if (domain === 'casino') {
    const rows = await db
      .select({
        userId: casinoBets.userId,
        pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
      })
      .from(casinoBets)
      .where(
        and(
          eq(casinoBets.tenant, tenant),
          eq(casinoBets.whitelabelId, whitelabelId),
          inArray(casinoBets.status, CASINO_SETTLED),
          gte(casinoBets.createdAt, periodFrom),
          lte(casinoBets.createdAt, periodTo)
        )
      )
      .groupBy(casinoBets.userId)
      .having(sql`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, 0) - ${casinoBets.stake}::numeric), 0) < 0`)

    return rows
      .map((r) => ({ userId: r.userId, lossAmount: Math.abs(Number(r.pl)) }))
      .sort((a, b) => b.lossAmount - a.lossAmount)
  }

  if (domain === 'matka') {
    const rows = await db
      .select({
        userId: matkaBets.userId,
        pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
      })
      .from(matkaBets)
      .where(
        and(
          eq(matkaBets.tenant, tenant),
          eq(matkaBets.whitelabelId, whitelabelId),
          inArray(matkaBets.status, MATKA_SETTLED),
          gte(matkaBets.createdAt, periodFrom),
          lte(matkaBets.createdAt, periodTo)
        )
      )
      .groupBy(matkaBets.userId)
      .having(sql`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0) < 0`)

    return rows
      .map((r) => ({ userId: r.userId, lossAmount: Math.abs(Number(r.pl)) }))
      .sort((a, b) => b.lossAmount - a.lossAmount)
  }

  // global: sum sports + casino + matka per user
  const [sportsRows, casinoRows, matkaRows] = await Promise.all([
    db
      .select({
        userId: sportsBets.userId,
        pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          eq(sportsBets.whitelabelId, whitelabelId),
          inArray(sportsBets.status, SPORTS_SETTLED),
          gte(sportsBets.createdAt, periodFrom),
          lte(sportsBets.createdAt, periodTo)
        )
      )
      .groupBy(sportsBets.userId),
    db
      .select({
        userId: casinoBets.userId,
        pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
      })
      .from(casinoBets)
      .where(
        and(
          eq(casinoBets.tenant, tenant),
          eq(casinoBets.whitelabelId, whitelabelId),
          inArray(casinoBets.status, CASINO_SETTLED),
          gte(casinoBets.createdAt, periodFrom),
          lte(casinoBets.createdAt, periodTo)
        )
      )
      .groupBy(casinoBets.userId),
    db
      .select({
        userId: matkaBets.userId,
        pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
      })
      .from(matkaBets)
      .where(
        and(
          eq(matkaBets.tenant, tenant),
          eq(matkaBets.whitelabelId, whitelabelId),
          inArray(matkaBets.status, MATKA_SETTLED),
          gte(matkaBets.createdAt, periodFrom),
          lte(matkaBets.createdAt, periodTo)
        )
      )
      .groupBy(matkaBets.userId),
  ])

  const plByUser = new Map<number, number>()
  for (const r of sportsRows) {
    plByUser.set(r.userId, (plByUser.get(r.userId) ?? 0) + Number(r.pl))
  }
  for (const r of casinoRows) {
    plByUser.set(r.userId, (plByUser.get(r.userId) ?? 0) + Number(r.pl))
  }
  for (const r of matkaRows) {
    plByUser.set(r.userId, (plByUser.get(r.userId) ?? 0) + Number(r.pl))
  }

  const result: UserLossRow[] = []
  for (const [userId, pl] of plByUser.entries()) {
    if (pl < 0) {
      result.push({ userId, lossAmount: Math.abs(pl) })
    }
  }
  result.sort((a, b) => b.lossAmount - a.lossAmount)
  return result
}
