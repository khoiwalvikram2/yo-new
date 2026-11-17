import { pgTable, serial, varchar, integer, numeric, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'

/**
 * Idempotency receipts for casino provider callbacks that credit money but carry no other
 * artifact we can dedupe on.
 *
 * WHY: `/gmag/payUp` (manual jackpot / bonus payout) had no replay protection at all. It calls
 * `creditWalletForCasino`, which unconditionally moves the wallet and inserts a ledger row that
 * nothing dedupes on. That holds for every player: since 2026-11-02 a credit player's chips are
 * its cash wallet too, so its payUp lands there the same way. So a redelivered payUp — which
 * providers do routinely, see CS-22135 where one bet was retried 36 times — credited the player
 * again, every time.
 *
 * Settlement callbacks do not need this: they dedupe on `casino_bets.result_transaction_id`.
 * This table exists for the callbacks that credit money with no bet to hang that on.
 *
 * The UNIQUE index is the actual guard. Insert FIRST inside the caller's transaction and let a
 * 23505 mean "already applied" — a read-then-write check would race two concurrent redeliveries.
 */
export const casinoCallbackIdempotency = pgTable(
  'casino_callback_idempotency',
  {
    id: serial('id').primaryKey(),
    tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
    /** casino_api_providers.key, e.g. 'gmagcasino'. */
    providerKey: varchar('provider_key', { length: 64 }).notNull(),
    /** Callback kind this receipt covers, e.g. 'payUp'. */
    operation: varchar('operation', { length: 64 }).notNull(),
    /** The provider's own transaction id — the thing that repeats on a redelivery. */
    transId: varchar('trans_id', { length: 128 }).notNull(),
    userId: integer('user_id'),
    amount: numeric('amount', { precision: 18, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('casino_callback_idempotency_key').on(table.providerKey, table.operation, table.transId),
    index('casino_callback_idempotency_user_idx').on(table.userId),
    index('casino_callback_idempotency_created_idx').on(table.createdAt),
  ]
)
