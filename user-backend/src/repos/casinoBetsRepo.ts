import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { casinoBets } from '@shared/db/schema.js'

export type CasinoBetRow = typeof casinoBets.$inferSelect

type Executor = typeof db

export interface CreateCasinoBetParams {
  tenant: string
  whitelabelId: string
  userId: number
  gameId: number
  gameName: string | null
  providerId: number | null
  vendorId: number
  vendorName: string
  tableId: string | null
  stake: string
  transactionId: string
  gameRoundId: string
  walletType: 'cash' | 'bonus' | 'referralBonus'
  bonusAwardId: number | null
  currency: string
  excludeFromAdminRunning?: boolean
  /** Merged into `casino_bets.metadata` (e.g. bet-tool client context). */
  metadata?: Record<string, unknown> | null
}

export async function createCasinoBet(params: CreateCasinoBetParams, executor: Executor = db): Promise<CasinoBetRow> {
  // DB-level idempotency note (migration 0085): there is now a PARTIAL UNIQUE index
  // `casino_bets_user_transaction_key` on (user_id, transaction_id). The app-level
  // checkDuplicateTransactionId SELECT (in the GAP/GMAG debit handlers) remains the
  // fast path. If a racing duplicate provider debit callback passes that SELECT, this
  // INSERT will raise Postgres 23505 on the unique index.
  //
  // We intentionally let that 23505 propagate rather than catch + re-fetch here:
  // createCasinoBet is always called inside the handler's db.transaction (alongside
  // the wallet debit). A 23505 aborts that whole transaction, so a same-executor
  // re-fetch would fail ("current transaction is aborted") and returning a row read
  // on a fresh connection would falsely signal success while the caller's poisoned
  // transaction (wallet debit, bonus updates) rolls back. Propagating the error rolls
  // the transaction back cleanly: NO duplicate bet row AND no double debit -- the
  // intended outcome. Providers retry on the error response.
  const [row] = await executor
    .insert(casinoBets)
    .values({
      tenant: params.tenant,
      whitelabelId: params.whitelabelId,
      userId: params.userId,
      gameId: params.gameId,
      gameName: params.gameName,
      providerId: params.providerId,
      vendorId: params.vendorId,
      vendorName: params.vendorName,
      tableId: params.tableId,
      stake: params.stake,
      transactionId: params.transactionId,
      gameRoundId: params.gameRoundId,
      status: 'active',
      walletType: params.walletType,
      bonusAwardId: params.bonusAwardId,
      currency: params.currency,
      excludeFromAdminRunning: params.excludeFromAdminRunning ?? false,
      ...(params.metadata != null && Object.keys(params.metadata).length > 0
        ? { metadata: params.metadata }
        : {}),
    })
    .returning()
  if (!row) {
    throw new Error('Failed to create casino bet')
  }
  return row
}

export async function findBetsByTransactionAndRound(
  userId: number,
  transactionId: string,
  roundId: string,
  executor: Executor = db
): Promise<CasinoBetRow[]> {
  return executor
    .select()
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.userId, userId),
        eq(casinoBets.transactionId, transactionId),
        eq(casinoBets.gameRoundId, roundId)
      )
    )
}

export async function findActiveBetsByUserIdAndRoundId(
  userId: number,
  roundId: string,
  executor: Executor = db
): Promise<CasinoBetRow[]> {
  const rows = await executor
    .select()
    .from(casinoBets)
    .where(
      and(eq(casinoBets.userId, userId), eq(casinoBets.gameRoundId, roundId), eq(casinoBets.status, 'active'))
    )
  if (rows.length > 0) {
  }
  return rows
}

export async function findAllBetsByUserIdAndRoundId(
  userId: number,
  roundId: string,
  executor: Executor = db
): Promise<CasinoBetRow[]> {
  const rows = await executor
    .select()
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.gameRoundId, roundId)))
  return rows
}

export async function findBetsByTransactionIdForRollback(
  userId: number,
  transactionId: string,
  executor: Executor = db
): Promise<CasinoBetRow[]> {
  const rows = await executor
    .select()
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.transactionId, transactionId), eq(casinoBets.status, 'active')))
  return rows
}

export async function findBetsByTransactionIdAnyStatus(
  userId: number,
  transactionId: string,
  executor: Executor = db
): Promise<CasinoBetRow[]> {
  const rows = await executor
    .select()
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.transactionId, transactionId)))
  return rows
}

export async function checkDuplicateTransactionId(
  userId: number,
  transactionId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .select({ id: casinoBets.id })
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.transactionId, transactionId)))
    .limit(1)
  const isDup = rows.length > 0
  return isDup
}

export async function checkDuplicateResultTransactionId(
  userId: number,
  roundId: string,
  resultTransactionId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .select({ id: casinoBets.id })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.userId, userId),
        eq(casinoBets.gameRoundId, roundId),
        eq(casinoBets.resultTransactionId, resultTransactionId)
      )
    )
    .limit(1)
  const isDup = rows.length > 0
  return isDup
}

/**
 * Per-bet duplicate check: has this specific bet already been settled with this resultTransactionId?
 * Used for Aviator dual-bet scenario where multiple bets share the same roundId but each win
 * callback carries a different referenceId (original bet transactionId).
 */
export async function checkDuplicateResultTransactionIdForBet(
  betId: string,
  resultTransactionId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .select({ id: casinoBets.id })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.id, betId),
        eq(casinoBets.resultTransactionId, resultTransactionId)
      )
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Find a single active bet by userId + transactionId (the original bet transId).
 * Used when GMAG win callback provides referenceId = original bet transId.
 */
export async function findActiveBetByTransactionId(
  userId: number,
  transactionId: string,
  executor: Executor = db
): Promise<CasinoBetRow | null> {
  const rows = await executor
    .select()
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.userId, userId),
        eq(casinoBets.transactionId, transactionId),
        eq(casinoBets.status, 'active')
      )
    )
    .limit(1)
  return (rows[0] as CasinoBetRow) ?? null
}

export async function checkDuplicateRollbackTransactionId(
  userId: number,
  roundId: string,
  rollbackTransactionId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .select({ id: casinoBets.id })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.userId, userId),
        eq(casinoBets.gameRoundId, roundId),
        eq(casinoBets.rollbackTransactionId, rollbackTransactionId)
      )
    )
    .limit(1)
  const isDup = rows.length > 0
  return isDup
}

export async function checkAnyBetHasRollback(
  userId: number,
  transactionId: string,
  roundId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .select({ id: casinoBets.id })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.userId, userId),
        eq(casinoBets.transactionId, transactionId),
        eq(casinoBets.gameRoundId, roundId),
        isNotNull(casinoBets.rollbackTransactionId)
      )
    )
    .limit(1)
  const hasRollback = rows.length > 0
  return hasRollback
}

/**
 * Update bet to won/lost only when status is 'active'. Idempotent: duplicate win callbacks do not double-credit.
 * @returns true if a row was updated, false if bet was already settled or not active
 */
export async function updateBetResult(
  betId: string,
  params: {
    status: 'won' | 'lost'
    netAmount: string
    winAmount: string
    payout: string
    resultTransactionId: string
  },
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .update(casinoBets)
    .set({
      status: params.status,
      netAmount: params.netAmount,
      winAmount: params.winAmount,
      payout: params.payout,
      resultTransactionId: params.resultTransactionId,
      settledAt: new Date(),
      updatedAt: new Date(),
      excludeFromAdminRunning: false,
    })
    .where(and(eq(casinoBets.id, betId), eq(casinoBets.status, 'active')))
    .returning({ id: casinoBets.id })
  const updated = rows.length > 0
  return updated
}

/**
 * Set bet to void only when status is 'active'. Idempotent: duplicate rollback callbacks do not double-credit.
 * @returns true if a row was updated, false if bet was already void/settled or not active
 */
export async function deleteCasinoBetById(betId: string, executor: Executor = db): Promise<boolean> {
  const rows = await executor.delete(casinoBets).where(eq(casinoBets.id, betId)).returning({ id: casinoBets.id })
  return rows.length > 0
}

export async function updateBetRollback(
  betId: string,
  rollbackTransactionId: string,
  executor: Executor = db
): Promise<boolean> {
  const rows = await executor
    .update(casinoBets)
    .set({
      status: 'void',
      rollbackTransactionId,
      updatedAt: new Date(),
      excludeFromAdminRunning: false,
    })
    .where(and(eq(casinoBets.id, betId), eq(casinoBets.status, 'active')))
    .returning({ id: casinoBets.id })
  const updated = rows.length > 0
  return updated
}
