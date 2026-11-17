import { db } from '@src/db/client.js'
import { eq, and, sql, inArray, gte, or } from 'drizzle-orm'
import { wallets, ledgerEntries, users } from '@src/db/schema.js'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { applySportsSingleBetSettlement } from '@shared/services/sportsSingleBetSettlementApply.js'
import { isCreditPlayer as isCreditPlayerType } from '@shared/services/credit/isCreditPlayer.js'
import {
  sportsBets,
  sportsMarketsTable,
  sportsRunnersTable,
} from '@shared/db/schema.js'
import { getOpenBetsForMarket, settleSportsBet } from '@src/repos/sports/sportsBetsRepo.js'
import { referralIntegrationService } from '@src/services/referrals/referralIntegrationService.js'
import { currencyService } from '@src/services/currencyService.js'
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js'
import type { SportsResultMarketType } from '@src/repos/sports/sportsResultsRepo.js'

/**
 * Per-market settlement lock: prevents parallel settlement for the same (tenant, whitelabel, marketId, eventId).
 * Duplicate/parallel result attempts are serialized; combined with atomic open->settled transition, no double cash deduction.
 */
const settlementLockByKey = new Map<string, Promise<void>>()

function settlementLockKey(tenant: string, whitelabelId: string, marketId: string, eventId: string): string {
  return `${tenant}:${whitelabelId}:${marketId}:${eventId}`
}

async function withSettlementLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = settlementLockByKey.get(key) ?? Promise.resolve()
  let resolveCurrent: () => void
  const currentDone = new Promise<void>((r) => { resolveCurrent = r })
  settlementLockByKey.set(key, prev.then(() => currentDone))
  try {
    await prev
    return await fn()
  } finally {
    resolveCurrent!()
  }
}

/**
 * =====================================================
 * EXPOSURE CALCULATION (Book-Based Model)
 * =====================================================
 * 
 * Calculates user exposure based on actual market book positions,
 * NOT by summing individual bet liabilities.
 */

interface BetDataForExposure {
  id: string
  marketId: string
  selectionId: string
  side: 'back' | 'lay'
  price: number
  stake: number
  oddsSize: number | null
}

interface MarketInfoForExposure {
  id: string
  type: string
  eventId: string
}

interface RunnerInfoForExposure {
  id: string
  marketId: string
  selectionCode: string
  name: string
}

/**
 * Calculate exposure for an exchange/bookmaker market
 */
function calculateExchangeMarketExposure(bets: BetDataForExposure[], runners: RunnerInfoForExposure[]): number {
  if (bets.length === 0) return 0

  const allSelections = new Set<string>()
  bets.forEach(b => {
    if (b.selectionId) allSelections.add(b.selectionId)
  })
  runners.forEach(r => {
    if (r.selectionCode) allSelections.add(r.selectionCode)
  })

  if (allSelections.size === 0) return 0

  const pnlBySelection: number[] = []

  for (const winningSelection of allSelections) {
    let netPnl = 0

    for (const bet of bets) {
      const stake = bet.stake
      const odds = bet.price
      const isThisSelection = bet.selectionId === winningSelection

      if (bet.side === 'back') {
        if (isThisSelection) {
          netPnl += stake * (odds - 1)
        } else {
          netPnl -= stake
        }
      } else {
        if (isThisSelection) {
          netPnl -= stake * (odds - 1)
        } else {
          netPnl += stake
        }
      }
    }

    pnlBySelection.push(netPnl)
  }

  const worstCase = Math.min(...pnlBySelection)
  return worstCase < 0 ? Math.abs(worstCase) : 0
}

/**
 * Calculate exposure for a fancy market
 */
function calculateFancyMarketExposure(bets: BetDataForExposure[]): number {
  if (bets.length === 0) return 0

  const allOdds = bets.map(b => b.price).filter(o => o > 0)
  if (allOdds.length === 0) return 0

  const minOdd = Math.min(...allOdds)
  const maxOdd = Math.max(...allOdds)
  const rangeStart = Math.max(1, Math.floor(minOdd) - 5)
  const rangeEnd = Math.floor(maxOdd) + 5

  let worstPnl = 0

  for (let position = rangeStart; position <= rangeEnd; position++) {
    let netPnl = 0

    for (const bet of bets) {
      const oddsSize = bet.oddsSize ?? 100
      const oddsSizePercent = oddsSize / 100
      const stake = bet.stake

      if (bet.side === 'back') {
        if (position >= bet.price) {
          netPnl += stake * oddsSizePercent
        } else {
          netPnl -= stake
        }
      } else {
        if (position < bet.price) {
          netPnl += stake
        } else {
          netPnl -= stake * oddsSizePercent
        }
      }
    }

    if (netPnl < worstPnl) {
      worstPnl = netPnl
    }
  }

  return worstPnl < 0 ? Math.abs(worstPnl) : 0
}

/**
 * Recalculate and update wallet exposure for a user
 * Uses book-based calculation from remaining open bets.
 * Exported for use by voidBetWithRefund / cancelBet (manual void-invalid from admin).
 *
 * Every player type, credit players included: wallets.exposure is the only figure written.
 * Credit players hold their chips in wallets.cash (D/W model), so their exposure is held
 * against cash exactly like a cash player's; users.credit_used is no longer maintained.
 */
export async function recalculateUserExposure(userId: number, tenant: string, tx?: any): Promise<number> {
  const dbCtx = tx || db

  // Get all open bets for the user
  const openBets = await dbCtx
    .select({
      id: sportsBets.id,
      marketId: sportsBets.marketId,
      selectionId: sportsBets.selectionId,
      side: sportsBets.side,
      price: sportsBets.price,
      stake: sportsBets.stake,
      oddsSize: sportsBets.oddsSize,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.userId, userId),
        eq(sportsBets.tenant, tenant),
        or(
          eq(sportsBets.status, 'matched'),
          eq(sportsBets.status, 'unmatched')
        )
      )
    )

  if (openBets.length === 0) {
    // No open bets, set exposure to 0
    await dbCtx
      .update(wallets)
      .set({ exposure: '0' })
      .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    return 0
  }

  const bets: BetDataForExposure[] = openBets.map((bet: { id: string; marketId: string; selectionId: string; side: string; price: unknown; stake: unknown; oddsSize: unknown }) => ({
    id: bet.id,
    marketId: bet.marketId,
    selectionId: bet.selectionId,
    side: bet.side,
    price: Number(bet.price),
    stake: Number(bet.stake),
    oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
  }))

  const marketIds = [...new Set(bets.map(b => b.marketId))]

  const markets = await dbCtx
    .select({
      id: sportsMarketsTable.id,
      type: sportsMarketsTable.type,
      eventId: sportsMarketsTable.eventId,
    })
    .from(sportsMarketsTable)
    .where(inArray(sportsMarketsTable.id, marketIds))

  const marketMap = new Map<string, MarketInfoForExposure>()
  markets.forEach((m: { id: string; type: string; eventId: string }) => marketMap.set(m.id, m))

  const nonFancyMarketIds = markets.filter((m: { type: string }) => m.type !== 'fancy').map((m: { id: string }) => m.id)
  let runnerMap = new Map<string, RunnerInfoForExposure[]>()

  if (nonFancyMarketIds.length > 0) {
    const runners = await dbCtx
      .select({
        id: sportsRunnersTable.id,
        marketId: sportsRunnersTable.marketId,
        selectionCode: sportsRunnersTable.selectionCode,
        name: sportsRunnersTable.name,
      })
      .from(sportsRunnersTable)
      .where(inArray(sportsRunnersTable.marketId, nonFancyMarketIds))

    runners.forEach((r: { marketId: string; id: string; selectionCode: string; name: string }) => {
      const existing = runnerMap.get(r.marketId) || []
      existing.push(r)
      runnerMap.set(r.marketId, existing)
    })
  }

  const betsByMarket = new Map<string, BetDataForExposure[]>()
  bets.forEach(bet => {
    const existing = betsByMarket.get(bet.marketId) || []
    existing.push(bet)
    betsByMarket.set(bet.marketId, existing)
  })

  let totalExposure = 0

  for (const [marketId, marketBets] of betsByMarket) {
    const market = marketMap.get(marketId)
    if (!market) continue

    const marketType = (market.type || 'match_odds').toLowerCase()
    
    let marketExposure: number
    if (marketType === 'fancy') {
      marketExposure = calculateFancyMarketExposure(marketBets)
    } else {
      const runners = runnerMap.get(marketId) || []
      marketExposure = calculateExchangeMarketExposure(marketBets, runners)
    }

    totalExposure += marketExposure
  }

  // Update wallet with new exposure
  await dbCtx
    .update(wallets)
    .set({ exposure: String(totalExposure) })
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

  return totalExposure
}

export interface SettlementResult {
  betsSettled: number
  winners: number
  losers: number
  voids: number
  totalPayout: number
  errors: string[]
  postBonus?: { userId: number; tenant: string; betAmount: number }[]
  postReferral?: { tenant: string; userId: number; netRevenue: number; currency: string; betId: string }[]
  /** Full ISO timestamps of createdAt for each settled bet — resolver converts to TZ-aware dates for snapshot regeneration. */
  settledBetCreatedTimestamps?: string[]
}

/**
 * Determine if a bet is a winner based on result
 */
function determineBetOutcome(
  bet: any,
  resultData: {
    marketType: SportsResultMarketType
    runnerId?: string | null
    selectionName?: string | null
    result?: string | null
  }
): 'won' | 'lost' | 'void' {
  const { marketType, runnerId, selectionName, result } = resultData

  // Handle special statuses - all bets void
  if (selectionName && ['VOID', 'CANCELLED', 'SUSPENDED'].includes(selectionName)) {
    return 'void'
  }

  if (marketType === 'exchange' || marketType === 'bookmaker') {
    // Exchange/Bookmaker: Match runnerId
    // If runnerId is null (special status), all bets are void (handled above)
    if (!runnerId) {
      return 'void' // No runner means void
    }
    
    if (bet.runnerId === runnerId) {
      // Back bet wins if runner matches, Lay bet loses
      return bet.side === 'back' ? 'won' : 'lost'
    } else {
      // Back bet loses if runner doesn't match, Lay bet wins
      return bet.side === 'back' ? 'lost' : 'won'
    }
  } else if (marketType === 'fancy') {
    // Fancy: Compare result value with bet odds (threshold)
    if (!result || result === '') {
      return 'void' // No result means void
    }

    const resultValue = parseFloat(result)
    if (isNaN(resultValue)) {
      return 'void' // Invalid result
    }

    // Bet odds (price) is the threshold value (e.g., 50 runs)
    const betOdds = Number(bet.price || 0)
    if (betOdds <= 0) {
      return 'void'
    }

    // Fancy settlement logic:
    // Result < Bet Odds:
    //   BACK bet: Loss
    //   LAY bet: Win
    // Result >= Bet Odds:
    //   BACK bet: Win
    //   LAY bet: Loss

    if (resultValue < betOdds) {
      // Result is less than threshold
      return bet.side === 'back' ? 'lost' : 'won'
    } else {
      // Result is greater than or equal to threshold
      return bet.side === 'back' ? 'won' : 'lost'
    }
  }

  return 'void' // Default to void if unknown
}

/**
 * Calculate win amount for a bet
 * For fancy markets, uses oddsSize percentage for profit calculation
 */
function calculateWinAmount(
  bet: any, 
  outcome: 'won' | 'lost' | 'void',
  marketType: SportsResultMarketType
): number {
  const stake = Number(bet.stake || 0)
  const price = Number(bet.price || 0)
  const liability = Number(bet.liability || 0)
  // For fancy: use oddsSize (percentage). bet.size stores stake, NOT oddsSize!
  const oddsSizeValue = Number(bet.oddsSize ?? 0)
  const oddsSizePercent = oddsSizeValue > 0 ? oddsSizeValue : 100

  if (outcome === 'void') {
    return 0 // No win, stake refunded separately
  }

  if (outcome === 'lost') {
    return 0 // No win
  }

  // Winner calculation
  if (marketType === 'fancy') {
    // Fancy market settlement:
    // BACK bet win: Profit = stake * (oddsSize / 100)
    // LAY bet win: Win = stake (full stake back)
    if (bet.side === 'back') {
      // BACK bet won: profit based on oddsSize percentage (e.g., 80 for 80%)
      const profit = stake * (oddsSizePercent / 100)
      return profit
    } else {
      // LAY bet won: win the stake amount
      return stake
    }
  } else {
    // Exchange/Bookmaker market settlement
    if (bet.side === 'back') {
      // Back bet won: total payout = stake * price
      return stake * price
    } else {
      // Lay bet won: win the backer's stake amount
      return stake
    }
  }
}

/**
 * Settle all bets for a sports result
 */
export async function settleSportsBetsForResult(
  resultId: string,
  marketId: string,
  eventId: string,
  marketType: SportsResultMarketType,
  resultData: {
    runnerId?: string | null
    selectionName?: string | null
    result?: string | null
  },
  tenant: string,
  whitelabelId: string,
  externalTx?: any
): Promise<SettlementResult> {
  const fallbackCurrency = await getWhitelabelCurrency(tenant)
  const settlementResult: SettlementResult = {
    betsSettled: 0,
    winners: 0,
    losers: 0,
    voids: 0,
    totalPayout: 0,
    errors: [],
  }

  let betsToSettle: Awaited<ReturnType<typeof getOpenBetsForMarket>> = []
  try {
    const openBets = await getOpenBetsForMarket(marketId, eventId, tenant, whitelabelId, {
      marketType,
      selectionName: resultData.selectionName,
    })
    betsToSettle = openBets
    // For fancy: filter by selection only when declaring a numeric result (not VOID/CANCELLED/SUSPENDED)
    const isFancySpecialStatus = marketType === 'fancy' && resultData.selectionName && ['VOID', 'CANCELLED', 'SUSPENDED'].includes(resultData.selectionName)
    if (marketType === 'fancy' && resultData.selectionName && !isFancySpecialStatus) {
      betsToSettle = openBets.filter((bet) => {
        const betSelection = (bet.selectionId || '').toLowerCase().trim()
        const resultSelection = (resultData.selectionName || '').toLowerCase().trim()
        return (
          betSelection === resultSelection ||
          betSelection.includes(resultSelection) ||
          resultSelection.includes(betSelection)
        )
      })
      if (betsToSettle.length === 0) {
      }
    }
    // For fancy VOID/CANCELLED/SUSPENDED, betsToSettle stays as openBets (all open bets in market)
    if (betsToSettle.length === 0) {
      return settlementResult
    }

    const lockKey = settlementLockKey(tenant, whitelabelId, marketId, eventId)
    const postBonus: { userId: number; tenant: string; betAmount: number }[] = []
    const postReferral: { tenant: string; userId: number; netRevenue: number; currency: string; betId: string }[] = []
    const affectedUserIds = new Set<number>() // Track users that need exposure recalculation
    const settledBetTimestamps = new Set<string>()
    const userMarketPnl: Record<number, number> = {}
    const userWalletInfo: Record<number, { walletId: number; balanceBefore: number; exposureBefore: number }> = {}

    const run = async (tx: any) => {
      for (const bet of betsToSettle) {
        try {
          // Safety check: Skip if bet is already settled (in-memory snapshot)
          if (bet.status !== 'matched' && bet.status !== 'unmatched') {
            settlementResult.errors.push(`Bet ${bet.id} is already settled with status: ${bet.status}`)
            continue
          }

          // Determine outcome
          const outcome = determineBetOutcome(bet, { marketType, ...resultData })

          // Calculate win amount (pass marketType for fancy calculation)
          const winAmount = calculateWinAmount(bet, outcome, marketType)
          
          // Safety check: Ensure win amount is non-negative
          if (winAmount < 0) {
            settlementResult.errors.push(`Invalid win amount ${winAmount} for bet ${bet.id}`)
            continue
          }

          // Fetch wallet and player info BEFORE settling. Never settle a bet we cannot update balances for.
          const [wallet] = await tx
            .select()
            .from(wallets)
            .where(and(eq(wallets.userId, bet.userId), eq(wallets.tenant, tenant)))
            .limit(1)

          if (!wallet) {
            settlementResult.errors.push(`Wallet not found for user ${bet.userId}`)
            continue
          }

          if (!userWalletInfo[bet.userId]) {
            userWalletInfo[bet.userId] = {
              walletId: wallet.id,
              balanceBefore: Number(wallet.cash ?? 0),
              exposureBefore: Number(wallet.exposure ?? 0),
            }
          }

          // Credit players settle into wallets.cash like everyone else (their chips live
          // there); the type is still needed so the apply step skips their bonus and
          // referral hooks. Nothing is pushed to the agent or the whitelabel.
          const [playerInfo] = await tx
            .select({ playerType: users.playerType })
            .from(users)
            .where(eq(users.id, bet.userId))
            .limit(1)
          const isCreditPlayer = isCreditPlayerType(playerInfo?.playerType)

          const step = await applySportsSingleBetSettlement(
            tx,
            {
              bet: bet as any,
              outcome,
              marketType,
              tenant,
              marketId,
              eventId,
              resultId,
              fallbackCurrency,
              preload: { wallet: wallet as any, isCreditPlayer },
            },
            async (tt, betId, status, w, s, pl) => settleSportsBet(betId, status, w, s, tt, pl),
            (a, c) => currencyService.toBaseCurrency(a, c as any),
            () => currencyService.getBaseCurrency()
          )

          if (!step.ok) {
            settlementResult.errors.push(step.error)
            continue
          }

          affectedUserIds.add(bet.userId)
          userMarketPnl[bet.userId] = (userMarketPnl[bet.userId] ?? 0) + step.userMarketPnlDelta
          settlementResult.winners += step.settlementCounts.winners
          settlementResult.losers += step.settlementCounts.losers
          settlementResult.voids += step.settlementCounts.voids
          settlementResult.totalPayout += step.settlementCounts.totalPayout
          if (step.postReferral) {
            postReferral.push(step.postReferral)
          }
          if (step.postBonus) {
            postBonus.push(step.postBonus)
          }
          settlementResult.betsSettled++
          if (bet.createdAt) {
            const d = bet.createdAt instanceof Date ? bet.createdAt : new Date(bet.createdAt as any)
            if (!isNaN(d.getTime())) settledBetTimestamps.add(d.toISOString())
          }
        } catch (error: any) {
          const errorMsg = `Failed to settle bet ${bet.id}: ${error.message}`
          settlementResult.errors.push(errorMsg)
          throw error
        }
      }

      // Recalculate exposure first so ledger balanceAfter matches next row's balanceBefore (available = cash - exposure)
      for (const userId of affectedUserIds) {
        try {
          await recalculateUserExposure(userId, tenant, tx)
        } catch (expError: any) {
          // Don't fail the settlement, just log the error
        }
      }

      // Per-market wallet_ledger entries per user: (1) P&L settle, (2) exposure release (if any)
      for (const userId of affectedUserIds) {
        const info = userWalletInfo[userId]
        const pnl = userMarketPnl[userId] ?? 0
        if (info) {
          const virtualBefore = info.balanceBefore - info.exposureBefore
          const [walletAfter] = await tx.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant))).limit(1)
          const availableAfter = walletAfter
            ? Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
            : virtualBefore + pnl
          const settleAmount = pnl > 0 ? pnl : 0
          const settleBalanceAfter = virtualBefore + settleAmount

          if (pnl > 0) {
            await createWalletLedgerEntry(tx, {
              tenant,
              walletId: info.walletId,
              userId,
              walletType: 'cash',
              category: 'sports_settle',
              direction: 'credit',
              amount: pnl,
              balanceBefore: virtualBefore,
              balanceAfter: settleBalanceAfter,
              description: 'Sports settle (win)',
              referenceType: 'sports_market',
              referenceId: marketId,
              meta: { marketId, resultId },
            })
          } else {
            await createWalletLedgerEntry(tx, {
              tenant,
              walletId: info.walletId,
              userId,
              walletType: 'cash',
              category: 'sports_settle',
              direction: 'credit',
              amount: 0,
              balanceBefore: virtualBefore,
              balanceAfter: settleBalanceAfter,
              description: pnl < 0 ? 'Sports settle (loss)' : 'Sports settle (no change)',
              referenceType: 'sports_market',
              referenceId: marketId,
              meta: { marketId, resultId },
            })
          }

          const exposureReleased = availableAfter - settleBalanceAfter
          if (exposureReleased > 0) {
            await createWalletLedgerEntry(tx, {
              tenant,
              walletId: info.walletId,
              userId,
              walletType: 'cash',
              category: 'sports_exposure_release',
              direction: 'credit',
              amount: exposureReleased,
              balanceBefore: settleBalanceAfter,
              balanceAfter: availableAfter,
              description: 'Sports settle (exposure release)',
              referenceType: 'sports_market',
              referenceId: marketId,
              meta: { marketId, resultId },
            })
          }
        }
      }
    }

    await withSettlementLock(lockKey, async () => {
      try {
        if (externalTx) {
          await run(externalTx)
          settlementResult.postBonus = postBonus
          settlementResult.postReferral = postReferral
          settlementResult.settledBetCreatedTimestamps = [...settledBetTimestamps]
        } else {
          await db.transaction(async (tx) => { await run(tx) })
          settlementResult.settledBetCreatedTimestamps = [...settledBetTimestamps]
          for (const { userId, tenant: t, betAmount } of postBonus) {
            try {
              const { updateBonusWagering } = await import('@shared/services/bonusService.js')
              await updateBonusWagering(userId, t, betAmount, 'sports', undefined, 'cash')
            } catch (e: any) {
              // Best-effort by design: settlement has already committed, so this
              // must not throw. Report it — otherwise the player's wagering
              // progress silently stalls and the bonus never releases.
              console.error(
                `[bonusWagering] failed to record sports stake for user ${userId} (${t}), amount ${betAmount}:`,
                e?.message ?? e
              )
            }
          }
          for (const { tenant: t, userId, netRevenue, currency, betId } of postReferral) {
            try {
              await referralIntegrationService.handleBetSettlement(t, userId, netRevenue, currency as any, 'sports', betId)
            } catch (e: any) {
            }
          }
        }
      } catch (error: any) {
        const errorMsg = `Settlement transaction failed: ${error.message}`
        settlementResult.errors.push(errorMsg)
      }
    })
  } catch (error: any) {
    const errorMsg = `Settlement failed: ${error.message}`
    settlementResult.errors.push(errorMsg)
  }

  return settlementResult
}

/**
 * Settle all open bets for a global result across every whitelabel.
 * Called when Super Admin declares a result in core mode (is_global = true).
 */
export async function settleSportsBetsForResultAllWhitelabels(
  resultId: string,
  marketId: string,
  eventId: string,
  marketType: SportsResultMarketType,
  resultData: {
    runnerId?: string | null
    selectionName?: string | null
    result?: string | null
  },
  externalTx: any
): Promise<SettlementResult> {
  const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
  const whitelabels = await listWhitelabelsDb()
  const aggregated: SettlementResult = {
    betsSettled: 0,
    winners: 0,
    losers: 0,
    voids: 0,
    totalPayout: 0,
    errors: [],
    postBonus: [],
    postReferral: [],
    settledBetCreatedTimestamps: [],
  }
  const allTimestamps = new Set<string>()

  for (const wl of whitelabels) {
    const tenant = wl.id
    const whitelabelId = wl.id
    const one = await settleSportsBetsForResult(
      resultId,
      marketId,
      eventId,
      marketType,
      resultData,
      tenant,
      whitelabelId,
      externalTx
    )
    aggregated.betsSettled += one.betsSettled
    aggregated.winners += one.winners
    aggregated.losers += one.losers
    aggregated.voids += one.voids
    aggregated.totalPayout += one.totalPayout
    if (one.errors?.length) aggregated.errors.push(...one.errors)
    if (one.postBonus?.length) aggregated.postBonus!.push(...one.postBonus)
    if (one.postReferral?.length) aggregated.postReferral!.push(...one.postReferral)
    if (one.settledBetCreatedTimestamps?.length) one.settledBetCreatedTimestamps.forEach((ts) => allTimestamps.add(ts))
  }
  aggregated.settledBetCreatedTimestamps = [...allTimestamps]

  return aggregated
}

/** Per-whitelabel reversal; returns counts and pushes errors/referral to provided arrays */
async function reverseSportsBetSettlementsForWhitelabel(
  resultId: string,
  marketId: string,
  eventId: string,
  tenant: string,
  whitelabelId: string,
  result: { marketType: string; declaredAt: Date },
  errorsArr: string[],
  postReversalReferral: { tenant: string; userId: number; betId: string }[]
): Promise<{ betsSettled: number; winners: number; losers: number; voids: number; totalPayout: number }> {
  const marketType = result.marketType as SportsResultMarketType
  const resultDeclaredAt = result.declaredAt
  const out = { betsSettled: 0, winners: 0, losers: 0, voids: 0, totalPayout: 0 }
  const fallbackCurrency = await getWhitelabelCurrency(tenant)
  const { sportsResultsTable } = await import('@shared/db/schema.js')

  const subsequentResults = await db.select()
    .from(sportsResultsTable)
    .where(
      and(
        eq(sportsResultsTable.marketId, marketId),
        eq(sportsResultsTable.tenant, tenant),
        eq(sportsResultsTable.whitelabelId, whitelabelId),
        sql`${sportsResultsTable.declaredAt} > ${resultDeclaredAt}`,
        sql`${sportsResultsTable.id} != ${resultId}`
      )
    )
    .orderBy(sql`${sportsResultsTable.declaredAt} ASC`)
    .limit(1)
  const subsequentResult = subsequentResults[0] || null
  const timeConditions = [sql`${sportsBets.settledAt} >= ${resultDeclaredAt}`]
  if (subsequentResult) timeConditions.push(sql`${sportsBets.settledAt} < ${subsequentResult.declaredAt}`)

  const settledBets = await db.select()
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.marketId, marketId),
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.tenant, tenant),
        eq(sportsBets.whitelabelId, whitelabelId),
        inArray(sportsBets.status, ['won', 'lost', 'void']),
        sql`${sportsBets.settledAt} IS NOT NULL`,
        ...timeConditions
      )
    )
    .orderBy(sql`${sportsBets.settledAt} DESC`)

  if (settledBets.length === 0) return out

  const affectedUserIdsForReversal = new Set<number>()
  const userReversalPnl: Record<number, number> = {}
  const userReversalInfo: Record<number, { walletId: number; balanceBefore: number; exposureBefore: number }> = {}
  const lockKey = settlementLockKey(tenant, whitelabelId, marketId, eventId)
  await withSettlementLock(lockKey, async () => {
    await db.transaction(async (tx) => {
    for (const bet of settledBets) {
      try {
        affectedUserIdsForReversal.add(bet.userId)
        const stake = Number(bet.stake || 0)
        const liability = Number(bet.liability || 0)
        const oddsSizeVal = Number(bet.oddsSize ?? 0)
        const oddsSizePct = oddsSizeVal > 0 ? oddsSizeVal : 100
        const storedWinAmount = bet.result ? Number(bet.result) : 0
        const originalStatus = bet.status as 'won' | 'lost' | 'void'

        const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.userId, bet.userId), eq(wallets.tenant, tenant))).limit(1)
        if (!wallet) {
          errorsArr.push(`Wallet not found for user ${bet.userId}`)
          throw new Error(`Wallet not found for user ${bet.userId}`)
        }
        const currency = (bet.currency || wallet.currency || fallbackCurrency) as any
        // Every player type reverses in wallets.cash, credit players included (their chips
        // live there), so the cash rules below apply to them too: a won bet whose profit is
        // no longer in cash cannot be reversed.
        if (!userReversalInfo[bet.userId]) {
          userReversalInfo[bet.userId] = { walletId: wallet.id, balanceBefore: Number(wallet.cash ?? 0), exposureBefore: Number(wallet.exposure ?? 0) }
        }

        let profitToReverse = 0
        let lossToReverse = 0
        if (originalStatus === 'won') {
          profitToReverse = marketType === 'fancy' ? storedWinAmount : (bet.side === 'back' ? stake * (Number(bet.price || 0) - 1) : stake)
          if (profitToReverse < 0) {
            errorsArr.push(`Invalid profit to reverse for bet ${bet.id}: ${profitToReverse}`)
            throw new Error(`Invalid profit to reverse for bet ${bet.id}`)
          }
        } else if (originalStatus === 'lost') {
          lossToReverse = marketType === 'fancy' ? (bet.side === 'back' ? stake : stake * (oddsSizePct / 100)) : (bet.side === 'back' ? stake : liability)
          if (lossToReverse < 0) {
            errorsArr.push(`Invalid loss to reverse for bet ${bet.id}: ${lossToReverse}`)
            throw new Error(`Invalid loss to reverse for bet ${bet.id}`)
          }
        }

        if (originalStatus === 'won') {
          userReversalPnl[bet.userId] = (userReversalPnl[bet.userId] ?? 0) - profitToReverse
          const currentCash = Number(wallet.cash || 0)
          if (currentCash < profitToReverse) {
            errorsArr.push(`Insufficient cash to reverse profit for bet ${bet.id}`)
            throw new Error(`Insufficient cash to reverse profit for bet ${bet.id}`)
          }
          await tx.update(wallets).set({ cash: sql`GREATEST(0, ${wallets.cash} - ${profitToReverse})` }).where(eq(wallets.id, wallet.id))
          const baseAmount = currencyService.toBaseCurrency(Math.abs(profitToReverse), currency)
          await tx.insert(ledgerEntries).values({ tenant, walletId: wallet.id, type: 'debit', amount: String(baseAmount), meta: { type: 'sports_bet_settlement_reversal', betId: bet.id, originalOutcome: 'won', reversedProfit: profitToReverse, marketType, originalCurrency: currency, baseAmount, baseCurrency: currencyService.getBaseCurrency(), resultId, marketId, eventId } as any })
          out.winners++
          out.totalPayout += profitToReverse
          // Not skipped for credit players: the reversal only offsets referral earnings
          // recorded for this bet, and settlement records none for a credit player.
          postReversalReferral.push({ tenant, userId: bet.userId, betId: bet.id })
        } else if (originalStatus === 'lost') {
          userReversalPnl[bet.userId] = (userReversalPnl[bet.userId] ?? 0) + lossToReverse
          await tx.update(wallets).set({ cash: sql`${wallets.cash} + ${lossToReverse}` }).where(eq(wallets.id, wallet.id))
          const baseAmount = currencyService.toBaseCurrency(Math.abs(lossToReverse), currency)
          await tx.insert(ledgerEntries).values({ tenant, walletId: wallet.id, type: 'credit', amount: String(baseAmount), meta: { type: 'sports_bet_settlement_reversal', betId: bet.id, originalOutcome: 'lost', restoredLoss: lossToReverse, marketType, originalCurrency: currency, baseAmount, baseCurrency: currencyService.getBaseCurrency(), resultId, marketId, eventId } as any })
          out.losers++
          postReversalReferral.push({ tenant, userId: bet.userId, betId: bet.id })
        } else if (originalStatus === 'void') {
          await tx.insert(ledgerEntries).values({ tenant, walletId: wallet.id, type: 'void', amount: '0', meta: { type: 'sports_bet_settlement_reversal', betId: bet.id, originalOutcome: 'void', stake, liability, marketType, originalCurrency: currency, baseCurrency: currencyService.getBaseCurrency(), resultId, marketId, eventId, note: 'No cash reversal needed' } as any })
          out.voids++
        }

        const originalOpenStatus = bet.matchedAt ? 'matched' : 'unmatched'
        await tx.update(sportsBets).set({ status: originalOpenStatus as any, settledAt: null, result: null, pl: null, updatedAt: new Date() }).where(eq(sportsBets.id, bet.id))
        out.betsSettled++
      } catch (error: any) {
        const msg = `Failed to reverse bet ${bet.id}: ${error.message}`
        errorsArr.push(msg)
        throw error
      }
    }
    for (const userId of affectedUserIdsForReversal) {
      try {
        await recalculateUserExposure(userId, tenant, tx)
      } catch (expError: any) {
      }
    }
    for (const userId of affectedUserIdsForReversal) {
      const info = userReversalInfo[userId]
      const pnl = userReversalPnl[userId] ?? 0
      if (info && pnl !== 0) {
        const virtualBefore = info.balanceBefore - info.exposureBefore
        const [walletAfter] = await tx.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant))).limit(1)
        const availableAfter = walletAfter
          ? Number(walletAfter.cash ?? 0) - Number(walletAfter.exposure ?? 0)
          : virtualBefore + pnl
        const settleBalanceAfter = virtualBefore + pnl
        await createWalletLedgerEntry(tx, {
          tenant,
          walletId: info.walletId,
          userId,
          walletType: 'cash',
          category: 'sports_rollback',
          direction: pnl > 0 ? 'credit' : 'debit',
          amount: Math.abs(pnl),
          balanceBefore: virtualBefore,
          balanceAfter: settleBalanceAfter,
          description: 'Sports settle rollback',
          referenceType: 'sports_market',
          referenceId: marketId,
          meta: { marketId, resultId },
        })

        const exposureDelta = availableAfter - settleBalanceAfter
        if (Math.abs(exposureDelta) > 0.005) {
          await createWalletLedgerEntry(tx, {
            tenant,
            walletId: info.walletId,
            userId,
            walletType: 'cash',
            category: 'sports_exposure_release',
            direction: exposureDelta > 0 ? 'credit' : 'debit',
            amount: Math.abs(exposureDelta),
            balanceBefore: settleBalanceAfter,
            balanceAfter: availableAfter,
            description: exposureDelta > 0 ? 'Sports rollback (exposure release)' : 'Sports rollback (exposure restored)',
            referenceType: 'sports_market',
            referenceId: marketId,
            meta: { marketId, resultId },
          })
        }
      }
    }
  })
  })
  return out
}

/**
 * Reverse settlements for a rolled back result.
 * When options.isGlobal is true, loads result by id only and runs reversal for every whitelabel.
 */
export async function reverseSportsBetSettlements(
  resultId: string,
  marketId: string,
  eventId: string,
  tenant: string,
  whitelabelId: string,
  options?: { isGlobal?: boolean }
): Promise<SettlementResult> {
  const { getSportsResultById } = await import('@src/repos/sports/sportsResultsRepo.js')
  const result = options?.isGlobal
    ? await getSportsResultById(resultId, '', '', { byIdOnly: true })
    : await getSportsResultById(resultId, tenant, whitelabelId)
  if (!result) {
    throw new Error(`Result ${resultId} not found for reversal`)
  }
  const marketType = result.marketType as SportsResultMarketType
  const reversalResult: SettlementResult = {
    betsSettled: 0,
    winners: 0,
    losers: 0,
    voids: 0,
    totalPayout: 0,
    errors: [],
  }
  const postReversalReferral: { tenant: string; userId: number; betId: string }[] = []

  if (options?.isGlobal) {
    const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
    const whitelabels = await listWhitelabelsDb()
    for (const wl of whitelabels) {
      const one = await reverseSportsBetSettlementsForWhitelabel(
        resultId,
        marketId,
        eventId,
        wl.id,
        wl.id,
        result,
        reversalResult.errors,
        postReversalReferral
      )
      reversalResult.betsSettled += one.betsSettled
      reversalResult.winners += one.winners
      reversalResult.losers += one.losers
      reversalResult.voids += one.voids
      reversalResult.totalPayout += one.totalPayout
    }
    for (const { tenant: t, userId, betId } of postReversalReferral) {
      try {
        await referralIntegrationService.handleBetSettlementReversal(t, userId, betId, 'sports')
      } catch (e: any) {
      }
    }
    return reversalResult
  }

  try {
    const one = await reverseSportsBetSettlementsForWhitelabel(
      resultId,
      marketId,
      eventId,
      tenant,
      whitelabelId,
      result,
      reversalResult.errors,
      postReversalReferral
    )
    reversalResult.betsSettled = one.betsSettled
    reversalResult.winners = one.winners
    reversalResult.losers = one.losers
    reversalResult.voids = one.voids
    reversalResult.totalPayout = one.totalPayout

    for (const { tenant: t, userId, betId } of postReversalReferral) {
      try {
        await referralIntegrationService.handleBetSettlementReversal(t, userId, betId, 'sports')
      } catch (e: any) {
      }
    }
  } catch (error: any) {
    const errorMsg = `Reversal transaction failed: ${error.message}`
    reversalResult.errors.push(errorMsg)
  }

  return reversalResult
}

