import { pgTable, uuid, varchar, timestamp, boolean, numeric, integer, uniqueIndex, index } from 'drizzle-orm/pg-core'

export const sportsSettingsTable = pgTable('sports_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  sportId: uuid('sport_id').notNull(),
  tierId: varchar('tier_id', { length: 64 }).notNull().default('default'),

  // Stake limits
  exchangeMinStake: numeric('exchange_min_stake', { precision: 18, scale: 2 }),
  exchangeMaxStake: numeric('exchange_max_stake', { precision: 18, scale: 2 }),
  bookmakerMinStake: numeric('bookmaker_min_stake', { precision: 18, scale: 2 }),
  bookmakerMaxStake: numeric('bookmaker_max_stake', { precision: 18, scale: 2 }),
  fancyMinStake: numeric('fancy_min_stake', { precision: 18, scale: 2 }),
  fancyMaxStake: numeric('fancy_max_stake', { precision: 18, scale: 2 }),

  // Odds limits (Exchange)
  exchangeMinOdds: numeric('exchange_min_odds', { precision: 10, scale: 2 }),
  exchangeMaxOdds: numeric('exchange_max_odds', { precision: 10, scale: 2 }),

  // Commission
  exchangeCommission: numeric('exchange_commission', { precision: 6, scale: 2 }),
  bookmakerCommission: numeric('bookmaker_commission', { precision: 6, scale: 2 }),
  fancyCommission: numeric('fancy_commission', { precision: 6, scale: 2 }),

  // Exposure limits
  exchangeExposureDaily: numeric('exchange_exposure_daily', { precision: 18, scale: 2 }),
  exchangeExposureWeekly: numeric('exchange_exposure_weekly', { precision: 18, scale: 2 }),
  exchangeExposureCap: numeric('exchange_exposure_cap', { precision: 18, scale: 2 }),
  bookmakerExposureDaily: numeric('bookmaker_exposure_daily', { precision: 18, scale: 2 }),
  bookmakerExposureWeekly: numeric('bookmaker_exposure_weekly', { precision: 18, scale: 2 }),
  bookmakerExposureCap: numeric('bookmaker_exposure_cap', { precision: 18, scale: 2 }),
  fancyExposureDaily: numeric('fancy_exposure_daily', { precision: 18, scale: 2 }),
  fancyExposureWeekly: numeric('fancy_exposure_weekly', { precision: 18, scale: 2 }),
  fancyExposureCap: numeric('fancy_exposure_cap', { precision: 18, scale: 2 }),

  // Bet delays (seconds)
  exchangeDelay: integer('exchange_delay'),
  bookmakerDelay: integer('bookmaker_delay'),
  fancyDelay: integer('fancy_delay'),

  // Bet cooldowns (seconds)
  exchangeCooldown: integer('exchange_cooldown'),
  bookmakerCooldown: integer('bookmaker_cooldown'),
  fancyCooldown: integer('fancy_cooldown'),

  // Toggles
  cashoutActive: boolean('cashout_active'),

  // Risk
  riskLevel: varchar('risk_level', { length: 16 }),
  riskThreshold: numeric('risk_threshold', { precision: 6, scale: 2 }),
  volatilityThreshold: numeric('volatility_threshold', { precision: 6, scale: 2 }),

  // Alerts
  alertOnBreach: boolean('alert_on_breach'),
  alertChannel: varchar('alert_channel', { length: 32 }),
  alertRateLimit: integer('alert_rate_limit'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('sports_settings_tenant_idx').on(table.tenant),
  uniqueIndex('sports_settings_unique').on(table.whitelabelId, table.sportId, table.tierId),
])

