import { pgTable, uuid, varchar, boolean, numeric, jsonb, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const matkaBidRules = pgTable('matka_bid_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  matkaId: uuid('matka_id').notNull(),
  matkaType: varchar('matka_type', { length: 32 }).notNull(), // worli|starline|jackpot
  marketName: varchar('market_name', { length: 160 }).notNull(),
  marketSession: varchar('market_session', { length: 32 }), // morning|evening|open|close
  bidType: varchar('bid_type', { length: 48 }).notNull(), // SINGLE|JODI|... (free text for now)
  percentage: numeric('percentage', { precision: 12, scale: 4 }).notNull(),
  includeAll: boolean('include_all').notNull().default(true),
  includedPlayers: jsonb('included_players'), // { playerIds: string[] } or segments in future
  minStake: numeric('min_stake', { precision: 18, scale: 2 }),
  maxStake: numeric('max_stake', { precision: 18, scale: 2 }),
  exposureCap: numeric('exposure_cap', { precision: 18, scale: 2 }),
  status: varchar('status', { length: 16 }).notNull().default('active'), // active|inactive
  priority: integer('priority').notNull().default(0),
  notes: varchar('notes', { length: 512 }),
  // Versioning
  versionId: uuid('version_id'),
  versionLabel: varchar('version_label', { length: 128 }),
  isActive: boolean('is_active').notNull().default(false),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdBy: varchar('created_by', { length: 64 }),
  updatedBy: varchar('updated_by', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('matka_bid_rules_tenant_idx').on(table.tenant),
  index('matka_bid_rules_market_idx').on(table.marketName),
  index('matka_bid_rules_bid_type_idx').on(table.bidType),
  index('matka_bid_rules_active_idx').on(table.matkaId, table.isActive),
  uniqueIndex('matka_bid_rules_version_scope_unique').on(table.matkaId, table.versionId, table.bidType, table.marketSession),
])

