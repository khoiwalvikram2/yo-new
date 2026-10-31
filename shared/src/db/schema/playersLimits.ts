import { pgTable, serial, timestamp, varchar, uniqueIndex, index, integer, numeric } from 'drizzle-orm/pg-core'

export const playerLimits = pgTable('player_limits', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull(),
  dailyStakeLimit: numeric('daily_stake_limit', { precision: 18, scale: 2 }),
  weeklyStakeLimit: numeric('weekly_stake_limit', { precision: 18, scale: 2 }),
  exposureCapOverride: numeric('exposure_cap_override', { precision: 18, scale: 2 }),
  cooldownSeconds: integer('cooldown_seconds'),
  maxBetSports: numeric('max_bet_sports', { precision: 18, scale: 2 }),
  maxBetCasino: numeric('max_bet_casino', { precision: 18, scale: 2 }),
  maxBetMatka: numeric('max_bet_matka', { precision: 18, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('player_limits_tenant_idx').on(table.tenant),
  uniqueIndex('player_limits_user_tenant_unique').on(table.userId, table.tenant),
])

