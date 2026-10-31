import { pgTable, uuid, varchar, timestamp, pgEnum, uniqueIndex, index, integer } from 'drizzle-orm/pg-core'

export const sportStatusEnum = pgEnum('sport_status', ['active', 'inactive'])

export const sportsTable = pgTable('sports', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Global data - no tenant_id/whitelabel_id. All whitelabels see the same sports.
  sportCode: varchar('sport_code', { length: 64 }).notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  sort: integer('sort').notNull().default(999),
  status: sportStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Global unique indexes - no whitelabel_id prefix
  uniqueIndex('sports_code_unique').on(table.sportCode),
  uniqueIndex('sports_key_unique').on(table.key),
])

