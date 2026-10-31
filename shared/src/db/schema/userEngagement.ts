import { pgTable, serial, varchar, integer, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const casinoLikes = pgTable('casino_likes', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameId: varchar('game_id', { length: 256 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_likes_user_game_unique').on(table.userId, table.tenant, table.gameId),
  index('casino_likes_tenant_idx').on(table.tenant),
])

export const casinoRecent = pgTable('casino_recent', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameId: varchar('game_id', { length: 256 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('casino_recent_user_game_unique').on(table.userId, table.tenant, table.gameId),
  index('casino_recent_tenant_idx').on(table.tenant),
])

export const sportsBookmarks = pgTable('sports_bookmarks', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 256 }).notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('sports_bookmarks_user_event_unique').on(table.userId, table.tenant, table.eventId),
  index('sports_bookmarks_tenant_idx').on(table.tenant),
])

/**
 * Sports recent events - stores events where users have placed bets.
 * This table should ONLY be populated when a user places a bet (not when just viewing events).
 * The eventId should match the eventId from the sportsBets table.
 */
export const sportsRecent = pgTable('sports_recent', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_id', { length: 256 }).notNull(),
  meta: jsonb('meta'), // Stores event metadata: eventName, league, sport, startISO, isLive, runners
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('sports_recent_user_event_unique').on(table.userId, table.tenant, table.eventId),
  index('sports_recent_tenant_idx').on(table.tenant),
  index('sports_recent_created_idx').on(table.createdAt),
])

