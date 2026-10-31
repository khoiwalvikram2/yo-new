import { sql } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'

/**
 * Player-type checks for player-facing resolvers.
 *
 * Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold no cash: they cannot deposit or
 * withdraw. Anything that would mint cash for them (referral rewards, referral balance to
 * cash) creates money that can never leave, so those resolvers refuse them. The player
 * app already hides referrals for them; this is the server-side gate.
 */

export const CREDIT_PLAYER_REFERRAL_MESSAGE = 'Referrals are not available for credit accounts.'

export type PlayerCreditState = { isCredit: boolean; creditUsed: number }

/** Reads the player's type and credit_used. Returns null when the user does not exist. */
export async function getPlayerCreditState(
  userId: number,
  tenant: string,
  executor: any = db
): Promise<PlayerCreditState | null> {
  const result = await executor.execute(sql`
    SELECT player_type, credit_used
    FROM users
    WHERE id = ${userId} AND tenant = ${tenant}
    LIMIT 1
  `)
  const row = result?.rows?.[0] ?? result?.[0] ?? null
  if (!row) return null
  return { isCredit: isCreditPlayer(row.player_type), creditUsed: Number(row.credit_used ?? 0) }
}

export async function isCreditPlayerUser(userId: number, tenant: string, executor: any = db): Promise<boolean> {
  return (await getPlayerCreditState(userId, tenant, executor))?.isCredit ?? false
}
