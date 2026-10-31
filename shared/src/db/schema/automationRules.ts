import { pgTable, uuid, varchar, timestamp, jsonb, pgEnum, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sportsEventsTable } from './sportsContent'

export const automationRuleTypeEnum = pgEnum('automation_rule_type', [
  'AUTO_VOID',
  'AUTO_SUSPEND',
  'MARKET_MAKER',
])

export const automationRulesTable = pgTable('automation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  eventId: uuid('event_id').references(() => sportsEventsTable.id), // nullable for global rules
  
  ruleType: automationRuleTypeEnum('rule_type').notNull(),
  
  // Configuration stored as JSONB
  // Structure: { triggers: {...}, actions: [...], cooldown: number, notifications: {...} }
  config: jsonb('config').$type<{
    triggers?: {
      stakeThreshold?: number
      patternTypes?: string[]
      riskLevel?: string
      lossStreak?: number
      bookBalanceThreshold?: number
      [key: string]: any
    }
    actions?: Array<{
      type: string
      reason?: string
      limitType?: string
      value?: number
      message?: string
      [key: string]: any
    }>
    cooldown?: number
    notifications?: {
      enabled?: boolean
      channels?: string[]
    }
  }>(),
  
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(0), // Higher priority = evaluated first
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('automation_rules_tenant_idx').on(table.tenant),
  whitelabelIdx: index('automation_rules_wl_idx').on(table.whitelabelId),
  eventIdx: index('automation_rules_event_idx').on(table.eventId),
  ruleTypeIdx: index('automation_rules_type_idx').on(table.ruleType),
  enabledIdx: index('automation_rules_enabled_idx').on(table.enabled),
  priorityIdx: index('automation_rules_priority_idx').on(table.priority),
}))

