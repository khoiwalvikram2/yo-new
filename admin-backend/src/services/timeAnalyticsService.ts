import { db } from '@/db/client.js';
import { sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get time-based analytics including hourly/daily patterns and heatmaps.
 * All bet amounts are already in the whitelabel currency — no conversion needed.
 */
export async function getTimeAnalysis(tenant: string, filter?: DateRangeFilter) {
  try {
    const dateFrom = filter?.dateFrom ? new Date(filter.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = filter?.dateTo ? new Date(filter.dateTo) : new Date();

    const [hourlyActivity, dailyActivity, peakHours, activityHeatmap] = await Promise.all([
      getHourlyActivity(tenant, dateFrom, dateTo),
      getDailyActivity(tenant, dateFrom, dateTo),
      getPeakHours(tenant, dateFrom, dateTo),
      getActivityHeatmap(tenant, dateFrom, dateTo),
    ]);

    return {
      hourlyActivity,
      dailyActivity,
      peakHours,
      activityHeatmap,
    };
  } catch (error: any) {
    return {
      hourlyActivity: [],
      dailyActivity: [],
      peakHours: { revenueHour: 0, revenueAmount: 0, activityHour: 0, activityCount: 0 },
      activityHeatmap: [],
    };
  }
}

/**
 * Get hourly activity breakdown
 */
async function getHourlyActivity(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date,
) {
  try {
    const results = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${sportsBets.createdAt})::int`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
        betCount: sql<number>`COUNT(*)::int`,
        activePlayers: sql<number>`COUNT(DISTINCT ${sportsBets.userId})::int`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo)
        )
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${sportsBets.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${sportsBets.createdAt})`);

    return results.map((r) => {
      const revenue = Number(r.revenue || 0);
      const betCount = Number(r.betCount || 0);
      return {
        hour: Number(r.hour || 0),
        revenue,
        betCount,
        activePlayers: Number(r.activePlayers || 0),
        avgBetSize: betCount > 0 ? revenue / betCount : 0,
      };
    });
  } catch (error: any) {
    return [];
  }
}

/**
 * Get daily activity breakdown (by day of week)
 */
async function getDailyActivity(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date,
) {
  try {
    const results = await db
      .select({
        dayNumber: sql<number>`EXTRACT(DOW FROM ${sportsBets.createdAt})::int`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
        betCount: sql<number>`COUNT(*)::int`,
        activePlayers: sql<number>`COUNT(DISTINCT ${sportsBets.userId})::int`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo)
        )
      )
      .groupBy(sql`EXTRACT(DOW FROM ${sportsBets.createdAt})`)
      .orderBy(sql`EXTRACT(DOW FROM ${sportsBets.createdAt})`);

    return results.map((r) => {
      const dayNum = Number(r.dayNumber || 0);
      const betCount = Number(r.betCount || 0);
      const revenue = Number(r.revenue || 0);
      return {
        dayOfWeek: DAYS_OF_WEEK[dayNum] || 'Unknown',
        dayNumber: dayNum,
        revenue,
        betCount,
        activePlayers: Number(r.activePlayers || 0),
        avgRevenue: betCount > 0 ? revenue / betCount : 0,
      };
    });
  } catch (error: any) {
    return [];
  }
}

/**
 * Get peak hours information
 */
async function getPeakHours(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date,
) {
  try {
    const [revenueResult] = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${sportsBets.createdAt})::int`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo)
        )
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${sportsBets.createdAt})`)
      .orderBy(sql`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0) DESC`)
      .limit(1);

    const [activityResult] = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${sportsBets.createdAt})::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo)
        )
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${sportsBets.createdAt})`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);

    return {
      revenueHour: Number(revenueResult?.hour || 0),
      revenueAmount: Number(revenueResult?.revenue || 0),
      activityHour: Number(activityResult?.hour || 0),
      activityCount: Number(activityResult?.count || 0),
    };
  } catch (error: any) {
    return {
      revenueHour: 0,
      revenueAmount: 0,
      activityHour: 0,
      activityCount: 0,
    };
  }
}

/**
 * Get activity heatmap data (day x hour)
 */
async function getActivityHeatmap(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    const results = await db
      .select({
        dayNumber: sql<number>`EXTRACT(DOW FROM ${sportsBets.createdAt})::int`,
        hour: sql<number>`EXTRACT(HOUR FROM ${sportsBets.createdAt})::int`,
        value: sql<number>`COUNT(*)::int`,
      })
      .from(sportsBets)
      .where(
        and(
          eq(sportsBets.tenant, tenant),
          gte(sportsBets.createdAt, dateFrom),
          lte(sportsBets.createdAt, dateTo)
        )
      )
      .groupBy(
        sql`EXTRACT(DOW FROM ${sportsBets.createdAt})`,
        sql`EXTRACT(HOUR FROM ${sportsBets.createdAt})`
      );

    return results.map((r) => {
      const value = Number(r.value || 0);
      const dayNum = Number(r.dayNumber || 0);
      return {
        day: DAYS_OF_WEEK[dayNum] || 'Unknown',
        hour: Number(r.hour || 0),
        value,
        intensity: value > 100 ? 'high' : value > 50 ? 'medium' : 'low',
      };
    });
  } catch (error: any) {
    return [];
  }
}
