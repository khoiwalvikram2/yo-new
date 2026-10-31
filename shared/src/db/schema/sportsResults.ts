import { pgTable, uuid, varchar, timestamp, pgEnum, index, text, numeric, boolean } from 'drizzle-orm/pg-core'
import { sportsTable } from './sports'
import { sportsLeaguesTable } from './sportsContent'
import { sportsEventsTable } from './sportsContent'
import { sportsMarketsTable } from './sportsContent'
import { sportsRunnersTable } from './sportsContent'

export const sportsResultMarketTypeEnum = pgEnum('sports_result_market_type', ['exchange', 'bookmaker', 'fancy'])

export const sportsResultsTable = pgTable('sports_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  isGlobal: boolean('is_global').notNull().default(false),

  // Sports hierarchy references
  sportId: uuid('sport_id').notNull().references(() => sportsTable.id),
  leagueId: uuid('league_id').notNull().references(() => sportsLeaguesTable.id),
  eventId: uuid('event_id').notNull().references(() => sportsEventsTable.id),
  marketId: uuid('market_id').notNull().references(() => sportsMarketsTable.id),
  
  // Market type
  marketType: sportsResultMarketTypeEnum('market_type').notNull(),
  
  // Result data
  // For exchange/bookmaker: runnerId points to the winning selection
  // For fancy: selectionName is the fancy selection name, result is numeric value
  runnerId: uuid('runner_id').references(() => sportsRunnersTable.id), // For exchange/bookmaker
  selectionName: varchar('selection_name', { length: 200 }), // For fancy
  result: numeric('result', { precision: 18, scale: 2 }), // Numeric result (for fancy) or can store winner info
  
  // Audit fields
  declaredBy: varchar('declared_by', { length: 64 }).notNull(),
  declaredAt: timestamp('declared_at', { withTimezone: true }).defaultNow().notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }), // For duplicate prevention
  declaredFromIp: varchar('declared_from_ip', { length: 45 }), // IPv4/IPv6
  declaredUserAgent: text('declared_user_agent'),
  
  // Rollback fields
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rolledBackBy: varchar('rolled_back_by', { length: 64 }),
  rollbackReason: text('rollback_reason'),
  rollbackTag: varchar('rollback_tag', { length: 32 }), // Categorical tag (e.g., 'error', 'correction', 'fraud')
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sports_results_runner_id_idx').on(table.runnerId),
  // Unique constraint: one active result per market (only if not rolled back)
  // Note: We'll enforce this in application logic since we can't have conditional unique constraints
  // Indexes for fast lookups
  index('sports_results_tenant_idx').on(table.tenant),
  index('sports_results_whitelabel_idx').on(table.whitelabelId),
  index('sports_results_sport_idx').on(table.sportId),
  index('sports_results_league_idx').on(table.leagueId),
  index('sports_results_event_idx').on(table.eventId),
  index('sports_results_market_idx').on(table.marketId),
  index('sports_results_market_type_idx').on(table.marketType),
  index('sports_results_declared_at_idx').on(table.declaredAt),
  index('sports_results_created_at_idx').on(table.createdAt),
  index('sports_results_idempotency_idx').on(table.idempotencyKey),
  index('sports_results_rolled_back_idx').on(table.rolledBackAt),
  index('sports_results_is_global_idx').on(table.isGlobal),
])

