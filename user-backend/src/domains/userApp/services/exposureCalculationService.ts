import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '../../../db/client.js'
import {
  sportsBets,
  wallets,
  sportsMarketsTable,
  sportsRunnersTable,
  users,
} from '@shared/db/schema.js'
import { getWhitelabelCurrency, getCurrencySymbol } from '../../../shared/whitelabelConfig.js'

/**
 * Exposure Calculation Service
 * 
 * Calculates user exposure based on actual market book positions,
 * NOT by summing individual bet liabilities.
 * 
 * For each market:
 * - Exchange/Bookmaker: Calculate P&L for each selection winning, take worst case (most negative)
 * - Fancy: Calculate P&L across all possible result positions, take worst case (most negative)
 * 
 * Total exposure = Sum of all market exposures (absolute value of worst-case losses)
 */

interface BetData {
  id: string
  marketId: string
  selectionId: string
  side: 'back' | 'lay'
  price: number // odds
  stake: number
  oddsSize: number | null // for fancy bets
}

/** Additional leg for projected exposure (e.g. bet being placed) */
export interface AdditionalLegForExposure {
  marketId: string
  selectionId: string
  side: 'back' | 'lay'
  price: number
  stake: number
  oddsSize?: number | null
}

interface MarketInfo {
  id: string
  type: string
  eventId: string
}

interface RunnerInfo {
  id: string
  marketId: string
  selectionCode: string
  name: string
}

/**
 * Calculate total exposure for a user based on market book positions.
 * Pass tx when calling from inside a transaction (e.g. placement).
 */
export async function calculateUserExposure(
  userId: number,
  tenant: string,
  tx?: any
): Promise<number> {
  const dbCtx = tx ?? db
  // Get all open bets for the user (matched or unmatched status)
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
    return 0
  }

  type OpenBetRow = { id: string; marketId: string; selectionId: string; side: 'back' | 'lay'; price: string; stake: string; oddsSize: string | null }
  type MarketRow = { id: string; type: string; eventId: string }
  type RunnerRow = { id: string; marketId: string; selectionCode: string | null; name: string | null }

  // Convert to BetData format
  const bets: BetData[] = (openBets as OpenBetRow[]).map((bet: OpenBetRow) => ({
    id: bet.id,
    marketId: bet.marketId,
    selectionId: bet.selectionId,
    side: bet.side,
    price: Number(bet.price),
    stake: Number(bet.stake),
    oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
  }))

  // Get unique market IDs
  const marketIds = [...new Set(bets.map(b => b.marketId))]

  // Get market info to determine type (exchange/bookmaker/fancy)
  const markets = await dbCtx
    .select({
      id: sportsMarketsTable.id,
      type: sportsMarketsTable.type,
      eventId: sportsMarketsTable.eventId,
    })
    .from(sportsMarketsTable)
    .where(inArray(sportsMarketsTable.id, marketIds))

  const marketMap = new Map<string, MarketInfo>()
  ;(markets as MarketRow[]).forEach((m: MarketRow) => marketMap.set(m.id, m))

  // Get runners for non-fancy markets to know all possible selections
  const nonFancyMarketIds = (markets as MarketRow[])
    .filter((m: MarketRow) => m.type !== 'fancy')
    .map((m: MarketRow) => m.id)

  let runnerMap = new Map<string, RunnerInfo[]>()
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

    ;(runners as RunnerRow[]).forEach((r: RunnerRow) => {
      const existing = runnerMap.get(r.marketId) || []
      existing.push({ id: r.id, marketId: r.marketId, selectionCode: r.selectionCode ?? '', name: r.name ?? '' })
      runnerMap.set(r.marketId, existing)
    })
  }

  // Group bets by market
  const betsByMarket = new Map<string, BetData[]>()
  bets.forEach(bet => {
    const existing = betsByMarket.get(bet.marketId) || []
    existing.push(bet)
    betsByMarket.set(bet.marketId, existing)
  })

  // Calculate exposure for each market
  let totalExposure = 0

  for (const [marketId, marketBets] of betsByMarket) {
    const market = marketMap.get(marketId)
    if (!market) continue

    const marketType = (market.type || 'match_odds').toLowerCase()
    
    let marketExposure: number
    if (marketType === 'fancy') {
      marketExposure = calculateFancyMarketExposure(marketBets)
    } else {
      // Exchange or bookmaker
      const runners = runnerMap.get(marketId) || []
      marketExposure = calculateExchangeMarketExposure(marketBets, runners)
    }

    totalExposure += marketExposure
  }

  return totalExposure
}

/**
 * Projected book-based exposure if we add the given legs (e.g. pre-placement validation).
 * Uses same per-market worst-case logic as calculateUserExposure.
 */
export async function calculateProjectedExposure(
  userId: number,
  tenant: string,
  additionalLegs: AdditionalLegForExposure[]
): Promise<number> {
  const openBets = await db
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

  const bets: BetData[] = openBets.map(bet => ({
    id: bet.id,
    marketId: bet.marketId,
    selectionId: bet.selectionId,
    side: bet.side,
    price: Number(bet.price),
    stake: Number(bet.stake),
    oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
  }))

  for (let i = 0; i < additionalLegs.length; i++) {
    const leg = additionalLegs[i]
    bets.push({
      id: `proj-${i}`,
      marketId: leg.marketId,
      selectionId: leg.selectionId,
      side: leg.side,
      price: leg.price,
      stake: leg.stake,
      oddsSize: leg.oddsSize != null ? Number(leg.oddsSize) : null,
    })
  }

  if (bets.length === 0) return 0

  const marketIds = [...new Set(bets.map(b => b.marketId))]
  const markets = await db
    .select({
      id: sportsMarketsTable.id,
      type: sportsMarketsTable.type,
      eventId: sportsMarketsTable.eventId,
    })
    .from(sportsMarketsTable)
    .where(inArray(sportsMarketsTable.id, marketIds))

  const marketMap = new Map<string, MarketInfo>()
  markets.forEach(m => marketMap.set(m.id, m))

  const nonFancyMarketIds = markets
    .filter(m => m.type !== 'fancy')
    .map(m => m.id)
  let runnerMap = new Map<string, RunnerInfo[]>()
  if (nonFancyMarketIds.length > 0) {
    const runners = await db
      .select({
        id: sportsRunnersTable.id,
        marketId: sportsRunnersTable.marketId,
        selectionCode: sportsRunnersTable.selectionCode,
        name: sportsRunnersTable.name,
      })
      .from(sportsRunnersTable)
      .where(inArray(sportsRunnersTable.marketId, nonFancyMarketIds))
    runners.forEach(r => {
      const existing = runnerMap.get(r.marketId) || []
      existing.push({
        id: r.id,
        marketId: r.marketId,
        selectionCode: r.selectionCode ?? '',
        name: r.name ?? '',
      })
      runnerMap.set(r.marketId, existing)
    })
  }

  const betsByMarket = new Map<string, BetData[]>()
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
    const marketExposure =
      marketType === 'fancy'
        ? calculateFancyMarketExposure(marketBets)
        : calculateExchangeMarketExposure(marketBets, runnerMap.get(marketId) || [])
    totalExposure += marketExposure
  }
  return totalExposure
}

/**
 * Calculate exposure for an exchange/bookmaker market
 * 
 * For each selection that could win, calculate the net P&L:
 * - BACK bet on selection X: If X wins → profit = stake × (odds - 1), If X loses → loss = -stake
 * - LAY bet on selection X: If X wins → loss = -stake × (odds - 1), If X loses → profit = +stake
 * 
 * Market exposure = absolute value of the worst-case (most negative) P&L
 */
function calculateExchangeMarketExposure(bets: BetData[], runners: RunnerInfo[]): number {
  if (bets.length === 0) return 0

  // Get all unique selections from bets and runners (skip empty to avoid bogus worst-case)
  const allSelections = new Set<string>()
  bets.forEach(b => {
    if (b.selectionId) allSelections.add(b.selectionId)
  })
  runners.forEach(r => {
    if (r.selectionCode) allSelections.add(r.selectionCode)
  })

  // If no runners found, use selections from bets
  if (allSelections.size === 0) {
    return 0
  }

  // Calculate P&L for each possible winning selection
  const pnlBySelection: number[] = []

  for (const winningSelection of allSelections) {
    let netPnl = 0

    for (const bet of bets) {
      const stake = bet.stake
      const odds = bet.price
      const isThisSelection = bet.selectionId === winningSelection

      if (bet.side === 'back') {
        if (isThisSelection) {
          // BACK bet on winning selection → WIN
          netPnl += stake * (odds - 1)
        } else {
          // BACK bet on losing selection → LOSE stake
          netPnl -= stake
        }
      } else {
        // LAY bet
        if (isThisSelection) {
          // LAY bet on winning selection → LOSE liability
          netPnl -= stake * (odds - 1)
        } else {
          // LAY bet on losing selection → WIN stake
          netPnl += stake
        }
      }
    }

    pnlBySelection.push(netPnl)
  }

  // Market exposure = absolute value of worst case (most negative P&L)
  const worstCase = Math.min(...pnlBySelection)
  return worstCase < 0 ? Math.abs(worstCase) : 0
}

/**
 * Calculate exposure for a fancy market
 * 
 * For fancy bets, calculate P&L across a range of possible result positions.
 * 
 * For BACK bets:
 * - If result >= odds → WIN → Profit = stake × (oddsSize/100)
 * - If result < odds → LOSE → Loss = stake
 * 
 * For LAY bets:
 * - If result < odds → WIN → Profit = stake
 * - If result >= odds → LOSE → Loss = stake × (oddsSize/100)
 * 
 * Market exposure = absolute value of the worst-case (most negative) P&L
 */
function calculateFancyMarketExposure(bets: BetData[]): number {
  if (bets.length === 0) return 0

  // Find min and max odds from all bets to determine range
  const allOdds = bets.map(b => b.price).filter(o => o > 0)
  if (allOdds.length === 0) return 0

  const minOdd = Math.min(...allOdds)
  const maxOdd = Math.max(...allOdds)

  // Create range of positions (min - 5 to max + 5, but at least 1)
  const rangeStart = Math.max(1, Math.floor(minOdd) - 5)
  const rangeEnd = Math.floor(maxOdd) + 5

  // Calculate P&L for each position
  let worstPnl = 0

  for (let position = rangeStart; position <= rangeEnd; position++) {
    let netPnl = 0

    for (const bet of bets) {
      const oddsSize = bet.oddsSize ?? 100
      const oddsSizePercent = oddsSize / 100
      const stake = bet.stake

      if (bet.side === 'back') {
        // BACK bet
        if (position >= bet.price) {
          // Result >= Odds → WIN → Profit = stake × (oddsSize/100)
          netPnl += stake * oddsSizePercent
        } else {
          // Result < Odds → LOSE → Loss = stake
          netPnl -= stake
        }
      } else {
        // LAY bet
        if (position < bet.price) {
          // Result < Odds → WIN → Profit = stake
          netPnl += stake
        } else {
          // Result >= Odds → LOSE → Loss = stake × (oddsSize/100)
          netPnl -= stake * oddsSizePercent
        }
      }
    }

    if (netPnl < worstPnl) {
      worstPnl = netPnl
    }
  }

  // Market exposure = absolute value of worst case
  return worstPnl < 0 ? Math.abs(worstPnl) : 0
}

/**
 * Recalculate and update wallet exposure for a user (wallets.exposure = book-based exposure
 * of the open sports bets). Pass tx when inside a transaction (e.g. bet placement).
 *
 * Every player type, credit players (AGENT_CREDIT / WHITELABEL_CREDIT) included: their chips
 * sit in wallets.cash, so their sports liability is held in wallets.exposure against cash
 * exactly like a cash player's. users.credit_used is no longer maintained here, and nothing
 * on the agent, the whitelabel or agent_player_credits is touched.
 */
export async function recalculateAndUpdateExposure(
  userId: number,
  tenant: string,
  tx?: any
): Promise<number> {
  const dbCtx = tx ?? db

  // Player details for the high exposure alert below
  const [userRow] = await dbCtx
    .select({
      agentId: users.agentId,
      name: users.name,
      username: users.username,
      phone: users.phone,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)

  const newExposure = await calculateUserExposure(userId, tenant, dbCtx)

  // Get wallet to check balance for high exposure alerts
  const [walletRow] = await dbCtx
    .select({
      cash: wallets.cash,
      bonus: wallets.bonus,
      currency: wallets.currency,
      exposure: wallets.exposure,
    })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
    .limit(1)

  // Get old exposure before update
  const oldExposure = walletRow ? Number(walletRow.exposure ?? 0) : 0

  // Update wallet with new exposure
  await dbCtx
    .update(wallets)
    .set({ exposure: String(newExposure) })
    .where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))

  // Check for high exposure alert (every player type: credit players' chips are cash too)
  // Alert when exposure crosses 80% threshold (was below, now above)
  // Balance = cash only (bonus excluded)
  if (walletRow) {
    const balance = Number(walletRow.cash ?? 0)
    const currency = walletRow.currency || (await getWhitelabelCurrency(tenant))
    const currencySymbol = getCurrencySymbol(currency)
    const oldExposurePercent = balance > 0 ? (oldExposure / balance) * 100 : 0
    const newExposurePercent = balance > 0 ? (newExposure / balance) * 100 : 0
    // Only alert if exposure crosses 80% threshold (was below, now above) and balance > 0
    const wasBelowThreshold = oldExposurePercent < 80
    const isNowAboveThreshold = newExposurePercent >= 80
    if (wasBelowThreshold && isNowAboveThreshold && balance > 0 && newExposure > 0) {
      try {
        const { notifications } = await import('@shared/db/schema.js')
        const formattedExposure = newExposure.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const formattedBalance = balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const userName = userRow?.name || userRow?.username || `User ID ${userId}`
        const userPhone = userRow?.phone || 'N/A'
        await dbCtx.insert(notifications).values({
          tenant,
          whitelabelId: tenant,
          userId,
          agentId: userRow?.agentId ?? null,
          type: 'SYSTEM',
          category: 'general',
          title: 'High player exposure alert',
          message: `Player ${userName} (${userPhone}) exposure (${currencySymbol}${formattedExposure}) is ${newExposurePercent.toFixed(1)}% of balance (${currencySymbol}${formattedBalance}).`,
          actionUrl: `/players/profile/${userId}`,
          metadata: { userId, userName, userPhone, exposure: newExposure, balance, exposurePercent: Math.round(newExposurePercent * 10) / 10, currency },
        })
      } catch (err: any) {
      }
    }
  }

  return newExposure
}

/**
 * Get breakdown of exposure by market for a user
 * Useful for debugging and displaying per-market exposure
 */
export async function getExposureBreakdown(userId: number, tenant: string): Promise<{
  totalExposure: number
  markets: Array<{
    marketId: string
    marketType: string
    exposure: number
    betsCount: number
  }>
}> {
  // Get all open bets for the user
  const openBets = await db
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
    return { totalExposure: 0, markets: [] }
  }

  const bets: BetData[] = openBets.map(bet => ({
    id: bet.id,
    marketId: bet.marketId,
    selectionId: bet.selectionId,
    side: bet.side,
    price: Number(bet.price),
    stake: Number(bet.stake),
    oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
  }))

  const marketIds = [...new Set(bets.map(b => b.marketId))]

  const markets = await db
    .select({
      id: sportsMarketsTable.id,
      type: sportsMarketsTable.type,
      eventId: sportsMarketsTable.eventId,
    })
    .from(sportsMarketsTable)
    .where(inArray(sportsMarketsTable.id, marketIds))

  const marketMap = new Map<string, MarketInfo>()
  markets.forEach(m => marketMap.set(m.id, m))

  const nonFancyMarketIds = markets.filter(m => m.type !== 'fancy').map(m => m.id)
  let runnerMap = new Map<string, RunnerInfo[]>()
  
  if (nonFancyMarketIds.length > 0) {
    const runners = await db
      .select({
        id: sportsRunnersTable.id,
        marketId: sportsRunnersTable.marketId,
        selectionCode: sportsRunnersTable.selectionCode,
        name: sportsRunnersTable.name,
      })
      .from(sportsRunnersTable)
      .where(inArray(sportsRunnersTable.marketId, nonFancyMarketIds))

    runners.forEach(r => {
      const existing = runnerMap.get(r.marketId) || []
      existing.push({
        id: r.id,
        marketId: r.marketId,
        selectionCode: r.selectionCode ?? '',
        name: r.name ?? '',
      })
      runnerMap.set(r.marketId, existing)
    })
  }

  const betsByMarket = new Map<string, BetData[]>()
  bets.forEach(bet => {
    const existing = betsByMarket.get(bet.marketId) || []
    existing.push(bet)
    betsByMarket.set(bet.marketId, existing)
  })

  const marketBreakdown: Array<{
    marketId: string
    marketType: string
    exposure: number
    betsCount: number
  }> = []

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

    marketBreakdown.push({
      marketId,
      marketType,
      exposure: marketExposure,
      betsCount: marketBets.length,
    })

    totalExposure += marketExposure
  }

  return { totalExposure, markets: marketBreakdown }
}
