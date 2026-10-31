import { listAuditDb } from '@src/repos/audit/auditRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { getAuditStats } from '../services/auditStatsService.js'
import { getAuditAnnotations } from '@src/repos/audit/auditAnnotationRepo.js'
import { getAuditExportJobs } from '@src/repos/audit/auditExportJobRepo.js'
import { requireReadPermission } from '@src/domains/common/auth.js'

function getEffectiveTenant(ctx: any): string {
  const directorTenant = getEffectiveTenantForDirector(ctx)
  return directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
}

function hasWhitelabelAdminRole(ctx: any): boolean {
  const roles = Array.isArray(ctx?.user?.roles) ? ctx.user.roles : []
  return roles.some(
    (r: string) =>
      r === 'Whitelabel Admin' ||
      r?.toLowerCase() === 'whitelabel_admin' ||
      (typeof r === 'string' && r.toLowerCase().includes('whitelabel'))
  )
}

/** True if context is for an authenticated user in a whitelabel (non-default) tenant. */
function isWhitelabelTenantUser(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(ctx?.user?.sub && tenant && tenant !== 'default')
}

/** True if effective tenant is whitelabel (non-default). Used when user/permissions may be missing in context (e.g. WS). */
function isWhitelabelTenantContext(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(tenant && tenant !== 'default')
}

function checkAuditPermission(ctx: any): void {
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) return
  if (hasWhitelabelAdminRole(ctx)) return
  if (isWhitelabelTenantUser(ctx)) return
  if (isWhitelabelTenantContext(ctx)) return
  const perms = ctx?.permissions || []
  if (!hasPermission(perms, 'audit.events', 'view')) {
    throw new Error('Forbidden: insufficient permissions for audit events')
  }
}

function checkAuditExportPermission(ctx: any): void {
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) return
  if (hasWhitelabelAdminRole(ctx) || isWhitelabelTenantUser(ctx) || isWhitelabelTenantContext(ctx)) {
    if (!hasPermission(ctx?.permissions ?? [], 'audit.events', 'export')) {
      throw new Error('Forbidden: insufficient permissions for audit export')
    }
    return
  }
  const perms = ctx?.permissions || []
  if (!hasPermission(perms, 'audit.events', 'view')) {
    throw new Error('Forbidden: insufficient permissions for audit events')
  }
  if (!hasPermission(perms, 'audit.events', 'export')) {
    throw new Error('Forbidden: insufficient permissions for audit export')
  }
}

export const auditQueryResolvers = {
  audit: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'audit.events', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    let actorId = args.actor ?? undefined
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) actorId = undefined
    const result = await listAuditDb({
      tenant,
      domain: args.domain ?? undefined,
      action: args.action ?? undefined,
      actorId,
      from: args.from ?? undefined,
      to: args.to ?? undefined,
      limit: args.limit ?? 100,
      agentId: ctx?.user?.type === 'agent' ? ctx?.user?.agentId : undefined,
    })
    return result.items
  },

  auditEvents: async (_: any, args: { filters?: any }, ctx: any) => {
    requireReadPermission(ctx, 'audit.events', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const filters = args.filters || {}
    
    // Normalize filters (handle array vs single values)
    const normalizedFilters: any = {
      tenant,
      id: filters.id,
      domain: filters.domain,
      action: filters.action,
      actorId: filters.actorId,
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      from: filters.from,
      to: filters.to,
      search: filters.search,
      page: filters.page ?? 1,
      limit: filters.limit ?? 100,
      sort: filters.sort ?? 'timestamp:desc',
      agentId: ctx?.user?.type === 'agent' ? ctx?.user?.agentId : undefined,
    }
    
    // For agents, don't allow filtering by actorId directly
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      normalizedFilters.actorId = undefined
    }
    
    const result = await listAuditDb(normalizedFilters)
    
    return {
      items: result.items,
      total: result.total,
      page: normalizedFilters.page,
      pageSize: normalizedFilters.limit,
    }
  },
  
  // Statistics query
  auditStats: async (_: any, args: { filters?: any }, ctx: any) => {
    requireReadPermission(ctx, 'audit.events', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const filters = args.filters || {}
    
    const normalizedFilters: any = {
      tenant,
      domain: filters.domain,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      agentId: ctx?.user?.type === 'agent' ? ctx?.user?.agentId : undefined,
    }
    
    return getAuditStats(normalizedFilters)
  },
  
  // CSV export query (requires audit.events export permission)
  auditExportCSV: async (_: any, args: any, ctx: any) => {
    const tenant = getEffectiveTenant(ctx)
    checkAuditExportPermission(ctx)
    
    // Support both old format (individual params) and new format (filters object)
    const filters = args.filters || {}
    
    // Build filter for database query (support full filters object and legacy args)
    const dbFilters: any = {
      tenant,
      id: filters.id ?? undefined,
      domain: filters.domain ?? args.domain ?? undefined,
      action: filters.action ?? args.action ?? undefined,
      actorId: filters.actorId ?? args.actor ?? undefined,
      resourceType: filters.resourceType ?? undefined,
      resourceId: filters.resourceId ?? undefined,
      from: filters.from ?? args.from ?? undefined,
      to: filters.to ?? args.to ?? undefined,
      search: filters.search ?? undefined,
      agentId: ctx?.user?.type === 'agent' ? ctx?.user?.agentId : undefined,
      limit: 10000, // Large limit for export
    }
    
    // Fetch all matching events
    const result = await listAuditDb(dbFilters)
    const events = result.items || []
    
    // Generate CSV
    const headers = ['id', 'tenant', 'actorId', 'domain', 'action', 'resourceType', 'resourceId', 'timestamp']
    const csvLines = [headers.join(',')]
    
    for (const event of events) {
      const row = [
        event.id,
        event.tenant || '',
        event.actorId,
        event.domain,
        event.action,
        event.resourceType,
        event.resourceId,
        event.timestamp,
      ].map((val) => {
        // Escape CSV values (handle commas, quotes, newlines)
        const str = String(val || '')
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      })
      csvLines.push(row.join(','))
    }
    
    return csvLines.join('\n')
  },
  
  // Export jobs query (view permission sufficient to list own jobs)
  auditExportJobs: async (_: any, args: { status?: string; limit?: number }, ctx: any) => {
    requireReadPermission(ctx, 'audit.events', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const whitelabelId = ctx?.whitelabel?.id ?? tenant
    const createdBy = ctx?.user?.sub ? parseInt(ctx.user.sub, 10) : undefined
    
    return getAuditExportJobs({
      tenant,
      whitelabelId,
      createdBy,
      status: args.status,
      limit: args.limit ?? 50,
    })
  },
    auditExportJobsPage: async (_: any, args: { status?: string; limit?: number; offset?: number }, ctx: any) => {
    requireReadPermission(ctx, 'audit.events', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const whitelabelId = ctx?.whitelabel?.id ?? tenant
    const createdBy = ctx?.user?.sub ? parseInt(ctx.user.sub, 10) : undefined
    
    return (await import('@/repos/audit/auditExportJobRepo.js')).getAuditExportJobsPage({
      tenant,
      whitelabelId,
      createdBy,
      status: args.status,
      limit: args.limit ?? 50,
      offset: args.offset,
    })
  },
  
  // Annotations query
  auditAnnotations: async (_: any, args: { auditEventId: string }, ctx: any) => {
    requireReadPermission(ctx, 'audit.annotations', 'view')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const auditEventId = parseInt(args.auditEventId, 10)
    if (isNaN(auditEventId)) {
      throw new Error('Invalid auditEventId')
    }
    
    const annotations = await getAuditAnnotations(auditEventId, tenant)
    
    return annotations.map((a: any) => ({
      id: String(a.id),
      tenant: a.tenant,
      auditEventId: String(a.auditEventId),
      createdBy: String(a.createdBy),
      note: a.note,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt ? a.updatedAt.toISOString() : null,
    }))
  },
}
