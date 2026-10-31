import { getPostedPerformanceCommissions } from './agentPerformanceReads.js'
import { attributedAgentId, referralAttributions, referrerUsers, referralAttributionJoinOn, referrerJoinOn } from '@src/domains/agents/services/commissionPlayerScope.js'
import { financialSnapshotsAreCurrent } from './snapshotFreshness.js'
import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { DateTime } from 'luxon';
import { db } from '@/db/client.js';
import {
  reportingDailySnapshots,
  sportsBets,
  sportsTable,
  sportsLeaguesTable,
  sportsEventsTable,
  sportsMarketsTable,
  agents,
  agentCredentials,
  users,
  agentHierarchyClosure,
  whitelabelSharingConfig,
  agentSharingConfig,
} from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, desc, asc, inArray, isNotNull, isNull } from 'drizzle-orm';
import { inAgentPlayers, callerVisibleChain } from './agentPlayerScope.js';
import { coerceReportingRangeStart, coerceReportingRangeEnd } from '@src/shared/dateUtils.js';
import { sqlDateBucketText } from '@src/shared/reportingSql.js';

const DEFAULT_TZ = 'Asia/Kolkata';
async function getTenantTimezone(tenantId: string | undefined): Promise<string> {
  if (!tenantId) return DEFAULT_TZ;
  try {
    const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
    const tz = await getWhitelabelTimezone(tenantId);
    return tz?.trim() || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export interface SportsReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  sportId?: string;
  leagueId?: string;
  eventId?: string;
  playerId?: string | number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
  groupBy?: 'day' | 'sport' | 'league' | 'event';
}

export interface SportsDrillDownFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  sportId?: string;
  leagueId?: string;
  eventId?: string;
  playerId?: string | number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
}

export interface SportsKPIs {
  totalStakes: number;
  totalPayouts: number;
  totalExposure: number;
  grossGamingRevenue: number;
  netRevenue: number;
  holdPercentage: number;
  betCount: number;
  playerCount: number;
  activePlayerCount: number;
}

export interface SportsTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

/**
 * Returns true if the filter's date range includes today (tenant TZ).
 * When true, we use live bet data instead of snapshots so GGR is up-to-date for the current day.
 */
async function rangeIncludesToday(filter: SportsReportingFilter): Promise<boolean> {
  if (filter.sportId || filter.leagueId || filter.eventId || filter.playerId) return true;
  const tz = await getTenantTimezone(filter.tenant);
  const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  const dateTo =
    filter.dateTo != null ? (coerceReportingRangeEnd(filter.dateTo, tz) ?? new Date()) : new Date();
  if (isNaN(dateTo.getTime())) return true;
  const dateToStr = DateTime.fromJSDate(dateTo, { zone: tz }).toFormat('yyyy-MM-dd');
  return dateToStr >= todayStr || !await financialSnapshotsAreCurrent(filter, 'sports', tz);
}

/**
 * Get sports KPIs for a date range
 * Falls back to real-time query from sportsBets if snapshots don't exist or range includes today
 */
export async function getSportsKPIs(filter: SportsReportingFilter): Promise<SportsKPIs> {
  // When range includes today, always use live data so GGR reflects latest settlements (snapshots are point-in-time and go stale)
  if (await rangeIncludesToday(filter)) {
    const fallbackResult = await getSportsKPIsFromBets(filter);
    const liveOpenExposure = await getCurrentOpenSportsExposure(filter);
    return {
      ...fallbackResult,
      totalExposure: Math.max(fallbackResult.totalExposure, liveOpenExposure),
    };
  }

  const conditions = buildConditions(filter);
  
  // Add agent hierarchy filtering if agentId is provided
  if (filter.agentId) {
    const agentConditions = await buildAgentHierarchyFilter(filter.agentId, filter.tenant)
    conditions.push(...agentConditions)
  } else {
    // For whitelabel login (no agentId), only query global snapshots (agentId and playerId both null)
    // agentId null + playerId not null = player-level row (direct players), not global
    conditions.push(isNull(reportingDailySnapshots.agentId));
    conditions.push(isNull(reportingDailySnapshots.playerId));
  }

  const result = await db
    .select({
      totalStakes: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      totalExposure: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalExposure}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      netRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.netRevenue}::numeric), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
      playerCount: snapshotPlayerCountExpr(Boolean(filter.agentId), 'playerCount'),
      activePlayerCount: snapshotPlayerCountExpr(Boolean(filter.agentId), 'activePlayerCount'),
    })
    .from(reportingDailySnapshots)
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'sports')));

  const kpis = result[0] || {
    totalStakes: 0,
    totalPayouts: 0,
    totalExposure: 0,
    grossGamingRevenue: 0,
    netRevenue: 0,
    betCount: 0,
    playerCount: 0,
    activePlayerCount: 0,
  };

  const totalStakes = Number(kpis.totalStakes) || 0;
  const totalPayouts = Number(kpis.totalPayouts) || 0;
  const betCount = Number(kpis.betCount) || 0;

  // If no snapshot data or all zeros, fallback to real-time query from sportsBets
  if (result.length === 0 || (totalStakes === 0 && totalPayouts === 0 && betCount === 0)) {
    const fallbackResult = await getSportsKPIsFromBets(filter);
    const liveOpenExposure = await getCurrentOpenSportsExposure(filter);
    return {
      ...fallbackResult,
      totalExposure: Math.max(fallbackResult.totalExposure, liveOpenExposure),
    };
  }

  const ggr = Number(kpis.grossGamingRevenue) || 0;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;

  // Ensure totalExposure reflects current open exposure (all open bets regardless of createdAt)
  // Snapshot only counts open bets created on each day; overlay with live open exposure
  const snapshotExposure = Number(kpis.totalExposure) || 0;
  const liveOpenExposure = await getCurrentOpenSportsExposure(filter);
  const totalExposure = Math.max(snapshotExposure, liveOpenExposure);

  const netRev = Number(kpis.netRevenue) || 0;

  return {
    totalStakes,
    totalPayouts,
    totalExposure,
    grossGamingRevenue: ggr,
    netRevenue: netRev,
    holdPercentage,
    betCount: Number(kpis.betCount) || 0,
    playerCount: Number(kpis.playerCount) || 0,
    activePlayerCount: Number(kpis.activePlayerCount) || 0,
  };
}

/**
 * Current open sports exposure (all open bets, no createdAt filter).
 * Used so Exposure Report and KPIs show at least current risk.
 * Exported so the "Exposure by market" integration test can reconcile its
 * per-sport rows against this exact figure.
 */
export async function getCurrentOpenSportsExposure(filter: SportsReportingFilter): Promise<number> {
  const conditions: any[] = [];
  if (filter.tenant) conditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.currency) conditions.push(eq(sportsBets.currency, filter.currency));
  if (filter.sportId) conditions.push(eq(sportsBets.sportId, filter.sportId));
  if (filter.leagueId) conditions.push(eq(sportsBets.leagueId, filter.leagueId));
  if (filter.eventId) conditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.playerId) conditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  conditions.push(inArray(sportsBets.status, ['matched', 'unmatched']));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    })
    .from(sportsBets)
    .leftJoin(users, eq(sportsBets.userId, users.id))
    .where(and(...conditions));
  return Number(rows[0]?.total) || 0;
}

/**
 * Fallback: Get sports KPIs directly from sportsBets table (real-time)
 */
async function getSportsKPIsFromBets(filter: SportsReportingFilter): Promise<SportsKPIs> {
  const betConditions: any[] = [];

  if (filter.tenant) {
    betConditions.push(eq(sportsBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    betConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.sportId) {
    betConditions.push(eq(sportsBets.sportId, filter.sportId));
  }
  if (filter.leagueId) {
    betConditions.push(eq(sportsBets.leagueId, filter.leagueId));
  }
  if (filter.eventId) {
    betConditions.push(eq(sportsBets.eventId, filter.eventId));
  }
  if (filter.playerId) {
    betConditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  }
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getTenantTimezone(filter.tenant);
    if (filter.dateFrom) {
      const from = coerceReportingRangeStart(filter.dateFrom, tz);
      if (from) betConditions.push(gte(sportsBets.createdAt, from));
    }
    if (filter.dateTo) {
      const to = coerceReportingRangeEnd(filter.dateTo, tz);
      if (to) betConditions.push(lte(sportsBets.createdAt, to));
    }
  }
  if (filter.currency) {
    betConditions.push(eq(sportsBets.currency, filter.currency));
  }
  // Settled-only: revenue from won/lost/settled; exposure from matched/unmatched (open)
  betConditions.push(inArray(sportsBets.status, ['won', 'lost', 'settled']));

  // Revenue query: settled bets only
  let query = db
    .select({
      totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
      totalPayouts: sportsPayoutAggregateSql(),
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
    })
    .from(sportsBets)
    .leftJoin(users, eq(sportsBets.userId, users.id));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    betConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const result = await query.where(and(...betConditions));
  const kpis = result[0] || {
    totalStakes: 0,
    totalPayouts: 0,
    betCount: 0,
    playerCount: 0,
  };

  // Open-only: exposure from matched/unmatched (same filters as revenue, different status)
  const exposureConditions: any[] = [];
  if (filter.tenant) exposureConditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) exposureConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.sportId) exposureConditions.push(eq(sportsBets.sportId, filter.sportId));
  if (filter.leagueId) exposureConditions.push(eq(sportsBets.leagueId, filter.leagueId));
  if (filter.eventId) exposureConditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.playerId) exposureConditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  if (filter.dateFrom || filter.dateTo) {
    const tzExposure = await getTenantTimezone(filter.tenant);
    if (filter.dateFrom) {
      const from = coerceReportingRangeStart(filter.dateFrom, tzExposure);
      if (from) exposureConditions.push(gte(sportsBets.createdAt, from));
    }
    if (filter.dateTo) {
      const to = coerceReportingRangeEnd(filter.dateTo, tzExposure);
      if (to) exposureConditions.push(lte(sportsBets.createdAt, to));
    }
  }
  if (filter.currency) exposureConditions.push(eq(sportsBets.currency, filter.currency));
  exposureConditions.push(inArray(sportsBets.status, ['matched', 'unmatched']));
  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    exposureConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const exposureResult = await db
    .select({
      totalExposure: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
    })
    .from(sportsBets)
    .leftJoin(users, eq(sportsBets.userId, users.id))
    .where(and(...exposureConditions));
  const totalExposure = Number(exposureResult[0]?.totalExposure) || 0;

  const totalStakes = Number(kpis.totalStakes) || 0;
  const totalPayouts = Number(kpis.totalPayouts) || 0;
  const ggr = totalStakes - totalPayouts;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;

  return {
    totalStakes,
    totalPayouts,
    totalExposure,
    grossGamingRevenue: ggr,
    netRevenue: ggr,
    holdPercentage,
    betCount: Number(kpis.betCount) || 0,
    playerCount: Number(kpis.playerCount) || 0,
    activePlayerCount: Number(kpis.playerCount) || 0,
  };
}

/**
 * Get sports trends directly from sportsBets (real-time). Used when range includes today.
 */
async function getSportsTrendsFromBets(filter: SportsReportingFilter): Promise<SportsTrendPoint[]> {
  const betConditions: any[] = [];
  const tz = await getTenantTimezone(filter.tenant);
  const dateBucket = sqlDateBucketText(sportsBets.createdAt, tz);
  if (filter.tenant) betConditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) betConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.sportId) betConditions.push(eq(sportsBets.sportId, filter.sportId));
  if (filter.leagueId) betConditions.push(eq(sportsBets.leagueId, filter.leagueId));
  if (filter.eventId) betConditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.playerId) betConditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, tz);
    if (from) betConditions.push(gte(sportsBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, tz);
    if (to) betConditions.push(lte(sportsBets.createdAt, to));
  }
  if (filter.currency) betConditions.push(eq(sportsBets.currency, filter.currency));
  betConditions.push(inArray(sportsBets.status, ['won', 'lost', 'settled']));

  let query = db
    .select({
      date: dateBucket,
      stakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      totalPayouts: sportsPayoutAggregateSql(),
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
    })
    .from(sportsBets)
    .leftJoin(users, eq(sportsBets.userId, users.id));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    betConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const results = await query
    .where(and(...betConditions))
    .groupBy(dateBucket)
    .orderBy(asc(dateBucket));

  return results.map((r) => {
    const stakes = Number(r.stakes) || 0;
    const payouts = Number(r.totalPayouts) || 0;
    return {
      date: String(r.date ?? ''),
      stakes,
      payouts,
      ggr: stakes - payouts,
      betCount: Number(r.betCount) || 0,
      playerCount: Number(r.playerCount) || 0,
    };
  });
}

/**
 * Get sports trends over time
 */
export async function getSportsTrends(filter: SportsReportingFilter): Promise<SportsTrendPoint[]> {
  if (await rangeIncludesToday(filter)) {
    return await getSportsTrendsFromBets(filter);
  }

  const conditions = buildConditions(filter);

  if (filter.agentId) {
    const agentConditions = await buildAgentHierarchyFilter(filter.agentId, filter.tenant);
    conditions.push(...agentConditions);
  } else {
    // Global: agentId and playerId both null
    conditions.push(isNull(reportingDailySnapshots.agentId));
    conditions.push(isNull(reportingDailySnapshots.playerId));
  }

  const tz = await getTenantTimezone(filter.tenant);
  const snapshotDayBucket = sqlDateBucketText(reportingDailySnapshots.snapshotDate, tz);

  const results = await db
    .select({
      date: snapshotDayBucket,
      stakes: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      payouts: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
      playerCount: snapshotPlayerCountExpr(Boolean(filter.agentId), 'playerCount'),
    })
    .from(reportingDailySnapshots)
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'sports')))
    .groupBy(snapshotDayBucket)
    .orderBy(asc(snapshotDayBucket));

  return results.map((r) => ({
    date: String(r.date ?? ''),
    stakes: Number(r.stakes) || 0,
    payouts: Number(r.payouts) || 0,
    ggr: Number(r.ggr) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
  }));
}

/**
 * Get sports breakdown by dimension (sport, league, event)
 */
async function settledSportsConditions(filter: SportsReportingFilter | SportsDrillDownFilter) {
  const conditions = [inArray(sportsBets.status, ['won', 'lost', 'settled'])];
  if (filter.tenant) conditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.currency) conditions.push(eq(sportsBets.currency, filter.currency));
  if (filter.sportId) conditions.push(eq(sportsBets.sportId, filter.sportId));
  if (filter.leagueId) conditions.push(eq(sportsBets.leagueId, filter.leagueId));
  if (filter.eventId) conditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.playerId) conditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  const tz = await getTenantTimezone(filter.tenant);
  const from = filter.dateFrom ? coerceReportingRangeStart(filter.dateFrom, tz) : null;
  const to = filter.dateTo ? coerceReportingRangeEnd(filter.dateTo, tz) : null;
  if (from) conditions.push(gte(sportsBets.createdAt, from));
  if (to) conditions.push(lte(sportsBets.createdAt, to));
  if (filter.agentId) conditions.push(inAgentPlayers(sportsBets.userId, filter.agentId, filter.tenant));
  return conditions;
}

export async function getSportsBreakdown(
  filter: SportsReportingFilter,
  dimension: 'sport' | 'league' | 'event',
) {
  const conditions = await settledSportsConditions(filter);
  const groupByField = dimension === 'sport' ? sportsBets.sportId : dimension === 'league' ? sportsBets.leagueId : sportsBets.eventId;

  // First get aggregated data without name lookups
  const aggregatedResults = await db
    .select({
      id: groupByField,
      totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      totalPayouts: sportsPayoutAggregateSql(),
      grossGamingRevenue: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0) - ${sportsPayoutAggregateSql()}`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
    })
    .from(sportsBets)
    .where(and(...conditions, isNotNull(groupByField)))
    .groupBy(groupByField)
    .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));

  // Batch fetch names based on dimension
  const ids = aggregatedResults.map(r => r.id).filter((id): id is string => id !== null);
  const namesMap = new Map<string, string | null>();
  
  if (ids.length > 0) {
    if (dimension === 'sport') {
      const sports = await db
        .select({
          id: sportsTable.id,
          name: sportsTable.name,
        })
        .from(sportsTable)
        .where(inArray(sportsTable.id, ids));
      sports.forEach(sport => {
        namesMap.set(sport.id, sport.name || null);
      });
    } else if (dimension === 'league') {
      const leagues = await db
        .select({
          id: sportsLeaguesTable.id,
          name: sportsLeaguesTable.name,
        })
        .from(sportsLeaguesTable)
        .where(inArray(sportsLeaguesTable.id, ids));
      leagues.forEach(league => {
        namesMap.set(league.id, league.name || null);
      });
    } else if (dimension === 'event') {
      const events = await db
        .select({
          id: sportsEventsTable.id,
          name: sportsEventsTable.name,
        })
        .from(sportsEventsTable)
        .where(inArray(sportsEventsTable.id, ids));
      events.forEach(event => {
        namesMap.set(event.id, event.name || null);
      });
    }
  }

  // Combine results with names
  return aggregatedResults.map((r) => ({
    id: r.id,
    name: r.id ? (namesMap.get(r.id) || 'Unknown') : 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
  }));
}

/**
 * Get top sports events by stakes
 */
export async function getTopSportsEvents(filter: SportsReportingFilter, limit: number = 10) {
  const conditions = buildConditions(filter);
  
  // Add agent hierarchy filtering if agentId is provided
  if (filter.agentId) {
    const agentConditions = await buildAgentHierarchyFilter(filter.agentId, filter.tenant)
    conditions.push(...agentConditions)
  } else {
    // For whitelabel login (no agentId), query player-level snapshots (where playerId is not null)
    // Player-level snapshots have eventId/leagueId/sportId populated, which we need for top events
    conditions.push(isNotNull(reportingDailySnapshots.playerId));
  }

  const results = await db
    .select({
      eventId: reportingDailySnapshots.eventId,
      eventName: sql<string>`(SELECT name FROM ${sportsEventsTable} WHERE id = ${reportingDailySnapshots.eventId})`,
      leagueName: sql<string>`(SELECT name FROM ${sportsLeaguesTable} WHERE id = ${reportingDailySnapshots.leagueId})`,
      sportName: sql<string>`(SELECT name FROM ${sportsTable} WHERE id = ${reportingDailySnapshots.sportId})`,
      totalStakes: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
    })
    .from(reportingDailySnapshots)
    .where(
      and(
        ...conditions,
        eq(reportingDailySnapshots.domain, 'sports'),
        isNotNull(reportingDailySnapshots.eventId),
        isNotNull(reportingDailySnapshots.leagueId),
        isNotNull(reportingDailySnapshots.sportId),
      ),
    )
    .groupBy(
      reportingDailySnapshots.eventId,
      reportingDailySnapshots.leagueId,
      reportingDailySnapshots.sportId,
    )
    .orderBy(desc(sql`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`))
    .limit(limit);

  return results.map((r) => ({
    eventId: r.eventId,
    eventName: r.eventName || 'Unknown',
    leagueName: r.leagueName || 'Unknown',
    sportName: r.sportName || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
  }));
}

/**
 * Agent scope for snapshot reads: the PLAYER-LEVEL rows of the agent's players.
 *
 * This matched `agent_id IN subtree` with no `player_id` filter, so each day's
 * agent-level row (player_id NULL) and the player-level rows it was rolled up
 * from were summed together — the agent's KPIs and trends were doubled — and
 * players who reached the agent by referral were missed. Player-level rows of
 * the agent's players (subtree + referral, agentPlayerScope.ts) count each bet
 * once, and match the whitelabel breakdowns, which already read player rows.
 */
async function buildAgentHierarchyFilter(agentId: string | undefined, tenant?: string): Promise<any[]> {
  if (!agentId) return []
  return [
    isNotNull(reportingDailySnapshots.playerId),
    inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant),
  ]
}

/** Player counts: per-player rows each carry playerCount = 1, so an agent's count is the distinct players. */
function snapshotPlayerCountExpr(agentScoped: boolean, column: 'playerCount' | 'activePlayerCount') {
  return agentScoped
    ? sql<number>`COUNT(DISTINCT ${reportingDailySnapshots.playerId})`
    : sql<number>`COALESCE(MAX(${reportingDailySnapshots[column]}), 0)`
}

/**
 * Resolve agent IDs to their top-level (direct-under-whitelabel) agent for display.
 * Returns map: agentId -> topLevelAgentId (ancestor with parentAgentId null under the whitelabel).
 */
async function resolveAgentsToTopLevel(
  whitelabelId: string,
  agentIds: string[],
): Promise<Map<string, string>> {
  if (!whitelabelId || agentIds.length === 0) return new Map();
  const uniqueIds = [...new Set(agentIds)];
  const rows = await db
    .select({
      descendantId: agentHierarchyClosure.descendantId,
      ancestorId: agentHierarchyClosure.ancestorId,
    })
    .from(agentHierarchyClosure)
    .innerJoin(agents, eq(agents.id, agentHierarchyClosure.ancestorId))
    .where(
      and(
        inArray(agentHierarchyClosure.descendantId, uniqueIds),
        isNull(agents.parentAgentId),
        eq(agents.tenantId, whitelabelId),
      ),
    );
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.descendantId, row.ancestorId);
  }
  return map;
}

/**
 * Resolve agent IDs to the direct child of the given parent (logged-in agent).
 * Used when an agent is logged in: show only direct agents (children) with rolled-up contribution.
 * Returns map: snapshotAgentId -> directChildId (the agent in the path whose parent is loggedInAgentId).
 * No entry for loggedInAgentId itself so its data is excluded from the sidebar.
 */
async function resolveAgentsToDirectChildren(
  loggedInAgentId: string,
  agentIds: string[],
): Promise<Map<string, string>> {
  if (!loggedInAgentId || agentIds.length === 0) return new Map();
  const uniqueIds = [...new Set(agentIds)].filter((id) => id !== loggedInAgentId);
  if (uniqueIds.length === 0) return new Map();
  const rows = await db
    .select({
      descendantId: agentHierarchyClosure.descendantId,
      ancestorId: agentHierarchyClosure.ancestorId,
    })
    .from(agentHierarchyClosure)
    .innerJoin(agents, eq(agents.id, agentHierarchyClosure.ancestorId))
    .where(
      and(
        inArray(agentHierarchyClosure.descendantId, uniqueIds),
        eq(agents.parentAgentId, loggedInAgentId),
      ),
    )
    .orderBy(asc(agentHierarchyClosure.depth));
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.descendantId)) map.set(row.descendantId, row.ancestorId);
  }
  return map;
}

function buildConditions(filter: SportsReportingFilter | SportsDrillDownFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  // Note: agentId filtering is handled separately in async functions
  if (filter.sportId) {
    conditions.push(eq(reportingDailySnapshots.sportId, filter.sportId));
  }
  if (filter.leagueId) {
    conditions.push(eq(reportingDailySnapshots.leagueId, filter.leagueId));
  }
  if (filter.eventId) {
    conditions.push(eq(reportingDailySnapshots.eventId, filter.eventId));
  }
  if (filter.playerId) {
    conditions.push(eq(reportingDailySnapshots.playerId, Number(filter.playerId)));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, DEFAULT_TZ);
    if (from) conditions.push(gte(reportingDailySnapshots.snapshotDate, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, DEFAULT_TZ);
    if (to) conditions.push(lte(reportingDailySnapshots.snapshotDate, to));
  }
  // Only filter by currency if explicitly provided
  // If not provided, query all currencies (snapshots might be in different currencies)
  // This allows data to show even if currency filter doesn't match
  if (filter.currency) {
    conditions.push(eq(reportingDailySnapshots.currency, filter.currency));
  }

  return conditions;
}

/**
 * Get sports league breakdown for drill-down
 */
export async function getSportsLeagueBreakdown(filter: SportsDrillDownFilter) {
  const conditions = await settledSportsConditions(filter);

  // First get aggregated data without name lookups
  const aggregatedResults = await db
    .select({
      leagueId: sportsBets.leagueId,
      sportId: sportsBets.sportId,
      totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      totalPayouts: sportsPayoutAggregateSql(),
      grossGamingRevenue: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0) - ${sportsPayoutAggregateSql()}`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
      eventCount: sql<number>`COUNT(DISTINCT ${sportsBets.eventId})`,
    })
    .from(sportsBets)
    .where(and(...conditions, isNotNull(sportsBets.leagueId)))
    .groupBy(sportsBets.leagueId, sportsBets.sportId)
    .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));

  // Batch fetch league and sport names
  const leagueIds = aggregatedResults.map(r => r.leagueId).filter((id): id is string => id !== null);
  const sportIds = aggregatedResults.map(r => r.sportId).filter((id): id is string => id !== null);
  
  const leagueNamesMap = new Map<string, string | null>();
  const sportNamesMap = new Map<string, string | null>();
  
  if (leagueIds.length > 0) {
    const leagues = await db
      .select({
        id: sportsLeaguesTable.id,
        name: sportsLeaguesTable.name,
      })
      .from(sportsLeaguesTable)
      .where(inArray(sportsLeaguesTable.id, leagueIds));
    leagues.forEach(league => {
      leagueNamesMap.set(league.id, league.name || null);
    });
  }
  
  if (sportIds.length > 0) {
    const sports = await db
      .select({
        id: sportsTable.id,
        name: sportsTable.name,
      })
      .from(sportsTable)
      .where(inArray(sportsTable.id, sportIds));
    sports.forEach(sport => {
      sportNamesMap.set(sport.id, sport.name || null);
    });
  }

  // Combine results with names
  return aggregatedResults.map((r) => ({
    leagueId: r.leagueId,
    leagueName: r.leagueId ? (leagueNamesMap.get(r.leagueId) || 'Unknown') : 'Unknown',
    sportId: r.sportId,
    sportName: r.sportId ? (sportNamesMap.get(r.sportId) || 'Unknown') : 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    eventCount: Number(r.eventCount) || 0,
  }));
}

/**
 * Get sports event breakdown for drill-down
 */
export async function getSportsEventBreakdown(filter: SportsDrillDownFilter) {
  const conditions = await settledSportsConditions(filter);

  // First get aggregated data without name lookups
  const aggregatedResults = await db
    .select({
      eventId: sportsBets.eventId,
      leagueId: sportsBets.leagueId,
      sportId: sportsBets.sportId,
      totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      totalPayouts: sportsPayoutAggregateSql(),
      grossGamingRevenue: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0) - ${sportsPayoutAggregateSql()}`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
    })
    .from(sportsBets)
    .where(and(...conditions, isNotNull(sportsBets.eventId)))
    .groupBy(sportsBets.eventId, sportsBets.leagueId, sportsBets.sportId)
    .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));

  // Batch fetch event, league, and sport names
  const eventIds = aggregatedResults.map(r => r.eventId).filter((id): id is string => id !== null);
  const leagueIds = aggregatedResults.map(r => r.leagueId).filter((id): id is string => id !== null);
  const sportIds = aggregatedResults.map(r => r.sportId).filter((id): id is string => id !== null);
  
  const eventNamesMap = new Map<string, string | null>();
  const eventStartTimesMap = new Map<string, string | null>();
  const leagueNamesMap = new Map<string, string | null>();
  const sportNamesMap = new Map<string, string | null>();
  
  if (eventIds.length > 0) {
    const events = await db
      .select({
        id: sportsEventsTable.id,
        name: sportsEventsTable.name,
        startTime: sportsEventsTable.startTime,
      })
      .from(sportsEventsTable)
      .where(inArray(sportsEventsTable.id, eventIds));
    events.forEach(event => {
      eventNamesMap.set(event.id, event.name || null);
      eventStartTimesMap.set(event.id, event.startTime ? new Date(event.startTime).toISOString() : null);
    });
  }
  
  if (leagueIds.length > 0) {
    const leagues = await db
      .select({
        id: sportsLeaguesTable.id,
        name: sportsLeaguesTable.name,
      })
      .from(sportsLeaguesTable)
      .where(inArray(sportsLeaguesTable.id, leagueIds));
    leagues.forEach(league => {
      leagueNamesMap.set(league.id, league.name || null);
    });
  }
  
  if (sportIds.length > 0) {
    const sports = await db
      .select({
        id: sportsTable.id,
        name: sportsTable.name,
      })
      .from(sportsTable)
      .where(inArray(sportsTable.id, sportIds));
    sports.forEach(sport => {
      sportNamesMap.set(sport.id, sport.name || null);
    });
  }

  // Combine results with names
  return aggregatedResults.map((r) => ({
    eventId: r.eventId,
    eventName: r.eventId ? (eventNamesMap.get(r.eventId) || 'Unknown') : 'Unknown',
    leagueId: r.leagueId,
    leagueName: r.leagueId ? (leagueNamesMap.get(r.leagueId) || 'Unknown') : 'Unknown',
    sportId: r.sportId,
    sportName: r.sportId ? (sportNamesMap.get(r.sportId) || 'Unknown') : 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    startTime: r.eventId ? (eventStartTimesMap.get(r.eventId) || null) : null,
  }));
}

/**
 * Get sports market breakdown for drill-down (event ke andar markets list with stakes/GGR per market).
 * Aggregates from sports_bets by marketId; requires eventId in filter.
 */
export async function getSportsMarketBreakdown(filter: SportsDrillDownFilter) {
  if (!filter?.eventId) return [];

  const betConditions: Array<ReturnType<typeof eq> | ReturnType<typeof gte> | ReturnType<typeof lte> | ReturnType<typeof inArray>> = [];
  betConditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.tenant) betConditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) betConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getTenantTimezone(filter.tenant);
    if (filter.dateFrom) {
      const from = coerceReportingRangeStart(filter.dateFrom, tz);
      if (from) betConditions.push(gte(sportsBets.createdAt, from));
    }
    if (filter.dateTo) {
      const to = coerceReportingRangeEnd(filter.dateTo, tz);
      if (to) betConditions.push(lte(sportsBets.createdAt, to));
    }
  }
  if (filter.currency) betConditions.push(eq(sportsBets.currency, filter.currency));
  betConditions.push(inArray(sportsBets.status, ['won', 'lost', 'settled']));

  const selectFields = {
    marketId: sportsBets.marketId,
    // Cast UUID to text before MAX - PostgreSQL doesn't have MAX(uuid)
    eventId: sql<string>`MAX(${sportsBets.eventId}::text)`,
    leagueId: sql<string>`MAX(${sportsBets.leagueId}::text)`,
    sportId: sql<string>`MAX(${sportsBets.sportId}::text)`,
    totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    totalPayouts: sportsPayoutAggregateSql(),
    betCount: sql<number>`COUNT(*)`,
    playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
  };

  let aggregatedResults: Array<{
    marketId: string;
    eventId: string;
    leagueId: string;
    sportId: string;
    totalStakes: unknown;
    totalPayouts: unknown;
    betCount: unknown;
    playerCount: unknown;
  }>;

  if (filter.agentId) {
    const descendants = await db
      .select({ descendantId: agentHierarchyClosure.descendantId })
      .from(agentHierarchyClosure)
      .where(eq(agentHierarchyClosure.ancestorId, filter.agentId));
    const allAgentIds = [filter.agentId, ...descendants.map((d) => d.descendantId)];
    aggregatedResults = await db
      .select(selectFields)
      .from(sportsBets)
      .innerJoin(users, eq(sportsBets.userId, users.id))
      .where(and(...betConditions, inArray(users.agentId, allAgentIds)))
      .groupBy(sportsBets.marketId)
      .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));
  } else {
    aggregatedResults = await db
      .select(selectFields)
      .from(sportsBets)
      .where(and(...betConditions))
      .groupBy(sportsBets.marketId)
      .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));
  }

  const marketIds = aggregatedResults.map((r) => r.marketId).filter((id): id is string => id != null);
  const marketNamesMap = new Map<string, string | null>();
  const eventNamesMap = new Map<string, string | null>();
  const leagueNamesMap = new Map<string, string | null>();
  const sportNamesMap = new Map<string, string | null>();

  if (marketIds.length > 0) {
    const markets = await db
      .select({ id: sportsMarketsTable.id, name: sportsMarketsTable.name })
      .from(sportsMarketsTable)
      .where(inArray(sportsMarketsTable.id, marketIds));
    markets.forEach((m) => marketNamesMap.set(m.id, m.name ?? null));
  }

  const eventIds = [...new Set(aggregatedResults.map((r) => r.eventId as string).filter(Boolean))];
  const leagueIds = [...new Set(aggregatedResults.map((r) => r.leagueId as string).filter(Boolean))];
  const sportIds = [...new Set(aggregatedResults.map((r) => r.sportId as string).filter(Boolean))];

  if (eventIds.length > 0) {
    const events = await db
      .select({ id: sportsEventsTable.id, name: sportsEventsTable.name })
      .from(sportsEventsTable)
      .where(inArray(sportsEventsTable.id, eventIds));
    events.forEach((e) => eventNamesMap.set(e.id, e.name ?? null));
  }
  if (leagueIds.length > 0) {
    const leagues = await db
      .select({ id: sportsLeaguesTable.id, name: sportsLeaguesTable.name })
      .from(sportsLeaguesTable)
      .where(inArray(sportsLeaguesTable.id, leagueIds));
    leagues.forEach((l) => leagueNamesMap.set(l.id, l.name ?? null));
  }
  if (sportIds.length > 0) {
    const sports = await db
      .select({ id: sportsTable.id, name: sportsTable.name })
      .from(sportsTable)
      .where(inArray(sportsTable.id, sportIds));
    sports.forEach((s) => sportNamesMap.set(s.id, s.name ?? null));
  }

  return aggregatedResults.map((r) => {
    const totalStakes = Number(r.totalStakes) || 0;
    const totalPayouts = Number(r.totalPayouts) || 0;
    const eventId = r.eventId as string | null;
    const leagueId = r.leagueId as string | null;
    const sportId = r.sportId as string | null;
    return {
      marketId: r.marketId,
      marketName: marketNamesMap.get(r.marketId) ?? 'Unknown',
      eventId: eventId ?? undefined,
      eventName: eventId ? (eventNamesMap.get(eventId) ?? undefined) : undefined,
      leagueId: leagueId ?? undefined,
      leagueName: leagueId ? (leagueNamesMap.get(leagueId) ?? undefined) : undefined,
      sportId: sportId ?? undefined,
      sportName: sportId ? (sportNamesMap.get(sportId) ?? undefined) : undefined,
      totalStakes,
      totalPayouts,
      grossGamingRevenue: totalStakes - totalPayouts,
      betCount: Number(r.betCount) || 0,
      playerCount: Number(r.playerCount) || 0,
    };
  });
}

/**
 * Get sports agent breakdown for drill-down
 */
async function directSportsAgentTotals(filter: SportsDrillDownFilter) {
  const conditions = await settledSportsConditions(filter);
  const tenant = filter.tenant || filter.whitelabelId;
  const rows = await db.select({ agentId: attributedAgentId,
    totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
    totalPayouts: sportsPayoutAggregateSql(),
    grossGamingRevenue: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0) - ${sportsPayoutAggregateSql()}`,
    betCount: sql<number>`COUNT(*)`, playerCount: sql<number>`COUNT(DISTINCT ${sportsBets.userId})`,
  }).from(sportsBets).innerJoin(users, eq(sportsBets.userId, users.id))
    .leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant))
    .leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant))
    .where(and(...conditions, isNotNull(attributedAgentId))).groupBy(attributedAgentId);
  const tz = await getTenantTimezone(tenant);
  const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
  const currency = filter.currency || (tenant ? await getWhitelabelCurrency(tenant) : 'INR');
  const from = filter.dateFrom ? coerceReportingRangeStart(filter.dateFrom, tz) ?? new Date(0) : new Date(0);
  const to = filter.dateTo ? coerceReportingRangeEnd(filter.dateTo, tz) ?? new Date() : new Date();
  const posted = tenant ? await getPostedPerformanceCommissions(tenant, rows.map(row => row.agentId).filter((id): id is string => !!id), currency, from, to, 'sports') : new Map<string, number>();
  return rows.map(row => ({ ...row, commission: row.agentId ? posted.get(row.agentId) ?? 0 : 0 }));
}

export async function getSportsAgentBreakdown(filter: SportsDrillDownFilter) {
  if (!filter) return [];

  // When whitelabelId is set, or when agent is logged in (show direct children only): use rollup path
  const useTopLevelRollup = Boolean(filter.whitelabelId) || Boolean(filter.agentId);

  let aggregatedResults: Array<{
    agentId: string | null;
    totalStakes: number;
    totalPayouts: number;
    grossGamingRevenue: number;
    betCount: number;
    playerCount: number;
    commission: number;
  }>;

  if (useTopLevelRollup) {
    const byAgent = await directSportsAgentTotals(filter);
    const agentIdsFromSnapshots = byAgent.map(r => r.agentId).filter((id): id is string => id != null);

    const rollup = new Map<
      string,
      { totalStakes: number; totalPayouts: number; grossGamingRevenue: number; betCount: number; playerCount: number; commission: number }
    >();

    if (filter.agentId) {
      // Agent login: roll up to direct children only (exclude self); show "through whom" contribution
      const agentIdToDirectChild = await resolveAgentsToDirectChildren(filter.agentId, agentIdsFromSnapshots);
      for (const r of byAgent) {
        const directChildId = r.agentId ? agentIdToDirectChild.get(r.agentId) : null;
        if (!directChildId) continue;
        const n = Number(r.totalStakes) || 0;
        const p = Number(r.totalPayouts) || 0;
        const g = Number(r.grossGamingRevenue) || 0;
        const b = Number(r.betCount) || 0;
        const pl = Number(r.playerCount) || 0;
        const c = Number(r.commission) || 0;
        const existing = rollup.get(directChildId);
        if (existing) {
          existing.totalStakes += n;
          existing.totalPayouts += p;
          existing.grossGamingRevenue += g;
          existing.betCount += b;
          existing.playerCount += pl;
          existing.commission += c;
        } else {
          rollup.set(directChildId, { totalStakes: n, totalPayouts: p, grossGamingRevenue: g, betCount: b, playerCount: pl, commission: c });
        }
      }
    } else {
      // Whitelabel: roll up to top-level agents
      const agentIdToTopLevel = await resolveAgentsToTopLevel(filter.whitelabelId!, agentIdsFromSnapshots);
      for (const r of byAgent) {
        const topLevelId = r.agentId ? (agentIdToTopLevel.get(r.agentId) ?? r.agentId) : null;
        if (!topLevelId) continue;
        const n = Number(r.totalStakes) || 0;
        const p = Number(r.totalPayouts) || 0;
        const g = Number(r.grossGamingRevenue) || 0;
        const b = Number(r.betCount) || 0;
        const pl = Number(r.playerCount) || 0;
        const c = Number(r.commission) || 0;
        const existing = rollup.get(topLevelId);
        if (existing) {
          existing.totalStakes += n;
          existing.totalPayouts += p;
          existing.grossGamingRevenue += g;
          existing.betCount += b;
          existing.playerCount += pl; // may overcount if same player under multiple sub-agents
          existing.commission += c;
        } else {
          rollup.set(topLevelId, { totalStakes: n, totalPayouts: p, grossGamingRevenue: g, betCount: b, playerCount: pl, commission: c });
        }
      }
    }

    aggregatedResults = [...rollup.entries()].map(([agentId, v]) => ({
      agentId,
      totalStakes: v.totalStakes,
      totalPayouts: v.totalPayouts,
      grossGamingRevenue: v.grossGamingRevenue,
      betCount: v.betCount,
      playerCount: v.playerCount,
      commission: v.commission,
    }));
    aggregatedResults.sort((a, b) => b.totalStakes - a.totalStakes);
  } else {
    const roots = await db.select({ id: agents.id }).from(agents).where(isNull(agents.parentAgentId));
    const rootIds = new Set(roots.map(row => row.id));
    aggregatedResults = (await directSportsAgentTotals(filter)).filter(row => row.agentId && rootIds.has(row.agentId));
  }

  const agentIds = aggregatedResults.map(r => r.agentId).filter((id): id is string => id !== null);
  const agentNamesMap = new Map<string, string | null>();
  if (agentIds.length > 0) {
    const agentList = await db
      .select({
        id: agents.id,
        username: agentCredentials.username,
        agentPhone: agents.phone,
      })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(inArray(agents.id, agentIds));
    agentList.forEach((row) => {
      agentNamesMap.set(row.id, row.username?.trim() || row.agentPhone?.trim() || null);
    });
  }

  // Share rates: whitelabel (e.g. 85%) and per-agent (e.g. 10%) for "With cut (Net)" and commission
  let whitelabelShareRate: number | null = null;
  const agentShareRateMap = new Map<string, number>();
  if (filter.whitelabelId && agentIds.length > 0) {
    const [wlRow] = await db
      .select({ shareRate: whitelabelSharingConfig.shareRate })
      .from(whitelabelSharingConfig)
      .where(
        and(
          eq(whitelabelSharingConfig.whitelabelId, filter.whitelabelId),
          eq(whitelabelSharingConfig.domain, 'sports'),
        ),
      )
      .limit(1);
    if (wlRow?.shareRate != null) whitelabelShareRate = Number(wlRow.shareRate);
    const agentConfigRows = await db
      .select({
        agentId: agentSharingConfig.agentId,
        shareRate: agentSharingConfig.shareRate,
        effectiveFrom: agentSharingConfig.effectiveFrom,
      })
      .from(agentSharingConfig)
      .where(
        and(
          inArray(agentSharingConfig.agentId, agentIds),
          eq(agentSharingConfig.domain, 'sports'),
        ),
      )
      .orderBy(agentSharingConfig.agentId, desc(agentSharingConfig.effectiveFrom));
    for (const row of agentConfigRows) {
      if (!agentShareRateMap.has(row.agentId))
        agentShareRateMap.set(row.agentId, Number(row.shareRate) || 0);
    }
  }

  const ggr = (r: (typeof aggregatedResults)[0]) => Number(r.grossGamingRevenue) || 0;
  const commFromSnapshot = (r: (typeof aggregatedResults)[0]) => Number(r.commission) || 0;

  return aggregatedResults
    .filter((r): r is typeof r & { agentId: string } => r.agentId != null)
    .map((r) => {
      const ggrVal = ggr(r);
      const agentRate = filter.whitelabelId ? (agentShareRateMap.get(r.agentId) ?? 0) : 0;
      const wlRate = whitelabelShareRate;
      const useShareRates = wlRate != null;
      const commission = useShareRates ? ggrVal * agentRate : commFromSnapshot(r);
      const netGgr = useShareRates && wlRate != null ? ggrVal * wlRate : ggrVal - commission;
      return {
        agentId: r.agentId,
        agentName: agentNamesMap.get(r.agentId) ?? 'Unknown',
        totalStakes: Number(r.totalStakes) || 0,
        totalPayouts: Number(r.totalPayouts) || 0,
        grossGamingRevenue: ggrVal,
        netGgr,
        betCount: Number(r.betCount) || 0,
        playerCount: Number(r.playerCount) || 0,
        commission,
      };
    });
}

/**
 * Get sports player breakdown for drill-down.
 * Uses live sportsBets when range includes today (same hybrid strategy as getSportsKPIs).
 */
export async function getSportsPlayerBreakdown(filter: SportsDrillDownFilter) {
  return getSportsPlayerBreakdownFromBets(filter);
}

async function getSportsPlayerBreakdownFromBets(filter: SportsDrillDownFilter) {
  const betConditions: any[] = [];
  if (filter.tenant) betConditions.push(eq(sportsBets.tenant, filter.tenant));
  if (filter.whitelabelId) betConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  if (filter.sportId) betConditions.push(eq(sportsBets.sportId, filter.sportId));
  if (filter.leagueId) betConditions.push(eq(sportsBets.leagueId, filter.leagueId));
  if (filter.eventId) betConditions.push(eq(sportsBets.eventId, filter.eventId));
  if (filter.playerId) betConditions.push(eq(sportsBets.userId, Number(filter.playerId)));
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getTenantTimezone(filter.tenant);
    if (filter.dateFrom) {
      const from = coerceReportingRangeStart(filter.dateFrom, tz);
      if (from) betConditions.push(gte(sportsBets.createdAt, from));
    }
    if (filter.dateTo) {
      const to = coerceReportingRangeEnd(filter.dateTo, tz);
      if (to) betConditions.push(lte(sportsBets.createdAt, to));
    }
  }
  if (filter.currency) betConditions.push(eq(sportsBets.currency, filter.currency));
  betConditions.push(inArray(sportsBets.status, ['won', 'lost', 'settled']));
  betConditions.push(isNotNull(sportsBets.userId));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    betConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const PAYOUT_EXPR = sportsPayoutAggregateSql();

  const aggregatedResults = await db
    .select({
      playerId: sportsBets.userId,
      totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      totalPayouts: PAYOUT_EXPR,
      betCount: sql<number>`COUNT(*)`,
      wins: sql<number>`COUNT(*) FILTER (WHERE ${sportsBets.status} = 'won' OR (${sportsBets.status} = 'settled' AND ${sportsBets.pl} > 0))`,
    })
    .from(sportsBets)
    .leftJoin(users, eq(sportsBets.userId, users.id))
    .where(and(...betConditions))
    .groupBy(sportsBets.userId)
    .orderBy(desc(sql`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`));

  const playerIds = aggregatedResults.map(r => r.playerId).filter((id): id is number => id !== null);
  const playerNamesMap = new Map<number, string | null>();
  const playerPhonesMap = new Map<number, string | null>();
  const playerAgentIdMap = new Map<number, string | null>();

  if (playerIds.length > 0) {
    const players = await db
      .select({ id: users.id, username: users.username, phone: users.phone, agentId: users.agentId })
      .from(users)
      .where(inArray(users.id, playerIds));
    players.forEach(p => {
      playerNamesMap.set(p.id, p.username || null);
      playerPhonesMap.set(p.id, p.phone || null);
      playerAgentIdMap.set(p.id, p.agentId ?? null);
    });
  }

  const directAgentIds = [...new Set(playerAgentIdMap.values())].filter((id): id is string => id != null);
  const agentNamesMap = new Map<string, string | null>();
  const agentChainMap = new Map<string, string[]>();
  const agentsOutsideCallerSubtree = new Set<string>();
  if (directAgentIds.length > 0) {
    // Fetch full ancestor chain for each direct agent via closure table
    const closureRows = await db
      .select({
        ancestorId: agentHierarchyClosure.ancestorId,
        descendantId: agentHierarchyClosure.descendantId,
        depth: agentHierarchyClosure.depth,
      })
      .from(agentHierarchyClosure)
      .where(inArray(agentHierarchyClosure.descendantId, directAgentIds));

    const allAgentIdsNeeded = new Set<string>(directAgentIds);
    closureRows.forEach((r) => { if (r.ancestorId) allAgentIdsNeeded.add(r.ancestorId); });

    const agentList = await db
      .select({ id: agents.id, username: agentCredentials.username, agentPhone: agents.phone })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(inArray(agents.id, [...allAgentIdsNeeded]));
    agentList.forEach((row) => {
      agentNamesMap.set(row.id, row.username?.trim() || row.agentPhone?.trim() || null);
    });

    // Build chain per direct agent: sort by depth DESC so root ancestor comes first
    const ancestorsByDescendant = new Map<string, { ancestorId: string; depth: number }[]>();
    closureRows.forEach((r) => {
      if (!r.descendantId || !r.ancestorId) return;
      if (!ancestorsByDescendant.has(r.descendantId)) ancestorsByDescendant.set(r.descendantId, []);
      ancestorsByDescendant.get(r.descendantId)!.push({ ancestorId: r.ancestorId, depth: r.depth ?? 0 });
    });
    directAgentIds.forEach((agentId) => {
      const ancestors = ancestorsByDescendant.get(agentId) || [];
      ancestors.sort((a, b) => b.depth - a.depth);
      // An agent caller sees the chain from itself down; an agent outside its subtree is hidden.
      const visibleChain = callerVisibleChain(ancestors, filter.agentId);
      if (visibleChain === null) agentsOutsideCallerSubtree.add(agentId);
      agentChainMap.set(agentId, (visibleChain ?? []).map((a) => agentNamesMap.get(a.ancestorId) || 'Unknown'));
    });
  }

  return aggregatedResults.map(r => {
    const stakes = Number(r.totalStakes) || 0;
    const payouts = Number(r.totalPayouts) || 0;
    const ggr = stakes - payouts;
    const betCount = Number(r.betCount) || 0;
    const rawAgentId = r.playerId ? playerAgentIdMap.get(r.playerId) ?? null : null;
    const displayAgentId = rawAgentId && !agentsOutsideCallerSubtree.has(rawAgentId) ? rawAgentId : null;
    return {
      playerId: r.playerId,
      playerUsername: r.playerId ? (playerNamesMap.get(r.playerId) ?? 'Unknown') : 'Unknown',
      playerPhone: r.playerId ? (playerPhonesMap.get(r.playerId) ?? null) : null,
      directAgentId: displayAgentId ?? undefined,
      directAgentName: displayAgentId ? (agentNamesMap.get(displayAgentId)?.trim() || 'Unknown') : undefined,
      agentChain: displayAgentId ? (agentChainMap.get(displayAgentId) ?? []) : [],
      totalStakes: stakes,
      totalPayouts: payouts,
      grossGamingRevenue: ggr,
      betCount,
      avgStake: betCount > 0 ? stakes / betCount : 0,
      winRate: Number(r.betCount) > 0 ? Number(r.wins) / Number(r.betCount) : 0,
    };
  });
}

