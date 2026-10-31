import { financialSnapshotsAreCurrent } from './snapshotFreshness.js'
import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { db } from '@/db/client.js';
import { reportingDailySnapshots, sportsBets, matkaBets, casinoBets, users, agentHierarchyClosure } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, or, isNotNull, isNull, inArray } from 'drizzle-orm';
import { inAgentPlayers } from './agentPlayerScope.js';
import { getEndOfDayForDate, parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import { DateTime } from 'luxon';
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

export interface PNLReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  domain?: 'sports' | 'casino' | 'matka' | 'all';
  currency?: string;
  agentId?: string;
}

export interface PNLDataPoint {
  dimension: string;
  value: number;
  date: string;
}

/**
 * Get P&L data points for a date range
 * P&L = Gross Gaming Revenue (GGR) = Total Stakes - Total Payouts
 */
export async function getPNLData(filter: PNLReportingFilter): Promise<PNLDataPoint[]> {
  const conditions = [];
  const tz = await getTenantTimezone(filter.tenant);
  const dateFrom = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), tz) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateTo = filter.dateTo ? parseDateTo(String(filter.dateTo), tz) : new Date();

  // An older snapshot must not hide intraday settlements from a mixed date range.
  if (DateTime.fromJSDate(dateTo, { zone: tz }).toISODate()! >= DateTime.now().setZone(tz).toISODate()!) {
    return getPNLFromLiveBets(filter);
  }
  const domains = filter.domain && filter.domain !== 'all' ? [filter.domain] : ['sports', 'casino', 'matka'] as const;
  if (!(await Promise.all(domains.map(domain => financialSnapshotsAreCurrent(filter, domain, tz)))).every(Boolean)) return getPNLFromLiveBets(filter);
  const snapshotDay = sqlDateBucketText(reportingDailySnapshots.snapshotDate, tz);

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
    // For 'all', include all gaming domains
    conditions.push(
      or(
        eq(reportingDailySnapshots.domain, 'sports'),
        eq(reportingDailySnapshots.domain, 'casino'),
        eq(reportingDailySnapshots.domain, 'matka'),
      ),
    );
  }

  // Group by date and domain to get daily P&L (GGR)
  const results = await db
    .select({
      date: snapshotDay,
      domain: reportingDailySnapshots.domain,
      grossGamingRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
      netRevenue: sql<number>`COALESCE(SUM(${reportingDailySnapshots.netRevenue}::numeric), 0)`,
    })
    .from(reportingDailySnapshots)
    .where(and(...conditions, isNotNull(reportingDailySnapshots.grossGamingRevenue)))
    .groupBy(snapshotDay, reportingDailySnapshots.domain)
    .orderBy(snapshotDay);

  if (results.length === 0) {
    return await getPNLFromLiveBets(filter);
  }

  // Return separate rows per domain with correct dimension values
  // This allows frontend to filter by domain properly
  return results.map((r) => {
    const pnl = r.netRevenue != null ? Number(r.netRevenue) : Number(r.grossGamingRevenue) || 0;
    return {
      dimension: r.domain || 'All', // Use actual domain value (sports, casino, matka)
      value: pnl,
      date: new Date(r.date).toISOString(),
    };
  });
}

/**
 * Fallback: Get PNL data directly from bets table (real-time)
 */
async function getPNLFromLiveBets(filter: PNLReportingFilter): Promise<PNLDataPoint[]> {
  const tz = await getTenantTimezone(filter.tenant);
  const dateFrom = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), tz) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const dateToEnd = filter.dateTo ? parseDateTo(String(filter.dateTo), tz) : new Date();

  const dateMap = new Map<string, number>();

  // Get sports PNL if domain is 'all' or 'sports'
  if (!filter.domain || filter.domain === 'all' || filter.domain === 'sports') {
    const sportsConditions: any[] = [];
    
    // Always require tenant and whitelabelId
    if (filter.tenant) {
      sportsConditions.push(eq(sportsBets.tenant, filter.tenant));
    }
    if (filter.whitelabelId) {
      sportsConditions.push(eq(sportsBets.whitelabelId, filter.whitelabelId));
    }
    
    sportsConditions.push(
      gte(sportsBets.createdAt, dateFrom),
      lte(sportsBets.createdAt, dateToEnd),
      inArray(sportsBets.status, ['won', 'lost', 'settled']),
    );
    
    if (filter.currency) {
      sportsConditions.push(eq(sportsBets.currency, filter.currency));
    }

    // Add agent filtering
    const sportsDay = sqlDateBucketText(sportsBets.createdAt, tz);
    let sportsQuery = db
      .select({
        date: sportsDay,
        stakes: sql<number>`COALESCE(SUM(${sportsBets.liability}), 0)`,
        payouts: sportsPayoutAggregateSql(),
      })
      .from(sportsBets)
      .leftJoin(users, eq(sportsBets.userId, users.id));

    if (filter.agentId) {
      // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
      sportsConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
    }

    const sportsResults = await sportsQuery.where(and(...sportsConditions)).groupBy(sportsDay);

    sportsResults.forEach((r) => {
      const date = r.date;
      const existing = dateMap.get(date) || 0;
      const pnl = Number(r.stakes) - Number(r.payouts);
      dateMap.set(date, existing + pnl);
    });
  }

  // Get matka PNL if domain is 'all' or 'matka'
  if (!filter.domain || filter.domain === 'all' || filter.domain === 'matka') {
    const matkaConditions: any[] = [];
    
    // Always require tenant and whitelabelId
    if (filter.tenant) {
      matkaConditions.push(eq(matkaBets.tenant, filter.tenant));
    }
    if (filter.whitelabelId) {
      matkaConditions.push(eq(matkaBets.whitelabelId, filter.whitelabelId));
    }
    
    matkaConditions.push(
      gte(matkaBets.createdAt, dateFrom),
      lte(matkaBets.createdAt, dateToEnd),
      inArray(matkaBets.status, ['won', 'lost']),
    );
    
    if (filter.currency) {
      matkaConditions.push(eq(matkaBets.currency, filter.currency));
    }

    const matkaDay = sqlDateBucketText(matkaBets.createdAt, tz);
    let matkaQuery = db
      .select({
        date: matkaDay,
        stakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}), 0)`,
        payouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
      })
      .from(matkaBets)
      .leftJoin(users, eq(matkaBets.userId, users.id));

    if (filter.agentId) {
      // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
      matkaConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
    }

    const matkaResults = await matkaQuery.where(and(...matkaConditions)).groupBy(matkaDay);

    matkaResults.forEach((r) => {
      const date = r.date;
      const existing = dateMap.get(date) || 0;
      const pnl = Number(r.stakes) - Number(r.payouts);
      dateMap.set(date, existing + pnl);
    });
  }

  // Get casino PNL if domain is 'all' or 'casino'
  if (!filter.domain || filter.domain === 'all' || filter.domain === 'casino') {
    const casinoConditions: any[] = [];

    if (filter.tenant) {
      casinoConditions.push(eq(casinoBets.tenant, filter.tenant));
    }
    if (filter.whitelabelId) {
      casinoConditions.push(eq(casinoBets.whitelabelId, filter.whitelabelId));
    }

    casinoConditions.push(
      gte(casinoBets.createdAt, dateFrom),
      lte(casinoBets.createdAt, dateToEnd),
      inArray(casinoBets.status, ['won', 'lost']),
      eq(casinoBets.walletType, 'cash'),
    );

    if (filter.currency) {
      casinoConditions.push(eq(casinoBets.currency, filter.currency));
    }

    const casinoDay = sqlDateBucketText(casinoBets.createdAt, tz);
    let casinoQuery = db
      .select({
        date: casinoDay,
        stakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
        payouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      })
      .from(casinoBets)
      .leftJoin(users, eq(casinoBets.userId, users.id));

    if (filter.agentId) {
      // Subtree + referral players, the canonical agent scope (agentPlayerScope.ts).
      casinoConditions.push(inAgentPlayers(users.id, filter.agentId, filter.tenant));
    }

    const casinoResults = await casinoQuery.where(and(...casinoConditions)).groupBy(casinoDay);

    casinoResults.forEach((r) => {
      const date = r.date;
      const existing = dateMap.get(date) || 0;
      const pnl = Number(r.stakes) - Number(r.payouts);
      dateMap.set(date, existing + pnl);
    });
  }

  return Array.from(dateMap.entries()).map(([date, value]) => ({
    dimension: 'All',
    value: Number(value) || 0,
    date: new Date(date).toISOString(),
  }));
}

