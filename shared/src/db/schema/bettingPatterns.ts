import { pgTable, uuid, varchar, timestamp, jsonb, pgEnum, index, integer } from 'drizzle-orm/pg-core'
import { users } from './users'
import { sportsEventsTable } from './sportsContent'

export const bettingPatternTypeEnum = pgEnum('betting_pattern_type', [
  'RAPID_BETTING',
  'MULTI_ACCOUNT',
  'COORDINATED',
  'UNUSUAL_STAKE',
  'ODD_TIMING',
  'AGENT_COLLUSION',
  'HIGH_ODDS',
])

export const patternSeverityEnum = pgEnum('pattern_severity', [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
])

export const patternStatusEnum = pgEnum('pattern_status', [
  'DETECTED',
  'INVESTIGATING',
  'CONFIRMED',
  'DISMISSED',
])

export const bettingPatternsTable = pgTable('betting_patterns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id),
  eventId: uuid('event_id').references(() => sportsEventsTable.id),
  
  patternType: bettingPatternTypeEnum('pattern_type').notNull(),
  severity: patternSeverityEnum('severity').notNull(),
  
  // Metrics stored as JSONB (e.g., { betCount: 5, timeWindow: 60, stakeRatio: 5.2 })
  metrics: jsonb('metrics').$type<Record<string, any>>(),
  
  status: patternStatusEnum('status').notNull().default('DETECTED'),
  notes: varchar('notes', { length: 1024 }),
  
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('betting_patterns_tenant_idx').on(table.tenant),
  whitelabelIdx: index('betting_patterns_wl_idx').on(table.whitelabelId),
  userIdx: index('betting_patterns_user_idx').on(table.userId),
  eventIdx: index('betting_patterns_event_idx').on(table.eventId),
  patternTypeIdx: index('betting_patterns_type_idx').on(table.patternType),
  severityIdx: index('betting_patterns_severity_idx').on(table.severity),
  statusIdx: index('betting_patterns_status_idx').on(table.status),
  detectedAtIdx: index('betting_patterns_detected_at_idx').on(table.detectedAt),
}))

