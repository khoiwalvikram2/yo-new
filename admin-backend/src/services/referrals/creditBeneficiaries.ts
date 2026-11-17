/**
 * Referral cash never reaches a credit player (decision 7 of docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md).
 *
 * A credit player (AGENT_CREDIT, WHITELABEL_CREDIT) holds Deposit/Withdraw chips in its cash wallet, and they move
 * only through its direct upline. A referral payout (referral balance or referral bonus) or a referral deposit bonus
 * would put money in its wallets outside that chain. The bet paths already keep a credit player's own bets away
 * from the referral hooks; these helpers keep a credit player out as the beneficiary, the referrer: its earnings
 * are never created (rewardsCalculator) and never paid (settlementService).
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { users } from '@shared/db/schema.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'

/** Reads the player type of each of `userIds` in the tenant (injectable for tests). */
export type PlayerTypeReader = (tenant: string, userIds: number[]) => Promise<Array<{ id: number; playerType: string | null }>>

export const readPlayerTypes: PlayerTypeReader = async (tenant, userIds) => {
  if (userIds.length === 0) return []
  return db
    .select({ id: users.id, playerType: users.playerType })
    .from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.id, userIds)))
}

/** The credit players among `userIds` in the tenant, in one read for the whole list. */
export async function creditPlayerIdsAmong(
  tenant: string,
  userIds: readonly number[],
  read: PlayerTypeReader = readPlayerTypes
): Promise<Set<number>> {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (ids.length === 0) return new Set()
  const rows = await read(tenant, ids)
  return new Set(rows.filter((row) => isCreditPlayer(row.playerType)).map((row) => Number(row.id)))
}

/** Whether the beneficiary `userId` is a credit player in the tenant. */
export async function isCreditBeneficiary(tenant: string, userId: number, read: PlayerTypeReader = readPlayerTypes): Promise<boolean> {
  return (await creditPlayerIdsAmong(tenant, [userId], read)).has(Number(userId))
}

/** `earnings` without those whose beneficiary (`referrerId`) is a credit player. */
export async function withoutCreditBeneficiaries<T extends { referrerId: number }>(
  tenant: string,
  earnings: readonly T[],
  read: PlayerTypeReader = readPlayerTypes
): Promise<T[]> {
  if (earnings.length === 0) return []
  const credit = await creditPlayerIdsAmong(tenant, earnings.map((earning) => earning.referrerId), read)
  return earnings.filter((earning) => !credit.has(Number(earning.referrerId)))
}
