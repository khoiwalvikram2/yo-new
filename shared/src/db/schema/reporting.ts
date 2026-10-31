import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  date,
  numeric,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  unique,
  text,
  boolean,
} from 'drizzle-orm/pg-core';
import { sportsTable } from './sports';
import { sportsLeaguesTable } from './sportsContent';
import { sportsEventsTable } from './sportsContent';
import { agents } from './agents';
import { bonusCampaigns } from './bonuses';
import { users } from './users';

// Domain enum for reporting snapshots
export const reportingDomainEnum = pgEnum('reporting_domain', [
  'sports',
  'casino',
  'matka',
  'agents',
  'bonuses',
  'global',
]);

// Daily snapshot table for aggregated reporting data
export const reportingDailySnapshots = pgTable('reporting_daily_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
  domain: reportingDomainEnum('domain').notNull(),

  // Dimension fields (for drilldowns)
  sportId: uuid('sport_id'),
  leagueId: uuid('league_id'),
  eventId: uuid('event_id'),
  agentId: uuid('agent_id'),
  campaignId: integer('campaign_id'),
  playerId: integer('player_id').references(() => users.id),

  // Metrics
  totalStakes: numeric('total_stakes', { precision: 18, scale: 2 }).notNull().default('0'),
  totalPayouts: numeric('total_payouts', { precision: 18, scale: 2 }).notNull().default('0'),
  totalExposure: numeric('total_exposure', { precision: 18, scale: 2 }).notNull().default('0'),
  totalLiquidity: numeric('total_liquidity', { precision: 18, scale: 2 }).notNull().default('0'),
  grossGamingRevenue: numeric('ggr', { precision: 18, scale: 2 }).notNull().default('0'),
  netRevenue: numeric('net_revenue', { precision: 18, scale: 2 }).notNull().default('0'),
  holdPercentage: numeric('hold_percentage', { precision: 6, scale: 4 }), // 0..1
  betCount: integer('bet_count').notNull().default(0),
  playerCount: integer('player_count').notNull().default(0),
  activePlayerCount: integer('active_player_count').notNull().default(0),

  // Agent-specific metrics
  agentCommission: numeric('agent_commission', { precision: 18, scale: 2 }).default('0'),
  agentShare: numeric('agent_share', { precision: 18, scale: 2 }).default('0'),
  downlineCount: integer('downline_count').default(0),

  // Bonus-specific metrics
  bonusIssued: numeric('bonus_issued', { precision: 18, scale: 2 }).default('0'),
  bonusRedeemed: numeric('bonus_redeemed', { precision: 18, scale: 2 }).default('0'),
  bonusLiability: numeric('bonus_liability', { precision: 18, scale: 2 }).default('0'),
  bonusROI: numeric('bonus_roi', { precision: 6, scale: 4 }), // 0..1

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  // Additional metadata
  metadata: jsonb('metadata'), // For flexible additional metrics

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reporting_snapshots_whitelabel_idx').on(table.whitelabelId),
  index('reporting_snapshots_date_idx').on(table.snapshotDate),
  index('reporting_snapshots_domain_idx').on(table.domain),
  index('reporting_snapshots_sport_idx').on(table.sportId),
  index('reporting_snapshots_league_idx').on(table.leagueId),
  index('reporting_snapshots_event_idx').on(table.eventId),
  index('reporting_snapshots_agent_idx').on(table.agentId),
  index('reporting_snapshots_campaign_idx').on(table.campaignId),
  index('reporting_snapshots_player_idx').on(table.playerId),
  // Unique key for one snapshot row per (tenant, wl, date, domain, dimensions).
  // MUST be NULLS NOT DISTINCT: the dimension columns (sport/league/event/agent/campaign/player)
  // are NULL for the per-domain "overall" row. With the default NULLS DISTINCT, Postgres treats
  // two such NULL-bearing rows as different, so onConflictDoUpdate never matches and every
  // snapshot run INSERTS a duplicate -> inflated GGR/turnover. Declared as a unique constraint
  // (not uniqueIndex) because only the constraint builder can emit NULLS NOT DISTINCT, so a
  // `drizzle-kit push` will keep the fix instead of reverting it.
  unique('reporting_snapshots_unique').on(
    table.tenant,
    table.whitelabelId,
    table.snapshotDate,
    table.domain,
    table.sportId,
    table.leagueId,
    table.eventId,
    table.agentId,
    table.campaignId,
    table.playerId,
  ).nullsNotDistinct(),
]);

// Agent performance rollup table (for hierarchy reporting)
export const reportingAgentRollups = pgTable('reporting_agent_rollups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  domain: varchar('domain', { length: 24 }).notNull(), // sports | casino | matka

  // Rollup metrics
  totalTurnover: numeric('total_turnover', { precision: 18, scale: 2 }).notNull().default('0'),
  totalGGR: numeric('total_ggr', { precision: 18, scale: 2 }).notNull().default('0'),
  commissionEarned: numeric('commission_earned', { precision: 18, scale: 2 }).notNull().default('0'),
  shareEarned: numeric('share_earned', { precision: 18, scale: 2 }).notNull().default('0'),
  downlineTurnover: numeric('downline_turnover', { precision: 18, scale: 2 }).notNull().default('0'),
  downlineGGR: numeric('downline_ggr', { precision: 18, scale: 2 }).notNull().default('0'),
  playerCount: integer('player_count').notNull().default(0),
  activePlayerCount: integer('active_player_count').notNull().default(0),
  betCount: integer('bet_count').notNull().default(0),

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reporting_agent_rollups_whitelabel_idx').on(table.whitelabelId),
  index('reporting_agent_rollups_agent_idx').on(table.agentId),
  index('reporting_agent_rollups_period_idx').on(table.periodFrom, table.periodTo),
  index('reporting_agent_rollups_domain_idx').on(table.domain),
  uniqueIndex('reporting_agent_rollups_unique').on(
    table.tenant,
    table.whitelabelId,
    table.agentId,
    table.periodFrom,
    table.periodTo,
    table.domain,
  ),
]);

// Bonus liability ledger (for bonus reporting)
export const reportingBonusLedgers = pgTable('reporting_bonus_ledgers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  campaignId: integer('campaign_id').notNull().references(() => bonusCampaigns.id, { onDelete: 'cascade' }),
  ledgerDate: timestamp('ledger_date', { withTimezone: true }).notNull(),

  // Bonus metrics
  issuedAmount: numeric('issued_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  redeemedAmount: numeric('redeemed_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  expiredAmount: numeric('expired_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  cancelledAmount: numeric('cancelled_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  outstandingLiability: numeric('outstanding_liability', { precision: 18, scale: 2 }).notNull().default('0'),
  totalWagering: numeric('total_wagering', { precision: 18, scale: 2 }).notNull().default('0'),
  totalRevenue: numeric('total_revenue', { precision: 18, scale: 2 }).notNull().default('0'),
  awardCount: integer('award_count').notNull().default(0),
  redemptionCount: integer('redemption_count').notNull().default(0),
  playerCount: integer('player_count').notNull().default(0),

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reporting_bonus_ledgers_whitelabel_idx').on(table.whitelabelId),
  index('reporting_bonus_ledgers_campaign_idx').on(table.campaignId),
  index('reporting_bonus_ledgers_date_idx').on(table.ledgerDate),
  uniqueIndex('reporting_bonus_ledgers_unique').on(
    table.tenant,
    table.whitelabelId,
    table.campaignId,
    table.ledgerDate,
  ),
]);

// Saved reports (for admin users to save favorite report configurations)
export const reportingSavedReports = pgTable('reporting_saved_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  createdBy: integer('created_by').notNull(), // Admin user ID
  name: varchar('name', { length: 256 }).notNull(),
  description: varchar('description', { length: 512 }),
  reportType: varchar('report_type', { length: 64 }).notNull(), // sports_overview, casino_overview, etc.
  filtersJson: jsonb('filters_json').notNull(), // Saved filter configuration
  isPinned: boolean('is_pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reporting_saved_reports_tenant_idx').on(table.tenant),
  index('reporting_saved_reports_whitelabel_idx').on(table.whitelabelId),
  index('reporting_saved_reports_created_by_idx').on(table.createdBy),
  index('reporting_saved_reports_type_idx').on(table.reportType),
]);

// Report export jobs (for tracking export/schedule jobs)
export const reportingExportJobs = pgTable('reporting_export_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  createdBy: integer('created_by').notNull(), // Admin user ID
  reportType: varchar('report_type', { length: 64 }).notNull(),
  filtersJson: jsonb('filters_json').notNull(),
  exportFormat: varchar('export_format', { length: 16 }).notNull(), // CSV, XLSX, PDF
  status: varchar('status', { length: 24 }).notNull().default('pending'), // pending, processing, completed, failed
  fileUrl: varchar('file_url', { length: 512 }),
  fileData: text('file_data'), // base64 data URI of the generated export; populated in a later plan
  errorMessage: text('error_message'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('reporting_export_jobs_tenant_idx').on(table.tenant),
  index('reporting_export_jobs_whitelabel_idx').on(table.whitelabelId),
  index('reporting_export_jobs_created_by_idx').on(table.createdBy),
  index('reporting_export_jobs_status_idx').on(table.status),
  index('reporting_export_jobs_scheduled_idx').on(table.scheduledAt),
]);

/** Coarse snapshot pipeline run (scheduler tick, backfill batch, manual). */
export const reportingSnapshotRuns = pgTable('reporting_snapshot_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  trigger: varchar('trigger', { length: 32 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  summaryJson: jsonb('summary_json'),
  errorMessage: text('error_message'),
}, (table) => [
  index('reporting_snapshot_runs_started_idx').on(table.startedAt),
  index('reporting_snapshot_runs_trigger_idx').on(table.trigger),
  index('reporting_snapshot_runs_status_idx').on(table.status),
]);

/** Fine-grained snapshot audit line for admin / director UI. */
export const reportingSnapshotEvents = pgTable('reporting_snapshot_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => reportingSnapshotRuns.id, { onDelete: 'set null' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  level: varchar('level', { length: 8 }).notNull().default('info'),
  eventType: varchar('event_type', { length: 48 }).notNull(),
  tenant: varchar('tenant', { length: 128 }),
  whitelabelId: varchar('whitelabel_id', { length: 64 }),
  currency: varchar('currency', { length: 8 }),
  reportingDay: date('reporting_day'),
  snapshotDateUtc: timestamp('snapshot_date_utc', { withTimezone: true }),
  domain: varchar('domain', { length: 24 }),
  pgBossJobId: varchar('pg_boss_job_id', { length: 64 }),
  singletonKey: varchar('singleton_key', { length: 256 }),
  message: text('message'),
  detailJson: jsonb('detail_json'),
}, (table) => [
  index('reporting_snapshot_events_occurred_idx').on(table.occurredAt),
  index('reporting_snapshot_events_tenant_wl_idx').on(table.tenant, table.whitelabelId, table.occurredAt),
  index('reporting_snapshot_events_type_level_idx').on(table.eventType, table.level),
  index('reporting_snapshot_events_run_idx').on(table.runId),
]);

