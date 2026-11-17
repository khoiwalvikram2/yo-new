import { z } from 'zod'

/** The cap on a money figure in a limit, the same as the other financial inputs of the player mutations. */
const MAX_LIMIT_AMOUNT = 1_000_000_000
const NEGATIVE_LIMIT_MESSAGE = 'Limits cannot be negative'

const limitAmount = z.number().nonnegative(NEGATIVE_LIMIT_MESSAGE).max(MAX_LIMIT_AMOUNT).nullable().optional()

/**
 * A player's limits as both limit mutations accept them (users.upsertPlayerLimits and players.setPlayerLimits).
 * Every figure is 0 or more, or null for "no limit". A negative daily or weekly stake limit or max bet refused
 * every bet the player placed (today's total plus the stake is always above it), and the drawer's own fields
 * stop at 0, so only the API could send one.
 */
export const playerLimitFields = {
  dailyStakeLimit: limitAmount,
  weeklyStakeLimit: limitAmount,
  exposureCapOverride: limitAmount,
  cooldownSeconds: z.number().int().nonnegative(NEGATIVE_LIMIT_MESSAGE).max(86400 * 365).nullable().optional(),
  maxBetSports: limitAmount,
  maxBetCasino: limitAmount,
  maxBetMatka: limitAmount,
}

/** The messages of a failed parse, for the error the admin sees. */
export function limitInputError(error: z.ZodError): Error {
  return new Error(error.issues.map((issue) => issue.message).join(', ') || 'Invalid input')
}
