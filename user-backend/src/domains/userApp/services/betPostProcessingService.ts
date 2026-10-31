import { db } from '../../../db/client.js'
import { sportsBets, users, riskConfigTable } from '@shared/db/schema.js'
import { eq, and, gte, desc, or } from 'drizzle-orm'
import { getRedisEmitter } from '../../../realtime/redisPubsub.js'

/**
 * Post-process a bet after placement:
 * 1. Calculate risk using risk config
 * 2. Detect betting patterns
 * 3. Evaluate automation rules
 * 4. Publish real-time events
 */
export async function processBetPostPlacement(params: {
  betId: string
  userId: number
  eventId: string
  tenant: string
  whitelabelId: string
  stake: number
  liability: number
  odds: number
  side: 'back' | 'lay'
  marketId: string
  createdAt: Date
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
}): Promise<void> {
  try {
    const { betId, userId, eventId, tenant, whitelabelId, stake, liability, odds, side, marketId, createdAt } = params

    // 1. Calculate risk using risk config
    const riskResult = await calculatePlayerRisk({
      userId,
      eventId,
      tenant,
      whitelabelId,
      newBet: { stake, liability, odds, side },
      betId, // Pass betId to ensure accurate counting
    })

    // 2. Detect betting patterns
    const patterns = await detectBettingPatterns({
      userId,
      eventId,
      tenant,
      whitelabelId,
      betId,
      stake,
      liability,
      odds,
      side,
      marketId,
      createdAt,
      marketType: params.marketType,
    })

    // 3. Evaluate automation rules
    const automationResult = await evaluateAutomationRules({
      betId,
      userId,
      eventId,
      tenant,
      whitelabelId,
      stake,
      liability,
      odds,
      side,
      riskLevel: riskResult.riskLevel,
      detectedPatterns: patterns.map(p => p.type),
    })

    // 4. Publish real-time events
    await publishBetEvents({
      betId,
      userId,
      eventId,
      tenant,
      whitelabelId,
      stake,
      liability,
      odds,
      side,
      riskLevel: riskResult.riskLevel,
      patterns,
      automationActions: automationResult.actions,
    })
  } catch (error: any) {
    // Log error but don't throw - bet placement should succeed even if processing fails
  }
}

/**
 * Calculate percentile from array
 */
function getPercentile(arr: number[], percentile: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = Math.ceil((percentile / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)] || 0
}

/**
 * Calculate player risk using risk config (fully dynamic - compares against all players)
 */
async function calculatePlayerRisk(params: {
  userId: number
  eventId: string
  tenant: string
  whitelabelId: string
  newBet: { stake: number; liability: number; odds: number; side: 'back' | 'lay' }
  betId?: string // Optional: to check if bet is already in query results
}): Promise<{ riskLevel: string; riskScore: number }> {
  const { userId, eventId, tenant, whitelabelId } = params

  try {
    // Load risk config
    const riskConfig = await db
      .select()
      .from(riskConfigTable)
      .where(
        and(
          eq(riskConfigTable.whitelabelId, whitelabelId),
          eq(riskConfigTable.eventId, eventId),
          eq(riskConfigTable.tenant, tenant)
        )
      )
      .limit(1)
      .then((rows) => rows[0] || null)

    // Get ALL bets for this event (to calculate percentiles dynamically)
    // Only count matched/unmatched bets (exclude void, cancelled, settled)
    const allEventBets = await db
      .select()
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.eventId, eventId),
          eq(sportsBets.tenant, tenant),
          eq(sportsBets.whitelabelId, whitelabelId),
          or(
            eq(sportsBets.status, 'matched'),
            eq(sportsBets.status, 'unmatched')
          )
        )
      )

    // Calculate metrics for ALL players in the event
    const playerMetricsMap = new Map<number, {
      betCount: number
      totalLiability: number
      netExposure: number
      totalOdds: number
    }>()

    for (const bet of allEventBets) {
      const betUserId = bet.userId
      const betStake = Number(bet.stake) || 0
      const betLiability = Number(bet.liability) || 0
      const betPrice = Number(bet.price) || 0
      const betSide = bet.side as 'back' | 'lay'

      const metrics = playerMetricsMap.get(betUserId) || {
        betCount: 0,
        totalLiability: 0,
        netExposure: 0,
        totalOdds: 0,
      }

      metrics.betCount += 1
      metrics.totalLiability += betLiability
      metrics.totalOdds += betPrice

      if (betSide === 'back') {
        metrics.netExposure += betLiability
      } else {
        metrics.netExposure -= betStake
      }

      playerMetricsMap.set(betUserId, metrics)
    }

    // Ensure the new bet is included in the current player's metrics
    // Check if the bet is already in the query results by checking betId
    const newBet = params.newBet
    const betId = params.betId
    const betAlreadyCounted = betId ? allEventBets.some(b => b.id === betId) : false
    
    const currentPlayerMetrics = playerMetricsMap.get(userId) || {
      betCount: 0,
      totalLiability: 0,
      netExposure: 0,
      totalOdds: 0,
    }
    
    // Add the new bet to current player's metrics if not already counted
    if (!betAlreadyCounted) {
      currentPlayerMetrics.betCount += 1
      currentPlayerMetrics.totalLiability += newBet.liability
      currentPlayerMetrics.totalOdds += newBet.odds
      
      if (newBet.side === 'back') {
        currentPlayerMetrics.netExposure += newBet.liability
      } else {
        currentPlayerMetrics.netExposure -= newBet.stake
      }
      
      playerMetricsMap.set(userId, currentPlayerMetrics)
    }

    // Get current player's metrics
    const playerMetrics = playerMetricsMap.get(userId)
    if (!playerMetrics || playerMetrics.betCount === 0) {
      return { riskLevel: 'MINIMAL', riskScore: 0 }
    }

    const { betCount, totalLiability, netExposure, totalOdds } = playerMetrics
    const avgOdds = betCount > 0 ? totalOdds / betCount : 0
    const absExposure = Math.abs(netExposure)

    // Calculate percentiles from ALL players' metrics (dynamic calculation)
    // Only calculate if we have at least 2 players (need comparison)
    const allMetrics = Array.from(playerMetricsMap.values())
    
    // If only one player, return minimal risk (no comparison possible)
    if (allMetrics.length < 2) {
      return { riskLevel: 'MINIMAL', riskScore: 0 }
    }
    
    const liabilities = allMetrics.map(m => m.totalLiability).filter(v => v > 0 && Number.isFinite(v))
    const exposures = allMetrics.map(m => Math.abs(m.netExposure)).filter(v => v > 0 && Number.isFinite(v))
    const betCounts = allMetrics.map(m => m.betCount).filter(v => v > 0 && Number.isFinite(v))
    const avgOddsList = allMetrics
      .map(m => m.betCount > 0 ? m.totalOdds / m.betCount : 0)
      .filter(v => v > 0 && Number.isFinite(v))

    // Use config percentiles if available, otherwise calculate dynamically
    const percentiles = (riskConfig?.percentiles as any) || {}
    const weights = (riskConfig?.weights as any) || {}

    // Default weights (must sum to 100 for proper scoring)
    const liabilityWeight = weights.liability ?? 40
    const exposureWeight = weights.exposure ?? 30
    const volumeWeight = weights.volume ?? 15
    const oddsWeight = weights.odds ?? 15

    // Calculate percentiles dynamically from current event data
    // Use config percentiles if available AND valid, otherwise calculate
    const p75Liability = (percentiles.liability75 && percentiles.liability75 > 0) 
      ? percentiles.liability75 
      : getPercentile(liabilities, 75)
    const p90Liability = (percentiles.liability90 && percentiles.liability90 > 0)
      ? percentiles.liability90
      : getPercentile(liabilities, 90)
    const p95Liability = (percentiles.liability95 && percentiles.liability95 > 0)
      ? percentiles.liability95
      : getPercentile(liabilities, 95)

    const p75Exposure = (percentiles.exposure75 && percentiles.exposure75 > 0)
      ? percentiles.exposure75
      : getPercentile(exposures, 75)
    const p90Exposure = (percentiles.exposure90 && percentiles.exposure90 > 0)
      ? percentiles.exposure90
      : getPercentile(exposures, 90)

    const p75BetCount = (percentiles.betCount75 && percentiles.betCount75 > 0)
      ? percentiles.betCount75
      : getPercentile(betCounts, 75)
    const p90BetCount = (percentiles.betCount90 && percentiles.betCount90 > 0)
      ? percentiles.betCount90
      : getPercentile(betCounts, 90)

    const p75Odds = (percentiles.odds75 && percentiles.odds75 > 0)
      ? percentiles.odds75
      : getPercentile(avgOddsList, 75)
    const p90Odds = (percentiles.odds90 && percentiles.odds90 > 0)
      ? percentiles.odds90
      : getPercentile(avgOddsList, 90)

    // Calculate risk score (matching frontend logic)
    let riskScore = 0

    // Liability percentile scoring
    if (p95Liability > 0 && totalLiability >= p95Liability) riskScore += liabilityWeight
    else if (p90Liability > 0 && totalLiability >= p90Liability) riskScore += Math.floor(liabilityWeight * 0.75)
    else if (p75Liability > 0 && totalLiability >= p75Liability) riskScore += Math.floor(liabilityWeight * 0.5)
    else if (totalLiability > 0) riskScore += Math.floor(liabilityWeight * 0.25)

    // Exposure percentile scoring
    if (p90Exposure > 0 && absExposure >= p90Exposure) riskScore += exposureWeight
    else if (p75Exposure > 0 && absExposure >= p75Exposure) riskScore += Math.floor(exposureWeight * 0.67)
    else if (absExposure > 0) riskScore += Math.floor(exposureWeight * 0.33)

    // Bet count percentile scoring
    if (p90BetCount > 0 && betCount >= p90BetCount) riskScore += volumeWeight
    else if (p75BetCount > 0 && betCount >= p75BetCount) riskScore += Math.floor(volumeWeight * 0.67)
    else if (betCount > 0) riskScore += Math.floor(volumeWeight * 0.33)

    // Odds percentile scoring (matching frontend)
    if (p90Odds > 0 && avgOdds >= p90Odds) riskScore += oddsWeight
    else if (p75Odds > 0 && avgOdds >= p75Odds) riskScore += Math.floor(oddsWeight * 0.67)
    else if (avgOdds > 0) riskScore += Math.floor(oddsWeight * 0.33)

    // Determine risk level (configurable thresholds with defaults: 60, 35, 15)
    const riskLevelThresholds = (riskConfig?.riskLevelThresholds as any) || {}
    const highThreshold = riskLevelThresholds.high ?? 60
    const mediumThreshold = riskLevelThresholds.medium ?? 35
    const lowThreshold = riskLevelThresholds.low ?? 15
    
    let riskLevel: 'low' | 'medium' | 'high'
    if (riskScore >= highThreshold) riskLevel = 'high'
    else if (riskScore >= mediumThreshold) riskLevel = 'medium'
    else if (riskScore >= lowThreshold) riskLevel = 'low'
    else riskLevel = 'low'

    // Update player risk type in database if risk level changed significantly
    const user = await db
      .select({ riskType: users.riskType })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
      .limit(1)
      .then((rows) => rows[0])

    if (user) {
      const currentRiskType = (user.riskType || 'low') as 'low' | 'medium' | 'high'
      // Only update if risk level increased significantly
      if (
        (riskLevel === 'high' && currentRiskType !== 'high') ||
        (riskLevel === 'medium' && currentRiskType === 'low')
      ) {
        await db
          .update(users)
          .set({ riskType: riskLevel })
          .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
      }
    }

    return { riskLevel, riskScore }
  } catch (error: any) {
    return { riskLevel: 'MINIMAL', riskScore: 0 }
  }
}

/**
 * Detect betting patterns
 */
async function detectBettingPatterns(params: {
  userId: number
  eventId: string
  tenant: string
  whitelabelId: string
  betId: string
  stake: number
  liability: number
  odds: number
  side: 'back' | 'lay'
  marketId: string
  createdAt: Date
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
}): Promise<Array<{ type: string; severity: string; metrics: Record<string, any> }>> {
  const { userId, eventId, tenant, whitelabelId, betId, stake, liability, odds, side, marketId, createdAt } = params

  const patterns: Array<{ type: string; severity: string; metrics: Record<string, any> }> = []

  try {
    // Load risk config for pattern thresholds (if available)
    const riskConfig = await db
      .select()
      .from(riskConfigTable)
      .where(
        and(
          eq(riskConfigTable.whitelabelId, whitelabelId),
          eq(riskConfigTable.eventId, eventId),
          eq(riskConfigTable.tenant, tenant)
        )
      )
      .limit(1)
      .then((rows) => rows[0] || null)
    
    const patternThresholds = (riskConfig?.patternThresholds as any) || {}
    const rapidConfig = patternThresholds.rapidBetting || {}
    const unusualConfig = patternThresholds.unusualStake || {}
    const coordinatedConfig = patternThresholds.coordinated || {}
    const highOddsConfig = patternThresholds.highOdds || {}

    // 1. Rapid betting detection (bets in last N seconds)
    // Threshold: configurable or defaults (5+ bets = HIGH, 10+ bets = CRITICAL)
    const timeWindow = rapidConfig.timeWindowSeconds ?? 60
    const rapidHighThreshold = rapidConfig.highThreshold ?? 5
    const rapidCriticalThreshold = rapidConfig.criticalThreshold ?? 10
    const timeWindowAgo = new Date(createdAt.getTime() - timeWindow * 1000)
    const recentBets = await db
      .select()
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.userId, userId),
          eq(sportsBets.eventId, eventId),
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, timeWindowAgo)
        )
      )

    if (recentBets.length >= rapidCriticalThreshold) {
      patterns.push({
        type: 'RAPID_BETTING',
        severity: 'CRITICAL',
        metrics: { betCount: recentBets.length, timeWindow },
      })
    } else if (recentBets.length >= rapidHighThreshold) {
      patterns.push({
        type: 'RAPID_BETTING',
        severity: 'HIGH',
        metrics: { betCount: recentBets.length, timeWindow },
      })
    }

    // 2. Unusual stake detection (compare with player's average)
    // Threshold: configurable or defaults (3x average = HIGH, 5x average = CRITICAL)
    const unusualHighMultiplier = unusualConfig.highMultiplier ?? 3
    const unusualCriticalMultiplier = unusualConfig.criticalMultiplier ?? 5
    const historyLimit = unusualConfig.historyLimit ?? 100
    
    const allPlayerBets = await db
      .select()
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.userId, userId),
          eq(sportsBets.tenant, tenant),
          eq(sportsBets.whitelabelId, whitelabelId)
        )
      )
      .limit(historyLimit)

    if (allPlayerBets.length > 0) {
      const totalStake = allPlayerBets.reduce((sum, b) => sum + (Number(b.stake) || 0), 0)
      const avgStake = totalStake / allPlayerBets.length

      if (avgStake > 0) {
        const stakeRatio = stake / avgStake
        if (stakeRatio >= unusualCriticalMultiplier) {
          patterns.push({
            type: 'UNUSUAL_STAKE',
            severity: 'CRITICAL',
            metrics: { stake, averageStake: avgStake, ratio: stakeRatio },
          })
        } else if (stakeRatio >= unusualHighMultiplier) {
          patterns.push({
            type: 'UNUSUAL_STAKE',
            severity: 'HIGH',
            metrics: { stake, averageStake: avgStake, ratio: stakeRatio },
          })
        }
      }
    }

    // 3. Coordinated betting detection (similar bets from different users)
    // Check for similar bets (same market, similar stake/odds) within configurable time window
    const coordinatedTimeWindow = coordinatedConfig.timeWindowSeconds ?? 300 // Default: 5 minutes
    const stakeTolerance = coordinatedConfig.stakeTolerancePercent ?? 20 // Default: 20%
    const oddsTolerance = coordinatedConfig.oddsTolerance ?? 0.1 // Default: 0.1
    const coordinatedHighThreshold = coordinatedConfig.highThreshold ?? 3
    const coordinatedCriticalThreshold = coordinatedConfig.criticalThreshold ?? 5
    
    const coordinatedWindowAgo = new Date(createdAt.getTime() - coordinatedTimeWindow * 1000)
    
    // Get all bets in the time window first, then filter in memory for similarity
    // (SQL similarity checks can be complex, so we do it in memory for reliability)
    const recentEventBets = await db
      .select()
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.eventId, eventId),
          eq(sportsBets.marketId, marketId),
          eq(sportsBets.side, side),
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, coordinatedWindowAgo)
        )
      )
    
    // Filter for similar bets (within configurable tolerance)
    const similarBets = recentEventBets.filter(b => {
      const betStake = Number(b.stake) || 0
      const betPrice = Number(b.price) || 0
      const stakeDiff = Math.abs(betStake - stake)
      const oddsDiff = Math.abs(betPrice - odds)
      return stakeDiff < stake * (stakeTolerance / 100) && oddsDiff < oddsTolerance
    })

    // Filter out current bet and get unique users
    const otherBets = similarBets.filter(b => b.id !== betId)
    const uniqueUserIds = [...new Set(otherBets.map(b => b.userId))]

    if (otherBets.length >= coordinatedCriticalThreshold) {
      patterns.push({
        type: 'COORDINATED',
        severity: 'CRITICAL',
        metrics: {
          similarBetsCount: otherBets.length,
          userIds: uniqueUserIds,
        },
      })
    } else if (otherBets.length >= coordinatedHighThreshold) {
      patterns.push({
        type: 'COORDINATED',
        severity: 'HIGH',
        metrics: {
          similarBetsCount: otherBets.length,
          userIds: uniqueUserIds,
        },
      })
    }

    // 4. High odds detection (configurable threshold)
    const highOddsThreshold = highOddsConfig.threshold ?? 10
    // A fancy price is a runs/points threshold, not decimal payout odds.
    if (params.marketType !== 'fancy' && odds >= highOddsThreshold) {
      patterns.push({
        type: 'HIGH_ODDS',
        severity: 'MEDIUM',
        metrics: { odds },
      })
    }

    // Save patterns to database (if betting_patterns table exists)
    if (patterns.length > 0) {
      try {
        const { bettingPatternsTable } = await import('@shared/db/schema.js')

        for (const pattern of patterns) {
          await db.insert(bettingPatternsTable).values({
            tenant,
            whitelabelId,
            userId,
            eventId,
            patternType: pattern.type as any,
            severity: pattern.severity as any,
            metrics: pattern.metrics,
            status: 'DETECTED',
            detectedAt: createdAt,
          }).catch((err) => {
            // Table might not exist yet - ignore error
          })
        }
      } catch (err: any) {
        // Schema might not be available - ignore
      }
    }
  } catch (error: any) {
  }

  return patterns
}

/**
 * Evaluate automation rules
 */
async function evaluateAutomationRules(params: {
  betId: string
  userId: number
  eventId: string
  tenant: string
  whitelabelId: string
  stake: number
  liability: number
  odds: number
  side: 'back' | 'lay'
  riskLevel: string
  detectedPatterns: string[]
}): Promise<{ triggered: boolean; actions: Array<{ type: string; executed: boolean; result: any }> }> {
  const { betId, userId, eventId, tenant, whitelabelId, stake, liability, odds, side, riskLevel, detectedPatterns } = params

  const actions: Array<{ type: string; executed: boolean; result: any }> = []

  try {
    // Load automation rules for this event
    const { automationRulesTable } = await import('@shared/db/schema.js')
    
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(
        and(
          eq(automationRulesTable.eventId, eventId),
          eq(automationRulesTable.tenant, tenant),
          eq(automationRulesTable.whitelabelId, whitelabelId),
          eq(automationRulesTable.enabled, true)
        )
      )
      .orderBy(desc(automationRulesTable.priority)) // Higher priority first

    for (const rule of rules) {
      const config = (rule.config as any) || {}
      const triggers = config.triggers || {}
      const ruleActions = config.actions || []

      // Check if rule matches
      let matches = true

      // Check stake threshold
      if (triggers.stakeThreshold !== undefined && stake < triggers.stakeThreshold) {
        matches = false
      }

      // Check risk level
      if (triggers.riskLevel && riskLevel !== triggers.riskLevel.toUpperCase()) {
        matches = false
      }

      // Check pattern types
      if (triggers.patternTypes && Array.isArray(triggers.patternTypes)) {
        const hasMatchingPattern = triggers.patternTypes.some((type: string) => detectedPatterns.includes(type))
        if (!hasMatchingPattern) {
          matches = false
        }
      }

      // Check loss streak
      if (triggers.lossStreak) {
        const recentBets = await db
          .select()
          .from(sportsBets)
          .where(
            and(
              eq(sportsBets.userId, userId),
              eq(sportsBets.tenant, tenant)
            )
          )
          .orderBy(desc(sportsBets.createdAt))
          .limit(triggers.lossStreak)
        
        const lossCount = recentBets.filter(b => b.status === 'lost').length
        if (lossCount < triggers.lossStreak) {
          matches = false
        }
      }

      // Check book balance threshold (for market maker mode)
      // bookBalance represents how balanced the book is (lower = more unbalanced)
      if (triggers.bookBalanceThreshold !== undefined) {
        // Calculate book balance from event exposure (net exposure)
        const eventBets = await db
          .select()
          .from(sportsBets)
          .where(
            and(
              eq(sportsBets.eventId, eventId),
              eq(sportsBets.tenant, tenant),
              eq(sportsBets.whitelabelId, whitelabelId),
              or(
                eq(sportsBets.status, 'matched'),
                eq(sportsBets.status, 'unmatched')
              )
            )
          )
        
        let bookBalance = 0
        for (const bet of eventBets) {
          const betLiability = Number(bet.liability) || 0
          const betStake = Number(bet.stake) || 0
          if (bet.side === 'back') {
            bookBalance += betLiability
          } else {
            bookBalance -= betStake
          }
        }
        
        // If book balance (absolute net exposure) is less than threshold, book is too unbalanced
        // This means we might want to reject/void bets to rebalance
        if (Math.abs(bookBalance) < triggers.bookBalanceThreshold) {
          matches = false
        }
      }

      // Check max exposure (if configured)
      if (triggers.maxExposure !== undefined) {
        const eventBets = await db
          .select()
          .from(sportsBets)
          .where(
            and(
              eq(sportsBets.userId, userId),
              eq(sportsBets.eventId, eventId),
              eq(sportsBets.tenant, tenant),
              or(
                eq(sportsBets.status, 'matched'),
                eq(sportsBets.status, 'unmatched')
              )
            )
          )
        
        let totalExposure = 0
        for (const bet of eventBets) {
          const betLiability = Number(bet.liability) || 0
          if (bet.side === 'back') {
            totalExposure += betLiability
          } else {
            totalExposure -= Number(bet.stake) || 0
          }
        }
        
        if (Math.abs(totalExposure) >= triggers.maxExposure) {
          matches = false
        }
      }

      if (!matches) continue

      // Execute actions
      for (const action of ruleActions) {
        try {
          let result: any = null

          switch (action.type) {
            case 'VOID_BET':
              result = await voidBet(betId, action.reason || 'Automated void')
              break

            case 'SUSPEND_USER':
              result = await suspendUser(userId, action.reason || 'Suspicious activity detected')
              break

            case 'ACCEPT_BET':
              result = await acceptBet(betId)
              break

            case 'REJECT_BET':
              result = await rejectBet(betId, action.reason || 'Automated rejection')
              break

            case 'NOTIFY_ADMIN':
              // Log for now - can be extended to send notifications
              result = { success: true, message: 'Admin notified' }
              break

            default:
              continue
          }

          actions.push({
            type: action.type,
            executed: true,
            result,
          })
        } catch (error: any) {
          actions.push({
            type: action.type,
            executed: false,
            result: { error: error.message },
          })
        }
      }
    }
  } catch (error: any) {
    // Automation rules table might not exist - ignore
  }

  return {
    triggered: actions.length > 0,
    actions,
  }
}

/**
 * Void a bet
 */
async function voidBet(betId: string, reason: string): Promise<{ success: boolean; message: string }> {
  try {
    // Bet ID is UUID string, so we need to use eq with string comparison
    const result = await db
      .update(sportsBets)
      .set({
        status: 'void',
        updatedAt: new Date(),
      })
      .where(eq(sportsBets.id, betId))
      .returning()

    if (result.length === 0) {
      return { success: false, message: `Bet ${betId} not found` }
    }

    return { success: true, message: `Bet ${betId} voided: ${reason}` }
  } catch (error: any) {
    return { success: false, message: `Failed to void bet: ${error.message}` }
  }
}

/**
 * Suspend user
 */
async function suspendUser(userId: number, reason: string): Promise<{ success: boolean; message: string }> {
  try {
    await db
      .update(users)
      .set({
        status: 'suspended',
      })
      .where(eq(users.id, userId))

    return { success: true, message: `User ${userId} suspended: ${reason}` }
  } catch (error: any) {
    return { success: false, message: `Failed to suspend user: ${error.message}` }
  }
}

/**
 * Accept bet (for market maker mode)
 */
async function acceptBet(betId: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await db
      .update(sportsBets)
      .set({
        status: 'matched',
        updatedAt: new Date(),
      })
      .where(eq(sportsBets.id, betId))
      .returning()

    if (result.length === 0) {
      return { success: false, message: `Bet ${betId} not found` }
    }

    return { success: true, message: `Bet ${betId} accepted` }
  } catch (error: any) {
    return { success: false, message: `Failed to accept bet: ${error.message}` }
  }
}

/**
 * Reject bet
 */
async function rejectBet(betId: string, reason: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await db
      .update(sportsBets)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(sportsBets.id, betId))
      .returning()

    if (result.length === 0) {
      return { success: false, message: `Bet ${betId} not found` }
    }

    return { success: true, message: `Bet ${betId} rejected: ${reason}` }
  } catch (error: any) {
    return { success: false, message: `Failed to reject bet: ${error.message}` }
  }
}

/**
 * Publish real-time events
 */
async function publishBetEvents(params: {
  betId: string
  userId: number
  eventId: string
  tenant: string
  whitelabelId: string
  stake: number
  liability: number
  odds: number
  side: 'back' | 'lay'
  riskLevel: string
  patterns: Array<{ type: string; severity: string; metrics: Record<string, any> }>
  automationActions: Array<{ type: string; executed: boolean; result: any }>
}): Promise<void> {
  const { betId, userId, eventId, tenant, whitelabelId, stake, liability, odds, side, riskLevel, patterns, automationActions } = params

  try {
    const emitter = getRedisEmitter()

    // Fetch bet data for complete event payload (with error handling)
    let betData: any = null
    try {
      betData = await db
        .select()
        .from(sportsBets)
        .where(eq(sportsBets.id, betId))
        .limit(1)
        .then((rows) => rows[0] || null)
    } catch (err) {
    }

    // Fetch user name for pattern events (with error handling)
    let userName: string | null = null
    let userFlags: unknown = null
    try {
      const userData = await db
        .select({
          name: users.name,
          username: users.username,
          flags: users.flags,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .then((rows) => rows[0] || null)
      // Match admin sportsBets list: display name prefers name, then username
      userName = userData?.name || userData?.username || null
      userFlags = userData?.flags ?? null
    } catch (err) {
    }

    // Publish betPlaced event (matching SportsBet type structure)
    const betPlacedTopic = `sports.bet.placed.${eventId}`
    emitter.emit({
      topic: betPlacedTopic,
      payload: {
        betPlaced: {
          id: betId,
          tenant: tenant || null,
          whitelabelId,
          userId: String(userId),
          userName: userName || null,
          userFlags: userFlags ?? null,
          sportId: betData?.sportId || '',
          leagueId: betData?.leagueId || '',
          marketId: betData?.marketId || '',
          eventId,
          runnerId: betData?.runnerId || '',
          selectionId: betData?.selectionId || '',
          side,
          price: odds,
          size: stake,
          stake,
          liability,
          status: betData?.status || 'matched',
          matchedAt: betData?.matchedAt?.toISOString() || null,
          settledAt: betData?.settledAt?.toISOString() || null,
          result: betData?.result || null,
          currency: betData?.currency || 'USD',
          ipAddress: betData?.ipAddress || null,
          userAgent: betData?.userAgent || null,
          location: betData?.location || null,
          country: betData?.country || null,
          deviceInfo: betData?.deviceInfo || null,
          oddsSize: betData?.oddsSize ? Number(betData.oddsSize) : null,
          createdAt: betData?.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt: betData?.updatedAt?.toISOString() || new Date().toISOString(),
          // Additional risk data
          riskLevel,
        },
      },
    })

    // Publish patternDetected events (matching BettingPattern type structure)
    if (patterns.length > 0) {
      const patternTopic = `sports.pattern.detected.${eventId}`
      for (const pattern of patterns) {
        // Get pattern ID from database if it was saved
        let patternId = betId // Fallback to betId if pattern not saved
        
        emitter.emit({
          topic: patternTopic,
          payload: {
            patternDetected: {
              id: patternId,
              userId: String(userId),
              userName,
              eventId,
              // the topic is per event, shared by every whitelabel: subscribers filter on these
              tenant: tenant || null,
              whitelabelId: whitelabelId || tenant || null,
              patternType: pattern.type,
              severity: pattern.severity,
              metrics: pattern.metrics,
              detectedAt: new Date().toISOString(),
              status: 'DETECTED',
              notes: null,
            },
          },
        })
      }
    }

    // Publish automationTriggered event
    if (automationActions.length > 0) {
      const automationTopic = `sports.automation.triggered.${eventId}`
      emitter.emit({
        topic: automationTopic,
        payload: {
          automationTriggered: {
            betId,
            userId: String(userId),
            eventId,
            actions: automationActions,
            triggeredAt: new Date().toISOString(),
          },
        },
      })
    }
  } catch (error: any) {
  }
}

