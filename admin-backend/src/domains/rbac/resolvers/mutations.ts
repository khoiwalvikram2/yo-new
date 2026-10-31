import { createRole, renameRole, deleteRole, setRolePermissionsById, assignRoleToAdmin, revokeRoleFromAdmin, getRoleById, aggregatePermissionPairs, listAdminUsers, getAdminRoles, deleteSupportAdmin } from '@/repos/rbac/rbacRepo.js'
import { createAdminUser } from '@/repos/users/usersRepo.js'
import { addIpToAllowlist, removeIpFromAllowlist } from '@/repos/adminSecurityRepo.js'
import { recordAuditDb } from '@/repos/audit/auditRepo.js'
import { ensureNoPrivilegeEscalation, ensureActorMayGrantPermissions, ensureMayUseRoleName } from '@/domains/rbac/services/rbacService.js'
import { hasPermission } from '@/domains/common/auth.js'
import { z } from 'zod'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { requirePermission } from '@src/domains/common/auth.js'

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

const CreateRoleInput = z.object({
  input: z.object({
    name: z.string().min(1),
    permissions: z.array(z.object({
      domain: z.string().min(1),
      actions: z.array(z.string().min(1)),
    })),
  }),
})

const UpdateRoleInput = z.object({
  input: z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    permissions: z.array(z.object({
      domain: z.string().min(1),
      actions: z.array(z.string().min(1)),
    })).optional(),
  }),
})

const AssignRoleInput = z.object({
  input: z.object({
    userId: z.string().min(1),
    roleId: z.string().min(1),
  }),
})

const CreateSupportAdminInput = z.object({
  input: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    phone: z.string().optional(),
    roleIds: z.array(z.string().min(1)).min(1),
  }),
})

export const rbacMutationResolvers = {
  createRBACRole: async (_: any, args: any, ctx: any) => {
    const parsed = CreateRoleInput.safeParse(args)
    if (!parsed.success) {
      return { success: false, message: 'Invalid input', role: null }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'create')) {
      return { success: false, message: 'Forbidden: insufficient permissions for roles', role: null }
    }
    
    try {
      const { name, permissions } = parsed.data.input
      // Convert permissions to PermissionPair format
      const permPairs = permissions.flatMap(p => 
        p.actions.map(action => ({ domain: p.domain, action }))
      )

      // A role definition may not hand out more than its author holds. Without
      // this, `{ domain: 'all', actions: ['*'] }` was accepted verbatim and
      // `ensurePermissions()` created the row — a two-call path to Super Admin.
      if (!userId) {
        return { success: false, message: 'Unauthorized: authentication required', role: null }
      }
      await ensureActorMayGrantPermissions(userId, tenant, permPairs)

      // A privileged-looking name is itself a grant: `buildAuthContext` reads
      // role names to decide Super Admin, and a Super Admin may switch tenants.
      ensureMayUseRoleName(ctx?.permissions, name)

      // Checked before the role exists, so a refusal leaves nothing behind.
      const roleId = await createRole(name, tenant)
      await setRolePermissionsById(roleId, permPairs, tenant)
      
      const role = await getRoleById(roleId, tenant)
      if (!role) {
        return { success: false, message: 'Failed to create role', role: null }
      }
      
      return {
        success: true,
        message: `Role "${name}" created successfully`,
        role: {
          id: String(role.id),
          name: role.name,
          tenant: role.tenant,
          permissions: aggregatePermissionPairs(role.permissions),
          updatedAt: role.updatedAt,
        },
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to create role', role: null }
    }
  },
  
  updateRBACRole: async (_: any, args: any, ctx: any) => {
    const parsed = UpdateRoleInput.safeParse(args)
    if (!parsed.success) {
      return { success: false, message: 'Invalid input', role: null }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'update')) {
      return { success: false, message: 'Forbidden: insufficient permissions for roles', role: null }
    }
    
    try {
      const { id, name, permissions } = parsed.data.input
      const roleId = Number(id)
      
      // Update name if provided
      if (name) {
        // A rename reaches the same privileged name as a create would.
        ensureMayUseRoleName(ctx?.permissions, name)
        await renameRole(roleId, name, tenant)
      }
      
      // Update permissions if provided
      if (permissions) {
        const permPairs = permissions.flatMap(p => 
          p.actions.map(action => ({ domain: p.domain, action }))
        )

        // A role definition may not hand out more than its author holds. Without
        // this, `{ domain: 'all', actions: ['*'] }` was accepted verbatim and
        // `ensurePermissions()` created the row — a two-call path to Super Admin.
        if (!userId) {
          return { success: false, message: 'Unauthorized: authentication required', role: null }
        }
        await ensureActorMayGrantPermissions(userId, tenant, permPairs)

        await setRolePermissionsById(roleId, permPairs, tenant)
      }
      
      const role = await getRoleById(roleId, tenant)
      if (!role) {
        return { success: false, message: 'Role not found', role: null }
      }
      
      return {
        success: true,
        message: 'Role updated successfully',
        role: {
          id: String(role.id),
          name: role.name,
          tenant: role.tenant,
          permissions: aggregatePermissionPairs(role.permissions),
          updatedAt: role.updatedAt,
        },
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update role', role: null }
    }
  },
  
  deleteRBACRole: async (_: any, { id }: any, ctx: any) => {
    requirePermission(ctx, 'security.roles', 'delete')
    const tenant = await getEffectiveTenant(ctx)
    
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'delete')) {
      return { success: false, message: 'Forbidden: insufficient permissions for roles', role: null }
    }
    
    try {
      const roleId = Number(id)
      const role = await getRoleById(roleId, tenant)
      if (!role) {
        return { success: false, message: 'Role not found', role: null }
      }
      
      await deleteRole(roleId, tenant)
      
      return {
        success: true,
        message: `Role "${role.name}" deleted successfully`,
        role: {
          id: String(role.id),
          name: role.name,
          tenant: role.tenant,
          permissions: aggregatePermissionPairs(role.permissions),
          updatedAt: role.updatedAt,
        },
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to delete role', role: null }
    }
  },
  
  setRBACRolePermissions: async (_: any, args: any, ctx: any) => {
    const { roleId, permissions: perms } = args
    if (!roleId || !perms) {
      return { success: false, message: 'Invalid input', role: null }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null

    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'update')) {
      return { success: false, message: 'Forbidden: insufficient permissions for roles', role: null }
    }

    try {
      const id = Number(roleId)
      const permPairs = perms.flatMap((p: any) => 
        p.actions.map((action: string) => ({ domain: p.domain, action }))
      )

      // A role definition may not hand out more than its author holds. Without
      // this, `{ domain: 'all', actions: ['*'] }` was accepted verbatim and
      // `ensurePermissions()` created the row — a two-call path to Super Admin.
      if (!userId) {
        return { success: false, message: 'Unauthorized: authentication required', role: null }
      }
      await ensureActorMayGrantPermissions(userId, tenant, permPairs)

      await setRolePermissionsById(id, permPairs, tenant)
      
      const role = await getRoleById(id, tenant)
      if (!role) {
        return { success: false, message: 'Role not found', role: null }
      }
      
      return {
        success: true,
        message: 'Role permissions updated successfully',
        role: {
          id: String(role.id),
          name: role.name,
          tenant: role.tenant,
          permissions: aggregatePermissionPairs(role.permissions),
          updatedAt: role.updatedAt,
        },
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to update role permissions', role: null }
    }
  },
  
  assignRoleToAdmin: async (_: any, args: any, ctx: any) => {
    const parsed = AssignRoleInput.safeParse(args)
    if (!parsed.success) {
      return { success: false, message: 'Invalid input' }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    // Check permission
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'assign')) {
      return { success: false, message: 'Insufficient permissions: roles.assign required' }
    }
    
    try {
      const { userId: targetUserId, roleId } = parsed.data.input
      const targetId = Number(targetUserId)
      const rId = Number(roleId)
      
      // Privilege escalation: normal assign uses subset check. WL support-admin managers may delegate
      // template roles (e.g. Finance Manager) without holding every nested permission themselves.
      const allowSupportAdminDelegation =
        hasPermission(ctx?.permissions ?? [], 'security.support-admins', 'create') ||
        hasPermission(ctx?.permissions ?? [], 'security.support-admins', 'update')
      if (userId) {
        await ensureNoPrivilegeEscalation(userId, tenant, rId, {
          allowSupportAdminDelegation,
        })
      }
      
      await assignRoleToAdmin(targetId, rId, tenant)
      
      // Audit event
      const actorId = userId ? String(userId) : 'system'
      recordAuditDb({
        tenant,
        actorId,
        domain: 'rbac',
        action: 'assign_role',
        resourceType: 'user_role',
        resourceId: `${targetId}:${rId}`,
        after: { userId: targetId, roleId: rId },
      }).catch(() => {})
      
      return {
        success: true,
        message: 'Role assigned successfully',
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to assign role' }
    }
  },
  
  revokeRoleFromAdmin: async (_: any, args: any, ctx: any) => {
    const parsed = AssignRoleInput.safeParse(args)
    if (!parsed.success) {
      return { success: false, message: 'Invalid input' }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    // Check permission
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'assign')) {
      return { success: false, message: 'Insufficient permissions: roles.assign required' }
    }
    
    try {
      const { userId: targetUserId, roleId } = parsed.data.input
      const targetId = Number(targetUserId)
      const rId = Number(roleId)
      
      // SECURITY: Block revoking privileged roles. Super Admin, Whitelabel Admin, and agents
      // are unaffected (agents use agent auth; SA/WA keep their roles).
      const role = await getRoleById(rId, tenant)
      if (role) {
        const privilegedRoles = ['Whitelabel Admin', 'Super Admin', 'whitelabel_admin', 'super_admin']
        const roleLower = (role.name || '').toLowerCase()
        const isPrivileged =
          privilegedRoles.includes(role.name || '') ||
          privilegedRoles.includes(roleLower) ||
          roleLower.includes('whitelabel') ||
          (roleLower.includes('super') && roleLower.includes('admin'))
        if (isPrivileged) {
          return { success: false, message: 'Cannot revoke privileged role (Super Admin or Whitelabel Admin)' }
        }
      }
      
      await revokeRoleFromAdmin(targetId, rId, tenant)
      
      // Audit event
      const actorId = userId ? String(userId) : 'system'
      recordAuditDb({
        tenant,
        actorId,
        domain: 'rbac',
        action: 'revoke_role',
        resourceType: 'user_role',
        resourceId: `${targetId}:${rId}`,
        before: { userId: targetId, roleId: rId },
      }).catch(() => {})
      
      return {
        success: true,
        message: 'Role revoked successfully',
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to revoke role' }
    }
  },
  
  createSupportAdmin: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'security.support-admins', 'create')
    const parsed = CreateSupportAdminInput.safeParse(args)
    if (!parsed.success) {
      return { success: false, message: 'Invalid input', user: null }
    }
    
    const tenant = await getEffectiveTenant(ctx)
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    
    if (!hasPermission(ctx?.permissions ?? [], 'security.support-admins', 'create') && !hasPermission(ctx?.permissions ?? [], 'security.support-admins', 'update')) {
      return { success: false, message: 'Forbidden: insufficient permissions for support admins', user: null }
    }
    if (!hasPermission(ctx?.permissions ?? [], 'security.roles', 'assign')) {
      return { success: false, message: 'Forbidden: insufficient permissions to assign roles', user: null }
    }
    
    try {
      const { name, email, password, phone, roleIds } = parsed.data.input
      
      // Delegated support-admin roles: WL admin need not have every permission in Finance Manager, etc.
      // Privileged platform roles remain blocked (see ensureNoPrivilegeEscalation).
      if (userId) {
        for (const roleIdStr of roleIds) {
          const roleId = Number(roleIdStr)
          await ensureNoPrivilegeEscalation(userId, tenant, roleId, {
            allowSupportAdminDelegation: true,
          })
        }
      }
      
      // Create the admin user
      const newUserId = await createAdminUser({
        tenant,
        name,
        email,
        password,
        phone: phone || null,
      })
      
      // Assign roles
      for (const roleIdStr of roleIds) {
        const roleId = Number(roleIdStr)
        await assignRoleToAdmin(newUserId, roleId, tenant)
      }
      
      // Fetch the created user with roles
      const adminUsers = await listAdminUsers(tenant)
      const createdUser = adminUsers.find(au => au.id === newUserId)
      
      if (!createdUser) {
        return { success: false, message: 'Failed to create support admin', user: null }
      }
      
      // Audit event
      const actorId = userId ? String(userId) : 'system'
      recordAuditDb({
        tenant,
        actorId,
        domain: 'users.security',
        action: 'create_support_admin',
        resourceType: 'user',
        resourceId: String(newUserId),
        after: { userId: newUserId, name, email, roleIds },
      }).catch(() => {})
      
      return {
        success: true,
        message: 'Support admin created successfully',
        user: {
          id: String(createdUser.id),
          name: createdUser.name,
          email: createdUser.email,
          createdAt: createdUser.createdAt instanceof Date ? createdUser.createdAt.toISOString() : (typeof createdUser.createdAt === 'string' ? createdUser.createdAt : new Date().toISOString()),
          roles: createdUser.roles.map(r => ({
            id: String(r.id),
            name: r.name,
            tenant: r.tenant,
            permissions: aggregatePermissionPairs(r.permissions),
            updatedAt: r.updatedAt,
          })),
        },
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to create support admin', user: null }
    }
  },
  
  /**
   * Removes a support admin.
   *
   * The screen offering this has had a Delete button since it shipped; the
   * mutation behind it never existed, so the button silently failed query
   * validation. Three guards, each for a different way this goes wrong:
   *
   *   - deleting yourself locks you out of the screen you did it from;
   *   - deleting someone whose roles you could not have granted is privilege
   *     escalation in reverse, so the same escalation check that gates creating
   *     an admin gates removing one;
   *   - an id that holds no role in this tenant is a player, not an admin, and
   *     the two share the `users` table.
   */
  deleteSupportAdmin: async (_: any, args: any, ctx: any) => {
    requirePermission(ctx, 'security.support-admins', 'delete')
    const tenant = await getEffectiveTenant(ctx)
    const actorId = ctx?.user?.sub ? Number(ctx.user.sub) : null

    if (!hasPermission(ctx?.permissions ?? [], 'security.support-admins', 'delete')) {
      return { success: false, message: 'Forbidden: insufficient permissions for support admins' }
    }

    const targetId = Number(args?.id)
    if (!Number.isFinite(targetId)) return { success: false, message: 'Invalid user id' }
    if (actorId && targetId === actorId) {
      return { success: false, message: 'You cannot delete your own account' }
    }

    try {
      // Their roles, checked against what this caller is allowed to hand out.
      // Without it, an administrator could remove someone more privileged than
      // themselves.
      if (actorId) {
        const targetRoles = await getAdminRoles(targetId, tenant)
        for (const role of targetRoles) {
          await ensureNoPrivilegeEscalation(actorId, tenant, role.id, {
            allowSupportAdminDelegation: true,
          })
        }
      }

      const res = await deleteSupportAdmin(targetId, tenant)
      if (!res.ok) {
        return {
          success: false,
          message:
            res.reason === 'not_an_admin'
              ? 'That account is not a support admin'
              : 'Support admin not found',
        }
      }

      recordAuditDb({
        tenant,
        actorId: actorId ? String(actorId) : 'system',
        domain: 'users.security',
        action: 'delete_support_admin',
        resourceType: 'user',
        resourceId: String(targetId),
        before: { userId: targetId },
      }).catch(() => {})

      return { success: true, message: 'Support admin deleted' }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to delete support admin' }
    }
  },

  addIpToAllowlist: async (_: any, { userId, cidr }: any, ctx: any) => {
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const perms = ctx?.permissions || []
    
    if (!hasPermission(perms, 'security.ip-allowlist', 'create')) {
      return { success: false, message: 'Forbidden: insufficient permissions for IP allowlist' }
    }
    
    // Validate CIDR format (basic validation)
    if (!cidr || typeof cidr !== 'string' || cidr.trim().length === 0) {
      return { success: false, message: 'Invalid CIDR format' }
    }
    
    try {
      const targetUserId = Number(userId)
      if (!Number.isFinite(targetUserId)) {
        return { success: false, message: 'Invalid user ID' }
      }
      
      const entryId = await addIpToAllowlist(targetUserId, cidr.trim(), tenant)
      
      // Audit event
      const actorId = ctx?.user?.sub ? String(ctx.user.sub) : 'system'
      recordAuditDb({
        tenant,
        actorId,
        domain: 'users.security',
        action: 'add_ip_allowlist',
        resourceType: 'ip_allowlist',
        resourceId: String(entryId),
        after: { userId: targetUserId, cidr: cidr.trim() },
      }).catch(() => {})
      
      return {
        success: true,
        message: 'IP address added to allowlist successfully',
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to add IP to allowlist' }
    }
  },
  
  removeIpFromAllowlist: async (_: any, { id }: any, ctx: any) => {
    requirePermission(ctx, 'security.ip-allowlist', 'delete')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const perms = ctx?.permissions || []
    
    if (!hasPermission(perms, 'security.ip-allowlist', 'delete')) {
      return { success: false, message: 'Forbidden: insufficient permissions for IP allowlist' }
    }
    
    try {
      const entryId = Number(id)
      if (!Number.isFinite(entryId)) {
        return { success: false, message: 'Invalid entry ID' }
      }
      
      await removeIpFromAllowlist(entryId, tenant)
      
      // Audit event
      const actorId = ctx?.user?.sub ? String(ctx.user.sub) : 'system'
      recordAuditDb({
        tenant,
        actorId,
        domain: 'users.security',
        action: 'remove_ip_allowlist',
        resourceType: 'ip_allowlist',
        resourceId: String(entryId),
        before: { entryId },
      }).catch(() => {})
      
      return {
        success: true,
        message: 'IP address removed from allowlist successfully',
      }
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to remove IP from allowlist' }
    }
  },
}

