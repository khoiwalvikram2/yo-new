import { DateTime } from 'luxon';
import { db } from '@/db/client.js';
import { reportingDailySnapshots, sportsBets, matkaBets, users, agentHierarchyClosure } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, or, isNotNull, isNull, inArray } from 'drizzle-orm';
import { inAgentPlayers } from './agentPlayerScope.js';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';

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

export interface ExposureReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  domain?: 'sports' | 'casino' | 'matka' | 'all';
  currency?: string;
  agentId?: string;
}

export interface ExposureDataPoint {
  dimension: string;
  value: number;
  date: string;
}

/**
 * Get exposure data points for a date range
 */
export async function getExposureData(filter: ExposureReportingFilter): Promise<ExposureDataPoint[]> {
  const conditions = [];
  const tz = await getTenantTimezone(filter.tenant);
  const dateFrom = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), tz) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateTo = filter.dateTo ? parseDateTo(String(filter.dateTo), tz) : new Date();

  if (filter.tenant) {
    conditions.push(eq(reportingDailySnapshots.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(reportingDailySnapshots.whitelabelId, filter.whitelabelId));
  }
  if (filter.currency) {
    conditions.push(eq(reportingDailySnapshots.currency, filter.currency));
  }
  if (filter.agentId) {
    // The agent's whole subtree, once: player-level rows of its players
    // (subtree + referral). This matched `agent_id = <agent>` with no player_id
    // filter, which dropped every sub-agent's players and summed the agent-level
    // row together with the player-level rows it was built from.
    conditions.push(isNotNull(reportingDailySnapshots.playerId));
    conditions.push(inAgentPlayers(reportingDailySnapshots.playerId, filter.agentId, filter.tenant));
  } else {
    // Global snapshots: agentId and playerId both null (agentId null + playerId not null = player-level)
    conditions.push(isNull(reportingDailySnapshots.agentId));
    conditions.push(isNull(reportingDailySnapshots.playerId));
  }

  // Filter by date range
  conditions.push(gte(reportingDailySnapshots.snapshotDate, dateFrom));
  conditions.push(lte(reportingDailySnapshots.snapshotDate, dateTo));

  // Filter by domain
  if (filter.domain && filter.domain !== 'all') {
    conditions.push(eq(reportingDailySnapshots.domain, filter.domain));
  } else {
    // For 'all', include sports and matka (casino doesn't have exposure)
    conditions.push(
      or(
        eq(reportingDailySnapshots.domain, 'sports'),
        eq(reportingDailySnapshots.domain, 'matka'),
      ),
    );
  }

  // Group by date and domain to get daily exposure
  const results = await db
    .select({
      date: sql<string>`DATE(${reportingDailySnapshots.snapshotDate})`,
      domain: reportingDailySnapshots.domain,
      totalExposure: sql<number>`COALESCE(SUM(${reportingDailySnapshots.totalExposure}::numeric), 0)`,
    })
    .from(reportingDailySnapshots)
    .where(and(...conditions, isNotNull(reportingDailySnapshots.totalExposure)))
    .groupBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`, reportingDailySnapshots.domain)
    .orderBy(sql`DATE(${reportingDailySnapshots.snapshotDate})`);

  // If no snapshot data, try to get from live bets
  if (results.length === 0) {
    return await getExposureFromLiveBets(filter);
  }

  // For the latest date in the range, use live open exposure so the table shows current risk
  // (snapshot only counts open bets created on that day; open bets from other days are missed)
  const toDateStr = (d: string | Date) =>
    typeof d === 'string' ? d.slice(0, 10) : DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat('yyyy-MM-dd');
  const latestDateStr =
    results.length > 0
      ? toDateStr(results[results.length - 1].date)
      : '';
  const todayStr = DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');
  const useLiveForLatest = latestDateStr === todayStr;

  const domainsForLatest = useLiveForLatest
    ? [...new Set(results.filter((r) => toDateStr(r.date) === latestDateStr).map((r) => r.domain).filter(Boolean))]
    : [];
  let liveSports = 0;
  let liveMatka = 0;
  if (domainsForLatest.includes('sports')) {
    liveSports = await getLiveExposureForDomain(filter, 'sports');
  }
  if (domainsForLatest.includes('matka')) {
    liveMatka = await getLiveExposureForDomain(filter, 'matka');
  }

  return results.map((r) => {
    const dateStr = toDateStr(r.date);
    const isLatestDate = dateStr === latestDateStr;
    let value = Number(r.totalExposure) || 0;
    if (useLiveForLatest && isLatestDate && r.domain) {
      value = r.domain === 'sports' ? liveSports : r.domain === 'matka' ? liveMatka : value;
    }
    return {
      dimension: r.domain || 'All',
      value,
      date: new Date(r.date).toISOString(),
    };
  });
}

/**
 * Current open exposure for a single domain (all open bets, no createdAt filter).
 */
async function getLiveExposureForDomain(
  filter: ExposureReportingFilter,
  domain: 'sports' | 'matka'
): Promise<number> {
  if (domain === 'sports') {
    const conditions: any[] = [];
    if (filter.tenant) conditions.push(eq(sportsBets.tenant, filter.tenant));
    if (filter.whitelabelId) conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
    if (filter.currency) conditions.push(eq(sportsBets.currency, filter.currency));
    conditions.push(or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')));

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
 * Get exposure from live bets when snapshots are not available
 */
async function getExposureFromLiveBets(filter: ExposureReportingFilter): Promise<ExposureDataPoint[]> {
  const conditions: any[] = [];
  const tzLive = await getTenantTimezone(filter.tenant);
  const dateFrom = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), tzLive) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateTo = filter.dateTo ? parseDateTo(String(filter.dateTo), tzLive) : new Date();

  if (filter.tenant) {
    conditions.push(eq(sportsBets.tenant, filter.tenant));
  }
  if (filter.whitelabelId) {
    conditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
  }
  if (filter.currency) {
    conditions.push(eq(sportsBets.currency, filter.currency));
  }

  // Get sports exposure from open bets (only if domain is 'all' or 'sports')
  let sportsExposure: Array<{ date: string; exposure: number }> = [];
  if (!filter.domain || filter.domain === 'all' || filter.domain === 'sports') {
    const sportsConditions = [...conditions];
    if (filter.agentId) {
      // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
      sportsConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
    }
    const sportsQuery = db
      .select({
        date: sql<string>`DATE(${sportsBets.createdAt})`,
        exposure: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      })
      .from(sportsBets)
      .leftJoin(users, eq(sportsBets.userId, users.id))
      .where(
        and(
          ...sportsConditions,
          or(eq(sportsBets.status, 'matched'), eq(sportsBets.status, 'unmatched')),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo),
        ),
      );
    sportsExposure = await sportsQuery.groupBy(sql`DATE(${sportsBets.createdAt})`);
  }

  // Get matka exposure from open bets (only if domain is 'all' or 'matka')
  let matkaExposure: Array<{ date: string; exposure: number }> = [];
  if (!filter.domain || filter.domain === 'all' || filter.domain === 'matka') {
    const matkaConditions: any[] = [];
    if (filter.tenant) {
      matkaConditions.push(eq(matkaBets.tenant, filter.tenant));
    }
    if (filter.whitelabelId) {
      matkaConditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
    }
    if (filter.currency) {
      matkaConditions.push(eq(matkaBets.currency, filter.currency));
    }
    if (filter.agentId) {
      // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
      matkaConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
    }
    const matkaQuery = db
      .select({
        date: sql<string>`DATE(${matkaBets.createdAt})`,
        exposure: sql<number>`COALESCE(SUM(${matkaBets.potentialWin}::numeric), 0)`,
      })
      .from(matkaBets)
      .leftJoin(users, eq(matkaBets.userId, users.id))
      .where(
        and(
          ...matkaConditions,
          or(eq(matkaBets.status, 'pending'), eq(matkaBets.status, 'active')),
          gte(matkaBets.createdAt, dateFrom),
          lte(matkaBets.createdAt, dateTo),
        ),
      );
    matkaExposure = await matkaQuery.groupBy(sql`DATE(${matkaBets.createdAt})`);
  }

  // Combine and aggregate by date
  const dateMap = new Map<string, number>();
  sportsExposure.forEach((r) => {
    const date = r.date;
    const existing = dateMap.get(date) || 0;
    dateMap.set(date, existing + Number(r.exposure) || 0);
  });
  matkaExposure.forEach((r) => {
    const date = r.date;
    const existing = dateMap.get(date) || 0;
    dateMap.set(date, existing + Number(r.exposure) || 0);
  });

  return Array.from(dateMap.entries()).map(([date, value]) => ({
    dimension: 'All',
    value: Number(value) || 0,
    date: new Date(date).toISOString(),
  }));
}

