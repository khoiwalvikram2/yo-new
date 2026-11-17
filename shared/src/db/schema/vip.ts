import { pgTable, text, varchar, integer, timestamp, uuid, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { VipDepositPolicy } from '../../vip/depositPolicy.js'

export const vipTiersTable = pgTable('vip_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  name: varchar('name', { length: 120 }).notNull(),
  level: integer('level').notNull(),
  minMonthlyDeposit: integer('min_monthly_deposit').notNull(),
  color: varchar('color', { length: 16 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  depositPolicy: jsonb('deposit_policy').$type<VipDepositPolicy>().notNull().default({
    enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY', 'CRYPTO'], min: null, max: null, daily: null, monthly: null,
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  // migration 0020; createVIPTier also refuses a used level with a readable message
  uniqueIndex('vip_tiers_tenant_level_unique').on(table.tenant, table.level),
])

export const vipTierBenefitsTable = pgTable('vip_tier_benefits', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: uuid('tier_id').notNull().references(() => vipTiersTable.id),
  benefit: text('benefit').notNull(),
}, (table) => [
  index('vip_tier_benefits_tier_id_idx').on(table.tierId),
])

export const vipTierPerksTable = pgTable('vip_tier_perks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: uuid('tier_id').notNull().references(() => vipTiersTable.id),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description').notNull(),
  icon: varchar('icon', { length: 64 }),
}, (table) => [
  index('vip_tier_perks_tier_id_idx').on(table.tierId),
])

export const vipAuditTable = pgTable('vip_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Nullable on purpose. Rows written before this column existed cannot be
   * attributed to a whitelabel — the migration backfills what it can from
   * tier_id, and what it cannot stays null. A tenant-scoped read filters on an
   * exact match, so an unattributable row is simply not shown rather than shown
   * to everybody, which is what happened before.
   */
  tenant: varchar('tenant', { length: 64 }),
  actor: varchar('actor', { length: 64 }),
  action: varchar('action', { length: 64 }).notNull(),
  tierId: uuid('tier_id'),
  message: text('message').notNull(),
  at: timestamp('at').defaultNow().notNull(),
}, (table) => [
  index('vip_audit_tenant_at_idx').on(table.tenant, table.at),
])

export const vipMembersTable = pgTable('vip_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 64 }).notNull().default('default'),
  userId: varchar('user_id', { length: 64 }).notNull(),
  userName: varchar('user_name', { length: 120 }).notNull(),
  userEmail: varchar('user_email', { length: 160 }),
  tierId: uuid('tier_id').notNull().references(() => vipTiersTable.id),
  currentPoints: integer('current_points').notNull().default(0),
  lifetimePoints: integer('lifetime_points').notNull().default(0),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  lastActivityAt: timestamp('last_activity_at').defaultNow(),
  status: varchar('status', { length: 16 }).notNull().default('active')
}, (table) => [
  index('vip_members_tier_id_idx').on(table.tierId),
  // One membership per player per whitelabel. ensureVipMember reads-then-inserts, so
  // two concurrent first deposits could otherwise create two rows and split a
  // player's points between them.
  uniqueIndex('vip_members_tenant_user_unique').on(table.tenant, table.userId),
])

export const vipMemberHistoryTable = pgTable('vip_member_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => vipMembersTable.id),
  fromTierId: uuid('from_tier_id'),
  toTierId: uuid('to_tier_id').notNull().references(() => vipTiersTable.id),
  reason: text('reason').notNull(),
  pointsAtChange: integer('points_at_change').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('vip_member_history_to_tier_id_idx').on(table.toTierId),
  index('vip_member_history_member_id_idx').on(table.memberId),
])

export const vipTransactionsTable = pgTable('vip_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id').notNull().references(() => vipMembersTable.id),
  depositRequestId: integer('deposit_request_id'),
  type: varchar('type', { length: 16 }).notNull(),
  points: integer('points').notNull(),
  description: text('description').notNull(),
  balanceBefore: integer('balance_before').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('vip_transactions_member_id_idx').on(table.memberId),
  uniqueIndex('vip_transactions_deposit_request_unique').on(table.depositRequestId).where(sql`${table.depositRequestId} IS NOT NULL`),
])

