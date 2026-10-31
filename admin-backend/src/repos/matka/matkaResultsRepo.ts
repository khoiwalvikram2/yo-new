import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { db } from '@src/db/client.js'
import { and, eq, gte, lte, desc, asc, sql, or, ilike, isNull, isNotNull } from 'drizzle-orm'
import { matkaResults, matkas } from '@shared/db/schema.js'
import { getEnv } from '@src/config/env.js'
import { declareAndSettleMatka, reverseMatkaResult } from '@shared/matka/settlement.js'
import { getClientIp, getClientUserAgent } from '@src/utils/getClientIp.js'

export type MatkaResultType = 'open' | 'close'

export interface MatkaResultCreateInput {
  matkaId: string
  date: string // ISO yyyy-mm-dd
  type: MatkaResultType
  result: string
  idempotencyKey?: string
}

export interface MatkaResultListFilter {
  tenant?: string
  matkaId?: string
  type?: MatkaResultType
  dateFrom?: string // ISO yyyy-mm-dd
  dateTo?: string // ISO yyyy-mm-dd
  search?: string // Search in result value or declaredBy
  rolledBack?: boolean // Filter by rollback status
  page?: number
  limit?: number
  sort?: string // e.g., "createdAt:desc" or "date:asc"
}

export interface MatkaResultRollbackInput {
  id: string
  reason: string
  tag?: string // Categorical tag
}

export interface MatkaResultContext {
  tenant: string
  actorId: string
  ip?: string
  userAgent?: string
}

function getIpFromRequest(request: any): string | undefined {
  return getClientIp(request)
}

/**
 * Build context from GraphQL context
 */
export function buildMatkaResultContext(ctx: any): MatkaResultContext {
  const tenant = getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
  const actorId = ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'
  const request = ctx?.request
  return {
    tenant,
    actorId: String(actorId),
    ip: getIpFromRequest(request),
    userAgent: getClientUserAgent(request),
  }
}

/**
 * Check if open result exists for given matkaId and date
 */
export async function existsOpenResult(matkaId: string, date: string, tenant = 'default'): Promise<boolean> {
  const rows = await db.select({ id: matkaResults.id })
    .from(matkaResults)
    .where(
      and(
        eq(matkaResults.tenant, tenant),
        eq(matkaResults.matkaId, matkaId),
        eq(matkaResults.date, date),
        eq(matkaResults.type, 'open'),
        isNull(matkaResults.rolledBackAt)
      )
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Backwards-compatible alias used by older tests/callers.
 * Prefer `existsOpenResult`.
 */
export const checkOpenResultExists = existsOpenResult

/**
 * Get result by composite key
 */
export async function getResultByComposite(
  matkaId: string,
  date: string,
  type: MatkaResultType,
  tenant = 'default'
) {
  const rows = await db.select().from(matkaResults)
    .where(
      and(
        eq(matkaResults.tenant, tenant),
        eq(matkaResults.matkaId, matkaId),
        eq(matkaResults.date, date),
        eq(matkaResults.type, type)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * Create a new result with validation and guards
 */
export async function createMatkaResult(input: MatkaResultCreateInput, ctx: MatkaResultContext) {
  const result = await declareAndSettleMatka(db, input, ctx)
  if (!result.replayed && result.settledBets.length) {
    const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
    for (const bet of result.settledBets) await referralIntegrationService.handleBetSettlement(ctx.tenant, bet.userId,
      Number(bet.actualWin || 0) - Number(bet.betAmount), bet.currency as any, 'matka', `${bet.id}:${result.declaredAt.toISOString()}`)
  }
  return result
}

/** List results with tenant/date filters and pagination. */
export async function listMatkaResults(filter: MatkaResultListFilter = {}) {
  const tenant = filter.tenant ?? 'default'
  const page = Math.max(1, filter.page ?? 1)
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20))
  const offset = (page - 1) * limit

  const conditions: any[] = [eq(matkaResults.tenant, tenant)]

  if (filter.matkaId) {
    conditions.push(eq(matkaResults.matkaId, filter.matkaId))
  }

  if (filter.type) {
    conditions.push(eq(matkaResults.type, filter.type))
  }

  if (filter.dateFrom) {
    conditions.push(gte(matkaResults.date, filter.dateFrom))
  }

  if (filter.dateTo) {
    conditions.push(lte(matkaResults.date, filter.dateTo))
  }

  if (filter.search) {
    const searchTerm = `%${filter.search}%`
    conditions.push(
      or(
        ilike(matkaResults.result, searchTerm),
        ilike(matkaResults.declaredBy, searchTerm)
      )
    )
  }

  if (typeof filter.rolledBack === 'boolean') {
    if (filter.rolledBack) {
      conditions.push(isNotNull(matkaResults.rolledBackAt))
    } else {
      conditions.push(isNull(matkaResults.rolledBackAt))
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Parse sort
  const sortParts = (filter.sort ?? 'createdAt:desc').split(',').map(s => s.trim())
  const orderBy: any[] = []
  for (const part of sortParts) {
    const [field, dir] = part.split(':')
    const direction = (dir || 'desc').toLowerCase() === 'asc' ? asc : desc
    switch (field) {
      case 'date':
        orderBy.push(direction(matkaResults.date))
        break
      case 'createdAt':
      case 'declaredAt':
        orderBy.push(direction(matkaResults.createdAt))
        break
      default:
        break
    }
  }
  // Default sort if none specified
  if (orderBy.length === 0) {
    orderBy.push(desc(matkaResults.createdAt))
  }

  const [items, [{ count }]] = await Promise.all([
    db.select({
      id: matkaResults.id,
      tenant: matkaResults.tenant,
      matkaId: matkaResults.matkaId,
      date: matkaResults.date,
      type: matkaResults.type,
      result: matkaResults.result,
      declaredBy: matkaResults.declaredBy,
      declaredAt: matkaResults.declaredAt,
      rolledBackAt: matkaResults.rolledBackAt,
      rolledBackBy: matkaResults.rolledBackBy,
      rollbackReason: matkaResults.rollbackReason,
      rollbackTag: matkaResults.rollbackTag,
      createdAt: matkaResults.createdAt,
    })
      .from(matkaResults)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(matkaResults)
      .where(whereClause),
  ])

  return {
    items: items.map(item => ({
      ...item,
      type: item.type as MatkaResultType,
    })),
    total: count,
  }
}

/**
 * Get result by ID
 */
export async function getMatkaResultById(id: string, tenant = 'default') {
  const rows = await db.select().from(matkaResults)
    .where(and(eq(matkaResults.id, id), eq(matkaResults.tenant, tenant)))
    .limit(1)
  return rows[0] || null
}

/**
 * Rollback a result with validation and guards
 */
export async function rollbackMatkaResult(input: MatkaResultRollbackInput, ctx: MatkaResultContext) {
  const window = Number.parseInt(getEnv().MATKA_RESULT_ROLLBACK_WINDOW_MINUTES || '60', 10)
  const result = await reverseMatkaResult(db, input, ctx, window)
  if (result.revertedBets.length) {
    const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
    for (const bet of result.revertedBets) await referralIntegrationService.handleBetSettlementReversal(ctx.tenant, bet.userId, `${bet.id}:${result.previousDeclaredAt.toISOString()}`, 'matka')
  }
  return result
}
