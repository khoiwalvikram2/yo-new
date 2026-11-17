/**
 * Shared service to deduct whitelabel credit when bonus/referral converts to cash.
 * Used by both admin-backend and user-backend flows.
 * Caller must pass executor (tx or db) for atomicity with wallet/ledger operations.
 */
import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { whitelabels, agentCreditLedger } from '../db/schema.js'

export interface DeductWhitelabelCreditPlayerInfo {
  userId: number
  playerName?: string
  playerEmail?: string
  playerUsername?: string
}

/**
 * Deduct amount from whitelabel credit. Skips if tenant is 'default'.
 * Must be called inside the same transaction as wallet update and ledger insert.
 *
 * @param executor - Drizzle db or transaction (from caller)
 * @param tenant - Whitelabel/tenant ID ('default' = no-op)
 * @param amount - Amount to deduct
 * @param currency - Currency code for ledger (e.g. from getWhitelabelCurrency(tenant))
 * @param reason - Human-readable reason (e.g. "Bonus to cash - userId=123")
 * @param playerInfo - Optional player info for audit
 * @throws Error if whitelabel not found or insufficient credit
 */
export async function deductWhitelabelCredit(
  executor: any,
  tenant: string,
  amount: number,
  currency: string,
  reason: string,
  playerInfo?: DeductWhitelabelCreditPlayerInfo
): Promise<void> {
  if (!tenant || tenant.trim() === '' || tenant === 'default') {
    return
  }
  if (amount <= 0 || !Number.isFinite(amount)) {
    return
  }

  const whitelabelId = tenant.trim()

  // Lock whitelabel row with FOR UPDATE
  const result = await (executor as any).execute(sql`
    SELECT 
      credit_limit,
      credit_used,
      credit_available,
      credit_alert_threshold,
      settlement_balance
    FROM whitelabels
    WHERE id = ${whitelabelId}
    FOR UPDATE
    LIMIT 1
  `)
  const row = (result as any).rows?.[0] ?? (result as any)[0] ?? null
  if (!row) {
    throw new Error(`Whitelabel not found: ${whitelabelId}`)
  }

  const creditLimit = Number(row.credit_limit || 0)
  const creditUsed = Number(row.credit_used || 0)
  const settlementBalance = Number(row.settlement_balance || 0)
  const creditAvailable = Math.max(0, creditLimit - creditUsed + settlementBalance)

  if (creditAvailable < amount) {
    throw new Error(
      `Insufficient whitelabel credit. Available: ${creditAvailable.toFixed(2)}, Requested: ${amount.toFixed(2)}`
    )
  }

  const newCreditUsed = creditUsed + amount
  const newCreditAvailable = Math.max(0, creditLimit - newCreditUsed + settlementBalance)

  await executor
    .update(whitelabels)
    .set({
      creditUsed: newCreditUsed.toString(),
      creditAvailable: newCreditAvailable.toString(),
      updatedAt: new Date(),
    })
    .where(eq(whitelabels.id, whitelabelId))

  await executor.insert(agentCreditLedger).values({
    tenantId: whitelabelId,
    fromEntityType: 'whitelabel',
    fromEntityId: whitelabelId,
    toEntityType: 'whitelabel',
    toEntityId: whitelabelId,
    transactionType: 'USAGE',
    amount: amount.toString(),
    currency: currency || 'INR',
    balanceBefore: creditAvailable.toString(),
    balanceAfter: newCreditAvailable.toString(),
    reason: reason || 'Credit deduction',
    meta: playerInfo
      ? {
          playerId: playerInfo.userId,
          playerName: playerInfo.playerName,
          playerEmail: playerInfo.playerEmail,
          playerUsername: playerInfo.playerUsername,
        }
      : null,
  })
}

/**
 * Give credit back to a whitelabel when a player's withdrawal completes: the shared twin of
 * admin-backend WhitelabelCreditService.addCredit, for code that runs in both backends (gateway
 * payouts settle from either). Same arithmetic under the same FOR UPDATE lock: credit_used drops by
 * `amount`, available is re-derived, and a RELEASE row records it. Skips the 'default' tenant.
 * Must be called inside the transaction that completes the withdrawal.
 */
export async function releaseWhitelabelCredit(
  executor: any,
  tenant: string,
  amount: number,
  currency: string,
  reason: string,
  playerInfo?: DeductWhitelabelCreditPlayerInfo
): Promise<void> {
  if (!tenant || tenant.trim() === '' || tenant === 'default') {
    return
  }
  if (amount <= 0 || !Number.isFinite(amount)) {
    return
  }

  const whitelabelId = tenant.trim()
  const result = await (executor as any).execute(sql`
    SELECT credit_limit, credit_used, settlement_balance
    FROM whitelabels
    WHERE id = ${whitelabelId}
    FOR UPDATE
    LIMIT 1
  `)
  const row = (result as any).rows?.[0] ?? (result as any)[0] ?? null
  if (!row) {
    throw new Error(`Whitelabel not found: ${whitelabelId}`)
  }

  const creditLimit = Number(row.credit_limit || 0)
  const creditUsed = Number(row.credit_used || 0)
  const settlementBalance = Number(row.settlement_balance || 0)
  const creditAvailable = Math.max(0, creditLimit - creditUsed + settlementBalance)
  const newCreditUsed = creditUsed - amount
  const newCreditAvailable = Math.max(0, creditLimit - newCreditUsed + settlementBalance)

  await executor
    .update(whitelabels)
    .set({
      creditUsed: newCreditUsed.toString(),
      creditAvailable: newCreditAvailable.toString(),
      updatedAt: new Date(),
    })
    .where(eq(whitelabels.id, whitelabelId))

  await executor.insert(agentCreditLedger).values({
    tenantId: whitelabelId,
    fromEntityType: 'whitelabel',
    fromEntityId: whitelabelId,
    toEntityType: 'whitelabel',
    toEntityId: whitelabelId,
    transactionType: 'RELEASE',
    amount: amount.toString(),
    currency: currency || 'INR',
    balanceBefore: creditAvailable.toString(),
    balanceAfter: newCreditAvailable.toString(),
    reason: reason || 'Credit release on withdrawal',
    meta: playerInfo
      ? {
          playerId: playerInfo.userId,
          playerName: playerInfo.playerName,
          playerEmail: playerInfo.playerEmail,
          playerUsername: playerInfo.playerUsername,
        }
      : null,
  })
}
