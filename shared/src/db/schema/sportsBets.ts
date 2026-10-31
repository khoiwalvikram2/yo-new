import { pgTable, uuid, varchar, timestamp, numeric, pgEnum, index, integer, boolean } from 'drizzle-orm/pg-core'
import { sportsTable } from './sports'
import { sportsLeaguesTable } from './sportsContent'
import { sportsMarketsTable } from './sportsContent'
import { sportsEventsTable } from './sportsContent'
import { sportsRunnersTable } from './sportsContent'
import { users } from './users'

export const sportsBetStatusEnum = pgEnum('sports_bet_status', [
  'matched',
  'unmatched',
  'cancelled',
  'settled',
  'won',
  'lost',
  'void',
])

export const sportsBetSideEnum = pgEnum('sports_bet_side', ['back', 'lay'])

export const sportsBets = pgTable('sports_bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id), // References users.id

  // Sports hierarchy references
  sportId: uuid('sport_id').notNull().references(() => sportsTable.id),
  leagueId: uuid('league_id').notNull().references(() => sportsLeaguesTable.id),
  marketId: uuid('market_id').notNull().references(() => sportsMarketsTable.id),
  eventId: uuid('event_id').notNull().references(() => sportsEventsTable.id),

  // Runner and selection references
  runnerId: uuid('runner_id').notNull().references(() => sportsRunnersTable.id),
  selectionId: varchar('selection_id', { length: 64 }).notNull(), // Selection code from runner

  // Bet details
  side: sportsBetSideEnum('side').notNull(), // back or lay
  price: numeric('price', { precision: 10, scale: 2 }).notNull(), // Odds
  size: numeric('size', { precision: 18, scale: 2 }).notNull(), // Size of the bet
  stake: numeric('stake', { precision: 18, scale: 2 }).notNull(), // Stake amount
  liability: numeric('liability', { precision: 18, scale: 2 }).notNull(), // Liability amount
  oddsSize: numeric('odds_size', { precision: 10, scale: 2 }), // For fancy bets: price size/percentage (e.g., 100.00 means 100%)

  // Status and settlement
  status: sportsBetStatusEnum('status').notNull().default('unmatched'),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  result: varchar('result', { length: 64 }), // Result of the bet
  pl: numeric('pl', { precision: 18, scale: 2 }), // Profit/Loss: positive = user profit, negative = user loss, null = unsettled

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  // IP and device tracking
  ipAddress: varchar('ip_address', { length: 45 }), // IPv6 max length is 45
  userAgent: varchar('user_agent', { length: 512 }),
  location: varchar('location', { length: 256 }),
  country: varchar('country', { length: 64 }),
  deviceInfo: varchar('device_info', { length: 256 }),

  /** When true, open bet is omitted from admin running-market / live aggregates (bet-tool / integration). */
  excludeFromAdminRunning: boolean('exclude_from_admin_running').notNull().default(false),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('sports_bets_event_id_idx').on(table.eventId),
  index('sports_bets_tenant_idx').on(table.tenant),
  index('sports_bets_whitelabel_idx').on(table.whitelabelId),
  index('sports_bets_sport_idx').on(table.sportId),
  index('sports_bets_league_idx').on(table.leagueId),
  index('sports_bets_market_idx').on(table.marketId),
  index('sports_bets_runner_idx').on(table.runnerId),
  index('sports_bets_selection_idx').on(table.selectionId),
  index('sports_bets_status_idx').on(table.status),
  index('sports_bets_created_idx').on(table.createdAt),
  index('sports_bets_user_status_idx').on(table.userId, table.status),
  // Serves the CRM player timeline: one player's rows, newest first, without sorting the whole history.
  index('sports_bets_user_created_idx').on(table.userId, table.createdAt),
])

