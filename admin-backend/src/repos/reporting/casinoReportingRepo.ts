import { attributedAgentId, referralAttributions as financialReferrals, referrerUsers, referralAttributionJoinOn, referrerJoinOn } from '@src/domains/agents/services/commissionPlayerScope.js'
import { financialSnapshotsAreCurrent } from './snapshotFreshness.js'
import { db } from '@/db/client.js';
import {
  reportingDailySnapshots,
  casinoBets,
  casinoApiProviders,
  casinoVendors,
  casinoGames,
  agents,
  agentCredentials,
  users,
  agentHierarchyClosure,
  referralAttributions,
} from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, desc, asc, isNotNull, isNull, inArray } from 'drizzle-orm';
import { inAgentPlayers, callerVisibleChain } from './agentPlayerScope.js';
import { DateTime } from 'luxon';
import { buildAgentFilterCTE, userConditionForReduce, isEmptySqlCondition } from '../common/AgentFilterUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { coerceReportingRangeStart, coerceReportingRangeEnd } from '@src/shared/dateUtils.js';
import { sqlDateBucketText } from '@src/shared/reportingSql.js';

export interface CasinoReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
}

export interface CasinoDrillDownFilter {
  tenant?: string;
  whitelabelId?: string;
  providerId?: string | number;
  vendorId?: string | number;
  gameId?: string | number;
  agentId?: string;
  playerId?: string | number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  currency?: string;
}

export interface CasinoKPIs {
  totalStakes: number;
  totalPayouts: number;
  grossGamingRevenue: number;
  netRevenue: number;
  holdPercentage: number;
  betCount: number;
  playerCount: number;
  activePlayerCount: number;
}

export interface CasinoTrendPoint {
  date: string;
  stakes: number;
  payouts: number;
  ggr: number;
  betCount: number;
  playerCount: number;
}

const DEFAULT_TZ = 'Asia/Kolkata';

async function getTenantTimezone(tenantId: string | undefined): Promise<string> {
  if (!tenantId) return DEFAULT_TZ;
  try {
    const tz = await getWhitelabelTimezone(tenantId);
    return tz && tz.trim() ? tz.trim() : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * When true, range touches "today" in tenant TZ — use live bets so intraday GGR stays fresh.
 */
async function rangeIncludesToday(filter: CasinoReportingFilter): Promise<boolean> {
  const tz = await getTenantTimezone(filter.tenant);
  const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  const dateTo =
    filter.dateTo != null ? (coerceReportingRangeEnd(filter.dateTo, tz) ?? new Date()) : new Date();
  if (isNaN(dateTo.getTime())) return true;
  const dateToStr = DateTime.fromJSDate(dateTo, { zone: tz }).toFormat('yyyy-MM-dd');
  return dateToStr >= todayStr || !await financialSnapshotsAreCurrent(filter, 'casino', tz);
}

/**
 * Dashboard casino KPIs: prefer `reporting_daily_snapshots` (official rollups) when the range
 * is fully in the past; fallback to `casino_bets` if snapshots are missing/empty.
 * Live vs local mismatch with an imported DB usually means one side hit fallback (bets) and
 * the other used snapshots — verify both tables imported and tenant filters match.
 */
export async function getCasinoKPIs(filter: CasinoReportingFilter): Promise<CasinoKPIs> {
  if (await rangeIncludesToday(filter)) {
    return getCasinoKPIsFromBets(filter);
  }

  const conditions = buildConditions(filter);

  if (filter.agentId) {
    const agentConditions = await buildAgentHierarchyFilter(filter.agentId, filter.tenant);
    conditions.push(...agentConditions);
  } else {
    // Global snapshots: agentId and playerId both null (agentId null + playerId not null = player-level)
    conditions.push(isNull(reportingDailySnapshots.agentId));
    conditions.push(isNull(reportingDailySnapshots.playerId));
  }

  const result = await db
    .select({
      totalStakes: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalPayouts}::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      netRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.netRevenue}::numeric), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
      playerCount: snapshotPlayerCountExpr(Boolean(filter.agentId), 'playerCount'),
      activePlayerCount: snapshotPlayerCountExpr(Boolean(filter.agentId), 'activePlayerCount'),
    })
    .from(reportingDailySnapshots)
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'casino')));

  const kpis = result[0] || {
    totalStakes: 0,
    totalPayouts: 0,
    grossGamingRevenue: 0,
    netRevenue: 0,
    betCount: 0,
    playerCount: 0,
    activePlayerCount: 0,
  };

  const totalStakes = Number(kpis.totalStakes) || 0;
  const totalPayouts = Number(kpis.totalPayouts) || 0;
  const betCount = Number(kpis.betCount) || 0;

  if (result.length === 0 || (totalStakes === 0 && totalPayouts === 0 && betCount === 0)) {
    return getCasinoKPIsFromBets(filter);
  }

  const ggr = Number(kpis.grossGamingRevenue) || 0;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;

  return {
    totalStakes,
    totalPayouts,
    grossGamingRevenue: ggr,
    netRevenue: Number(kpis.netRevenue) || 0,
    holdPercentage,
    betCount,
    playerCount: Number(kpis.playerCount) || 0,
    activePlayerCount: Number(kpis.activePlayerCount) || 0,
  };
}

/** Live aggregates from casino_bets (settled cash, date on createdAt). */
async function getCasinoKPIsFromBets(filter: CasinoReportingFilter): Promise<CasinoKPIs> {
  const betConditions: any[] = [];
  const tz = await getTenantTimezone(filter.tenant);

  if (filter.tenant) {
    betConditions.push(eq(casinoBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    betConditions.push(eq(casinoBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, tz);
    if (from) betConditions.push(gte(casinoBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, tz);
    if (to) betConditions.push(lte(casinoBets.createdAt, to));
  }
  if (filter.currency) {
    betConditions.push(eq(casinoBets.currency, filter.currency));
  }
  betConditions.push(inArray(casinoBets.status, ['won', 'lost']));
  // Cash only: align with commission and snapshots (bonus/referralBonus do not generate commission)
  betConditions.push(eq(casinoBets.walletType, 'cash'));

  let query = db
    .select({
      totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(COALESCE(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
    })
    .from(casinoBets)
    .leftJoin(users, eq(casinoBets.userId, users.id));

  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    betConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const result = await query.where(and(...betConditions));
  const row = result[0] || {
    totalStakes: 0,
    totalPayouts: 0,
    betCount: 0,
    playerCount: 0,
  };

  const totalStakes = Number(row.totalStakes) || 0;
  const totalPayouts = Number(row.totalPayouts) || 0;
  const ggr = totalStakes - totalPayouts;
  const holdPercentage = totalStakes > 0 ? ggr / totalStakes : 0;

  return {
    totalStakes,
    totalPayouts,
    grossGamingRevenue: ggr,
    netRevenue: ggr,
    holdPercentage,
    betCount: Number(row.betCount) || 0,
    playerCount: Number(row.playerCount) || 0,
    activePlayerCount: Number(row.playerCount) || 0,
  };
}

/**
 * Fallback: Get casino trends directly from casinoBets table (real-time)
 */
async function getCasinoTrendsFromBets(filter: CasinoReportingFilter): Promise<CasinoTrendPoint[]> {
  const betConditions: any[] = [];
  const tz = await getTenantTimezone(filter.tenant);
  const dateBucket = sqlDateBucketText(casinoBets.createdAt, tz);

  if (filter.tenant) {
    betConditions.push(eq(casinoBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    betConditions.push(eq(casinoBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, tz);
    if (from) betConditions.push(gte(casinoBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, tz);
    if (to) betConditions.push(lte(casinoBets.createdAt, to));
  }
  if (filter.currency) {
    betConditions.push(eq(casinoBets.currency, filter.currency));
  }
  betConditions.push(inArray(casinoBets.status, ['won', 'lost']));
  betConditions.push(eq(casinoBets.walletType, 'cash'));

  let query = db
    .select({
      date: dateBucket,
      stakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      payouts: sql<number>`COALESCE(SUM(COALESCE(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
    })
    .from(casinoBets)
    .leftJoin(users, eq(casinoBets.userId, users.id));

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
 * Casino trends: snapshot rollups for past-only ranges; else / empty → {@link getCasinoTrendsFromBets}.
 */
export async function getCasinoTrends(filter: CasinoReportingFilter): Promise<CasinoTrendPoint[]> {
  if (await rangeIncludesToday(filter)) {
    return getCasinoTrendsFromBets(filter);
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
    .where(and(...conditions, eq(reportingDailySnapshots.domain, 'casino')))
    .groupBy(snapshotDayBucket)
    .orderBy(asc(snapshotDayBucket));

  if (results.length === 0) {
    return getCasinoTrendsFromBets(filter);
  }

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
 * Agent scope for snapshot reads: the PLAYER-LEVEL rows of the agent's players.
 *
 * This matched `agent_id IN subtree` with no `player_id` filter, so each day's
 * agent-level row (player_id NULL) and the player-level rows it was rolled up
 * from were summed together — the agent's KPIs and trends were doubled — and
 * players who reached the agent by referral were missed.
 */
async function buildAgentHierarchyFilter(agentId: string | undefined, tenant?: string): Promise<any[]> {
  if (!agentId) return [];
  return [
    isNotNull(reportingDailySnapshots.playerId),
    inAgentPlayers(reportingDailySnapshots.playerId, agentId, tenant),
  ];
}

/** Player counts: per-player rows each carry playerCount = 1, so an agent's count is the distinct players. */
function snapshotPlayerCountExpr(agentScoped: boolean, column: 'playerCount' | 'activePlayerCount') {
  return agentScoped
    ? sql<number>`COUNT(DISTINCT ${reportingDailySnapshots.playerId})`
    : sql<number>`COALESCE(MAX(${reportingDailySnapshots[column]}), 0)`;
}

async function getAgentPlayerIds(agentId: string | undefined, tenant: string): Promise<number[]> {
  if (!agentId) return []
  
  // Get all descendant agents (including self)
  const descendants = await db
    .select({ descendantId: agentHierarchyClosure.descendantId })
    .from(agentHierarchyClosure)
    .where(eq(agentHierarchyClosure.ancestorId, agentId))
  
  const allAgentIds = [agentId, ...descendants.map(d => d.descendantId)]
  
  // Get users where agentId matches these agents
  const agentUsers = await db
    .select({ userId: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant, tenant),
        inArray(users.agentId as any, allAgentIds)
      )
    )
  
  const agentUserIds = agentUsers.map(u => u.userId)
  
  if (agentUserIds.length === 0) return []
  
  // Get players referred by these agent users
  const playerAttributions = await db
    .select({ refereeId: referralAttributions.refereeId })
    .from(referralAttributions)
    .where(
      and(
        eq(referralAttributions.tenant, tenant),
        eq(referralAttributions.status, 'confirmed'),
        inArray(referralAttributions.referrerId, agentUserIds)
      )
    )
  
  return playerAttributions.map(p => p.refereeId)
}

function buildConditions(filter: CasinoReportingFilter | CasinoDrillDownFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, DEFAULT_TZ);
    if (from) conditions.push(gte(reportingDailySnapshots.snapshotDate, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, DEFAULT_TZ);
    if (to) conditions.push(lte(reportingDailySnapshots.snapshotDate, to));
  }
  if (filter.currency) {
    conditions.push(eq(reportingDailySnapshots.currency, filter.currency));
  }

  return conditions;
}

function buildBetConditions(filter: CasinoDrillDownFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(casinoBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(casinoBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.providerId) {
    conditions.push(eq(casinoBets.providerId, Number(filter.providerId)));
  }
  if (filter.vendorId) {
    conditions.push(eq(casinoBets.vendorId, Number(filter.vendorId)));
  }
  if (filter.gameId) {
    conditions.push(eq(casinoBets.gameId, Number(filter.gameId)));
  }
  if (filter.playerId) {
    conditions.push(eq(casinoBets.userId, Number(filter.playerId)));
  }
  if (filter.dateFrom) {
    const from = coerceReportingRangeStart(filter.dateFrom, DEFAULT_TZ);
    if (from) conditions.push(gte(casinoBets.createdAt, from));
  }
  if (filter.dateTo) {
    const to = coerceReportingRangeEnd(filter.dateTo, DEFAULT_TZ);
    if (to) conditions.push(lte(casinoBets.createdAt, to));
  }
  if (filter.currency) {
    conditions.push(eq(casinoBets.currency, filter.currency));
  }
  // Settled-only: won/lost
  conditions.push(inArray(casinoBets.status, ['won', 'lost']));
  conditions.push(eq(casinoBets.walletType, 'cash'));

  return conditions;
}

/**
 * Resolve agent IDs to the direct child of the given parent (logged-in agent).
 */
export async function resolveAgentsToDirectChildren(
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

/**
 * Resolve agent IDs to their top-level (direct-under-whitelabel) agent for display.
 * Returns map: agentId -> topLevelAgentId.
 */
export async function resolveAgentsToTopLevel(
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
  const playerNamesMap = new Map<number, string | null>();
  const playerPhonesMap = new Map<number, string | null>();
  const playerAgentIdMap = new Map<number, string | null>();
  if (playerIds.length > 0) {
    const players = await db
      .select({ id: users.id, username: users.username, phone: users.phone, agentId: users.agentId })
      .from(users)
      .where(inArray(users.id, playerIds));
    players.forEach((p) => {
      playerNamesMap.set(p.id, p.username ?? null);
      playerPhonesMap.set(p.id, p.phone ?? null);
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
 * Get casino provider breakdown for drill-down
 */
export async function getCasinoProviderBreakdown(filter: CasinoDrillDownFilter) {
  const tenant = filter.tenant || 'default'
  const { cte, userCondition } = buildAgentFilterCTE(filter.agentId, tenant, 'cb.user_id')
  
  // Build WHERE conditions using Drizzle safely (settled-only: won/lost)
  const whereConditions: any[] = []
  if (filter.tenant) whereConditions.push(sql`cb.tenant = ${filter.tenant}`)
  if (filter.whitelabelId) whereConditions.push(sql`cb.whitelabel_id = ${filter.whitelabelId}`)
  if (filter.providerId) whereConditions.push(sql`cb.provider_id = ${Number(filter.providerId)}`)
  if (filter.vendorId) whereConditions.push(sql`cb.vendor_id = ${Number(filter.vendorId)}`)
  if (filter.gameId) whereConditions.push(sql`cb.game_id = ${Number(filter.gameId)}`)
  if (filter.playerId) whereConditions.push(sql`cb.user_id = ${Number(filter.playerId)}`)
  const timezone = await getTenantTimezone(filter.tenant)
  const rangeFrom = filter.dateFrom ? coerceReportingRangeStart(filter.dateFrom, timezone) : null
  const rangeTo = filter.dateTo ? coerceReportingRangeEnd(filter.dateTo, timezone) : null
  if (rangeFrom) whereConditions.push(sql`cb.created_at >= ${rangeFrom.toISOString()}`)
  if (rangeTo) whereConditions.push(sql`cb.created_at <= ${rangeTo.toISOString()}`)
  if (filter.currency) whereConditions.push(sql`cb.currency = ${filter.currency}`)
  whereConditions.push(sql`cb.status IN ('won', 'lost')`)
  whereConditions.push(sql`cb.wallet_type = 'cash'`)
  whereConditions.push(sql`cb.provider_id IS NOT NULL`)
    // Add agent player filter if agentId is provided
    if (filter.agentId) {
      // Create the condition directly without AND prefix
      whereConditions.push(sql.raw(`cb.user_id IN (SELECT player_id FROM agent_players)`))
    }
    
    // isEmptySqlCondition now genuinely detects empty fragments, so a single
    // pass is enough. This previously ran three identical filters in sequence
    // plus per-condition re-checks inside the reduce, all resting on a helper
    // that could never return true.
    const activeConditions = whereConditions.filter((cond) => !isEmptySqlCondition(cond))

    const whereClause = activeConditions.length > 0
      ? sql`WHERE ${activeConditions.reduce((acc, cond, idx) => (idx === 0 ? cond : sql`${acc} AND ${cond}`))}`
      : sql``
  
  const results = await db.execute(sql`
    ${cte}
    SELECT
      cb.provider_id as provider_id,
      (SELECT name FROM casino_api_providers WHERE id = cb.provider_id) as provider_name,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) as total_stakes,
      COALESCE(SUM(CAST(cb.payout AS DECIMAL)), 0) as total_payouts,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL) - COALESCE(CAST(cb.payout AS DECIMAL), 0)), 0) as gross_gaming_revenue,
      COUNT(*) as bet_count,
      COUNT(DISTINCT cb.user_id) as player_count,
      COUNT(DISTINCT cb.game_id) as game_count
      FROM casino_bets cb
      ${whereClause}
      GROUP BY cb.provider_id
      ORDER BY COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) DESC
  `)

  return (results.rows || []).map((r: any) => ({
    providerId: r.provider_id,
    providerName: r.provider_name || 'Unknown',
    totalStakes: Number(r.total_stakes) || 0,
    totalPayouts: Number(r.total_payouts) || 0,
    grossGamingRevenue: Number(r.gross_gaming_revenue) || 0,
    betCount: Number(r.bet_count) || 0,
    playerCount: Number(r.player_count) || 0,
    gameCount: Number(r.game_count) || 0,
  }));
}

/**
 * Get casino vendor breakdown for drill-down.
 * When agentId is set, filters by players whose users.agentId is in agent hierarchy (same as getCasinoKPIs/getCasinoTrends).
 */
export async function getCasinoVendorBreakdown(filter: CasinoDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  if (filter.agentId) {
conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));

    const results = await db
      .select({
        vendorId: casinoBets.vendorId,
        vendorName: sql<string>`(SELECT name FROM ${casinoVendors} WHERE id = ${casinoBets.vendorId})`,
        providerId: casinoBets.providerId,
        totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
        totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
        grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
        betCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
        gameCount: sql<number>`COUNT(DISTINCT ${casinoBets.gameId})`,
      })
      .from(casinoBets)
      .leftJoin(users, eq(casinoBets.userId, users.id))
      .where(and(...conditions, isNotNull(casinoBets.vendorId)))
      .groupBy(casinoBets.vendorId, casinoBets.providerId)
      .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

    return results.map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName || 'Unknown',
      providerId: r.providerId,
      totalStakes: Number(r.totalStakes) || 0,
      totalPayouts: Number(r.totalPayouts) || 0,
      grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
      betCount: Number(r.betCount) || 0,
      playerCount: Number(r.playerCount) || 0,
      gameCount: Number(r.gameCount) || 0,
    }));
  }

  const results = await db
    .select({
      vendorId: casinoBets.vendorId,
      vendorName: sql<string>`(SELECT name FROM ${casinoVendors} WHERE id = ${casinoBets.vendorId})`,
      providerId: casinoBets.providerId,
      totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
      gameCount: sql<number>`COUNT(DISTINCT ${casinoBets.gameId})`,
    })
    .from(casinoBets)
    .where(and(...conditions, isNotNull(casinoBets.vendorId)))
    .groupBy(casinoBets.vendorId, casinoBets.providerId)
    .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

  return results.map((r) => ({
    vendorId: r.vendorId,
    vendorName: r.vendorName || 'Unknown',
    providerId: r.providerId,
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    gameCount: Number(r.gameCount) || 0,
  }));
}

/**
 * Get casino game breakdown for drill-down.
 * When agentId is set, filters by players whose users.agentId is in agent hierarchy (same as getCasinoKPIs/getCasinoTrends).
 */
export async function getCasinoGameBreakdown(filter: CasinoDrillDownFilter) {
  const conditions = buildBetConditions(filter);

  if (filter.agentId) {
conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));

    const queryResults = await db
      .select({
        gameId: casinoBets.gameId,
        gameName: sql<string>`(SELECT name FROM ${casinoGames} WHERE id = ${casinoBets.gameId})`,
        vendorId: casinoBets.vendorId,
        vendorName: sql<string>`(SELECT name FROM ${casinoVendors} WHERE id = ${casinoBets.vendorId})`,
        totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
        totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
        grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
        betCount: sql<number>`COUNT(*)`,
        playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
        rtp: sql<number>`(SELECT rtp FROM ${casinoGames} WHERE id = ${casinoBets.gameId})`,
      })
      .from(casinoBets)
      .leftJoin(users, eq(casinoBets.userId, users.id))
      .where(and(...conditions, isNotNull(casinoBets.gameId)))
      .groupBy(casinoBets.gameId, casinoBets.vendorId)
      .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

    return queryResults.map((r) => ({
      gameId: r.gameId,
      gameName: r.gameName || 'Unknown',
      vendorId: r.vendorId,
      vendorName: r.vendorName || 'Unknown',
      totalStakes: Number(r.totalStakes) || 0,
      totalPayouts: Number(r.totalPayouts) || 0,
      grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
      betCount: Number(r.betCount) || 0,
      playerCount: Number(r.playerCount) || 0,
      rtp: r.rtp ? Number(r.rtp) : null,
    }));
  }

  const queryResults = await db
    .select({
      gameId: casinoBets.gameId,
      gameName: sql<string>`(SELECT name FROM ${casinoGames} WHERE id = ${casinoBets.gameId})`,
      vendorId: casinoBets.vendorId,
      vendorName: sql<string>`(SELECT name FROM ${casinoVendors} WHERE id = ${casinoBets.vendorId})`,
      totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
      rtp: sql<number>`(SELECT rtp FROM ${casinoGames} WHERE id = ${casinoBets.gameId})`,
    })
    .from(casinoBets)
    .where(and(...conditions, isNotNull(casinoBets.gameId)))
    .groupBy(casinoBets.gameId, casinoBets.vendorId)
    .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

  return queryResults.map((r) => ({
    gameId: r.gameId,
    gameName: r.gameName || 'Unknown',
    vendorId: r.vendorId,
    vendorName: r.vendorName || 'Unknown',
    totalStakes: Number(r.totalStakes) || 0,
    totalPayouts: Number(r.totalPayouts) || 0,
    grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
    betCount: Number(r.betCount) || 0,
    playerCount: Number(r.playerCount) || 0,
    rtp: r.rtp ? Number(r.rtp) : null,
  }));
}

/**
 * Get casino agent breakdown for drill-down
 * Aggregates casino bets by agent (via users.agentId), filtered by vendorId/gameId/date.
 */
export async function getCasinoAgentBreakdown(filter: CasinoDrillDownFilter) {
  const conditions = buildBetConditions(filter);
  conditions.push(isNotNull(attributedAgentId));

  if (filter.agentId) {
conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const results = await db
    .select({
      agentId: attributedAgentId,
      totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      betCount: sql<number>`COUNT(*)`,
      playerCount: sql<number>`COUNT(DISTINCT ${casinoBets.userId})`,
    })
    .from(casinoBets)
    .innerJoin(users, eq(casinoBets.userId, users.id))
    .leftJoin(financialReferrals, referralAttributionJoinOn(filter.tenant || filter.whitelabelId || users.tenant))
    .leftJoin(referrerUsers, referrerJoinOn(filter.tenant || filter.whitelabelId || users.tenant))
    .where(and(...conditions))
    .groupBy(attributedAgentId)
    .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

  const agentIds = results.map((r) => r.agentId).filter((id): id is string => id != null);
  const rollup = new Map<string, { totalStakes: number; totalPayouts: number; grossGamingRevenue: number; betCount: number; playerCount: number }>();

  if (filter.agentId && filter.whitelabelId) {
    const agentIdToDirectChild = await resolveAgentsToDirectChildren(filter.agentId, agentIds);
    for (const r of results) {
      const directChildId = r.agentId ? agentIdToDirectChild.get(r.agentId) : null;
      if (!directChildId) continue;
      const v = {
        totalStakes: Number(r.totalStakes) || 0,
        totalPayouts: Number(r.totalPayouts) || 0,
        grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
        betCount: Number(r.betCount) || 0,
        playerCount: Number(r.playerCount) || 0,
      };
      const existing = rollup.get(directChildId);
      if (existing) {
        existing.totalStakes += v.totalStakes;
        existing.totalPayouts += v.totalPayouts;
        existing.grossGamingRevenue += v.grossGamingRevenue;
        existing.betCount += v.betCount;
        existing.playerCount += v.playerCount;
      } else {
        rollup.set(directChildId, v);
      }
    }
  } else if (filter.whitelabelId) {
    const agentIdToTopLevel = await resolveAgentsToTopLevel(filter.whitelabelId, agentIds);
    for (const r of results) {
      const topLevelId = r.agentId ? (agentIdToTopLevel.get(r.agentId) ?? r.agentId) : null;
      if (!topLevelId) continue;
      const v = {
        totalStakes: Number(r.totalStakes) || 0,
        totalPayouts: Number(r.totalPayouts) || 0,
        grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
        betCount: Number(r.betCount) || 0,
        playerCount: Number(r.playerCount) || 0,
      };
      const existing = rollup.get(topLevelId);
      if (existing) {
        existing.totalStakes += v.totalStakes;
        existing.totalPayouts += v.totalPayouts;
        existing.grossGamingRevenue += v.grossGamingRevenue;
        existing.betCount += v.betCount;
        existing.playerCount += v.playerCount;
      } else {
        rollup.set(topLevelId, v);
      }
    }
  } else {
    for (const r of results) {
      if (!r.agentId) continue;
      rollup.set(r.agentId, {
        totalStakes: Number(r.totalStakes) || 0,
        totalPayouts: Number(r.totalPayouts) || 0,
        grossGamingRevenue: Number(r.grossGamingRevenue) || 0,
        betCount: Number(r.betCount) || 0,
        playerCount: Number(r.playerCount) || 0,
      });
    }
  }

  const agentIdsToFetch = [...rollup.keys()];
  const agentNamesMap = new Map<string, string>();
  if (agentIdsToFetch.length > 0) {
    const agentList = await db
      .select({ id: agents.id, username: agentCredentials.username })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(inArray(agents.id, agentIdsToFetch));
    agentList.forEach((row) => agentNamesMap.set(row.id, row.username ?? row.id));
  }

  return [...rollup.entries()].map(([agentId, v]) => ({
    agentId,
    agentName: agentNamesMap.get(agentId) ?? agentId,
    totalStakes: v.totalStakes,
    totalPayouts: v.totalPayouts,
    grossGamingRevenue: v.grossGamingRevenue,
    betCount: v.betCount,
    playerCount: v.playerCount,
    commission: 0,
  }));
}

/**
 * Get casino player breakdown for drill-down.
 * Agent filter uses users.agent_id (agent hierarchy), same as getCasinoKPIsFromBets and sports,
 * so agents see all their assigned players' casino activity, not only referred players.
 */
export async function getCasinoPlayerBreakdown(filter: CasinoDrillDownFilter) {
  const conditions = buildBetConditions(filter);
  conditions.push(isNotNull(casinoBets.userId));

  // Agent filter: restrict to players whose users.agent_id is in agent hierarchy (same as sports/KPIs)
  if (filter.agentId) {
    // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
    conditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
  }

  const baseQuery = db
    .select({
      playerId: casinoBets.userId,
      playerUsername: sql<string>`(SELECT username FROM ${users} WHERE id = ${casinoBets.userId})`,
      totalStakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      totalPayouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`,
      betCount: sql<number>`COUNT(*)`,
      avgStake: sql<number>`COALESCE(AVG(${casinoBets.stake}::numeric), 0)`,
      winRate: sql<number>`COUNT(*) FILTER (WHERE ${casinoBets.status} = 'won')::numeric / NULLIF(COUNT(*), 0)`,
    })
    .from(casinoBets)
    .leftJoin(users, eq(casinoBets.userId, users.id))
    .where(and(...conditions))
    .groupBy(casinoBets.userId)
    .orderBy(desc(sql`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`));

  const results = await baseQuery;

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

