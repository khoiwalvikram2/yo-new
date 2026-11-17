import { assertPlayerDomainBetting } from '@shared/access/playerDomains.js'
import { nanoid } from 'nanoid'
import { and, desc, eq, gte, sql } from 'drizzle-orm'

const eqL = eq as any
const andL = and as any
import { appConfigs, casinoBets, playerLimits, sportsBets, users } from '@shared/db/schema.js'
import { db as dbClient } from '../db/client.js'

const db = dbClient as any
import { getWhitelabelCurrency, getWhitelabelTimezone } from '../shared/whitelabelConfig.js'
import { getStartOfDay, getStartOfWeek } from '../shared/dateUtils.js'
import {
  calculateProjectedExposure,
  recalculateAndUpdateExposure,
} from '../domains/userApp/services/exposureCalculationService.js'
import {
  assertCashWalletCoversProjectedBookExposureInTx,
  computeSportsPlacementLiability,
  insertSportsBetsAndRecalcExposureLedgerInTx,
  type SportsPlacementValidatedLeg,
} from '../domains/userApp/services/sportsBetPlacementTx.js'
import { ensureWallet } from '../repos/userRepo.js'
import { assertPlayerAgentAllowsBetting } from '../domains/userApp/services/agentBettingGate.js'
import {
  validateSportsBetHierarchy,
  getSportsBetById,
  settleSportsBetOpen,
  deleteToolSportsBetHard,
  getSportsMarketType,
  resolveOrCreateFancyMarketForTool,
} from '../repos/sportsBetToolRepo.js'
import {
  applySportsSingleBetSettlement,
  type SportsResultMarketType,
} from '@shared/services/sportsSingleBetSettlementApply.js'
import { currencyService } from './currencyService.js'
import type { CurrencyCode } from '../types/currency.js'

const BET_TOOL_RESULT_ID = 'bet-tool'

/** Aligned with `placeSportsBetForUser` fallbacks in sportsBetService. */
const TOOL_DEFAULT_MIN_STAKE = 100
const TOOL_DEFAULT_MAX_STAKE = 500000
const TOOL_DEFAULT_MIN_ODDS = 1.01
const TOOL_DEFAULT_MAX_ODDS = 1000

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
  if (newBet && (!user.sportsVisible || !user.sportsBetAllowed)) {
    throw new Error('Sports betting is disabled for this account')
  }
  const pt = user.playerType || 'REGULAR'
  if (pt === 'AGENT_CREDIT' || pt === 'WHITELABEL_CREDIT') {
    const err = new Error('Bet-tool API does not support credit players in MVP')
    ;(err as any).code = 'CREDIT_PLAYER'
    throw err
  }
  return user as Record<string, unknown> & { vipTierId?: string | null }
}

export async function toolPlaceSportsBet(input: {
  tenant: string
  /** Must match `tenant` (validated at route); stored on sports_bets and used for post-placement hooks. */
  whitelabelId: string
  userId: number
  sportId: string
  leagueId: string
  marketId: string
  eventId: string
  runnerId: string
  selectionId: string
  side: 'back' | 'lay'
  price: number
  stake: number
  /** Client-supplied liability; must match server book formula within tolerance. */
  liability: number
  /** Required when market type is fancy (same as user app). */
  oddsSize?: number | null
  /** Optional; when creating a fancy market on-the-fly, used like GraphQL `marketCode`. */
  marketCode?: string | null
  /** Optional display name for a newly created fancy market/runner. */
  selectionLabel?: string | null
  /** Optional client telemetry (same columns as user-app sports bets). */
  ipAddress?: string | null
  userAgent?: string | null
  deviceInfo?: string | null
  location?: string | null
  country?: string | null
}) {
  const user = await loadRegularCashPlayer(input.userId, input.tenant)
  // Agent players: refused while their agent branch is not ACTIVE or lacks the sports domain.
  await assertPlayerAgentAllowsBetting(db, { userId: input.userId, tenant: input.tenant }, 'sports')
  await assertPlayerDomainBetting(db, input.tenant, input.userId, 'sports')

  const appConfigRow = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, input.whitelabelId),
  })
  const sportsConfig = appConfigRow?.sportsGlobalConfig as
    | { showFancy?: boolean; showBookmaker?: boolean; showExchange?: boolean }
    | undefined

  let marketId = input.marketId
  let runnerId = input.runnerId
  const fancyByOdds =
    input.oddsSize != null && Number.isFinite(Number(input.oddsSize)) && Number(input.oddsSize) > 0

  if (fancyByOdds) {
    if (sportsConfig?.showFancy === false) {
      throw new Error('Fancy markets are disabled for this whitelabel')
    }
    const resolved = await resolveOrCreateFancyMarketForTool({
      sportId: input.sportId,
      leagueId: input.leagueId,
      eventId: input.eventId,
      marketId: input.marketId,
      marketCode: input.marketCode ?? null,
      selectionId: input.selectionId,
      runnerId: input.runnerId,
      selectionLabel: input.selectionLabel ?? null,
    })
    marketId = resolved.marketId
    runnerId = resolved.runnerId
  } else {
    const v = await validateSportsBetHierarchy({
      sportId: input.sportId,
      leagueId: input.leagueId,
      marketId: input.marketId,
      eventId: input.eventId,
      runnerId: input.runnerId,
      selectionId: input.selectionId,
    })
    if (!v.ok) {
      throw new Error(v.message)
    }
  }

  const marketTypeRaw = await getSportsMarketType(marketId)
  if (!marketTypeRaw) {
    throw new Error('Market not found')
  }
  const marketType = marketTypeRaw as SportsPlacementValidatedLeg['marketType']
  if (marketType === 'fancy') {
    const os = input.oddsSize
    if (os == null || !Number.isFinite(os) || os <= 0) {
      throw new Error('oddsSize is required for fancy markets')
    }
  }

  if (marketType === 'fancy' && sportsConfig?.showFancy === false) {
    throw new Error('Fancy markets are disabled for this whitelabel')
  }
  if (marketType === 'bookmaker' && sportsConfig?.showBookmaker === false) {
    throw new Error('Bookmaker markets are disabled for this whitelabel')
  }
  if (marketType === 'exchange' && sportsConfig?.showExchange === false) {
    throw new Error('Exchange markets are disabled for this whitelabel')
  }

  if (!Number.isFinite(input.stake) || input.stake <= 0) {
    throw new Error('Stake must be greater than zero')
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error('Odds must be a positive number')
  }
  if (marketType !== 'fancy' && input.price <= 1) {
    throw new Error('Odds must be greater than 1.0')
  }

  const vipTierId = (user.vipTierId as string | null | undefined) || 'default'
  const { loadEffectiveSettingsWithRaw } = await import('../domains/userApp/services/sportsBetService.js')
  const { effectiveSettings, rawSettings } = await loadEffectiveSettingsWithRaw({
    whitelabelId: input.whitelabelId,
    sportId: input.sportId,
    leagueId: input.leagueId,
    eventId: input.eventId,
    tierId: vipTierId,
  })

  const limits = effectiveSettings[marketType]

  const cooldownKey =
    marketType === 'exchange'
      ? 'exchangeCooldown'
      : marketType === 'bookmaker'
        ? 'bookmakerCooldown'
        : 'fancyCooldown'

  const cooldownLevel =
    rawSettings.event?.[cooldownKey] != null
      ? 'event'
      : rawSettings.league?.[cooldownKey] != null
        ? 'league'
        : rawSettings.sport?.[cooldownKey] != null
          ? 'sport'
          : rawSettings.global?.defaultBetCooldowns?.[marketType] != null
            ? 'global'
            : null

  if (limits.cooldown != null && limits.cooldown > 0 && cooldownLevel) {
    const cooldownSeconds = limits.cooldown
    const conditions = [eq(sportsBets.userId, input.userId), eq(sportsBets.tenant, input.tenant)]
    if (cooldownLevel === 'event') {
      conditions.push(eq(sportsBets.eventId, input.eventId))
    } else if (cooldownLevel === 'league') {
      conditions.push(eq(sportsBets.leagueId, input.leagueId))
    } else if (cooldownLevel === 'sport') {
      conditions.push(eq(sportsBets.sportId, input.sportId))
    }

    const lastBet = await db
      .select({ createdAt: sportsBets.createdAt })
      .from(sportsBets)
      .where(and(...conditions))
      .orderBy(desc(sportsBets.createdAt))
      .limit(1)
      .then((rows: { createdAt: Date | null }[]) => rows[0])

    if (lastBet?.createdAt) {
      const timeSinceLastBet = (Date.now() - new Date(lastBet.createdAt as Date).getTime()) / 1000
      if (timeSinceLastBet < cooldownSeconds) {
        const remainingSeconds = Math.ceil(cooldownSeconds - timeSinceLastBet)
        const levelName =
          cooldownLevel === 'event'
            ? 'this event'
            : cooldownLevel === 'league'
              ? 'this league'
              : cooldownLevel === 'sport'
                ? 'this sport'
                : 'any market'
        throw new Error(
          `Please wait ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''} before placing another bet in ${levelName}`
        )
      }
    }
  }

  const minStake = limits.minStake ?? TOOL_DEFAULT_MIN_STAKE
  const maxStake = limits.maxStake ?? TOOL_DEFAULT_MAX_STAKE
  if (minStake == null || maxStake == null) {
    throw new Error(`Betting is not configured for this market type (${marketType}). Please contact support.`)
  }
  if (input.stake < minStake) {
    throw new Error(`Minimum stake is ${minStake}`)
  }
  if (input.stake > maxStake) {
    throw new Error(`Maximum stake is ${maxStake}`)
  }

  const minOdds = limits.minOdds ?? TOOL_DEFAULT_MIN_ODDS
  const maxOdds = limits.maxOdds ?? TOOL_DEFAULT_MAX_ODDS
  if (input.price < minOdds) {
    throw new Error(`Odds must be at least ${minOdds}`)
  }
  if (input.price > maxOdds) {
    throw new Error(`Odds cannot exceed ${maxOdds}`)
  }

  // Tier bet-delay (sleep) from placeSportsBetForUser is intentionally skipped here so the bet-tool API stays responsive.

  const currency = (await getWhitelabelCurrency(input.whitelabelId)) || 'INR'
  const computedLiability = computeSportsPlacementLiability(
    marketType,
    input.side,
    input.stake,
    input.price,
    input.oddsSize ?? null
  )
  if (!Number.isFinite(input.liability)) {
    throw new Error('liability is required and must be a finite number')
  }
  if (Math.abs(computedLiability - input.liability) > 0.05) {
    throw new Error('liability does not match stake, price, side, and market type (check fancy oddsSize)')
  }

  const wallet = await ensureWallet(input.userId, input.tenant, currency)

  if (limits.exposureCap != null) {
    const projectedExposure = Number(wallet.exposure ?? 0) + computedLiability
    if (projectedExposure > limits.exposureCap) {
      throw new Error('Exposure exceeds configured cap')
    }
  }

  const [playerLimitRow] = await db
    .select()
    .from(playerLimits as any)
    .where(andL(eqL(playerLimits.userId, input.userId), eqL(playerLimits.tenant, input.tenant)))
    .limit(1)
  const playerLimit = playerLimitRow as
    | {
        maxBetSports?: unknown
        exposureCapOverride?: unknown
        dailyStakeLimit?: unknown
        weeklyStakeLimit?: unknown
        cooldownSeconds?: unknown
      }
    | undefined

  if (playerLimit?.maxBetSports != null) {
    const maxBetSports = Number(playerLimit.maxBetSports)
    if (input.stake > maxBetSports) {
      throw new Error(`Single bet stake exceeds your configured limit of ${maxBetSports}`)
    }
  }

  if (playerLimit?.exposureCapOverride != null) {
    const exposureOverride = Number(playerLimit.exposureCapOverride)
    const projectedBookExposure = await calculateProjectedExposure(input.userId, input.tenant, [
      {
        marketId,
        selectionId: input.selectionId,
        side: input.side,
        price: input.price,
        stake: input.stake,
        oddsSize: input.oddsSize ?? null,
      },
    ])
    if (projectedBookExposure > exposureOverride) {
      throw new Error(`Total exposure exceeds your configured limit of ${exposureOverride}`)
    }
  }

  if (playerLimit?.dailyStakeLimit != null) {
    const dailyStakeLimit = Number(playerLimit.dailyStakeLimit)
    const tz = await getWhitelabelTimezone(input.tenant)
    const todayStart = getStartOfDay(tz)
    const [sportsToday] = await db
      .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.userId, input.userId),
          eq(sportsBets.tenant, input.tenant),
          gte(sportsBets.createdAt, todayStart)
        )
      )
    const [casinoToday] = await db
      .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
      .from(casinoBets)
      .where(
        and(
          eq(casinoBets.userId, input.userId),
          eq(casinoBets.tenant, input.tenant),
          gte(casinoBets.createdAt, todayStart)
        )
      )
    const todayTotalStake = Number(sportsToday?.total ?? 0) + Number(casinoToday?.total ?? 0)
    if (todayTotalStake + input.stake > dailyStakeLimit) {
      throw new Error(`Daily stake limit of ${dailyStakeLimit} would be exceeded`)
    }
  }

  if (playerLimit?.weeklyStakeLimit != null) {
    const weeklyStakeLimit = Number(playerLimit.weeklyStakeLimit)
    const tz = await getWhitelabelTimezone(input.tenant)
    const weekStart = getStartOfWeek(tz)
    const [sportsWeek] = await db
      .select({ total: sql<string>`COALESCE(SUM(${sportsBets.stake}::numeric), 0)` })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.userId, input.userId),
          eq(sportsBets.tenant, input.tenant),
          gte(sportsBets.createdAt, weekStart)
        )
      )
    const [casinoWeek] = await db
      .select({ total: sql<string>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)` })
      .from(casinoBets)
      .where(
        and(
          eq(casinoBets.userId, input.userId),
          eq(casinoBets.tenant, input.tenant),
          gte(casinoBets.createdAt, weekStart)
        )
      )
    const weekTotalStake = Number(sportsWeek?.total ?? 0) + Number(casinoWeek?.total ?? 0)
    if (weekTotalStake + input.stake > weeklyStakeLimit) {
      throw new Error(`Weekly stake limit of ${weeklyStakeLimit} would be exceeded`)
    }
  }

  if (playerLimit?.cooldownSeconds != null && Number(playerLimit.cooldownSeconds) > 0) {
    const cooldownMs = Number(playerLimit.cooldownSeconds) * 1000
    const lastSportsBet = await db
      .select({ createdAt: sportsBets.createdAt })
      .from(sportsBets)
      .where(and(eq(sportsBets.userId, input.userId), eq(sportsBets.tenant, input.tenant)))
      .orderBy(desc(sportsBets.createdAt))
      .limit(1)
      .then((rows: { createdAt: Date | null }[]) => rows[0])
    const lastCasinoBet = await db
      .select({ createdAt: casinoBets.createdAt })
      .from(casinoBets)
      .where(and(eq(casinoBets.userId, input.userId), eq(casinoBets.tenant, input.tenant)))
      .orderBy(desc(casinoBets.createdAt))
      .limit(1)
      .then((rows: { createdAt: Date | null }[]) => rows[0])
    const lastSportsTime = lastSportsBet?.createdAt ? new Date(lastSportsBet.createdAt as Date).getTime() : 0
    const lastCasinoTime = lastCasinoBet?.createdAt ? new Date(lastCasinoBet.createdAt as Date).getTime() : 0
    const lastBetTime = Math.max(lastSportsTime, lastCasinoTime)
    if (lastBetTime > 0) {
      const timeSinceLastBet = Date.now() - lastBetTime
      if (timeSinceLastBet < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastBet) / 1000)
        throw new Error(`Please wait ${remainingSeconds} seconds before placing another bet`)
      }
    }
  }

  const slipId = nanoid(12)
  const validatedLeg: SportsPlacementValidatedLeg[] = [
    {
      leg: {
        selectionId: input.selectionId,
        oddsSize: input.oddsSize ?? null,
      },
      side: input.side,
      odds: input.price,
      stake: input.stake,
      liability: computedLiability,
      marketType,
      marketId,
      eventId: input.eventId,
      leagueId: input.leagueId,
      sportId: input.sportId,
      runnerId,
      whitelabelId: input.whitelabelId,
      currency,
    },
  ]

  const [placed] = await db.transaction(async (tx: any) => {
    await assertCashWalletCoversProjectedBookExposureInTx(tx, {
      walletId: wallet.id,
      tenant: input.tenant,
      userId: input.userId,
      validatedLegs: validatedLeg,
    })
    return insertSportsBetsAndRecalcExposureLedgerInTx(tx, {
      userId: input.userId,
      tenant: input.tenant,
      wallet,
      slipId,
      validatedLegs: validatedLeg,
      excludeFromAdminRunning: true,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceInfo: input.deviceInfo ?? null,
      location: input.location ?? null,
      country: input.country ?? null,
    })
  })

  try {
    await recalculateAndUpdateExposure(input.userId, input.tenant)
  } catch {
    /* non-fatal, mirrors placeSportsBetForUser */
  }

  const row = await getSportsBetById(placed.id)
  if (!row) {
    throw new Error('Failed to load sports bet after placement')
  }

  const createdAt =
    row.createdAt instanceof Date
      ? row.createdAt
      : row.createdAt
        ? new Date(row.createdAt as string)
        : new Date()
  // Dynamic import keeps bet-tool route load light (avoids pulling full post-processing graph in smoke tests).
  void import('../domains/userApp/services/betPostProcessingService.js')
    .then(({ processBetPostPlacement }) =>
      processBetPostPlacement({
        betId: String(row.id),
        userId: input.userId,
        eventId: input.eventId,
        tenant: input.tenant,
        whitelabelId: input.whitelabelId,
        stake: input.stake,
        liability: computedLiability,
        odds: input.price,
        side: input.side,
        marketId,
        createdAt,
      }).catch(() => {})
    )
    .catch(() => {})

  void import('../repos/userAppRepo.js')
    .then(({ addRecentSportsEvent }) =>
      addRecentSportsEvent(input.userId, input.tenant, input.eventId, {
        eventName: 'Event',
        league: '',
        sport: '',
        startISO: new Date().toISOString(),
        isLive: false,
        runners: [],
      }).catch(() => {})
    )
    .catch(() => {})

  return row
}

export async function toolSettleSportsBet(input: {
  tenant: string
  whitelabelId: string
  userId: number
  betId: string
  outcome: 'won' | 'lost' | 'void'
}) {
  await loadRegularCashPlayer(input.userId, input.tenant, false)
  const bet = await getSportsBetById(input.betId)
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
  const marketTypeRaw = await getSportsMarketType(String(bet.marketId))
  if (!marketTypeRaw) {
    throw new Error('Market not found')
  }
  const marketType = marketTypeRaw as SportsResultMarketType

  const fallbackCurrency = (await getWhitelabelCurrency(input.whitelabelId)) || 'INR'
  // The conversions below are synchronous: read the admin Currency page's rates first (cached for a minute).
  await currencyService.ready()

  await db.transaction(async (tx: any) => {
    const step = await applySportsSingleBetSettlement(
      tx,
      {
        bet: bet as any,
        outcome: input.outcome,
        marketType,
        tenant: input.tenant,
        marketId: String(bet.marketId),
        eventId: String(bet.eventId),
        resultId: BET_TOOL_RESULT_ID,
        fallbackCurrency,
      },
      async (tt, betId, status, w, s, pl) => settleSportsBetOpen(betId, status, w, s, pl, tt as any),
      (a, c) => currencyService.toBaseCurrency(a, c as CurrencyCode),
      () => currencyService.getBaseCurrency()
    )
    if (!step.ok) {
      const msg = step.error
      if (step.code === 'BET_ALREADY_SETTLED') {
        const err = new Error(msg)
        ;(err as any).code = 'BET_ALREADY_SETTLED'
        throw err
      }
      throw new Error(msg)
    }
    if (step.postBonus) {
      const { updateBonusWagering } = await import('@shared/services/bonusService.js')
      try {
        await updateBonusWagering(step.postBonus.userId, step.postBonus.tenant, step.postBonus.betAmount, 'sports', undefined, 'cash')
      } catch {
        /* non-fatal */
      }
    }
    if (step.postReferral) {
      const { triggerReferralBetSettlement } = await import('./referralBetSettlementTrigger.js')
      try {
        await triggerReferralBetSettlement({
          tenant: step.postReferral.tenant,
          userId: step.postReferral.userId,
          netRevenue: step.postReferral.netRevenue,
          currency: step.postReferral.currency,
          domain: 'sports',
          betId: step.postReferral.betId,
        })
      } catch {
        /* non-fatal */
      }
    }
  })

  await recalculateAndUpdateExposure(input.userId, input.tenant)
  return getSportsBetById(input.betId)
}

export async function toolDeleteSportsBet(input: {
  tenant: string
  whitelabelId: string
  userId: number
  betId: string
}) {
  await loadRegularCashPlayer(input.userId, input.tenant, false)
  const existing = await getSportsBetById(input.betId)
  if (existing && String(existing.whitelabelId ?? '') !== input.whitelabelId) {
    throw new Error('Bet does not match whitelabel')
  }
  let deleted = false
  await db.transaction(async (tx: any) => {
    deleted = await deleteToolSportsBetHard(input.betId, input.tenant, input.userId, tx)
    if (deleted) {
      await recalculateAndUpdateExposure(input.userId, input.tenant, tx)
    }
  })
  if (!deleted) {
    const bet = await getSportsBetById(input.betId)
    if (bet && bet.excludeFromAdminRunning && bet.status !== 'matched' && bet.status !== 'unmatched') {
      const err = new Error('Settled bets cannot be permanently deleted')
      ;(err as any).code = 'SETTLED'
      throw err
    }
    throw new Error('Bet not found or not deletable via bet-tool')
  }
  return { deleted: true }
}
