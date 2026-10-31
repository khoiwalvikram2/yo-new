import { pgTable, uuid, varchar, timestamp, date, pgEnum, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { matkas } from './matka'
import { matkaResultTypeEnum } from './matkaResults'

export const matkaResultSchedules = pgTable('matka_result_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  matkaId: uuid('matka_id').notNull().references(() => matkas.id),
  date: date('date').notNull(), // ISO yyyy-mm-dd
  type: matkaResultTypeEnum('type').notNull(), // open | close
  result: varchar('result', { length: 64 }).notNull(), // Result string value to declare
  scheduledBy: varchar('scheduled_by', { length: 64 }).notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(), // When to execute
  executedAt: timestamp('executed_at', { withTimezone: true }), // When it was executed
  executedBy: varchar('executed_by', { length: 64 }), // System or admin who executed
  status: varchar('status', { length: 16 }).notNull().default('pending'), // pending | executed | failed | cancelled
  errorMessage: varchar('error_message', { length: 512 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('matka_result_schedules_matka_id_idx').on(table.matkaId),
  // Unique constraint: one schedule per (tenant, matkaId, date, type)
  uniqueIndex('matka_result_schedules_unique').on(table.tenant, table.matkaId, table.date, table.type),
  // Indexes for fast lookups
  index('matka_result_schedules_scheduled_at_idx').on(table.scheduledAt),
  index('matka_result_schedules_status_idx').on(table.status),
])

