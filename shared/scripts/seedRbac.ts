import './loadEnv.js'
import { db } from '../src/db/client.js'
import { roles, permissions, rolePermissions, userRoles } from '../src/db/schema.js'
import { and, eq, inArray } from 'drizzle-orm'
import { checkWhitelabelExists, exitWithError, logStep, logSuccess } from './seedUtils.js'

type PermissionPair = { domain: string; action: string }

async function ensurePermissions(perms: PermissionPair[], tenant = 'default'): Promise<void> {
  if (!perms.length) return
  const existing = await db.select({ domain: permissions.domain, action: permissions.action }).from(permissions).where(eq(permissions.tenant, tenant))
  const existsSet = new Set(existing.map(p => `${p.domain}:${p.action}`))
  const toInsert = perms.filter(p => !existsSet.has(`${p.domain}:${p.action}`)).map(p => ({ ...p, tenant }))
  if (toInsert.length) await db.insert(permissions).values(toInsert)
}

async function upsertRoleByName(name: string, tenant = 'default'): Promise<number> {
  const r = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, name), eq(roles.tenant, tenant)))
  if (r.length) return r[0].id
  const inserted = await db.insert(roles).values({ name, tenant }).returning({ id: roles.id })
  return inserted[0].id
}

/**
 * The role that administers a whitelabel, marked so features can find it after
 * somebody renames it. `roles.name` is free text and `renameRole` will change
 * it to anything; `is_whitelabel_admin` is what survives.
 */
const WHITELABEL_ADMIN_ROLE = 'Whitelabel Admin'

async function setRolePermissions(roleName: string, perms: PermissionPair[], tenant = 'default'): Promise<void> {
  const roleId = await upsertRoleByName(roleName, tenant)
  if (roleName === WHITELABEL_ADMIN_ROLE) {
    await db.update(roles).set({ isWhitelabelAdmin: true }).where(eq(roles.id, roleId))
  }
  await ensurePermissions(perms, tenant)
  const permRows = await db.select({ id: permissions.id, domain: permissions.domain, action: permissions.action }).from(permissions).where(and(inArray(permissions.domain, Array.from(new Set(perms.map(p => p.domain)))), eq(permissions.tenant, tenant)))
  const permIdByKey = new Map(permRows.map(p => [`${p.domain}:${p.action}`, p.id] as const))
  const current = await db.select({ id: rolePermissions.id, permissionId: rolePermissions.permissionId }).from(rolePermissions).where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenant, tenant)))
  const wantedIds = new Set(perms.map(p => permIdByKey.get(`${p.domain}:${p.action}`)).filter((v): v is number => typeof v === 'number'))
  const currentIds = new Set(current.map(c => c.permissionId))
  const toAdd = Array.from(wantedIds).filter(id => !currentIds.has(id))
  const toRemove = Array.from(current).filter(c => !wantedIds.has(c.permissionId)).map(c => c.id)
  if (toRemove.length) await db.delete(rolePermissions).where(inArray(rolePermissions.id, toRemove))
  if (toAdd.length) await db.insert(rolePermissions).values(toAdd.map(pid => ({ roleId, permissionId: pid, tenant })))
}

export async function assignRoleToUser(userId: number, roleName: string, tenant = 'default'): Promise<void> {
  const roleId = await upsertRoleByName(roleName, tenant)
  const found = await db.select({ id: userRoles.id }).from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.tenant, tenant)))
  if (!found.length) await db.insert(userRoles).values({ userId, roleId, tenant })
}

export async function seedDefaultRBAC(tenant = 'default'): Promise<void> {
  const isPlatformTenant = tenant === 'default'
  const defaults: PermissionPair[] = [
    { domain: 'all', action: '*' },
    { domain: 'users', action: 'read' }, { domain: 'users', action: 'write' }, { domain: 'users', action: 'delete' },
    { domain: 'roles', action: 'read' }, { domain: 'roles', action: 'write' }, { domain: 'roles', action: 'delete' }, { domain: 'roles', action: 'assign' },
    { domain: 'casino', action: 'read' }, { domain: 'casino', action: 'write' }, { domain: 'casino', action: 'delete' },
    { domain: 'sports', action: 'read' }, { domain: 'sports', action: 'write' }, { domain: 'sports', action: 'delete' },
    { domain: 'risk', action: 'read' }, { domain: 'risk', action: 'write' }, { domain: 'risk', action: 'delete' },
    { domain: 'promotions', action: 'read' }, { domain: 'promotions', action: 'write' }, { domain: 'promotions', action: 'delete' },
    { domain: 'bonuses', action: 'read' }, { domain: 'bonuses', action: 'write' }, { domain: 'bonuses', action: 'delete' },
    { domain: 'jackpots', action: 'read' }, { domain: 'jackpots', action: 'write' }, { domain: 'jackpots', action: 'payout' },
    { domain: 'matka', action: 'read' }, { domain: 'matka', action: 'write' }, { domain: 'matka.results', action: 'submit' }, { domain: 'matka.results', action: 'approve' }, { domain: 'matka.rates', action: 'read' }, { domain: 'matka.rates', action: 'write' },
    { domain: 'reporting', action: 'read' }, { domain: 'reporting', action: 'export' },
    { domain: 'audit', action: 'read' }, { domain: 'audit', action: 'export' },
    { domain: 'referrals', action: 'read' }, { domain: 'referrals', action: 'manage' }, { domain: 'referrals', action: 'settle' }, { domain: 'referrals', action: 'coupons' }, { domain: 'referrals', action: 'raffles' }, { domain: 'referrals', action: 'budgets' },
    { domain: 'payments', action: 'view' }, { domain: 'payments', action: 'create' }, { domain: 'payments', action: 'edit' }, { domain: 'payments', action: 'toggle' }, { domain: 'payments', action: 'delete' }, { domain: 'payments', action: 'rotate' }, { domain: 'payments', action: 'test' }, { domain: 'payments', action: 'view_secret' },
    { domain: 'deposits', action: 'view' }, { domain: 'deposits', action: 'manage' },
    { domain: 'currency', action: 'read' }, { domain: 'currency', action: 'write' },
  ]
  await ensurePermissions(defaults, tenant)
  if (isPlatformTenant) {
    await setRolePermissions('Super Admin', [{ domain: 'all', action: '*' }], tenant)
    await setRolePermissions('Whitelabel Admin', [
      { domain: 'users', action: 'read' }, { domain: 'users', action: 'write' }, { domain: 'players', action: 'view' }, { domain: 'players', action: 'read' }, { domain: 'players', action: 'write' }, { domain: 'players', action: 'manage' },
      { domain: 'casino', action: 'read' }, { domain: 'casino', action: 'write' }, { domain: 'sports', action: 'read' }, { domain: 'sports', action: 'write' }, { domain: 'matka', action: 'read' }, { domain: 'matka', action: 'write' }, { domain: 'matka.results', action: 'submit' }, { domain: 'matka.results', action: 'approve' },
      { domain: 'promotions', action: 'read' }, { domain: 'promotions', action: 'write' }, { domain: 'bonuses', action: 'read' }, { domain: 'bonuses', action: 'write' }, { domain: 'jackpots', action: 'read' }, { domain: 'jackpots', action: 'write' },
      { domain: 'referrals', action: 'read' }, { domain: 'referrals', action: 'manage' }, { domain: 'vip', action: 'read' }, { domain: 'vip', action: 'write' }, { domain: 'finance', action: 'read' }, { domain: 'finance', action: 'write' },
      { domain: 'reporting', action: 'read' }, { domain: 'reporting', action: 'export' }, { domain: 'config', action: 'read' }, { domain: 'config', action: 'write' },
      { domain: 'roles', action: 'read' }, { domain: 'roles', action: 'write' }, { domain: 'roles', action: 'delete' }, { domain: 'roles', action: 'assign' }, { domain: 'audit', action: 'read' },
      { domain: 'deposits', action: 'view' }, { domain: 'deposits', action: 'manage' }, { domain: 'payments', action: 'view' }, { domain: 'payments', action: 'manage' }, { domain: 'payments', action: 'write' }, { domain: 'currency', action: 'read' },
      { domain: 'agents', action: 'view' }, { domain: 'agents', action: 'read' }, { domain: 'agents', action: 'write' }, { domain: 'agents', action: 'manage' },
    ], tenant)
  }
  const whitelabelAdminPerms: PermissionPair[] = [
    { domain: 'users', action: 'read' }, { domain: 'users', action: 'write' }, { domain: 'players', action: 'view' }, { domain: 'players', action: 'read' }, { domain: 'players', action: 'write' }, { domain: 'players', action: 'manage' },
    { domain: 'casino', action: 'read' }, { domain: 'casino', action: 'write' }, { domain: 'sports', action: 'read' }, { domain: 'sports', action: 'write' }, { domain: 'matka', action: 'read' }, { domain: 'matka', action: 'write' }, { domain: 'matka.results', action: 'submit' }, { domain: 'matka.results', action: 'approve' },
    { domain: 'promotions', action: 'read' }, { domain: 'promotions', action: 'write' }, { domain: 'bonuses', action: 'read' }, { domain: 'bonuses', action: 'write' }, { domain: 'jackpots', action: 'read' }, { domain: 'jackpots', action: 'write' },
    { domain: 'referrals', action: 'read' }, { domain: 'referrals', action: 'manage' }, { domain: 'vip', action: 'read' }, { domain: 'vip', action: 'write' }, { domain: 'finance', action: 'read' }, { domain: 'finance', action: 'write' },
    { domain: 'reporting', action: 'read' }, { domain: 'reporting', action: 'export' }, { domain: 'config', action: 'read' }, { domain: 'config', action: 'write' },
    { domain: 'roles', action: 'read' }, { domain: 'roles', action: 'write' }, { domain: 'roles', action: 'delete' }, { domain: 'roles', action: 'assign' }, { domain: 'audit', action: 'read' },
    { domain: 'deposits', action: 'view' }, { domain: 'deposits', action: 'manage' }, { domain: 'payments', action: 'view' }, { domain: 'payments', action: 'manage' }, { domain: 'payments', action: 'write' }, { domain: 'currency', action: 'read' },
    { domain: 'agents', action: 'view' }, { domain: 'agents', action: 'read' }, { domain: 'agents', action: 'write' }, { domain: 'agents', action: 'manage' },
  ]
  await setRolePermissions('Whitelabel Admin', whitelabelAdminPerms, tenant)
  await setRolePermissions('Manager', [
    { domain: 'users', action: 'read' }, { domain: 'casino', action: 'read' }, { domain: 'casino', action: 'write' }, { domain: 'sports', action: 'read' }, { domain: 'sports', action: 'write' },
    { domain: 'risk', action: 'read' }, { domain: 'promotions', action: 'read' }, { domain: 'promotions', action: 'write' }, { domain: 'bonuses', action: 'read' }, { domain: 'bonuses', action: 'write' },
    { domain: 'jackpots', action: 'read' }, { domain: 'matka', action: 'read' }, { domain: 'matka.results', action: 'submit' }, { domain: 'referrals', action: 'read' }, { domain: 'referrals', action: 'manage' },
    { domain: 'deposits', action: 'view' }, { domain: 'deposits', action: 'manage' }, { domain: 'reporting', action: 'read' }, { domain: 'audit', action: 'read' },
  ], tenant)
  await setRolePermissions('Operator', [
    { domain: 'casino', action: 'read' }, { domain: 'sports', action: 'read' }, { domain: 'matka', action: 'read' }, { domain: 'matka.results', action: 'submit' }, { domain: 'reporting', action: 'read' }, { domain: 'audit', action: 'read' },
  ], tenant)
  await setRolePermissions('Viewer', [
    { domain: 'casino', action: 'read' }, { domain: 'sports', action: 'read' }, { domain: 'matka', action: 'read' }, { domain: 'reporting', action: 'read' }, { domain: 'audit', action: 'read' },
  ], tenant)
}

export async function seedRoles() {
  const tenant = 'default'
  logStep(1, 1, 'Seeding roles and permissions')
  const whitelabelExists = await checkWhitelabelExists(tenant)
  if (!whitelabelExists) exitWithError(`Whitelabel '${tenant}' not found. Ensure database is initialized.`)
  logSuccess(`Whitelabel '${tenant}' exists`)
  await seedDefaultRBAC(tenant)
  console.log('\n✅ Roles seeding complete!')
  console.log('   Seeded 5 roles: Super Admin, Whitelabel Admin, Manager, Operator, Viewer')
}

if (process.argv[1]?.includes('seedRbac')) {
  seedRoles().catch((err) => { console.error(err); process.exit(1) })
}
