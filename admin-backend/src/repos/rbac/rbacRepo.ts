import { db } from '@/db/client.js'
import { roles, permissions, rolePermissions, userRoles, users } from '@/db/schema.js'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NESTED_PERMISSIONS } from '@/config/nestedPermissions.js'

export type PermissionPair = { domain: string; action: string }

export async function listAllPermissions(tenant = 'default'): Promise<PermissionPair[]> {
  const rows = await db.select({ domain: permissions.domain, action: permissions.action }).from(permissions).where(eq(permissions.tenant, tenant))
  return rows
}

export async function ensurePermissions(perms: PermissionPair[], tenant = 'default'): Promise<void> {
  if (!perms.length) return
  const existing = await db.select({ domain: permissions.domain, action: permissions.action }).from(permissions).where(eq(permissions.tenant, tenant))
  const existsSet = new Set(existing.map(p => `${p.domain}:${p.action}`))
  const toInsert = perms.filter(p => !existsSet.has(`${p.domain}:${p.action}`)).map(p => ({ ...p, tenant }))
  if (toInsert.length) await db.insert(permissions).values(toInsert)
}

export async function upsertRoleByName(name: string, tenant = 'default'): Promise<number> {
  const r = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, name), eq(roles.tenant, tenant)))
  if (r.length) return r[0].id
  const inserted = await db.insert(roles).values({ name, tenant }).returning({ id: roles.id })
  return inserted[0].id
}

export async function setRolePermissions(roleName: string, perms: PermissionPair[], tenant = 'default'): Promise<void> {
  // ensure role
  const roleId = await upsertRoleByName(roleName, tenant)
  // ensure permissions exist
  await ensurePermissions(perms, tenant)
  // fetch permission ids
  const permRows = await db.select({ id: permissions.id, domain: permissions.domain, action: permissions.action }).from(permissions).where(and(inArray(permissions.domain, Array.from(new Set(perms.map(p => p.domain)))), eq(permissions.tenant, tenant)))
  const permIdByKey = new Map(permRows.map(p => [`${p.domain}:${p.action}`, p.id] as const))
  // delete existing role permissions and replace (idempotent strategy)
  // Drizzle lacks FK cascade APIs here; use simple strategy: find current, compute delta
  const current = await db.select({ id: rolePermissions.id, permissionId: rolePermissions.permissionId }).from(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant)))
  const wantedIds = new Set(perms.map(p => permIdByKey.get(`${p.domain}:${p.action}`)).filter((v): v is number => typeof v === 'number'))
  const currentIds = new Set(current.map(c => c.permissionId))
  const toAdd = Array.from(wantedIds).filter(id => !currentIds.has(id))
  const toRemove = Array.from(current).filter(c => !wantedIds.has(c.permissionId)).map(c => c.id)
  if (toRemove.length) {
    await db.delete(rolePermissions).where(inArray(rolePermissions.id, toRemove))
  }
  if (toAdd.length) {
    await db.insert(rolePermissions).values(toAdd.map(pid => ({ roleId, permissionId: pid, tenant })))
  }
}

export async function assignRoleToUser(userId: number, roleName: string, tenant = 'default'): Promise<void> {
  const roleId = await upsertRoleByName(roleName, tenant)
  const found = await db.select({ id: userRoles.id }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenant, tenant)))
  if (!found.length) await db.insert(userRoles).values({ userId, roleId, tenant })
}

export async function getRoleNamesByUserIds(userIds: number[], tenant = 'default'): Promise<Map<number, string[]>> {
  if (!userIds.length) return new Map()
  const userRoleRows = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(inArray(userRoles.userId, userIds), eq(userRoles.tenant, tenant)))
  if (!userRoleRows.length) return new Map()

  const roleIds = Array.from(new Set(userRoleRows.map(r => r.roleId)))
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(inArray(roles.id, roleIds), eq(roles.tenant, tenant)))
  const nameById = new Map(roleRows.map(r => [r.id, r.name] as const))

  const map = new Map<number, string[]>()
  userRoleRows.forEach(row => {
    const roleName = nameById.get(row.roleId)
    if (!roleName) return
    const arr = map.get(row.userId) ?? []
    arr.push(roleName)
    map.set(row.userId, arr)
  })
  return map
}

export async function removeRoleFromUser(userId: number, roleName: string, tenant = 'default'): Promise<void> {
  const r = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, roleName), eq(roles.tenant, tenant)))
  if (!r.length) return
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, r[0].id), eq(userRoles.tenant, tenant)))
}

export type RoleWithPermissions = {
  id: number
  name: string
  tenant: string
  permissions: PermissionPair[]
  updatedAt: string
}

export async function listRoles(tenant = 'default'): Promise<RoleWithPermissions[]> {
  const rs = await db.select({ id: roles.id, name: roles.name, tenant: roles.tenant, updatedAt: roles.updatedAt }).from(roles).where(eq(roles.tenant, tenant))
  if (!rs.length) return []
  const roleIds = rs.map(r => r.id)
  const rps = await db.select({ roleId: rolePermissions.roleId, domain: permissions.domain, action: permissions.action })
    .from(rolePermissions)
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(rolePermissions.roleId, roleIds), eq(rolePermissions.tenant, tenant), eq(permissions.tenant, tenant)))
  const byRole = new Map<number, PermissionPair[]>()
  rps.forEach(row => {
    if (!row) return
    if (!row.domain || !row.action) return
    const arr = byRole.get(row.roleId) ?? []
    arr.push({ domain: row.domain, action: row.action })
    byRole.set(row.roleId, arr)
  })
  return rs.map(r => ({ 
    id: r.id, 
    name: r.name, 
    tenant: r.tenant || tenant, 
    permissions: byRole.get(r.id) ?? [], 
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt || Date.now())).toISOString()
  }))
}

export async function getRoleById(roleId: number, tenant = 'default'): Promise<RoleWithPermissions | null> {
  const rs = await db.select({ id: roles.id, name: roles.name, tenant: roles.tenant, updatedAt: roles.updatedAt })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenant, tenant)))
  if (!rs.length) return null
  const role = rs[0]
  const rps = await db.select({ roleId: rolePermissions.roleId, domain: permissions.domain, action: permissions.action })
    .from(rolePermissions)
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant), eq(permissions.tenant, tenant)))
  const rolePerms = rps
    .filter(row => row && row.domain && row.action)
    .map(row => ({ domain: row!.domain as string, action: row!.action as string }))
  return {
    id: role.id,
    name: role.name,
    tenant: role.tenant || tenant,
    permissions: rolePerms,
    updatedAt: (role.updatedAt instanceof Date ? role.updatedAt : new Date(role.updatedAt || Date.now())).toISOString()
  }
}

export async function getAdminRoles(userId: number, tenant = 'default'): Promise<RoleWithPermissions[]> {
  const urs = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenant, tenant)))
  if (!urs.length) return []
  const roleIds = urs.map(u => u.roleId)
  const rs = await db.select({ id: roles.id, name: roles.name, tenant: roles.tenant, updatedAt: roles.updatedAt })
    .from(roles)
    .where(and(inArray(roles.id, roleIds), eq(roles.tenant, tenant)))
  if (!rs.length) return []
  const rps = await db.select({ roleId: rolePermissions.roleId, domain: permissions.domain, action: permissions.action })
    .from(rolePermissions)
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(rolePermissions.roleId, roleIds), eq(rolePermissions.tenant, tenant), eq(permissions.tenant, tenant)))
  const byRole = new Map<number, PermissionPair[]>()
  rps.forEach(row => {
    if (!row) return
    if (!row.domain || !row.action) return
    const arr = byRole.get(row.roleId) ?? []
    arr.push({ domain: row.domain, action: row.action })
    byRole.set(row.roleId, arr)
  })
  return rs.map(r => ({
    id: r.id,
    name: r.name,
    tenant: r.tenant || tenant,
    permissions: byRole.get(r.id) ?? [],
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt || Date.now())).toISOString()
  }))
}

export async function listRolesWithPermissions(tenant = 'default'): Promise<{ name: string; permissions: PermissionPair[]; updatedAt: string }[]> {
  const roles = await listRoles(tenant)
  return roles.map(r => ({ name: r.name, permissions: r.permissions, updatedAt: r.updatedAt }))
}

export async function getUserRoleNames(userId: number, tenant = 'default'): Promise<string[]> {
  const urs = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenant, tenant)))
  if (!urs.length) return []
  const rows = await db.select({ name: roles.name }).from(roles).where(and(inArray(roles.id, urs.map(u => u.roleId)), eq(roles.tenant, tenant)))
  return rows.map(r => r.name)
}

const adminUserIdsCache = new Map<string, { ids: number[]; ts: number }>()
const ADMIN_IDS_TTL = 60_000

/** Returns user IDs that have any role whose name matches admin (case-insensitive). Use to exclude from list queries. */
export async function getAdminUserIds(tenant = 'default'): Promise<number[]> {
  const cached = adminUserIdsCache.get(tenant)
  if (cached && Date.now() - cached.ts < ADMIN_IDS_TTL) return cached.ids

  const adminRoleIds = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenant, tenant), sql`${roles.name} ILIKE '%admin%'`))
  if (!adminRoleIds.length) {
    adminUserIdsCache.set(tenant, { ids: [], ts: Date.now() })
    return []
  }
  const userIdRows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.tenant, tenant), inArray(userRoles.roleId, adminRoleIds.map((r) => r.id))))
  const ids = [...new Set(userIdRows.map((r) => r.userId))]
  adminUserIdsCache.set(tenant, { ids, ts: Date.now() })
  return ids
}

/** Batch fetch role names for many users. Returns Map<userId, roleNames[]>. Use for list pages to avoid N queries. */
export async function getRoleNamesForUserIds(userIds: number[], tenant = 'default'): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>()
  if (!userIds.length) return result
  const uniqueIds = [...new Set(userIds)]
  const urs = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(inArray(userRoles.userId, uniqueIds), eq(userRoles.tenant, tenant)))
  if (!urs.length) {
    uniqueIds.forEach(id => result.set(id, []))
    return result
  }
  const roleIds = [...new Set(urs.map(u => u.roleId))]
  const roleRows = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(inArray(roles.id, roleIds), eq(roles.tenant, tenant)))
  const roleNameById = new Map(roleRows.map(r => [r.id, r.name]))
  const byUser = new Map<number, number[]>()
  for (const u of urs) {
    const arr = byUser.get(u.userId) ?? []
    arr.push(u.roleId)
    byUser.set(u.userId, arr)
  }
  for (const id of uniqueIds) {
    const rids = byUser.get(id) ?? []
    result.set(id, rids.map(rid => roleNameById.get(rid) ?? '').filter(Boolean))
  }
  return result
}

export async function getUserPermissions(userId: number, tenant = 'default'): Promise<PermissionPair[]> {
  const urs = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenant, tenant)))
  if (!urs.length) return []
  const rps = await db.select({ roleId: rolePermissions.roleId, domain: permissions.domain, action: permissions.action })
    .from(rolePermissions)
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(rolePermissions.roleId, urs.map(u => u.roleId)), eq(rolePermissions.tenant, tenant), eq(permissions.tenant, tenant)))
  return rps
    .filter(r => Boolean(r.domain) && Boolean(r.action))
    .map(r => ({ domain: r.domain as string, action: r.action as string }))
}

export function aggregatePermissionPairs(perms: PermissionPair[]): { domain: string; actions: string[] }[] {
  const map = new Map<string, Set<string>>()
  perms.forEach(p => {
    const set = map.get(p.domain) ?? new Set<string>()
    set.add(p.action)
    map.set(p.domain, set)
  })
  return Array.from(map.entries()).map(([domain, set]) => ({ domain, actions: Array.from(set).sort() }))
}

export async function createRole(name: string, tenant = 'default'): Promise<number> {
  const inserted = await db.insert(roles).values({ name, tenant }).returning({ id: roles.id })
  return inserted[0].id
}

export async function renameRole(roleId: number, newName: string, tenant = 'default'): Promise<void> {
  await db.update(roles)
    .set({ name: newName })
    .where(and(eq(roles.id, roleId), eq(roles.tenant, tenant)))
}

export async function deleteRole(roleId: number, tenant = 'default'): Promise<void> {
  // Delete role permissions first
  await db.delete(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant)))
  // Delete user roles
  await db.delete(userRoles).where(and(eq(userRoles.roleId, roleId), eq(userRoles.tenant, tenant)))
  // Delete role
  await db.delete(roles).where(and(eq(roles.id, roleId), eq(roles.tenant, tenant)))
}

export async function setRolePermissionsById(roleId: number, perms: PermissionPair[], tenant = 'default'): Promise<void> {
  // Ensure permissions exist
  await ensurePermissions(perms, tenant)
  // Fetch permission ids
  const permRows = await db.select({ id: permissions.id, domain: permissions.domain, action: permissions.action })
    .from(permissions)
    .where(and(inArray(permissions.domain, Array.from(new Set(perms.map(p => p.domain)))), eq(permissions.tenant, tenant)))
  const permIdByKey = new Map(permRows.map(p => [`${p.domain}:${p.action}`, p.id] as const))
  // Delete existing role permissions and replace
  const current = await db.select({ id: rolePermissions.id, permissionId: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant)))
  const wantedIds = new Set(perms.map(p => permIdByKey.get(`${p.domain}:${p.action}`)).filter((v): v is number => typeof v === 'number'))
  const currentIds = new Set(current.map(c => c.permissionId))
  const toAdd = Array.from(wantedIds).filter(id => !currentIds.has(id))
  const toRemove = Array.from(current).filter(c => !wantedIds.has(c.permissionId)).map(c => c.id)
  if (toRemove.length) {
    await db.delete(rolePermissions).where(inArray(rolePermissions.id, toRemove))
  }
  if (toAdd.length) {
    await db.insert(rolePermissions).values(toAdd.map(pid => ({ roleId, permissionId: pid, tenant })))
  }
}

export async function getRolePermissions(roleId: number, tenant = 'default'): Promise<PermissionPair[]> {
  const rps = await db.select({ domain: permissions.domain, action: permissions.action })
    .from(rolePermissions)
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant), eq(permissions.tenant, tenant)))
  return rps
    .filter(r => r && r.domain && r.action)
    .map(r => ({ domain: r!.domain as string, action: r!.action as string }))
}

export async function assignRoleToAdmin(userId: number, roleId: number, tenant = 'default'): Promise<void> {
  const found = await db.select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenant, tenant)))
  if (!found.length) {
    await db.insert(userRoles).values({ userId, roleId, tenant })
  }
}

export async function revokeRoleFromAdmin(userId: number, roleId: number, tenant = 'default'): Promise<void> {
  await db.delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenant, tenant)))
}

export type AdminUserWithRoles = {
  id: number
  name: string
  email: string | null
  createdAt: Date | string
  status: 'active' | 'inactive' | 'suspended'
  roles: RoleWithPermissions[]
}

export async function listAdminUsers(tenant = 'default'): Promise<AdminUserWithRoles[]> {
  // Get all users that have at least one role assigned
  const userRoleRows = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.tenant, tenant))
  
  const uniqueUserIds = Array.from(new Set(userRoleRows.map(ur => ur.userId)))
  if (!uniqueUserIds.length) return []
  
  // Get user details
  const { users } = await import('@/db/schema.js')
  const userRows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    status: users.status,
    createdAt: users.createdAt,
  })
    .from(users)
    .where(and(inArray(users.id, uniqueUserIds), eq(users.tenant, tenant)))
  
  // Get roles for each user
  const result: AdminUserWithRoles[] = []
  for (const user of userRows) {
    const userRoles = await getAdminRoles(user.id, tenant)
    result.push({
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      createdAt: user.createdAt,
      roles: userRoles,
    })
  }
  
  return result
}

export async function seedDefaultRBAC(tenant = 'default'): Promise<void> {
  // Determine if this is the platform tenant or a whitelabel tenant
  const isPlatformTenant = tenant === 'default'
  
  // Comprehensive permission taxonomy
  const defaults: PermissionPair[] = [
    // System permissions
    { domain: 'all', action: '*' },
    
    // User management
    { domain: 'users', action: 'read' },
    { domain: 'users', action: 'write' },
    { domain: 'users', action: 'delete' },
    
    // Role management
    { domain: 'roles', action: 'read' },
    { domain: 'roles', action: 'write' },
    { domain: 'roles', action: 'delete' },
    { domain: 'roles', action: 'assign' },
    
    // Casino operations
    { domain: 'casino', action: 'read' },
    { domain: 'casino', action: 'write' },
    { domain: 'casino', action: 'delete' },
    
    // Sports operations
    { domain: 'sports', action: 'read' },
    { domain: 'sports', action: 'write' },
    { domain: 'sports', action: 'delete' },
    
    // Risk management
    { domain: 'risk', action: 'read' },
    { domain: 'risk', action: 'write' },
    { domain: 'risk', action: 'delete' },
    
    // Promotions
    { domain: 'promotions', action: 'read' },
    { domain: 'promotions', action: 'write' },
    { domain: 'promotions', action: 'delete' },
    
    // Bonuses
    { domain: 'bonuses', action: 'read' },
    { domain: 'bonuses', action: 'write' },
    { domain: 'bonuses', action: 'delete' },
    
    // Jackpots
    { domain: 'jackpots', action: 'read' },
    { domain: 'jackpots', action: 'write' },
    { domain: 'jackpots', action: 'payout' },
    
    // Matka operations
    { domain: 'matka', action: 'read' },
    { domain: 'matka', action: 'write' },
    { domain: 'matka.results', action: 'submit' },
    { domain: 'matka.results', action: 'approve' },
    { domain: 'matka.rates', action: 'read' },
    { domain: 'matka.rates', action: 'write' },
    
    // Reporting
    { domain: 'reporting', action: 'read' },
    { domain: 'reporting', action: 'export' },
    
    // Audit
    { domain: 'audit', action: 'read' },
    { domain: 'audit', action: 'export' },
    
    // Referrals
    { domain: 'referrals', action: 'read' },
    { domain: 'referrals', action: 'manage' },
    { domain: 'referrals', action: 'settle' },
    { domain: 'referrals', action: 'coupons' },
    { domain: 'referrals', action: 'raffles' },
    { domain: 'referrals', action: 'budgets' },
    
    // Payment Gateways
    { domain: 'payments', action: 'view' },
    { domain: 'payments', action: 'create' },
    { domain: 'payments', action: 'edit' },
    { domain: 'payments', action: 'toggle' },
    { domain: 'payments', action: 'delete' },
    { domain: 'payments', action: 'rotate' },
    { domain: 'payments', action: 'test' },
    { domain: 'payments', action: 'view_secret' },
    
    // Deposits
    { domain: 'deposits', action: 'view' },
    { domain: 'deposits', action: 'manage' },
    
    // Currency management
    { domain: 'currency', action: 'read' },
    { domain: 'currency', action: 'write' },

    // Credit & Notifications (flat; nested mapping in hasPermission)
    { domain: 'credit', action: 'read' },
    { domain: 'credit', action: 'write' },
    { domain: 'notifications', action: 'manage' },
  ]

  // Nested RBAC: 270 granular permissions (alongside flat - DO NOT remove flat)
  await ensurePermissions(NESTED_PERMISSIONS, tenant)
  
  await ensurePermissions(defaults, tenant)
  
  // PLATFORM-LEVEL ROLES (only for 'default' tenant)
  if (isPlatformTenant) {
    // Super Admin - God mode for platform (has mode switcher)
    await setRolePermissions('Super Admin', [{ domain: 'all', action: '*' }], tenant)
    
    // Whitelabel Admin - Assigned by Super Admin to whitelabel owners (defined in platform for reference)
    await setRolePermissions('Whitelabel Admin', [
      { domain: 'users', action: 'read' },
      { domain: 'users', action: 'write' },
      { domain: 'players', action: 'view' },
      { domain: 'players', action: 'read' },
      { domain: 'players', action: 'write' },
      { domain: 'players', action: 'manage' },
      { domain: 'casino', action: 'read' },
      { domain: 'casino', action: 'write' },
      { domain: 'sports', action: 'read' },
      { domain: 'sports', action: 'write' },
      { domain: 'matka', action: 'read' },
      { domain: 'matka', action: 'write' },
      { domain: 'matka.results', action: 'submit' },
      { domain: 'matka.results', action: 'approve' },
      { domain: 'promotions', action: 'read' },
      { domain: 'promotions', action: 'write' },
      { domain: 'bonuses', action: 'read' },
      { domain: 'bonuses', action: 'write' },
      { domain: 'jackpots', action: 'read' },
      { domain: 'jackpots', action: 'write' },
      { domain: 'referrals', action: 'read' },
      { domain: 'referrals', action: 'write' },
      { domain: 'referrals', action: 'manage' },
      { domain: 'vip', action: 'read' },
      { domain: 'vip', action: 'write' },
      { domain: 'finance', action: 'read' },
      { domain: 'finance', action: 'write' },
      { domain: 'reporting', action: 'read' },
      { domain: 'reporting', action: 'export' },
      { domain: 'config', action: 'read' },
      { domain: 'config', action: 'write' },
      { domain: 'roles', action: 'read' },
      { domain: 'roles', action: 'write' },
      { domain: 'roles', action: 'delete' },
      { domain: 'roles', action: 'assign' },
      { domain: 'audit', action: 'read' },
      { domain: 'deposits', action: 'view' },
      { domain: 'deposits', action: 'manage' },
      { domain: 'payments', action: 'view' },
      { domain: 'payments', action: 'manage' },
      { domain: 'payments', action: 'write' },
      { domain: 'currency', action: 'read' },
      { domain: 'agents', action: 'view' },
      { domain: 'agents', action: 'read' },
      { domain: 'agents', action: 'write' },
      { domain: 'agents', action: 'manage' },
    ], tenant)
  }
  
  // OPERATIONAL ROLES (for all tenants - platform and whitelabel)
  // These are the roles that Whitelabel Admin can assign to their staff
  
  // Whitelabel Admin role - exists in ALL tenants (platform assigns it, whitelabel uses it)
  await setRolePermissions('Whitelabel Admin', [
    { domain: 'users', action: 'read' },
    { domain: 'users', action: 'write' },
    { domain: 'players', action: 'view' },
    { domain: 'players', action: 'read' },
    { domain: 'players', action: 'write' },
    { domain: 'players', action: 'manage' },
    { domain: 'casino', action: 'read' },
    { domain: 'casino', action: 'write' },
    { domain: 'sports', action: 'read' },
    { domain: 'sports', action: 'write' },
    { domain: 'matka', action: 'read' },
    { domain: 'matka', action: 'write' },
    { domain: 'matka.results', action: 'submit' },
    { domain: 'matka.results', action: 'approve' },
    { domain: 'promotions', action: 'read' },
    { domain: 'promotions', action: 'write' },
    { domain: 'bonuses', action: 'read' },
    { domain: 'bonuses', action: 'write' },
    { domain: 'jackpots', action: 'read' },
    { domain: 'jackpots', action: 'write' },
    { domain: 'referrals', action: 'read' },
    { domain: 'referrals', action: 'write' },
    { domain: 'referrals', action: 'manage' },
    { domain: 'vip', action: 'read' },
    { domain: 'vip', action: 'write' },
    { domain: 'finance', action: 'read' },
    { domain: 'finance', action: 'write' },
      { domain: 'reporting', action: 'read' },
      { domain: 'reporting', action: 'export' },
      { domain: 'config', action: 'read' },
    { domain: 'config', action: 'write' },
    { domain: 'roles', action: 'read' },
    { domain: 'roles', action: 'write' },
    { domain: 'roles', action: 'delete' },
    { domain: 'roles', action: 'assign' },
    { domain: 'audit', action: 'read' },
    { domain: 'deposits', action: 'view' },
    { domain: 'deposits', action: 'manage' },
    { domain: 'payments', action: 'view' },
    { domain: 'payments', action: 'manage' },
    { domain: 'payments', action: 'write' },
    { domain: 'currency', action: 'read' },
    { domain: 'agents', action: 'view' },
    { domain: 'agents', action: 'read' },
    { domain: 'agents', action: 'write' },
    { domain: 'agents', action: 'manage' },
  ], tenant)
  
  await setRolePermissions('Manager', [
    { domain: 'users', action: 'read' },
    { domain: 'casino', action: 'read' },
    { domain: 'casino', action: 'write' },
    { domain: 'sports', action: 'read' },
    { domain: 'sports', action: 'write' },
    { domain: 'risk', action: 'read' },
    { domain: 'promotions', action: 'read' },
    { domain: 'promotions', action: 'write' },
    { domain: 'bonuses', action: 'read' },
    { domain: 'bonuses', action: 'write' },
    { domain: 'jackpots', action: 'read' },
    { domain: 'matka', action: 'read' },
    { domain: 'matka.results', action: 'submit' },
    { domain: 'referrals', action: 'read' },
    { domain: 'referrals', action: 'manage' },
    { domain: 'deposits', action: 'view' },
    { domain: 'deposits', action: 'manage' },
    { domain: 'reporting', action: 'read' },
    { domain: 'audit', action: 'read' },
  ], tenant)
  
  await setRolePermissions('Operator', [
    { domain: 'casino', action: 'read' },
    { domain: 'sports', action: 'read' },
    { domain: 'matka', action: 'read' },
    { domain: 'matka.results', action: 'submit' },
    { domain: 'reporting', action: 'read' },
    { domain: 'audit', action: 'read' },
  ], tenant)
  
  await setRolePermissions('Viewer', [
    { domain: 'casino', action: 'read' },
    { domain: 'sports', action: 'read' },
    { domain: 'matka', action: 'read' },
    { domain: 'reporting', action: 'read' },
    { domain: 'audit', action: 'read' },
  ], tenant)

  // Support Admin template roles (nested permissions) – WL Admins can clone/edit/delete
  await setRolePermissions('Finance Manager', [
    { domain: 'payments.deposits', action: 'view' },
    { domain: 'payments.deposits', action: 'approve' },
    { domain: 'payments.deposits', action: 'reject' },
    { domain: 'payments.withdrawals', action: 'view' },
    { domain: 'payments.withdrawals', action: 'approve' },
    { domain: 'payments.withdrawals', action: 'reject' },
    { domain: 'payments.methods', action: 'view' },
    { domain: 'reporting.pnl', action: 'view' },
    { domain: 'reporting.pnl', action: 'export' },
    { domain: 'reporting.exposure', action: 'view' },
    { domain: 'reporting.exposure', action: 'export' },
    { domain: 'settlements.center', action: 'view' },
    { domain: 'settlements.agent', action: 'view' },
    { domain: 'settlements.agent', action: 'create' },
    { domain: 'settlements.commission', action: 'view' },
    { domain: 'credit.management', action: 'view' },
    { domain: 'credit.history', action: 'view' },
    { domain: 'credit.settlements', action: 'view' },
  ], tenant)

  await setRolePermissions('Customer Support', [
    { domain: 'players.list', action: 'view' },
    { domain: 'players.profile', action: 'view' },
    { domain: 'players.profile', action: 'update' },
    { domain: 'players.profile', action: 'change-password' },
    { domain: 'players.wallet', action: 'view' },
    { domain: 'players.bonuses', action: 'view' },
    { domain: 'players.bonuses', action: 'create' },
    { domain: 'players.specialBonus', action: 'create' },
    { domain: 'players.notes', action: 'view' },
    { domain: 'players.notes', action: 'create' },
    { domain: 'players.sessions', action: 'view' },
    { domain: 'players.transactions', action: 'view' },
    { domain: 'players.ledger', action: 'view' },
    { domain: 'players.bets', action: 'view' },
    { domain: 'players.referral-bonus', action: 'view' },
    { domain: 'players.responsible-gaming', action: 'view' },
    { domain: 'players.devices', action: 'view' },
    { domain: 'players.security-audit', action: 'view' },
    { domain: 'players.credit', action: 'view' },
  ], tenant)

  await setRolePermissions('Sports Operator', [
    { domain: 'sports.events', action: 'view' },
    { domain: 'sports.events', action: 'update' },
    { domain: 'sports.live-analysis', action: 'view' },
    { domain: 'sports.results', action: 'view' },
    { domain: 'sports.results', action: 'create' },
    { domain: 'sports.bets', action: 'view' },
    { domain: 'sports.bets', action: 'void' },
    { domain: 'sports.automation', action: 'view' },
    { domain: 'sports.automation', action: 'update' },
    { domain: 'sports.patterns', action: 'view' },
  ], tenant)

  await setRolePermissions('Casino Operator', [
    { domain: 'casino.management', action: 'view' },
    { domain: 'casino.management', action: 'update' },
    { domain: 'casino.live-analysis', action: 'view' },
    { domain: 'casino.bets', action: 'view' },
  ], tenant)

  await setRolePermissions('Matka Operator', [
    { domain: 'matka.results', action: 'view' },
    { domain: 'matka.results', action: 'create' },
    { domain: 'matka.live-analysis', action: 'view' },
    { domain: 'matka.management', action: 'view' },
    { domain: 'matka.management', action: 'create' },
    { domain: 'matka.management', action: 'update' },
    { domain: 'matka.worli', action: 'view' },
    { domain: 'matka.worli', action: 'update' },
    { domain: 'matka.rates', action: 'view' },
    { domain: 'matka.bets', action: 'view' },
    { domain: 'matka.bets', action: 'void' },
  ], tenant)

  await setRolePermissions('Compliance Officer', [
    { domain: 'audit.events', action: 'view' },
    { domain: 'audit.events', action: 'export' },
    { domain: 'audit.annotations', action: 'view' },
    { domain: 'audit.annotations', action: 'create' },
    { domain: 'audit.annotations', action: 'update' },
    { domain: 'players.list', action: 'view' },
    { domain: 'players.profile', action: 'view' },
    { domain: 'players.security-audit', action: 'view' },
    { domain: 'players.transactions', action: 'view' },
    { domain: 'players.bets', action: 'view' },
    { domain: 'reporting.pnl', action: 'view' },
    { domain: 'reporting.exposure', action: 'view' },
  ], tenant)

  await setRolePermissions('Marketing Manager', [
    { domain: 'bonuses.list', action: 'view' },
    { domain: 'bonuses.create', action: 'view' },
    { domain: 'bonuses.create', action: 'create' },
    { domain: 'bonuses.detail', action: 'view' },
    { domain: 'bonuses.detail', action: 'update' },
    { domain: 'bonuses.bundles', action: 'view' },
    { domain: 'bonuses.bundles', action: 'create' },
    { domain: 'bonuses.bundles', action: 'update' },
    { domain: 'promotions.campaigns', action: 'view' },
    { domain: 'promotions.campaigns', action: 'create' },
    { domain: 'promotions.campaigns', action: 'update' },
    { domain: 'promotions.content', action: 'view' },
    { domain: 'promotions.content', action: 'create' },
    { domain: 'promotions.content', action: 'update' },
    { domain: 'referrals.overview', action: 'view' },
    { domain: 'referrals.program', action: 'view' },
    { domain: 'referrals.rules', action: 'view' },
    { domain: 'referrals.earnings', action: 'view' },
    { domain: 'referrals.top-referrers', action: 'view' },
    { domain: 'vip.tiers', action: 'view' },
    { domain: 'vip.members', action: 'view' },
  ], tenant)

  await setRolePermissions('Reports Viewer', [
    { domain: 'overview.dashboard', action: 'view' },
    { domain: 'reporting.pnl', action: 'view' },
    { domain: 'reporting.pnl', action: 'export' },
    { domain: 'reporting.exposure', action: 'view' },
    { domain: 'reporting.exposure', action: 'export' },
    { domain: 'reporting.sports', action: 'view' },
    { domain: 'reporting.sports', action: 'export' },
    { domain: 'reporting.casino', action: 'view' },
    { domain: 'reporting.casino', action: 'export' },
    { domain: 'reporting.matka', action: 'view' },
    { domain: 'reporting.matka', action: 'export' },
    { domain: 'reporting.agents-performance', action: 'view' },
    { domain: 'reporting.agents-commission', action: 'view' },
    { domain: 'reporting.players-activity', action: 'view' },
    { domain: 'reporting.players-profitability', action: 'view' },
    { domain: 'reporting.agent-overview', action: 'view' },
    { domain: 'reporting.exports', action: 'view' },
    { domain: 'reporting.exports', action: 'create' },
  ], tenant)
}


/**
 * Removes a support admin: their role assignments and then the account.
 *
 * Scoped to the tenant and to accounts that actually hold a role, so a stray id
 * cannot be used to delete a *player* through the admin-users screen — the two
 * live in the same `users` table and only the role assignment tells them apart.
 *
 * A hard delete rather than a status change, because that is what the screen
 * offering it says it does. The audit trail survives regardless: `audit_logs`
 * stores `actor_id` as text with no foreign key, so what this person did stays
 * on the record after the account is gone.
 */
export async function deleteSupportAdmin(
  userId: number,
  tenant = 'default'
): Promise<{ ok: boolean; reason?: 'not_found' | 'not_an_admin' }> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
  if (!user) return { ok: false, reason: 'not_found' }

  const held = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.tenant, tenant)))
    .limit(1)
  if (held.length === 0) return { ok: false, reason: 'not_an_admin' }

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.tenant, tenant)))
    await tx.delete(users).where(and(eq(users.id, userId), eq(users.tenant, tenant)))
  })
  return { ok: true }
}
