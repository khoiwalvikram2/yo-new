import { financialSnapshotsAreCurrent } from './snapshotFreshness.js'
import { attributedAgentId, referralAttributions, referrerUsers, referralAttributionJoinOn, referrerJoinOn } from '@src/domains/agents/services/commissionPlayerScope.js'
import { resolveAgentsToDirectChildren, resolveAgentsToTopLevel } from './casinoReportingRepo.js'
import { DateTime } from 'luxon';
import { db } from '@/db/client.js';
import {
  reportingDailySnapshots,
  matkaBets,
  matkas,
  agents,
  agentCredentials,
  users,
  agentHierarchyClosure,
} from '@shared/db/schema.js';
import { eq, and, or, gte, lte, sql, desc, asc, isNotNull, isNull, inArray } from 'drizzle-orm';
import { inAgentPlayers } from './agentPlayerScope.js';
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

export interface MatkaReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
}

export interface MatkaDrillDownFilter {
  tenant?: string;
  whitelabelId?: string;
  matkaType?: string;
  matkaId?: string;
  marketSession?: string;
  agentId?: string;
  playerId?: string | number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
}

export interface MatkaKPIs {
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

export interface MatkaTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

/**
 * Agent scope for snapshot reads: the PLAYER-LEVEL rows of the agent's players.
 *
 * This matched `agent_id IN subtree` with no `player_id` filter, so each day's
 * agent-level row (player_id NULL) and the player-level rows it was rolled up
 * from were summed together — every agent figure was doubled — and players who
 * reached the agent by referral were missed. Player-level rows of the agent's
 * players (subtree + referral, agentPlayerScope.ts) count each bet once.
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
 * Returns true if the filter's date range includes today (tenant TZ).
 * When true, we use live bet data instead of snapshots so GGR is up-to-date for the current day.
 */
async function rangeIncludesToday(filter: MatkaReportingFilter): Promise<boolean> {
  const tz = await getTenantTimezone(filter.tenant);
  const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  const dateTo =
    filter.dateTo != null ? (coerceReportingRangeEnd(filter.dateTo, tz) ?? new Date()) : new Date();
  if (isNaN(dateTo.getTime())) return true;
  const dateToStr = DateTime.fromJSDate(dateTo, { zone: tz }).toFormat('yyyy-MM-dd');
  return dateToStr >= todayStr || !await financialSnapshotsAreCurrent(filter, 'matka', tz);
}

export async function getMatkaKPIs(filter: MatkaReportingFilter): Promise<MatkaKPIs> {
  // When range includes today, always use live data so GGR reflects latest settlements (snapshots are point-in-time and go stale)
  if (await rangeIncludesToday(filter)) {
    return await getMatkaKPIsFromBets(filter);
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
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'matka')));

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
  const ggr = Number(kpis.grossGamingRevenue) || 0;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;

  // Ensure totalExposure reflects current open exposure (all open bets regardless of createdAt)
  const snapshotExposure = Number(kpis.totalExposure) || 0;
  const liveOpenExposure = await getCurrentOpenMatkaExposure(filter);
  const totalExposure = Math.max(snapshotExposure, liveOpenExposure);

  return {
    totalStakes,
    totalPayouts,
    totalExposure,
    grossGamingRevenue: ggr,
    netRevenue: Number(kpis.netRevenue) || 0,
    holdPercentage,
    betCount: Number(kpis.betCount) || 0,
    playerCount: Number(kpis.playerCount) || 0,
    activePlayerCount: Number(kpis.activePlayerCount) || 0,
  };
}

/**
 * Get matka KPIs directly from matkaBets table (real-time). Used when range includes today.
 */
async function getMatkaKPIsFromBets(filter: MatkaReportingFilter): Promise<MatkaKPIs> {
  const betConditions: any[] = [];
  if (filter.tenant) betConditions.push(eq(matkaBets.tenant, filter.tenant));
  if (filter.whitelabelId) betConditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getTenantTimezone(filter.tenant);
    if (filter.dateFrom) {
      const from = coerceReportingRangeStart(filter.dateFrom, tz);
      if (from) betConditions.push(gte(matkaBets.createdAt, from));
    }
    if (filter.dateTo) {
      const to = coerceReportingRangeEnd(filter.dateTo, tz);
      if (to) betConditions.push(lte(matkaBets.createdAt, to));
    }
  }
  if (filter.currency) betConditions.push(eq(matkaBets.currency, filter.currency));
  betConditions.push(inArray(matkaBets.status, ['won', 'lost']));

  let query = db
    .select({
      totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN COALESCE(${matkaBets.actualWin}::numeric, 0) ELSE 0 END), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
    })
    .from(matkaBets)
    .leftJoin(users, eq(matkaBets.userId, users.id));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    betConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const result = await query.where(and(...betConditions));
  const row = result[0] || { totalStakes: 0, totalPayouts: 0, betCount: 0, playerCount: 0 };
  const totalStakes = Number(row.totalStakes) || 0;
  const totalPayouts = Number(row.totalPayouts) || 0;
  const ggr = totalStakes - totalPayouts;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;
  const totalExposure = Math.max(0, await getCurrentOpenMatkaExposure(filter));

  return {
    totalStakes,
    totalPayouts,
    totalExposure,
    grossGamingRevenue: ggr,
    netRevenue: ggr,
    holdPercentage,
    betCount: Number(row.betCount) || 0,
    playerCount: Number(row.playerCount) || 0,
    activePlayerCount: Number(row.playerCount) || 0,
  };
}

/**
 * Current open matka exposure (all open bets, no createdAt filter).
 * Exported so the "Exposure by market" integration test can reconcile its
 * matka row against this exact figure.
 */
export async function getCurrentOpenMatkaExposure(filter: MatkaReportingFilter): Promise<number> {
  const conditions: any[] = [];
  if (filter.tenant) conditions.push(eq(matkaBets.tenant, filter.tenant));
  if (filter.whitelabelId) conditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
  if (filter.currency) conditions.push(eq(matkaBets.currency, filter.currency));
  conditions.push(or(eq(matkaBets.status, 'pending'), eq(matkaBets.status, 'active')));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${matkaBets.potentialWin}::numeric), 0)`,
    })
    .from(matkaBets)
    .leftJoin(users, eq(matkaBets.userId, users.id))
    .where(and(...conditions));
  return Number(rows[0]?.total) || 0;
}

/**
 * Get matka trends directly from matkaBets (real-time). Used when range includes today.
 */
async function getMatkaTrendsFromBets(filter: MatkaReportingFilter): Promise<MatkaTrendPoint[]> {
  const betConditions: any[] = [];
  const tz = await getTenantTimezone(filter.tenant);
  const dateBucket = sqlDateBucketText(matkaBets.createdAt, tz);
  if (filter.tenant) betConditions.push(eq(matkaBets.tenant, filter.tenant));
  if (filter.whitelabelId) betConditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, tz);
    if (from) betConditions.push(gte(matkaBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, tz);
    if (to) betConditions.push(lte(matkaBets.createdAt, to));
  }
  if (filter.currency) betConditions.push(eq(matkaBets.currency, filter.currency));
  betConditions.push(inArray(matkaBets.status, ['won', 'lost']));

  let query = db
    .select({
      date: dateBucket,
      stakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      payouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN COALESCE(${matkaBets.actualWin}::numeric, 0) ELSE 0 END), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
    })
    .from(matkaBets)
    .leftJoin(users, eq(matkaBets.userId, users.id));

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
    const payouts = Number(r.payouts) || 0;
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
 * Get matka trends over time
 */
export async function getMatkaTrends(filter: MatkaReportingFilter): Promise<MatkaTrendPoint[]> {
  if (await rangeIncludesToday(filter)) {
    return await getMatkaTrendsFromBets(filter);
  }

  const conditions = buildConditions(filter);
  
  // Add agent hierarchy filtering if agentId is provided
  if (filter.agentId) {
    const agentConditions = await buildAgentHierarchyFilter(filter.agentId, filter.tenant)
    conditions.push(...agentConditions)
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
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'matka')))
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

function buildConditions(filter: MatkaReportingFilter | MatkaDrillDownFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  // Note: agentId filtering is handled separately in async functions
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
 * WHERE conditions shared by every matka drill-down (type, market, session, player).
 *
 * `agentId` used to be accepted and then ignored here, so an agent opening any
 * matka breakdown got the whole whitelabel's figures — and the player breakdown
 * listed every player in the whitelabel with their phone number. An agent now
 * sees only its own players (subtree + referral, agentPlayerScope.ts).
 * Exported for the scoping test.
 */
export function buildBetConditions(filter: MatkaDrillDownFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(matkaBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.agentId) {
    conditions.push(inAgentPlayers(matkaBets.userId, filter.agentId, filter.tenant));
  }
  if (filter.matkaType) {
    conditions.push(eq(matkaBets.matkaType, filter.matkaType as any));
  }
  if (filter.matkaId) {
    conditions.push(eq(matkaBets.matkaId, filter.matkaId));
  }
  if (filter.marketSession) {
    conditions.push(eq(matkaBets.marketSession, filter.marketSession));
  }
  if (filter.playerId) {
    conditions.push(eq(matkaBets.userId, Number(filter.playerId)));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, DEFAULT_TZ);
    if (from) conditions.push(gte(matkaBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, DEFAULT_TZ);
    if (to) conditions.push(lte(matkaBets.createdAt, to));
  }
  if (filter.currency) {
    conditions.push(eq(matkaBets.currency, filter.currency));
  }
  // Settled-only: won/lost (matka has no 'settled' enum)
  conditions.push(inArray(matkaBets.status, ['won', 'lost']));

  return conditions;
}

/**
 * Enrich player breakdown rows with directAgentId, directAgentName, and full agentChain from users + agents.
 */
async function enrichPlayerBreakdownWithDirectAgent<T extends { playerId: number | null }>(
  rows: T[],
  filter: { agentId?: string; whitelabelId?: string },
  toOutput: (
    row: T,
    directAgentId: string | undefined,
    directAgentName: string | undefined,
    playerPhone: string | null | undefined,
    agentChain: string[],
  ) => Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const playerIds = rows.map((r) => r.playerId).filter((id): id is number => id != null);
  const playerPhonesMap = new Map<number, string | null>();
  const playerAgentIdMap = new Map<number, string | null>();
  if (playerIds.length > 0) {
    const players = await db
      .select({ id: users.id, agentId: users.agentId, phone: users.phone })
      .from(users)
      .where(inArray(users.id, playerIds));
    players.forEach((p) => {
      playerAgentIdMap.set(p.id, p.agentId ?? null);
      playerPhonesMap.set(p.id, p.phone ?? null);
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
      // An agent caller sees its own part of the chain only — from itself down —
      // never the usernames of its upline, nor an agent outside its subtree (a
      // referral-linked player may carry another agent's users.agent_id).
      let visible = ancestors;
      if (filter.agentId) {
        const self = ancestors.find((a) => a.ancestorId === filter.agentId);
        visible = self ? ancestors.filter((a) => a.depth <= self.depth) : [];
        if (!self) agentsOutsideCallerSubtree.add(agentId);
      }
      agentChainMap.set(agentId, visible.map((a) => agentNamesMap.get(a.ancestorId) || 'Unknown'));
    });
  }
  return rows.map((r) => {
    const rawAgentId = r.playerId ? playerAgentIdMap.get(r.playerId) ?? null : null;
    const displayAgentId = rawAgentId && !agentsOutsideCallerSubtree.has(rawAgentId) ? rawAgentId : null;
    const phone = r.playerId != null ? playerPhonesMap.get(r.playerId) ?? null : null;
    return toOutput(
      r,
      displayAgentId ?? undefined,
      displayAgentId ? (agentNamesMap.get(displayAgentId)?.trim() || 'Unknown') : undefined,
      phone,
      displayAgentId ? (agentChainMap.get(displayAgentId) ?? []) : [],
    );
  });
}

/**
 * Get matka type breakdown for drill-down
 */
export async function getMatkaTypeBreakdown(filter: MatkaDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  const results = await db
    .select({
      matkaType: matkaBets.matkaType,
      totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${matkaBets.actualWin}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
      marketCount: sql<number>`COUNT(DISTINCT ${matkaBets.matkaId})`,
    })
    .from(matkaBets)
    .where(and(...conditions, isNotNull(matkaBets.matkaType)))
    .groupBy(matkaBets.matkaType)
    .orderBy(desc(sql`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`));

  return results.map((r) => ({
    matkaType: r.matkaType || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    marketCount: Number(r.marketCount) || 0,
  }));
}

/**
 * Get matka market breakdown for drill-down
 */
export async function getMatkaMarketBreakdown(filter: MatkaDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  const results = await db
    .select({
      matkaId: matkaBets.matkaId,
      marketName: sql<string>`(SELECT name FROM ${matkas} WHERE id = ${matkaBets.matkaId})`,
      matkaType: matkaBets.matkaType,
      totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${matkaBets.actualWin}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
      sessionCount: sql<number>`COUNT(DISTINCT ${matkaBets.marketSession})`,
    })
    .from(matkaBets)
    .where(and(...conditions, isNotNull(matkaBets.matkaId)))
    .groupBy(matkaBets.matkaId, matkaBets.matkaType)
    .orderBy(desc(sql`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`));

  return results.map((r) => ({
    matkaId: r.matkaId,
    marketName: r.marketName || 'Unknown',
    matkaType: r.matkaType || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    sessionCount: Number(r.sessionCount) || 0,
  }));
}

/**
 * Get matka session breakdown for drill-down
 */
export async function getMatkaSessionBreakdown(filter: MatkaDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  const results = await db
    .select({
      marketSession: matkaBets.marketSession,
      matkaId: matkaBets.matkaId,
      marketName: sql<string>`(SELECT name FROM ${matkas} WHERE id = ${matkaBets.matkaId})`,
      totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${matkaBets.actualWin}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
    })
    .from(matkaBets)
    .where(and(...conditions, isNotNull(matkaBets.marketSession)))
    .groupBy(matkaBets.marketSession, matkaBets.matkaId)
    .orderBy(desc(sql`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`));

  return results.map((r) => ({
    marketSession: r.marketSession || 'Unknown',
    matkaId: r.matkaId,
    marketName: r.marketName || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
  }));
}

/**
 * Get matka agent breakdown for drill-down
 * Note: This requires joining with user-agent relationships
 */
export async function getMatkaAgentBreakdown(filter: MatkaDrillDownFilter) {
  const tenant = filter.tenant || filter.whitelabelId;
  const rows = await db.select({
    agentId: attributedAgentId,
    totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
    totalPayouts: sql<number>`COALESCE(SUM(${matkaBets.actualWin}::numeric), 0)`,
    betCount: sql<number>`COUNT(*)`, playerCount: sql<number>`COUNT(DISTINCT ${matkaBets.userId})`,
  }).from(matkaBets).innerJoin(users, eq(matkaBets.userId, users.id))
    .leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant))
    .leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant))
    .where(and(...buildBetConditions(filter), isNotNull(attributedAgentId))).groupBy(attributedAgentId);
  const ids = rows.map(row => row.agentId).filter((id): id is string => !!id);
  const mapped = filter.agentId ? await resolveAgentsToDirectChildren(filter.agentId, ids)
    : tenant ? await resolveAgentsToTopLevel(tenant, ids) : new Map(ids.map(id => [id, id]));
  const totals = new Map<string, { agentId: string; totalStakes: number; totalPayouts: number; grossGamingRevenue: number; betCount: number; playerCount: number }>();
  for (const row of rows) {
    const id = row.agentId ? mapped.get(row.agentId) : null;
    if (!id) continue;
    const current = totals.get(id) || { agentId: id, totalStakes: 0, totalPayouts: 0, grossGamingRevenue: 0, betCount: 0, playerCount: 0 };
    current.totalStakes += Number(row.totalStakes); current.totalPayouts += Number(row.totalPayouts);
    current.grossGamingRevenue = current.totalStakes - current.totalPayouts;
    current.betCount += Number(row.betCount); current.playerCount += Number(row.playerCount); totals.set(id, current);
  }
  if (!totals.size) return [];
  const names = await db.select({ id: agents.id, username: agentCredentials.username, phone: agents.phone }).from(agents)
    .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId)).where(inArray(agents.id, [...totals.keys()]));
  const labels = new Map(names.map(row => [row.id, row.username || row.phone || row.id]));
  return [...totals.values()].map(row => ({ ...row, agentName: labels.get(row.agentId) || row.agentId, commission: 0 })).sort((a, b) => b.totalStakes - a.totalStakes);
}

/**
 * Get matka player breakdown for drill-down
 */
export async function getMatkaPlayerBreakdown(filter: MatkaDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  const results = await db
    .select({
      playerId: matkaBets.userId,
      playerUsername: sql<string>`(SELECT username FROM ${users} WHERE id = ${matkaBets.userId})`,
      totalStakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${matkaBets.actualWin}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      avgStake: sql<number>`COALESCE(AVG(${matkaBets.betAmount}::numeric), 0)`,
      winRate: sql<number>`COUNT(*) FILTER (WHERE ${matkaBets.status} = 'won')::numeric / NULLIF(COUNT(*), 0)`,
    })
    .from(matkaBets)
    .where(and(...conditions, isNotNull(matkaBets.userId)))
    .groupBy(matkaBets.userId)
    .orderBy(desc(sql`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`));

  const rows = results.map((r) => ({
    playerId: r.playerId,
    playerUsername: r.playerUsername || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    avgStake: Number(r.avgStake) || 0,
    winRate: Number(r.winRate) || 0,
  }));
  return enrichPlayerBreakdownWithDirectAgent(rows, filter, (row, directAgentId, directAgentName, playerPhone, agentChain) => ({
    ...row,
    directAgentId,
    directAgentName,
    agentChain,
    playerPhone: playerPhone ?? null,
  }));
}

