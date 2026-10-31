import { pgTable, uuid, varchar, timestamp, date, pgEnum, index, uniqueIndex, text } from 'drizzle-orm/pg-core'
import { matkas } from './matka'

export const matkaResultTypeEnum = pgEnum('matka_result_type', ['open', 'close'])

export const matkaResults = pgTable('matka_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  matkaId: uuid('matka_id').notNull().references(() => matkas.id),
  date: date('date').notNull(), // ISO yyyy-mm-dd
  type: matkaResultTypeEnum('type').notNull(), // open | close
  result: varchar('result', { length: 64 }).notNull(), // Result string value
  declaredBy: varchar('declared_by', { length: 64 }).notNull(),
  declaredAt: timestamp('declared_at', { withTimezone: true }).defaultNow().notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }), // For duplicate prevention
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rolledBackBy: varchar('rolled_back_by', { length: 64 }),
  rollbackReason: text('rollback_reason'),
  rollbackTag: varchar('rollback_tag', { length: 32 }), // Categorical tag (e.g., 'error', 'correction', 'fraud')
  declaredFromIp: varchar('declared_from_ip', { length: 45 }), // IPv4/IPv6
  declaredUserAgent: text('declared_user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Unique constraint: one result per (tenant, matkaId, date, type)
  uniqueIndex('matka_results_unique').on(table.tenant, table.matkaId, table.date, table.type),
  // Indexes for fast lookups
  index('matka_results_matka_date_idx').on(table.matkaId, table.date),
  index('matka_results_created_at_idx').on(table.createdAt),
  index('matka_results_idempotency_idx').on(table.idempotencyKey),
])

