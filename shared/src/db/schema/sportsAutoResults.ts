import { pgTable, uuid, varchar, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core'
import { sportsTable } from './sports'
import { sportsLeaguesTable } from './sportsContent'
import { sportsEventsTable } from './sportsContent'

export const sportsAutoResultsTable = pgTable('sports_auto_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),

  // Scope: can be at sport, league, or event level
  sportId: uuid('sport_id').references(() => sportsTable.id),
  leagueId: uuid('league_id').references(() => sportsLeaguesTable.id),
  eventId: uuid('event_id').references(() => sportsEventsTable.id),

  // Market type toggles: exchange, bookmaker, fancy
  exchangeEnabled: boolean('exchange_enabled').notNull().default(false),
  bookmakerEnabled: boolean('bookmaker_enabled').notNull().default(false),
  fancyEnabled: boolean('fancy_enabled').notNull().default(false),

  // Settings
  enabled: boolean('enabled').notNull().default(false),
  autoDeclareEnabled: boolean('auto_declare_enabled').notNull().default(false),
  
  // Auto result rules (JSONB for flexibility)
  rules: jsonb('rules'), // e.g., { delayMinutes: 5, conditions: {...} }
  
  // Notification settings
  notifyOnAutoDeclare: boolean('notify_on_auto_declare').notNull().default(false),
  notifyChannels: jsonb('notify_channels'), // e.g., ['email', 'slack', 'webhook']
  
  // Audit
  createdBy: varchar('created_by', { length: 64 }).notNull(),
  updatedBy: varchar('updated_by', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sports_auto_results_tenant_idx').on(table.tenant),
  index('sports_auto_results_whitelabel_idx').on(table.whitelabelId),
  index('sports_auto_results_sport_idx').on(table.sportId),
  index('sports_auto_results_league_idx').on(table.leagueId),
  index('sports_auto_results_event_idx').on(table.eventId),
  index('sports_auto_results_enabled_idx').on(table.enabled),
])

