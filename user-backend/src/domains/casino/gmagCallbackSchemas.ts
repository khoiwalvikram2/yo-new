import { z } from 'zod'
import { casinoCallbackAmount } from './callbackAmount.js'

const transItemSchema = z.object({
  seq: z.number(),
  transId: z.string(),
  amount: casinoCallbackAmount,
  transType: z.enum(['bet', 'win', 'cancel', 'transIn', 'transOut']),
  transTime: z.string(),
  roundId: z.string(),
  roundType: z.string().optional(),
  endRound: z.union([z.number(), z.boolean()]).optional(),
  jpc: z.union([z.number(), z.string()]).optional(),
  jpw: z.union([z.number(), z.string()]).optional(),
  referenceId: z.string().optional(),
  validBet: z.union([z.number(), z.string()]).optional(),
  validWin: z.union([z.number(), z.string()]).optional(),
})

export const gmagAuthSchema = z.object({
  brandId: z.union([z.coerce.number(), z.string()]),
  requestId: z.string(),
  token: z.string().min(1),
})

export const gmagBalanceSchema = z.object({
  brandId: z.union([z.coerce.number(), z.string()]),
  requestId: z.string(),
  playerId: z.string().min(1),
  playerSessionId: z.string(), // allow empty string — empty/expired session must reach service to return P_06
  gameCode: z.string().optional(),
})

export const gmagTransactionSchema = z.object({
  brandId: z.union([z.coerce.number(), z.string()]),
  requestId: z.string(),
  playerId: z.string().min(1),
  playerSessionId: z.string(), // allow empty string — empty/expired session must reach service to return P_06
  gameCode: z.string().optional(),
  providerCode: z.string().optional(),
  gameType: z.string().optional(),
  trans: z.array(transItemSchema).min(1),
  detailUrl: z.string().optional(),
})

export const gmagPayUpSchema = z.object({
  brandId: z.union([z.coerce.number(), z.string()]),
  requestId: z.string(),
  playerId: z.string().min(1),
  transId: z.string().min(1),
  amount: casinoCallbackAmount,
  transTime: z.string(),
  type: z.string(), // bonus, promo, jackpot, leaderboard
  currency: z.string().optional(),
  referenceId: z.string().optional(),
  providerCode: z.string().optional(),
})

export type GmagAuthBody = z.infer<typeof gmagAuthSchema>
export type GmagBalanceBody = z.infer<typeof gmagBalanceSchema>
export type GmagTransactionBody = z.infer<typeof gmagTransactionSchema>
export type GmagPayUpBody = z.infer<typeof gmagPayUpSchema>
export type GmagTransItem = z.infer<typeof transItemSchema>
