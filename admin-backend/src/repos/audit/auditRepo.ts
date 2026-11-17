import { db } from '@src/db/client.js'
import { auditLogs } from '@src/db/schema.js'
import { recordAudit } from '@shared/audit/recordAudit.js'
import { and, eq, gte, lte, desc, asc, or, ilike, inArray, sql } from 'drizzle-orm'
import { getStartOfDay } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

export interface AuditListFilter {
  tenant?: string
  id?: string | number
  domain?: string | string[]
  action?: string | string[]
  actorId?: string
  resourceType?: string | string[]
  resourceId?: string
  from?: string
  to?: string
  search?: string
  page?: number
  limit?: number
  sort?: string
  agentId?: string
  offset?: number
  playerSecurity?: { userId: string; type?: string; success?: boolean }
}

async function publishAuditEvent(event: {
  id: number
  tenant: string
  actorId: string
  domain: string
  action: string
  resourceType: string
  resourceId: string
  before?: any
  after?: any
  timestamp: string
}, pubsub?: any) {
  try {
    const { getRedisEmitter } = await import('@src/realtime/redisPubsub.js')
    const topic = `audit.events.${event.tenant}`
    const payload = {
      auditEvents: {
        id: String(event.id),
        tenant: event.tenant,
        actorId: event.actorId,
        domain: event.domain,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        before: event.before ?? null,
        after: event.after ?? null,
        timestamp: event.timestamp,
      }
    }
    const emitter = getRedisEmitter()
    emitter.emit({ topic, payload })
    if (pubsub && typeof pubsub.publish === 'function') {
      try {
        const publishResult = pubsub.publish({ topic, payload })
        if (publishResult?.catch) publishResult.catch(() => {})
      } catch (err) {
      }
    }
  } catch (err) {
  }
}

// tenant is required (SYS-22): a caller that leaves it out fails the typecheck instead of
// silently filing its rows under 'default', where its own whitelabel's Audit Trail never sees them.
export async function recordAuditDb(input: { tenant: string; actorId: string; domain: string; action: string; resourceType: string; resourceId: string; before?: any; after?: any; pubsub?: any }) {
  const tenant = input.tenant
  const result = await recordAudit(db, {
    tenant,
    actorId: input.actorId,
    domain: input.domain,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before,
    after: input.after,
  })
  if (result) {
    await publishAuditEvent({
      id: result.id,
      tenant,
      actorId: input.actorId,
      domain: input.domain,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before,
      after: input.after,
      timestamp: result.createdAt.toISOString(),
    }, input.pubsub)
  }
  return result?.id ?? null
}

/** The free-text search: actor, domain, action, resource type or id contain the text, or it is the event id. */
function searchCondition(search: string | undefined): any {
  if (!search || !String(search).trim()) return undefined
  const searchTerm = `%${String(search).trim()}%`
  const searchConditions: any[] = [
    ilike(auditLogs.actorId, searchTerm),
    ilike(auditLogs.domain, searchTerm),
    ilike(auditLogs.action, searchTerm),
    ilike(auditLogs.resourceType, searchTerm),
    ilike(auditLogs.resourceId, searchTerm),
  ]
  const numericId = Number(search)
  if (Number.isFinite(numericId) && numericId > 0) {
    searchConditions.push(eq(auditLogs.id, numericId))
  }
  return or(...searchConditions)
}

export async function listAuditDb(filters: AuditListFilter = {}): Promise<{ items: any[]; total: number }> {
  const tenant = filters.tenant ?? 'default'
  const whereClauses: any[] = [eq(auditLogs.tenant, tenant)]

  if (filters.id !== undefined && filters.id !== null) {
    const idValue = typeof filters.id === 'string' ? Number(filters.id) : filters.id
    if (Number.isFinite(idValue) && idValue > 0) {
      whereClauses.push(eq(auditLogs.id, idValue))
    }
  }

  if (filters.domain) {
    const domains = Array.isArray(filters.domain) ? filters.domain : [filters.domain]
    if (domains.length > 0) {
      whereClauses.push(inArray(auditLogs.domain, domains))
    }
  }

  if (filters.action) {
    const actions = Array.isArray(filters.action) ? filters.action : [filters.action]
    if (actions.length > 0) {
      whereClauses.push(inArray(auditLogs.action, actions))
    }
  }

  if (filters.actorId) {
    whereClauses.push(eq(auditLogs.actorId, filters.actorId))
  }

  if (filters.resourceType) {
    const resourceTypes = Array.isArray(filters.resourceType) ? filters.resourceType : [filters.resourceType]
    if (resourceTypes.length > 0) {
      whereClauses.push(inArray(auditLogs.resourceType, resourceTypes))
    }
  }

  if (filters.resourceId) {
    whereClauses.push(eq(auditLogs.resourceId, filters.resourceId))
  }

  if (filters.from) {
    whereClauses.push(gte(auditLogs.createdAt, new Date(filters.from)))
  }
  if (filters.to) {
    whereClauses.push(lte(auditLogs.createdAt, new Date(filters.to)))
  }

  const search = searchCondition(filters.search)
  if (search) whereClauses.push(search)

  if (filters.agentId) {
    const { PlayerAuthService } = await import('../../domains/players/services/PlayerAuthService.js')
    const playerAuthService = new PlayerAuthService()
    const agentPlayerIds = await playerAuthService.getAgentPlayerIds(filters.agentId, tenant)
    if (agentPlayerIds.length > 0) {
      whereClauses.push(inArray(auditLogs.actorId, agentPlayerIds.map(String)))
    } else {
      return { items: [], total: 0 }
    }
  }

  if (filters.playerSecurity) {
    const { userId, type, success } = filters.playerSecurity;
    whereClauses.push(sql`not (${auditLogs.domain} = 'users.security' and (${auditLogs.action} in ('invalid_user_tenant','cross_tenant_access_blocked','tenant_switch_blocked','unauthorized_admin_mode_header','invalid_whitelabel_id','ip_blocked') or ${auditLogs.resourceId} is distinct from ${userId}))`);
    if (type) whereClauses.push(type === 'login' ? inArray(auditLogs.action, ['login','login_failed']) : eq(auditLogs.action, type));
    if (success != null) whereClauses.push(success ? sql`${auditLogs.action} <> 'login_failed'` : eq(auditLogs.action, 'login_failed'));
  }
  const whereClause = and(...whereClauses)
  const page = Math.max(1, filters.page ?? 1)
  const limit = Math.min(10000, Math.max(1, filters.limit ?? 100))
  const offset = filters.offset == null ? (page - 1) * limit : Math.max(0, filters.offset)
  const sortParts = (filters.sort ?? 'timestamp:desc').split(',').map(s => s.trim())

  const orderBy: any[] = []
  for (const part of sortParts) {
    const [field, dir] = part.split(':')
    const direction = (dir || 'desc').toLowerCase() === 'asc' ? asc : desc
    switch (field) {
      case 'timestamp':
      case 'createdAt':
        orderBy.push(direction(auditLogs.createdAt))
        break
      case 'domain':
        orderBy.push(direction(auditLogs.domain))
        break
      case 'action':
        orderBy.push(direction(auditLogs.action))
        break
      case 'actorId':
      case 'actor':
        orderBy.push(direction(auditLogs.actorId))
        break
      case 'resourceType':
        orderBy.push(direction(auditLogs.resourceType))
        break
      default:
        break
    }
  }
  if (orderBy.length === 0) {
    orderBy.push(desc(auditLogs.createdAt))
  }

  orderBy.push(desc(auditLogs.id))

  const [items, countResult] = await Promise.all([
    db.select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(whereClause),
  ])

  const count = countResult[0]?.count ?? 0
  return {
    items: items.map((r: any) => ({
      id: String(r.id),
      tenant: String(r.tenant),
      actorId: String(r.actorId),
      domain: String(r.domain),
      action: String(r.action),
      resourceType: String(r.resourceType),
      resourceId: String(r.resourceId),
      before: (r?.before ?? null) as any,
      after: (r?.after ?? null) as any,
      timestamp: (r.createdAt as Date).toISOString(),
    })),
    total: Number(count),
  }
}

export interface AuditStatsResult {
  total: number
  today: number
  uniqueActors: number
  byDomain: Array<{ domain: string; count: number }>
  byAction: Array<{ action: string; count: number }>
  recentEvents: Array<{ id: string; domain: string; action: string; timestamp: string }>
}

function buildStatsWhereConditions(filters: AuditListFilter): any {
  const conditions: any[] = [eq(auditLogs.tenant, filters.tenant ?? 'default')]
  if (filters.domain) {
    const domains = Array.isArray(filters.domain) ? filters.domain : [filters.domain]
    if (domains.length > 0) conditions.push(inArray(auditLogs.domain, domains))
  }
  if (filters.action) {
    const actions = Array.isArray(filters.action) ? filters.action : [filters.action]
    if (actions.length > 0) conditions.push(inArray(auditLogs.action, actions))
  }
  if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId))
  if (filters.resourceType) {
    const rts = Array.isArray(filters.resourceType) ? filters.resourceType : [filters.resourceType]
    if (rts.length > 0) conditions.push(inArray(auditLogs.resourceType, rts))
  }
  if (filters.resourceId) conditions.push(eq(auditLogs.resourceId, filters.resourceId))
  if (filters.from) conditions.push(gte(auditLogs.createdAt, new Date(filters.from)))
  if (filters.to) conditions.push(lte(auditLogs.createdAt, new Date(filters.to)))
  const search = searchCondition(filters.search)
  if (search) conditions.push(search)
  return conditions.length > 0 ? and(...conditions) : undefined
}

export interface AuditFilterOptions {
  domains: string[]
  actions: string[]
  resourceTypes: string[]
}

const FILTER_OPTIONS_TTL_MS = 60_000
const filterOptionsCache = new Map<string, { at: number; value: AuditFilterOptions }>()

/**
 * The domains, actions and resource types a tenant's trail holds, for the Audit Trail's filter lists.
 *
 * The lists were constants that had drifted from what recordAuditDb callers write ('users' where the trail
 * says 'users.security', 'approve' where it says 'approve_deposit'), so most events could not be selected.
 * One grouped read of the tenant's rows (an agent's: its players' rows, as listAuditDb scopes them), kept
 * for a minute per tenant.
 */
export async function getAuditFilterOptions(tenant: string, agentId?: string): Promise<AuditFilterOptions> {
  const key = `${tenant}\u0000${agentId ?? ''}`
  const cached = filterOptionsCache.get(key)
  if (cached && Date.now() - cached.at < FILTER_OPTIONS_TTL_MS) return cached.value

  const conditions: any[] = [eq(auditLogs.tenant, tenant)]
  if (agentId) {
    const { PlayerAuthService } = await import('../../domains/players/services/PlayerAuthService.js')
    const agentPlayerIds = await new PlayerAuthService().getAgentPlayerIds(agentId, tenant)
    if (agentPlayerIds.length === 0) return { domains: [], actions: [], resourceTypes: [] }
    conditions.push(inArray(auditLogs.actorId, agentPlayerIds.map(String)))
  }
  const rows = await db
    .selectDistinct({ domain: auditLogs.domain, action: auditLogs.action, resourceType: auditLogs.resourceType })
    .from(auditLogs)
    .where(and(...conditions))
  const sorted = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b))
  const value = {
    domains: sorted(rows.map((r) => r.domain)),
    actions: sorted(rows.map((r) => r.action)),
    resourceTypes: sorted(rows.map((r) => r.resourceType)),
  }
  filterOptionsCache.set(key, { at: Date.now(), value })
  return value
}

export async function getAuditStats(filters: AuditListFilter = {}): Promise<AuditStatsResult> {
  const whereClause = buildStatsWhereConditions(filters)
  const tenant = filters.tenant ?? 'default'
  const tz = await getWhitelabelTimezone(tenant)
  const todayStartDate = getStartOfDay(tz)
  const todayStart = todayStartDate.toISOString()

  let finalWhereClause = whereClause
  if (filters.agentId && tenant) {
    try {
      const { PlayerAuthService } = await import('../../domains/players/services/PlayerAuthService.js')
      const playerAuthService = new PlayerAuthService()
      const agentPlayerIds = (await playerAuthService.getAgentPlayerIds(filters.agentId, tenant)).map(String)
      if (agentPlayerIds.length === 0) {
        return { total: 0, today: 0, uniqueActors: 0, byDomain: [], byAction: [], recentEvents: [] }
      }
      const agentWhere = inArray(auditLogs.actorId, agentPlayerIds)
      finalWhereClause = whereClause ? and(whereClause, agentWhere) : agentWhere
    } catch {
      // ignore
    }
  }

  const [
    totalResult,
    todayResult,
    domainResult,
    actionResult,
    uniqueActorsResult,
    recentEventsResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(finalWhereClause),
    db.select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(finalWhereClause ? and(finalWhereClause, gte(auditLogs.createdAt, new Date(todayStart))) : gte(auditLogs.createdAt, new Date(todayStart))),
    db.select({
      domain: auditLogs.domain,
      count: sql<number>`count(*)::int`,
    })
      .from(auditLogs)
      .where(finalWhereClause)
      .groupBy(auditLogs.domain)
      .orderBy(desc(sql<number>`count(*)::int`))
      .limit(10),
    db.select({
      action: auditLogs.action,
      count: sql<number>`count(*)::int`,
    })
      .from(auditLogs)
      .where(finalWhereClause)
      .groupBy(auditLogs.action)
      .orderBy(desc(sql<number>`count(*)::int`))
      .limit(10),
    db.select({
      count: sql<number>`count(distinct ${auditLogs.actorId})::int`,
    })
      .from(auditLogs)
      .where(finalWhereClause),
    db.select({
      id: auditLogs.id,
      domain: auditLogs.domain,
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
    })
      .from(auditLogs)
      .where(finalWhereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(5),
  ])

  return {
    total: Number(totalResult[0]?.count || 0),
    today: Number(todayResult[0]?.count || 0),
    uniqueActors: Number(uniqueActorsResult[0]?.count || 0),
    byDomain: domainResult.map((r: any) => ({
      domain: String(r.domain),
      count: Number(r.count || 0),
    })),
    byAction: actionResult.map((r: any) => ({
      action: String(r.action),
      count: Number(r.count || 0),
    })),
    recentEvents: recentEventsResult.map((r: any) => ({
      id: String(r.id),
      domain: String(r.domain),
      action: String(r.action),
      timestamp: (r.createdAt as Date).toISOString(),
    })),
  }
}

