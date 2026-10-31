import { pgEnum, pgTable, serial, varchar, timestamp, integer, boolean, numeric, jsonb, uniqueIndex, index, uuid, text } from 'drizzle-orm/pg-core'
import { whitelabels } from './whitelabel'
import { vipTiersTable } from './vip'

// Main category for casino games
export const casinoMainCategoryEnum = pgEnum('casino_main_category', ['live_casino', 'casino', 'slots'])
export const casinoCategoryTypeEnum = pgEnum('casino_category_type', ['general', 'top', 'featured', 'lounge'])

export const casinoApiProviders = pgTable('casino_api_providers', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 64 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_api_providers_key_unique').on(table.key),
])

export const casinoVendors = pgTable('casino_vendors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 160 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_vendors_slug_unique').on(table.slug),
  index('casino_vendors_name_idx').on(table.name),
])

export const casinoGames = pgTable('casino_games', {
  id: serial('id').primaryKey(),
  apiProviderId: integer('api_provider_id').notNull().references(() => casinoApiProviders.id),
  vendorId: integer('vendor_id').notNull().references(() => casinoVendors.id),
  mainCategory: casinoMainCategoryEnum('main_category').notNull(),
  externalId: varchar('external_id', { length: 128 }).notNull(),
  tableId: varchar('table_id', { length: 200 }),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 200 }).notNull(),
  thumbnailUrl: varchar('thumbnail_url', { length: 1000 }),
  rtp: numeric('rtp', { precision: 5, scale: 2 }),
  volatility: varchar('volatility', { length: 32 }),
  demoUrl: varchar('demo_url', { length: 1000 }),
  features: jsonb('features'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_games_provider_external_unique').on(table.apiProviderId, table.externalId),
  index('casino_games_provider_category_idx').on(table.apiProviderId, table.mainCategory),
  index('casino_games_vendor_category_idx').on(table.vendorId, table.mainCategory),
  index('casino_games_name_idx').on(table.name),
])

export const whitelabelCasinoGameSettings = pgTable('whitelabel_casino_game_settings', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  gameId: integer('game_id').notNull().references(() => casinoGames.id),
  enabled: boolean('enabled').notNull().default(false),
  order: integer('order'),
  featured: boolean('featured').default(false),
  premiumOnly: boolean('premium_only').notNull().default(false),
  tags: jsonb('tags').$type<string[]>(),
  limits: jsonb('limits'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_casino_game_settings_unique').on(table.tenantId, table.gameId),
  index('whitelabel_casino_game_settings_game_idx').on(table.gameId),
])

export const whitelabelCasinoVendorSettings = pgTable('whitelabel_casino_vendor_settings', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  vendorId: integer('vendor_id').notNull().references(() => casinoVendors.id),
  enabled: boolean('enabled').notNull().default(false),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_casino_vendor_settings_unique').on(table.tenantId, table.vendorId),
  index('whitelabel_casino_vendor_settings_vendor_idx').on(table.vendorId),
])

export const whitelabelCasinoProviderSettings = pgTable('whitelabel_casino_provider_settings', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  providerId: integer('provider_id').notNull().references(() => casinoApiProviders.id),
  enabled: boolean('enabled').notNull().default(false),
  displayOrder: integer('display_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('wl_casino_provider_settings_unique').on(table.tenantId, table.providerId),
  index('wl_casino_provider_settings_provider_idx').on(table.providerId),
])

export const whitelabelCasinoVendorSuperAdminOverride = pgTable('whitelabel_casino_vendor_super_admin_override', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  vendorId: integer('vendor_id').notNull().references(() => casinoVendors.id),
  disabled: boolean('disabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('wl_casino_vendor_sa_override_unique').on(table.tenantId, table.vendorId),
  index('wl_casino_vendor_sa_override_vendor_idx').on(table.vendorId),
])

export const whitelabelCasinoGameSuperAdminOverride = pgTable('whitelabel_casino_game_super_admin_override', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  gameId: integer('game_id').notNull().references(() => casinoGames.id),
  disabled: boolean('disabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('wl_casino_game_sa_override_unique').on(table.tenantId, table.gameId),
  index('wl_casino_game_sa_override_game_idx').on(table.gameId),
])

export const vipTierCasinoGames = pgTable('vip_tier_casino_games', {
  id: serial('id').primaryKey(),
  tierId: uuid('tier_id').notNull().references(() => vipTiersTable.id, { onDelete: 'cascade' }),
  gameId: integer('game_id').notNull().references(() => casinoGames.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('vip_tier_casino_games_unique').on(table.tierId, table.gameId),
  index('vip_tier_casino_games_game_idx').on(table.gameId),
])

// Casino game bet settings (per-player or for all)
export const casinoGameBetSettings = pgTable('casino_game_bet_settings', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  gameId: integer('game_id').notNull().references(() => casinoGames.id, { onDelete: 'cascade' }),
  playerId: varchar('player_id', { length: 64 }), // null = for all players
  betEnabled: boolean('bet_enabled').notNull().default(true),
  minStake: numeric('min_stake', { precision: 12, scale: 2 }),
  maxStake: numeric('max_stake', { precision: 12, scale: 2 }),
  maxWin: numeric('max_win', { precision: 12, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_game_bet_settings_unique').on(table.tenantId, table.gameId, table.playerId),
  index('casino_game_bet_settings_game_idx').on(table.gameId),
  index('casino_game_bet_settings_player_idx').on(table.playerId),
])

// Custom Categories (tenant-specific) under main categories
export const casinoCategories = pgTable('casino_categories', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  mainCategory: casinoMainCategoryEnum('main_category').notNull(),
  type: casinoCategoryTypeEnum('type').notNull().default('general'),
  subtitle: varchar('subtitle', { length: 200 }),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 160 }).notNull(),
  iconData: text('icon_data'),
  order: integer('order'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_categories_tenant_main_slug_unique').on(table.tenantId, table.mainCategory, table.slug),
  index('casino_categories_tenant_main_order_idx').on(table.tenantId, table.mainCategory, table.order),
  index('casino_categories_name_idx').on(table.name),
])

export const casinoCategoryGames = pgTable('casino_category_games', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => casinoCategories.id, { onDelete: 'cascade' }),
  gameId: integer('game_id').notNull().references(() => casinoGames.id, { onDelete: 'cascade' }),
  imageData: text('image_data'), // Optional Base64 artwork for this Lounge membership.
  order: integer('order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_category_games_unique').on(table.categoryId, table.gameId),
  index('casino_category_games_game_idx').on(table.gameId),
  index('casino_category_games_order_idx').on(table.categoryId, table.order),
])

// Provider ↔ Vendor revenue share percentages per tenant
export const casinoProviderVendorShares = pgTable('casino_provider_vendor_shares', {
  id: serial('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 64 }).notNull().references(() => whitelabels.id),
  providerId: integer('provider_id').notNull().references(() => casinoApiProviders.id),
  vendorId: integer('vendor_id').notNull().references(() => casinoVendors.id),
  sharePercentage: numeric('share_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_provider_vendor_shares_unique').on(table.tenantId, table.providerId, table.vendorId),
  index('casino_provider_vendor_shares_provider_idx').on(table.providerId),
  index('casino_provider_vendor_shares_vendor_idx').on(table.vendorId),
])

