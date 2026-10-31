import { pgTable, serial, timestamp, varchar, uniqueIndex, index, numeric, jsonb, integer, uuid, text } from 'drizzle-orm/pg-core'

export const draws = pgTable('draws', {
  id: varchar('id', { length: 64 }).primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  type: varchar('type', { length: 32 }).notNull(),
  openAt: timestamp('open_at', { withTimezone: true }).notNull(),
  cutoffAt: timestamp('cutoff_at', { withTimezone: true }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  status: varchar('status', { length: 24 }).notNull(),
}, (table) => [
  index('draws_tenant_idx').on(table.tenant),
  uniqueIndex('draws_id_tenant_unique').on(table.id, table.tenant),
])

export const results = pgTable('results', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  drawId: varchar('draw_id', { length: 64 }).notNull(),
  value: varchar('value', { length: 64 }).notNull(),
  enteredBy: varchar('entered_by', { length: 64 }).notNull(),
  enteredAt: timestamp('entered_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('results_tenant_idx').on(table.tenant),
])

export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  domain: varchar('domain', { length: 64 }).notNull(),
  drawId: varchar('draw_id', { length: 64 }),
  value: varchar('value', { length: 64 }),
  reason: varchar('reason', { length: 256 }),
  status: varchar('status', { length: 24 }).notNull().default('pending'),
  requestedBy: varchar('requested_by', { length: 64 }).notNull(),
  approvedBy: varchar('approved_by', { length: 64 }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (table) => [
  index('approvals_tenant_idx').on(table.tenant),
])

// Matka entity core table
export const matkas = pgTable('matkas', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 160 }).notNull(),
  code: varchar('code', { length: 120 }).notNull(),
  description: text('description'),
  timezone: varchar('timezone', { length: 64 }).notNull(),
  schedule: jsonb('schedule').notNull(), // { openTime, closeTime, daysOfWeek[], closesNextDay, effectiveFrom, effectiveTo }
  status: varchar('status', { length: 16 }).notNull().default('inactive'), // active|inactive|suspend (legacy: draft|paused|archived)
  limits: jsonb('limits').notNull(), // { minBet, maxBet, exposureLimit }
  visibility: jsonb('visibility').notNull(), // { featured, hidden }
  priority: integer('priority').notNull().default(0),
  settings: jsonb('settings').notNull(), // { allowManualClose, allowVoid, resultSource, betWindowMinsBeforeOpen, betWindowMinsBeforeClose, notes }
  // Optimistic concurrency control
  version: integer('version').notNull().default(1),
  // Audit
  createdBy: varchar('created_by', { length: 64 }),
  updatedBy: varchar('updated_by', { length: 64 }),
  reason: varchar('reason', { length: 256 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('matkas_status_idx').on(table.status),
  index('matkas_timezone_idx').on(table.timezone),
  index('matkas_priority_idx').on(table.priority),
  uniqueIndex('matkas_tenant_code_unique').on(table.tenant, table.code),
  uniqueIndex('matkas_tenant_name_unique').on(table.tenant, table.name),
])

// Matka rate versions (versioned schedule of rate entries)
export const matkaRateVersions = pgTable('matka_rate_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  matkaId: uuid('matka_id').notNull().references(() => matkas.id),
  versionTag: varchar('version_tag', { length: 64 }).notNull(),
  entries: jsonb('entries').notNull(), // { entries: [{ betType, payoutMultiplier, minOdds, maxOdds }] }
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('matka_rate_versions_matka_idx').on(table.matkaId),
  uniqueIndex('matka_rate_versions_unique_version').on(table.tenant, table.matkaId, table.effectiveFrom),
])

export const matkaDefaultRates = pgTable('matka_default_rates', {
  tenant: varchar('tenant', { length: 128 }).primaryKey().default('default'),
  entries: jsonb('entries').notNull(), // { entries: [{ betType, payoutMultiplier, minOdds, maxOdds }] }
  updatedBy: varchar('updated_by', { length: 64 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

