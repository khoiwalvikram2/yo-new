import { z } from 'zod'
import { casinoCallbackAmount } from './callbackAmount.js'

export const walletBalanceBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  request_uuid: z.string().optional(),
})

export const debitBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  transactionId: z.string().min(1),
  roundId: z.string().min(1),
  // Allow negative values through so the handler can return OP_ERROR_NEGATIVE_DEBIT_AMOUNT
  // instead of OP_INVALID_PARAMS (GAP test "Bet With Negative Amount" expects the former).
  debitAmount: casinoCallbackAmount,
  gameId: z.string().min(1),
  reqId: z.string().optional(),
})

export const creditBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  transactionId: z.string().min(1),
  roundId: z.string().min(1),
  creditAmount: casinoCallbackAmount,
  gameId: z.string().min(1),
  reqId: z.string().optional(),
  round_closed: z.unknown().optional(),
})

export const rollbackBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  transactionId: z.string().min(1),
  roundId: z.string().min(1),
  reqId: z.string().optional(),
  gameId: z.string().min(1),
})

export type WalletBalanceBody = z.infer<typeof walletBalanceBodySchema>
export type DebitBody = z.infer<typeof debitBodySchema>
export type CreditBody = z.infer<typeof creditBodySchema>
export type RollbackBody = z.infer<typeof rollbackBodySchema>
