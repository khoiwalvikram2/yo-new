import { db } from '@src/db/client.js'
import { bettingPatternsTable } from '@shared/db/schema.js'
import { sportsBets } from '@shared/db/schema.js'
import { eq, and, gte, lte, desc, inArray, or, sql } from 'drizzle-orm'

export type BettingPatternType = 
  | 'RAPID_BETTING'
  | 'MULTI_ACCOUNT'
  | 'COORDINATED'
  | 'UNUSUAL_STAKE'
  | 'ODD_TIMING'
  | 'AGENT_COLLUSION'

export type PatternSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type PatternStatus = 'DETECTED' | 'INVESTIGATING' | 'CONFIRMED' | 'DISMISSED'

export interface BettingPattern {
  id: string
  tenant: string
  whitelabelId: string
  userId: number
  eventId: string | null
  patternType: BettingPatternType
  severity: PatternSeverity
  metrics: Record<string, any> | null
  status: PatternStatus
  notes: string | null
  detectedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface BettingPatternFilters {
  userId?: number
  eventId?: string
  patternType?: BettingPatternType
  severity?: PatternSeverity
  status?: PatternStatus
  tenant?: string
  whitelabelId?: string
  limit?: number
  offset?: number
}

/**
 * Get bets within a time window for a user and event
 */
export async function getBetsInTimeWindow(
  userId: number,
  eventId: string,
  timeWindowSeconds: number,
  tenant: string = 'default'
): Promise<any[]> {
  const cutoffTime = new Date(Date.now() - timeWindowSeconds * 1000)
  
  const bets = await db
    .select()
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.userId, userId),
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.tenant, tenant),
        gte(sportsBets.createdAt, cutoffTime)
      )
    )
    .orderBy(desc(sportsBets.createdAt))
  
  return bets
}

/**
 * Detect rapid betting pattern
 */
export async function detectRapidBetting(
  userId: number,
  eventId: string,
  timeWindow: number = 60,
  tenant: string = 'default'
): Promise<{ detected: boolean; betCount: number; timeWindow: number }> {
  const bets = await getBetsInTimeWindow(userId, eventId, timeWindow, tenant)
  
  return {
    detected: bets.length >= 5,
    betCount: bets.length,
    timeWindow,
  }
}

/**
 * Get similar bets within time window (for coordinated betting detection)
 */
export async function getSimilarBetsInTimeWindow(
  bet: any,
  timeWindowSeconds: number,
  tenant: string = 'default'
): Promise<any[]> {
  const cutoffTime = new Date(Date.now() - timeWindowSeconds * 1000)
  
  // Find bets with similar characteristics (same market, similar stake, similar odds)
  const similarBets = await db
    .select()
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.eventId, bet.eventId),
        eq(sportsBets.marketId, bet.marketId),
        eq(sportsBets.selectionId, bet.selectionId),
        eq(sportsBets.side, bet.side),
        eq(sportsBets.tenant, tenant),
        gte(sportsBets.createdAt, cutoffTime),
        sql`ABS(CAST(${sportsBets.stake} AS NUMERIC) - CAST(${bet.stake} AS NUMERIC)) < CAST(${bet.stake} AS NUMERIC) * 0.2`, // Within 20% of stake
        sql`ABS(CAST(${sportsBets.price} AS NUMERIC) - CAST(${bet.price} AS NUMERIC)) < 0.1` // Within 0.1 of odds
      )
    )
    .orderBy(desc(sportsBets.createdAt))
  
  return similarBets
}

/**
 * Detect coordinated betting pattern
 */
export async function detectCoordinatedBetting(
  bet: any,
  timeWindow: number = 300,
  tenant: string = 'default'
): Promise<{ detected: boolean; similarBetsCount: number; userIds: number[] }> {
  const similarBets = await getSimilarBetsInTimeWindow(bet, timeWindow, tenant)
  
  // Filter out the current bet
  const otherBets = similarBets.filter(b => b.id !== bet.id)
  
  return {
    detected: otherBets.length >= 3,
    similarBetsCount: otherBets.length,
    userIds: otherBets.map(b => b.userId),
  }
}

/**
 * Detect unusual stake pattern
 */
export async function detectUnusualStakes(
  userId: number,
  eventId: string,
  currentStake: number,
  userAverageStake: number,
  tenant: string = 'default'
): Promise<{ detected: boolean; stakeRatio: number; severity: PatternSeverity | null }> {
  if (userAverageStake <= 0) {
    return { detected: false, stakeRatio: 0, severity: null }
  }
  
  const stakeRatio = currentStake / userAverageStake
  
  let detected = false
  let severity: PatternSeverity | null = null
  
  if (stakeRatio >= 10) {
    detected = true
    severity = 'CRITICAL'
  } else if (stakeRatio >= 5) {
    detected = true
    severity = 'HIGH'
  }
  
  return { detected, stakeRatio, severity }
}

/**
 * Get related players (same IP, device, etc.)
 */
export async function getRelatedPlayers(
  userId: number,
  tenant: string = 'default'
): Promise<Array<{ userId: number; relationshipType: string; confidence: number }>> {
  // Get current user's IP and device info
  const userBets = await db
    .select({
      ipAddress: sportsBets.ipAddress,
      userAgent: sportsBets.userAgent,
      deviceInfo: sportsBets.deviceInfo,
    })
    .from(sportsBets)
    .where(
      and(
        eq(sportsBets.userId, userId),
        eq(sportsBets.tenant, tenant)
      )
    )
    .limit(10)
  
  if (userBets.length === 0) {
    return []
  }
  
  // Find other users with same IP or device
  const ipAddresses = [...new Set(userBets.map(b => b.ipAddress).filter(Boolean))]
  const userAgents = [...new Set(userBets.map(b => b.userAgent).filter(Boolean))]
  
  const conditions = []
  if (ipAddresses.length > 0) {
    const filteredIps = ipAddresses.filter((ip): ip is string => ip !== null)
    if (filteredIps.length > 0) {
      conditions.push(inArray(sportsBets.ipAddress, filteredIps))
    }
  }
  if (userAgents.length > 0) {
    const filteredAgents = userAgents.filter((ua): ua is string => ua !== null)
    if (filteredAgents.length > 0) {
      conditions.push(inArray(sportsBets.userAgent, filteredAgents))
    }
  }
  
  if (conditions.length === 0) {
    return []
  }
  
  const relatedBets = await db
    .selectDistinct({
      userId: sportsBets.userId,
    })
    .from(sportsBets)
    .where(
      and(
        or(...conditions),
        eq(sportsBets.tenant, tenant),
        sql`${sportsBets.userId} != ${userId}`
      )
    )
    .limit(50)
  
  return relatedBets.map(b => ({
    userId: b.userId,
    relationshipType: 'SHARED_DEVICE',
    confidence: 0.7, // Medium confidence
  }))
}

/**
 * Detect multi-account pattern
 */
export async function detectMultiAccountPatternForUser(
  userId: number,
  eventId: string,
  tenant: string = 'default'
): Promise<{ detected: boolean; relatedAccounts: number; relatedBets: number }> {
  const relatedPlayers = await getRelatedPlayers(userId, tenant)
  
  if (relatedPlayers.length === 0) {
    return { detected: false, relatedAccounts: 0, relatedBets: 0 }
  }
  
  // Get bets from related players for this event
  const relatedUserIds = relatedPlayers.map(p => p.userId)
  const relatedBets = await db
    .select()
    .from(sportsBets)
    .where(
      and(
        inArray(sportsBets.userId, relatedUserIds),
        eq(sportsBets.eventId, eventId),
        eq(sportsBets.tenant, tenant)
      )
    )
  
  return {
    detected: relatedBets.length >= 2,
    relatedAccounts: relatedPlayers.length,
    relatedBets: relatedBets.length,
  }
}

/**
 * Save betting pattern
 */
export async function saveBettingPattern(
  pattern: {
    tenant?: string
    whitelabelId: string
    userId: number
    eventId?: string | null
    patternType: BettingPatternType
    severity: PatternSeverity
    metrics?: Record<string, any>
    status?: PatternStatus
    notes?: string | null
  }
): Promise<BettingPattern> {
  const tenant = pattern.tenant || 'default'
  const now = new Date()
  
  const [inserted] = await db
    .insert(bettingPatternsTable)
    .values({
      tenant,
      whitelabelId: pattern.whitelabelId,
      userId: pattern.userId,
      eventId: pattern.eventId || null,
      patternType: pattern.patternType,
      severity: pattern.severity,
      metrics: pattern.metrics || null,
      status: pattern.status || 'DETECTED',
      notes: pattern.notes || null,
      detectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  
  return {
    id: inserted.id,
    tenant: inserted.tenant,
    whitelabelId: inserted.whitelabelId,
    userId: inserted.userId,
    eventId: inserted.eventId,
    patternType: inserted.patternType as BettingPatternType,
    severity: inserted.severity as PatternSeverity,
    metrics: inserted.metrics as Record<string, any> | null,
    status: inserted.status as PatternStatus,
    notes: inserted.notes,
    detectedAt: inserted.detectedAt,
    createdAt: inserted.createdAt,
    updatedAt: inserted.updatedAt,
  }
}

/**
 * Get betting patterns with filters
 */
export async function getBettingPatterns(
  filters: BettingPatternFilters
): Promise<BettingPattern[]> {
  try {
    const conditions = []
    
    if (filters.tenant) {
      conditions.push(eq(bettingPatternsTable.tenant, filters.tenant))
    }
    if (filters.whitelabelId) {
      conditions.push(eq(bettingPatternsTable.whitelabelId, filters.whitelabelId))
    }
    if (filters.userId) {
      conditions.push(eq(bettingPatternsTable.userId, filters.userId))
    }
    if (filters.eventId) {
      conditions.push(eq(bettingPatternsTable.eventId, filters.eventId))
    }
    if (filters.patternType) {
      conditions.push(eq(bettingPatternsTable.patternType, filters.patternType))
    }
    if (filters.severity) {
      conditions.push(eq(bettingPatternsTable.severity, filters.severity))
    }
    if (filters.status) {
      conditions.push(eq(bettingPatternsTable.status, filters.status))
    }
    
    const query = db
      .select()
      .from(bettingPatternsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bettingPatternsTable.detectedAt))
    
    if (filters.limit) {
      query.limit(filters.limit)
    }
    if (filters.offset) {
      query.offset(filters.offset)
    }
    
    const results = await query
    
    return results.map(row => ({
      id: row.id,
      tenant: row.tenant,
      whitelabelId: row.whitelabelId,
      userId: row.userId,
      eventId: row.eventId,
      patternType: row.patternType as BettingPatternType,
      severity: row.severity as PatternSeverity,
      metrics: row.metrics as Record<string, any> | null,
      status: row.status as PatternStatus,
      notes: row.notes,
      detectedAt: row.detectedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  } catch (error: any) {
    // If table doesn't exist, return empty array (graceful degradation)
    const errorMessage = error?.message || String(error || '');
    const errorCode = error?.code || '';
    
    if (
      errorMessage.includes('does not exist') || 
      errorCode === '42P01' ||
      errorMessage.includes('relation "betting_patterns" does not exist') ||
      errorMessage.includes('Failed query') ||
      errorMessage.includes('type "betting_pattern_type" does not exist') ||
      errorMessage.includes('type "pattern_severity" does not exist') ||
      errorMessage.includes('type "pattern_status" does not exist')
    ) {
      return [];
    }
    throw error;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Update pattern status
 *
 * Only a pattern of the given tenant and whitelabel, the scope getBettingPatterns
 * lists. The update matched the id alone, so one whitelabel could dismiss
 * another's detections, and an id that matched nothing threw a TypeError on the
 * missing row. Returns null when no pattern of that scope has the id.
 */
export async function updatePatternStatus(
  patternId: string,
  status: PatternStatus,
  notes: string | null | undefined,
  scope: { tenant: string; whitelabelId: string }
): Promise<BettingPattern | null> {
  if (!UUID_PATTERN.test(String(patternId))) return null
  const [updated] = await db
    .update(bettingPatternsTable)
    .set({
      status,
      notes: notes || null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(bettingPatternsTable.id, patternId),
      eq(bettingPatternsTable.tenant, scope.tenant),
      eq(bettingPatternsTable.whitelabelId, scope.whitelabelId),
    ))
    .returning()
  if (!updated) return null

  return {
    id: updated.id,
    tenant: updated.tenant,
    whitelabelId: updated.whitelabelId,
    userId: updated.userId,
    eventId: updated.eventId,
    patternType: updated.patternType as BettingPatternType,
    severity: updated.severity as PatternSeverity,
    metrics: updated.metrics as Record<string, any> | null,
    status: updated.status as PatternStatus,
    notes: updated.notes,
    detectedAt: updated.detectedAt,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}

