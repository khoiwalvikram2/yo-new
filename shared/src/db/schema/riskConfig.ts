import { pgTable, uuid, varchar, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const riskConfigTable = pgTable('risk_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  eventId: uuid('event_id').notNull(),

  // Risk configuration stored as JSONB
  percentiles: jsonb('percentiles').$type<{
    liability75?: number
    liability90?: number
    liability95?: number
    exposure75?: number
    exposure90?: number
    betCount75?: number
    betCount90?: number
    odds75?: number
    odds90?: number
  }>(),
  
  weights: jsonb('weights').$type<{
    liability?: number
    exposure?: number
    volume?: number
    odds?: number
  }>(),
  
  amounts: jsonb('amounts').$type<{
    highLiability?: number
    mediumLiability?: number
    highExposure?: number
    mediumExposure?: number
    highBetCount?: number
    mediumBetCount?: number
    highOdds?: number
    mediumOdds?: number
  }>(),
  
  alerts: jsonb('alerts').$type<{
    enabled?: boolean
    triggerLevels?: string[] // ['HIGH', 'MEDIUM', 'LOW', 'MINIMAL']
    notificationEnabled?: boolean
    bannerEnabled?: boolean
    sidebarIndicatorEnabled?: boolean
    cooldownSeconds?: number // Prevent spam
  }>(),
  
  // Pattern detection thresholds (optional - uses defaults if not provided)
  patternThresholds: jsonb('pattern_thresholds').$type<{
    rapidBetting?: {
      timeWindowSeconds?: number // Default: 60
      highThreshold?: number // Default: 5 bets
      criticalThreshold?: number // Default: 10 bets
    }
    unusualStake?: {
      highMultiplier?: number // Default: 3x
      criticalMultiplier?: number // Default: 5x
      historyLimit?: number // Default: 100 bets
    }
    coordinated?: {
      timeWindowSeconds?: number // Default: 300 (5 minutes)
      stakeTolerancePercent?: number // Default: 20%
      oddsTolerance?: number // Default: 0.1
      highThreshold?: number // Default: 3 bets
      criticalThreshold?: number // Default: 5 bets
    }
    highOdds?: {
      threshold?: number // Default: 10
    }
  }>(),
  
  // Risk level thresholds (optional - uses defaults if not provided)
  riskLevelThresholds: jsonb('risk_level_thresholds').$type<{
    high?: number // Default: 60
    medium?: number // Default: 35
    low?: number // Default: 15
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('risk_config_tenant_idx').on(table.tenant),
  eventIdx: index('risk_config_event_idx').on(table.eventId),
  uniqueEventConfig: uniqueIndex('risk_config_unique').on(table.whitelabelId, table.eventId),
}))

