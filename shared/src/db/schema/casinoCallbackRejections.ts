import { pgTable, serial, varchar, integer, jsonb, text, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Every casino provider callback we REFUSED, with the payload that caused it.
 *
 * WHY: incident CS-22135. Our wallet declined 142 provider calls for one player in one evening
 * (138x G_01 "Game not found", 3x R_02 "Invalid round when win") and nothing recorded them —
 * the only trace was `console.warn`. We had to reconstruct the whole incident from the
 * PROVIDER's logs, and nobody noticed for 10.5 hours.
 *
 * This table is the missing audit trail and the input to spike detection: the same rejection
 * repeating dozens of times in minutes is never normal, and should page an operator rather than
 * arrive as a support ticket the next day.
 *
 * Append-only. Writes are fire-and-forget and must never fail a callback.
 */
export const casinoCallbackRejections = pgTable(
  'casino_callback_rejections',
  {
    id: serial('id').primaryKey(),
    tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
    /** casino_api_providers.key, e.g. 'gmagcasino'. */
    providerKey: varchar('provider_key', { length: 64 }).notNull(),
    /** Callback route that refused, e.g. 'transaction' | 'payUp' | 'balance' | 'auth'. */
    endpoint: varchar('endpoint', { length: 64 }).notNull(),
    /** Provider-facing error code we returned, e.g. 'R_02', 'G_01', 'T_01', 'P_06'. */
    errorCode: varchar('error_code', { length: 48 }).notNull(),
    errorMessage: text('error_message'),
    /**
     * Deliberately NOT an FK to users.id: a rejected callback may carry an unknown or malformed
     * player id, and an FK would turn a log write into a 23503 inside the callback path.
     */
    userId: integer('user_id'),
    playerId: varchar('player_id', { length: 128 }),
    gameCode: varchar('game_code', { length: 128 }),
    roundId: varchar('round_id', { length: 128 }),
    transId: varchar('trans_id', { length: 128 }),
    referenceId: varchar('reference_id', { length: 128 }),
    requestId: varchar('request_id', { length: 128 }),
    /** The provider request body, for reconstructing an incident without the provider's help. */
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('casino_callback_rejections_tenant_idx').on(table.tenant),
    index('casino_callback_rejections_provider_idx').on(table.providerKey),
    index('casino_callback_rejections_error_code_idx').on(table.errorCode),
    index('casino_callback_rejections_created_idx').on(table.createdAt),
    index('casino_callback_rejections_user_idx').on(table.userId),
    index('casino_callback_rejections_round_idx').on(table.roundId),
  ]
)
