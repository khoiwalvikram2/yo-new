import { and, eq } from 'drizzle-orm'
import { users } from '@shared/db/schema.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'
import type { db } from '../../db/client.js'
import type { CasinoWalletType } from '../../repos/casinoWalletRepo.js'

/**
 * Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their Deposit/Withdraw chips in
 * wallets.cash and play casino on the cash-wallet path, like REGULAR players: the stake comes
 * off cash at the bet, a win pays the gross return into cash and a rollback puts the stake back.
 * They never hold bonus or referral-bonus funds, so whatever wallet a launch session or a bet
 * row names, a credit player's money always moves in cash.
 *
 * For everyone else the requested wallet is kept. Any value other than 'bonus' or
 * 'referralBonus' (a legacy 'referral_bonus' included) has always meant cash.
 */
export function casinoWalletTypeFor(creditPlayer: boolean, requested: string | null | undefined): CasinoWalletType {
  if (creditPlayer) return 'cash'
  return requested === 'referralBonus' ? 'referralBonus' : requested === 'bonus' ? 'bonus' : 'cash'
}

/**
 * Whether the casino callback's player is a credit player. A plain read: money moves are
 * serialised by the wallet row lock that debitWalletForCasino / creditWalletForCasino take.
 */
export async function isCasinoCreditPlayer(executor: typeof db, userId: number, tenant: string): Promise<boolean> {
  const [row] = await executor
    .select({ playerType: users.playerType })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
  return isCreditPlayer(row?.playerType)
}
