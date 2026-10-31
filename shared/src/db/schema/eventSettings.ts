import { pgTable, uuid, varchar, timestamp, numeric, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const eventSettingsTable = pgTable('event_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  eventId: uuid('event_id').notNull(),
  tierId: varchar('tier_id', { length: 64 }).notNull().default('default'),

  // Stake Limits
  exchangeMinStake: numeric('exchange_min_stake', { precision: 18, scale: 2 }),
  exchangeMaxStake: numeric('exchange_max_stake', { precision: 18, scale: 2 }),
  bookmakerMinStake: numeric('bookmaker_min_stake', { precision: 18, scale: 2 }),
  bookmakerMaxStake: numeric('bookmaker_max_stake', { precision: 18, scale: 2 }),
  fancyMinStake: numeric('fancy_min_stake', { precision: 18, scale: 2 }),
  fancyMaxStake: numeric('fancy_max_stake', { precision: 18, scale: 2 }),

  // Bet Delays
  exchangeDelay: integer('exchange_delay'),
  bookmakerDelay: integer('bookmaker_delay'),
  fancyDelay: integer('fancy_delay'),

  // Bet Cooldowns
  exchangeCooldown: integer('exchange_cooldown'),
  bookmakerCooldown: integer('bookmaker_cooldown'),
  fancyCooldown: integer('fancy_cooldown'),

  // Odds Limits
  exchangeMinOdds: numeric('exchange_min_odds', { precision: 10, scale: 2 }),
  exchangeMaxOdds: numeric('exchange_max_odds', { precision: 10, scale: 2 }),

  // Commission Rates
  exchangeCommission: numeric('exchange_commission', { precision: 6, scale: 2 }),
  bookmakerCommission: numeric('bookmaker_commission', { precision: 6, scale: 2 }),
  fancyCommission: numeric('fancy_commission', { precision: 6, scale: 2 }),

  // Exposure Limits
  exchangeExposureDaily: numeric('exchange_exposure_daily', { precision: 18, scale: 2 }),
  exchangeExposureWeekly: numeric('exchange_exposure_weekly', { precision: 18, scale: 2 }),
  exchangeExposureCap: numeric('exchange_exposure_cap', { precision: 18, scale: 2 }),
  bookmakerExposureDaily: numeric('bookmaker_exposure_daily', { precision: 18, scale: 2 }),
  bookmakerExposureWeekly: numeric('bookmaker_exposure_weekly', { precision: 18, scale: 2 }),
  bookmakerExposureCap: numeric('bookmaker_exposure_cap', { precision: 18, scale: 2 }),
  fancyExposureDaily: numeric('fancy_exposure_daily', { precision: 18, scale: 2 }),
  fancyExposureWeekly: numeric('fancy_exposure_weekly', { precision: 18, scale: 2 }),
  fancyExposureCap: numeric('fancy_exposure_cap', { precision: 18, scale: 2 }),

  // Cashout
  cashoutActive: boolean('cashout_active'),

  // Risk & Alerts
  riskLevel: varchar('risk_level', { length: 16 }),
  riskThreshold: numeric('risk_threshold', { precision: 6, scale: 2 }),
  volatilityThreshold: numeric('volatility_threshold', { precision: 6, scale: 2 }),
  alertOnBreach: boolean('alert_on_breach'),
  alertChannel: varchar('alert_channel', { length: 64 }),
  alertRateLimit: integer('alert_rate_limit'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('event_settings_tenant_idx').on(table.tenant),
  uniqueEventTier: uniqueIndex('event_settings_unique').on(table.whitelabelId, table.eventId, table.tierId),
}))

