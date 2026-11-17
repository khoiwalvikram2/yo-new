import { db } from '@/db/client.js'
import { and, asc, desc, eq, gte, lte, ilike, isNull, or, sql, inArray } from 'drizzle-orm'
import { matkaWorliInstances, worliStatusEnum, matkas } from '@shared/db/schema.js'

export type WorliStatus = typeof worliStatusEnum.enumValues[number]

/**
 * `worliSessionStatus` (shared/src/matka/schedule.ts) in SQL, so the status filter and sort see the status
 * the page shows: a stored SCHEDULED/OPEN/LOCKED session moved on by the clock and the Lock Now / Close Now
 * stamps. The two must stay the same rule; domains/matka-worli/__tests__/worliSessions.integration.test.ts
 * compares them case by case.
 */
export function worliStatusSql(now: Date) {
  const i = matkaWorliInstances, at = sql`${now.toISOString()}::timestamptz`
  const lockAt = sql`CASE WHEN ${i.suspendMinutesOverride} IS NOT NULL THEN ${i.scheduledCloseAtUtc} - ${i.suspendMinutesOverride} * interval '1 minute' ELSE ${i.scheduledLockAtUtc} END`
  return sql<WorliStatus>`(CASE
    WHEN ${i.status} NOT IN ('SCHEDULED','OPENING_SOON','OPEN','LOCKED') THEN ${i.status}::text
    WHEN ${i.actualCloseAtUtc} <= ${at} OR ${i.scheduledCloseAtUtc} <= ${at} THEN 'CLOSED'
    WHEN ${i.status} = 'LOCKED' OR ${i.actualLockAtUtc} <= ${at} OR ${lockAt} <= ${at} THEN 'LOCKED'
    WHEN ${i.status} = 'OPEN' OR ${i.scheduledOpenAtUtc} <= ${at} THEN 'OPEN'
    ELSE ${i.status}::text END)`
}

export interface WorliInstanceCreateInput {
  marketId: string
  runDate: string // YYYY-MM-DD (local market date)
  side: 'OPEN' | 'CLOSE'
  scheduledOpenAtUtc: Date
  scheduledLockAtUtc: Date
  scheduledCloseAtUtc: Date
  suspendMinutesOverride?: number | null
  operatorMessage?: string | null
  bidRulesVersionId?: string | null
}

export interface WorliInstanceFilters {
  tenant?: string
  marketId?: string
  date?: string // YYYY-MM-DD
  status?: WorliStatus | WorliStatus[]
  fromCloseAt?: string
  toCloseAt?: string
  search?: string
  hasResult?: boolean
  page?: number
  limit?: number
  sort?: 'closeAt:asc' | 'closeAt:desc' | 'status:asc' | 'status:desc' | 'name:asc' | 'name:desc' | 'bets:asc' | 'bets:desc' | 'exposure:asc' | 'exposure:desc'
}

export async function createWorliInstance(input: WorliInstanceCreateInput) {
  const [row] = await db.insert(matkaWorliInstances).values({
    marketId: input.marketId,
    runDate: input.runDate as any,
    side: input.side as any,
    status: 'SCHEDULED' as any,
    scheduledOpenAtUtc: input.scheduledOpenAtUtc,
    scheduledLockAtUtc: input.scheduledLockAtUtc,
    scheduledCloseAtUtc: input.scheduledCloseAtUtc,
    suspendMinutesOverride: input.suspendMinutesOverride ?? null,
    operatorMessage: input.operatorMessage ?? null,
    bidRulesVersionId: input.bidRulesVersionId ?? null,
    // required counters default to zero
    totalStakeMinor: 0n,
    betCount: 0,
    exposureTotalMinor: 0n,
  }).returning()
  return row
}

export async function upsertWorliInstance(input: WorliInstanceCreateInput) {
  const existing = await getWorliInstanceByUnique(input.marketId, input.runDate, input.side)
  if (existing) return existing
  return createWorliInstance(input)
}

export async function getWorliInstanceById(id: string) {
  const rows = await db.select().from(matkaWorliInstances).where(eq(matkaWorliInstances.id, id)).limit(1)
  return rows[0] || null
}

/**
 * The same lookup, scoped to a tenant.
 *
 * `matka_worli_instances` carries no tenant of its own — it references the
 * market, and `matkas` is where the tenant lives. So every Worli mutation
 * resolved its instance by id alone and compared nothing, and one whitelabel
 * could pause, resume, lock, close, re-message or re-suspend another's session.
 * The join is the tenant check.
 */
export async function getWorliInstanceByIdScoped(id: string, tenant: string) {
  const rows = await db
    .select({ instance: matkaWorliInstances })
    .from(matkaWorliInstances)
    .innerJoin(matkas, eq(matkas.id, matkaWorliInstances.marketId))
    .where(and(eq(matkaWorliInstances.id, id), eq(matkas.tenant, tenant)))
    .limit(1)
  return rows[0]?.instance ?? null
}

export async function getWorliInstanceByUnique(marketId: string, runDate: string, side: 'OPEN' | 'CLOSE') {
  const rows = await db
    .select()
    .from(matkaWorliInstances)
    .where(and(
      eq(matkaWorliInstances.marketId, marketId),
      eq(matkaWorliInstances.runDate, runDate as any),
      eq(matkaWorliInstances.side, side as any),
    ))
    .limit(1)
  return rows[0] || null
}

export async function listWorliInstances(filters: WorliInstanceFilters = {}, now = new Date()) {
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50))
  const offset = (page - 1) * limit
  const status = worliStatusSql(now)

  // A deleted market's sessions leave the running list, as the market list and the player API drop the market.
  const conds: any[] = [isNull(matkas.deletedAt)]
  if (filters.tenant !== undefined) conds.push(eq(matkas.tenant, filters.tenant))
  if (filters.marketId) conds.push(eq(matkaWorliInstances.marketId, filters.marketId))
  if (filters.date) conds.push(eq(matkaWorliInstances.runDate, filters.date as any))
  if (filters.status) {
    const s = Array.isArray(filters.status) ? filters.status : [filters.status]
    if (s.length > 0) {
      conds.push(inArray(status, s as any[]))
    }
  }
  if (filters.hasResult === true) conds.push(sql`${matkaWorliInstances.resultPublishedAtUtc} IS NOT NULL`)
  if (filters.hasResult === false) conds.push(sql`${matkaWorliInstances.resultPublishedAtUtc} IS NULL`)
  if (filters.fromCloseAt) conds.push(gte(matkaWorliInstances.scheduledCloseAtUtc, new Date(filters.fromCloseAt)))
  if (filters.toCloseAt) conds.push(lte(matkaWorliInstances.scheduledCloseAtUtc, new Date(filters.toCloseAt)))
  if (filters.search && filters.search.trim()) {
    // Case-insensitive, name or code, as the market list and the running-markets search match.
    const q = `%${filters.search.trim()}%`
    conds.push(or(ilike(matkas.name, q), ilike(matkas.code, q)))
  }

  const where = conds.length ? and(...conds) : undefined

  const orderBy = (() => {
    switch (filters.sort) {
      case 'name:asc': return [asc(matkas.name)]
      case 'name:desc': return [desc(matkas.name)]
      case 'bets:asc': return [asc(matkaWorliInstances.betCount)]
      case 'bets:desc': return [desc(matkaWorliInstances.betCount)]
      case 'exposure:asc': return [asc(matkaWorliInstances.exposureTotalMinor)]
      case 'exposure:desc': return [desc(matkaWorliInstances.exposureTotalMinor)]
      case 'closeAt:asc': return [asc(matkaWorliInstances.scheduledCloseAtUtc)]
      case 'status:asc': return [asc(status)]
      case 'status:desc': return [desc(status)]
      case 'closeAt:desc':
      default: return [desc(matkaWorliInstances.scheduledCloseAtUtc)]
    }
  })()

  const [rows, [{ count }]] = await Promise.all([
    db.select({
      inst: matkaWorliInstances,
      marketName: matkas.name,
    })
      .from(matkaWorliInstances)
      .innerJoin(matkas, eq(matkaWorliInstances.marketId, matkas.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(matkaWorliInstances)
      .innerJoin(matkas, eq(matkaWorliInstances.marketId, matkas.id))
      .where(where),
  ])
  const items = rows.map((r) => ({ ...r.inst, __marketName: r.marketName }))
  return { items, total: count }
}

export async function updateWorliInstanceStatus(id: string, status: WorliStatus) {
  const [row] = await db.update(matkaWorliInstances).set({ status: status as any, updatedAt: new Date() }).where(eq(matkaWorliInstances.id, id)).returning()
  return row
}

export async function patchWorliInstance(id: string, patch: Partial<{
  status: WorliStatus
  scheduledLockAtUtc: Date
  operatorMessage: string | null
  suspendMinutesOverride: number | null
  actualOpenAtUtc: Date | null
  actualLockAtUtc: Date | null
  actualCloseAtUtc: Date | null
  resultValue: string | null
  resultPublishedAtUtc: Date | null
  resultActorId: string | null
  bidRulesVersionId: string | null
  totalStakeMinor: bigint
  betCount: number
  exposureTotalMinor: bigint
  worstOutcomeKey: string | null
  worstOutcomePlMinor: bigint | null
}>) {
  const set: any = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(patch)) set[k] = v as any
  const [row] = await db.update(matkaWorliInstances).set(set).where(eq(matkaWorliInstances.id, id)).returning()
  return row
}

