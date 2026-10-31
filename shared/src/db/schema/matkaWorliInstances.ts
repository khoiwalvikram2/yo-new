import { pgTable, uuid, date, timestamp, text, integer, bigint, pgEnum, uniqueIndex, index, varchar } from 'drizzle-orm/pg-core'
import { matkas } from './matka'

export const worliSessionSideEnum = pgEnum('worli_session_side', ['OPEN', 'CLOSE'])
export const worliStatusEnum = pgEnum('worli_status', [
  'SCHEDULED',
  'OPENING_SOON',
  'OPEN',
  'LOCKED',
  'CLOSED',
  'SETTLING',
  'SETTLED',
  'PAUSED',
  'VOIDED',
])

export const matkaWorliInstances = pgTable('matka_worli_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  marketId: uuid('market_id').notNull().references(() => matkas.id),
  runDate: date('run_date').notNull(),
  side: worliSessionSideEnum('side').notNull(),

  status: worliStatusEnum('status').notNull().default('SCHEDULED'),

  scheduledOpenAtUtc: timestamp('scheduled_open_at_utc', { withTimezone: true }).notNull(),
  scheduledLockAtUtc: timestamp('scheduled_lock_at_utc', { withTimezone: true }).notNull(),
  scheduledCloseAtUtc: timestamp('scheduled_close_at_utc', { withTimezone: true }).notNull(),

  actualOpenAtUtc: timestamp('actual_open_at_utc', { withTimezone: true }),
  actualLockAtUtc: timestamp('actual_lock_at_utc', { withTimezone: true }),
  actualCloseAtUtc: timestamp('actual_close_at_utc', { withTimezone: true }),

  suspendMinutesOverride: integer('suspend_minutes_override'),
  operatorMessage: text('operator_message'),

  totalStakeMinor: bigint('total_stake_minor', { mode: 'bigint' }).notNull(),
  betCount: integer('bet_count').notNull().default(0),
  exposureTotalMinor: bigint('exposure_total_minor', { mode: 'bigint' }).notNull(),
  worstOutcomeKey: text('worst_outcome_key'),
  worstOutcomePlMinor: bigint('worst_outcome_pl_minor', { mode: 'bigint' }),

  resultValue: text('result_value'),
  resultPublishedAtUtc: timestamp('result_published_at_utc', { withTimezone: true }),
  resultActorId: varchar('result_actor_id', { length: 64 }),

  bidRulesVersionId: uuid('bid_rules_version_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqMarketDateSide: uniqueIndex('u_worli_market_date_side').on(t.marketId, t.runDate, t.side),
  byMarketStatus: index('i_worli_market_status').on(t.marketId, t.status),
  byCloseTime: index('i_worli_close_time').on(t.scheduledCloseAtUtc),
}))

export const matkaActivityLogs = pgTable('matka_activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').notNull().references(() => matkaWorliInstances.id),
  actorId: varchar('actor_id', { length: 64 }).notNull(),
  action: text('action').notNull(),
  reason: text('reason'),
  metaJson: text('meta_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byInstance: index('i_matka_activity_instance').on(t.instanceId),
}))

