import { pgTable, uuid, varchar, timestamp, uniqueIndex, index, integer, boolean, jsonb } from 'drizzle-orm/pg-core'
import { sportsTable, sportStatusEnum } from './sports'

export const sportsLeaguesTable = pgTable('sports_leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Global data - no tenant_id/whitelabel_id. All whitelabels see the same leagues.
  sportId: uuid('sport_id').notNull().references(() => sportsTable.id),
  leagueCode: varchar('league_code', { length: 64 }).notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  sort: integer('sort').notNull().default(999),
  status: sportStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sports_leagues_sport_idx').on(table.sportId),
  // Global unique index - no whitelabel_id prefix
  uniqueIndex('sports_leagues_code_unique').on(table.leagueCode),
])

export const sportsEventsTable = pgTable('sports_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Global data - no tenant_id/whitelabel_id. All whitelabels see the same events.
  leagueId: uuid('league_id').notNull().references(() => sportsLeaguesTable.id),
  eventCode: varchar('event_code', { length: 64 }).notNull(),
  key: varchar('key', { length: 128 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  startTime: timestamp('start_time'),
  status: sportStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sports_events_league_idx').on(table.leagueId),
  // Global unique index - no whitelabel_id prefix
  uniqueIndex('sports_events_code_unique').on(table.eventCode),
])

export const sportsMarketsTable = pgTable('sports_markets', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Global data - no tenant_id/whitelabel_id. All whitelabels see the same markets.
  eventId: uuid('event_id').notNull().references(() => sportsEventsTable.id),
  marketCode: varchar('market_code', { length: 64 }).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  type: varchar('type', { length: 64 }).notNull().default('match_odds'),
  status: sportStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sports_markets_event_idx').on(table.eventId),
  // Global unique index - no whitelabel_id prefix
  uniqueIndex('sports_markets_code_unique').on(table.marketCode),
])

export const sportsRunnersTable = pgTable('sports_runners', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Global data - no tenant_id/whitelabel_id. All whitelabels see the same runners.
  marketId: uuid('market_id').notNull().references(() => sportsMarketsTable.id),
  selectionCode: varchar('selection_code', { length: 64 }).notNull(),
  name: varchar('name', { length: 180 }).notNull(),
  sort: integer('sort').notNull().default(999),
  status: sportStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // Global unique index - no whitelabel_id prefix
  uniqueIndex('sports_runners_code_unique').on(table.marketId, table.selectionCode),
])

export const sportsAutoConfigsTable = pgTable('sports_auto_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  sportId: uuid('sport_id').notNull().references(() => sportsTable.id),
  leagueCodes: jsonb('league_codes'),
  frequencyHours: integer('frequency_hours').notNull().default(6),
  active: boolean('active').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  lastRunStatus: varchar('last_run_status', { length: 32 }).default('never'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sports_auto_configs_sport_id_idx').on(table.sportId),
  index('sports_auto_cfgs_tenant_idx').on(table.tenant),
  uniqueIndex('sports_auto_cfgs_unique').on(table.whitelabelId, table.sportId),
])

export const sportsAutoRunsTable = pgTable('sports_auto_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  sportId: uuid('sport_id').notNull().references(() => sportsTable.id),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  status: varchar('status', { length: 32 }).notNull().default('running'),
  leaguesAdded: integer('leagues_added').notNull().default(0),
  eventsAdded: integer('events_added').notNull().default(0),
  marketsAdded: integer('markets_added').notNull().default(0),
  runnersAdded: integer('runners_added').notNull().default(0),
  skippedEventsCount: integer('skipped_events_count').notNull().default(0),
  skippedEvents: jsonb('skipped_events'),
  errorMessage: varchar('error_message', { length: 500 }),
}, (table) => [
  index('sports_auto_runs_tenant_idx').on(table.tenant),
  index('sports_auto_runs_whitelabel_idx').on(table.whitelabelId),
  index('sports_auto_runs_sport_idx').on(table.sportId),
  index('sports_auto_runs_started_idx').on(table.startedAt),
])

