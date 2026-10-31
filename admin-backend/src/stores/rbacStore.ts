export type Permission = { domain: string; actions: string[] }
export type Role = { name: string; permissions: Permission[]; updatedAt: string }

const roles = new Map<string, Role>()
const userIdToRoles = new Map<string, Set<string>>()

function now() { return new Date().toISOString() }

export function seedRBAC() {
  if (roles.size) return
  // Default Admin role
  const admin: Role = { name: 'Admin', permissions: [{ domain: 'all', actions: ['*'] }], updatedAt: now() }
  roles.set(admin.name, admin)
}

export function listRoles(): Role[] { return Array.from(roles.values()) }
export function getRole(name: string): Role | undefined { return roles.get(name) }

export function upsertRole(name: string, permissions: Permission[]): Role {
  const r: Role = { name, permissions, updatedAt: now() }
  roles.set(name, r)
  return r
}

export function assignRole(userId: string, roleName: string): string[] {
  if (!roles.has(roleName)) throw new Error('Role not found')
  const set = userIdToRoles.get(userId) ?? new Set<string>()
  set.add(roleName)
  userIdToRoles.set(userId, set)
  return Array.from(set)
}

export function removeRole(userId: string, roleName: string): string[] {
  const set = userIdToRoles.get(userId) ?? new Set<string>()
  set.delete(roleName)
  userIdToRoles.set(userId, set)
  return Array.from(set)
}

export function getUserRoles(userId: string): Role[] {
  const names = Array.from(userIdToRoles.get(userId) ?? [])
  return names.map(n => roles.get(n)).filter(Boolean) as Role[]
}
