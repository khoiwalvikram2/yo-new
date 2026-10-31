/**
 * Single-bet sports settlement wallet + ledger effects (shared between admin batch settlement and bet-tool).
 * Caller supplies settleSportsBetRow + optional credit release; cash path uses injected ledger base conversion.
 */
import { sql, eq, and, or } from 'drizzle-orm'
import {
  wallets,
  ledgerEntries,
  users,
  bonusAwards,
  bonusCampaigns,
} from '../db/schema.js'

export type SportsResultMarketType = 'exchange' | 'bookmaker' | 'fancy'

export type SportsSingleBetSettlementRow = {
  id: string
  userId: number
  stake: string | null
  liability: string | null
  price: string | null
  oddsSize: string | null
  side: 'back' | 'lay'
  currency: string | null
  status: string
}

export function calculateSportsSettlementWinAmount(
  bet: SportsSingleBetSettlementRow,
  outcome: 'won' | 'lost' | 'void',
  marketType: SportsResultMarketType
): number {
  const stake = Number(bet.stake || 0)
  const price = Number(bet.price || 0)
  const liability = Number(bet.liability || 0)
  const oddsSizeValue = Number(bet.oddsSize ?? 0)
  const oddsSizePercent = oddsSizeValue > 0 ? oddsSizeValue : 100

  if (outcome === 'void' || outcome === 'lost') {
    return 0
  }

  if (marketType === 'fancy') {
    if (bet.side === 'back') {
      return stake * (oddsSizePercent / 100)
    }
    return stake
  }
  if (bet.side === 'back') {
    return stake * price
  }
  return stake
}

export function calculateSportsSettlementBetPl(
  bet: SportsSingleBetSettlementRow,
  outcome: 'won' | 'lost' | 'void',
  marketType: SportsResultMarketType
): number {
  const stake = Number(bet.stake || 0)
  const liability = Number(bet.liability || 0)
  if (outcome === 'void') return 0
  if (outcome === 'won') {
    if (marketType === 'fancy') {
      if (bet.side === 'back') {
        const oddsSizePercent = Number(bet.oddsSize ?? 0) > 0 ? Number(bet.oddsSize) : 100
        return stake * (oddsSizePercent / 100)
      }
      return stake
    }
    if (bet.side === 'back') {
      return stake * (Number(bet.price || 0) - 1)
    }
    return stake
  }
  if (marketType === 'fancy') {
    if (bet.side === 'back') {
      return -stake
    }
    const osPct = Number(bet.oddsSize ?? 0) > 0 ? Number(bet.oddsSize) : 100
    return -(stake * (osPct / 100))
  }
  if (bet.side === 'back') {
    return -stake
  }
  return -liability
}

export type SettleSportsBetRowFn = (
  tx: unknown,
  betId: string,
  status: 'won' | 'lost' | 'void',
  winAmount: number | undefined,
  settledAt: Date,
  pl: number
) => Promise<{ id: string; userId: number } | null>

export type LedgerBaseAmountFn = (absAmount: number, currency: string) => number
export type BaseCurrencyCodeFn = () => string

export type ReleaseCreditForSportsBetFn = (args: {
  tx: unknown
  userId: number
  originalExposure: number
  kind: 'win' | 'loss' | 'void'
  amount: number
  tenant: string
  betId: string
}) => Promise<void>

export type ApplySportsSingleBetSettlementInput = {
  bet: SportsSingleBetSettlementRow
  outcome: 'won' | 'lost' | 'void'
  marketType: SportsResultMarketType
  tenant: string
  marketId: string
  eventId: string
  resultId: string
  fallbackCurrency: string
  /** When set, skips wallet/user reads inside apply (admin batch path preloads for userWalletInfo). */
  preload?: { wallet: { id: number; cash: unknown; currency: unknown }; isCreditPlayer: boolean }
}

/** Set on `ok: false` when the bet row is not open for settlement (idempotent / duplicate settle). */
export type SportsSingleBetSettlementFailureCode = 'BET_ALREADY_SETTLED'

export type ApplySportsSingleBetSettlementResult =
  | { ok: false; error: string; code?: SportsSingleBetSettlementFailureCode }
  | {
      ok: true
      userId: number
      outcome: 'won' | 'lost' | 'void'
      isCreditPlayer: boolean
      /** Non-credit: delta to add to userMarketPnl for wallet_ledger aggregation */
      userMarketPnlDelta: number
      profitToCredit?: number
      lossAmount?: number
      postReferral?: { tenant: string; userId: number; netRevenue: number; currency: string; betId: string }
      postBonus?: { userId: number; tenant: string; betAmount: number }
      settlementCounts: { winners: number; losers: number; voids: number; totalPayout: number }
    }

export async function applySportsSingleBetSettlement(
  tx: unknown,
  input: ApplySportsSingleBetSettlementInput,
  settleRow: SettleSportsBetRowFn,
  toLedgerBase: LedgerBaseAmountFn,
  getBaseCurrency: BaseCurrencyCodeFn,
  releaseCreditForBet?: ReleaseCreditForSportsBetFn
): Promise<ApplySportsSingleBetSettlementResult> {
  const { bet, outcome, marketType, tenant, marketId, eventId, resultId, fallbackCurrency } = input

  if (bet.status !== 'matched' && bet.status !== 'unmatched') {
    return {
      ok: false,
      error: `Bet ${bet.id} is already settled with status: ${bet.status}`,
      code: 'BET_ALREADY_SETTLED',
    }
  }

  const winAmount = calculateSportsSettlementWinAmount(bet, outcome, marketType)
  if (winAmount < 0) {
    return { ok: false, error: `Invalid win amount ${winAmount} for bet ${bet.id}` }
  }

  let wallet: { id: number; cash: unknown; currency: unknown }
  let isCreditPlayer: boolean

  if (input.preload) {
    wallet = input.preload.wallet
    isCreditPlayer = input.preload.isCreditPlayer
  } else {
    const [w] = await (tx as any)
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, bet.userId), eq(wallets.tenant, tenant)))
      .limit(1)

    if (!w) {
      return { ok: false, error: `Wallet not found for user ${bet.userId}` }
    }
    wallet = w

    const [playerInfo] = await (tx as any)
      .select({ playerType: users.playerType })
      .from(users)
      .where(eq(users.id, bet.userId))
      .limit(1)

    isCreditPlayer = Boolean(
      playerInfo && (playerInfo.playerType === 'AGENT_CREDIT' || playerInfo.playerType === 'WHITELABEL_CREDIT')
    )
  }

  if (isCreditPlayer && !releaseCreditForBet) {
    return { ok: false, error: 'Credit player settlement requires releaseCreditForBet handler' }
  }

  const stake = Number(bet.stake || 0)
  const liability = Number(bet.liability || 0)
  const currency = (bet.currency || wallet.currency || fallbackCurrency) as string
  const betPl = calculateSportsSettlementBetPl(bet, outcome, marketType)
  const settledAt = new Date()
  const amountToStore =
    marketType === 'fancy' && bet.side === 'back'
      ? winAmount
      : winAmount > 0
        ? winAmount
        : undefined

  const settledRow = await settleRow(tx, bet.id, outcome, amountToStore, settledAt, betPl)
  if (!settledRow) {
    return {
      ok: false,
      error: `Bet ${bet.id} was already settled or not open; skipping wallet mutation`,
      code: 'BET_ALREADY_SETTLED',
    }
  }

  let userMarketPnlDelta = 0
  let profitToCredit: number | undefined
  let lossAmount: number | undefined
  let postReferral:
    | { tenant: string; userId: number; netRevenue: number; currency: string; betId: string }
    | undefined
  let settlementCounts = { winners: 0, losers: 0, voids: 0, totalPayout: 0 }

  if (outcome === 'won') {
    let profit = winAmount
    if (marketType !== 'fancy') {
      if (bet.side === 'back') {
        profit = stake * (Number(bet.price || 0) - 1)
      } else {
        profit = stake
      }
    }

    const betAmount = bet.side === 'back' ? stake : liability
    const winAmountForFormula =
      marketType === 'fancy'
        ? bet.side === 'back'
          ? stake + profit
          : stake
        : bet.side === 'back'
          ? stake * Number(bet.price || 0)
          : stake

    const hasActiveInstantOtp = await (tx as any)
      .select({ id: bonusAwards.id })
      .from(bonusAwards)
      .innerJoin(
        bonusCampaigns,
        and(eq(bonusCampaigns.id, bonusAwards.campaignId), eq(bonusCampaigns.tenant, tenant))
      )
      .where(
        and(
          eq(bonusAwards.userId, bet.userId),
          eq(bonusAwards.status, 'active'),
          eq(bonusCampaigns.distributionType, 'instant_otp'),
          or(eq(bonusAwards.domain, 'sports'), eq(bonusAwards.domain, 'global'))
        )
      )
      .limit(1)
      .then((rows: unknown[]) => rows.length > 0)

    const profitCredited = hasActiveInstantOtp
      ? Math.max(winAmountForFormula - betAmount, 0)
      : profit

    if (!isCreditPlayer) {
      await (tx as any)
        .update(wallets)
        .set({
          cash: sql`${wallets.cash} + ${profitCredited}`,
        })
        .where(eq(wallets.id, wallet.id))

      const baseAmount = toLedgerBase(Math.abs(profit), currency)
      await (tx as any).insert(ledgerEntries).values({
        tenant,
        walletId: wallet.id,
        type: 'credit',
        amount: String(baseAmount),
        meta: {
          type: 'sports_bet_settlement',
          betId: bet.id,
          outcome: 'won',
          profit,
          stake,
          marketType,
          originalCurrency: currency,
          baseAmount,
          baseCurrency: getBaseCurrency(),
          resultId,
          marketId,
          eventId,
        } as any,
      })
      userMarketPnlDelta = profitCredited
      profitToCredit = profitCredited
    }

    if (isCreditPlayer && releaseCreditForBet) {
      const originalExposure = bet.side === 'back' ? stake : liability
      await releaseCreditForBet({
        tx,
        userId: bet.userId,
        originalExposure,
        kind: 'win',
        amount: profit,
        tenant,
        betId: bet.id,
      })
    }

    settlementCounts = { winners: 1, losers: 0, voids: 0, totalPayout: profitCredited }
    postReferral = {
      tenant,
      userId: bet.userId,
      netRevenue: profitCredited,
      currency,
      betId: bet.id,
    }
  } else if (outcome === 'lost') {
    let loss = stake
    if (marketType === 'fancy') {
      if (bet.side === 'back') {
        loss = stake
      } else {
        const osPct = Number(bet.oddsSize ?? 0) > 0 ? Number(bet.oddsSize) : 100
        loss = stake * (osPct / 100)
      }
    } else {
      if (bet.side === 'back') {
        loss = stake
      } else {
        loss = liability
      }
    }

    if (!isCreditPlayer) {
      await (tx as any)
        .update(wallets)
        .set({
          cash: sql`${wallets.cash} - ${loss}`,
        })
        .where(eq(wallets.id, wallet.id))

      const baseAmount = toLedgerBase(Math.abs(loss), currency)
      await (tx as any).insert(ledgerEntries).values({
        tenant,
        walletId: wallet.id,
        type: 'debit',
        amount: String(baseAmount),
        meta: {
          type: 'sports_bet_settlement',
          betId: bet.id,
          outcome: 'lost',
          stake: loss,
          marketType,
          originalCurrency: currency,
          baseAmount,
          baseCurrency: getBaseCurrency(),
          resultId,
          marketId,
          eventId,
        } as any,
      })
      userMarketPnlDelta = -loss
      lossAmount = loss
      settlementCounts = { winners: 0, losers: 1, voids: 0, totalPayout: 0 }
    }

    if (isCreditPlayer && releaseCreditForBet) {
      const originalExposure = bet.side === 'back' ? stake : liability
      await releaseCreditForBet({
        tx,
        userId: bet.userId,
        originalExposure,
        kind: 'loss',
        amount: loss,
        tenant,
        betId: bet.id,
      })
      settlementCounts = { winners: 0, losers: 1, voids: 0, totalPayout: 0 }
    }

    postReferral = {
      tenant,
      userId: bet.userId,
      netRevenue: -loss,
      currency,
      betId: bet.id,
    }
  } else {
    await (tx as any).insert(ledgerEntries).values({
      tenant,
      walletId: wallet.id,
      type: 'void',
      amount: '0',
      meta: {
        type: 'sports_bet_settlement',
        betId: bet.id,
        outcome: 'void',
        stake,
        liability,
        marketType,
        originalCurrency: currency,
        baseCurrency: getBaseCurrency(),
        resultId,
        marketId,
        eventId,
        note: 'No cash change - exposure model (cash not deducted at bet placement)',
      } as any,
    })
    settlementCounts = { winners: 0, losers: 0, voids: 1, totalPayout: 0 }

    if (isCreditPlayer && releaseCreditForBet) {
      const originalExposure = bet.side === 'back' ? stake : liability
      await releaseCreditForBet({
        tx,
        userId: bet.userId,
        originalExposure,
        kind: 'void',
        amount: 0,
        tenant,
        betId: bet.id,
      })
    }
  }

  const betAmountBonus = bet.side === 'back' ? Number(bet.stake || 0) : Number(bet.liability || 0)
  const postBonus = { userId: bet.userId, tenant, betAmount: betAmountBonus }

  return {
    ok: true,
    userId: bet.userId,
    outcome,
    isCreditPlayer,
    userMarketPnlDelta,
    profitToCredit,
    lossAmount,
    postReferral,
    postBonus,
    settlementCounts,
  }
}
