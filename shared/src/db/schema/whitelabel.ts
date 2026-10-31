import { pgTable, varchar, timestamp, jsonb, uniqueIndex, numeric, uuid, text, index } from 'drizzle-orm/pg-core'

export const whitelabels = pgTable('whitelabels', {
	id: varchar('id', { length: 64 }).primaryKey(),
	name: varchar('name', { length: 120 }).notNull(),
	domain: varchar('domain', { length: 255 }).notNull(),
	logoUrl: text('logo_url'), // base64 data URI
	faviconUrl: text('favicon_url'), // base64 data URI
	// sharePercent and extraDomains removed - use whitelabel_sharing_config table for per-domain rates
	status: varchar('status', { length: 20 }).default('active').notNull(),
	vipStartedAt: timestamp('vip_started_at', { withTimezone: true }).notNull().defaultNow(),
	// Credit management (for whitelabel admin credit system)
	creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }).default('0'),
	creditUsed: numeric('credit_used', { precision: 18, scale: 2 }).default('0'),
	creditAvailable: numeric('credit_available', { precision: 18, scale: 2 }).default('0'),
	creditAlertThreshold: numeric('credit_alert_threshold', { precision: 5, scale: 2 }).default('80.00'),
	settlementBalance: numeric('settlement_balance', { precision: 18, scale: 2 }).default('0').notNull(),
	settlementBalanceSports: numeric('settlement_balance_sports', { precision: 18, scale: 2 }).default('0').notNull(),
	settlementBalanceCasino: numeric('settlement_balance_casino', { precision: 18, scale: 2 }).default('0').notNull(),
	settlementBalanceMatka: numeric('settlement_balance_matka', { precision: 18, scale: 2 }).default('0').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex('whitelabels_domain_unique').on(table.domain),
])

// Sharing config (per domain) - fixed rates, no date filtering
export const whitelabelSharingConfig = pgTable('whitelabel_sharing_config', {
	id: uuid('id').primaryKey().defaultRandom(),
	whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull().references(() => whitelabels.id, { onDelete: 'cascade' }),
	domain: varchar('domain', { length: 24 }).notNull(), // sports | casino | matka
	shareRate: numeric('share_rate', { precision: 6, scale: 4 }).notNull(), // 0..1
	basis: varchar('basis', { length: 12 }).notNull().default('GGR'),
	// effectiveFrom and effectiveTo removed - sharing rates are now fixed
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('whitelabel_sharing_config_whitelabel_id_idx').on(table.whitelabelId),
])
