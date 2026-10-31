import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { randomUUID } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'

const eqL = eq as any
const andL = and as any
const walletsT = wallets as any
import { users, wallets } from '@shared/db/schema.js'
import { db as dbClient } from '../db/client.js'

const db = dbClient as any
import { getWhitelabelCurrency } from '../shared/whitelabelConfig.js'
import { getCasinoGameByExternalIdAndProviderKey } from '../repos/casinoGameRepo.js'
import { createCasinoBet, updateBetResult, deleteCasinoBetById, checkDuplicateTransactionId } from '../repos/casinoBetsRepo.js'
import { debitWalletForCasino, creditWalletForCasino, restoreCasinoStakeAndStripPlacementLedgers } from '../repos/casinoWalletRepo.js'
import { ensureWalletWithExecutor } from '../repos/userRepo.js'
import { casinoBets } from '@shared/db/schema.js'
import { updateBonusWagering } from '@shared/services/bonusService.js'
import { triggerReferralBetSettlement } from './referralBetSettlementTrigger.js'
import { assertPlayerAgentAllowsBetting } from '../domains/userApp/services/agentBettingGate.js'

async function loadRegularCashPlayer(userId: number, tenant: string, newBet = true) {
  const [user] = await db
    .select()
    .from(users as any)
    .where(andL(eqL(users.id, userId), eqL(users.tenant, tenant)))
    .limit(1)
  if (!user) {
    throw new Error('User not found')
  }
  if (newBet && user.status !== 'active') {
    throw new Error('Account is not active')
  }
  if (newBet && !user.casinoBetAllowed) {
    throw new Error('Casino betting is disabled for this account')
  }
  const pt = user.playerType || 'REGULAR'
  if (pt === 'AGENT_CREDIT' || pt === 'WHITELABEL_CREDIT') {
    const err = new Error('Bet-tool API does not support credit players in MVP')
    ;(err as any).code = 'CREDIT_PLAYER'
    throw err
  }
  return user
}

async function getCasinoBetRow(betId: string) {
  const [row] = await db.select().from(casinoBets as any).where(eqL(casinoBets.id, betId)).limit(1)
  return row ?? null
}

/**
 * Place casino bet using GMAG semantics: game resolved by external id + `gmagcasino` provider,
 * caller-supplied `whitelabelId` (must match `tenant` at route), min/max + player limits + spendable cash, duplicate txn id rejected.
 */
export async function toolPlaceCasinoBet(input: {
  tenant: string
  /** Must match `tenant` at route; persisted on casino_bets (GMAG-style). */
  whitelabelId: string
  userId: number
  stake: number
  /** GMAG external game id (same as callback `gameCode`). */
  gameCode: string
  /** Optional idempotency keys; defaults to tool-{uuid}. */
  transactionId?: string
  gameRoundId?: string
  /** Stored on `casino_bets.metadata` (e.g. `{ betToolClient: { ... } }`). */
  clientMetadata?: Record<string, unknown> | null
}) {
  await loadRegularCashPlayer(input.userId, input.tenant)
  await assertPlayerDomainBetting(db, input.tenant, input.userId, 'casino')
  if (!Number.isFinite(input.stake) || input.stake <= 0) {
    throw new Error('Invalid stake')
  }
  // Agent players: refused while their agent branch is not ACTIVE or lacks the casino domain.
  await assertPlayerAgentAllowsBetting(db, { userId: input.userId, tenant: input.tenant }, 'casino')
  const gameCode = String(input.gameCode ?? '').trim()
  if (!gameCode) {
    throw new Error('gameCode is required')
  }

  const currency = (await getWhitelabelCurrency(input.whitelabelId)) || 'INR'
  const transactionId = input.transactionId?.trim() || `tool-${randomUUID()}`
  const gameRoundId = input.gameRoundId?.trim() || `tool-${randomUUID()}`

  const { assertGmagCashBetPlaceAllowed, GMAG_PROVIDER_KEY } = await import('../domains/casino/gmagCasinoService.js')

  const betRow = await db.transaction(async (tx: any) => {
    const game = await getCasinoGameByExternalIdAndProviderKey(gameCode, GMAG_PROVIDER_KEY, tx)
    if (!game) {
      throw new Error('Game not found')
    }

    const wallet = await ensureWalletWithExecutor(tx, input.userId, input.tenant, currency)
    await tx.execute(sql`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`)
    const [lockedWallet] = await (tx as any)
      .select()
      .from(walletsT)
      .where(eqL(walletsT.id, wallet.id))
      .limit(1)
    const w = lockedWallet ?? wallet

    await assertGmagCashBetPlaceAllowed(tx, {
      userId: input.userId,
      tenant: input.tenant,
      amount: input.stake,
      gameId: game.id,
      wallet: { cash: w.cash, exposure: w.exposure },
    })

    const isDup = await checkDuplicateTransactionId(input.userId, transactionId, tx)
    if (isDup) {
      const err = new Error('Duplicate transaction id')
      ;(err as any).code = 'DUPLICATE_TRANSACTION_ID'
      throw err
    }

    await debitWalletForCasino(
      tx as any,
      input.userId,
      input.tenant,
      input.stake,
      'cash',
      { type: 'casino_bet', transactionId, roundId: gameRoundId },
      currency
    )
    return createCasinoBet(
      {
        tenant: input.tenant,
        whitelabelId: input.whitelabelId,
        userId: input.userId,
        gameId: game.id,
        gameName: game.name,
        providerId: game.providerId,
        vendorId: game.vendorId,
        vendorName: game.vendorName,
        tableId: game.tableId,
        stake: String(input.stake),
        transactionId,
        gameRoundId,
        walletType: 'cash',
        bonusAwardId: null,
        currency,
        excludeFromAdminRunning: true,
        metadata: input.clientMetadata ?? undefined,
      },
      tx as any
    )
  })

  return betRow
}

export async function toolSettleCasinoBet(input: {
  tenant: string
  whitelabelId: string
  userId: number
  betId: string
  outcome: 'won' | 'lost'
  /** Total amount credited to wallet on win (includes stake return + profit). */
  payout?: number
}) {
  await loadRegularCashPlayer(input.userId, input.tenant, false)
  const bet = await getCasinoBetRow(input.betId)
  if (!bet) {
    throw new Error('Bet not found')
  }
  if (bet.userId !== input.userId || bet.tenant !== input.tenant) {
    throw new Error('Bet does not match tenant/user')
  }
  if (String(bet.whitelabelId ?? '') !== input.whitelabelId) {
    throw new Error('Bet does not match whitelabel')
  }
  if (!bet.excludeFromAdminRunning) {
    throw new Error('Bet is not eligible for bet-tool settlement')
  }
  if (bet.status !== 'active') {
    throw new Error('Bet is not active')
  }

  const stake = Number(bet.stake || 0)
  const resultTxnId = `tool-result-${randomUUID()}`

  if (input.outcome === 'lost') {
    await db.transaction(async (tx: any) => {
      const updated = await updateBetResult(
        bet.id,
        {
          status: 'lost',
          netAmount: String(-stake),
          winAmount: '0',
          payout: '0',
          resultTransactionId: resultTxnId,
        },
        tx as any
      )
      if (!updated) {
        const err = new Error('Bet is already settled or not active')
        ;(err as any).code = 'BET_ALREADY_SETTLED'
        throw err
      }
      await updateBonusWagering(input.userId, input.tenant, stake, 'casino', String(bet.gameId), 'cash', tx as any)
    })
    await triggerReferralBetSettlement({
      tenant: input.tenant,
      userId: input.userId,
      netRevenue: -stake,
      currency: bet.currency || 'INR',
      domain: 'casino',
      betId: bet.id,
    })
    return getCasinoBetRow(input.betId)
  }

  const payout = input.payout
  if (payout == null || !Number.isFinite(payout) || payout < 0) {
    throw new Error('payout is required for won outcome')
  }

  const net = payout - stake
  await db.transaction(async (tx: any) => {
    const updated = await updateBetResult(
      bet.id,
      {
        status: 'won',
        netAmount: String(Number(net.toFixed(2))),
        winAmount: String(Number(payout.toFixed(2))),
        payout: String(Number(payout.toFixed(2))),
        resultTransactionId: resultTxnId,
      },
      tx as any
    )
    if (!updated) {
      const err = new Error('Bet is already settled or not active')
      ;(err as any).code = 'BET_ALREADY_SETTLED'
      throw err
    }
    if (payout > 0) {
      await creditWalletForCasino(tx as any, input.userId, input.tenant, payout, 'cash', {
        type: 'casino_win',
        transactionId: bet.transactionId ?? undefined,
        roundId: bet.gameRoundId ?? undefined,
      })
    }
    await updateBonusWagering(input.userId, input.tenant, stake, 'casino', String(bet.gameId), 'cash', tx as any)
  })

  return getCasinoBetRow(input.betId)
}

export async function toolDeleteCasinoBet(input: {
  tenant: string
  whitelabelId: string
  userId: number
  betId: string
}) {
  await loadRegularCashPlayer(input.userId, input.tenant, false)
  const bet = await getCasinoBetRow(input.betId)
  if (!bet) {
    throw new Error('Bet not found')
  }
  if (bet.userId !== input.userId || bet.tenant !== input.tenant) {
    throw new Error('Bet does not match tenant/user')
  }
  if (String(bet.whitelabelId ?? '') !== input.whitelabelId) {
    throw new Error('Bet does not match whitelabel')
  }
  if (!bet.excludeFromAdminRunning) {
    throw new Error('Bet is not eligible for bet-tool delete')
  }
  if (bet.status !== 'active') {
    const err = new Error('Settled bets cannot be permanently deleted')
    ;(err as any).code = 'SETTLED'
    throw err
  }

  const stake = Number(bet.stake || 0)
  await db.transaction(async (tx: any) => {
    if (stake > 0) {
      const wType = bet.walletType === 'bonus' ? 'bonus' : bet.walletType === 'referralBonus' ? 'referralBonus' : 'cash'
      await restoreCasinoStakeAndStripPlacementLedgers(
        tx as any,
        input.userId,
        input.tenant,
        stake,
        wType,
        bet.transactionId ?? null
      )
    }
    await deleteCasinoBetById(input.betId, tx as any)
  })

  return { deleted: true }
}
