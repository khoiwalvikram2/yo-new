import { sql } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'

/**
 * Player-type checks for player-facing resolvers.
 *
 * Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold Deposit/Withdraw chips in
 * wallets.cash, but chips move only through their upline: they cannot deposit or withdraw
 * for themselves. Anything that would mint cash for them (referral rewards, referral balance
 * to cash) creates chips the upline never handed down and that only the upline could take
 * back, so those resolvers refuse them. The player app already hides referrals for them;
 * this is the server-side gate.
 */

export const CREDIT_PLAYER_REFERRAL_MESSAGE = 'Referrals are not available for credit accounts.'

/** True for a credit player; false for every other player type and for a missing user. */
export async function isCreditPlayerUser(userId: number, tenant: string, executor: any = db): Promise<boolean> {
  const result = await executor.execute(sql`
    SELECT player_type
    FROM users
    WHERE id = ${userId} AND tenant = ${tenant}
    LIMIT 1
  `)
  const row = result?.rows?.[0] ?? result?.[0] ?? null
  return isCreditPlayer(row?.player_type)
}
