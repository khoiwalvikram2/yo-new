import { and, eq } from 'drizzle-orm'
import { vipMembersTable } from '@shared/db/schema.js'
import { getVipDepositContext } from '@shared/vip/depositAccess.js'
import { db } from '../../db/client.js'
import {
  getCasinoBetSettings,
  getCasinoGameAccessRules,
  getCasinoNetWinSince,
  type CasinoBetSettingsRow,
} from '../../repos/casinoGameRepo.js'
import { getWhitelabelTimezone } from '../../shared/whitelabelConfig.js'
import { getStartOfDay } from '../../shared/dateUtils.js'

/**
 * The per-game rules a whitelabel admin sets on Casino Management, enforced
 * where the player meets the game: at launch, and on every stake.
 *
 * The admin could switch "Betting enabled" off, set a "Max Win (daily)", mark
 * a game premium or restrict it to VIP tiers, and the rows were saved — but
 * the player side read only the minimum and maximum stake, so none of the four
 * changed anything for a player.
 *
 * The owner asked for refusals at launch and bet time (2026-11-03). The
 * readings below are this module's, listed for the owner to confirm:
 *  - Max Win (daily) refuses further bets once the player's net result on that
 *    game for the whitelabel's day reaches the cap. It never cuts a payout.
 *  - Premium means VIP members only: a player with an active VIP membership.
 *  - A VIP tier restriction admits the players whose current tier (the one the
 *    VIP page shows them) is among the whitelabel's own tiers selected.
 */

export type CasinoGameAccessReason = 'bet_disabled' | 'max_win_reached' | 'premium_only' | 'vip_tier'

export interface CasinoGameAccessRefusal {
  reason: CasinoGameAccessReason
  /** Safe to show to the player. */
  message: string
}

/**
 * A launch or stake refused by one of these rules. Like AgentBettingBlockedError it is a
 * refusal, not a provider failure, and its message is safe to show to the player.
 */
export class CasinoGameAccessError extends Error {
  readonly code = 'CASINO_GAME_ACCESS'
  constructor(readonly reason: CasinoGameAccessReason, message: string) {
    super(message)
    this.name = 'CasinoGameAccessError'
  }
}

export const CASINO_GAME_ACCESS_MESSAGES: Record<CasinoGameAccessReason, string> = {
  bet_disabled: 'Betting on this game is turned off for your account',
  max_win_reached: "You have reached today's maximum win on this game",
  premium_only: 'This game is for VIP members only',
  vip_tier: 'This game is not available for your VIP tier',
}

export interface PlayerVipAccess {
  /** An active VIP membership. */
  member: boolean
  /** The player's current tier, or null when they have none (credit players, no programme). */
  tierId: string | null
}

export interface CasinoGameAccessInput {
  settings: Pick<CasinoBetSettingsRow, 'betEnabled' | 'maxWin'> | null
  /** Today's net result on the game; only read when there is a cap. */
  dailyNetWin: number
  premiumOnly: boolean
  vipTierIds: readonly string[]
  /** Only loaded when the game is premium or tier-restricted. */
  vip: PlayerVipAccess | null
}

function refuse(reason: CasinoGameAccessReason): CasinoGameAccessRefusal {
  return { reason, message: CASINO_GAME_ACCESS_MESSAGES[reason] }
}

/** The decision alone, with no database: null admits the player. */
export function decideCasinoGameAccess(input: CasinoGameAccessInput): CasinoGameAccessRefusal | null {
  if (input.settings && input.settings.betEnabled === false) return refuse('bet_disabled')
  const cap = input.settings?.maxWin
  if (cap != null && input.dailyNetWin >= cap) return refuse('max_win_reached')
  if (input.premiumOnly && !input.vip?.member) return refuse('premium_only')
  if (input.vipTierIds.length > 0) {
    const tierId = input.vip?.tierId
    if (!tierId || !input.vipTierIds.includes(tierId)) return refuse('vip_tier')
  }
  return null
}

type Executor = typeof db

async function loadPlayerVipAccess(executor: Executor, tenant: string, userId: number): Promise<PlayerVipAccess> {
  // The same effective tier the player's VIP page shows. It throws for credit players and for a
  // whitelabel with no active tier, which simply means the player has no tier.
  const context = await getVipDepositContext(executor as never, tenant, userId).catch(() => null)
  const [membership] = await executor
    .select({ status: vipMembersTable.status })
    .from(vipMembersTable)
    .where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(userId))))
    .limit(1)
  return { member: membership?.status === 'active', tierId: context?.tier.id ?? null }
}

/**
 * Whether the player may launch or stake on this game; null admits them.
 *
 * Pass `settings` when the caller has already read the player's bet rule (the
 * debit paths have, for the stake limits) so it is not read twice. The VIP
 * lookups run only for a premium or tier-restricted game, and the day's net
 * result only when there is a cap.
 */
export async function checkCasinoGameAccess(
  executor: Executor,
  args: { tenant: string; userId: number; gameId: number; settings?: CasinoBetSettingsRow | null },
): Promise<CasinoGameAccessRefusal | null> {
  const { tenant, userId, gameId } = args
  const settings = args.settings !== undefined
    ? args.settings
    : await getCasinoBetSettings(tenant, gameId, String(userId), executor)
  if (settings?.betEnabled === false) return refuse('bet_disabled')

  let dailyNetWin = 0
  if (settings?.maxWin != null) {
    const todayStart = getStartOfDay(await getWhitelabelTimezone(tenant))
    dailyNetWin = await getCasinoNetWinSince(tenant, userId, gameId, todayStart, executor)
  }

  const rules = await getCasinoGameAccessRules(tenant, gameId, executor)
  const vip = rules.premiumOnly || rules.vipTierIds.length > 0
    ? await loadPlayerVipAccess(executor, tenant, userId)
    : null

  return decideCasinoGameAccess({
    settings,
    dailyNetWin,
    premiumOnly: rules.premiumOnly,
    vipTierIds: rules.vipTierIds,
    vip,
  })
}
