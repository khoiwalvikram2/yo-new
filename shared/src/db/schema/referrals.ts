import { pgTable, serial, timestamp, varchar, uniqueIndex, index, numeric, integer, jsonb, pgEnum, boolean, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Enums for referral system
export const referralRuleTypeEnum = pgEnum('referral_rule_type', [
  'SIGNUP_CPA',
  'FIRST_DEPOSIT_PCT',
  'RELOAD_DEPOSITS_PCT',
  'REVSHARE',
  'LOSS_SHARE',
  'TURNOVER_MILESTONE',
  // Deprecated but kept for migration compatibility
  'DEPOSITS_WINDOW_PCT',
  'ACTIVITY_MILESTONE',
  'LADDER',
  'CASHBACK_SHARE',
  'COUPON',
  'RAFFLE',
  'HYBRID',
])

export const referralAttributionModelEnum = pgEnum('referral_attribution_model', [
  'LAST_CLICK',
  'FIRST_CLICK',
  'LINEAR',
  'TIME_DECAY',
])

export const referralAttributionStatusEnum = pgEnum('referral_attribution_status', [
  'pending',
  'confirmed',
  'rejected',
  'reattributed',
])

export const referralPayoutTypeEnum = pgEnum('referral_payout_type', [
  'CASH',
  'BONUS',
  'SPLIT',
])

export const referralSettlementStatusEnum = pgEnum('referral_settlement_status', [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
])

export const referralEscrowStatusEnum = pgEnum('referral_escrow_status', [
  'none',
  'pending_kyc',
  'pending_fraud_check',
  'released',
  'held',
])

export const referralCouponStatusEnum = pgEnum('referral_coupon_status', [
  'active',
  'used',
  'expired',
  'cancelled',
])

export const referralRaffleDrawStatusEnum = pgEnum('referral_raffle_draw_status', [
  'scheduled',
  'running',
  'completed',
  'cancelled',
])

// Referral Programs (per-tenant configuration)
export const referralPrograms = pgTable('referral_programs', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 256 }).notNull(),
  enabledModes: jsonb('enabled_modes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  maxDepth: integer('max_depth').notNull().default(4), // Changed default to 4 for max 4 tiers
  // Deprecated fields - kept for migration compatibility but not used
  attributionModel: referralAttributionModelEnum('attribution_model').notNull().default('LAST_CLICK'),
  attributionWindowDays: integer('attribution_window_days').notNull().default(30),
  depositsWindowDays: integer('deposits_window_days').notNull().default(30),
  negativeCarryover: boolean('negative_carryover').notNull().default(false),
  flags: jsonb('flags').$type<Record<string, boolean>>().default(sql`'{}'::jsonb`),
  minReferralBalanceForCashTransfer: numeric('min_referral_balance_for_cash_transfer', { precision: 18, scale: 2 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_programs_tenant_idx').on(table.tenant),
  uniqueIndex('referral_programs_id_tenant_unique').on(table.id, table.tenant),
])

// Referral Rules (reward configurations)
export const referralRules = pgTable('referral_rules', {
  id: serial('id').primaryKey(),
  programId: integer('program_id').notNull(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  ruleType: referralRuleTypeEnum('rule_type').notNull(),
  tierRates: jsonb('tier_rates').$type<Record<number, number>>().notNull().default(sql`'{}'::jsonb`), // { 1: 10, 2: 5, ... } percentage (only for LOSS_SHARE)
  fixedAmounts: jsonb('fixed_amounts').$type<Record<number, number>>().default(sql`'{}'::jsonb`), // { 1: 100, 2: 50, ... } for CPA
  caps: jsonb('caps').$type<{ perReferee?: number; perReferrer?: number; daily?: number; monthly?: number }>().default(sql`'{}'::jsonb`),
  thresholds: jsonb('thresholds').$type<{ minDeposit?: number; minBets?: number; minNetDeposit?: number; turnoverTarget?: number }>().default(sql`'{}'::jsonb`),
  payoutType: referralPayoutTypeEnum('payout_type').notNull().default('CASH'),
  splitRatio: jsonb('split_ratio').$type<{ cash: number; bonus: number }>().default(sql`'{"cash": 100, "bonus": 0}'::jsonb`),
  escrow: jsonb('escrow').$type<{ untilKyc: boolean; untilFraudClear: boolean }>().default(sql`'{"untilKyc": false, "untilFraudClear": false}'::jsonb`),
  configJson: jsonb('config_json').$type<Record<string, any>>().default(sql`'{}'::jsonb`), // Rule-specific config
  reloadDepositsCount: integer('reload_deposits_count'), // For RELOAD_DEPOSITS_PCT: number of last deposits to consider (0=unlimited, 1-30)
  reloadMinDeposit: integer('reload_min_deposit'), // For RELOAD_DEPOSITS_PCT: minimum deposit amount required to trigger bonus (0 or null = no minimum)
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_rules_program_idx').on(table.programId),
  uniqueIndex('referral_rules_tenant_rule_type_unique').on(table.tenant, table.ruleType),
])

// Referral Links (per-user or per-agent referral codes/links)
export const referralLinks = pgTable('referral_links', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id'), // Made nullable - either userId or agentId must be set
  agentId: uuid('agent_id'), // NEW: Optional agent ID for agent referral links
  code: varchar('code', { length: 64 }).notNull(),
  qrCodeUrl: varchar('qr_code_url', { length: 512 }),
  utmParams: jsonb('utm_params').$type<Record<string, string>>().default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_links_tenant_idx').on(table.tenant),
  index('referral_links_agent_id_idx').on(table.agentId), // NEW: Index for agent lookups
  uniqueIndex('referral_links_code_unique').on(table.code),
  uniqueIndex('referral_links_user_tenant_unique').on(table.userId, table.tenant),
  // NOTE: Unique constraint for agentId+tenant is created via migration with WHERE agent_id IS NOT NULL
  // Drizzle doesn't support partial unique indexes, so we handle this in the SQL migration
  // uniqueIndex('referral_links_agent_tenant_unique').on(table.agentId, table.tenant), // REMOVED - handled by migration
])

// Referral Clicks (click tracking)
export const referralClicks = pgTable('referral_clicks', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  linkId: integer('link_id').notNull(),
  referrerId: integer('referrer_id').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 512 }),
  utmSource: varchar('utm_source', { length: 128 }),
  utmMedium: varchar('utm_medium', { length: 128 }),
  utmCampaign: varchar('utm_campaign', { length: 128 }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_clicks_tenant_idx').on(table.tenant),
  index('referral_clicks_link_idx').on(table.linkId),
  index('referral_clicks_referrer_idx').on(table.referrerId),
  index('referral_clicks_clicked_at_idx').on(table.clickedAt),
])

// Referral Attributions (who referred whom)
export const referralAttributions = pgTable('referral_attributions', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  referrerId: integer('referrer_id').notNull(),
  refereeId: integer('referee_id').notNull(),
  tier: integer('tier').notNull().default(1), // 1 = direct, 2 = indirect, etc.
  clickId: integer('click_id'), // Link to referral_clicks
  status: referralAttributionStatusEnum('status').notNull().default('pending'),
  reason: varchar('reason', { length: 512 }),
  reattributedFrom: integer('reattributed_from'), // If reattributed, link to old attribution
  attributedAt: timestamp('attributed_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
}, (table) => [
  index('referral_attributions_tenant_idx').on(table.tenant),
  index('referral_attributions_referrer_idx').on(table.referrerId),
  index('referral_attributions_tier_idx').on(table.tier),
  uniqueIndex('referral_attributions_referee_unique').on(table.refereeId), // One attribution per referee
])

// Referral Earnings (calculated earnings per event)
export const referralEarnings = pgTable('referral_earnings', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  attributionId: integer('attribution_id').notNull(),
  ruleId: integer('rule_id').notNull(),
  referrerId: integer('referrer_id').notNull(),
  refereeId: integer('referee_id').notNull(),
  tier: integer('tier').notNull(),
  ruleType: referralRuleTypeEnum('rule_type').notNull(),
  grossAmount: numeric('gross_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  netAmount: numeric('net_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  eventData: jsonb('event_data').$type<Record<string, any>>().default(sql`'{}'::jsonb`), // Deposit amount, bet details, etc.
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_earnings_tenant_idx').on(table.tenant),
  index('referral_earnings_attribution_idx').on(table.attributionId),
  index('referral_earnings_rule_idx').on(table.ruleId),
  index('referral_earnings_referrer_idx').on(table.referrerId),
  index('referral_earnings_referee_idx').on(table.refereeId),
])

// Referral Settlements (payout ledger)
export const referralSettlements = pgTable('referral_settlements', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  earningId: integer('earning_id').notNull(),
  referrerId: integer('referrer_id').notNull(),
  payoutType: referralPayoutTypeEnum('payout_type').notNull(),
  cashAmount: numeric('cash_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  bonusAmount: numeric('bonus_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  status: referralSettlementStatusEnum('status').notNull().default('pending'),
  escrowStatus: referralEscrowStatusEnum('escrow_status').notNull().default('none'),
  walletTransactionId: integer('wallet_transaction_id'), // Link to ledger_entries
  bonusAwardId: integer('bonus_award_id'), // Link to bonus_awards if payoutType is BONUS or SPLIT
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_settlements_tenant_idx').on(table.tenant),
  index('referral_settlements_earning_idx').on(table.earningId),
  index('referral_settlements_referrer_idx').on(table.referrerId),
  index('referral_settlements_status_idx').on(table.status),
])

// Referral Budgets (daily/monthly caps per tenant/program)
export const referralBudgets = pgTable('referral_budgets', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  programId: integer('program_id'),
  budgetType: varchar('budget_type', { length: 16 }).notNull(), // 'daily' | 'monthly'
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  spent: numeric('spent', { precision: 18, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_budgets_tenant_idx').on(table.tenant),
  index('referral_budgets_program_idx').on(table.programId),
  index('referral_budgets_period_idx').on(table.periodStart, table.periodEnd),
])

// Referral Raffle Entries
export const referralRaffleEntries = pgTable('referral_raffle_entries', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  ruleId: integer('rule_id').notNull(),
  referrerId: integer('referrer_id'),
  refereeId: integer('referee_id'),
  entries: integer('entries').notNull().default(1),
  reason: varchar('reason', { length: 256 }), // 'signup', 'first_deposit', 'milestone', etc.
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_raffle_entries_tenant_idx').on(table.tenant),
  index('referral_raffle_entries_rule_idx').on(table.ruleId),
  index('referral_raffle_entries_referrer_idx').on(table.referrerId),
  index('referral_raffle_entries_referee_idx').on(table.refereeId),
])

// Referral Raffle Draws
export const referralRaffleDraws = pgTable('referral_raffle_draws', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  ruleId: integer('rule_id').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  drawnAt: timestamp('drawn_at', { withTimezone: true }),
  status: referralRaffleDrawStatusEnum('status').notNull().default('scheduled'),
  winners: jsonb('winners').$type<Array<{ userId: number; prize: number; currency: string }>>().default(sql`'[]'::jsonb`),
  totalEntries: integer('total_entries').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_raffle_draws_tenant_idx').on(table.tenant),
  index('referral_raffle_draws_rule_idx').on(table.ruleId),
  index('referral_raffle_draws_scheduled_at_idx').on(table.scheduledAt),
])

// Referral Coupons (issued voucher codes)
export const referralCoupons = pgTable('referral_coupons', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  ruleId: integer('rule_id').notNull(),
  referrerId: integer('referrer_id'),
  refereeId: integer('referee_id'),
  couponCode: varchar('coupon_code', { length: 64 }).notNull(),
  bonusCampaignId: integer('bonus_campaign_id'), // Link to bonus_campaigns
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  status: referralCouponStatusEnum('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('referral_coupons_tenant_idx').on(table.tenant),
  index('referral_coupons_rule_idx').on(table.ruleId),
  index('referral_coupons_referrer_idx').on(table.referrerId),
  index('referral_coupons_referee_idx').on(table.refereeId),
  uniqueIndex('referral_coupons_code_unique').on(table.couponCode),
])

