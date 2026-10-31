import { pgTable, serial, timestamp, varchar, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const adminIpAllowlist = pgTable('admin_ip_allowlist', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull(),
  cidr: varchar('cidr', { length: 64 }).notNull(), // e.g., "203.0.113.0/24" or "192.0.2.1"
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('admin_ip_allowlist_tenant_idx').on(table.tenant),
  uniqueIndex('admin_ip_allowlist_user_cidr_tenant_unique').on(table.userId, table.cidr, table.tenant),
])

