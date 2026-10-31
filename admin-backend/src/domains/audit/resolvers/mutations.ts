import { hasPermission } from '@/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import {
  createAuditAnnotation,
  updateAuditAnnotation,
  deleteAuditAnnotation,
} from '@src/repos/audit/auditAnnotationRepo.js'
import { createAuditExportJob } from '@src/repos/audit/auditExportJobRepo.js'
import { listAuditDb } from '@src/repos/audit/auditRepo.js'
import { requirePermission } from '@src/domains/common/auth.js'

// Helper to get effective tenant
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

function isWhitelabelTenantUser(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(ctx?.user?.sub && tenant && tenant !== 'default')
}

function isWhitelabelTenantContext(ctx: any): boolean {
  const tenant = getEffectiveTenant(ctx)
  return Boolean(tenant && tenant !== 'default')
}

// Helper to check view permission (Whitelabel Admin or whitelabel-tenant user/context has audit view)
function checkAuditPermission(ctx: any): void {
  if (hasWhitelabelAdminRole(ctx)) return
  if (isWhitelabelTenantUser(ctx)) return
  if (isWhitelabelTenantContext(ctx)) return
  if (!hasPermission(ctx?.permissions ?? [], 'audit.events', 'view')) {
    throw new Error('Forbidden: insufficient permissions for audit events')
  }
}

// Helper to check export permission (aligned with queries: agent bypass, whitelabel needs export, else view + export)
function checkAuditExportPermission(ctx: any): void {
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) return
  if (hasWhitelabelAdminRole(ctx) || isWhitelabelTenantUser(ctx) || isWhitelabelTenantContext(ctx)) {
    if (!hasPermission(ctx?.permissions ?? [], 'audit.events', 'export')) {
      throw new Error('Forbidden: insufficient permissions for audit export')
    }
    return
  }
  const perms = ctx?.permissions ?? []
  if (!hasPermission(perms, 'audit.events', 'view')) {
    throw new Error('Forbidden: insufficient permissions for audit events')
  }
  if (!hasPermission(perms, 'audit.events', 'export')) {
    throw new Error('Forbidden: insufficient permissions for audit export')
  }
}

export const auditMutationResolvers = {
  // Create annotation
  createAuditAnnotation: async (_: any, args: { input: any }, ctx: any) => {
    requirePermission(ctx, 'audit.annotations', 'create')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const userId = ctx?.user?.sub ? parseInt(ctx.user.sub, 10) : null
    if (!userId || isNaN(userId)) {
      throw new Error('Invalid user ID')
    }
    
    const auditEventId = parseInt(args.input.auditEventId, 10)
    if (isNaN(auditEventId)) {
      throw new Error('Invalid auditEventId')
    }
    
    if (!args.input.note || args.input.note.trim().length === 0) {
      throw new Error('Note cannot be empty')
    }
    
    if (args.input.note.length > 1000) {
      throw new Error('Note cannot exceed 1000 characters')
    }

    const eventCheck = await listAuditDb({ tenant, id: auditEventId, limit: 1 })
    if (!eventCheck.items.length) {
      throw new Error('Audit event not found or access denied')
    }
    
    const annotation = await createAuditAnnotation({
      tenant,
      auditEventId,
      createdBy: userId,
      note: args.input.note.trim(),
    })
    
    return {
      id: String(annotation.id),
      tenant: annotation.tenant,
      auditEventId: String(annotation.auditEventId),
      createdBy: String(annotation.createdBy),
      note: annotation.note,
      createdAt: annotation.createdAt.toISOString(),
      updatedAt: annotation.updatedAt ? annotation.updatedAt.toISOString() : null,
    }
  },
  
  // Update annotation
  updateAuditAnnotation: async (_: any, args: { input: any }, ctx: any) => {
    requirePermission(ctx, 'audit.annotations', 'update')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const id = parseInt(args.input.id, 10)
    if (isNaN(id)) {
      throw new Error('Invalid annotation ID')
    }
    
    if (!args.input.note || args.input.note.trim().length === 0) {
      throw new Error('Note cannot be empty')
    }
    
    if (args.input.note.length > 1000) {
      throw new Error('Note cannot exceed 1000 characters')
    }
    
    const annotation = await updateAuditAnnotation({
      id,
      tenant,
      note: args.input.note.trim(),
    })
    
    return {
      id: String(annotation.id),
      tenant: annotation.tenant,
      auditEventId: String(annotation.auditEventId),
      createdBy: String(annotation.createdBy),
      note: annotation.note,
      createdAt: annotation.createdAt.toISOString(),
      updatedAt: annotation.updatedAt ? annotation.updatedAt.toISOString() : null,
    }
  },
  
  // Delete annotation
  deleteAuditAnnotation: async (_: any, args: { id: string }, ctx: any) => {
    requirePermission(ctx, 'audit.annotations', 'delete')
    const tenant = getEffectiveTenant(ctx)
    checkAuditPermission(ctx)
    
    const id = parseInt(args.id, 10)
    if (isNaN(id)) {
      throw new Error('Invalid annotation ID')
    }
    
    const success = await deleteAuditAnnotation(id, tenant)
    
    return { success }
  },
  
  // Create export job (requires audit.events export permission)
  createAuditExportJob: async (_: any, args: { input: any }, ctx: any) => {
    const tenant = getEffectiveTenant(ctx)
    checkAuditExportPermission(ctx)
    
    const userId = ctx?.user?.sub ? parseInt(ctx.user.sub, 10) : null
    if (!userId || isNaN(userId)) {
      throw new Error('Invalid user ID')
    }
    
    const whitelabelId = ctx?.whitelabel?.id ?? tenant
    
    const validFormats = ['CSV', 'JSON', 'XLSX']
    if (!validFormats.includes(args.input.exportFormat)) {
      throw new Error(`Invalid export format. Must be one of: ${validFormats.join(', ')}`)
    }
    
    const scheduledAt = args.input.scheduledAt ? new Date(args.input.scheduledAt) : null
    
    const job = await createAuditExportJob({
      tenant,
      whitelabelId,
      createdBy: userId,
      filtersJson: args.input.filtersJson,
      exportFormat: args.input.exportFormat,
      scheduledAt,
    })

    // Process in background (fire-and-forget)
    import('@src/domains/audit/services/AuditExportJobProcessor.js').then(({ processAuditExportJob }) => {
      processAuditExportJob(job.id, job.tenant).catch((err) => {
        console.warn('[audit] Export job processing failed', { jobId: job.id, err: err?.message ?? String(err) })
      })
    })
    
    return {
      id: job.id,
      tenant: job.tenant,
      whitelabelId: job.whitelabelId,
      createdBy: String(job.createdBy),
      filtersJson: job.filtersJson,
      exportFormat: job.exportFormat,
      status: job.status,
      fileUrl: job.fileUrl,
      errorMessage: job.errorMessage,
      scheduledAt: job.scheduledAt ? job.scheduledAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
    }
  },
}
