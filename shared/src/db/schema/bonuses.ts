import { pgTable, serial, timestamp, varchar, uniqueIndex, index, numeric, integer, jsonb, pgEnum, boolean, text } from 'drizzle-orm/pg-core'

// Enums matching migration 0041
export const bonusAwardStatusEnum = pgEnum('bonus_award_status', ['pending', 'active', 'completed', 'expired', 'cancelled'])
export const bonusDomainEnum = pgEnum('bonus_domain', ['sports', 'casino', 'matka', 'global'])
export const bonusStatusEnum = pgEnum('bonus_status', ['draft', 'active', 'paused', 'ended'])
// Updated bonus types - all types (new + legacy for backward compatibility)
export const bonusTypeEnum = pgEnum('bonus_type', [
  'deposit', 'signup', 'direct_freebet', 'direct_free_spin', 'direct_amount', 'referral_deposit', 'losing_bonus', 'special',
  'daily_first_deposit',
  'deposit_match', 'cashback_loss', 'direct_event', 'free_bet', 'free_spins', 'casino_credit', 'loyalty', 'reload'
])
export const bonusCodeModeEnum = pgEnum('bonus_code_mode', ['auto', 'claim', 'code'])
export const bonusCodeStatusEnum = pgEnum('bonus_code_status', ['active', 'disabled', 'expired'])
export const bonusCreditStatusEnum = pgEnum('bonus_credit_status', ['active', 'redeemed', 'expired', 'cancelled'])
export const bonusCreditTypeEnum = pgEnum('bonus_credit_type', ['free_bet', 'free_spins', 'casino_credit'])
export const promotionStatusEnum = pgEnum('promotion_status', ['draft', 'active', 'paused', 'ended'])
export const releaseTypeEnum = pgEnum('release_type', ['bonus_amount_only', 'total_bonus_wallet'])

// New enums for bonus campaign system
export const distributionTypeEnum = pgEnum('distribution_type', ['instant_otp', 'instant_cash', 'roll_over'])
export const amountTypeEnum = pgEnum('amount_type', ['fixed', 'percentage'])
export const depositConditionTypeEnum = pgEnum('deposit_condition_type', ['greater_than', 'equal_to', 'less_than', 'greater_equal', 'less_equal'])

export const bonusCampaigns = pgTable('bonus_campaigns', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 256 }).notNull(),
  domain: bonusDomainEnum('domain').notNull().default('global'),
  type: bonusTypeEnum('type').notNull(),
  status: bonusStatusEnum('status').notNull().default('draft'),
  budgetNumeric: numeric('budget_numeric', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  rulesJson: jsonb('rules_json'),
  codeMode: bonusCodeModeEnum('code_mode').notNull().default('auto'),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validTo: timestamp('valid_to', { withTimezone: true }),
  limitsJson: jsonb('limits_json'),
  directSubType: varchar('direct_sub_type', { length: 64 }), // For direct bonus sub-types (freebet, free_spin, amount)
  depositConditionType: depositConditionTypeEnum('deposit_condition_type'),
  depositConditionAmount: numeric('deposit_condition_amount', { precision: 18, scale: 2 }),
  distributionType: distributionTypeEnum('distribution_type'),
  amountType: amountTypeEnum('amount_type'),
  amount: numeric('amount', { precision: 18, scale: 2 }),
  percentage: numeric('percentage', { precision: 6, scale: 2 }),
  numberOfPlayers: integer('number_of_players'),
  usagePerPlayer: integer('usage_per_player'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  wagering: numeric('wagering', { precision: 18, scale: 2 }),
  expiryBonusDays: integer('expiry_bonus_days'),
  depositRequired: boolean('deposit_required').default(false),
  releaseType: releaseTypeEnum('release_type'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  distributedAt: timestamp('distributed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('bonus_campaigns_tenant_idx').on(table.tenant),
  uniqueIndex('bonus_campaigns_id_tenant_unique').on(table.id, table.tenant),
])

export const bonusTiers = pgTable('bonus_tiers', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  minDeposit: numeric('min_deposit', { precision: 18, scale: 2 }).notNull().default('0'),
  bonusPct: numeric('bonus_pct', { precision: 6, scale: 2 }),
  maxBonus: numeric('max_bonus', { precision: 18, scale: 2 }),
  fixedAmount: numeric('fixed_amount', { precision: 18, scale: 2 }),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
}, (table) => [
  index('bonus_tiers_campaign_idx').on(table.campaignId),
])

export const bonusCodes = pgTable('bonus_codes', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  status: bonusCodeStatusEnum('status').notNull().default('active'),
  maxUses: integer('max_uses').default(0),
  usedCount: integer('used_count').default(0),
  perUserLimit: integer('per_user_limit').default(1),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('bonus_codes_campaign_idx').on(table.campaignId),
  uniqueIndex('bonus_codes_code_unique').on(table.code),
])

export const bonusAwards = pgTable('bonus_awards', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  userId: integer('user_id').notNull(),
  domain: bonusDomainEnum('domain').notNull().default('global'),
  type: bonusTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  wageringReq: numeric('wagering_req', { precision: 10, scale: 2 }).default('0'),
  currentWagering: numeric('current_wagering', { precision: 18, scale: 2 }).default('0'),
  status: bonusAwardStatusEnum('status').notNull().default('pending'),
  firstDepositRequired: boolean('first_deposit_required').default(false),
  firstDepositUnlocked: boolean('first_deposit_unlocked').default(false),
  awardedAt: timestamp('awarded_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  triggerAmount: numeric('trigger_amount', { precision: 18, scale: 2 }),
  /** Last admin/agent who changed status from admin panel (set status / activate / switch). */
  adminStatusUpdatedAt: timestamp('admin_status_updated_at', { withTimezone: true }),
  adminStatusUpdatedByName: varchar('admin_status_updated_by_name', { length: 256 }),
  adminStatusUpdatedByPhone: varchar('admin_status_updated_by_phone', { length: 32 }),
  adminStatusUpdatedByRemark: varchar('admin_status_updated_by_remark', { length: 512 }),
  /** Snapshot at grant time so campaign edits don't affect in-flight awards. */
  distributionType: distributionTypeEnum('distribution_type'),
  releaseType: releaseTypeEnum('release_type'),
}, (table) => [
  index('bonus_awards_campaign_idx').on(table.campaignId),
  // bonus_awards has no tenant column, so every tenant-scoped read arrives through the
  // campaign. The CRM day materialiser then filters on awarded_at, which without this
  // means re-reading every award a campaign ever made.
  index('bonus_awards_campaign_awarded_idx').on(table.campaignId, table.awardedAt),
  index('bonus_awards_user_idx').on(table.userId),
])

export const bonusCredits = pgTable('bonus_credits', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  userId: integer('user_id').notNull(),
  domain: bonusDomainEnum('domain').notNull(),
  creditType: bonusCreditTypeEnum('credit_type').notNull(),
  payloadJson: jsonb('payload_json'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  status: bonusCreditStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('bonus_credits_campaign_idx').on(table.campaignId),
  index('bonus_credits_user_idx').on(table.userId),
])

export const promotions = pgTable('promotions', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 256 }).notNull(),
  status: promotionStatusEnum('status').notNull().default('draft'),
  targetingJson: jsonb('targeting_json'),
  scheduleStart: timestamp('schedule_start', { withTimezone: true }),
  scheduleEnd: timestamp('schedule_end', { withTimezone: true }),
  contentJson: jsonb('content_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('promotions_tenant_idx').on(table.tenant),
  uniqueIndex('promotions_id_tenant_unique').on(table.id, table.tenant),
])

// Game Groups for Casino/Matka
export const gameGroupDomainEnum = pgEnum('game_group_domain', ['casino', 'matka'])

export const gameGroups = pgTable('game_groups', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 256 }).notNull(),
  domain: gameGroupDomainEnum('domain').notNull(),
  defaultWeight: integer('default_weight'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('game_groups_tenant_idx').on(table.tenant),
  index('game_groups_domain_idx').on(table.domain),
  uniqueIndex('game_groups_id_tenant_unique').on(table.id, table.tenant),
])

export const gameGroupMembers = pgTable('game_group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull(),
  memberId: varchar('member_id', { length: 256 }).notNull(), // casinoGameId or matkaMarketId
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('game_group_members_member_idx').on(table.memberId),
  uniqueIndex('game_group_members_group_member_unique').on(table.groupId, table.memberId),
])

export const bonusGroupWeights = pgTable('bonus_group_weights', {
  id: serial('id').primaryKey(),
  bonusId: integer('bonus_id').notNull(),
  groupId: integer('group_id').notNull(),
  weight: integer('weight').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('bonus_group_weights_group_idx').on(table.groupId),
  uniqueIndex('bonus_group_weights_bonus_group_unique').on(table.bonusId, table.groupId),
])

// Casino Game Bundles - reusable bundles of games (casino, sports, matka)
export const casinoGameBundles = pgTable('casino_game_bundles', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  name: varchar('name', { length: 256 }).notNull(),
  description: text('description'),
  domain: varchar('domain', { length: 20 }).notNull().default('casino'),
  gameIds: jsonb('game_ids').notNull(),
  gameWeights: jsonb('game_weights'),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('casino_game_bundles_tenant_idx').on(table.tenant),
  index('casino_game_bundles_domain_idx').on(table.domain),
  uniqueIndex('casino_game_bundles_name_tenant_unique').on(table.name, table.tenant),
])

