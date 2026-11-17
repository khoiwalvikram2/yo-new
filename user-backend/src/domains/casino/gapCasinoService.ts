import { loadPlayerDomains } from '@shared/access/playerDomains.js'
import { db } from '../../db/client.js'
import { users, bonusAwards, bonusCampaigns, casinoBets, sportsBets } from '@shared/db/schema.js'
import { and, eq, gte, desc, sql } from 'drizzle-orm'
import { getCasinoSessionByToken } from '../../repos/casinoSessionRepo.js'
import {
  createCasinoBet,
  findBetsByTransactionAndRound,
  findBetsByTransactionIdAnyStatus,
  checkDuplicateTransactionId,
  checkDuplicateResultTransactionId,
  checkDuplicateRollbackTransactionId,
  checkAnyBetHasRollback,
  updateBetResult,
  updateBetRollback,
} from '../../repos/casinoBetsRepo.js'
import { getWalletByUserIdWithExecutor, ensureWalletWithExecutor } from '../../repos/userRepo.js'
import {
  debitWalletForCasino,
  creditWalletForCasino,
  creditReferralBalanceForCasino,
  getCasinoSpendableCashBalance,
} from '../../repos/casinoWalletRepo.js'
import type { CasinoWalletType } from '../../repos/casinoWalletRepo.js'
import { getCasinoGameByExternalId, getCasinoBetSettings } from '../../repos/casinoGameRepo.js'
import { getActiveCasinoBonusAwardId, getPlayerLimitsForUser } from '../../repos/userAppRepo.js'
import { updateBonusWagering } from '@shared/services/bonusService.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '../../shared/whitelabelConfig.js'
import { getStartOfDay, getStartOfWeek } from '../../shared/dateUtils.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { isCreditPlayer as isCreditPlayerType } from '@shared/services/credit/isCreditPlayer.js'
import { casinoWalletTypeFor, isCasinoCreditPlayer } from './casinoCreditPlayer.js'
import type { WalletBalanceBody, DebitBody, CreditBody, RollbackBody } from './callbackSchemas.js'
import { gapLog } from './gapCasinoLog.js'
import { getRgBlockState } from '@shared/services/rgEnforcement.js'
import { checkPlayerAgentBettingGate } from '../userApp/services/agentBettingGate.js'
import { checkCasinoGameAccess } from './casinoGameAccess.js'

const LOG_PREFIX_BALANCE = '[GapCasino:WalletBalance]'
const LOG_PREFIX_DEBIT = '[GapCasino:Debit]'
const LOG_PREFIX_CREDIT = '[GapCasino:Credit]'
const LOG_PREFIX_ROLLBACK = '[GapCasino:Rollback]'

// Development-only opt-in tracing; sensitive fields are redacted by gapLog.
function gdbg(tag: string, data: Record<string, unknown>) { gapLog('[GapCasino]', tag, data) }

export type OpStatus =
  | 'OP_SUCCESS'
  | 'OP_GENERAL_ERROR'
  | 'OP_INVALID_SIGNATURE'
  | 'OP_INVALID_TOKEN'
  | 'OP_TOKEN_NOT_FOUND'
  | 'OP_INVALID_PARAMS'
  | 'OP_INVALID_GAME'
  | 'OP_USER_BLOCKED'
  | 'OP_USER_DISABLED'
  | 'OP_USER_NOT_FOUND'
  | 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT'
  | 'OP_INSUFFICIENT_FUNDS'
  | 'OP_DUPLICATE_TRANSACTION'
  | 'OP_TRANSACTION_NOT_FOUND'
  | 'OP_ERROR_TRANSACTION_INVALID'
  | 'OP_WRONG_CURRENCY'

export interface CallbackResult {
  status: OpStatus
  user?: number
  balance?: number
  request_uuid?: string
}

export async function handleWalletBalance(body: WalletBalanceBody): Promise<CallbackResult> {
  gdbg('Balance:Enter', { userId: body.userId, token: body.token, request_uuid: body.request_uuid })

  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db

    // Validate session
    const session = await getCasinoSessionByToken(body.token, txAny)
    gdbg('Balance:Session', { found: !!session, sessionUserId: session?.userId, walletType: session?.walletType, tenant: session?.tenant })

    if (!session) {
      gdbg('Balance:Reject', { reason: 'no-session', status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: body.request_uuid }
    }

    if (session.userId !== body.userId) {
      gdbg('Balance:Reject', { reason: 'userId-mismatch', sessionUserId: session.userId, bodyUserId: body.userId, status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: body.request_uuid }
    }

    // Fetch user
    const [userRow] = await txAny.select().from(users).where(and(eq(users.id, session.userId), eq(users.tenant, session.tenant))).limit(1)
    gdbg('Balance:User', { found: !!userRow, userStatus: userRow?.status, casinoBetAllowed: userRow?.casinoBetAllowed })

    if (!userRow) {
      gdbg('Balance:Reject', { reason: 'user-not-found', status: 'OP_USER_NOT_FOUND' })
      return { status: 'OP_USER_NOT_FOUND', user: body.userId, request_uuid: body.request_uuid }
    }

    if (userRow.status !== 'active') {
      gdbg('Balance:Reject', { reason: 'user-blocked', userStatus: userRow.status, status: 'OP_USER_BLOCKED' })
      return { status: 'OP_USER_BLOCKED', user: body.userId, request_uuid: body.request_uuid }
    }
    if (!userRow.casinoBetAllowed) {
      gdbg('Balance:Reject', { reason: 'casino-disabled', status: 'OP_USER_DISABLED' })
      return { status: 'OP_USER_DISABLED', user: body.userId, request_uuid: body.request_uuid }
    }

    // Fetch wallet
    const currency = await getWhitelabelCurrency(session.tenant)
    const wallet = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonus = Number(wallet.referralBonus ?? 0)

    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their chips in cash and never
    // play from a bonus wallet, so their balance is always spendable cash (cash - exposure).
    const walletType = casinoWalletTypeFor(isCreditPlayerType(userRow.playerType), session.walletType)

    let balance: number
    if (walletType === 'referralBonus') {
      balance = referralBonus
    } else if (walletType === 'bonus') {
      balance = bonus
    } else {
      balance = getCasinoSpendableCashBalance(wallet)
    }

    gdbg('Balance:Wallet', {
      currency,
      walletType,
      cash: Number(wallet.cash ?? 0),
      bonus,
      referralBonus,
      exposure: Number(wallet.exposure ?? 0),
      resolvedBalance: balance,
    })

    const result = {
      status: 'OP_SUCCESS' as OpStatus,
      user: body.userId,
      balance: Number(balance.toFixed(2)),
      request_uuid: body.request_uuid,
    }

    gdbg('Balance:Success', { result })
    return result
  })
}

export async function handleDebit(body: DebitBody): Promise<CallbackResult> {
  gdbg('Debit:Enter', {
    userId: body.userId,
    transactionId: body.transactionId,
    roundId: body.roundId,
    debitAmount: body.debitAmount,
    gameId: body.gameId,
    reqId: body.reqId,
  })

  const betAmount = typeof body.debitAmount === 'number' ? body.debitAmount : parseFloat(String(body.debitAmount))
  // Use || so an empty-string reqId falls through to transactionId (prevents empty string
  // from becoming a "valid" duplicate key and flagging every future callback as duplicate).
  const reqId = body.reqId || body.transactionId

  // Reject negative stake early with the correct GAP error code (before opening a db tx).
  if (!Number.isFinite(betAmount) || betAmount < 0) {
    gdbg('Debit:Reject', { reason: 'negative-amount', betAmount, status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' })
    return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
  }

  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db

    // Validate session
    const session = await getCasinoSessionByToken(body.token, txAny)
    gdbg('Debit:Session', { found: !!session, sessionUserId: session?.userId, walletType: session?.walletType })

    if (!session) {
      gdbg('Debit:Reject', { reason: 'no-session', status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: reqId }
    }

    if (session.userId !== body.userId) {
      gdbg('Debit:Reject', { reason: 'userId-mismatch', status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: reqId }
    }

    // Check duplicate transaction
    const isDup = await checkDuplicateTransactionId(body.userId, body.transactionId, txAny)
    gdbg('Debit:DuplicateCheck', { isDup, transactionId: body.transactionId })

    if (isDup) {
      gdbg('Debit:Reject', { reason: 'duplicate-transaction', transactionId: body.transactionId, status: 'OP_DUPLICATE_TRANSACTION' })
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }


    // Fetch user
    const [userRow] = await txAny.select().from(users).where(and(eq(users.id, session.userId), eq(users.tenant, session.tenant))).limit(1)
    gdbg('Debit:User', { found: !!userRow, userStatus: userRow?.status, casinoBetAllowed: userRow?.casinoBetAllowed })

    if (!userRow) {
      gdbg('Debit:Reject', { reason: 'user-not-found', status: 'OP_USER_NOT_FOUND' })
      return { status: 'OP_USER_NOT_FOUND', user: body.userId, request_uuid: reqId }
    }

    if (userRow.status !== 'active') {
      gdbg('Debit:Reject', { reason: 'user-blocked', userStatus: userRow.status, status: 'OP_USER_BLOCKED' })
      return { status: 'OP_USER_BLOCKED', user: body.userId, request_uuid: reqId }
    }
    if (!userRow.casinoBetAllowed) {
      gdbg('Debit:Reject', { reason: 'casino-disabled', status: 'OP_USER_DISABLED' })
      return { status: 'OP_USER_DISABLED', user: body.userId, request_uuid: reqId }
    }

    // A responsible-gambling block stops the stake. Read from its own column
    // rather than users.status, which several unrelated mutations also write
    // — an admin re-activating an account must not silently resume play for
    // a player who excluded themselves.
    const rgState = await getRgBlockState(session.tenant, userRow.id, txAny)
    if (rgState.blocked) {
      gdbg('Debit:Reject', { reason: 'rg-blocked', rgReason: rgState.reason, status: 'OP_USER_BLOCKED' })
      return { status: 'OP_USER_BLOCKED', user: body.userId, request_uuid: reqId }
    }

    const domainAccess = (await loadPlayerDomains(txAny, session.tenant, session.userId)).casino
    if (!domainAccess.canBet) return { status: 'OP_USER_DISABLED', user: body.userId, request_uuid: reqId }

    // Get game details
    const game = await getCasinoGameByExternalId(body.gameId, txAny)
    gdbg('Debit:Game', { found: !!game, externalId: body.gameId, gameDbId: game?.id, gameName: game?.name })

    if (!game) {
      gdbg('Debit:Reject', { reason: 'game-not-found', gameId: body.gameId, status: 'OP_INVALID_GAME' })
      return { status: 'OP_INVALID_GAME', user: body.userId, request_uuid: reqId }
    }
    
    // Check bet settings/limits
    const settings = await getCasinoBetSettings(session.tenant, game.id, String(body.userId), txAny)
    
    if (settings) {
      if (settings.minStake != null && betAmount < settings.minStake) {
        gdbg('Debit:Reject', { reason: 'stake-limit', betAmount, status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' })
        return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
      }
      if (settings.maxStake != null && betAmount > settings.maxStake) {
        gdbg('Debit:Reject', { reason: 'stake-limit', betAmount, status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' })
        return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
      }
    } else {
    }

    // The whitelabel's per-game rules: betting switched off, the day's win cap, premium and VIP
    // tiers. The cap is a limit like the stake limits; the others refuse the player on this game.
    const gameAccess = await checkCasinoGameAccess(txAny, { tenant: session.tenant, userId: session.userId, gameId: game.id, settings })
    if (gameAccess) {
      const status: OpStatus = gameAccess.reason === 'max_win_reached' ? 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' : 'OP_USER_DISABLED'
      gdbg('Debit:Reject', { reason: gameAccess.reason, betAmount, status })
      return { status, user: body.userId, request_uuid: reqId }
    }

    // Fetch wallet once (used for exposure cap + balance check)
    const wallet = await ensureWalletWithExecutor(txAny, session.userId, session.tenant)

    // Player-specific limits enforcement (all queries use txAny for transaction consistency)
    const playerLimits = await getPlayerLimitsForUser(session.userId, session.tenant)
    if (playerLimits) {
      // Max single bet limit for casino
      if (playerLimits.maxBetCasino != null && betAmount > playerLimits.maxBetCasino) {
        gdbg('Debit:Reject', { reason: 'stake-limit', betAmount, status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT' })
        return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
      }

      // Daily stake limit (sports + casino combined)
      if (playerLimits.dailyStakeLimit != null) {
        const tz = await getWhitelabelTimezone(session.tenant)
        const todayStart = getStartOfDay(tz)

        const [casinoToday] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
          .from(casinoBets)
          .where(and(eq(casinoBets.userId, session.userId), eq(casinoBets.tenant, session.tenant), gte(casinoBets.createdAt, todayStart)))

        const [sportsToday] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
          .from(sportsBets)
          .where(and(eq(sportsBets.userId, session.userId), eq(sportsBets.tenant, session.tenant), gte(sportsBets.createdAt, todayStart)))

        const todayTotalStake = Number(casinoToday?.total ?? 0) + Number(sportsToday?.total ?? 0)
        if (todayTotalStake + betAmount > playerLimits.dailyStakeLimit) {
          gdbg('Debit:Reject', { reason: 'daily-stake-limit', betAmount, todayTotalStake, limit: playerLimits.dailyStakeLimit })
          return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
        }
      }

      // Weekly stake limit (sports + casino combined)
      if (playerLimits.weeklyStakeLimit != null) {
        const tz = await getWhitelabelTimezone(session.tenant)
        const weekStart = getStartOfWeek(tz)

        const [casinoWeek] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
          .from(casinoBets)
          .where(and(eq(casinoBets.userId, session.userId), eq(casinoBets.tenant, session.tenant), gte(casinoBets.createdAt, weekStart)))

        const [sportsWeek] = await txAny
          .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
          .from(sportsBets)
          .where(and(eq(sportsBets.userId, session.userId), eq(sportsBets.tenant, session.tenant), gte(sportsBets.createdAt, weekStart)))

        const weekTotalStake = Number(casinoWeek?.total ?? 0) + Number(sportsWeek?.total ?? 0)
        if (weekTotalStake + betAmount > playerLimits.weeklyStakeLimit) {
          gdbg('Debit:Reject', { reason: 'weekly-stake-limit', betAmount, weekTotalStake, limit: playerLimits.weeklyStakeLimit })
          return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
        }
      }

      // Exposure cap override
      if (playerLimits.exposureCapOverride != null) {
        const projectedExposure = Number(wallet.exposure ?? 0) + betAmount
        if (projectedExposure > playerLimits.exposureCapOverride) {
          gdbg('Debit:Reject', { reason: 'exposure-cap', projectedExposure, cap: playerLimits.exposureCapOverride })
          return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
        }
      }

      // Cooldown between bets (checks both casino + sports)
      if (playerLimits.cooldownSeconds != null && playerLimits.cooldownSeconds > 0) {
        const cooldownMs = playerLimits.cooldownSeconds * 1000

        const lastCasinoBet = await txAny
          .select({ createdAt: casinoBets.createdAt })
          .from(casinoBets)
          .where(and(eq(casinoBets.userId, session.userId), eq(casinoBets.tenant, session.tenant)))
          .orderBy(desc(casinoBets.createdAt))
          .limit(1)
          .then((rows) => rows[0])

        const lastSportsBet = await txAny
          .select({ createdAt: sportsBets.createdAt })
          .from(sportsBets)
          .where(and(eq(sportsBets.userId, session.userId), eq(sportsBets.tenant, session.tenant)))
          .orderBy(desc(sportsBets.createdAt))
          .limit(1)
          .then((rows) => rows[0])

        const lastCasinoTime = lastCasinoBet?.createdAt ? new Date(lastCasinoBet.createdAt).getTime() : 0
        const lastSportsTime = lastSportsBet?.createdAt ? new Date(lastSportsBet.createdAt).getTime() : 0
        const lastBetTime = Math.max(lastCasinoTime, lastSportsTime)

        if (lastBetTime > 0) {
          const timeSinceLastBet = Date.now() - lastBetTime
          if (timeSinceLastBet < cooldownMs) {
            const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastBet) / 1000)
            gdbg('Debit:Reject', { reason: 'cooldown', remainingSeconds, cooldownMs })
            return { status: 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT', user: body.userId, request_uuid: reqId }
          }
        }
      }
    }

    // Determine wallet type (referralBonus has no bonusAwardId). Credit players
    // (AGENT_CREDIT / WHITELABEL_CREDIT) stake their chips from cash, whatever the session names.
    const walletType: CasinoWalletType = casinoWalletTypeFor(isCreditPlayerType(userRow.playerType), session.walletType)

    // Check wallet balance
    const cash = Number(wallet.cash ?? 0)
    const bonus = Number(wallet.bonus ?? 0)
    const referralBonusBal = Number(wallet.referralBonus ?? 0)
    const balance =
      walletType === 'referralBonus'
        ? referralBonusBal
        : walletType === 'bonus'
          ? bonus
          : getCasinoSpendableCashBalance(wallet)

    gdbg('Debit:BalanceCheck', { walletType, cash, bonus, referralBonusBal, balance, betAmount })

    if (betAmount > balance) {
      gdbg('Debit:Reject', { reason: 'insufficient-funds', balance, betAmount, status: 'OP_INSUFFICIENT_FUNDS' })
      return { status: 'OP_INSUFFICIENT_FUNDS', user: body.userId, balance: Number(balance.toFixed(2)), request_uuid: reqId }
    }


    // Agent players: no new stake while the agent or any ancestor is not ACTIVE
    // (OP_USER_BLOCKED), or when the agent lacks the casino domain (OP_USER_DISABLED,
    // the same status a player-level casino block returns). Zero-amount debits stake nothing.
    if (betAmount > 0) {
      const agentGate = await checkPlayerAgentBettingGate(txAny, { userId: session.userId, tenant: session.tenant }, 'casino')
      if (!agentGate.ok) {
        const status: OpStatus = agentGate.reason === 'AGENT_DOMAIN_NOT_ALLOWED' ? 'OP_USER_DISABLED' : 'OP_USER_BLOCKED'
        gdbg('Debit:Reject', { reason: agentGate.reason, status })
        return { status, user: body.userId, request_uuid: reqId }
      }
    }

    // Bonus award (bonus wallet only; referralBonus has no bonusAwardId)
    const bonusAwardId = walletType === 'bonus' ? await getActiveCasinoBonusAwardId(body.userId, session.tenant, txAny) : null

    const currency = await getWhitelabelCurrency(session.tenant)
    gdbg('Debit:Debiting', { walletType, betAmount, currency, bonusAwardId, transactionId: body.transactionId, roundId: body.roundId })

    // Debit wallet. A credit player's chips are cash, so this takes their stake too.
    await debitWalletForCasino(
      txAny,
      session.userId,
      session.tenant,
      betAmount,
      walletType,
      { type: 'casino_bet', transactionId: body.transactionId, roundId: body.roundId },
      currency
    )
    gdbg('Debit:Debited', { walletType, betAmount })

    // Create bet record
    const betData = {
      tenant: session.tenant,
      whitelabelId: session.tenant,
      userId: session.userId,
      gameId: game.id,
      gameName: game.name,
      providerId: game.providerId,
      vendorId: game.vendorId,
      vendorName: game.vendorName,
      tableId: game.tableId,
      stake: String(betAmount),
      transactionId: body.transactionId,
      gameRoundId: body.roundId,
      walletType,
      bonusAwardId,
      currency,
    }
    
    const createdBet = await createCasinoBet(betData, txAny)
    gdbg('Debit:BetCreated', { betId: createdBet.id, stake: createdBet.stake, gameRoundId: createdBet.gameRoundId })

    // Get updated balance
    const walletAfter = await ensureWalletWithExecutor(txAny, session.userId, session.tenant, currency)
    const cashAfter = Number(walletAfter.cash ?? 0)
    const bonusAfter = Number(walletAfter.bonus ?? 0)
    const referralBonusAfter = Number(walletAfter.referralBonus ?? 0)
    const exposureAfter = Number(walletAfter.exposure ?? 0)
    const balanceAfter =
      walletType === 'referralBonus' ? referralBonusAfter : walletType === 'bonus' ? bonusAfter : cashAfter - exposureAfter

    // Auto-complete instant OTP bonus award when bonus wallet hits 0 (so active bonus card goes away)
    if (walletType === 'bonus' && bonusAwardId != null && bonusAfter === 0) {
      const campaignRow = await txAny
        .select({ distributionType: bonusCampaigns.distributionType })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(
          and(
            eq(bonusAwards.id, bonusAwardId),
            eq(bonusCampaigns.tenant, session.tenant)
          )
        )
        .limit(1)
        .then((rows: { distributionType: string | null }[]) => rows[0])
      if (campaignRow?.distributionType === 'instant_otp') {
        await txAny
          .update(bonusAwards)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(bonusAwards.id, bonusAwardId))
      }
    }

    const result = {
      status: 'OP_SUCCESS' as OpStatus,
      user: body.userId,
      balance: Number(balanceAfter.toFixed(2)),
      request_uuid: reqId,
    }

    gdbg('Debit:Success', { result, balanceAfter, cashAfter, bonusAfter, referralBonusAfter, exposureAfter })
    return result
  })
}

export async function handleCredit(body: CreditBody): Promise<CallbackResult> {
  gdbg('Credit:Enter', {
    userId: body.userId,
    transactionId: body.transactionId,
    roundId: body.roundId,
    creditAmount: body.creditAmount,
    gameId: body.gameId,
    reqId: body.reqId,
  })

  const creditAmount = typeof body.creditAmount === 'number' ? body.creditAmount : parseFloat(String(body.creditAmount))
  // Use || so an empty-string reqId falls through to transactionId (prevents empty string
  // from becoming a "valid" duplicate key and flagging every future callback as duplicate).
  const reqId = body.reqId || body.transactionId

  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db

    // Validate session
    const session = await getCasinoSessionByToken(body.token, txAny)
    gdbg('Credit:Session', { found: !!session, sessionUserId: session?.userId, userIdMatch: session?.userId === body.userId })

    if (!session || session.userId !== body.userId) {
      gdbg('Credit:Reject', { reason: 'bad-session', status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: reqId }
    }

    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) settle on the cash path like everyone
    // else: the gross return is paid into cash, their chips. They get no bonus wagering and no
    // referral loss-share, and their stake always came from cash.
    const isCreditPlayer = await isCasinoCreditPlayer(txAny, session.userId, session.tenant)

    // Find related bets
    const bets = await findBetsByTransactionAndRound(body.userId, body.transactionId, body.roundId, txAny)
    gdbg('Credit:BetsFound', {
      count: bets.length,
      bets: bets.map((b) => ({ id: b.id, status: b.status, stake: b.stake, resultTransactionId: b.resultTransactionId, rollbackTransactionId: b.rollbackTransactionId })),
    })

    if (!bets.length) {
      gdbg('Credit:Reject', { reason: 'no-bets', transactionId: body.transactionId, roundId: body.roundId, status: 'OP_TRANSACTION_NOT_FOUND' })
      return { status: 'OP_TRANSACTION_NOT_FOUND', user: body.userId, request_uuid: reqId }
    }

    // Duplicate detection, two ways:
    //   1. Same reqId previously stored as resultTransactionId → idempotent replay.
    //   2. Any bet in this (txId, roundId) already settled (won/lost) with ANY resultTransactionId
    //      → second credit attempt on a bet that was already credited under a different reqId
    //      (GAP test 5 "Duplicate Win" and test 10 "Multi Credit" both expect OP_DUPLICATE_TRANSACTION).
    const hasDupResult = await checkDuplicateResultTransactionId(body.userId, body.roundId, reqId, txAny)
    if (hasDupResult) {
      gdbg('Credit:Reject', { reason: 'duplicate-reqId', reqId, status: 'OP_DUPLICATE_TRANSACTION' })
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }
    const alreadyCredited = bets.some((b) => b.resultTransactionId != null && (b.status === 'won' || b.status === 'lost'))
    if (alreadyCredited) {
      gdbg('Credit:Reject', { reason: 'already-settled', status: 'OP_DUPLICATE_TRANSACTION' })
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }

    // Check for rollback
    const hasRollback = await checkAnyBetHasRollback(body.userId, body.transactionId, body.roundId, txAny)
    gdbg('Credit:RollbackCheck', { hasRollback })

    if (hasRollback) {
      gdbg('Credit:Reject', { reason: 'already-rolled-back', status: 'OP_ERROR_TRANSACTION_INVALID' })
      return { status: 'OP_ERROR_TRANSACTION_INVALID', user: body.userId, request_uuid: reqId }
    }
    
    // Calculate P/L
    const totalStake = bets.reduce((sum, b) => sum + Number(b.stake ?? 0), 0)
    const walletType = casinoWalletTypeFor(isCreditPlayer, bets[0].walletType)
    const pl = creditAmount - totalStake
    const status: 'won' | 'lost' = creditAmount === 0 ? 'lost' : 'won'
    const n = bets.length
    const netAmountPerBet = n > 0 ? pl / n : 0
    const winAmountPerBet = n > 0 ? creditAmount / n : 0
    
    
    gdbg('Credit:Computed', { totalStake, creditAmount, pl, status, walletType, n, netAmountPerBet, winAmountPerBet })

    // Update bet results (only active bets transition; duplicate callbacks are idempotent)
    let anyBetTransitioned = false
    for (const bet of bets) {
      const updateData = {
        status,
        netAmount: String(Number(netAmountPerBet.toFixed(2))),
        winAmount: String(Number(winAmountPerBet.toFixed(2))),
        payout: String(Number(winAmountPerBet.toFixed(2))),
        resultTransactionId: reqId,
      }
      const updated = await updateBetResult(bet.id, updateData, txAny)
      gdbg('Credit:BetUpdate', { betId: bet.id, updated, newStatus: status })
      if (updated) {
        anyBetTransitioned = true
      }
    }
    gdbg('Credit:Transition', { anyBetTransitioned })

    // Credit wallet only when at least one bet transitioned (no double-credit on duplicate callbacks).
    if (anyBetTransitioned) {
    const bonusAwardId = bets[0].bonusAwardId
    const isReferralBonusWallet = walletType === 'referralBonus'
    const instantOtpBonusRow = await (async () => {
      if (isReferralBonusWallet || walletType !== 'bonus' || !bonusAwardId) return null
      const { bonusAwards, bonusCampaigns } = await import('@shared/db/schema.js')
      const { eq, and } = await import('drizzle-orm')
      const row = await txAny
        .select({
          distributionType: bonusCampaigns.distributionType,
          campaignId: bonusAwards.campaignId,
        })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(and(eq(bonusAwards.id, bonusAwardId), eq(bonusCampaigns.tenant, session.tenant)))
        .limit(1)
        .then((rows: any[]) => rows[0])
      return row?.distributionType === 'instant_otp' ? row : null
    })()
    const isInstantOtpBonus = !!instantOtpBonusRow

    if (isReferralBonusWallet) {
      const profit = Math.max(creditAmount - totalStake, 0)
      if (profit > 0) {
        const wallet = await getWalletByUserIdWithExecutor(txAny, body.userId, session.tenant)
        if (wallet) {
          const refBonusBefore = Number(wallet.referralBonus ?? 0)
          await createWalletLedgerEntry(txAny, {
            tenant: session.tenant,
            walletId: wallet.id,
            userId: body.userId,
            walletType: 'referralBonus',
            category: 'casino_win',
            direction: 'credit',
            amount: profit,
            balanceBefore: refBonusBefore,
            balanceAfter: refBonusBefore + profit,
            description: 'Casino win (pass-through)',
            referenceType: 'casino_win',
            referenceId: body.transactionId ?? undefined,
            meta: { transactionId: body.transactionId, roundId: body.roundId },
          })
          await createWalletLedgerEntry(txAny, {
            tenant: session.tenant,
            walletId: wallet.id,
            userId: body.userId,
            walletType: 'referralBonus',
            category: 'referral_transfer',
            direction: 'debit',
            amount: profit,
            balanceBefore: refBonusBefore + profit,
            balanceAfter: refBonusBefore,
            description: 'Transfer to referral balance',
            referenceType: 'casino_win',
            referenceId: body.transactionId ?? undefined,
            meta: { transactionId: body.transactionId, roundId: body.roundId },
          })
        }
        await creditReferralBalanceForCasino(txAny, body.userId, session.tenant, profit, {
          type: 'casino_win',
          transactionId: body.transactionId,
          roundId: body.roundId,
          subType: 'referral_bonus_profit',
        })
      }
    } else if (isInstantOtpBonus) {
      const profit = Math.max(creditAmount - totalStake, 0)
      if (profit > 0) {
        const wallet = await getWalletByUserIdWithExecutor(txAny, body.userId, session.tenant)
        if (wallet) {
          const bonusBefore = Number(wallet.bonus ?? 0)
          await createWalletLedgerEntry(txAny, {
            tenant: session.tenant,
            walletId: wallet.id,
            userId: body.userId,
            walletType: 'bonus',
            category: 'casino_win',
            direction: 'credit',
            amount: profit,
            balanceBefore: bonusBefore,
            balanceAfter: bonusBefore + profit,
            description: 'Casino win (pass-through)',
            referenceType: 'bonus_to_cash',
            referenceId: body.transactionId ?? undefined,
            meta: { transactionId: body.transactionId, roundId: body.roundId, bonusAwardId },
          })
          await createWalletLedgerEntry(txAny, {
            tenant: session.tenant,
            walletId: wallet.id,
            userId: body.userId,
            walletType: 'bonus',
            category: 'bonus_transfer',
            direction: 'debit',
            amount: profit,
            balanceBefore: bonusBefore + profit,
            balanceAfter: bonusBefore,
            description: 'Transfer to cash',
            referenceType: 'bonus_to_cash',
            referenceId: body.transactionId ?? undefined,
            meta: { transactionId: body.transactionId, roundId: body.roundId, bonusAwardId },
          })
        }
        const campaignId = instantOtpBonusRow?.campaignId ?? undefined
        await creditWalletForCasino(txAny, body.userId, session.tenant, profit, 'cash', {
          type: 'bonus_to_cash',
          remark: 'BONUS TO CASH',
          transactionId: body.transactionId,
          roundId: body.roundId,
          bonusAwardId: bonusAwardId ?? undefined,
          campaignId,
        })
        const { deductWhitelabelCredit } = await import('@shared/services/whitelabelCreditDeduct.js')
        const currency = await getWhitelabelCurrency(session.tenant)
        await deductWhitelabelCredit(txAny, session.tenant, profit, currency, `Instant OTP bonus profit to cash - userId=${body.userId} betId=${bets[0]?.id ?? 'n/a'}`, {
          userId: body.userId,
        })
      }
    } else {
      await creditWalletForCasino(
        txAny,
        body.userId,
        session.tenant,
        creditAmount,
        walletType,
        { type: 'casino_win', transactionId: body.transactionId, roundId: body.roundId }
      )
    }
    
    // Update bonus wagering (skip for referral bonus — no award; skip for instant OTP bonus — stake consumed, no rollover;
    // skip for credit players — they get no bonuses, so there is nothing to wager)
    if (!isReferralBonusWallet && !isInstantOtpBonus && !isCreditPlayer) {
      const gameIdForWagering = bets[0]?.gameId ? String(bets[0].gameId) : undefined
      await updateBonusWagering(body.userId, session.tenant, totalStake, 'casino', gameIdForWagering, walletType, txAny)
    } else {
    }

    // Trigger referral bet settlement (loss share) via admin internal API - only when player lost (net < 0).
    // A credit player's losses pay no referral loss-share.
    const netAmountSnapshot = netAmountPerBet
    if (Number(netAmountSnapshot) < 0 && !isCreditPlayer) {
      const referralCurrency = (bets[0]?.currency ?? await getWhitelabelCurrency(session.tenant)) as string
      const betsSnapshot = [...bets]
      const tenantSnapshot = session.tenant
      const userIdSnapshot = body.userId
      setImmediate(async () => {
        const { triggerReferralBetSettlement } = await import('../../services/referralBetSettlementTrigger.js')
        for (const bet of betsSnapshot) {
          const net = Number(netAmountSnapshot)
          if (!Number.isFinite(net)) continue
          try {
            await triggerReferralBetSettlement({
              tenant: tenantSnapshot,
              userId: userIdSnapshot,
              netRevenue: net,
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
    
    // Fetch updated wallet balance (same approach as debit)
    const creditCurrency = await getWhitelabelCurrency(session.tenant)
    const walletAfter = await ensureWalletWithExecutor(txAny, body.userId, session.tenant, creditCurrency)
    const cashAfter = Number(walletAfter.cash ?? 0)
    const bonusAfter = Number(walletAfter.bonus ?? 0)
    const referralBonusAfter = Number(walletAfter.referralBonus ?? 0)
    const exposureAfter = Number(walletAfter.exposure ?? 0)
    const balanceAfter =
      walletType === 'referralBonus' ? referralBonusAfter : walletType === 'bonus' ? bonusAfter : cashAfter - exposureAfter

    const result = {
      status: 'OP_SUCCESS' as OpStatus,
      user: body.userId,
      balance: Number(balanceAfter.toFixed(2)),
      request_uuid: reqId,
    }

    gdbg('Credit:Success', { result, balanceAfter, walletType })
    return result
  })
}

export async function handleRollback(body: RollbackBody): Promise<CallbackResult> {
  gdbg('Rollback:Enter', {
    userId: body.userId,
    transactionId: body.transactionId,
    roundId: body.roundId,
    gameId: body.gameId,
    reqId: body.reqId,
  })

  // Use || so an empty-string reqId falls through to transactionId (prevents empty string
  // from becoming a "valid" duplicate key and flagging every future callback as duplicate).
  const reqId = body.reqId || body.transactionId

  return db.transaction(async (tx) => {
    const txAny = tx as unknown as typeof db

    // Validate session
    const session = await getCasinoSessionByToken(body.token, txAny)
    gdbg('Rollback:Session', { found: !!session, sessionUserId: session?.userId })

    if (!session || session.userId !== body.userId) {
      gdbg('Rollback:Reject', { reason: 'bad-session', status: 'OP_INVALID_TOKEN' })
      return { status: 'OP_INVALID_TOKEN', user: body.userId, request_uuid: reqId }
    }

    // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) get their stake back into cash like
    // everyone else. Only the referral reversal is skipped: their losses never paid a
    // loss-share, so there is nothing to reverse.
    const isCreditPlayer = await isCasinoCreditPlayer(txAny, session.userId, session.tenant)

    // Find bets to rollback. We first look across ALL statuses so we can distinguish
    // "transaction never existed" (→ OP_TRANSACTION_NOT_FOUND) from
    // "already rolled back" (→ OP_DUPLICATE_TRANSACTION, per GAP test 6 "Duplicate Rollback").
    const allBetsForTxn = await findBetsByTransactionIdAnyStatus(body.userId, body.transactionId, txAny)
    gdbg('Rollback:BetsFound', {
      count: allBetsForTxn.length,
      bets: allBetsForTxn.map((b) => ({ id: b.id, status: b.status, stake: b.stake, rollbackTransactionId: b.rollbackTransactionId })),
    })
    if (!allBetsForTxn.length) {
      gdbg('Rollback:Reject', { reason: 'no-bets-for-txn', transactionId: body.transactionId, status: 'OP_TRANSACTION_NOT_FOUND' })
      return { status: 'OP_TRANSACTION_NOT_FOUND', user: body.userId, request_uuid: reqId }
    }
    const alreadyRolledBack = allBetsForTxn.every((b) => b.status === 'void' || b.rollbackTransactionId != null)
    if (alreadyRolledBack) {
      gdbg('Rollback:Reject', { reason: 'already-rolled-back', status: 'OP_DUPLICATE_TRANSACTION' })
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }

    const bets = allBetsForTxn.filter((b) => b.status === 'active')
    if (!bets.length) {
      // Bets exist but none active and none fully rolled back — most likely already settled (won/lost).
      // Treat as duplicate to avoid a second rollback on a finalised round.
      gdbg('Rollback:Reject', { reason: 'already-settled', status: 'OP_DUPLICATE_TRANSACTION' })
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }

    // Check for duplicate rollback by reqId (same rollback replayed verbatim)
    const hasDupRollback = await checkDuplicateRollbackTransactionId(body.userId, body.roundId, reqId, txAny)
    gdbg('Rollback:DupReqCheck', { hasDupRollback })

    if (hasDupRollback) {
      return { status: 'OP_DUPLICATE_TRANSACTION', user: body.userId, request_uuid: reqId }
    }
    
    // Calculate rollback amount
    const rollbackAmount = bets.reduce((sum, b) => sum + Number(b.stake ?? 0), 0)
    const walletType = casinoWalletTypeFor(isCreditPlayer, bets[0].walletType)
    // Instant OTP bonus rollback: no wallet credit — nothing related to instant OTP should happen
    let isInstantOtpRollback = false
    if (walletType === 'bonus' && bets[0].bonusAwardId != null) {
      const campaignRow = await txAny
        .select({ distributionType: bonusCampaigns.distributionType })
        .from(bonusAwards)
        .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
        .where(
          and(
            eq(bonusAwards.id, bets[0].bonusAwardId),
            eq(bonusCampaigns.tenant, session.tenant)
          )
        )
        .limit(1)
        .then((rows: { distributionType: string | null }[]) => rows[0])
      if (campaignRow?.distributionType === 'instant_otp') {
        isInstantOtpRollback = true
      }
    }
    
    gdbg('Rollback:Amounts', { rollbackAmount, walletType, isInstantOtpRollback, betCount: bets.length })

    // Update bets with rollback (only active bets transition; duplicate callbacks are idempotent)
    let anyRollbackTransitioned = false
    for (const bet of bets) {
      const updated = await updateBetRollback(bet.id, reqId, txAny)
      gdbg('Rollback:BetUpdate', { betId: bet.id, updated })
      if (updated) {
        anyRollbackTransitioned = true
      }
    }
    gdbg('Rollback:Transition', { anyRollbackTransitioned })

    if (anyRollbackTransitioned && !isCreditPlayer) {
    // Trigger referral bet settlement reversal (offset prior loss share earnings) via admin internal API - fire-and-forget per bet
    const betsSnapshot = [...bets]
    const tenantSnapshot = session.tenant
    const userIdSnapshot = body.userId
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
    
    // Credit wallet with rollback amount only when at least one bet transitioned (no double-credit on duplicate callbacks)
    // Instant OTP bonus: no credit — nothing related to instant OTP on rollback
    if (anyRollbackTransitioned && !isInstantOtpRollback) {
      gdbg('Rollback:Crediting', { rollbackAmount, walletType })
      await creditWalletForCasino(
        txAny,
        body.userId,
        session.tenant,
        rollbackAmount,
        walletType,
        { type: 'casino_rollback', transactionId: body.transactionId, roundId: body.roundId }
      )
    } else {
      gdbg('Rollback:SkipCredit', { anyRollbackTransitioned, isInstantOtpRollback })
    }

    // Fetch updated wallet balance (same approach as debit)
    const rollbackCurrency = await getWhitelabelCurrency(session.tenant)
    const walletAfter = await ensureWalletWithExecutor(txAny, body.userId, session.tenant, rollbackCurrency)
    const cashAfter = Number(walletAfter.cash ?? 0)
    const bonusAfter = Number(walletAfter.bonus ?? 0)
    const referralBonusAfter = Number(walletAfter.referralBonus ?? 0)
    const exposureAfter = Number(walletAfter.exposure ?? 0)
    const balanceAfter =
      walletType === 'referralBonus' ? referralBonusAfter : walletType === 'bonus' ? bonusAfter : cashAfter - exposureAfter

    const result = {
      status: 'OP_SUCCESS' as OpStatus,
      user: body.userId,
      balance: Number(balanceAfter.toFixed(2)),
      request_uuid: reqId,
    }

    gdbg('Rollback:Success', { result, balanceAfter, walletType })
    return result
  })
}
