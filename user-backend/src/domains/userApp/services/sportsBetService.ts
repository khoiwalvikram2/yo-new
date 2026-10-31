import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { and, eq, inArray, or, gte, desc } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getAppConfig } from '../../../config/app.js'
import { upstreamRequest } from '../../../services/upstreamService.js'
import {
  sportsEventsTable,
  sportsLeaguesTable,
  sportsMarketsTable,
  sportsRunnersTable,
  sportsTable,
  sportsBets,
  users,
  sportsSettingsTable,
  leagueSettingsTable,
  eventSettingsTable,
  playerLimits,
  appConfigs,
  casinoBets,
} from '@shared/db/schema.js'
import type { ResolverContext } from '../../../types/context.js'
import { db } from '../../../db/client.js'
import { ensureWallet } from '../../../repos/userRepo.js'
import { addRecentSportsEvent, logLedgerEvent } from '../../../repos/userAppRepo.js'
import { processBetPostPlacement } from './betPostProcessingService.js'
import {
  recalculateAndUpdateExposure,
  calculateProjectedExposure,
  projectedCreditHeadroom,
  type AdditionalLegForExposure,
} from './exposureCalculationService.js'
import { getOpenCasinoStake } from '@shared/services/credit/casinoCredit.js'
import { assertPlayerAgentAllowsBetting } from './agentBettingGate.js'
import {
  assertCashWalletCoversProjectedBookExposureInTx,
  insertSportsBetsAndRecalcExposureLedgerInTx,
} from './sportsBetPlacementTx.js'
import { getWhitelabelCurrency, getCurrencySymbol, getWhitelabelTimezone } from '../../../shared/whitelabelConfig.js'
import { getStartOfDay, getStartOfWeek } from '../../../shared/dateUtils.js'

import { getClientIp, getClientUserAgent } from '../../../utils/getClientRequest.js'
import { assertPlayerCanStake } from '@shared/services/rgEnforcement.js'

function getIpFromRequest(request: any): string | undefined {
  return getClientIp(request)
}

function getUserAgentFromRequest(request: any): string | undefined {
  return getClientUserAgent(request)
}

type SportsBetLegInput = {
  eventId: string
  leagueId?: string | null
  sportId?: string | null
  marketId: string
  marketCode?: string | null
  selectionId: string
  selection?: string | null
  selectionType: string
  /** Legacy alias for selectionType (back/lay) */
  side?: string | null
  odds: number
  stake?: number | null
  marketType?: string | null
  oddsSize?: number | null
  isLive?: boolean | null
}

export type PlaceSportsBetInput = {
  type?: string | null
  currency?: string | null
  stake?: number | null
  oddsDriftTolerance?: number | null
  legs?: SportsBetLegInput[] | null
}

type Settings = {
  minStake?: number | null
  maxStake?: number | null
  minOdds?: number | null
  maxOdds?: number | null
  exposureCap?: number | null
  delay?: number | null // Bet delay in seconds (sleep before odds validation)
  cooldown?: number | null // Bet cooldown in seconds (block bet placement)
}

type EffectiveSettings = {
  exchange: Settings
  bookmaker: Settings
  fancy: Settings
}

type ValidatedLeg = {
  leg: SportsBetLegInput
  side: 'back' | 'lay'
  stake: number
  odds: number
  liability: number
  requiredHold: number
  marketType: 'exchange' | 'bookmaker' | 'fancy'
  marketId: string
  marketCode?: string | null
  eventId: string
  leagueId: string
  sportId: string
  runnerId: string
  whitelabelId: string
  currency: string
}

type MarketContext = {
  marketType: 'exchange' | 'bookmaker' | 'fancy'
  marketId: string // Actual UUID from database
  marketCode?: string | null // Market code from exchange (e.g., "1.251441372")
  eventId: string
  /** External event code for upstream fancy odds API (matches WS `fancy-{eventCode}`). */
  eventCode: string | null
  leagueId: string
  sportId: string
  runnerId: string
  whitelabelId: string
}

type BetPlacementResult = {
  bets: Array<{
    id: string
    slipId: string
    eventId: string
    leagueId: string
    sportId: string
    marketId: string
    selectionId: string
    selection?: string | null
    side: string
    marketType: string
    odds: number
    stake: number
    liability: number
    currency: string
    status: string
    createdAt: string
  }>
}

type MarketOdds = {
  backOdds?: number | null
  layOdds?: number | null
  updatedAt?: string | null
}

const appConfig = getAppConfig()

// Default limits when no config is set (safety fallbacks)
const DEFAULT_MIN_STAKE = 100
const DEFAULT_MAX_STAKE = 500000
const DEFAULT_MIN_ODDS = 1.01
const DEFAULT_MAX_ODDS = 1000

export async function placeSportsBetForUser(
  ctx: ResolverContext,
  params: { input?: PlaceSportsBetInput | null; legacy?: Partial<SportsBetLegInput> | null }
): Promise<BetPlacementResult> {
  if (!ctx.auth.userId) {
    throw new Error('Unauthorized')
  }

  // Use request tenant (current site) so bets are placed on the whitelabel the user is viewing
  const tenant = ctx.auth.requestTenant
  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, ctx.auth.userId), eq(users.tenant, tenant)))
    .then((rows) => rows[0])

  if (!user) throw new Error('User not found')
  if (user.status !== 'active') throw new Error('Account is not active')
  if (!user.sportsVisible || !user.sportsBetAllowed) throw new Error('Sports betting is disabled for this account')

  // Agent players: refused while their agent or any ancestor is not ACTIVE, or when the
  // agent's allowed domains do not include sports (owner decisions 1 and 4).
  await assertPlayerAgentAllowsBetting(db, { userId: user.id, tenant }, 'sports')
  await assertPlayerDomainBetting(db, tenant, user.id, 'sports')

  // A responsible-gambling block stops play. Separate from the checks above:
  // status and sportsBetAllowed are operator controls, this one is the
  // player's own protection and is enforced from its own column so neither
  // can quietly undo the other.
  await assertPlayerCanStake(tenant, user.id)

  // Check if user is a credit player and validate credit
  const playerType = user.playerType || 'REGULAR'
  const isCreditPlayer = playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
  
  // Early check for credit players: block if credit is already zero or negative
  if (isCreditPlayer) {
    const creditAvailable = Number(user.creditAvailable || 0)
    if (creditAvailable <= 0) {
      throw new Error('Credit limit reached. Please contact your agent to add more credit.')
    }
  }
  
  // Note: Full credit validation will happen after legs are validated and liability is calculated
  // We'll validate and lock credit inside the transaction after validatedLegs are ready

  const vipTierId = user.vipTierId || 'default'
  const whitelabelCurrency = await getWhitelabelCurrency(tenant)
  const wallet = await ensureWallet(ctx.auth.userId, tenant, whitelabelCurrency)
  const baseCurrency = wallet.currency || whitelabelCurrency
  const requestedCurrency = params.input?.currency?.trim().toUpperCase()
  if (requestedCurrency && requestedCurrency !== baseCurrency.toUpperCase()) {
    throw new Error(`Bet currency must match your wallet currency (${baseCurrency}).`)
  }
  const currencySymbol = getCurrencySymbol(baseCurrency)

  // Load player-specific limits (if configured)
  const playerLimit = await db
    .select()
    .from(playerLimits)
    .where(and(eq(playerLimits.userId, ctx.auth.userId), eq(playerLimits.tenant, tenant)))
    .then((rows) => rows[0] || null)

  const legs = normalizeLegs(params.input, params.legacy)
  if (!legs.length) throw new Error('At least one bet leg is required')
  
  // Prevent multiple bets in a single request
  if (legs.length > 1) {
    throw new Error('Only one bet can be placed at a time. Please place bets individually.')
  }

  const marketContexts = await loadMarketContexts(tenant, legs)
  const slipId = nanoid(12)
  const oddsTolerance = 0 // no tolerance; enforce exact-or-better prices
  /** Server env (URLs/paths). Named distinctly from `whitelabelAppRow` below to avoid shadowing module `appConfig`. */
  const runtimeCfg = getAppConfig()

  // Get whitelabel config once (all legs should be from same whitelabel)
  const firstContext = Array.from(marketContexts.values())[0]
  const whitelabelId = firstContext?.whitelabelId || tenant
  const whitelabelAppRow = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, whitelabelId),
  })
  const sportsConfig = whitelabelAppRow?.sportsGlobalConfig as any

  const validatedLegs: ValidatedLeg[] = []
  for (const leg of legs) {
    const marketIdentifier = leg.marketId || leg.marketCode || ''
    const context = marketContexts.get(marketIdentifier)
    if (!context) throw new Error('Market not found or inactive')

    const { effectiveSettings, rawSettings } = await loadEffectiveSettingsWithRaw({
      whitelabelId: context.whitelabelId,
      sportId: context.sportId,
      leagueId: context.leagueId,
      eventId: context.eventId,
      tierId: vipTierId,
    })

    const marketType = normalizeMarketType(leg.marketType)
    if (marketType !== context.marketType) throw new Error('Market type does not match the selected market.')
    
    // Check if this market type is enabled in global config
    if (marketType === 'fancy' && sportsConfig?.showFancy === false) {
      throw new Error('Fancy markets are disabled for this whitelabel')
    }
    if (marketType === 'bookmaker' && sportsConfig?.showBookmaker === false) {
      throw new Error('Bookmaker markets are disabled for this whitelabel')
    }
    if (marketType === 'exchange' && sportsConfig?.showExchange === false) {
      throw new Error('Exchange markets are disabled for this whitelabel')
    }
    const side = leg.selectionType?.toLowerCase() === 'lay' ? 'lay' : 'back'
    const stake = Number(leg.stake ?? params.input?.stake ?? 0)
    const odds = Number(leg.odds)
    if (!Number.isFinite(stake) || stake <= 0) {
      throw new Error('Stake must be greater than zero')
    }
    // For fancy bets, odds can be any positive number (they represent target values, not traditional odds)
    // For exchange/bookmaker, odds must be > 1.0
    if (!Number.isFinite(odds) || odds <= 0) {
      throw new Error('Odds must be a positive number')
    }
    if (marketType !== 'fancy' && odds <= 1) {
      throw new Error('Odds must be greater than 1.0')
    }

    const limits = pickSettings(effectiveSettings, marketType)
    
    // Use hardcoded defaults if limits are not configured at any level (including global config)
    const minStake = limits.minStake ?? DEFAULT_MIN_STAKE
    const maxStake = limits.maxStake ?? DEFAULT_MAX_STAKE
    
    // Block bet placement only if we can't determine limits (shouldn't happen with defaults)
    if (minStake == null || maxStake == null) {
      throw new Error(`Betting is not configured for this market type (${marketType}). Please contact support.`)
    }
    
    // Determine which level has cooldown/delay configured (hierarchical: event > league > sport > global)
    const delayKey = marketType === 'exchange' ? 'exchangeDelay' : marketType === 'bookmaker' ? 'bookmakerDelay' : 'fancyDelay'
    const cooldownKey = marketType === 'exchange' ? 'exchangeCooldown' : marketType === 'bookmaker' ? 'bookmakerCooldown' : 'fancyCooldown'
    
    // Check for delay at each level (including global config)
    // Note: 0 is a valid configured value (no delay), so we check != null to include 0
    const delayLevel = rawSettings.event?.[delayKey] != null ? 'event' 
      : rawSettings.league?.[delayKey] != null ? 'league' 
      : rawSettings.sport?.[delayKey] != null ? 'sport'
      : (rawSettings.global?.defaultBetDelays?.[marketType] != null) ? 'global'
      : null
    
    // Check for cooldown at each level (including global config)
    // Note: 0 is a valid configured value (no cooldown), so we check != null to include 0
    const cooldownLevel = rawSettings.event?.[cooldownKey] != null ? 'event'
      : rawSettings.league?.[cooldownKey] != null ? 'league'
      : rawSettings.sport?.[cooldownKey] != null ? 'sport'
      : (rawSettings.global?.defaultBetCooldowns?.[marketType] != null) ? 'global'
      : null
    
    // Debug: Log delay and cooldown configuration
    if (limits.delay != null && limits.delay > 0) {
    }
    if (limits.cooldown != null && limits.cooldown > 0) {
    }
    
    // Cooldown check: Block bet placement if user placed a bet within cooldown period
    // Check at the appropriate level (event > league > sport > global). Only run when a level is configured.
    if (limits.cooldown != null && limits.cooldown > 0 && cooldownLevel) {
      const cooldownSeconds = limits.cooldown
      const conditions = [
        eq(sportsBets.userId, ctx.auth.userId),
        eq(sportsBets.tenant, tenant),
      ]
      
      // Add level-specific condition
      if (cooldownLevel === 'event') {
        conditions.push(eq(sportsBets.eventId, context.eventId))
      } else if (cooldownLevel === 'league') {
        conditions.push(eq(sportsBets.leagueId, context.leagueId))
      } else if (cooldownLevel === 'sport') {
        conditions.push(eq(sportsBets.sportId, context.sportId))
      }
      // For 'global' level, check all bets (no additional condition needed)
      
      const lastBet = await db
        .select({ 
          createdAt: sportsBets.createdAt,
        })
        .from(sportsBets)
        .where(and(...conditions))
        .orderBy(desc(sportsBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])
      
      if (lastBet?.createdAt) {
        const timeSinceLastBet = (Date.now() - new Date(lastBet.createdAt).getTime()) / 1000 // seconds
        if (timeSinceLastBet < cooldownSeconds) {
          const remainingSeconds = Math.ceil(cooldownSeconds - timeSinceLastBet)
          const levelName = cooldownLevel === 'event' ? 'this event' 
            : cooldownLevel === 'league' ? 'this league' 
            : cooldownLevel === 'sport' ? 'this sport'
            : 'any market'
          throw new Error(`Please wait ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''} before placing another bet in ${levelName}`)
        }
      }
    }
    
    // Validate stake limits (using resolved values with fallbacks)
    if (stake < minStake) {
      throw new Error(`Minimum stake is ${minStake}`)
    }
    if (stake > maxStake) {
      throw new Error(`Maximum stake is ${maxStake}`)
    }
    
    // Validate odds limits (use defaults if not configured)
    const minOdds = limits.minOdds ?? DEFAULT_MIN_ODDS
    const maxOdds = limits.maxOdds ?? DEFAULT_MAX_ODDS
    
    if (odds < minOdds) {
      throw new Error(`Odds must be at least ${minOdds}`)
    }
    if (odds > maxOdds) {
      throw new Error(`Odds cannot exceed ${maxOdds}`)
    }

    // Calculate liability based on market type
    // For fancy bets: use oddsSize for lay bets
    // For exchange/bookmaker: use standard formula
    let liability: number
    if (marketType === 'fancy' && leg.oddsSize != null) {
      const oddsSizePercent = leg.oddsSize / 100
      if (side === 'lay') {
        // LAY fancy: Liability = Stake × (OddsSize/100)
        liability = stake * oddsSizePercent
      } else {
        // BACK fancy: Liability = Stake
        liability = stake
      }
    } else {
      // Exchange/Bookmaker: Standard liability calculation
      liability = side === 'lay' ? Math.max((odds - 1) * stake, 0) : stake
    }
    // Always use liability (exposure) for credit validation - this ensures we reserve the maximum potential payout
    const requiredHold = liability

    // Delay: Sleep/wait before odds validation (frontend will show loading during this time)
    // This gives time for odds to stabilize and prevents rapid-fire betting
    if (limits.delay != null && limits.delay > 0) {
      const delaySeconds = limits.delay
      // Sleep for the delay period - frontend should show loading during this time
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))
    }

    // Odds validation with delay-based odds locking
    // If delay is configured and there's a recent bet within delay period,
    // use the odds from that bet (lock the odds) instead of fetching fresh market odds
    let oddsData: MarketOdds | null = null
    let useLockedOdds = false
    let lockedOdds: MarketOdds | null = null

    if (limits.delay != null && limits.delay > 0 && marketType === 'exchange' && delayLevel) {
      const delaySeconds = limits.delay
      // Check last bet placed by this user at the appropriate level (event > league > sport > global)
      // This locks the odds for the same bet type (back/lay) during the delay period
      const conditions = [
        eq(sportsBets.userId, ctx.auth.userId),
        eq(sportsBets.tenant, tenant),
        eq(sportsBets.side, side), // Only lock odds for the same side
      ]
      
      // Add level-specific condition; global = no extra filter (check all bets)
      if (delayLevel === 'event') {
        conditions.push(eq(sportsBets.eventId, context.eventId))
      } else if (delayLevel === 'league') {
        conditions.push(eq(sportsBets.leagueId, context.leagueId))
      } else if (delayLevel === 'sport') {
        conditions.push(eq(sportsBets.sportId, context.sportId))
      }
      // global: no additional condition
      
      const lastBet = await db
        .select({ 
          createdAt: sportsBets.createdAt,
          price: sportsBets.price,
          side: sportsBets.side,
        })
        .from(sportsBets)
        .where(and(...conditions))
        .orderBy(desc(sportsBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])
      
      if (lastBet?.createdAt && lastBet.price) {
        const timeSinceLastBet = (Date.now() - new Date(lastBet.createdAt).getTime()) / 1000 // seconds
        if (timeSinceLastBet < delaySeconds) {
          // Use locked odds from the last bet of the same side at the configured level
          useLockedOdds = true
          const lastBetOdds = Number(lastBet.price)
          if (side === 'back') {
            lockedOdds = { backOdds: lastBetOdds, layOdds: null }
          } else {
            lockedOdds = { backOdds: null, layOdds: lastBetOdds }
          }
        }
      }
    }

    // Accepted prices must belong to this market and runner. An unavailable
    // provider must not turn a client supplied price into an executable quote.
    if (marketType === 'exchange' || marketType === 'bookmaker') {
      const marketCode = context.marketCode || leg.marketCode || undefined
      const live = marketCode ? await fetchMarketOdds(ctx, { marketId: context.marketId, marketCode, selectionId: leg.selectionId }) : null
      if (!live) throw new Error('Market odds are not available. Please try again later.')
      const liveSidePrice = side === 'back' ? live.backOdds : live.layOdds
      if (liveSidePrice == null || liveSidePrice <= 1) throw new Error('Selection price is not available. Please try again later.')
      oddsData = useLockedOdds ? lockedOdds : live
      const available = side === 'back' ? oddsData?.backOdds : oddsData?.layOdds
      if (available == null || (side === 'back' ? odds > available + oddsTolerance : odds < available - oddsTolerance)) {
        throw new Error('Odds changed. Please refresh the market and try again.')
      }
    }

    // Fancy market: validate odds against live upstream snapshot (same base URL as exchange)
    if (marketType === 'fancy') {
      if (!context.eventCode || !runtimeCfg.sportsApiFancyOddsPath) throw new Error('Live fancy market validation is not configured.')
      const fancyLive = await fetchFancyOdds(ctx, {
        eventCode: context.eventCode,
        selectionId: String(leg.selectionId ?? ''),
        selectionName: leg.selection ?? null,
      })
      if (fancyLive) {
        if (isUnavailableOddsStatus(fancyLive.status)) {
          throw new Error('Market is suspended. Please try again later.')
        }
        const currentOdds = side === 'back' ? fancyLive.backOdds : fancyLive.layOdds
        if (currentOdds == null || currentOdds <= 0) throw new Error('Selection price is not available. Please try again later.')
        if (Math.abs(odds - currentOdds) > oddsTolerance) {
          throw new Error(`Odds changed. Current ${side} odds: ${currentOdds}`)
        }
        const currentSize = side === 'back' ? fancyLive.backSize : fancyLive.laySize
        if (
          currentSize == null || currentSize <= 0 || leg.oddsSize == null ||
          Math.abs(Number(leg.oddsSize) - currentSize) > 0.000001
        ) {
          throw new Error(`Odds size changed. Current size: ${currentSize}`)
        }
      } else {
        throw new Error('Market is not available. Please try again later.')
      }
    }

    validatedLegs.push({
      leg,
      side,
      stake,
      odds,
      liability,
      requiredHold,
      marketType,
      marketId: context.marketId, // Use actual UUID from context
      marketCode: leg.marketCode || null,
      eventId: context.eventId,
      leagueId: context.leagueId,
      sportId: context.sportId,
      runnerId: context.runnerId,
      whitelabelId: context.whitelabelId,
      currency: baseCurrency,
    })

    if (limits.exposureCap != null) {
      const projectedExposure = Number(wallet.exposure ?? 0) + liability
      if (projectedExposure > limits.exposureCap) {
        throw new Error('Exposure exceeds configured cap')
      }
    }
  }

  const totalHold = validatedLegs.reduce((sum, leg) => sum + leg.requiredHold, 0)
  const totalExposure = validatedLegs.reduce((sum, leg) => sum + leg.liability, 0)
  const totalStake = validatedLegs.reduce((sum, leg) => sum + leg.stake, 0)

  // Credit players: validate projected book-based exposure (same model as tx and as regulars)
  if (isCreditPlayer) {
    const additionalLegs: AdditionalLegForExposure[] = validatedLegs.map((leg) => ({
      marketId: leg.marketId,
      selectionId: leg.leg.selectionId,
      side: leg.side,
      price: leg.odds,
      stake: leg.stake,
      oddsSize: leg.leg.oddsSize ?? null,
    }))
    const projectedExposure = await calculateProjectedExposure(ctx.auth.userId!, tenant, additionalLegs)
    // Open casino bets hold credit too (credit_used += stake until they settle).
    const openCasinoStake = await getOpenCasinoStake(db, ctx.auth.userId!, tenant, true)
    const limit = Number(user.creditLimit ?? 0)
    const settlement = Number(user.settlementBalance ?? 0)
    const projectedAvailable = projectedCreditHeadroom({
      creditLimit: limit,
      settlementBalance: settlement,
      projectedSportsExposure: projectedExposure,
      openCasinoStake,
    })
    if (projectedAvailable < 0) {
      const available = Math.max(0, limit - Number(user.creditUsed ?? 0) + settlement)
      const projectedTotal = projectedExposure + openCasinoStake
      throw new Error(
        `Insufficient credit. Projected exposure would be ${currencySymbol}${projectedTotal.toFixed(2)} ` +
          `(limit − exposure + settlement < 0). Current available: ${currencySymbol}${available.toFixed(2)}. Please contact your agent.`
      )
    }
  }

  // Regular players: validate that cash can cover projected book-based exposure (same model as credit players)
  // Book-based exposure can be lower than sum of liabilities when hedging (e.g. back + lay on same market)
  let projectedBookExposureForRegular: number | null = null
  if (!isCreditPlayer) {
    const additionalLegs: AdditionalLegForExposure[] = validatedLegs.map((leg) => ({
      marketId: leg.marketId,
      selectionId: leg.leg.selectionId,
      side: leg.side,
      price: leg.odds,
      stake: leg.stake,
      oddsSize: leg.leg.oddsSize ?? null,
    }))
    projectedBookExposureForRegular = await calculateProjectedExposure(ctx.auth.userId!, tenant, additionalLegs)
    const currentCash = Number(wallet.cash ?? 0)
    if (currentCash < projectedBookExposureForRegular) {
      const currentExposure = Number(wallet.exposure ?? 0)
      const availableBalance = Math.max(0, currentCash - currentExposure)
      throw new Error(
        `Insufficient available balance. Available: ${currencySymbol}${availableBalance.toFixed(2)} (Cash: ${currencySymbol}${currentCash.toFixed(2)}, Exposure: ${currencySymbol}${currentExposure.toFixed(2)}), Required (book-based): ${currencySymbol}${projectedBookExposureForRegular.toFixed(2)}`
      )
    }
  }

  // Player-specific limit checks
  if (playerLimit) {
    // Check per-bet limit for sports
    if (playerLimit.maxBetSports != null) {
      const maxBetSports = Number(playerLimit.maxBetSports)
      for (const leg of validatedLegs) {
        if (leg.stake > maxBetSports) {
          throw new Error(`Single bet stake exceeds your configured limit of ${maxBetSports}`)
        }
      }
    }

    // Check if player has a custom exposure cap override (use book-based for regular players)
    if (playerLimit.exposureCapOverride != null) {
      const exposureOverride = Number(playerLimit.exposureCapOverride)
      const projectedExposure =
        !isCreditPlayer && projectedBookExposureForRegular != null
          ? projectedBookExposureForRegular
          : Number(wallet.exposure ?? 0) + totalExposure
      if (projectedExposure > exposureOverride) {
        throw new Error(`Total exposure exceeds your configured limit of ${exposureOverride}`)
      }
    }

    // Check daily stake limit (sports + casino combined)
    if (playerLimit.dailyStakeLimit != null) {
      const dailyStakeLimit = Number(playerLimit.dailyStakeLimit)
      const tz = await getWhitelabelTimezone(tenant)
      const todayStart = getStartOfDay(tz)
      
      const [sportsToday] = await db
        .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, ctx.auth.userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, todayStart)))

      const [casinoToday] = await db
        .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, ctx.auth.userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, todayStart)))

      const todayTotalStake = Number(sportsToday?.total ?? 0) + Number(casinoToday?.total ?? 0)
      if (todayTotalStake + totalStake > dailyStakeLimit) {
        throw new Error(`Daily stake limit of ${dailyStakeLimit} would be exceeded`)
      }
    }

    // Check weekly stake limit (sports + casino combined)
    if (playerLimit.weeklyStakeLimit != null) {
      const weeklyStakeLimit = Number(playerLimit.weeklyStakeLimit)
      const tz = await getWhitelabelTimezone(tenant)
      const weekStart = getStartOfWeek(tz)
      
      const [sportsWeek] = await db
        .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, ctx.auth.userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, weekStart)))

      const [casinoWeek] = await db
        .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, ctx.auth.userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, weekStart)))

      const weekTotalStake = Number(sportsWeek?.total ?? 0) + Number(casinoWeek?.total ?? 0)
      if (weekTotalStake + totalStake > weeklyStakeLimit) {
        throw new Error(`Weekly stake limit of ${weeklyStakeLimit} would be exceeded`)
      }
    }

    // Check bet cooldown (sports + casino, if configured)
    if (playerLimit.cooldownSeconds != null && playerLimit.cooldownSeconds > 0) {
      const cooldownMs = playerLimit.cooldownSeconds * 1000

      const lastSportsBet = await db
        .select({ createdAt: sportsBets.createdAt })
        .from(sportsBets)
        .where(and(eq(sportsBets.userId, ctx.auth.userId), eq(sportsBets.tenant, tenant)))
        .orderBy(desc(sportsBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])

      const lastCasinoBet = await db
        .select({ createdAt: casinoBets.createdAt })
        .from(casinoBets)
        .where(and(eq(casinoBets.userId, ctx.auth.userId), eq(casinoBets.tenant, tenant)))
        .orderBy(desc(casinoBets.createdAt))
        .limit(1)
        .then((rows) => rows[0])

      const lastSportsTime = lastSportsBet?.createdAt ? new Date(lastSportsBet.createdAt).getTime() : 0
      const lastCasinoTime = lastCasinoBet?.createdAt ? new Date(lastCasinoBet.createdAt).getTime() : 0
      const lastBetTime = Math.max(lastSportsTime, lastCasinoTime)

      if (lastBetTime > 0) {
        const timeSinceLastBet = Date.now() - lastBetTime
        if (timeSinceLastBet < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastBet) / 1000)
          throw new Error(`Please wait ${remainingSeconds} seconds before placing another bet`)
        }
      }
    }
  }

  const bets = await db.transaction(async (tx) => {
    // Credit players: lock user to serialize placements; credit_used set by recalc after insert (book-based)
    if (isCreditPlayer) {
      await tx.execute<Record<string, unknown>>(sql`
        SELECT id FROM users
        WHERE id = ${ctx.auth.userId} AND tenant = ${tenant}
        FOR UPDATE
        LIMIT 1
      `)
      const additionalLegs: AdditionalLegForExposure[] = validatedLegs.map((leg) => ({
        marketId: leg.marketId,
        selectionId: leg.leg.selectionId,
        side: leg.side,
        price: leg.odds,
        stake: leg.stake,
        oddsSize: leg.leg.oddsSize ?? null,
      }))
      const projectedExposure = await calculateProjectedExposure(ctx.auth.userId!, tenant, additionalLegs)
      const [u] = await tx
        .select({
          creditLimit: users.creditLimit,
          settlementBalance: users.settlementBalance,
        })
        .from(users)
        .where(and(eq(users.id, ctx.auth.userId!), eq(users.tenant, tenant)))
        .limit(1)
      if (!u) throw new Error('User not found')
      // Read under the users lock held above: casino credit locks take the same lock,
      // so this sum cannot change before the bet is inserted.
      const openCasinoStake = await getOpenCasinoStake(tx, ctx.auth.userId!, tenant, true)
      const limit = Number(u.creditLimit ?? 0)
      const settlement = Number(u.settlementBalance ?? 0)
      const projectedAvailable = projectedCreditHeadroom({
        creditLimit: limit,
        settlementBalance: settlement,
        projectedSportsExposure: projectedExposure,
        openCasinoStake,
      })
      if (projectedAvailable < 0) {
        const sym = getCurrencySymbol(await getWhitelabelCurrency(tenant))
        const projectedTotal = projectedExposure + openCasinoStake
        throw new Error(
          `Insufficient credit. Projected exposure would be ${sym}${projectedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Please contact your agent.`
        )
      }
    }

    if (!isCreditPlayer) {
      await assertCashWalletCoversProjectedBookExposureInTx(tx, {
        walletId: wallet.id,
        tenant,
        userId: ctx.auth.userId!,
        validatedLegs,
      })
    }

    const ipAddress = getIpFromRequest(ctx.request)
    const userAgent = getUserAgentFromRequest(ctx.request)

    let deviceInfo: string | undefined
    if (userAgent) {
      const ua = userAgent.toLowerCase()
      if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
        deviceInfo = 'Mobile'
      } else if (ua.includes('tablet') || ua.includes('ipad')) {
        deviceInfo = 'Tablet'
      } else {
        deviceInfo = 'Desktop'
      }
    }

    return insertSportsBetsAndRecalcExposureLedgerInTx(tx, {
      userId: ctx.auth.userId!,
      tenant,
      wallet,
      slipId,
      validatedLegs,
      excludeFromAdminRunning: false,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      deviceInfo: deviceInfo || null,
    })
  })

  // Recalculate exposure based on actual market book positions (not just sum of liabilities)
  // This ensures exposure reflects the true worst-case loss across all markets
  try {
    await recalculateAndUpdateExposure(ctx.auth.userId!, tenant)
  } catch (err) {
    // Log error but don't fail bet placement if exposure recalculation fails
  }

  // fire and forget – do not block placement
  void Promise.all(
    validatedLegs.map((leg) =>
      addRecentSportsEvent(ctx.auth.userId!, tenant, leg.eventId, {
        eventName: leg.leg.selection || 'Event',
        league: '',
        sport: '',
        startISO: new Date().toISOString(),
        isLive: Boolean(leg.leg.isLive),
        runners: [],
      }).catch(() => {})
    )
  )

  // Post-process bets: risk calculation, pattern detection, automation (fire-and-forget)
  void Promise.all(
    bets.map((bet) => {
      const leg = validatedLegs.find((l) => l.eventId === bet.eventId && l.marketId === bet.marketId)
      if (!leg) return Promise.resolve()

      // Parse createdAt - it might be a string or Date
      let createdAt: Date
      if (typeof bet.createdAt === 'string') {
        createdAt = new Date(bet.createdAt)
      } else if ((bet as any).createdAt instanceof Date) {
        createdAt = (bet as any).createdAt as Date
      } else {
        createdAt = new Date()
      }

      return processBetPostPlacement({
        betId: bet.id,
        userId: ctx.auth.userId!,
        eventId: bet.eventId,
        tenant,
        whitelabelId: leg.whitelabelId,
        stake: Number(bet.stake) || 0,
        liability: Number(bet.liability) || 0,
        odds: Number(bet.odds) || 0,
        side: bet.side as 'back' | 'lay',
        marketId: bet.marketId,
        createdAt,
        marketType: leg.marketType,
      }).catch((err: any) => {
        // Log error but don't throw - bet placement should succeed even if processing fails
      })
    })
  )

  return { bets }
}

function normalizeLegs(input?: PlaceSportsBetInput | null, legacy?: Partial<SportsBetLegInput> | null): SportsBetLegInput[] {
  const legs = input?.legs?.filter(Boolean) ?? []
  if (legs.length > 0) {
    return legs.map((leg) => ({
      ...leg,
      odds: Number(leg.odds),
      stake: leg.stake ?? input?.stake ?? null,
    }))
  }

  if (legacy?.eventId) {
    const side = (legacy.selectionType ?? legacy.side ?? 'back').toString().toLowerCase()
    const selectionType = side === 'lay' ? 'lay' : 'back'
    return [
      {
        eventId: legacy.eventId,
        leagueId: legacy.leagueId ?? null,
        sportId: legacy.sportId ?? null,
        marketId: legacy.marketId ?? '',
        marketCode: legacy.marketCode ?? null,
        selectionId: legacy.selectionId ?? '',
        selection: legacy.selection ?? null,
        selectionType,
        odds: Number(legacy.odds ?? 0),
        stake: legacy.stake ?? input?.stake ?? null,
        marketType: legacy.marketType ?? null,
        oddsSize: legacy.oddsSize ?? null,
        isLive: legacy.isLive ?? null,
      },
    ]
  }

  return []
}

function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

async function loadMarketContexts(tenant: string, legs: SportsBetLegInput[]): Promise<Map<string, MarketContext>> {
  const eventIds = Array.from(new Set(legs.map((l) => l.eventId))).filter(Boolean)
  const marketIdentifiers = Array.from(new Set(legs.map((l) => l.marketId || l.marketCode || ''))).filter(Boolean)

  if (!eventIds.length || !marketIdentifiers.length) {
    throw new Error('Event and market are required')
  }

  const events = await db
    .select({
      id: sportsEventsTable.id,
      leagueId: sportsEventsTable.leagueId,
      status: sportsEventsTable.status,
      eventCode: sportsEventsTable.eventCode,
    })
    .from(sportsEventsTable)
    .where(inArray(sportsEventsTable.id, eventIds))

  if (!events.length) {
    throw new Error('Event not found')
  }

  const leagues = await db
    .select({
      id: sportsLeaguesTable.id,
      sportId: sportsLeaguesTable.sportId,
      status: sportsLeaguesTable.status,
    })
    .from(sportsLeaguesTable)
    .where(inArray(sportsLeaguesTable.id, events.map((e) => e.leagueId)))

  const sports = await db
    .select({
      id: sportsTable.id,
      status: sportsTable.status,
    })
    .from(sportsTable)
    .where(inArray(sportsTable.id, leagues.map((l) => l.sportId)))

  // Separate UUIDs from market codes
  const marketIds: string[] = []
  const marketCodes: string[] = []
  for (const identifier of marketIdentifiers) {
    if (isUUID(identifier)) {
      marketIds.push(identifier)
    } else {
      marketCodes.push(identifier)
    }
  }

  // Helper to generate sanitized fancy market code (must match creation format)
  const generateFancyMarketCode = (rawCode: string, eventId: string): string => {
    const sanitized = rawCode
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-')
      .toLowerCase()
      .substring(0, 50)
    if (!sanitized) return ''
    const eventPrefix = eventId.substring(0, 8)
    return `f-${eventPrefix}-${sanitized}`.substring(0, 64)
  }

  // For fancy markets, also generate sanitized codes to find existing markets
  // We need to generate sanitized codes for each event because the code includes event prefix
  const sanitizedFancyCodes: string[] = []
  for (const leg of legs) {
    if (leg.marketType === 'fancy' && leg.eventId) {
      const rawSource = leg.selectionId 
        ? String(leg.selectionId).trim()
        : String(leg.marketCode || '').trim()
      if (rawSource) {
        const sanitizedCode = generateFancyMarketCode(rawSource, leg.eventId)
        if (sanitizedCode && !sanitizedFancyCodes.includes(sanitizedCode)) {
          sanitizedFancyCodes.push(sanitizedCode)
        }
      }
    }
  }

  // Query markets by ID or marketCode (include both raw and sanitized codes)
  const marketConditions = []
  if (marketIds.length > 0) {
    marketConditions.push(inArray(sportsMarketsTable.id, marketIds))
  }
  const allMarketCodes = [...marketCodes, ...sanitizedFancyCodes].filter(Boolean)
  if (allMarketCodes.length > 0) {
    marketConditions.push(inArray(sportsMarketsTable.marketCode, allMarketCodes))
  }

  // For fancy markets, if no specific conditions, load all markets for the events
  if (marketConditions.length === 0 && legs.some(l => l.marketType === 'fancy')) {
    marketConditions.push(inArray(sportsMarketsTable.eventId, eventIds))
  }

  if (marketConditions.length === 0) {
    throw new Error('No valid market identifiers provided')
  }

  const markets = await db
    .select({
      id: sportsMarketsTable.id,
      marketCode: sportsMarketsTable.marketCode,
      eventId: sportsMarketsTable.eventId,
      status: sportsMarketsTable.status,
      type: sportsMarketsTable.type,
    })
    .from(sportsMarketsTable)
    .where(or(...marketConditions))

  const contexts = new Map<string, MarketContext>()
  for (const leg of legs) {
    const event = events.find((e) => e.id === leg.eventId)
    if (!event || event.status !== 'active') throw new Error('Event is not active')

    const league = leagues.find((l) => l.id === event.leagueId)
    if (!league || league.status !== 'active') throw new Error('League is not active')

    const sport = sports.find((s) => s.id === league.sportId)
    if (!sport || sport.status !== 'active') throw new Error('Sport is not active')

    // Find market by ID or marketCode
    const marketIdentifier = leg.marketId || leg.marketCode || ''
    
    // Helper to sanitize market codes for fancy markets
    const sanitizeFancyCode = (raw: string, eventId: string): string => {
      const sanitized = raw
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-')
        .toLowerCase()
        .substring(0, 50)
      if (!sanitized) return ''
      // Include event prefix for global uniqueness (matches creation format)
      const eventPrefix = eventId.substring(0, 8)
      return `f-${eventPrefix}-${sanitized}`.substring(0, 64)
    }
    
    // For fancy markets, sanitize marketCode for lookup (in case it has special chars)
    let sanitizedIdentifier = marketIdentifier
    if (leg.marketType === 'fancy') {
      // Use selectionId or marketCode as source, but always sanitize for lookup
      const rawSource = leg.selectionId 
        ? String(leg.selectionId).trim()
        : String(leg.marketCode || '').trim()
      sanitizedIdentifier = sanitizeFancyCode(rawSource, event.id) || marketIdentifier
    }
    
    let market = markets.find(
      (m) =>
        (m.id === marketIdentifier || m.marketCode === marketIdentifier || 
         (leg.marketType === 'fancy' && (m.id === sanitizedIdentifier || m.marketCode === sanitizedIdentifier))) &&
        m.eventId === event.id
    )

    // For fancy markets, if market doesn't exist, create it on-the-fly
    if (!market && leg.marketType === 'fancy' && leg.marketCode) {
        // Sanitize any string into a valid market code (no spaces, lowercase, alphanumeric + hyphens only)
        const sanitizeMarketCode = (raw: string): string => {
          return raw
            .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
            .replace(/\s+/g, '-') // Replace ALL spaces with hyphens
            .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
            .replace(/-+/g, '-') // Collapse multiple hyphens
            .toLowerCase()
            .substring(0, 50) // Limit to 50 chars to leave room for event prefix
        }

        // Determine raw source: prefer selectionId, fallback to marketCode
        const rawSource = leg.selectionId 
          ? String(leg.selectionId).trim()
          : String(leg.marketCode || '').trim()
        
        // ALWAYS sanitize - even if it looks like a number, sanitize to be safe
        let sanitizedName = sanitizeMarketCode(rawSource)
        
        // If sanitization resulted in empty string, create a fallback
        if (!sanitizedName) {
          const fallbackName = String(leg.selection || leg.marketCode || 'fancy')
          sanitizedName = fallbackName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 30)
        }
        
        // Include short event ID prefix to ensure GLOBAL uniqueness (marketCode has unique constraint across all events)
        // Use first 8 chars of eventId (UUID) for uniqueness while keeping code readable
        const eventPrefix = event.id.substring(0, 8)
        const sanitizedMarketCode = `f-${eventPrefix}-${sanitizedName}`.substring(0, 64)
        

      try {
        const [created] = await db
          .insert(sportsMarketsTable)
          .values({
            eventId: event.id,
            marketCode: sanitizedMarketCode,
            name: leg.selection || `Fancy Market ${leg.marketCode}`,
            type: 'fancy',
            status: 'active',
          })
          .returning({
            id: sportsMarketsTable.id,
            marketCode: sportsMarketsTable.marketCode,
            eventId: sportsMarketsTable.eventId,
            status: sportsMarketsTable.status,
      type: sportsMarketsTable.type,
          })
        market = created
      } catch (err: any) {
        // If market already exists (race condition), fetch it
        if (err?.code === '23505' || err?.message?.includes('unique')) {
          const existing = await db
            .select({
              id: sportsMarketsTable.id,
              marketCode: sportsMarketsTable.marketCode,
              eventId: sportsMarketsTable.eventId,
              status: sportsMarketsTable.status,
      type: sportsMarketsTable.type,
            })
            .from(sportsMarketsTable)
            .where(
              and(
                eq(sportsMarketsTable.marketCode, sanitizedMarketCode),
                eq(sportsMarketsTable.eventId, event.id)
              )
            )
            .limit(1)
            .then((rows) => rows[0])
          if (existing) {
            market = existing
          }
        }
        if (!market) {
          throw new Error(`Failed to create or find fancy market: ${err?.message || 'Unknown error'}`)
        }
      }
    }

    if (!market || market.status !== 'active') {
      throw new Error('Market is not active for this event')
    }

    const selectionIdStr = String(leg.selectionId)
    const runnerIdFilter = isUUID(selectionIdStr) ? [eq(sportsRunnersTable.id, selectionIdStr)] : []

    let runner = await db
      .select({
        id: sportsRunnersTable.id,
      })
      .from(sportsRunnersTable)
      .where(
        and(
          eq(sportsRunnersTable.marketId, market.id),
          or(
            eq(sportsRunnersTable.selectionCode, selectionIdStr),
            ...runnerIdFilter
          )
        )
      )
      .then((rows) => rows[0])

    // If runner is missing (common when UI sends external selection ids), create a stub runner to allow bet placement.
    if (!runner) {
      const [created] = await db
        .insert(sportsRunnersTable)
        .values({
          marketId: market.id,
          selectionCode: String(leg.selectionId),
          name: leg.selection || `Selection ${leg.selectionId}`,
          sort: 999,
          status: 'active',
        })
        .returning({ id: sportsRunnersTable.id })
      runner = created
    }

    contexts.set(marketIdentifier, {
      marketType: normalizeMarketType(market.type),
      marketId: market.id, // Store actual UUID
      marketCode: market.marketCode, // Store market code for API calls
      eventId: event.id,
      eventCode: event.eventCode ?? null,
      leagueId: league.id,
      sportId: league.sportId,
      runnerId: runner.id,
      whitelabelId: tenant, // Use tenant as whitelabelId for global sports tables
    })
  }

  return contexts
}

async function loadEffectiveSettings(input: {
  whitelabelId: string
  sportId: string
  leagueId: string
  eventId: string
  tierId: string
}): Promise<EffectiveSettings> {
  const { effectiveSettings } = await loadEffectiveSettingsWithRaw(input)
  return effectiveSettings
}

export async function loadEffectiveSettingsWithRaw(input: {
  whitelabelId: string
  sportId: string
  leagueId: string
  eventId: string
  tierId: string
}): Promise<{ effectiveSettings: EffectiveSettings; rawSettings: { event?: any; league?: any; sport?: any; global?: any } }> {
  // Get global sports config as defaults
  const appConfig = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, input.whitelabelId),
  })
  const globalConfig = appConfig?.sportsGlobalConfig as any
  
  const [eventSettings, leagueSettings, sportSettings, defaultSportSettings] = await Promise.all([
    getTierSettings(eventSettingsTable, 'eventId', input.eventId, input.whitelabelId, input.tierId),
    getTierSettings(leagueSettingsTable, 'leagueId', input.leagueId, input.whitelabelId, input.tierId),
    getTierSettings(sportsSettingsTable, 'sportId', input.sportId, input.whitelabelId, input.tierId),
    getTierSettings(sportsSettingsTable, 'sportId', input.sportId, input.whitelabelId, 'default'),
  ])

  const sport = sportSettings || defaultSportSettings
  const merged = mergeSettings(sport, leagueSettings, eventSettings, globalConfig)
  
  return {
    effectiveSettings: merged,
    rawSettings: {
      event: eventSettings,
      league: leagueSettings,
      sport: sport,
      global: globalConfig,
    },
  }
}

function mergeSettings(
  sport?: any,
  league?: any,
  event?: any,
  globalConfig?: any
): EffectiveSettings {
  // Helper to pick value from hierarchy: event > league > sport > global > null
  const pick = (key: string) => {
    if (event?.[key] != null) return event[key]
    if (league?.[key] != null) return league[key]
    if (sport?.[key] != null) return sport[key]
    // Fallback to global config defaults
    if (globalConfig?.defaultStakeLimits) {
      if (key === 'exchangeMinStake') return globalConfig.defaultStakeLimits.exchangeMin
      if (key === 'exchangeMaxStake') return globalConfig.defaultStakeLimits.exchangeMax
      if (key === 'bookmakerMinStake') return globalConfig.defaultStakeLimits.bookmakerMin
      if (key === 'bookmakerMaxStake') return globalConfig.defaultStakeLimits.bookmakerMax
      if (key === 'fancyMinStake') return globalConfig.defaultStakeLimits.fancyMin
      if (key === 'fancyMaxStake') return globalConfig.defaultStakeLimits.fancyMax
    }
    // Fallback to global config defaults for bet delays
    if (globalConfig?.defaultBetDelays) {
      if (key === 'exchangeDelay' && globalConfig.defaultBetDelays.exchange != null) {
        return globalConfig.defaultBetDelays.exchange
      }
      if (key === 'bookmakerDelay' && globalConfig.defaultBetDelays.bookmaker != null) {
        return globalConfig.defaultBetDelays.bookmaker
      }
      if (key === 'fancyDelay' && globalConfig.defaultBetDelays.fancy != null) {
        return globalConfig.defaultBetDelays.fancy
      }
    }
    // Fallback to global config defaults for bet cooldowns
    if (globalConfig?.defaultBetCooldowns) {
      if (key === 'exchangeCooldown' && globalConfig.defaultBetCooldowns.exchange != null) {
        return globalConfig.defaultBetCooldowns.exchange
      }
      if (key === 'bookmakerCooldown' && globalConfig.defaultBetCooldowns.bookmaker != null) {
        return globalConfig.defaultBetCooldowns.bookmaker
      }
      if (key === 'fancyCooldown' && globalConfig.defaultBetCooldowns.fancy != null) {
        return globalConfig.defaultBetCooldowns.fancy
      }
    }
    return null
  }
  
  const pickInt = (key: string) => {
    const val = pick(key)
    return val != null ? Number(val) : null
  }

  return {
    exchange: {
      minStake: num(pick('exchangeMinStake')),
      maxStake: num(pick('exchangeMaxStake')),
      minOdds: num(pick('exchangeMinOdds')),
      maxOdds: num(pick('exchangeMaxOdds')),
      exposureCap: num(pick('exchangeExposureCap')),
      delay: pickInt('exchangeDelay'),
      cooldown: pickInt('exchangeCooldown'),
    },
    bookmaker: {
      minStake: num(pick('bookmakerMinStake')),
      maxStake: num(pick('bookmakerMaxStake')),
      minOdds: num(pick('exchangeMinOdds')),
      maxOdds: num(pick('exchangeMaxOdds')),
      exposureCap: num(pick('bookmakerExposureCap')),
      delay: pickInt('bookmakerDelay'),
      cooldown: pickInt('bookmakerCooldown'),
    },
    fancy: {
      minStake: num(pick('fancyMinStake')),
      maxStake: num(pick('fancyMaxStake')),
      minOdds: null,
      maxOdds: null,
      exposureCap: num(pick('fancyExposureCap')),
      delay: pickInt('fancyDelay'),
      cooldown: pickInt('fancyCooldown'),
    },
  }
}

async function getTierSettings(
  table: any,
  key: 'sportId' | 'leagueId' | 'eventId',
  id: string,
  whitelabelId: string,
  tierId: string
) {
  try {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.whitelabelId, whitelabelId), eq(table[key], id), eq(table.tierId, tierId)))
    
    if (rows[0]) return rows[0]
  } catch (err: any) {
    // If query fails due to missing columns (like cooldown columns that might not be migrated yet),
    // log the error but don't fail the entire bet placement - return null to use defaults
    if (err?.message?.includes('column') || err?.message?.includes('does not exist') || err?.code === '42703') {
      // Return null to allow fallback/default logic to work
      // The bet will proceed with default settings if tier-specific settings can't be loaded
    } else {
      // Re-throw non-column errors as they indicate real problems
      throw err
    }
  }
  
  if (tierId !== 'default') {
    try {
      const fallback = await db
        .select()
        .from(table)
        .where(and(eq(table.whitelabelId, whitelabelId), eq(table[key], id), eq(table.tierId, 'default')))
      
      return fallback[0] ?? null
    } catch (err: any) {
      if (err?.message?.includes('column') || err?.message?.includes('does not exist') || err?.code === '42703') {
        return null
      }
      throw err
    }
  }
  return null
}

function pickSettings(settings: EffectiveSettings, marketType: 'exchange' | 'bookmaker' | 'fancy'): Settings {
  return settings[marketType]
}

function isUnavailableOddsStatus(value: unknown): boolean {
  const status = String(value ?? '').replace(/[ _-]/g, '').toUpperCase()
  return ['SUSPENDED', 'CLOSED', 'INACTIVE', 'REMOVED', 'BALLRUNNING', 'SETTLED', 'VOID'].includes(status)
}

async function fetchMarketOdds(
  ctx: ResolverContext,
  params: { marketId: string; marketCode?: string; selectionId: string }
): Promise<MarketOdds | null> {
  if (!appConfig.sportsApiMarketOddsPath) {
    return null
  }
  
  if (!appConfig.upstreamApiBaseUrl) {
    return null
  }

  try {
    // API expects market codes like "1.251441372", NOT UUIDs
    // If marketCode is not available, we cannot call the API
    if (!params.marketCode) {
      return null
    }
    
    const res = await upstreamRequest<{ data?: any }>(ctx, {
      path: appConfig.sportsApiMarketOddsPath,
      method: 'GET',
      // API expects market_ids as query parameter with market code (e.g., "1.251441372")
      query: { market_ids: params.marketCode },
    })

    // Handle different response formats
    let markets: any[] = []
    if (Array.isArray((res as any)?.data)) {
      markets = (res as any).data
    } else if (Array.isArray(res)) {
      markets = res
    } else if ((res as any)?.data && typeof (res as any).data === 'object') {
      // Single market object
      markets = [(res as any).data]
    }

    if (!markets || markets.length === 0) {
      return null
    }

    // Find the matching market by marketCode (the API uses market codes)
    const market = markets.find(
      (m: any) =>
        String(m.marketCode || m.market_code || m.id || '') === params.marketCode ||
        String(m.marketId || m.market_id || '') === params.marketCode
    )

    if (!market || market.snapshotAvailable === false || market.feedConnected === false || isUnavailableOddsStatus(market.status ?? market.marketStatus ?? market.state)) {
      return null
    }

    if (!Array.isArray(market.runners) || market.runners.length === 0) {
      return null
    }

    const selectionIdStr = String(params.selectionId)
    const runner =
      market.runners.find(
        (r: any) =>
          String(r.selectionId || r.selection_id || r.id || '') === selectionIdStr
      )

    if (!runner || isUnavailableOddsStatus(runner.status ?? runner.runnerStatus)) {
      return null
    }

    // Extract all available back and lay odds from exchange data
    // For back bets: use MAXIMUM odds from all available back prices (best for user)
    // For lay bets: use MINIMUM odds from all available lay prices (best for user)
    let bestBack: number | null = null
    let bestLay: number | null = null

    if (Array.isArray(runner.ex?.availableToBack) && runner.ex.availableToBack.length > 0) {
      // Extract all back prices and find the maximum
      const backPrices = runner.ex.availableToBack
        .map((item: any) => toNum(item?.price))
        .filter((price: number) => price > 0)
      
      if (backPrices.length > 0) {
        bestBack = Math.max(...backPrices)
      }
    } else {
      // Fallback to single back price
      bestBack = toNum(runner.back || runner.backPrice || runner.oddsBack || runner.b)
    }

    if (Array.isArray(runner.ex?.availableToLay) && runner.ex.availableToLay.length > 0) {
      // Extract all lay prices and find the minimum
      const layPrices = runner.ex.availableToLay
        .map((item: any) => toNum(item?.price))
        .filter((price: number) => price > 0)
      
      if (layPrices.length > 0) {
        bestLay = Math.min(...layPrices)
      }
    } else {
      // Fallback to single lay price
      bestLay = toNum(runner.lay || runner.layPrice || runner.oddsLay || runner.l)
    }

    return {
      backOdds: bestBack,
      layOdds: bestLay,
      updatedAt: market.lastUpdatedTime ? String(market.lastUpdatedTime) : null,
    }
  } catch (err) {
    // Log the error for debugging but don't throw - let the caller handle it
    return null
  }
}

type FancyLiveOdds = {
  backOdds: number | null
  layOdds: number | null
  backSize: number | null
  laySize: number | null
  status: string | null
}

function normalizeFancyLabel(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFancyRunnersFromUpstreamPayload(res: unknown): any[] {
  const r = res as any
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.data)) return r.data
  if (Array.isArray(r?.data?.runners)) return r.data.runners
  if (Array.isArray(r?.runners)) return r.runners
  if (Array.isArray(r?.data?.data)) return r.data.data
  if (r?.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
    const d = r.data
    if (Array.isArray(d.runners)) return d.runners
    if (Array.isArray(d.items)) return d.items
  }
  return []
}

async function fetchFancyOdds(
  ctx: ResolverContext,
  params: { eventCode: string; selectionId: string; selectionName?: string | null }
): Promise<FancyLiveOdds | null> {
  if (!appConfig.sportsApiFancyOddsPath || !appConfig.upstreamApiBaseUrl || !params.eventCode) {
    return null
  }

  try {
    const base = appConfig.upstreamApiBaseUrl.replace(/\/$/, '')
    const path = appConfig.sportsApiFancyOddsPath.startsWith('/')
      ? appConfig.sportsApiFancyOddsPath
      : `/${appConfig.sportsApiFancyOddsPath}`
    const url = new URL(`${base}${path}`)
    url.searchParams.set('event_id', String(params.eventCode))

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ctx.auth.rawToken) {
      headers.Authorization = `Bearer ${ctx.auth.rawToken}`
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return null
    }

    const data: unknown = await response.json().catch(() => null)
    if (data == null) {
      return null
    }

    const runners = extractFancyRunnersFromUpstreamPayload(data)
    if (!runners.length) {
      return null
    }

    const selId = String(params.selectionId ?? '').trim()
    const nameNorm = params.selectionName ? normalizeFancyLabel(params.selectionName) : ''

    const runner = runners.find((row: any) => {
      const rid = String(row?.id ?? row?.selectionId ?? '').trim()
      if (rid && selId && rid === selId) return true
      if (nameNorm) {
        const rn = normalizeFancyLabel(row?.name ?? row?.runnerName ?? row?.selectionName)
        return rn.length > 0 && rn === nameNorm
      }
      return false
    })

    if (!runner) {
      return null
    }

    return {
      backOdds: toNum(runner.b1 ?? runner.back),
      layOdds: toNum(runner.l1 ?? runner.lay),
      backSize: toNum(runner.bs1 ?? runner.backSize),
      laySize: toNum(runner.ls1 ?? runner.laySize),
      status: runner.status1 != null ? String(runner.status1) : runner.status != null ? String(runner.status) : null,
    }
  } catch {
    return null
  }
}

function normalizeMarketType(type?: string | null): 'exchange' | 'bookmaker' | 'fancy' {
  const val = (type || 'exchange').toLowerCase()
  if (val === 'bookmaker') return 'bookmaker'
  if (val === 'fancy') return 'fancy'
  return 'exchange'
}

function num(value: any): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toNum(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const __sportsBetTestUtils = {
  normalizeMarketType,
  mergeSettings,
  pickSettings,
  normalizeLegs,
}

