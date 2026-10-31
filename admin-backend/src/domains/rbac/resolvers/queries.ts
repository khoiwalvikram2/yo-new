import { listRoles, getRoleById, listAllPermissions, getAdminRoles, aggregatePermissionPairs, listAdminUsers } from '@/repos/rbac/rbacRepo.js'
import { listIpAllowlist } from '@/repos/adminSecurityRepo.js'
import { hasPermission } from '@/domains/common/auth.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'

// Helper function to get the correct tenant for Whitelabel Admin and Super Admin
// SECURITY: Ensures Whitelabel Admin can only access their own tenant's data
// CRITICAL: Super Admin uses mode-based tenant selection
async function getEffectiveTenant(ctx: any): Promise<string> {
  // CRITICAL: For Super Admin, use effective tenant based on mode
  const directorTenant = getEffectiveTenantForDirector(ctx)
  if (directorTenant !== null) {
    return directorTenant
  }
  
  let tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
  
  const roleNames = ctx?.user?.roles || []
  const isWhitelabelAdmin = roleNames.some((r: string) => 
    r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
  )
  
  if (isWhitelabelAdmin && ctx?.user?.sub) {
    // Get Whitelabel Admin's actual tenant from database
    const { db } = await import('@/db/client.js')
    const { users } = await import('@/db/schema.js')
    const { eq } = await import('drizzle-orm')
    
    const userIdNum = Number(ctx.user.sub)
    if (Number.isFinite(userIdNum)) {
      const userRow = await db.select({ tenant: users.tenant })
        .from(users)
        .where(eq(users.id, userIdNum))
        .limit(1)
      
      if (userRow.length && userRow[0].tenant && typeof userRow[0].tenant === 'string') {
        tenant = userRow[0].tenant.trim()
      }
    }
  }
  
  return tenant
}

export const rbacQueryResolvers = {
  roles: async (_: any, __: any, ctx: any) => {
    // SECURITY: For Whitelabel Admin, use their actual tenant from database, not context tenant
    const tenant = await getEffectiveTenant(ctx)
    
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for roles')
    }
    const roles = await listRoles(tenant)
    return roles.map(r => ({
      id: String(r.id),
      name: r.name,
      tenant: r.tenant,
      permissions: aggregatePermissionPairs(r.permissions),
      updatedAt: r.updatedAt,
    }))
  },
  
  role: async (_: any, { id }: any, ctx: any) => {
    // CRITICAL: For Super Admin, use effective tenant based on mode
    const tenant = await getEffectiveTenant(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for roles')
    }
    const role = await getRoleById(Number(id), tenant)
    if (!role) return null
    return {
      id: String(role.id),
      name: role.name,
      tenant: role.tenant,
      permissions: aggregatePermissionPairs(role.permissions),
      updatedAt: role.updatedAt,
    }
  },
  
  permissions: async (_: any, __: any, ctx: any) => {
    // CRITICAL: For Super Admin, use effective tenant based on mode
    const tenant = await getEffectiveTenant(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for roles')
    }
    const perms = await listAllPermissions(tenant)
    return aggregatePermissionPairs(perms)
  },
  
  adminRoles: async (_: any, { userId }: any, ctx: any) => {
    // CRITICAL: For Super Admin, use effective tenant based on mode
    const tenant = await getEffectiveTenant(ctx)
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'view')) {
      throw new Error('Forbidden: insufficient permissions for roles')
    }
    const roles = await getAdminRoles(Number(userId), tenant)
    return roles.map(r => ({
      id: String(r.id),
      name: r.name,
      tenant: r.tenant,
      permissions: aggregatePermissionPairs(r.permissions),
      updatedAt: r.updatedAt,
    }))
  },
  
  supportAdmins: async (_: any, __: any, ctx: any) => {
    // SECURITY: For Whitelabel Admin, use their actual tenant from database, not context tenant
    const tenant = await getEffectiveTenant(ctx)
    
    const perms = ctx?.permissions || []
    
    const hasRolesView = hasPermission(perms, 'security.roles', 'view')
    const hasSupportAdminsAccess = hasPermission(perms, 'security.support-admins', 'view') || hasPermission(perms, 'security.support-admins', 'create') || hasPermission(perms, 'security.support-admins', 'update')
    const hasAllStar = hasPermission(perms, 'all', '*')
    
    if (!hasAllStar && !hasRolesView && !hasSupportAdminsAccess) {
      throw new Error('Forbidden: insufficient permissions for support admins')
    }
    
    const adminUsers = await listAdminUsers(tenant)
    
    // Filter to only return Support Admins - exclude privileged admin roles
    const privilegedRoles = ['Whitelabel Admin', 'Super Admin', 'whitelabel_admin', 'super_admin']
    const filteredAdmins = adminUsers.filter(au => {
      // Check if user has any privileged role
      const hasPrivilegedRole = au.roles.some(r => {
        const roleName = r.name || ''
        const roleLower = roleName.toLowerCase()
        return (
          privilegedRoles.includes(roleName) ||
          privilegedRoles.includes(roleLower) ||
          roleLower.includes('whitelabel') ||
          (roleLower.includes('super') && roleLower.includes('admin'))
        )
      })
      // Only include users who do NOT have privileged roles
      return !hasPrivilegedRole
    })
    
    return filteredAdmins.map(au => ({
      id: String(au.id),
      name: au.name,
      email: au.email,
      status: au.status.toUpperCase() as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
      createdAt: au.createdAt instanceof Date ? au.createdAt.toISOString() : (typeof au.createdAt === 'string' ? au.createdAt : new Date().toISOString()),
      roles: au.roles.map(r => ({
        id: String(r.id),
        name: r.name,
        tenant: r.tenant,
        permissions: aggregatePermissionPairs(r.permissions),
        updatedAt: r.updatedAt,
      })),
    }))
  },
  
  ipAllowlist: async (_: any, { userId }: any, ctx: any) => {
    // CRITICAL: For Super Admin, use effective tenant based on mode
    const tenant = await getEffectiveTenant(ctx)
    const perms = ctx?.permissions || []
    
    if (!hasPermission(perms, 'security.ip-allowlist', 'view')) {
      throw new Error('Forbidden: insufficient permissions for IP allowlist')
    }
    
    const entries = await listIpAllowlist(Number(userId), tenant)
    return entries.map(e => ({
      id: String(e.id),
      cidr: e.cidr,
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : (typeof e.createdAt === 'string' ? e.createdAt : new Date().toISOString()),
    }))
  },
}

