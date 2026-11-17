import { db } from '@src/db/client.js'
import { and, eq, gte, lte, desc, asc, sql, or, ilike, isNull, isNotNull, inArray } from 'drizzle-orm'
import { sportsResultsTable, users } from '@shared/db/schema.js'
import { sportsTable } from '@shared/db/schema.js'
import { sportsLeaguesTable, sportsEventsTable, sportsMarketsTable, sportsRunnersTable } from '@shared/db/schema.js'
import { getClientIp, getClientUserAgent } from '@src/utils/getClientIp.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

export type SportsResultMarketType = 'exchange' | 'bookmaker' | 'fancy'

export interface SportsResultCreateInput {
  sportId: string
  leagueId: string
  eventId: string
  marketId: string
  marketType: SportsResultMarketType
  runnerId?: string // For exchange/bookmaker
  selectionName?: string // For fancy
  result?: string // Numeric result as string (for fancy)
  idempotencyKey?: string
}

export interface SportsResultListFilter {
  tenant?: string
  whitelabelId?: string
  /** When true, return rows for (tenant, whitelabelId) OR is_global = true */
  includeGlobal?: boolean
  /** When true, return only rows with is_global = true (e.g. Super Admin core list) */
  isGlobal?: boolean
  sportId?: string
  leagueId?: string
  eventId?: string
  marketId?: string
  marketType?: SportsResultMarketType
  dateFrom?: string // ISO date string
  dateTo?: string // ISO date string
  search?: string // Search in selectionName, declaredBy
  rolledBack?: boolean // Filter by rollback status
  page?: number
  limit?: number
  sort?: string // e.g., "createdAt:desc" or "declaredAt:asc"
}

export interface SportsResultRollbackInput {
  id: string
  reason: string
  tag?: string // Categorical tag
}

export interface SportsResultContext {
  tenant: string
  whitelabelId: string
  actorId: string
  ip?: string
  userAgent?: string
  /** When true, create result as global (all whitelabels); only set by resolver for Super Admin core mode */
  isGlobal?: boolean
}

function getIpFromRequest(request: any): string | undefined {
  return getClientIp(request)
}

/**
 * Build context from GraphQL context
 */
export function buildSportsResultContext(ctx: any): SportsResultContext {
  const tenant = ctx?.tenant ?? 'default'
  const whitelabelId = ctx?.whitelabel?.id ?? 'default'
  const actorId = ctx?.user?.sub ?? ctx?.actor?.id ?? 'system'
  const request = ctx?.request
  return {
    tenant,
    whitelabelId,
    actorId: String(actorId),
    ip: getIpFromRequest(request),
    userAgent: getClientUserAgent(request),
  }
}

/**
 * Check if any active result exists for this market (global or any whitelabel)
 */
export async function getAnyActiveResultForMarket(marketId: string, exec: any = db): Promise<any | null> {
  const rows = await exec.select()
    .from(sportsResultsTable)
    .where(
      and(
        eq(sportsResultsTable.marketId, marketId),
        isNull(sportsResultsTable.rolledBackAt)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * Check if active global result exists for this market
 */
export async function getActiveGlobalResultForMarket(marketId: string, exec: any = db): Promise<any | null> {
  const rows = await exec.select()
    .from(sportsResultsTable)
    .where(
      and(
        eq(sportsResultsTable.marketId, marketId),
        eq(sportsResultsTable.isGlobal, true),
        isNull(sportsResultsTable.rolledBackAt)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * Check if active result exists for given market (scoped to tenant/whitelabel)
 */
export async function getActiveResultForMarket(
  marketId: string,
  tenant = 'default',
  whitelabelId = 'default',
  exec: any = db
): Promise<any | null> {
  const rows = await exec.select()
    .from(sportsResultsTable)
    .where(
      and(
        eq(sportsResultsTable.tenant, tenant),
        eq(sportsResultsTable.whitelabelId, whitelabelId),
        eq(sportsResultsTable.marketId, marketId),
        isNull(sportsResultsTable.rolledBackAt)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * Get result by ID. When options.byIdOnly is true (e.g. global result), fetch by id only.
 */
export async function getSportsResultById(
  id: string,
  tenant = 'default',
  whitelabelId = 'default',
  options?: { byIdOnly?: boolean }
) {
  if (options?.byIdOnly) {
    const rows = await db.select().from(sportsResultsTable)
      .where(eq(sportsResultsTable.id, id))
      .limit(1)
    return rows[0] || null
  }
  const rows = await db.select().from(sportsResultsTable)
    .where(
      and(
        eq(sportsResultsTable.id, id),
        eq(sportsResultsTable.tenant, tenant),
        eq(sportsResultsTable.whitelabelId, whitelabelId)
      )
    )
    .limit(1)
  return rows[0] || null
}

/**
 * Create a new result with validation and guards.
 * When `tx` is provided, all DB ops run inside that transaction.
 */
export async function createSportsResult(
  input: SportsResultCreateInput,
  ctx: SportsResultContext,
  tx?: any
): Promise<{
  id: string
  sportId: string
  leagueId: string
  eventId: string
  marketId: string
  marketType: SportsResultMarketType
  runnerId?: string | null
  selectionName?: string | null
  result?: string | null
  declaredBy: string
  declaredAt: Date
  isGlobal: boolean
}> {
  const { sportId, leagueId, eventId, marketId, marketType, runnerId, selectionName, result, idempotencyKey } = input
  const isGlobalCreate = ctx.isGlobal === true
  const tenant = isGlobalCreate ? 'default' : ctx.tenant
  const whitelabelId = isGlobalCreate ? 'default' : ctx.whitelabelId
  const { actorId, ip, userAgent } = ctx
  const exec = tx ?? db

  // Validate market type requirements
  if (marketType === 'exchange' || marketType === 'bookmaker') {
    // Allow special status values (VOID, CANCELLED, SUSPENDED) in selectionName
    if (!runnerId && !selectionName) {
      throw new Error(`${marketType} market type requires a runner/selection or status`)
    }
    // If selectionName is provided for exchange/bookmaker, it should be a special status
    if (selectionName && !['VOID', 'CANCELLED', 'SUSPENDED'].includes(selectionName)) {
      throw new Error(`Invalid status: ${selectionName}. Must be VOID, CANCELLED, or SUSPENDED`)
    }
  } else if (marketType === 'fancy') {
    if (!selectionName) {
      throw new Error('Fancy market type requires a selection name')
    }
    // Allow special status values (VOID, CANCELLED, SUSPENDED) - in this case result MUST be null/undefined
    const isSpecialStatus = ['VOID', 'CANCELLED', 'SUSPENDED'].includes(selectionName)
    if (isSpecialStatus) {
      // For special status, result MUST be null/undefined - strict validation
      if (result !== null && result !== undefined && result !== '') {
        throw new Error(`Fancy market with status ${selectionName} cannot have a result value. Result must be empty.`)
      }
    } else {
      // For normal fancy results, result is required and must be numeric
      if (!result || result === '') {
        throw new Error('Fancy market type requires a numeric result value')
      }
      const numResult = parseFloat(result)
      if (isNaN(numResult)) {
        throw new Error('Fancy result must be a valid number')
      }
    }
  }

  // Check for duplicate via idempotency key
  if (idempotencyKey) {
    const existing = await exec.select().from(sportsResultsTable)
      .where(eq(sportsResultsTable.idempotencyKey, idempotencyKey))
      .limit(1)
    if (existing.length > 0) {
      const existingResult = existing[0]
      return {
        id: existingResult.id,
        sportId: existingResult.sportId,
        leagueId: existingResult.leagueId,
        eventId: existingResult.eventId,
        marketId: existingResult.marketId,
        marketType: existingResult.marketType as SportsResultMarketType,
        runnerId: existingResult.runnerId,
        selectionName: existingResult.selectionName,
        result: existingResult.result,
        declaredBy: existingResult.declaredBy,
        declaredAt: existingResult.declaredAt,
        isGlobal: Boolean((existingResult as any).isGlobal),
      }
    }
  }

  // Check for existing active result for this market
  if (isGlobalCreate) {
    const anyExisting = await getAnyActiveResultForMarket(marketId, exec)
    if (anyExisting) {
      const marketRows = await exec.select({ name: sportsMarketsTable.name })
        .from(sportsMarketsTable)
        .where(eq(sportsMarketsTable.id, marketId))
        .limit(1)
      const marketName = marketRows[0]?.name || marketId
      throw new Error(`Duplicate result: Active result already exists for market "${marketName}"`)
    }
  } else {
    const globalExisting = await getActiveGlobalResultForMarket(marketId, exec)
    if (globalExisting) {
      throw new Error('A global result already exists for this market')
    }
    const existing = await getActiveResultForMarket(marketId, tenant, whitelabelId, exec)
    if (existing) {
      const marketRows = await exec.select({ name: sportsMarketsTable.name })
        .from(sportsMarketsTable)
        .where(eq(sportsMarketsTable.id, marketId))
        .limit(1)
      const marketName = marketRows[0]?.name || marketId
      throw new Error(`Duplicate result: Active result already exists for market "${marketName}"`)
    }
  }

  const now = new Date()
  const [created] = await exec.insert(sportsResultsTable).values({
    tenant,
    whitelabelId,
    isGlobal: isGlobalCreate,
    sportId,
    leagueId,
    eventId,
    marketId,
    marketType: marketType as any,
    runnerId: runnerId || null,
    selectionName: selectionName || null,
    result: result ? sql`${result}::numeric` : null,
    declaredBy: actorId,
    declaredAt: now,
    idempotencyKey: idempotencyKey || null,
    declaredFromIp: ip || null,
    declaredUserAgent: userAgent || null,
    createdAt: now,
  }).returning()

  return {
    id: created.id,
    sportId: created.sportId,
    leagueId: created.leagueId,
    eventId: created.eventId,
    marketId: created.marketId,
    marketType: created.marketType as SportsResultMarketType,
    runnerId: created.runnerId,
    selectionName: created.selectionName,
    result: created.result,
    declaredBy: created.declaredBy,
    declaredAt: created.declaredAt,
    isGlobal: Boolean(created.isGlobal),
  }
}

/**
 * List results with filters and pagination
 */
async function sportsResultConditions(filter: SportsResultListFilter) {
  const tenant = filter.tenant ?? 'default'
  const whitelabelId = filter.whitelabelId ?? 'default'

  let conditions: any[]
  if (filter.isGlobal === true) {
    conditions = [eq(sportsResultsTable.isGlobal, true)]
  } else if (filter.includeGlobal === true) {
    conditions = [
      or(
        and(
          eq(sportsResultsTable.tenant, tenant),
          eq(sportsResultsTable.whitelabelId, whitelabelId)
        ),
        eq(sportsResultsTable.isGlobal, true)
      )
    ]
  } else {
    conditions = [
      eq(sportsResultsTable.tenant, tenant),
      eq(sportsResultsTable.whitelabelId, whitelabelId)
    ]
  }

  if (filter.sportId) {
    conditions.push(eq(sportsResultsTable.sportId, filter.sportId))
  }

  if (filter.leagueId) {
    conditions.push(eq(sportsResultsTable.leagueId, filter.leagueId))
  }

  if (filter.eventId) {
    conditions.push(eq(sportsResultsTable.eventId, filter.eventId))
  }

  if (filter.marketId) {
    conditions.push(eq(sportsResultsTable.marketId, filter.marketId))
  }

  if (filter.marketType) {
    conditions.push(eq(sportsResultsTable.marketType, filter.marketType as any))
  }

  if (filter.dateFrom || filter.dateTo) {
    const tz = await getWhitelabelTimezone(filter.tenant ?? 'default')
    if (filter.dateFrom) conditions.push(gte(sportsResultsTable.declaredAt, parseDateFrom(filter.dateFrom, tz)))
    if (filter.dateTo) conditions.push(lte(sportsResultsTable.declaredAt, parseDateTo(filter.dateTo, tz)))
  }

  if (filter.search) {
    const searchTerm = `%${filter.search}%`
    // declared_by holds the admin's user id; the list shows that admin's name, looked up in the same
    // tenant (sportsResults resolver), so the name is searched there too. Searching "shaan" found nothing
    // while the hidden id 187 found every result shaan declared. The event name is searched as well.
    const declarerIds = db
      .select({ id: sql<string>`${users.id}::text` })
      .from(users)
      .where(and(eq(users.tenant, tenant), or(ilike(users.name, searchTerm), ilike(users.username, searchTerm))))
    const eventIds = db
      .select({ id: sportsEventsTable.id })
      .from(sportsEventsTable)
      .where(ilike(sportsEventsTable.name, searchTerm))
    conditions.push(
      or(
        ilike(sportsResultsTable.selectionName, searchTerm),
        ilike(sportsResultsTable.declaredBy, searchTerm),
        inArray(sportsResultsTable.declaredBy, declarerIds),
        inArray(sportsResultsTable.eventId, eventIds)
      )
    )
  }

  if (typeof filter.rolledBack === 'boolean') {
    if (filter.rolledBack) {
      conditions.push(isNotNull(sportsResultsTable.rolledBackAt))
    } else {
      conditions.push(isNull(sportsResultsTable.rolledBackAt))
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined

}

export async function getSportsResults(filter: SportsResultListFilter = {}) {
  const page = Math.max(1, filter.page ?? 1)
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20))
  const offset = (page - 1) * limit
  const whereClause = await sportsResultConditions(filter)

  // Parse sort
  const sortParts = (filter.sort ?? 'createdAt:desc').split(',').map(s => s.trim())
  const orderBy: any[] = []
  for (const part of sortParts) {
    const [field, dir] = part.split(':')
    const direction = (dir || 'desc').toLowerCase() === 'asc' ? asc : desc
    switch (field) {
      case 'declaredAt':
        orderBy.push(direction(sportsResultsTable.declaredAt))
        break
      case 'createdAt':
        orderBy.push(direction(sportsResultsTable.createdAt))
        break
      default:
        break
    }
  }
  // Default sort if none specified
  if (orderBy.length === 0) {
    orderBy.push(desc(sportsResultsTable.createdAt))
  }

  const [items, [{ count }]] = await Promise.all([
    db.select({
      id: sportsResultsTable.id,
      tenant: sportsResultsTable.tenant,
      whitelabelId: sportsResultsTable.whitelabelId,
      isGlobal: sportsResultsTable.isGlobal,
      sportId: sportsResultsTable.sportId,
      leagueId: sportsResultsTable.leagueId,
      eventId: sportsResultsTable.eventId,
      marketId: sportsResultsTable.marketId,
      marketType: sportsResultsTable.marketType,
      runnerId: sportsResultsTable.runnerId,
      selectionName: sportsResultsTable.selectionName,
      result: sportsResultsTable.result,
      declaredBy: sportsResultsTable.declaredBy,
      declaredAt: sportsResultsTable.declaredAt,
      rolledBackAt: sportsResultsTable.rolledBackAt,
      rolledBackBy: sportsResultsTable.rolledBackBy,
      rollbackReason: sportsResultsTable.rollbackReason,
      rollbackTag: sportsResultsTable.rollbackTag,
      createdAt: sportsResultsTable.createdAt,
    })
      .from(sportsResultsTable)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(sportsResultsTable)
      .where(whereClause),
  ])

  return {
    items: items.map(item => ({
      ...item,
      marketType: item.marketType as SportsResultMarketType,
      result: item.result ? String(item.result) : null,
      isGlobal: Boolean(item.isGlobal),
    })),
    total: count,
  }
}

/**
 * Rollback a result with validation and guards. For global results, look up by id only and update by id only.
 */
export async function rollbackSportsResult(
  input: SportsResultRollbackInput,
  ctx: SportsResultContext
): Promise<{ id: string; rolledBackAt: Date; rolledBackBy: string }> {
  const { id, reason, tag } = input
  const { tenant, whitelabelId, actorId } = ctx

  const result = await getSportsResultById(id, tenant, whitelabelId, { byIdOnly: false })
  const resultById = result || await getSportsResultById(id, '', '', { byIdOnly: true })
  const toRollback = result || resultById
  if (!toRollback) {
    throw new Error('Result not found')
  }

  if (toRollback.rolledBackAt) {
    throw new Error('Result is already rolled back')
  }

  const isGlobal = Boolean((toRollback as any).isGlobal)
  const now = new Date()

  const [updated] = isGlobal
    ? await db.update(sportsResultsTable)
        .set({
          rolledBackAt: now,
          rolledBackBy: actorId,
          rollbackReason: reason || null,
          rollbackTag: tag || null,
        })
        .where(eq(sportsResultsTable.id, id))
        .returning()
    : await db.update(sportsResultsTable)
        .set({
          rolledBackAt: now,
          rolledBackBy: actorId,
          rollbackReason: reason || null,
          rollbackTag: tag || null,
        })
        .where(
          and(
            eq(sportsResultsTable.id, id),
            eq(sportsResultsTable.tenant, tenant),
            eq(sportsResultsTable.whitelabelId, whitelabelId)
          )
        )
        .returning()

  return {
    id: updated.id,
    rolledBackAt: updated.rolledBackAt!,
    rolledBackBy: updated.rolledBackBy!,
  }
}

/** Unpaginated card totals. Today follows the existing UI's IST calendar day. */
export async function getSportsResultStats(filter: SportsResultListFilter = {}, asOf = new Date()) {
  const { DateTime } = await import('luxon')
  const start = DateTime.fromJSDate(asOf, { zone: 'Asia/Kolkata' }).startOf('day')
  const from = start.toJSDate(), to = start.plus({ days: 1 }).toJSDate()
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    today: sql<number>`count(*) filter (where ${sportsResultsTable.declaredAt} >= ${from} and ${sportsResultsTable.declaredAt} < ${to})::int`,
    exchange: sql<number>`count(*) filter (where ${sportsResultsTable.marketType} = 'exchange' and ${sportsResultsTable.rolledBackAt} is null)::int`,
    bookmaker: sql<number>`count(*) filter (where ${sportsResultsTable.marketType} = 'bookmaker' and ${sportsResultsTable.rolledBackAt} is null)::int`,
    fancy: sql<number>`count(*) filter (where ${sportsResultsTable.marketType} = 'fancy' and ${sportsResultsTable.rolledBackAt} is null)::int`,
    rolledBack: sql<number>`count(*) filter (where ${sportsResultsTable.rolledBackAt} is not null)::int`,
  }).from(sportsResultsTable).where(await sportsResultConditions(filter))
  return { total: Number(row?.total ?? 0), today: Number(row?.today ?? 0), exchange: Number(row?.exchange ?? 0), bookmaker: Number(row?.bookmaker ?? 0), fancy: Number(row?.fancy ?? 0), rolledBack: Number(row?.rolledBack ?? 0) }
}
