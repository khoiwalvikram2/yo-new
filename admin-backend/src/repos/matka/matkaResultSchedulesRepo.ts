import { db } from '@src/db/client.js'
import { and, eq, gte, lte, desc, asc, sql, isNull } from 'drizzle-orm'
import { matkaResultSchedules } from '@shared/db/schema.js'
import type { MatkaResultContext } from './matkaResultsRepo.js'

export interface MatkaResultScheduleInput {
  matkaId: string
  date: string // ISO yyyy-mm-dd
  type: 'open' | 'close'
  result: string
  scheduledAt: string // ISO timestamp
}

/**
 * Create a scheduled result
 */
export async function createMatkaResultSchedule(
  input: MatkaResultScheduleInput,
  ctx: MatkaResultContext
) {
  const { matkaId, date, type, result, scheduledAt } = input
  const { tenant, actorId } = ctx

  const scheduledAtDate = new Date(scheduledAt)
  if (isNaN(scheduledAtDate.getTime())) {
    throw new Error('Invalid scheduledAt date')
  }

  const [created] = await db.insert(matkaResultSchedules).values({
    tenant,
    matkaId,
    date,
    type,
    result,
    scheduledBy: actorId,
    scheduledAt: scheduledAtDate,
    status: 'pending',
    createdAt: new Date(),
  }).returning()

  return created
}

/**
 * List scheduled results
 */
export async function listMatkaResultSchedules(filter: {
  tenant?: string
  matkaId?: string
  status?: string
  scheduledFrom?: Date
  scheduledTo?: Date
  page?: number
  limit?: number
} = {}) {
  const tenant = filter.tenant ?? 'default'
  const page = Math.max(1, filter.page ?? 1)
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions: any[] = [eq(matkaResultSchedules.tenant, tenant)]

  if (filter.matkaId) {
    conditions.push(eq(matkaResultSchedules.matkaId, filter.matkaId))
  }

  if (filter.status) {
    conditions.push(eq(matkaResultSchedules.status, filter.status))
  }

  if (filter.scheduledFrom) {
    conditions.push(gte(matkaResultSchedules.scheduledAt, filter.scheduledFrom))
  }

  if (filter.scheduledTo) {
    conditions.push(lte(matkaResultSchedules.scheduledAt, filter.scheduledTo))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [items, [{ count }]] = await Promise.all([
    db.select()
      .from(matkaResultSchedules)
      .where(whereClause)
      .orderBy(asc(matkaResultSchedules.scheduledAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(matkaResultSchedules)
      .where(whereClause),
  ])

  return {
    items,
    total: count,
  }
}

/**
 * Get due schedules (for polling service)
 */
export async function getDueSchedules(tenant: string | null = 'default', limit = 100) {
  const now = new Date()
  const rows = await db.select()
    .from(matkaResultSchedules)
    .where(
      and(
        tenant === null ? undefined : eq(matkaResultSchedules.tenant, tenant),
        eq(matkaResultSchedules.status, 'pending'),
        lte(matkaResultSchedules.scheduledAt, now)
      )
    )
    .orderBy(asc(matkaResultSchedules.scheduledAt))
    .limit(limit)
  
  return rows
}

/**
 * Mark schedule as executed
 */
export async function markScheduleExecuted(
  id: string,
  executedBy: string,
  tenant = 'default'
) {
  const [updated] = await db.update(matkaResultSchedules)
    .set({
      status: 'executed',
      executedAt: new Date(),
      executedBy,
    })
    .where(
      and(
        eq(matkaResultSchedules.id, id),
        eq(matkaResultSchedules.tenant, tenant)
      )
    )
    .returning()
  
  return updated
}

/**
 * Mark schedule as failed
 */
export async function markScheduleFailed(
  id: string,
  errorMessage: string,
  tenant = 'default'
) {
  const [updated] = await db.update(matkaResultSchedules)
    .set({
      status: 'failed',
      errorMessage,
    })
    .where(
      and(
        eq(matkaResultSchedules.id, id),
        eq(matkaResultSchedules.tenant, tenant)
      )
    )
    .returning()
  
  return updated
}

