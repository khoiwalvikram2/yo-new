import { pgTable, uuid, varchar, timestamp, numeric, pgEnum, integer, index, uniqueIndex, jsonb, boolean } from 'drizzle-orm/pg-core'
import { casinoVendors, casinoGames, casinoApiProviders } from './casino'
import { users } from './users'
import { bonusAwards } from './bonuses'

export const casinoBetStatusEnum = pgEnum('casino_bet_status', [
  'pending',
  'active',
  'won',
  'lost',
  'cancelled',
  'void',
])

export const casinoBets = pgTable('casino_bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id), // References users.id

  // Casino game references
  gameId: integer('game_id').notNull().references(() => casinoGames.id),
  gameName: varchar('game_name', { length: 200 }),
  providerId: integer('provider_id').references(() => casinoApiProviders.id), // References casino_api_providers.id
  sessionId: varchar('session_id', { length: 128 }), // Game session ID

  // Vendor references
  vendorId: integer('vendor_id').notNull().references(() => casinoVendors.id),
  vendorName: varchar('vendor_name', { length: 120 }).notNull(), // Denormalized from casino_vendors.name

  // Table ID (optional, for live casino)
  tableId: varchar('table_id', { length: 200 }), // Optional, for live casino tables

  // Bet amounts
  stake: numeric('stake', { precision: 18, scale: 2 }).notNull(), // Stake amount
  payout: numeric('payout', { precision: 18, scale: 2 }), // Payout amount
  winAmount: numeric('win_amount', { precision: 18, scale: 2 }), // Win amount
  netAmount: numeric('net_amount', { precision: 18, scale: 2 }), // Net amount (winAmount - stake)

  // Status and settlement
  status: casinoBetStatusEnum('status').notNull().default('pending'),
  gameRoundId: varchar('game_round_id', { length: 128 }), // Round ID from game provider
  transactionId: varchar('transaction_id', { length: 128 }), // Transaction ID from provider
  resultTransactionId: varchar('result_transaction_id', { length: 128 }), // Provider result txn id (idempotency)
  rollbackTransactionId: varchar('rollback_transaction_id', { length: 128 }), // Provider rollback txn id (idempotency)
  settledAt: timestamp('settled_at', { withTimezone: true }), // Settlement timestamp

  // Wallet and bonus (for cash vs bonus debit/credit and wagering attribution)
  walletType: varchar('wallet_type', { length: 16 }).notNull().default('cash'), // 'cash' | 'bonus' | 'referralBonus'
  bonusAwardId: integer('bonus_award_id').references(() => bonusAwards.id), // Optional: which award this bet counts toward for wagering

  // Currency
  currency: varchar('currency', { length: 8 }).notNull().default('USD'),

  // Metadata for game-specific data
  metadata: jsonb('metadata'), // JSONB for flexible game-specific data

  /** When true, open bet is omitted from admin running / live exposure views (bet-tool / integration). */
  excludeFromAdminRunning: boolean('exclude_from_admin_running').notNull().default(false),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('casino_bets_provider_id_idx').on(table.providerId),
  index('casino_bets_bonus_award_id_idx').on(table.bonusAwardId),
  index('casino_bets_tenant_idx').on(table.tenant),
  index('casino_bets_whitelabel_idx').on(table.whitelabelId),
  index('casino_bets_game_idx').on(table.gameId),
  index('casino_bets_vendor_idx').on(table.vendorId),
  index('casino_bets_table_idx').on(table.tableId),
  index('casino_bets_status_idx').on(table.status),
  index('casino_bets_created_idx').on(table.createdAt),
  index('casino_bets_user_status_idx').on(table.userId, table.status),
  // Serves the CRM player timeline: one player's rows, newest first, without sorting the whole history.
  index('casino_bets_user_created_idx').on(table.userId, table.createdAt),
  // DB-level idempotency on bet PLACEMENT: prevents racing duplicate provider debit
  // callbacks from creating two bet rows for the same (user_id, transaction_id).
  // NOTE: the live DB index (migration 0085) is PARTIAL — it carries a
  // `WHERE transaction_id IS NOT NULL` predicate that drizzle's index builder cannot
  // express here. The DB constraint is authoritative; this declaration is schema
  // parity / documentation only. Do NOT add uniqueness on result_transaction_id or
  // rollback_transaction_id (they legitimately repeat across bets within a round).
  uniqueIndex('casino_bets_user_transaction_key').on(table.userId, table.transactionId),
])

