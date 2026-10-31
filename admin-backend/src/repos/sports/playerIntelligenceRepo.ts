import { sportsGrossReturnSql, sportsPlayerProfitSql } from '@src/shared/reportingSql.js'
import { db } from '@src/db/client.js'
import { sportsBets, sportsMarketsTable } from '@shared/db/schema.js'
import { users, referralAttributions } from '@shared/db/schema.js'
import { eq, and, gte, lte, desc, sql, count, avg, sum, max, min, ne, inArray } from 'drizzle-orm'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'

export interface PlayerStatistics {
  totalBets: number
  totalStake: number
  totalWinnings: number
  netProfit: number
  winRate: number
  averageStake: number
  averageOdds: number
  roi: number
  largestWin: number
  largestLoss: number
  favoriteMarketType: string | null
  bettingFrequency: string
  riskScore: number
}

export interface StakeRange {
  min: number
  max: number
  median: number
}

export interface OddsRange {
  min: number
  max: number
  median: number
}

export interface MarketPreference {
  marketType: string
  percentage: number
  totalBets: number
}

export interface StreakBehavior {
  chasingLosses: boolean
  stopAfterWin: boolean
  averageStreakLength: number
}

export interface PlayerBettingPattern {
  peakBettingHours: number[]
  averageSessionDuration: number
  typicalStakeRange: StakeRange
  marketPreferences: MarketPreference[]
  oddsRange: OddsRange
  bettingSidePreference: string
  streakBehavior: StreakBehavior
}

export interface PlayerDevice {
  ipAddress: string
  userAgent: string | null
  location: string | null
  country: string | null
  firstUsed: Date
  lastUsed: Date
  betCount: number
}

export interface RelatedPlayer {
  userId: number
  userName: string
  relationshipType: string
  confidence: number
  sharedAttributes: string[]
}

export interface PlayerAgentChain {
  level: number
  agentId: string
  agentName: string
  commissionRate: number | null
  creditLimit: number | null
  creditUsed: number | null
}

/**
 * Get player betting history with filters
 */
export async function getPlayerBettingHistory(
  userId: number,
  filters: {
    tenant?: string
    whitelabelId?: string
    eventId?: string
    dateFrom?: string
    dateTo?: string
    status?: string
    limit?: number
    offset?: number
  }
): Promise<any[]> {
  const conditions = [eq(sportsBets.userId, userId)]
  
  if (filters.tenant) {
    conditions.push(eq(sportsBets.tenant, filters.tenant))
  }
  if (filters.whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, filters.whitelabelId))
  }
  if (filters.eventId) {
    conditions.push(eq(sportsBets.eventId, filters.eventId))
  }
  if (filters.dateFrom || filters.dateTo) {
    const tz = await getWhitelabelTimezone(filters.tenant || 'default')
    if (filters.dateFrom) {
      conditions.push(gte(sportsBets.createdAt, parseDateFrom(filters.dateFrom, tz)))
    }
    if (filters.dateTo) {
      conditions.push(lte(sportsBets.createdAt, parseDateTo(filters.dateTo, tz)))
    }
  }
  if (filters.status) {
    conditions.push(eq(sportsBets.status, filters.status as any))
  }
  
  const bets = await db
    .select()
    .from(sportsBets)
    .where(and(...conditions))
    .orderBy(desc(sportsBets.createdAt))
    .limit(filters.limit || 100)
    .offset(filters.offset || 0)
  
  return bets
}

/**
 * Get comprehensive player statistics
 */
export async function getPlayerStatistics(
  userId: number,
  tenant: string = 'default',
  whitelabelId?: string
): Promise<PlayerStatistics> {
  const conditions = [
    eq(sportsBets.userId, userId),
    eq(sportsBets.tenant, tenant),
  ]
  
  if (whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, whitelabelId))
  }
  
  // Get aggregated statistics
  const stats = await db
    .select({
      totalBets: count(),
      totalStake: sum(sql`CAST(${sportsBets.stake} AS NUMERIC)`),
      totalWinnings: sum(sql.raw(sportsGrossReturnSql('sports_bets'))),
      settledProfit: sum(sql.raw(sportsPlayerProfitSql('sports_bets'))),
      settledRisk: sum(sql`CASE WHEN ${sportsBets.status}::text IN ('won','lost','settled') THEN ${sportsBets.liability}::numeric ELSE 0 END`),
      settledCount: count(sql`CASE WHEN ${sportsBets.status}::text IN ('won','lost','settled') THEN 1 END`),
      averageStake: avg(sql`CAST(${sportsBets.stake} AS NUMERIC)`),
      averageOdds: avg(sql`CAST(${sportsBets.price} AS NUMERIC)`),
      largestWin: max(sql.raw(sportsGrossReturnSql('sports_bets'))),
      largestLoss: max(sql`GREATEST(0, -(${sql.raw(sportsPlayerProfitSql('sports_bets'))}))`),
      winCount: count(sql`CASE WHEN ${sportsBets.status} = 'won' THEN 1 END`),
    })
    .from(sportsBets)
    .where(and(...conditions))
  
  const result = stats[0]
  const totalBets = Number(result.totalBets) || 0
  const totalStake = Number(result.totalStake) || 0
  const totalWinnings = Number(result.totalWinnings) || 0
  const winCount = Number(result.winCount) || 0
  const averageStake = Number(result.averageStake) || 0
  const averageOdds = Number(result.averageOdds) || 0
  const largestWin = Number(result.largestWin) || 0
  const largestLoss = Number(result.largestLoss) || 0
  
  const netProfit = Number(result.settledProfit) || 0
  const settledCount = Number(result.settledCount) || 0
  const settledRisk = Number(result.settledRisk) || 0
  const winRate = settledCount > 0 ? (winCount / settledCount) * 100 : 0
  const roi = settledRisk > 0 ? (netProfit / settledRisk) * 100 : 0
  
  // Get favorite market type (join with markets table to get type)
  const marketTypes = await db
    .select({
      marketType: sportsMarketsTable.type,
      count: count(),
    })
    .from(sportsBets)
    .innerJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
    .where(and(...conditions))
    .groupBy(sportsMarketsTable.type)
    .orderBy(desc(count()))
    .limit(1)
  
  const favoriteMarketType = marketTypes[0]?.marketType || null
  
  // Calculate betting frequency (bets per day on average)
  const firstBet = await db
    .select({ createdAt: sportsBets.createdAt })
    .from(sportsBets)
    .where(and(...conditions))
    .orderBy(sportsBets.createdAt)
    .limit(1)
  
  const lastBet = await db
    .select({ createdAt: sportsBets.createdAt })
    .from(sportsBets)
    .where(and(...conditions))
    .orderBy(desc(sportsBets.createdAt))
    .limit(1)
  
  let bettingFrequency = 'N/A'
  if (firstBet[0] && lastBet[0]) {
    const daysDiff = (lastBet[0].createdAt.getTime() - firstBet[0].createdAt.getTime()) / (1000 * 60 * 60 * 24)
    if (daysDiff > 0) {
      const betsPerDay = totalBets / daysDiff
      bettingFrequency = `${betsPerDay.toFixed(2)} bets/day`
    }
  }
  
  // Calculate risk score (0-100) based on various factors
  const riskScore = calculateRiskScore({
    totalBets,
    averageStake,
    winRate,
    largestWin,
    netProfit,
  })
  
  return {
    totalBets,
    totalStake,
    totalWinnings,
    netProfit,
    winRate,
    averageStake,
    averageOdds,
    roi,
    largestWin,
    largestLoss,
    favoriteMarketType,
    bettingFrequency,
    riskScore,
  }
}

/**
 * Calculate risk score (0-100)
 */
function calculateRiskScore(factors: {
  totalBets: number
  averageStake: number
  winRate: number
  largestWin: number
  netProfit: number
}): number {
  let score = 0
  
  // High bet volume increases risk
  if (factors.totalBets > 1000) score += 20
  else if (factors.totalBets > 500) score += 10
  
  // High average stake increases risk
  if (factors.averageStake > 10000) score += 25
  else if (factors.averageStake > 5000) score += 15
  else if (factors.averageStake > 1000) score += 5
  
  // Very high win rate (potential arbitrage) increases risk
  if (factors.winRate > 70) score += 20
  else if (factors.winRate > 60) score += 10
  
  // Large wins increase risk
  if (factors.largestWin > 100000) score += 15
  else if (factors.largestWin > 50000) score += 10
  
  // Negative net profit (player winning) increases risk
  if (factors.netProfit < -50000) score += 20
  else if (factors.netProfit < -20000) score += 10
  
  return Math.min(100, score)
}

/**
 * Get player betting patterns
 */
export async function getPlayerBettingPatterns(
  userId: number,
  tenant: string = 'default',
  whitelabelId?: string
): Promise<PlayerBettingPattern> {
  const conditions = [
    eq(sportsBets.userId, userId),
    eq(sportsBets.tenant, tenant),
  ]
  
  if (whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, whitelabelId))
  }
  
  // Get all bets for analysis (join with markets to get market type)
  const allBets = await db
    .select({
      createdAt: sportsBets.createdAt,
      stake: sql<number>`CAST(${sportsBets.stake} AS NUMERIC)`,
      price: sql<number>`CAST(${sportsBets.price} AS NUMERIC)`,
      side: sportsBets.side,
      marketId: sportsBets.marketId,
      marketType: sportsMarketsTable.type,
      status: sportsBets.status,
    })
    .from(sportsBets)
    .innerJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
    .where(and(...conditions))
  
  // Peak betting hours (0-23)
  const hourCounts = new Map<number, number>()
  allBets.forEach(bet => {
    const hour = bet.createdAt.getHours()
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1)
  })
  const peakBettingHours = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => hour)
  
  // Average session duration (simplified: time between first and last bet per day, grouped by calendar day in tenant TZ)
  const { formatDateInTz } = await import('@src/shared/dateUtils.js')
  const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
  const tz = await getWhitelabelTimezone(tenant)
  const sessionsByDay = new Map<string, { first: Date; last: Date }>()
  allBets.forEach(bet => {
    const dayKey = formatDateInTz(bet.createdAt, tz)
    const session = sessionsByDay.get(dayKey) || { first: bet.createdAt, last: bet.createdAt }
    if (bet.createdAt < session.first) session.first = bet.createdAt
    if (bet.createdAt > session.last) session.last = bet.createdAt
    sessionsByDay.set(dayKey, session)
  })
  
  const sessionDurations = Array.from(sessionsByDay.values()).map(s => 
    (s.last.getTime() - s.first.getTime()) / (1000 * 60) // minutes
  )
  const averageSessionDuration = sessionDurations.length > 0
    ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
    : 0
  
  // Typical stake range
  const stakes = allBets.map(b => b.stake).sort((a, b) => a - b)
  const typicalStakeRange: StakeRange = {
    min: stakes[0] || 0,
    max: stakes[stakes.length - 1] || 0,
    median: stakes.length > 0 ? stakes[Math.floor(stakes.length / 2)] : 0,
  }
  
  // Market preferences (using market type from joined table)
  const marketCounts = new Map<string, number>()
  allBets.forEach(bet => {
    const marketType = bet.marketType || 'unknown'
    marketCounts.set(marketType, (marketCounts.get(marketType) || 0) + 1)
  })
  
  const totalBets = allBets.length
  const marketPreferences: MarketPreference[] = Array.from(marketCounts.entries())
    .map(([marketType, count]) => ({
      marketType,
      percentage: (count / totalBets) * 100,
      totalBets: count,
    }))
    .sort((a, b) => b.totalBets - a.totalBets)
    .slice(0, 5)
  
  // Odds range
  const odds = allBets.map(b => b.price).filter(o => o > 0).sort((a, b) => a - b)
  const oddsRange: OddsRange = {
    min: odds[0] || 0,
    max: odds[odds.length - 1] || 0,
    median: odds.length > 0 ? odds[Math.floor(odds.length / 2)] : 0,
  }
  
  // Betting side preference
  const backCount = allBets.filter(b => b.side === 'back').length
  const layCount = allBets.filter(b => b.side === 'lay').length
  const bettingSidePreference = backCount > layCount ? 'back' : layCount > backCount ? 'lay' : 'balanced'
  
  // Streak behavior
  let currentStreak = 0
  let maxStreak = 0
  let lastStatus: string | null = null
  let chasingLosses = false
  let stopAfterWin = false
  
  allBets.forEach(bet => {
    if (bet.status === 'lost') {
      if (lastStatus === 'lost') {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 1
      }
      chasingLosses = true
    } else if (bet.status === 'won') {
      if (lastStatus === 'won') {
        stopAfterWin = true
      }
      currentStreak = 0
    }
    lastStatus = bet.status
  })
  
  const streakBehavior: StreakBehavior = {
    chasingLosses,
    stopAfterWin,
    averageStreakLength: maxStreak,
  }
  
  return {
    peakBettingHours,
    averageSessionDuration,
    typicalStakeRange,
    marketPreferences,
    oddsRange,
    bettingSidePreference,
    streakBehavior,
  }
}

/**
 * Get player risk profile
 */
export async function getPlayerRiskProfile(
  userId: number,
  tenant: string = 'default',
  whitelabelId?: string
): Promise<{
  riskLevel: string
  flags: string[]
  manualFlags: string[]
  patternFlags: string[]
  patterns: any[]
  suspiciousActivityCount: number
  lastReviewedAt: Date | null
  notes: string | null
}> {
  // Get user's risk type and flags
  const user = await db
    .select({ riskType: users.riskType, flags: users.flags })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  
  const riskLevel = user[0]?.riskType || 'UNKNOWN'
  
  // Get manual flags from user record
  const manualFlags: Array<{ flag: string; reason: string; setBy: string; setAt: string }> = 
    (user[0]?.flags as any) || [];
  const manualFlagNames = manualFlags.map(f => f.flag);
  
  // Get detected patterns
  const { getBettingPatterns } = await import('./bettingPatternsRepo.js')
  const patterns = await getBettingPatterns({
    userId,
    tenant,
    whitelabelId,
    status: 'DETECTED',
  }) || []
  
  // Extract pattern-based flags
  const patternFlags = [...new Set((patterns || []).map(p => p.patternType))]
  
  // Combine manual flags and pattern flags (remove duplicates)
  const allFlags = [...new Set([...manualFlagNames, ...patternFlags])]
  
  const suspiciousActivityCount = patterns.filter(p => 
    p.severity === 'HIGH' || p.severity === 'CRITICAL'
  ).length
  
  // Get review tracking and notes from patterns (using most recent pattern's notes as risk profile notes)
  const mostRecentPattern = patterns
    .filter(p => p.notes)
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())[0];
  
  const notes = mostRecentPattern?.notes || null;
  
  // Use most recent pattern's detectedAt as lastReviewedAt (or could be stored separately)
  const lastReviewedAt = patterns.length > 0
    ? patterns
        .map(p => new Date(p.detectedAt))
        .sort((a, b) => b.getTime() - a.getTime())[0]
    : null;
  
  return {
    riskLevel: riskLevel.toUpperCase(),
    flags: allFlags, // Combined for backward compatibility
    manualFlags: manualFlagNames, // Manual flags only (removable)
    patternFlags: patternFlags, // Pattern-based flags (not directly removable)
    patterns,
    suspiciousActivityCount,
    lastReviewedAt,
    notes,
  }
}

/**
 * Get player devices
 */
export async function getPlayerDevices(
  userId: number,
  tenant: string = 'default'
): Promise<PlayerDevice[]> {
  const devices = await db
    .select({
      ipAddress: sportsBets.ipAddress,
      userAgent: sportsBets.userAgent,
      location: sportsBets.location,
      country: sportsBets.country,
      createdAt: sportsBets.createdAt,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.userId, userId),
        eq(sportsBets.tenant, tenant)
      )
    )
    .orderBy(desc(sportsBets.createdAt))
  
  // Group by IP address
  const deviceMap = new Map<string, PlayerDevice>()
  
  devices.forEach(device => {
    if (!device.ipAddress) return
    
    const existing = deviceMap.get(device.ipAddress)
    if (existing) {
      existing.betCount++
      if (device.createdAt < existing.firstUsed) {
        existing.firstUsed = device.createdAt
      }
      if (device.createdAt > existing.lastUsed) {
        existing.lastUsed = device.createdAt
      }
    } else {
      deviceMap.set(device.ipAddress, {
        ipAddress: device.ipAddress,
        userAgent: device.userAgent || null,
        location: device.location || null,
        country: device.country || null,
        firstUsed: device.createdAt,
        lastUsed: device.createdAt,
        betCount: 1,
      })
    }
  })
  
  return Array.from(deviceMap.values())
}

/**
 * Get related players
 */
export async function getRelatedPlayers(
  userId: number,
  tenant: string = 'default'
): Promise<RelatedPlayer[]> {
  // Get current user's devices
  const userDevices = await getPlayerDevices(userId, tenant)
  const userIPs = userDevices
    .map(d => d.ipAddress)
    .filter((ip): ip is string => Boolean(ip) && typeof ip === 'string' && ip.length > 0)
  
  if (userIPs.length === 0) {
    return []
  }
  
  // Find other users with same IPs
  const relatedBets = await db
    .selectDistinct({
      userId: sportsBets.userId,
      ipAddress: sportsBets.ipAddress,
    })
    .from(sportsBets)
    .where(
      and(
        inArray(sportsBets.ipAddress, userIPs),
        eq(sportsBets.tenant, tenant),
        ne(sportsBets.userId, userId)
      )
    )
    .limit(50)
  
  // Get user names
  const relatedUserIds = [...new Set(relatedBets.map(b => b.userId).filter(id => id != null && id !== undefined && !isNaN(Number(id))).map(id => Number(id)))]
  let userMap = new Map();
  if (relatedUserIds.length > 0) {
    const relatedUsers = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .where(inArray(users.id, relatedUserIds))
    
    userMap = new Map(relatedUsers.map(u => [u.id, u]))
  }
  
  return relatedBets.map(bet => {
    const user = userMap.get(bet.userId)
    return {
      userId: bet.userId,
      userName: user?.name || user?.username || `User ${bet.userId}`,
      relationshipType: 'SHARED_IP',
      confidence: 0.7,
      sharedAttributes: [bet.ipAddress || ''],
    }
  })
}

/**
 * Get player agent chain
 */
export async function getPlayerAgentChain(
  userId: number,
  tenant: string = 'default'
): Promise<PlayerAgentChain[]> {
  try {
    const { referralAttributions } = await import('@shared/db/schema.js');
    const { users } = await import('@shared/db/schema.js');
    const { eq, and, desc } = await import('drizzle-orm');
    
    // Get referral attribution for this player
    const attribution = await db
      .select()
      .from(referralAttributions)
      .where(
        and(
          eq(referralAttributions.refereeId, userId),
          eq(referralAttributions.tenant, tenant),
          eq(referralAttributions.status, 'confirmed')
        )
      )
      .orderBy(desc(referralAttributions.attributedAt))
      .limit(1);
    
    if (attribution.length === 0) {
      return []; // No agent chain if no attribution
    }
    
    const chain: PlayerAgentChain[] = [];
    let currentReferrerId = attribution[0].referrerId;
    let level = 1;
    const maxDepth = 5; // Prevent infinite loops
    
    // Build chain by following referrer relationships
    while (currentReferrerId && level <= maxDepth) {
      // Get referrer user info
      const referrerUser = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
        })
        .from(users)
        .where(eq(users.id, currentReferrerId))
        .limit(1);
      
      if (referrerUser.length === 0) {
        break; // Referrer not found, stop chain
      }
      
      const user = referrerUser[0];
      
      // Check if this user is an agent (this would require checking agentCredentials or a mapping)
      // For now, we'll include all referrers in the chain
      chain.push({
        level,
        agentId: String(user.id),
        agentName: user.name || user.username || `User ${user.id}`,
        commissionRate: null, // Would need to fetch from agent settings
        creditLimit: null, // Would need to fetch from agent settings
        creditUsed: null, // Would need to fetch from agent settings
      });
      
      // Get next level referrer (if this referrer was also referred by someone)
      const nextAttribution = await db
        .select()
        .from(referralAttributions)
        .where(
          and(
            eq(referralAttributions.refereeId, currentReferrerId),
            eq(referralAttributions.tenant, tenant),
            eq(referralAttributions.status, 'confirmed')
          )
        )
        .limit(1);
      
      if (nextAttribution.length === 0) {
        break; // No more levels
      }
      
      currentReferrerId = nextAttribution[0].referrerId;
      level++;
    }
    
    return chain;
  } catch (error: any) {
    return []; // Return empty array on error
  }
}

/**
 * Update player flags
 * Flags are stored as betting patterns with patternType matching the flag name
 */
export async function updatePlayerFlags(
  userId: number,
  flags: string[],
  tenant: string = 'default'
): Promise<void> {
  try {
    const { saveBettingPattern } = await import('./bettingPatternsRepo.js');
    const whitelabelId = 'default'; // Would need to be passed as parameter
    
    // For each flag, create or update a betting pattern to track it
    // This allows flags to be tracked alongside other patterns
    for (const flag of flags) {
      // Check if pattern already exists for this flag
      const { getBettingPatterns } = await import('./bettingPatternsRepo.js');
      const existingPatterns = await getBettingPatterns({
        userId,
        tenant,
        whitelabelId,
        patternType: flag as any, // Cast to pattern type
        status: 'DETECTED',
      });
      
      // If no pattern exists, create one
      if (existingPatterns.length === 0) {
        await saveBettingPattern({
          whitelabelId,
          userId,
          patternType: flag as any,
          severity: 'MEDIUM', // Flags are typically medium severity
          metrics: { flag: true, setAt: new Date().toISOString() },
          status: 'DETECTED',
          notes: `Flag set: ${flag}`,
        });
      }
    }
  } catch (error: any) {
    // Don't throw - flags are informational
  }
}

