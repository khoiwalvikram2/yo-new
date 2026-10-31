import { pgTable, uuid, varchar, timestamp, numeric, pgEnum, index, integer, jsonb, date, uniqueIndex } from 'drizzle-orm/pg-core'
import { matkas } from './matka'
import { users } from './users'
import { matkaWorliInstances, worliSessionSideEnum } from './matkaWorliInstances'

export const matkaBetStatusEnum = pgEnum('matka_bet_status', [
  'pending',
  'active',
  'won',
  'lost',
  'cancelled',
  'void',
])

export const matkaTypeEnum = pgEnum('matka_type', ['worli', 'starline', 'jackpot', 'sattaMatka'])

export const matkaBetBatches = pgTable('matka_bet_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id),
  matkaId: uuid('matka_id').notNull().references(() => matkas.id),
  requestKey: varchar('request_key', { length: 128 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  walletType: varchar('wallet_type', { length: 16 }).notNull(),
  totalStake: numeric('total_stake', { precision: 18, scale: 2 }).notNull(),
  runDate: date('run_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex('matka_bet_batches_request_unique').on(table.tenant, table.userId, table.requestKey)])

export const matkaBets = pgTable('matka_bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id), // References users.id

  // Matka references
  matkaId: uuid('matka_id').notNull().references(() => matkas.id),
  matkaType: matkaTypeEnum('matka_type').notNull(), // worli/starline/jackpot

  // Market details
  marketName: varchar('market_name', { length: 160 }).notNull(),
  marketSession: varchar('market_session', { length: 32 }), // morning/evening/open/close

  // Bet details
  bidType: varchar('bid_type', { length: 48 }).notNull(), // SINGLE/JODI/PANNA/etc
  betNumbers: varchar('bet_numbers', { length: 200 }).notNull(), // The numbers being bet on
  betAmount: numeric('bet_amount', { precision: 18, scale: 2 }).notNull(), // Bet amount

  // Payout and win amounts
  payoutMultiplier: numeric('payout_multiplier', { precision: 10, scale: 4 }).notNull(), // Payout multiplier
  potentialWin: numeric('potential_win', { precision: 18, scale: 2 }), // Potential win amount
  actualWin: numeric('actual_win', { precision: 18, scale: 2 }), // Actual win amount (if won)

  // Status and settlement
  status: matkaBetStatusEnum('status').notNull().default('pending'),
  result: varchar('result', { length: 64 }), // Result of the bet
  settledAt: timestamp('settled_at', { withTimezone: true }), // Settlement timestamp

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  // Worli running market linkage and selection normalization
  instanceId: uuid('instance_id').references(() => matkaWorliInstances.id),
  side: worliSessionSideEnum('side'),
  selectionKey: varchar('selection_key', { length: 200 }),
  selectionJson: jsonb('selection_json'),
  rulesVersionId: uuid('rules_version_id'),

  // Explicit trading date survives midnight and rollback/redeclaration.
  runDate: date('run_date'),
  batchId: uuid('batch_id').references(() => matkaBetBatches.id),
  walletType: varchar('wallet_type', { length: 16 }).notNull().default('cash'),
  settlementResultId: uuid('settlement_result_id'),
  bonusAwardId: integer('bonus_award_id'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('matka_bets_tenant_idx').on(table.tenant),
  index('matka_bets_result_scope_idx').on(table.tenant, table.matkaId, table.runDate, table.marketSession, table.status),
  index('matka_bets_batch_idx').on(table.batchId),
  index('matka_bets_whitelabel_idx').on(table.whitelabelId),
  index('matka_bets_matka_idx').on(table.matkaId),
  index('matka_bets_status_idx').on(table.status),
  index('matka_bets_created_idx').on(table.createdAt),
  index('matka_bets_user_status_idx').on(table.userId, table.status),
  // Serves the CRM player timeline: one player's rows, newest first, without sorting the whole history.
  index('matka_bets_user_created_idx').on(table.userId, table.createdAt),
  index('matka_bets_instance_created_idx').on(table.instanceId, table.createdAt),
  index('matka_bets_instance_status_idx').on(table.instanceId, table.status),
  index('matka_bets_instance_selection_idx').on(table.instanceId, table.selectionKey),
])

