import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const sportsMarketSnapshots = pgTable('sports_market_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  marketId: varchar('market_id', { length: 64 }).notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  seq: varchar('seq', { length: 32 }).notNull(),
  snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('sports_market_snapshots_market_idx').on(t.marketId),
  index('sports_market_snapshots_whitelabel_idx').on(t.whitelabelId),
])

export const sportsMarketStateHistory = pgTable('sports_market_state_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  marketId: varchar('market_id', { length: 64 }).notNull(),
  state: varchar('state', { length: 32 }).notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('sports_market_state_history_market_idx').on(t.marketId),
  index('sports_market_state_history_whitelabel_idx').on(t.whitelabelId),
])

