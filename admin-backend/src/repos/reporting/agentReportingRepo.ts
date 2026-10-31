import { financialSnapshotsAreCurrent } from './snapshotFreshness.js'
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js'
import { attributedAgentId, referralAttributions, referrerUsers, referralAttributionJoinOn, referrerJoinOn } from '@src/domains/agents/services/commissionPlayerScope.js'
import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { db } from '@/db/client.js';
import {
  reportingDailySnapshots,
  reportingAgentRollups,
  agents,
  agentCommissionConfig,
  agentSharingConfig,
  agentCredentials,
  users,
  agentHierarchyClosure,
  whitelabelSharingConfig,
  sportsBets,
  casinoBets,
  matkaBets,
} from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, desc, isNotNull, inArray, or, isNull } from 'drizzle-orm';
import { inAgentPlayers } from './agentPlayerScope.js';
import { createAgentPerformanceReads, performanceScope } from './agentPerformanceReads.js';
import { getStartOfDay, getEndOfYesterday, getEndOfDayForDate, parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';

export interface AgentReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  agentId?: string;
  parentAgentId?: string; // Filter to show only direct sub-agents of this agent
  schemeType?: 'COMMISSION' | 'SHARING' | 'CREDIT'; // Whitelabel: filter root agents by type
  dateFrom?: Date | string;
  dateTo?: Date | string;
  domain?: 'sports' | 'casino' | 'matka';
  currency?: string;
}

export interface AgentKPIs {
  totalTurnover: number;
  totalGGR: number;
  commissionEarned: number;
  shareEarned: number;
  downlineTurnover: number;
  downlineGGR: number;
  playerCount: number;
  activePlayerCount: number;
  betCount: number;
  agentCount: number;
}

export interface AgentPerformanceDomainBreakdown {
  domain: 'sports' | 'casino' | 'matka';
  turnover: number;
  ggr: number;
  cut: number;
  cutPercent: number; // % of total GGR that is agent's cut in this domain
  userCutPercent?: number; // for "user% − agent% = cut%" in domain cut columns
  agentCutPercent?: number;
}

export interface AgentPerformance {
  agentId: string;
  agentName?: string;
  schemeType?: string;
  totalTurnover: number;
  totalGGR: number;
  commissionEarned: number;
  shareEarned: number;
  downlineTurnover: number;
  downlineGGR: number;
  playerCount: number;
  betCount: number;
  level: number;
  /** Cut formula: userCutPercent - agentCutPercent = cut %. GGR-weighted across domains. */
  userCutPercent?: number;
  agentCutPercent?: number;
  domainBreakdown?: AgentPerformanceDomainBreakdown[];
}

export interface AgentPerformanceTotals {
  totalTurnover: number;
  totalGGR: number;
  commissionEarned: number;
  shareEarned: number;
  agentCount: number;
  playerCount: number;
  betCount: number;
}

export interface AgentPerformanceResult {
  agents: AgentPerformance[];
  totals: AgentPerformanceTotals | null;
}

export interface AgentTrendPoint {
  date: string;
  turnover: number;
  ggr: number;
  commission: number;
  share: number;
  playerCount: number;
}

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

async function normalizedAgentFilter(filter: AgentReportingFilter): Promise<AgentReportingFilter> {
  const tenant = filter.tenant || filter.whitelabelId;
  return { ...filter, tenant, currency: filter.currency || (tenant ? await getWhitelabelCurrency(tenant) : undefined) };
}
async function agentSnapshotsCurrent(filter: AgentReportingFilter, timezone: string) {
  const domains = filter.domain ? [filter.domain] : ['sports', 'casino', 'matka'] as const;
  return (await Promise.all(domains.map(domain => financialSnapshotsAreCurrent(filter, domain, timezone)))).every(Boolean);
}

async function activeAgentPlayers(filter: AgentReportingFilter, agentIds: string[], timezone: string): Promise<number> {
  if (!agentIds.length) return 0;
  const tenant = filter.tenant || filter.whitelabelId;
  const owned = db.select({ id: users.id }).from(users)
    .leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant))
    .leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant))
    .where(and(inArray(attributedAgentId, agentIds), tenant ? eq(users.tenant, tenant) : undefined));
  const from = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), timezone) : null;
  const to = filter.dateTo ? parseDateTo(String(filter.dateTo), timezone) : new Date();
  const domains = filter.domain ? [filter.domain] : ['sports', 'casino', 'matka'] as const;
  const selects = domains.map(domain => sql`SELECT user_id FROM ${sql.raw(domain + '_bets')} WHERE user_id IN (${owned})
    AND ${domain === 'sports' ? sql`status IN ('won','lost','settled')` : sql`status IN ('won','lost')`}
    ${domain === 'casino' ? sql`AND wallet_type='cash'` : sql``}
    ${tenant ? sql`AND tenant=${tenant}` : sql``} ${filter.currency ? sql`AND currency=${filter.currency}` : sql``}
    ${from ? sql`AND created_at >= ${from.toISOString()}` : sql``} AND created_at <= ${to.toISOString()}`);
  const result = await db.execute(sql`SELECT COUNT(DISTINCT user_id)::int count FROM (${sql.join(selects, sql` UNION ALL `)}) activity`);
  return Number(result.rows[0]?.count || 0);
}

/**
 * Get agent KPIs for a date range
 * Uses reportingDailySnapshots with agentId filter as primary source
 * When dateTo >= startOfToday(tenant TZ), merges snapshot [dateFrom, endOfYesterday] with live bets for today
 */
export async function getAgentKPIs(filter: AgentReportingFilter): Promise<AgentKPIs> {
  filter = await normalizedAgentFilter(filter);
  const tz = await getTenantTimezone(filter.tenant);
  const startOfToday = getStartOfDay(tz);
  const endOfYesterday = getEndOfYesterday(tz);
  const dateToVal = filter.dateTo ? parseDateTo(String(filter.dateTo), tz) : new Date();
  const snapshotsCurrent = await agentSnapshotsCurrent(filter, tz);
  const rangeIncludesToday = dateToVal && dateToVal >= startOfToday;

  // Snapshot conditions: for hybrid, use endOfYesterday as snapshot dateTo
  // When agentId is set, include full downline (self + descendants) so GGR matches ggrTrends / drilldown
  let agentIdList: string[] = [];
  if (filter.agentId) {
    const descendants = await db
      .select({ descendantId: agentHierarchyClosure.descendantId })
      .from(agentHierarchyClosure)
      .where(eq(agentHierarchyClosure.ancestorId, filter.agentId));
    agentIdList = [filter.agentId, ...descendants.map((r) => r.descendantId).filter((id) => id !== filter.agentId)];
  }

  const snapshotConditions = [];
  if (filter.tenant) {
    snapshotConditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    snapshotConditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  if (filter.agentId && agentIdList.length > 0) {
    snapshotConditions.push(inArray(reportingDailySnapshots.agentId, agentIdList));
    // Use only agent-level snapshots (playerId IS NULL) to avoid double-counting GGR:
    // player-level rows duplicate the same GGR that is already rolled up in agent-level rows.
    snapshotConditions.push(isNull(reportingDailySnapshots.playerId));
  } else if (!filter.agentId) {
    snapshotConditions.push(isNotNull(reportingDailySnapshots.agentId));
  }
  if (filter.dateFrom) {
    snapshotConditions.push(gte(reportingDailySnapshots.snapshotDate, parseDateFrom(String(filter.dateFrom), tz)));
  }
  if (filter.dateTo) {
    const snapshotDateTo = rangeIncludesToday ? endOfYesterday : parseDateTo(String(filter.dateTo), tz);
    snapshotConditions.push(lte(reportingDailySnapshots.snapshotDate, snapshotDateTo));
  }
  if (filter.domain) {
    snapshotConditions.push(eq(reportingDailySnapshots.domain, filter.domain));
  } else {
    snapshotConditions.push(inArray(reportingDailySnapshots.domain, ['sports', 'casino', 'matka']));
  }
  if (filter.currency) {
    snapshotConditions.push(eq(reportingDailySnapshots.currency, filter.currency));
  }

  if (!snapshotsCurrent) snapshotConditions.push(sql`false`);
  const snapshotResult = await db
    .select({
      totalTurnover: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      commissionEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentCommission}::numeric), 0)`,
      shareEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentShare}::numeric), 0)`,
      playerCount: sql<number>`COALESCE(MAX(${reportingDailySnapshots.playerCount}), 0)`,
      activePlayerCount: sql<number>`COALESCE(MAX(${reportingDailySnapshots.activePlayerCount}), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
      agentCount: sql<number>`COUNT(DISTINCT ${reportingDailySnapshots.agentId})`,
    })
    .from(reportingDailySnapshots)
    .where(and(...snapshotConditions));

  const snapshotKpis = snapshotResult[0];
  let baseKpis = {
    totalTurnover: Number(snapshotKpis?.totalTurnover ?? 0) || 0,
    totalGGR: Number(snapshotKpis?.totalGGR ?? 0) || 0,
    commissionEarned: Number(snapshotKpis?.commissionEarned ?? 0) || 0,
    shareEarned: Number(snapshotKpis?.shareEarned ?? 0) || 0,
    downlineTurnover: 0,
    downlineGGR: 0,
    playerCount: Number(snapshotKpis?.playerCount ?? 0) || 0,
    activePlayerCount: Number(snapshotKpis?.activePlayerCount ?? 0) || 0,
    betCount: Number(snapshotKpis?.betCount ?? 0) || 0,
    agentCount: Number(snapshotKpis?.agentCount ?? 0) || 0,
  };

  // When range includes today, add live "today" slice from bets (createdAt) and realtime commission
  if ((rangeIncludesToday || !snapshotsCurrent) && dateToVal) {
    let agentIds: string[];
    const liveSchemes = new Map<string, string>();
    if (filter.agentId) {
      const descendants = await db
        .select({ descendantId: agentHierarchyClosure.descendantId })
        .from(agentHierarchyClosure)
        .where(eq(agentHierarchyClosure.ancestorId, filter.agentId));
      agentIds = [filter.agentId, ...descendants.map((r) => r.descendantId).filter((id) => id !== filter.agentId)];
    } else if (filter.tenant) {
      const tenantAgents = await db
        .select({ id: agents.id, schemeType: agents.schemeType })
        .from(agents)
        .where(and(eq(agents.tenantId, filter.tenant), filter.schemeType ? eq(agents.schemeType, filter.schemeType) : undefined));
      agentIds = tenantAgents.map((r) => r.id);
      tenantAgents.forEach(row => liveSchemes.set(row.id, row.schemeType));
    } else {
      agentIds = [];
    }
    baseKpis.agentCount = agentIds.length;
    baseKpis.activePlayerCount = await activeAgentPlayers(filter, agentIds, tz);
    const todayFilter: AgentReportingFilter = {
      ...filter,
      dateFrom: snapshotsCurrent ? startOfToday : (filter.dateFrom || new Date(0)),
      dateTo: dateToVal,
    };
    // One direct membership per agent, plus an aggregate target, preserves the
    // old union totals without summing already-rounded per-agent totals in JS.
    let aggregateTarget = '00000000-0000-0000-0000-000000000000';
    let suffix = 0;
    while (agentIds.includes(aggregateTarget)) aggregateTarget = `00000000-0000-0000-0000-${String(++suffix).padStart(12, '0')}`;
    const batched = !filter.agentId && agentIds.length > 1
      ? await createAgentPerformanceReads(new Map<string, readonly string[]>([[aggregateTarget, agentIds], ...agentIds.map(id => [id, [id]] as const)]), todayFilter, tz, { dateField: 'createdAt' })
      : null;
    const todayFromBets = batched ? batched.fromBets(aggregateTarget, '') : await getAgentPerformanceFromBets(agentIds, todayFilter, 'createdAt');
    if (todayFromBets) {
      baseKpis.totalTurnover += todayFromBets.totalTurnover;
      baseKpis.totalGGR += todayFromBets.totalGGR;
      baseKpis.betCount += todayFromBets.betCount;
      baseKpis.playerCount = Math.max(baseKpis.playerCount, todayFromBets.playerCount);
      if (filter.agentId) {
        baseKpis.commissionEarned += todayFromBets.commissionEarned;
        baseKpis.shareEarned += todayFromBets.shareEarned;
      } else {
        // Whitelabel-level: aggregate today commission/share across all agents (getAgentPerformanceFromBets uses only primary agent when agentIds.length > 1)
        let todayCommission = 0;
        let todayShare = 0;
        for (const aid of agentIds) {
          const agentToday = batched ? batched.fromBets(aid, liveSchemes.get(aid) ?? '') : await getAgentPerformanceFromBets([aid], todayFilter, 'createdAt');
          if (agentToday) {
            todayCommission += agentToday.commissionEarned;
            todayShare += agentToday.shareEarned;
          }
        }
        baseKpis.commissionEarned += todayCommission;
        baseKpis.shareEarned += todayShare;
      }
    }
  }

  if (baseKpis.totalTurnover > 0 || baseKpis.betCount > 0) {
    return baseKpis;
  }

  // Fallback to reportingAgentRollups if available
  const conditions = buildConditions(filter);
  const result = await db
    .select({
      totalTurnover: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalTurnover}::numeric), 0)`,
      totalGGR: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalGGR}::numeric), 0)`,
      commissionEarned: sql<number>`COALESCE(SUM(${reportingAgentRollups.commissionEarned}::numeric), 0)`,
      shareEarned: sql<number>`COALESCE(SUM(${reportingAgentRollups.shareEarned}::numeric), 0)`,
      downlineTurnover: sql<number>`COALESCE(SUM(${reportingAgentRollups.downlineTurnover}::numeric), 0)`,
      downlineGGR: sql<number>`COALESCE(SUM(${reportingAgentRollups.downlineGGR}::numeric), 0)`,
      playerCount: sql<number>`COALESCE(MAX(${reportingAgentRollups.playerCount}), 0)`,
      activePlayerCount: sql<number>`COALESCE(MAX(${reportingAgentRollups.activePlayerCount}), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingAgentRollups.betCount}), 0)`,
      agentCount: sql<number>`COUNT(DISTINCT ${reportingAgentRollups.agentId})`,
    })
    .from(reportingAgentRollups)
    .where(and(...conditions));

  const kpis = result[0] || {
    totalTurnover: 0,
    totalGGR: 0,
    commissionEarned: 0,
    shareEarned: 0,
    downlineTurnover: 0,
    downlineGGR: 0,
    playerCount: 0,
    activePlayerCount: 0,
    betCount: 0,
    agentCount: 0,
  };

  return {
    totalTurnover: Number(kpis.totalTurnover) || 0,
    totalGGR: Number(kpis.totalGGR) || 0,
    commissionEarned: Number(kpis.commissionEarned) || 0,
    shareEarned: Number(kpis.shareEarned) || 0,
    downlineTurnover: Number(kpis.downlineTurnover) || 0,
    downlineGGR: Number(kpis.downlineGGR) || 0,
    playerCount: Number(kpis.playerCount) || 0,
    activePlayerCount: Number(kpis.activePlayerCount) || 0,
    betCount: Number(kpis.betCount) || 0,
    agentCount: Number(kpis.agentCount) || 0,
  };
}

/**
 * Fallback: Get agent performance from real-time bets data
 * Queries sportsBets, casinoBets, matkaBets directly when snapshots don't have data.
 * @param dateField - 'createdAt' for today slice (match snapshot); 'settledAt' for legacy.
 */
async function getAgentPerformanceFromBets(
  agentIds: string[],
  filter: AgentReportingFilter,
  dateField: 'createdAt' | 'settledAt' = 'settledAt'
): Promise<{ totalTurnover: number; totalGGR: number; betCount: number; playerCount: number; commissionEarned: number; shareEarned: number } | null> {
  if (!agentIds.length) return null;
  const primary = agentIds[0];
  const [agent] = agentIds.length === 1 ? await db.select({ schemeType: agents.schemeType }).from(agents).where(eq(agents.id, primary)).limit(1) : [];
  const reads = await createAgentPerformanceReads(new Map([[primary, agentIds]]), filter, await getTenantTimezone(filter.tenant), { dateField });
  return reads.fromBets(primary, agent?.schemeType ?? '');
}

async function getAgentRatesForPeriod(
  agentId: string,
  schemeType: string,
  filter: AgentReportingFilter,
  useLatestOnly: boolean = false,
): Promise<{ commission: Record<string, number>; share: Record<string, number> }> {
  const domains: ('sports' | 'casino' | 'matka')[] = ['sports', 'casino', 'matka'];
  const commission: Record<string, number> = { sports: 0, casino: 0, matka: 0 };
  const share: Record<string, number> = { sports: 0, casino: 0, matka: 0 };

  const runLatestQuery = () => {
    const promises: Promise<void>[] = [];
    for (const domain of domains) {
      if (schemeType === 'COMMISSION' || schemeType === 'CREDIT') {
        promises.push(
          db
            .select({ commissionRate: agentCommissionConfig.commissionRate })
            .from(agentCommissionConfig)
            .where(
              and(
                eq(agentCommissionConfig.agentId, agentId),
                eq(agentCommissionConfig.domain, domain),
              ),
            )
            .orderBy(desc(agentCommissionConfig.effectiveFrom))
            .limit(1)
            .then((rows) => {
              if (rows[0]) commission[domain] = Number(rows[0].commissionRate) || 0;
            }),
        );
      }
      if (schemeType === 'SHARING' || schemeType === 'CREDIT') {
        promises.push(
          db
            .select({ shareRate: agentSharingConfig.shareRate })
            .from(agentSharingConfig)
            .where(
              and(
                eq(agentSharingConfig.agentId, agentId),
                eq(agentSharingConfig.domain, domain),
              ),
            )
            .orderBy(desc(agentSharingConfig.effectiveFrom))
            .limit(1)
            .then((rows) => {
              if (rows[0]) share[domain] = Number(rows[0].shareRate) || 0;
            }),
        );
      }
    }
    return Promise.all(promises);
  };

  if (useLatestOnly) {
    await runLatestQuery();
    return { commission, share };
  }

  // Date range: use start of day for dateFrom, end of day for dateTo (tenant TZ) so config on report end date is included
  const tz = await getTenantTimezone(filter.tenant);
  const dateFrom = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), tz) : new Date(0);
  const dateTo = filter.dateTo ? parseDateTo(String(filter.dateTo), tz) : new Date();

  for (const domain of domains) {
    if (schemeType === 'COMMISSION' || schemeType === 'CREDIT') {
      const rows = await db
        .select({ commissionRate: agentCommissionConfig.commissionRate })
        .from(agentCommissionConfig)
        .where(
          and(
            eq(agentCommissionConfig.agentId, agentId),
            eq(agentCommissionConfig.domain, domain),
            lte(agentCommissionConfig.effectiveFrom, dateTo),
            sql`(${agentCommissionConfig.effectiveTo} IS NULL OR ${agentCommissionConfig.effectiveTo} >= ${dateFrom})`,
          ),
        )
        .orderBy(desc(agentCommissionConfig.effectiveFrom))
        .limit(1);
      if (rows[0]) commission[domain] = Number(rows[0].commissionRate) || 0;
    }
    if (schemeType === 'SHARING' || schemeType === 'CREDIT') {
      const rows = await db
        .select({ shareRate: agentSharingConfig.shareRate })
        .from(agentSharingConfig)
        .where(
          and(
            eq(agentSharingConfig.agentId, agentId),
            eq(agentSharingConfig.domain, domain),
            lte(agentSharingConfig.effectiveFrom, dateTo),
            sql`(${agentSharingConfig.effectiveTo} IS NULL OR ${agentSharingConfig.effectiveTo} >= ${dateFrom})`,
          ),
        )
        .orderBy(desc(agentSharingConfig.effectiveFrom))
        .limit(1);
      if (rows[0]) share[domain] = Number(rows[0].shareRate) || 0;
    }
  }

  const hasCommission = Object.values(commission).some((r) => r > 0);
  const hasShare = Object.values(share).some((r) => r > 0);
  const needFallback =
    (schemeType === 'COMMISSION' && !hasCommission) ||
    (schemeType === 'SHARING' && !hasShare) ||
    (schemeType === 'CREDIT' && !hasCommission && !hasShare);
  if (needFallback) {
    await runLatestQuery();
  }

  return { commission, share };
}

/** Whitelabel's share rate per domain (from whitelabel_sharing_config). Used to show logged-in whitelabel's cut. */
async function getWhitelabelRates(whitelabelId: string): Promise<Record<string, number>> {
  const domains: ('sports' | 'casino' | 'matka')[] = ['sports', 'casino', 'matka'];
  const share: Record<string, number> = { sports: 0, casino: 0, matka: 0 };
  const rows = await db
    .select({ domain: whitelabelSharingConfig.domain, shareRate: whitelabelSharingConfig.shareRate })
    .from(whitelabelSharingConfig)
    .where(eq(whitelabelSharingConfig.whitelabelId, whitelabelId));
  for (const r of rows) {
    if (r.domain in share) share[r.domain] = Number(r.shareRate) || 0;
  }
  return share;
}

/**
 * Get agent performance list
 * Uses reportingDailySnapshots with agentId filter as primary source
 * Uses agentHierarchyClosure to include entire downline for each agent
 * 
 * For whitelabel admin: Shows root-level agents with their entire downline aggregated
 * For agent login: Shows their direct sub-agents with their downline aggregated
 */
export async function getAgentPerformance(
  filter: AgentReportingFilter,
  limit: number = 50,
): Promise<AgentPerformanceResult> {
  filter = await normalizedAgentFilter(filter);
  const isWhitelabelView = !filter.parentAgentId && (filter.whitelabelId || filter.tenant);
  let targetAgents: Array<{ id: string; username: string | null; levelIndex: number | null; schemeType?: string }> = [];
  let hierarchyMap: Map<string, string[]> = new Map(); // Maps agent ID -> all descendant IDs (including self)
  
  if (filter.parentAgentId) {
    // Agent is logged in - show their direct sub-agents (include schemeType for cut % lookup)
    const subAgents = await db
      .select({
        id: agents.id,
        levelIndex: agents.levelIndex,
        schemeType: agents.schemeType,
        username: agentCredentials.username,
      })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(eq(agents.parentAgentId, filter.parentAgentId));

    targetAgents = subAgents.map((a) => ({
      id: a.id,
      username: a.username,
      levelIndex: a.levelIndex,
      schemeType: a.schemeType ?? undefined,
    }));
  } else if (filter.whitelabelId || filter.tenant) {
    // Whitelabel admin - show ROOT agents (agents with no parent) for this tenant/whitelabel
    const tenantFilter = filter.whitelabelId || filter.tenant;
    const rootConditions: any[] = [
      eq(agents.tenantId, tenantFilter!),
      sql`${agents.parentAgentId} IS NULL`,
    ];
    if (filter.schemeType) {
      rootConditions.push(eq(agents.schemeType, filter.schemeType));
    }
    
    const rootAgents = await db
      .select({ 
        id: agents.id,
        levelIndex: agents.levelIndex,
        schemeType: agents.schemeType,
        username: agentCredentials.username,
      })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .where(and(...rootConditions));
    
    targetAgents = rootAgents.map(a => ({
      id: a.id,
      username: a.username,
      levelIndex: a.levelIndex,
      schemeType: a.schemeType,
    }));
  }
  
  // If no target agents found, return empty result
  if (targetAgents.length === 0) {
    return { agents: [], totals: isWhitelabelView ? { totalTurnover: 0, totalGGR: 0, commissionEarned: 0, shareEarned: 0, agentCount: 0, playerCount: 0, betCount: 0 } : null };
  }
  
  // One closure read for all target agents, with self membership preserved.
  const closureRows = await db.select({ ancestorId: agentHierarchyClosure.ancestorId, descendantId: agentHierarchyClosure.descendantId })
    .from(agentHierarchyClosure).where(inArray(agentHierarchyClosure.ancestorId, targetAgents.map(agent => agent.id)));
  for (const agent of targetAgents) hierarchyMap.set(agent.id, [agent.id, ...closureRows.filter(row => row.ancestorId === agent.id).map(row => row.descendantId)]);

  // Build base conditions for reportingDailySnapshots
  const baseConditions = [];
  if (!await agentSnapshotsCurrent(filter, await getTenantTimezone(filter.tenant))) baseConditions.push(sql`false`);
  
  if (filter.tenant) {
    baseConditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    baseConditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  if (filter.dateFrom) {
    baseConditions.push(gte(reportingDailySnapshots.snapshotDate, parseDateFrom(String(filter.dateFrom), DEFAULT_TZ)));
  }
  if (filter.dateTo) {
    baseConditions.push(lte(reportingDailySnapshots.snapshotDate, parseDateTo(String(filter.dateTo), DEFAULT_TZ)));
  }
  if (filter.domain) {
    baseConditions.push(eq(reportingDailySnapshots.domain, filter.domain));
  } else {
    // Include all gaming domains
    baseConditions.push(inArray(reportingDailySnapshots.domain, ['sports', 'casino', 'matka']));
  }
  if (filter.currency) {
    baseConditions.push(eq(reportingDailySnapshots.currency, filter.currency));
  }

  // Query per target agent with their full hierarchy aggregated
  if (hierarchyMap.size > 0) {
    const results: AgentPerformance[] = [];
    
    const scope = performanceScope(hierarchyMap);
    const snapshots = await db.select({ agentId: sql<string>`performance_scope.target_id`,
          totalTurnover: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
          totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
          commissionEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentCommission}::numeric), 0)`,
          shareEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentShare}::numeric), 0)`,
          playerCount: sql<number>`COALESCE(MAX(${reportingDailySnapshots.playerCount}), 0)`,
          betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,

      }).from(reportingDailySnapshots)
      .innerJoin(scope, eq(reportingDailySnapshots.agentId, sql`performance_scope.agent_id`))
      .where(and(...baseConditions, isNull(reportingDailySnapshots.playerId)))
      .groupBy(sql`performance_scope.target_id`);
    const snapshotsByTarget = new Map(snapshots.map(row => [row.agentId, row]));
    const reads = await createAgentPerformanceReads(hierarchyMap, filter, await getTenantTimezone(filter.tenant), { dateField: 'createdAt' });
    for (const agent of targetAgents) {
      let data: any = snapshotsByTarget.get(agent.id) || {};

      // If snapshot data is 0, try fallback to real-time bets
      const hasData = Number(data.totalTurnover) > 0 || Number(data.betCount) > 0;
      if (!hasData) {
        const betsData = reads.fromBets(agent.id, agent.schemeType ?? '');
        if (betsData) {
          data = betsData;
        }
      }
      
      results.push({
        agentId: agent.id,
        agentName: agent.username ?? undefined,
        schemeType: 'schemeType' in agent ? agent.schemeType : undefined,
        totalTurnover: Number(data.totalTurnover) || 0,
        totalGGR: Number(data.totalGGR) || 0,
        commissionEarned: Number(data.commissionEarned) || 0,
        shareEarned: Number(data.shareEarned) || 0,
        downlineTurnover: 0,
        downlineGGR: 0,
        playerCount: Number(data.playerCount) || 0,
        betCount: Number(data.betCount) || 0,
        level: agent.levelIndex || 0,
      });
    }
    
    // Only show agents with P&L (turnover or bets)
    let filtered = results.filter((r) => r.totalTurnover > 0 || r.betCount > 0);
    filtered = filtered.sort((a, b) => b.totalTurnover - a.totalTurnover).slice(0, limit);
    
    // Whitelabel: cut % = whitelabel % - agent % per domain; cut amount = (wl% - agent%) × domain GGR
    let totals: AgentPerformanceTotals | null = null;
    if (isWhitelabelView && filtered.length > 0 && !filter.domain) {
      const wlId = filter.whitelabelId || filter.tenant;
      const wlRates = wlId ? await getWhitelabelRates(wlId) : { sports: 0, casino: 0, matka: 0 };
      for (const row of filtered) {
        const breakdown = reads.breakdown(row.agentId);
        const { commission: agentComm, share: agentShare } = row.schemeType
          ? reads.rates(row.agentId, row.schemeType, true)
          : { commission: { sports: 0, casino: 0, matka: 0 }, share: { sports: 0, casino: 0, matka: 0 } };
        const agentRate = (d: 'sports' | 'casino' | 'matka') =>
          row.schemeType === 'COMMISSION' ? (agentComm[d] ?? 0)
            : row.schemeType === 'SHARING' ? (agentShare[d] ?? 0)
              : row.schemeType === 'CREDIT' ? (agentComm[d] ?? 0) + (agentShare[d] ?? 0)
                : 0;
        let wlCut = 0;
        row.domainBreakdown = breakdown.map((d) => {
          const wlRate = wlRates[d.domain] ?? 0;
          const agRate = agentRate(d.domain);
          const cutRate = Math.max(0, wlRate - agRate);
          const cut = d.ggr * cutRate;
          const cutPercent = cutRate * 100;
          wlCut += cut;
          return {
            ...d,
            cut,
            cutPercent,
            userCutPercent: wlRate * 100,
            agentCutPercent: agRate * 100,
          };
        });
        // Preserve row.commissionEarned from snapshot/bets; shareEarned = whitelabel cut
        row.shareEarned = wlCut;
        // GGR-weighted user/agent % (kept for any future use; Cut column shows amount only)
        const totalGGR = row.totalGGR || 1;
        row.userCutPercent =
          breakdown.reduce((s, d) => s + (d.ggr || 0) * (wlRates[d.domain] ?? 0), 0) / totalGGR * 100;
        row.agentCutPercent =
          breakdown.reduce((s, d) => s + (d.ggr || 0) * agentRate(d.domain), 0) / totalGGR * 100;
      }
      totals = {
        totalTurnover: filtered.reduce((s, r) => s + r.totalTurnover, 0),
        totalGGR: filtered.reduce((s, r) => s + r.totalGGR, 0),
        commissionEarned: filtered.reduce((s, r) => s + r.commissionEarned, 0),
        shareEarned: filtered.reduce((s, r) => s + r.shareEarned, 0),
        agentCount: filtered.length,
        playerCount: filtered.reduce((s, r) => s + r.playerCount, 0),
        betCount: filtered.reduce((s, r) => s + r.betCount, 0),
      };
    }

    // Agent view: cut % = parent % - sub-agent % per domain; cut amount = (parent% - subAgent%) × domain GGR
    if (filter.parentAgentId && filtered.length > 0 && !filter.domain) {
      const [parentRow] = await db
        .select({ schemeType: agents.schemeType })
        .from(agents)
        .where(eq(agents.id, filter.parentAgentId))
        .limit(1);
      const parentSchemeType = parentRow?.schemeType;
      const { commission: parentCommission, share: parentShare } =
        parentSchemeType
          ? reads.rates(filter.parentAgentId, parentSchemeType, true)
          : { commission: { sports: 0, casino: 0, matka: 0 }, share: { sports: 0, casino: 0, matka: 0 } };
      const parentRate = (d: 'sports' | 'casino' | 'matka') =>
        parentSchemeType === 'COMMISSION' ? (parentCommission[d] ?? 0)
          : parentSchemeType === 'SHARING' ? (parentShare[d] ?? 0)
            : parentSchemeType === 'CREDIT' ? (parentCommission[d] ?? 0) + (parentShare[d] ?? 0)
              : 0;
      for (const row of filtered) {
        const breakdown = reads.breakdown(row.agentId);
        const { commission: subComm, share: subShare } = row.schemeType
          ? reads.rates(row.agentId, row.schemeType, true)
          : { commission: { sports: 0, casino: 0, matka: 0 }, share: { sports: 0, casino: 0, matka: 0 } };
        const subAgentRate = (d: 'sports' | 'casino' | 'matka') =>
          row.schemeType === 'COMMISSION' ? (subComm[d] ?? 0)
            : row.schemeType === 'SHARING' ? (subShare[d] ?? 0)
              : row.schemeType === 'CREDIT' ? (subComm[d] ?? 0) + (subShare[d] ?? 0)
                : 0;
        let parentCutCommission = 0;
        let parentCutShare = 0;
        row.domainBreakdown = breakdown.map((d) => {
          const pRate = parentRate(d.domain);
          const sRate = subAgentRate(d.domain);
          const cutRate = Math.max(0, pRate - sRate);
          const cut = d.ggr * cutRate;
          const cutPercent = cutRate * 100;
          parentCutCommission += d.ggr * Math.max(0, (parentCommission[d.domain] ?? 0) - (subComm[d.domain] ?? 0));
          parentCutShare += d.ggr * Math.max(0, (parentShare[d.domain] ?? 0) - (subShare[d.domain] ?? 0));
          return {
            ...d,
            cut,
            cutPercent,
            userCutPercent: pRate * 100,
            agentCutPercent: sRate * 100,
          };
        });
        // Preserve row.commissionEarned as sub-agent's earned commission; shareEarned = parent's cut (commission + share)
        row.shareEarned = parentCutCommission + parentCutShare;
        // GGR-weighted user (parent) / agent (sub) % for "user% - agent% = cut%" display
        const totalGGR = row.totalGGR || 1;
        row.userCutPercent =
          breakdown.reduce((s, d) => s + (d.ggr || 0) * parentRate(d.domain), 0) / totalGGR * 100;
        row.agentCutPercent =
          breakdown.reduce((s, d) => s + (d.ggr || 0) * subAgentRate(d.domain), 0) / totalGGR * 100;
      }
      totals = {
        totalTurnover: filtered.reduce((s, r) => s + r.totalTurnover, 0),
        totalGGR: filtered.reduce((s, r) => s + r.totalGGR, 0),
        commissionEarned: filtered.reduce((s, r) => s + r.commissionEarned, 0),
        shareEarned: filtered.reduce((s, r) => s + r.shareEarned, 0),
        agentCount: filtered.length,
        playerCount: filtered.reduce((s, r) => s + r.playerCount, 0),
        betCount: filtered.reduce((s, r) => s + r.betCount, 0),
      };
    } else if (isWhitelabelView && filtered.length > 0) {
      totals = {
        totalTurnover: filtered.reduce((s, r) => s + r.totalTurnover, 0),
        totalGGR: filtered.reduce((s, r) => s + r.totalGGR, 0),
        commissionEarned: filtered.reduce((s, r) => s + r.commissionEarned, 0),
        shareEarned: filtered.reduce((s, r) => s + r.shareEarned, 0),
        agentCount: filtered.length,
        playerCount: filtered.reduce((s, r) => s + r.playerCount, 0),
        betCount: filtered.reduce((s, r) => s + r.betCount, 0),
      };
    }

    return { agents: filtered, totals };
  }

  // Default query (no parentAgentId) - original logic
  const snapshotConditions = [...baseConditions];
  
  if (filter.agentId) {
    snapshotConditions.push(eq(reportingDailySnapshots.agentId, filter.agentId));
  } else {
    // Only get agent-level snapshots (where agentId is not null)
    snapshotConditions.push(isNotNull(reportingDailySnapshots.agentId));
  }
  // Agent-level rows only: player-level rows repeat the same bets under the same agent_id.
  snapshotConditions.push(isNull(reportingDailySnapshots.playerId));

  // Query from reportingDailySnapshots
  const snapshotResults = await db
    .select({
      agentId: reportingDailySnapshots.agentId,
      totalTurnover: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`,
      totalGGR: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      commissionEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentCommission}::numeric), 0)`,
      shareEarned: sql<number>`COALESCE(SUM(${reportingDailySnapshots.agentShare}::numeric), 0)`,
      playerCount: sql<number>`COALESCE(MAX(${reportingDailySnapshots.playerCount}), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingDailySnapshots.betCount}), 0)`,
    })
    .from(reportingDailySnapshots)
    .where(and(...snapshotConditions))
    .groupBy(reportingDailySnapshots.agentId)
    .orderBy(desc(sql`COALESCE(SUM(${reportingDailySnapshots.totalStakes}::numeric), 0)`))
    .limit(limit);

  // If we got results from snapshots, use them
  if (snapshotResults.length > 0) {
    // Get agent IDs to fetch names and levels
    const agentIds = snapshotResults.map(r => r.agentId).filter((id): id is string => id !== null);
    
    // Agents table has no name column; use agent_credentials.username as display name
    const agentInfoMap = new Map<string, { username: string | null; levelIndex: number | null }>();
    if (agentIds.length > 0) {
      const agentList = await db
        .select({
          id: agents.id,
          username: agentCredentials.username,
          levelIndex: agents.levelIndex,
        })
        .from(agents)
        .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
        .where(inArray(agents.id, agentIds));
      
      agentList.forEach((row) => {
        agentInfoMap.set(row.id, { 
          username: row.username ?? null,
          levelIndex: row.levelIndex,
        });
      });
    }

    // Map results with agent names and levels
    const resultsWithData = snapshotResults
      .filter(r => r.agentId !== null)
      .map((r) => {
        const info = agentInfoMap.get(r.agentId!) || { username: null, levelIndex: null };
        return {
          agentId: r.agentId!,
          agentName: info.username ?? undefined,
          totalTurnover: Number(r.totalTurnover) || 0,
          totalGGR: Number(r.totalGGR) || 0,
          commissionEarned: Number(r.commissionEarned) || 0,
          shareEarned: Number(r.shareEarned) || 0,
          downlineTurnover: 0, // Not available in snapshots
          downlineGGR: 0, // Not available in snapshots
          playerCount: Number(r.playerCount) || 0,
          betCount: Number(r.betCount) || 0,
          level: info.levelIndex || 0,
        };
      });
    
    return { agents: resultsWithData, totals: null };
  }

  // Fallback to reportingAgentRollups if no snapshot data
  const conditions = buildConditions(filter);
  const rollupResults = await db
    .select({
      agentId: reportingAgentRollups.agentId,
      totalTurnover: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalTurnover}::numeric), 0)`,
      totalGGR: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalGGR}::numeric), 0)`,
      commissionEarned: sql<number>`COALESCE(SUM(${reportingAgentRollups.commissionEarned}::numeric), 0)`,
      shareEarned: sql<number>`COALESCE(SUM(${reportingAgentRollups.shareEarned}::numeric), 0)`,
      downlineTurnover: sql<number>`COALESCE(SUM(${reportingAgentRollups.downlineTurnover}::numeric), 0)`,
      downlineGGR: sql<number>`COALESCE(SUM(${reportingAgentRollups.downlineGGR}::numeric), 0)`,
      playerCount: sql<number>`COALESCE(MAX(${reportingAgentRollups.playerCount}), 0)`,
      betCount: sql<number>`COALESCE(SUM(${reportingAgentRollups.betCount}), 0)`,
    })
    .from(reportingAgentRollups)
    .where(and(...conditions))
    .groupBy(reportingAgentRollups.agentId)
    .orderBy(desc(sql`COALESCE(SUM(${reportingAgentRollups.totalTurnover}::numeric), 0)`))
    .limit(limit);

  const agentList = rollupResults.map((r) => ({
    agentId: r.agentId,
    agentName: undefined,
    totalTurnover: Number(r.totalTurnover) || 0,
    totalGGR: Number(r.totalGGR) || 0,
    commissionEarned: Number(r.commissionEarned) || 0,
    shareEarned: Number(r.shareEarned) || 0,
    downlineTurnover: Number(r.downlineTurnover) || 0,
    downlineGGR: Number(r.downlineGGR) || 0,
    playerCount: Number(r.playerCount) || 0,
    betCount: Number(r.betCount) || 0,
    level: 0, // Would need hierarchy lookup
  }));
  return { agents: agentList, totals: null };
}

/**
 * Get agent trends over time
 */
export async function getAgentTrends(filter: AgentReportingFilter): Promise<AgentTrendPoint[]> {
  filter = await normalizedAgentFilter(filter);
  const conditions = buildConditions(filter);

  const results = await db
    .select({
      date: sql<string>`DATE(${reportingAgentRollups.periodFrom})`,
      turnover: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalTurnover}::numeric), 0)`,
      ggr: sql<number>`COALESCE(SUM(${reportingAgentRollups.totalGGR}::numeric), 0)`,
      commission: sql<number>`COALESCE(SUM(${reportingAgentRollups.commissionEarned}::numeric), 0)`,
      share: sql<number>`COALESCE(SUM(${reportingAgentRollups.shareEarned}::numeric), 0)`,
      playerCount: sql<number>`COALESCE(MAX(${reportingAgentRollups.playerCount}), 0)`,
    })
    .from(reportingAgentRollups)
    .where(and(...conditions))
    .groupBy(sql`DATE(${reportingAgentRollups.periodFrom})`)
    .orderBy(sql`DATE(${reportingAgentRollups.periodFrom})`);

  return results.map((r) => ({
    date: r.date,
    turnover: Number(r.turnover) || 0,
    ggr: Number(r.ggr) || 0,
    commission: Number(r.commission) || 0,
    share: Number(r.share) || 0,
    playerCount: Number(r.playerCount) || 0,
  }));
}

/**
 * Get agent's players breakdown for drill-down
 */
export async function getAgentPlayerBreakdown(filter: AgentReportingFilter) {
  filter = await normalizedAgentFilter(filter);
  const [sports, casino, matka] = await Promise.all([import('./sportsReportingRepo.js'), import('./casinoReportingRepo.js'), import('./matkaReportingRepo.js')]);
  const lists = await Promise.all([
    !filter.domain || filter.domain === 'sports' ? sports.getSportsPlayerBreakdown(filter) : [],
    !filter.domain || filter.domain === 'casino' ? casino.getCasinoPlayerBreakdown(filter) : [],
    !filter.domain || filter.domain === 'matka' ? matka.getMatkaPlayerBreakdown(filter) : [],
  ]);
  const ids = [...new Set(lists.flat().map(row => Number(row.playerId)))];
  if (!ids.length) return [];
  const { attributedAgentId, referralAttributions, referrerUsers, referralAttributionJoinOn, referrerJoinOn } = await import('@src/domains/agents/services/commissionPlayerScope.js');
  const tenant = filter.tenant || filter.whitelabelId;
  const owned = await db.select({ id: users.id }).from(users)
    .leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant))
    .leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant))
    .where(and(inArray(users.id, ids), isNotNull(attributedAgentId), tenant ? eq(users.tenant, tenant) : undefined));
  const visible = new Set(owned.map(row => row.id));
  const merged = new Map<number, { playerId: number; playerUsername: string; totalStakes: number; totalPayouts: number; grossGamingRevenue: number; betCount: number; wins: number }>();
  for (const row of lists.flat()) {
    const id = Number(row.playerId);
    if (!visible.has(id)) continue;
    const target = merged.get(id) || { playerId: id, playerUsername: String(row.playerUsername || 'Unknown'), totalStakes: 0, totalPayouts: 0, grossGamingRevenue: 0, betCount: 0, wins: 0 };
    target.totalStakes += Number(row.totalStakes); target.totalPayouts += Number(row.totalPayouts);
    target.grossGamingRevenue += Number(row.grossGamingRevenue); target.betCount += Number(row.betCount);
    target.wins += Math.round(Number(row.winRate) * Number(row.betCount)); merged.set(id, target);
  }
  return [...merged.values()].map(({ wins, ...row }) => ({ ...row, avgStake: row.betCount ? row.totalStakes / row.betCount : 0, winRate: row.betCount ? wins / row.betCount : 0 })).sort((a, b) => b.totalStakes - a.totalStakes);
}

function buildConditions(filter: AgentReportingFilter) {
  const conditions = [];

  if (filter.tenant) {
    conditions.push(eq(reportingAgentRollups.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingAgentRollups.whitelabelId, filter.whitelabelId));
  }
  if (filter.agentId) {
    conditions.push(eq(reportingAgentRollups.agentId, filter.agentId));
  }
  if (filter.dateFrom) {
    conditions.push(gte(reportingAgentRollups.periodFrom, parseDateFrom(String(filter.dateFrom), DEFAULT_TZ)));
  }
  if (filter.dateTo) {
    conditions.push(lte(reportingAgentRollups.periodTo, parseDateTo(String(filter.dateTo), DEFAULT_TZ)));
  }
  if (filter.domain) {
    conditions.push(eq(reportingAgentRollups.domain, filter.domain));
  }
  if (filter.currency) {
    conditions.push(eq(reportingAgentRollups.currency, filter.currency));
  }

  return conditions;
}

