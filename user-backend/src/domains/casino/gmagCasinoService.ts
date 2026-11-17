import { loadPlayerDomains } from '@shared/access/playerDomains.js'
import { db } from '../../db/client.js'
import { users, bonusAwards, bonusCampaigns, casinoBets, sportsBets, casinoCallbackIdempotency } from '@shared/db/schema.js'
import { and, eq, gte, desc, sql } from 'drizzle-orm'
import { getCasinoSessionByTokenForProvider } from '../../repos/casinoSessionRepo.js'
import {
  createCasinoBet,
  findBetsByTransactionAndRound,
  findActiveBetsByUserIdAndRoundId,
  findActiveBetByTransactionId,
  findAllBetsByUserIdAndRoundId,
  findBetsByTransactionIdForRollback,
  findBetsByTransactionIdAnyStatus,
  checkDuplicateTransactionId,
  checkDuplicateResultTransactionId,
  checkDuplicateResultTransactionIdForBet,
  checkDuplicateRollbackTransactionId,
  checkAnyBetHasRollback,
  updateBetResult,
  updateBetRollback,
} from '../../repos/casinoBetsRepo.js'
import type { CasinoBetRow } from '../../repos/casinoBetsRepo.js'
import {
  gmagBetReferenceCandidates,
  resolveGmagWinTarget,
  pickSoleRoundBet,
  isAcceptableCandidateMatch,
} from './gmagBetReference.js'
import { ensureWalletWithExecutor, getWalletByUserIdWithExecutor } from '../../repos/userRepo.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import {
  debitWalletForCasino,
  creditWalletForCasino,
  creditReferralBalanceForCasino,
} from '../../repos/casinoWalletRepo.js'
import type { CasinoWalletType } from '../../repos/casinoWalletRepo.js'
import { getCasinoGameByExternalIdAndProviderKey, getCasinoBetSettings } from '../../repos/casinoGameRepo.js'
import { getActiveCasinoBonusAwardId, getPlayerLimitsForUser } from '../../repos/userAppRepo.js'
import { updateBonusWagering } from '@shared/services/bonusService.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '../../shared/whitelabelConfig.js'
import { getStartOfDay, getStartOfWeek } from '../../shared/dateUtils.js'
import { isCreditPlayer as isCreditPlayerType } from '@shared/services/credit/isCreditPlayer.js'
import { casinoWalletTypeFor, isCasinoCreditPlayer } from './casinoCreditPlayer.js'
import type { GmagAuthBody, GmagBalanceBody, GmagTransactionBody, GmagPayUpBody, GmagTransItem } from './gmagCallbackSchemas.js'
import { getRgBlockState } from '@shared/services/rgEnforcement.js'
import { checkPlayerAgentBettingGate } from '../userApp/services/agentBettingGate.js'
import { CasinoGameAccessError, checkCasinoGameAccess, type CasinoGameAccessRefusal } from './casinoGameAccess.js'

/** GMAG / Aviator-style casino API provider key (used by callbacks and bet-tool). */
export const GMAG_PROVIDER_KEY = 'gmagcasino'
const LOG_PREFIX = '[GmagCasino]'

/**
 * A refused per-game rule, in the codes GMAG already receives: the day's win cap is a
 * limit (T_04, like the stake limits); the others refuse the player on this game (P_07,
 * as for a blocked player).
 */
function gmagGameAccessError(refusal: CasinoGameAccessRefusal): { ok: false; error: GmagErrorCode; message: string } {
  return { ok: false, error: refusal.reason === 'max_win_reached' ? 'T_04' : 'P_07', message: refusal.message }
}

export type GmagErrorCode =
  | '0'
  | 'P_00'
  | 'P_01'
  | 'P_02'
  | 'P_04'
  | 'P_06'
  | 'P_07'
  | 'T_01'
  | 'T_02'
  | 'T_03'
  | 'T_04'
  | 'R_02'
  | 'G_01'

export interface GmagCallbackResponse {
  error: string
  message: string
  requestId: string
  playerId?: string
  playerSessionId?: string
  balance?: number
  currency?: string
  country?: string
  username?: string
}

function successResponse(requestId: string, extra: Partial<GmagCallbackResponse>): GmagCallbackResponse {
  return { error: '0', message: 'SUCCESS', requestId, ...extra }
}

export function errorResponse(
  requestId: string,
  error: GmagErrorCode,
  message: string,
  extra?: Partial<GmagCallbackResponse>
): GmagCallbackResponse {
  return { error, message, requestId, ...extra }
}

export async function handleGmagAuth(body: GmagAuthBody): Promise<GmagCallbackResponse> {
  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db
    const session = await getCasinoSessionByTokenForProvider(body.token, GMAG_PROVIDER_KEY, txAny)
    if (!session) {
      console.warn(`${LOG_PREFIX} auth fail`, { requestId: body.requestId, reason: 'invalid_or_expired_token' })
      const fallbackCurrency = await getWhitelabelCurrency('default')
      return errorResponse(body.requestId, 'P_06', 'Invalid token or token expired', {
        currency: fallbackCurrency,
        balance: 0,
      })
    }

    const currency = await getWhitelabelCurrency(session.tenant)

    const [userRow] = await txAny
      .select()
      .from(users)
      .where(and(eq(users.id, session.userId), eq(users.tenant, session.tenant)))
      .limit(1)
    if (!userRow || userRow.status !== 'active' || !userRow.casinoBetAllowed) {
      console.warn(`${LOG_PREFIX} auth fail`, { requestId: body.requestId, userId: session.userId, reason: 'inactive_or_bet_blocked' })
      return errorResponse(body.requestId, 'P_07', 'Player is inactive')
    }

    const wallet = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
    const cash = Number(wallet.cash ?? 0)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonus = Number(wallet.referralBonus ?? 0)
    const exposure = Number(wallet.exposure ?? 0)

    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their chips in cash and never
    // play from a bonus wallet, so their balance is always spendable cash (cash - exposure).
    const walletType = casinoWalletTypeFor(isCreditPlayerType(userRow.playerType), session.walletType)

    let balance: number
    if (walletType === 'referralBonus') {
      balance = referralBonus
    } else if (walletType === 'bonus') {
      balance = bonus
    } else {
      balance = cash - exposure
    }

    const last4 = userRow.phone ? String(userRow.phone).slice(-4) : '0000'
    const playerId = `${session.userId}_${last4}`
    const username = userRow.username ?? userRow.name ?? String(session.userId)
    const payload = {
      playerId,
      playerSessionId: session.token,
      currency,
      balance: Number(balance.toFixed(2)),
      country: 'IN',
      username,
    }
    return successResponse(body.requestId, payload)
  })
}

export async function handleGmagBalance(body: GmagBalanceBody): Promise<GmagCallbackResponse> {
  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db
    const session = await getCasinoSessionByTokenForProvider(body.playerSessionId, GMAG_PROVIDER_KEY, txAny)
    if (!session) {
      const fallbackCurrency = await getWhitelabelCurrency('default')
      return errorResponse(body.requestId, 'P_06', 'Invalid token or token expired', {
        currency: fallbackCurrency,
        balance: 0,
      })
    }

    const [userRowBal] = await txAny
      .select({ phone: users.phone, status: users.status, casinoBetAllowed: users.casinoBetAllowed, playerType: users.playerType })
      .from(users)
      .where(and(eq(users.id, session.userId), eq(users.tenant, session.tenant)))
      .limit(1)
    if (!userRowBal || userRowBal.status !== 'active' || !userRowBal.casinoBetAllowed) {
      return errorResponse(body.requestId, 'P_07', 'Player is inactive')
    }
    const last4Bal = userRowBal.phone ? String(userRowBal.phone).slice(-4) : '0000'
    const expectedPlayerIdBal = `${session.userId}_${last4Bal}`
    if (expectedPlayerIdBal !== body.playerId) {
      return errorResponse(body.requestId, 'P_04', 'Player not found')
    }

    const currency = await getWhitelabelCurrency(session.tenant)

    const wallet = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
    const cash = Number(wallet.cash ?? 0)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonus = Number(wallet.referralBonus ?? 0)
    const exposure = Number(wallet.exposure ?? 0)

    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their chips in cash and never
    // play from a bonus wallet, so their balance is always spendable cash (cash - exposure).
    const walletType = casinoWalletTypeFor(isCreditPlayerType(userRowBal.playerType), session.walletType)
    let balance: number
    if (walletType === 'referralBonus') {
      balance = referralBonus
    } else if (walletType === 'bonus') {
      balance = bonus
    } else {
      balance = cash - exposure
    }
    return successResponse(body.requestId, {
      playerId: body.playerId,
      playerSessionId: body.playerSessionId,
      currency,
      balance: Number(balance.toFixed(2)),
    })
  })
}

/**
 * Cash wallet: same validation as GMAG `processOneTrans` bet path (settings, player limits, spendable cash).
 * Caller must pass a wallet row consistent with `FOR UPDATE` (or fresh read). Does not check duplicate txn id.
 */
export async function assertGmagCashBetPlaceAllowed(
  txAny: typeof db,
  args: {
    userId: number
    tenant: string
    amount: number
    gameId: number
    wallet: { cash?: string | null; exposure?: string | null }
  }
): Promise<void> {
  const { userId, tenant, amount, gameId, wallet } = args
  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new Error('Invalid stake')
  }

  // A responsible-gambling block stops the stake. This check was present on
  // the GAP provider's debit path and absent here, so a self-excluded player
  // kept staking through every GMAG game. Read from `users.rg_blocked_until`
  // rather than `users.status`, which several unrelated mutations also write —
  // an admin re-activating an account must not silently resume play for a
  // player who excluded themselves.
  const rgState = await getRgBlockState(tenant, userId, txAny)
  if (rgState.blocked) {
    throw new Error('Responsible gambling block')
  }

  const settings = await getCasinoBetSettings(tenant, gameId, String(userId), txAny)
  if (settings?.minStake != null && amount < settings.minStake) {
    throw new Error('Bet limit')
  }
  if (settings?.maxStake != null && amount > settings.maxStake) {
    throw new Error('Bet limit')
  }
  // The whitelabel's per-game rules: betting switched off, the day's win cap, premium and VIP tiers.
  const gameAccess = await checkCasinoGameAccess(txAny, { tenant, userId, gameId, settings })
  if (gameAccess) {
    throw new CasinoGameAccessError(gameAccess.reason, gameAccess.message)
  }

  const playerLimits = await getPlayerLimitsForUser(userId, tenant)
  if (playerLimits) {
    if (playerLimits.maxBetCasino != null && amount > playerLimits.maxBetCasino) {
      throw new Error('Bet limit exceeded')
    }

    if (playerLimits.dailyStakeLimit != null) {
      const tz = await getWhitelabelTimezone(tenant)
      const todayStart = getStartOfDay(tz)
      const [casinoToday] = await txAny
        .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, todayStart)))
      const [sportsToday] = await txAny
        .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, todayStart)))
      const todayTotalStake = Number(casinoToday?.total ?? 0) + Number(sportsToday?.total ?? 0)
      if (todayTotalStake + amount > playerLimits.dailyStakeLimit) {
        throw new Error('Daily stake limit exceeded')
      }
    }

    if (playerLimits.weeklyStakeLimit != null) {
      const tz = await getWhitelabelTimezone(tenant)
      const weekStart = getStartOfWeek(tz)
      const [casinoWeek] = await txAny
        .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, weekStart)))
      const [sportsWeek] = await txAny
        .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, weekStart)))
      const weekTotalStake = Number(casinoWeek?.total ?? 0) + Number(sportsWeek?.total ?? 0)
      if (weekTotalStake + amount > playerLimits.weeklyStakeLimit) {
        throw new Error('Weekly stake limit exceeded')
      }
    }
  }

  if (playerLimits?.exposureCapOverride != null) {
    const projectedExposure = Number(wallet.exposure ?? 0) + amount
    if (projectedExposure > playerLimits.exposureCapOverride) {
      throw new Error('Exposure cap exceeded')
    }
  }

  if (playerLimits?.cooldownSeconds != null && playerLimits.cooldownSeconds > 0) {
    const cooldownMs = playerLimits.cooldownSeconds * 1000
    const lastCasinoBet = await txAny
      .select({ createdAt: casinoBets.createdAt })
      .from(casinoBets)
      .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant)))
      .orderBy(desc(casinoBets.createdAt))
      .limit(1)
      .then((rows) => rows[0])
    const lastSportsBet = await txAny
      .select({ createdAt: sportsBets.createdAt })
      .from(sportsBets)
      .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant)))
      .orderBy(desc(sportsBets.createdAt))
      .limit(1)
      .then((rows) => rows[0])
    const lastCasinoTime = lastCasinoBet?.createdAt ? new Date(lastCasinoBet.createdAt).getTime() : 0
    const lastSportsTime = lastSportsBet?.createdAt ? new Date(lastSportsBet.createdAt).getTime() : 0
    const lastBetTime = Math.max(lastCasinoTime, lastSportsTime)
    if (lastBetTime > 0) {
      const timeSinceLastBet = Date.now() - lastBetTime
      if (timeSinceLastBet < cooldownMs) {
        throw new Error('Cooldown active')
      }
    }
  }

  const cash = Number(wallet.cash ?? 0)
  const exposure = Number(wallet.exposure ?? 0)
  const balance = cash - exposure
  if (amount > balance) {
    throw new Error(`Player Insufficient Funds (available ${balance.toFixed(2)})`)
  }
}

async function processOneTrans(
  txAny: typeof db,
  session: { userId: number; tenant: string; walletType: 'cash' | 'bonus' | 'referralBonus' },
  body: GmagTransactionBody,
  item: GmagTransItem,
  gameCode: string,
  currency: string
): Promise<{ ok: boolean; error?: GmagErrorCode; message?: string; balance?: number }> {
  const userId = session.userId
  const tenant = session.tenant

  // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their chips in cash and play on the
  // cash path like REGULAR players: the stake comes off cash, a win pays the gross return into
  // cash and a cancel puts the stake back. They never use a bonus wallet, and they get no bonus
  // wagering and no referral loss-share. Computed once per item, inside the caller's txAny.
  const isCreditPlayer = await isCasinoCreditPlayer(txAny, userId, tenant)
  const walletType: CasinoWalletType = casinoWalletTypeFor(isCreditPlayer, session.walletType)

  // Reported balance for the cash wallet type: spendable cash (cash - exposure). Bonus /
  // referralBonus paths never call this. Reads inside txAny.
  const reportCashBalance = async (): Promise<number> => {
    const w = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
    return Number(w.cash ?? 0) - Number(w.exposure ?? 0)
  }

  if (item.transType === 'bet' || item.transType === 'transIn') {
    const amount = Number(item.amount)
    if (amount <= 0) {
      const isDupZero = await checkDuplicateTransactionId(userId, item.transId, txAny)
      if (!isDupZero) {
        const access = (await loadPlayerDomains(txAny, tenant, userId)).casino
        if (!access.canBet) return { ok: false, error: 'P_07', message: access.message || 'Casino betting is unavailable' }
        const game = await getCasinoGameByExternalIdAndProviderKey(gameCode, GMAG_PROVIDER_KEY, txAny)
        if (!game) return { ok: false, error: 'G_01', message: 'Game not found' }
        // A zero-stake round can still pay out, so the per-game rules refuse it like the domain gate does.
        const gameAccess = await checkCasinoGameAccess(txAny, { tenant, userId, gameId: game.id })
        if (gameAccess) return gmagGameAccessError(gameAccess)
        const existingByRound = await findBetsByTransactionAndRound(userId, item.transId, item.roundId, txAny)
        if (!existingByRound.length) {
          const bonusAwardId = walletType === 'bonus' ? await getActiveCasinoBonusAwardId(userId, tenant, txAny) : null
          await createCasinoBet(
            {
              tenant,
              whitelabelId: tenant,
              userId,
              gameId: game.id,
              gameName: game.name,
              providerId: game.providerId,
              vendorId: game.vendorId,
              vendorName: game.vendorName,
              tableId: game.tableId,
              stake: '0',
              transactionId: item.transId,
              gameRoundId: item.roundId,
              walletType,
              bonusAwardId,
              currency,
            },
            txAny
          )
        }
      }
      const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
        : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
        : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
      return { ok: true, balance: Number(balNow.toFixed(2)) }
    }
    const game = await getCasinoGameByExternalIdAndProviderKey(gameCode, GMAG_PROVIDER_KEY, txAny)
    if (!game) {
      console.warn(`${LOG_PREFIX} bet rejected`, { userId, gameCode, reason: 'game_not_found' })
      return { ok: false, error: 'G_01', message: 'Game not found' }
    }
    const settings = await getCasinoBetSettings(tenant, game.id, String(userId), txAny)
    if (settings?.minStake != null && amount < settings.minStake) {
      return { ok: false, error: 'T_04', message: 'Bet limit' }
    }
    if (settings?.maxStake != null && amount > settings.maxStake) {
      return { ok: false, error: 'T_04', message: 'Bet limit' }
    }
    const playerLimits = await getPlayerLimitsForUser(userId, tenant)
    if (playerLimits) {
      if (playerLimits.maxBetCasino != null && amount > playerLimits.maxBetCasino) {
        return { ok: false, error: 'T_04', message: 'Bet limit exceeded' }
      }

      // Daily stake limit (sports + casino combined)
      if (playerLimits.dailyStakeLimit != null) {
        const tz = await getWhitelabelTimezone(tenant)
        const todayStart = getStartOfDay(tz)
        const [casinoToday] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
          .from(casinoBets)
          .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, todayStart)))
        const [sportsToday] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
          .from(sportsBets)
          .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, todayStart)))
        const todayTotalStake = Number(casinoToday?.total ?? 0) + Number(sportsToday?.total ?? 0)
        if (todayTotalStake + amount > playerLimits.dailyStakeLimit) {
          return { ok: false, error: 'T_04', message: 'Daily stake limit exceeded' }
        }
      }

      // Weekly stake limit (sports + casino combined)
      if (playerLimits.weeklyStakeLimit != null) {
        const tz = await getWhitelabelTimezone(tenant)
        const weekStart = getStartOfWeek(tz)
        const [casinoWeek] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
          .from(casinoBets)
          .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, weekStart)))
        const [sportsWeek] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
          .from(sportsBets)
          .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, weekStart)))
        const weekTotalStake = Number(casinoWeek?.total ?? 0) + Number(sportsWeek?.total ?? 0)
        if (weekTotalStake + amount > playerLimits.weeklyStakeLimit) {
          return { ok: false, error: 'T_04', message: 'Weekly stake limit exceeded' }
        }
      }
    }

    const wallet = await ensureWalletWithExecutor(txAny, userId, tenant, currency)

    if (playerLimits?.exposureCapOverride != null) {
      const projectedExposure = Number(wallet.exposure ?? 0) + amount
      if (projectedExposure > playerLimits.exposureCapOverride) {
        return { ok: false, error: 'T_04', message: 'Exposure cap exceeded' }
      }
    }

    if (playerLimits?.cooldownSeconds != null && playerLimits.cooldownSeconds > 0) {
      const cooldownMs = playerLimits.cooldownSeconds * 1000
      const lastCasinoBet = await txAny
        .select({ createdAt: casinoBets.createdAt })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant)))
        .orderBy(desc(casinoBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])
      const lastSportsBet = await txAny
        .select({ createdAt: sportsBets.createdAt })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant)))
        .orderBy(desc(sportsBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])
      const lastCasinoTime = lastCasinoBet?.createdAt ? new Date(lastCasinoBet.createdAt).getTime() : 0
      const lastSportsTime = lastSportsBet?.createdAt ? new Date(lastSportsBet.createdAt).getTime() : 0
      const lastBetTime = Math.max(lastCasinoTime, lastSportsTime)
      if (lastBetTime > 0) {
        const timeSinceLastBet = Date.now() - lastBetTime
        if (timeSinceLastBet < cooldownMs) {
          return { ok: false, error: 'T_04', message: 'Cooldown active' }
        }
      }
    }
    const cash = Number(wallet.cash ?? 0)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonusBal = Number(wallet.referralBonus ?? 0)
    const exposure = Number(wallet.exposure ?? 0)
    const balance =
      walletType === 'referralBonus' ? referralBonusBal : walletType === 'bonus' ? bonus : cash - exposure
    if (amount > balance) {
      console.warn(`${LOG_PREFIX} bet rejected`, {
        userId,
        transId: item.transId,
        roundId: item.roundId,
        stake: amount,
        available: Number(balance.toFixed(2)),
        reason: 'insufficient_funds',
      })
      return { ok: false, error: 'T_01', message: 'Player Insufficient Funds', balance: Number(balance.toFixed(2)) }
    }
    const isDup = await checkDuplicateTransactionId(userId, item.transId, txAny)
    if (isDup) {
      const balNow = walletType === 'referralBonus' || walletType === 'bonus'
        ? await (async () => {
            const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
            return walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0) : Number(walletNow.bonus ?? 0)
          })()
        : await reportCashBalance()
      return { ok: true, balance: Number(balNow.toFixed(2)) }
    }
    // Agent players: no new stake while the agent or any ancestor is not ACTIVE, or when the
    // agent lacks the casino domain. P_07 is the code GMAG already gets for a blocked player.
    const domainAccess = (await loadPlayerDomains(txAny, tenant, userId)).casino
    if (!domainAccess.canBet) return { ok: false, error: 'P_07', message: domainAccess.message || 'Casino betting is unavailable' }

    // Duplicates were answered above, so a retried bet that was accepted still succeeds.
    const agentGate = await checkPlayerAgentBettingGate(txAny, { userId, tenant }, 'casino')
    if (!agentGate.ok) {
      console.warn(`${LOG_PREFIX} bet rejected`, {
        userId,
        transId: item.transId,
        roundId: item.roundId,
        stake: amount,
        reason: agentGate.reason,
      })
      return { ok: false, error: 'P_07', message: agentGate.message }
    }
    // The whitelabel's per-game rules: betting switched off, the day's win cap, premium and VIP
    // tiers. After the duplicate check, like the gates above, so an accepted bet's retry succeeds.
    const gameAccess = await checkCasinoGameAccess(txAny, { tenant, userId, gameId: game.id, settings })
    if (gameAccess) {
      console.warn(`${LOG_PREFIX} bet rejected`, {
        userId,
        transId: item.transId,
        roundId: item.roundId,
        stake: amount,
        reason: gameAccess.reason,
      })
      return gmagGameAccessError(gameAccess)
    }
    const bonusAwardId = walletType === 'bonus' ? await getActiveCasinoBonusAwardId(userId, tenant, txAny) : null
    // A credit player's chips are cash, so this takes their stake too.
    await debitWalletForCasino(txAny, userId, tenant, amount, walletType, {
      type: 'casino_bet',
      transactionId: item.transId,
      roundId: item.roundId,
    }, currency)
    await createCasinoBet(
      {
        tenant,
        whitelabelId: tenant,
        userId,
        gameId: game.id,
        gameName: game.name,
        providerId: game.providerId,
        vendorId: game.vendorId,
        vendorName: game.vendorName,
        tableId: game.tableId,
        stake: String(amount),
        transactionId: item.transId,
        gameRoundId: item.roundId,
        walletType,
        bonusAwardId,
        currency,
      },
      txAny
    )
    const walletAfter = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
    const bonusAfterDebit = Number(walletAfter.bonus ?? 0)

    if (walletType === 'bonus' && bonusAwardId != null && bonusAfterDebit === 0) {
      const campaignRow = await txAny
        .select({ distributionType: bonusCampaigns.distributionType })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(and(eq(bonusAwards.id, bonusAwardId), eq(bonusCampaigns.tenant, tenant)))
        .limit(1)
        .then((rows: { distributionType: string | null }[]) => rows[0])
      if (campaignRow?.distributionType === 'instant_otp') {
        await txAny
          .update(bonusAwards)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(bonusAwards.id, bonusAwardId))
      }
    }

    const balanceAfter =
      walletType === 'referralBonus'
        ? Number(walletAfter.referralBonus ?? 0)
        : walletType === 'bonus'
          ? bonusAfterDebit
          : Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
    return { ok: true, balance: Number(balanceAfter.toFixed(2)) }
  }

  if (item.transType === 'win' || item.transType === 'transOut') {
    const creditAmount = Number(item.amount)

    // --- Per-bet resolution using referenceId (Aviator dual-bet support) ---
    // GMAG win callbacks carry referenceId = original bet transactionId.
    // When present, resolve exactly that one bet so each cashout is credited
    // independently — prevents the split-by-n bug in dual-bet rounds.
    const refId = item.referenceId ?? null

    if (refId) {
      // GMAG derives every id in a round from one uuid and prefixes it by type: the bet
      // arrives as (and is stored under) "D"+uuid, while the win's referenceId is the BARE
      // uuid. Matching referenceId against transaction_id directly therefore never hit, and
      // this branch returned R_02 with the stake already debited — incident CS-22135, where
      // 4 rounds stranded 10,000 INR and refused 8,500 INR of winnings. Ask for every id the
      // bet may legitimately be stored under, exact value first (see gmagBetReference.ts).
      const candidates = gmagBetReferenceCandidates(refId)

      let matchedActive: CasinoBetRow | null = null
      for (const candidate of candidates) {
        const found = await findActiveBetByTransactionId(userId, candidate.id, txAny)
        if (!found) continue
        // A derived candidate must also agree on the round — see isAcceptableCandidateMatch.
        if (!isAcceptableCandidateMatch({ exact: candidate.exact, betRoundId: found.gameRoundId, callbackRoundId: item.roundId })) {
          console.warn(`${LOG_PREFIX} candidate match rejected (round mismatch)`, {
            userId,
            referenceId: refId,
            candidate: candidate.id,
            betId: found.id,
            betRoundId: found.gameRoundId,
            callbackRoundId: item.roundId,
          })
          continue
        }
        matchedActive = found
        break
      }

      let betsAnyStatus: CasinoBetRow[] = []
      if (!matchedActive) {
        for (const candidate of candidates) {
          const found = await findBetsByTransactionIdAnyStatus(userId, candidate.id, txAny)
          const acceptable = found.filter((b) =>
            isAcceptableCandidateMatch({ exact: candidate.exact, betRoundId: b.gameRoundId, callbackRoundId: item.roundId })
          )
          if (acceptable.length) {
            betsAnyStatus = acceptable
            break
          }
        }
      }

      let resolution = resolveGmagWinTarget({
        activeBet: matchedActive,
        betsAnyStatus,
        winTransId: item.transId,
      })

      // Safety net: an unmatched reference must not strand a round we are holding a bet for.
      //
      // ORDER IS CRITICAL — the replay guard must come BEFORE the recovery.
      // A bet recovered by round keeps its original transaction_id, so the candidate lookups
      // above can never see it again. Without this guard the first delivery would settle and
      // credit, and every redelivery of the same payload would find no candidate, find no
      // ACTIVE bet left in the round, and answer R_02 forever — recreating the exact stuck
      // round of CS-22135 with the money already paid out. Worse, if a second bet were active
      // in that round on the retry, pickSoleRoundBet would hand back that DIFFERENT bet and
      // credit the same win twice (checkDuplicateResultTransactionIdForBet is per-bet and
      // cannot see the first settlement). So: ask the ROUND whether we already applied this
      // win transId, exactly as the no-referenceId path does further below.
      if (resolution.kind === 'unknown_reference') {
        const roundAll = await findAllBetsByUserIdAndRoundId(userId, item.roundId, txAny)
        if (roundAll.some((b) => b.resultTransactionId === item.transId)) {
          resolution = { kind: 'duplicate' }
        } else {
          // Only recover when the round has exactly ONE active bet — then there is nothing to
          // disambiguate. With two or more we cannot tell which bet the win belongs to, and the
          // round-level path divides the payout by bet count (the dual-bet split bug this
          // per-reference branch exists to avoid), so we reject rather than mis-book money.
          const roundActive = await findActiveBetsByUserIdAndRoundId(userId, item.roundId, txAny)
          const soleRoundBet = pickSoleRoundBet(roundActive)
          if (soleRoundBet) {
            console.warn(`${LOG_PREFIX} result recovered via round fallback`, {
              userId,
              referenceId: refId,
              roundId: item.roundId,
              resultTransId: item.transId,
              betId: soleRoundBet.id,
              storedTransactionId: soleRoundBet.transactionId,
            })
            resolution = { kind: 'settle', bet: soleRoundBet }
          }
        }
      }

      if (resolution.kind === 'unknown_reference') {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
          : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        console.warn(`${LOG_PREFIX} result rejected`, {
          userId,
          referenceId: refId,
          candidates,
          roundId: item.roundId,
          resultTransId: item.transId,
          reason: 'unknown_bet_reference',
        })
        return { ok: false, error: 'R_02', message: 'Invalid round when win', balance: Number(balNow.toFixed(2)) }
      }

      if (resolution.kind === 'duplicate') {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
          : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        return { ok: true, balance: Number(balNow.toFixed(2)) }
      }

      const targetBet = resolution.bet
      const targetAlreadySettled = resolution.kind === 'additional_win'

      // Per-bet duplicate check
      const hasBetDup = await checkDuplicateResultTransactionIdForBet(targetBet.id, item.transId, txAny)
      if (hasBetDup) {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
          : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        return { ok: true, balance: Number(balNow.toFixed(2)) }
      }

      const hasRollback = await checkAnyBetHasRollback(userId, targetBet.transactionId ?? '', item.roundId, txAny)
      if (hasRollback) {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
          : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        return { ok: true, balance: Number(balNow.toFixed(2)) }
      }

      const betStake = targetAlreadySettled ? 0 : Number(targetBet.stake ?? 0)
      const pl = creditAmount - betStake
      const status: 'won' | 'lost' = creditAmount === 0 ? 'lost' : 'won'
      let anyBetTransitioned = false

      if (!targetAlreadySettled) {
        const updated = await updateBetResult(
          targetBet.id,
          {
            status,
            netAmount: String(Number(pl.toFixed(2))),
            winAmount: String(Number(creditAmount.toFixed(2))),
            payout: String(Number(creditAmount.toFixed(2))),
            resultTransactionId: item.transId,
          },
          txAny
        )
        if (updated) anyBetTransitioned = true
      } else {
        // Additional win for an already-settled bet (e.g. jackpot top-up). Credit wallet only.
        anyBetTransitioned = true
      }

      if (anyBetTransitioned) {
        const totalStake = betStake
        const bonusAwardId = targetBet.bonusAwardId
        const isReferralBonus = walletType === 'referralBonus'
        const instantOtpBonusRow = await (async () => {
          if (isReferralBonus || walletType !== 'bonus' || !bonusAwardId) return null
          const row = await txAny
            .select({ distributionType: bonusCampaigns.distributionType, campaignId: bonusAwards.campaignId })
            .from(bonusAwards)
            .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
            .where(and(eq(bonusAwards.id, bonusAwardId), eq(bonusCampaigns.tenant, tenant)))
            .limit(1)
            .then((rows: any[]) => rows[0])
          return row?.distributionType === 'instant_otp' ? row : null
        })()
        const isInstantOtpBonus = !!instantOtpBonusRow

        if (isReferralBonus) {
          const profit = Math.max(creditAmount - totalStake, 0)
          if (profit > 0) {
            const wallet = await getWalletByUserIdWithExecutor(txAny, userId, tenant)
            if (wallet) {
              const refBonusBefore = Number(wallet.referralBonus ?? 0)
              await createWalletLedgerEntry(txAny, { tenant, walletId: wallet.id, userId, walletType: 'referralBonus', category: 'casino_win', direction: 'credit', amount: profit, balanceBefore: refBonusBefore, balanceAfter: refBonusBefore + profit, description: 'Casino win (pass-through)', referenceType: 'casino_win', referenceId: item.transId ?? undefined, meta: { transactionId: item.transId, roundId: item.roundId } })
              await createWalletLedgerEntry(txAny, { tenant, walletId: wallet.id, userId, walletType: 'referralBonus', category: 'referral_transfer', direction: 'debit', amount: profit, balanceBefore: refBonusBefore + profit, balanceAfter: refBonusBefore, description: 'Transfer to referral balance', referenceType: 'casino_win', referenceId: item.transId ?? undefined, meta: { transactionId: item.transId, roundId: item.roundId } })
            }
            await creditReferralBalanceForCasino(txAny, userId, tenant, profit, { type: 'casino_win', transactionId: item.transId, roundId: item.roundId, subType: 'referral_bonus_profit' })
          }
        } else if (isInstantOtpBonus) {
          const profit = Math.max(creditAmount - totalStake, 0)
          if (profit > 0) {
            const wallet = await getWalletByUserIdWithExecutor(txAny, userId, tenant)
            if (wallet) {
              const bonusBefore = Number(wallet.bonus ?? 0)
              await createWalletLedgerEntry(txAny, { tenant, walletId: wallet.id, userId, walletType: 'bonus', category: 'casino_win', direction: 'credit', amount: profit, balanceBefore: bonusBefore, balanceAfter: bonusBefore + profit, description: 'Casino win (pass-through)', referenceType: 'bonus_to_cash', referenceId: item.transId ?? undefined, meta: { transactionId: item.transId, roundId: item.roundId, bonusAwardId } })
              await createWalletLedgerEntry(txAny, { tenant, walletId: wallet.id, userId, walletType: 'bonus', category: 'bonus_transfer', direction: 'debit', amount: profit, balanceBefore: bonusBefore + profit, balanceAfter: bonusBefore, description: 'Transfer to cash', referenceType: 'bonus_to_cash', referenceId: item.transId ?? undefined, meta: { transactionId: item.transId, roundId: item.roundId, bonusAwardId } })
            }
            const campaignId = instantOtpBonusRow?.campaignId ?? undefined
            await creditWalletForCasino(txAny, userId, tenant, profit, 'cash', { type: 'bonus_to_cash', remark: 'BONUS TO CASH', transactionId: item.transId, roundId: item.roundId, bonusAwardId: bonusAwardId ?? undefined, campaignId })
            const { deductWhitelabelCredit } = await import('@shared/services/whitelabelCreditDeduct.js')
            const currencyForCredit = await getWhitelabelCurrency(tenant)
            await deductWhitelabelCredit(txAny, tenant, profit, currencyForCredit, `Instant OTP bonus profit to cash - userId=${userId} betId=${targetBet.id}`, { userId })
          }
        } else {
          if (creditAmount > 0) {
            await creditWalletForCasino(txAny, userId, tenant, creditAmount, walletType, { type: 'casino_win', transactionId: item.transId, roundId: item.roundId })
          }
        }

        // Credit players get no bonuses (nothing to wager) and pay no referral loss-share.
        if (!isReferralBonus && !isInstantOtpBonus && !isCreditPlayer) {
          const gameIdForWagering = targetBet.gameId ? String(targetBet.gameId) : undefined
          await updateBonusWagering(userId, tenant, totalStake, 'casino', gameIdForWagering, walletType, txAny)
        }

        if (pl < 0 && !isCreditPlayer) {
          const netAmountForReferral = pl
          const referralCurrency = (targetBet.currency ?? currency) as string
          const betSnapshot = targetBet
          const tenantSnapshot = tenant
          const userIdSnapshot = userId
          setImmediate(async () => {
            const { triggerReferralBetSettlement } = await import('../../services/referralBetSettlementTrigger.js')
            try {
              await triggerReferralBetSettlement({
                tenant: tenantSnapshot,
                userId: userIdSnapshot,
                netRevenue: Number(netAmountForReferral),
                currency: referralCurrency,
                domain: 'casino',
                betId: betSnapshot.id,
              })
            } catch (_) {}
          })
        }
      }

      const walletAfter = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const balanceAfter = walletType === 'referralBonus'
        ? Number(walletAfter.referralBonus ?? 0)
        : walletType === 'bonus'
          ? Number(walletAfter.bonus ?? 0)
          : Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
      return { ok: true, balance: Number(balanceAfter.toFixed(2)) }
    }

    // --- Round-level resolution (no referenceId — single-bet rounds or non-Aviator games) ---
    let bets = await findActiveBetsByUserIdAndRoundId(userId, item.roundId, txAny)
    let betsAlreadySettled = false
    if (!bets.length) {
      // No active bets - check if settled bets exist for this round (multiple wins / retry scenario)
      const allRoundBets = await findAllBetsByUserIdAndRoundId(userId, item.roundId, txAny)
      if (!allRoundBets.length) {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
          : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        console.warn(`${LOG_PREFIX} result rejected`, {
          userId,
          roundId: item.roundId,
          resultTransId: item.transId,
          reason: 'invalid_round_no_bets',
        })
        return { ok: false, error: 'R_02', message: 'Invalid round when win', balance: Number(balNow.toFixed(2)) }
      } else {
        // Check idempotent win retry — same transId already processed for this round
        const alreadyProcessed = allRoundBets.some(b => b.resultTransactionId === item.transId)
        if (alreadyProcessed) {
          const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
          const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
            : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
            : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
          return { ok: true, balance: Number(balNow.toFixed(2)) }
        }
        // Settled bets exist — additional win credit for same round (e.g. multiple wins, live casino)
        bets = allRoundBets
        betsAlreadySettled = true
      }
    }

    const hasDup = await checkDuplicateResultTransactionId(userId, item.roundId, item.transId, txAny)
    if (hasDup) {
      const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
        : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
        : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
      return { ok: true, balance: Number(balNow.toFixed(2)) }
    }

    const hasRollback = await checkAnyBetHasRollback(userId, bets[0].transactionId ?? '', item.roundId, txAny)
    if (hasRollback) {
      const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const balNow = walletType === 'referralBonus' ? Number(walletNow.referralBonus ?? 0)
        : walletType === 'bonus' ? Number(walletNow.bonus ?? 0)
        : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
      return { ok: true, balance: Number(balNow.toFixed(2)) }
    }

    // For already-settled bets (additional win), totalStake = 0 — original stake already debited
    const totalStake = betsAlreadySettled ? 0 : bets.reduce((s, b) => s + Number(b.stake ?? 0), 0)
    const pl = creditAmount - totalStake
    const status: 'won' | 'lost' = creditAmount === 0 ? 'lost' : 'won'
    const n = bets.length
    const netPerBet = n > 0 ? pl / n : 0
    const winPerBet = n > 0 ? creditAmount / n : 0
    let anyBetTransitioned = false
    if (!betsAlreadySettled) {
      for (const bet of bets) {
        const updated = await updateBetResult(
          bet.id,
          {
            status,
            netAmount: String(Number(netPerBet.toFixed(2))),
            winAmount: String(Number(winPerBet.toFixed(2))),
            payout: String(Number(winPerBet.toFixed(2))),
            resultTransactionId: item.transId,
          },
          txAny
        )
        if (updated) {
          anyBetTransitioned = true
        }
      }
    }
    if (betsAlreadySettled) {
      // Additional win for an already-settled round (e.g. live casino jackpot/multi-win).
      // No bet row update needed; just credit the wallet below.
      anyBetTransitioned = true
    }

    // Cash settlement (referral / instant-OTP / cash credit + wagering + referral trigger).
    // Credit players take the cash credit too; they skip only the wagering and referral hooks.
    if (anyBetTransitioned) {
    const bonusAwardId = bets[0].bonusAwardId
    const isReferralBonus = walletType === 'referralBonus'
    const instantOtpBonusRow = await (async () => {
      if (isReferralBonus || walletType !== 'bonus' || !bonusAwardId) return null
      const row = await txAny
        .select({
          distributionType: bonusCampaigns.distributionType,
          campaignId: bonusAwards.campaignId,
        })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(and(eq(bonusAwards.id, bonusAwardId), eq(bonusCampaigns.tenant, tenant)))
        .limit(1)
        .then((rows: any[]) => rows[0])
      return row?.distributionType === 'instant_otp' ? row : null
    })()
    const isInstantOtpBonus = !!instantOtpBonusRow

    if (isReferralBonus) {
      const profit = Math.max(creditAmount - totalStake, 0)
      if (profit > 0) {
        const wallet = await getWalletByUserIdWithExecutor(txAny, userId, tenant)
        if (wallet) {
          const refBonusBefore = Number(wallet.referralBonus ?? 0)
          await createWalletLedgerEntry(txAny, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'referralBonus',
            category: 'casino_win',
            direction: 'credit',
            amount: profit,
            balanceBefore: refBonusBefore,
            balanceAfter: refBonusBefore + profit,
            description: 'Casino win (pass-through)',
            referenceType: 'casino_win',
            referenceId: item.transId ?? undefined,
            meta: { transactionId: item.transId, roundId: item.roundId },
          })
          await createWalletLedgerEntry(txAny, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'referralBonus',
            category: 'referral_transfer',
            direction: 'debit',
            amount: profit,
            balanceBefore: refBonusBefore + profit,
            balanceAfter: refBonusBefore,
            description: 'Transfer to referral balance',
            referenceType: 'casino_win',
            referenceId: item.transId ?? undefined,
            meta: { transactionId: item.transId, roundId: item.roundId },
          })
        }
        await creditReferralBalanceForCasino(txAny, userId, tenant, profit, {
          type: 'casino_win',
          transactionId: item.transId,
          roundId: item.roundId,
          subType: 'referral_bonus_profit',
        })
      }
    } else if (isInstantOtpBonus) {
      const profit = Math.max(creditAmount - totalStake, 0)
      if (profit > 0) {
        const wallet = await getWalletByUserIdWithExecutor(txAny, userId, tenant)
        if (wallet) {
          const bonusBefore = Number(wallet.bonus ?? 0)
          await createWalletLedgerEntry(txAny, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'bonus',
            category: 'casino_win',
            direction: 'credit',
            amount: profit,
            balanceBefore: bonusBefore,
            balanceAfter: bonusBefore + profit,
            description: 'Casino win (pass-through)',
            referenceType: 'bonus_to_cash',
            referenceId: item.transId ?? undefined,
            meta: { transactionId: item.transId, roundId: item.roundId, bonusAwardId },
          })
          await createWalletLedgerEntry(txAny, {
            tenant,
            walletId: wallet.id,
            userId,
            walletType: 'bonus',
            category: 'bonus_transfer',
            direction: 'debit',
            amount: profit,
            balanceBefore: bonusBefore + profit,
            balanceAfter: bonusBefore,
            description: 'Transfer to cash',
            referenceType: 'bonus_to_cash',
            referenceId: item.transId ?? undefined,
            meta: { transactionId: item.transId, roundId: item.roundId, bonusAwardId },
          })
        }
        const campaignId = instantOtpBonusRow?.campaignId ?? undefined
        await creditWalletForCasino(txAny, userId, tenant, profit, 'cash', {
          type: 'bonus_to_cash',
          remark: 'BONUS TO CASH',
          transactionId: item.transId,
          roundId: item.roundId,
          bonusAwardId: bonusAwardId ?? undefined,
          campaignId,
        })
        const { deductWhitelabelCredit } = await import('@shared/services/whitelabelCreditDeduct.js')
        const currency = await getWhitelabelCurrency(tenant)
        await deductWhitelabelCredit(txAny, tenant, profit, currency, `Instant OTP bonus profit to cash - userId=${userId} betId=${bets[0]?.id ?? 'n/a'}`, {
          userId,
        })
      }
    } else {
      if (creditAmount > 0) {
        await creditWalletForCasino(txAny, userId, tenant, creditAmount, walletType, {
          type: 'casino_win',
          transactionId: item.transId,
          roundId: item.roundId,
        })
      }
    }

    // Credit players get no bonuses (nothing to wager) and pay no referral loss-share.
    if (!isReferralBonus && !isInstantOtpBonus && !isCreditPlayer) {
      const gameIdForWagering = bets[0]?.gameId ? String(bets[0].gameId) : undefined
      await updateBonusWagering(userId, tenant, totalStake, 'casino', gameIdForWagering, walletType, txAny)
    }

    const netAmountSnapshot = netPerBet
    if (Number(netAmountSnapshot) < 0 && !isCreditPlayer) {
      const referralCurrency = (bets[0]?.currency ?? currency) as string
      const betsSnapshot = [...bets]
      const tenantSnapshot = tenant
      const userIdSnapshot = userId
      setImmediate(async () => {
        const { triggerReferralBetSettlement } = await import('../../services/referralBetSettlementTrigger.js')
        for (const bet of betsSnapshot) {
          try {
            await triggerReferralBetSettlement({
              tenant: tenantSnapshot,
              userId: userIdSnapshot,
              netRevenue: Number(netAmountSnapshot),
              currency: referralCurrency,
              domain: 'casino',
              betId: bet.id,
            })
          } catch (err) {
          }
        }
      })
    }
    }

    const walletAfter = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
    const balanceAfter =
      walletType === 'referralBonus'
        ? Number(walletAfter.referralBonus ?? 0)
        : walletType === 'bonus'
          ? Number(walletAfter.bonus ?? 0)
          : Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
    return { ok: true, balance: Number(balanceAfter.toFixed(2)) }
  }

  if (item.transType === 'cancel') {
    // Identical prefix problem to the win path: referenceId is the bare uuid while the bet is
    // stored under a type-marked id ("D"/"d" + uuid), so exact matching missed and every cancel
    // died as T_03. Same candidate cascade, same derived-match round guard.
    const referenceId = item.referenceId ?? item.transId
    const candidates = gmagBetReferenceCandidates(referenceId)
    const acceptable = (candidate: { exact: boolean }, rows: CasinoBetRow[]) =>
      rows.filter((b) =>
        isAcceptableCandidateMatch({ exact: candidate.exact, betRoundId: b.gameRoundId, callbackRoundId: item.roundId })
      )

    let bets: CasinoBetRow[] = []
    for (const candidate of candidates) {
      const found = acceptable(candidate, await findBetsByTransactionIdForRollback(userId, candidate.id, txAny))
      if (found.length) {
        bets = found
        break
      }
    }

    // Same round-level safety net as the win path, and for the same reason: a round the win
    // path recovered by round still carries its original transaction_id, so no candidate id can
    // reach it. Without this a fallback-settled round could never be reversed — the cancel would
    // die as T_03 and the credit would be unreclaimable. Restricted to a single-bet round so we
    // never guess which of several bets a cancel meant.
    if (!bets.length) {
      const soleActive = pickSoleRoundBet(await findActiveBetsByUserIdAndRoundId(userId, item.roundId, txAny))
      if (soleActive) {
        console.warn(`${LOG_PREFIX} cancel recovered via round fallback`, {
          userId,
          referenceId,
          roundId: item.roundId,
          transId: item.transId,
          betId: soleActive.id,
          storedTransactionId: soleActive.transactionId,
        })
        bets = [soleActive]
      }
    }

    if (!bets.length) {
      let allBets: CasinoBetRow[] = []
      for (const candidate of candidates) {
        const found = acceptable(candidate, await findBetsByTransactionIdAnyStatus(userId, candidate.id, txAny))
        if (found.length) {
          allBets = found
          break
        }
      }
      // Round-level last resort before declaring the transaction unknown.
      if (!allBets.length) {
        allBets = await findAllBetsByUserIdAndRoundId(userId, item.roundId, txAny)
      }
      if (!allBets.length) {
        console.warn(`${LOG_PREFIX} cancel rejected`, {
          userId,
          referenceId,
          candidates,
          roundId: item.roundId,
          transId: item.transId,
          reason: 'unknown_bet_reference',
        })
        return { ok: false, error: 'T_03', message: 'Transaction not found' }
      }
      const alreadyVoided = allBets.every(b => b.status === 'void')
      if (alreadyVoided) {
        const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
        const balNow =
          walletType === 'referralBonus'
            ? Number(walletNow.referralBonus ?? 0)
            : walletType === 'bonus'
              ? Number(walletNow.bonus ?? 0)
              : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
        return { ok: true, balance: Number(balNow.toFixed(2)) }
      }
      // Bets exist for this reference but none are active and not all are void — i.e. the
      // round already settled won/lost. We acknowledge (returning an error would make the
      // provider retry forever) but we do NOT reverse the settlement, so our books and the
      // provider's now disagree. Before the prefix fix this branch was unreachable because
      // the lookup missed entirely; it is reachable now, so make it loud instead of silent.
      // TODO(CS-22135): confirm with GMAG what a post-settlement cancel should do — a
      // reversal may be required rather than this acknowledge-and-keep behaviour.
      console.warn(`${LOG_PREFIX} cancel acknowledged WITHOUT reversal — settled bets`, {
        userId,
        referenceId,
        roundId: item.roundId,
        transId: item.transId,
        bets: allBets.map((b) => ({ id: b.id, status: b.status, stake: b.stake })),
        reason: 'cancel_after_settlement',
      })
      const walletNow = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const balNow =
        walletType === 'referralBonus'
          ? Number(walletNow.referralBonus ?? 0)
          : walletType === 'bonus'
            ? Number(walletNow.bonus ?? 0)
            : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
      return { ok: true, balance: Number(balNow.toFixed(2)) }
    }
    const hasDup = await checkDuplicateRollbackTransactionId(userId, item.roundId, item.transId, txAny)
    if (hasDup) return { ok: false, error: 'T_02', message: 'Duplicate Transaction Id' }
    const rollbackAmount = bets.reduce((s, b) => s + Number(b.stake ?? 0), 0)
    const wType = casinoWalletTypeFor(isCreditPlayer, bets[0].walletType)

    // Instant OTP bonus rollback: no wallet credit
    let isInstantOtpRollback = false
    if (wType === 'bonus' && bets[0].bonusAwardId != null) {
      const campaignRow = await txAny
        .select({ distributionType: bonusCampaigns.distributionType })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(and(eq(bonusAwards.id, bets[0].bonusAwardId), eq(bonusCampaigns.tenant, tenant)))
        .limit(1)
        .then((rows: { distributionType: string | null }[]) => rows[0])
      if (campaignRow?.distributionType === 'instant_otp') {
        isInstantOtpRollback = true
      }
    }

    let anyRollbackTransitioned = false
    for (const bet of bets) {
      const updated = await updateBetRollback(bet.id, item.transId, txAny)
      if (updated) {
        anyRollbackTransitioned = true
      }
    }
    const betsSnapshot = [...bets]
    const tenantSnapshot = tenant
    const userIdSnapshot = userId
    // A credit player's losses never paid a referral loss-share, so there is nothing to reverse.
    if (anyRollbackTransitioned && !isCreditPlayer) {
    setImmediate(async () => {
      const { triggerReferralBetSettlementReversal } = await import('../../services/referralBetSettlementTrigger.js')
      for (const bet of betsSnapshot) {
        try {
          await triggerReferralBetSettlementReversal({
            tenant: tenantSnapshot,
            userId: userIdSnapshot,
            betId: bet.id,
            domain: 'casino',
          })
        } catch (err) {
        }
      }
    })
    }

    // The stake goes back to the wallet it came from (cash for a credit player's chips).
    if (anyRollbackTransitioned && !isInstantOtpRollback) {
      await creditWalletForCasino(txAny, userId, tenant, rollbackAmount, wType, {
        type: 'casino_rollback',
        // Must be the id the ORIGINAL debit ledger row was written under (item.transId at
        // placement, i.e. the D-prefixed value now on the bet row) — not the bare
        // referenceId. restoreCasinoStakeAndStripPlacementLedgers matches placement rows on
        // meta->>'transactionId', so a mismatched id makes the refund uncorrelatable and
        // makes that cleanup silently delete nothing.
        transactionId: bets[0].transactionId ?? referenceId,
        roundId: item.roundId,
      })
    }

    const walletAfter = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
    const balanceAfter =
      wType === 'referralBonus'
        ? Number(walletAfter.referralBonus ?? 0)
        : wType === 'bonus'
          ? Number(walletAfter.bonus ?? 0)
          : Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
    return { ok: true, balance: Number(balanceAfter.toFixed(2)) }
  }

  return { ok: true }
}

export async function handleGmagTransaction(body: GmagTransactionBody): Promise<GmagCallbackResponse> {
  const gameCode = body.gameCode ?? ''
  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db
    const session = await getCasinoSessionByTokenForProvider(body.playerSessionId, GMAG_PROVIDER_KEY, txAny)
    if (!session) {
      const fallbackCurrency = await getWhitelabelCurrency('default')
      return errorResponse(body.requestId, 'P_06', 'Invalid token or token expired', {
        playerId: body.playerId,
        playerSessionId: body.playerSessionId,
        currency: fallbackCurrency,
        balance: 0,
      })
    }

    const [userRowTx] = await txAny
      .select({ phone: users.phone, status: users.status, casinoBetAllowed: users.casinoBetAllowed, playerType: users.playerType })
      .from(users)
      .where(and(eq(users.id, session.userId), eq(users.tenant, session.tenant)))
      .limit(1)
    // Settlements/refunds remain available after the operator hides or disables new play.
    if (!userRowTx) {
      return errorResponse(body.requestId, 'P_07', 'Player is inactive')
    }
    const last4Tx = userRowTx.phone ? String(userRowTx.phone).slice(-4) : '0000'
    const expectedPlayerIdTx = `${session.userId}_${last4Tx}`
    if (expectedPlayerIdTx !== body.playerId) {
      return errorResponse(body.requestId, 'P_04', 'Player not found')
    }

    const currency = await getWhitelabelCurrency(session.tenant)

    // Wallet for the batch-level balance reads (error fallback + final success). A credit
    // player's chips are cash whatever the session names; processOneTrans applies the same rule.
    const reportWalletType = casinoWalletTypeFor(isCreditPlayerType(userRowTx.playerType), session.walletType)

    for (let i = 0; i < body.trans.length; i++) {
      const item = body.trans[i]
      const result = await processOneTrans(
        txAny,
        { userId: session.userId, tenant: session.tenant, walletType: session.walletType },
        body,
        item,
        gameCode,
        currency
      )
      if (!result.ok) {
        let errBalance = result.balance
        if (errBalance == null) {
          const walletNow = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
          const rawBal = reportWalletType === 'referralBonus'
            ? Number(walletNow.referralBonus ?? 0)
            : reportWalletType === 'bonus'
              ? Number(walletNow.bonus ?? 0)
              : Number(walletNow.cash ?? 0) - Number(walletNow.exposure ?? 0)
          errBalance = Number(rawBal.toFixed(2))
        }
        console.warn(`${LOG_PREFIX} transaction batch stopped (item failed)`, {
          requestId: body.requestId,
          index: i,
          transType: item.transType,
          transId: item.transId,
          roundId: item.roundId,
          error: result.error,
          message: result.message,
          balance: errBalance,
        })
        return errorResponse(body.requestId, result.error!, result.message!, {
          playerId: body.playerId,
          playerSessionId: body.playerSessionId,
          currency,
          balance: errBalance,
        })
      }
    }

    const wallet = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
    const cash = Number(wallet.cash ?? 0)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonus = Number(wallet.referralBonus ?? 0)
    const exposure = Number(wallet.exposure ?? 0)
    const balance =
      reportWalletType === 'referralBonus'
        ? referralBonus
        : reportWalletType === 'bonus'
          ? bonus
          : cash - exposure
    const finalPayload = {
      playerId: body.playerId,
      playerSessionId: body.playerSessionId,
      currency,
      balance: Number(balance.toFixed(2)),
    }
    return successResponse(body.requestId, finalPayload)
  })
}

export async function handleGmagPayUp(body: GmagPayUpBody): Promise<GmagCallbackResponse> {
  const amount = Number(body.amount)
  if (amount <= 0) {
    const fallbackCurrency = body.currency ?? (await getWhitelabelCurrency('default'))
    return successResponse(body.requestId, { playerId: body.playerId, balance: 0, currency: fallbackCurrency })
  }
  const userIdRaw = body.playerId ? body.playerId.split('_')[0] : ''
  const userId = Number(userIdRaw)
  if (!Number.isInteger(userId) || userId <= 0) {
    return errorResponse(body.requestId, 'P_04', 'Player not found')
  }
  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db
    const [userRow] = await txAny.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!userRow || userRow.status !== 'active') {
      return errorResponse(body.requestId, 'P_04', 'Player not found')
    }
    const last4PayUp = userRow.phone ? String(userRow.phone).slice(-4) : '0000'
    const expectedPlayerIdPayUp = `${userId}_${last4PayUp}`
    if (body.playerId !== expectedPlayerIdPayUp) {
      return errorResponse(body.requestId, 'P_04', 'Player not found')
    }
    const tenant = userRow.tenant
    const currency = await getWhitelabelCurrency(tenant)

    // REPLAY GUARD. payUp had none: the wallet credit leaves nothing that references this
    // transId — so a redelivery (routine for this provider; CS-22135 shows 36 retries of one call) paid
    // the player again. Settlement callbacks dedupe on casino_bets.result_transaction_id;
    // payUp has no bet, hence the dedicated receipt.
    //
    // Insert FIRST and let the unique index decide. A select-then-insert check would let two
    // concurrent redeliveries both read "not seen" and both credit.
    const claimed = await txAny
      .insert(casinoCallbackIdempotency)
      .values({
        tenant,
        providerKey: GMAG_PROVIDER_KEY,
        operation: 'payUp',
        transId: body.transId,
        userId,
        amount: String(amount),
      })
      .onConflictDoNothing()
      .returning({ id: casinoCallbackIdempotency.id })

    if (claimed.length === 0) {
      // Already applied. Acknowledge with the CURRENT balance and credit nothing — returning an
      // error here would make the provider retry forever against a payment we already made.
      const dupWallet = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
      const dupBalance = Number(dupWallet.cash ?? 0) - Number(dupWallet.exposure ?? 0)
      console.warn(`${LOG_PREFIX} payUp replay ignored (already credited)`, {
        userId,
        transId: body.transId,
        amount,
      })
      return successResponse(body.requestId, {
        playerId: body.playerId,
        currency: body.currency ?? currency,
        balance: Number(dupBalance.toFixed(2)),
      })
    }

    // A payUp (manual jackpot) is a pure positive credit with no bet behind it. It lands in
    // cash for every player: a credit player's chips are cash too.
    await creditWalletForCasino(txAny, userId, tenant, amount, 'cash', {
      type: 'casino_payup',
      transactionId: body.transId,
      roundId: '',
    })
    const wallet = await ensureWalletWithExecutor(txAny, userId, tenant, currency)
    const balance = Number(wallet.cash ?? 0) - Number(wallet.exposure ?? 0)
    const payUpPayload = {
      playerId: body.playerId,
      currency: body.currency ?? currency,
      balance: Number(balance.toFixed(2)),
    }
    return successResponse(body.requestId, payUpPayload)
  })
}
