import { pgTable, serial, timestamp, varchar, uniqueIndex, index, integer, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 64 }).notNull(),
  /**
   * Marks the role that administers this whitelabel.
   *
   * `name` is free text and `renameRole` will change it to anything, so a
   * feature that recognises the whitelabel's administrator by name breaks
   * silently the moment somebody renames their own role — losing access through
   * an action with no visible connection to it. This flag is what survives the
   * rename, and it is what such checks read.
   *
   * Not a general "system role" marker: it says which role administers the
   * whitelabel, nothing more. Exactly one per tenant is expected; nothing
   * enforces that, because a tenant that has genuinely split the job across two
   * roles should not be broken by a constraint added later.
   */
  isWhitelabelAdmin: boolean('is_whitelabel_admin').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('roles_tenant_name_unique').on(table.tenant, table.name),
  index('roles_whitelabel_admin_idx').on(table.tenant).where(sql`is_whitelabel_admin`),
])

export const userRoles = pgTable('user_roles', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull(),
  roleId: integer('role_id').notNull(),
}, (table) => [
  index('user_roles_tenant_idx').on(table.tenant),
  index('user_roles_role_id_idx').on(table.roleId),
  uniqueIndex('user_roles_user_role_tenant_unique').on(table.userId, table.roleId, table.tenant),
])

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  domain: varchar('domain', { length: 64 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
}, (table) => [
  index('permissions_domain_action_idx').on(table.domain, table.action),
  uniqueIndex('permissions_tenant_domain_action_unique').on(table.tenant, table.domain, table.action),
])

export const rolePermissions = pgTable('role_permissions', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  roleId: integer('role_id').notNull(),
  permissionId: integer('permission_id').notNull(),
}, (table) => [
  index('role_permissions_tenant_idx').on(table.tenant),
  index('role_permissions_permission_id_idx').on(table.permissionId),
  uniqueIndex('role_permissions_role_permission_tenant_unique').on(table.roleId, table.permissionId, table.tenant),
])

