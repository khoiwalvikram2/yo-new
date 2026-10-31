import { db } from '@/db/client.js';
import { sportsBets, casinoBets, matkaBets } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getAppConfigDb } from '@/repos/app-config/appConfigRepo.js';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';

interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Get financial forecasts and trend analysis (amounts in whitelabel currency, no conversion)
 */
export async function getFinancialForecast(tenant: string, filter?: DateRangeFilter) {
  try {
    const tz = await getWhitelabelTimezone(tenant ?? 'default');
    const dateFrom = filter?.dateFrom ? parseDateFrom(filter.dateFrom, tz) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = filter?.dateTo ? parseDateTo(filter.dateTo, tz) : new Date();

    const appConfig = await getAppConfigDb(tenant);
    const currency = (appConfig?.baseCurrency || 'INR') as string;

    const [projections, trends, budgetTracking, seasonality] = await Promise.all([
      getRevenueProjections(tenant, dateFrom, dateTo, currency),
      getTrendAnalysis(tenant, dateFrom, dateTo, currency),
      getBudgetTracking(tenant, dateFrom, dateTo, currency),
      getSeasonalityData(tenant, currency),
    ]);

    return {
      projections,
      trends,
      budgetTracking,
      seasonality,
    };
  } catch (error: any) {
    return {
      projections: {
        projectedMonthly: 0,
        projectedWeekly: 0,
        projectedDaily: 0,
        confidence: 0,
        growthRate: 0,
      },
      trends: {
        shortTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
        mediumTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
        longTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
      },
      budgetTracking: {
        budgetAmount: 0,
        actualAmount: 0,
        variance: 0,
        variancePercent: 0,
        status: 'on-track',
      },
      seasonality: {
        pattern: 'stable',
        peakMonth: 'N/A',
        lowMonth: 'N/A',
        volatility: 0,
      },
    };
  }
}

/**
 * Get revenue projections based on current trends (amounts in whitelabel currency)
 */
async function getRevenueProjections(tenant: string, dateFrom: Date, dateTo: Date, currency: string) {
  try {
    const baseConditions = [
      eq(sportsBets.tenant, tenant),
      gte(sportsBets.createdAt, dateFrom),
      lte(sportsBets.createdAt, dateTo),
    ];
    if (currency) baseConditions.push(eq(sportsBets.currency, currency));

    const [currentRevenue] = await db
      .select({
        total: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...baseConditions));

    const periodDays = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
    const dailyAvg = Number(currentRevenue?.total || 0) / Math.max(periodDays, 1);

    // Simple linear projection
    const projectedDaily = dailyAvg;
    const projectedWeekly = dailyAvg * 7;
    const projectedMonthly = dailyAvg * 30;

    // Calculate growth rate from previous period
    const previousFrom = new Date(dateFrom.getTime() - (dateTo.getTime() - dateFrom.getTime()));
    const previousTo = dateFrom;

    const prevConditions = [
      eq(sportsBets.tenant, tenant),
      gte(sportsBets.createdAt, previousFrom),
      lte(sportsBets.createdAt, previousTo),
    ];
    if (currency) prevConditions.push(eq(sportsBets.currency, currency));

    const [previousRevenue] = await db
      .select({
        total: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...prevConditions));

    const prevTotal = Number(previousRevenue?.total || 1);
    const currentTotal = Number(currentRevenue?.total || 0);
    const growthRate = prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0;

    return {
      projectedMonthly,
      projectedWeekly,
      projectedDaily,
      confidence: 75, // Placeholder confidence score
      growthRate,
    };
  } catch (error: any) {
    return {
      projectedMonthly: 0,
      projectedWeekly: 0,
      projectedDaily: 0,
      confidence: 0,
      growthRate: 0,
    };
  }
}

/**
 * Get trend analysis for different time horizons
 */
async function getTrendAnalysis(tenant: string, dateFrom: Date, dateTo: Date, currency: string) {
  try {
    // Short term: last 7 days
    const shortTerm = await analyzeTrend(tenant, 7, currency);
    // Medium term: last 30 days
    const mediumTerm = await analyzeTrend(tenant, 30, currency);
    // Long term: last 90 days
    const longTerm = await analyzeTrend(tenant, 90, currency);

    return {
      shortTerm,
      mediumTerm,
      longTerm,
    };
  } catch (error: any) {
    return {
      shortTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
      mediumTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
      longTerm: { direction: 'stable', strength: 0, prediction: 'stable' },
    };
  }
}

async function analyzeTrend(tenant: string, days: number, currency: string) {
  try {
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dateTo = new Date();
    const midPoint = new Date((dateFrom.getTime() + dateTo.getTime()) / 2);

    const firstCond = [eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, dateFrom), lte(sportsBets.createdAt, midPoint)];
    if (currency) firstCond.push(eq(sportsBets.currency, currency));
    const secondCond = [eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, midPoint), lte(sportsBets.createdAt, dateTo)];
    if (currency) secondCond.push(eq(sportsBets.currency, currency));

    const [firstHalf] = await db
      .select({
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...firstCond));

    const [secondHalf] = await db
      .select({
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...secondCond));

    const first = Number(firstHalf?.revenue || 0);
    const second = Number(secondHalf?.revenue || 0);
    const change = second - first;
    const changePercent = first > 0 ? (change / first) * 100 : 0;

    const direction = changePercent > 5 ? 'up' : changePercent < -5 ? 'down' : 'stable';
    const strength = Math.abs(changePercent);
    const prediction = changePercent > 10 ? 'strong-growth' : changePercent < -10 ? 'decline' : 'stable';

    return {
      direction,
      strength,
      prediction,
    };
  } catch (error: any) {
    return {
      direction: 'stable',
      strength: 0,
      prediction: 'stable',
    };
  }
}

/**
 * Get budget tracking status
 */
async function getBudgetTracking(tenant: string, dateFrom: Date, dateTo: Date, currency: string) {
  try {
    const conditions = [eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, dateFrom), lte(sportsBets.createdAt, dateTo)];
    if (currency) conditions.push(eq(sportsBets.currency, currency));
    const [actual] = await db
      .select({
        total: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...conditions));

    const actualAmount = Number(actual?.total || 0);
    // TODO: Fetch actual budget from config/database
    const budgetAmount = actualAmount * 1.2; // Placeholder: assume budget is 20% higher
    const variance = actualAmount - budgetAmount;
    const variancePercent = budgetAmount > 0 ? (variance / budgetAmount) * 100 : 0;

    const status = variancePercent > -10 && variancePercent < 10 ? 'on-track' : variancePercent >= 10 ? 'over-budget' : 'under-budget';

    return {
      budgetAmount,
      actualAmount,
      variance,
      variancePercent,
      status,
    };
  } catch (error: any) {
    return {
      budgetAmount: 0,
      actualAmount: 0,
      variance: 0,
      variancePercent: 0,
      status: 'on-track',
    };
  }
}

/**
 * Get seasonality data
 */
async function getSeasonalityData(tenant: string, currency: string) {
  try {
    const conditions = [eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))];
    if (currency) conditions.push(eq(sportsBets.currency, currency));
    // Analyze last 12 months
    const results = await db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM ${sportsBets.createdAt})::int`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
      })
      .from(sportsBets)
      .where(and(...conditions))
      .groupBy(sql`EXTRACT(MONTH FROM ${sportsBets.createdAt})`);

    if (results.length === 0) {
      return {
        pattern: 'stable',
        peakMonth: 'N/A',
        lowMonth: 'N/A',
        volatility: 0,
      };
    }

    const revenues = results.map((r) => Number(r.revenue || 0));
    const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    const maxRevenue = Math.max(...revenues);
    const minRevenue = Math.min(...revenues);

    const peakMonth = results.find((r) => Number(r.revenue) === maxRevenue);
    const lowMonth = results.find((r) => Number(r.revenue) === minRevenue);

    const volatility = avgRevenue > 0 ? ((maxRevenue - minRevenue) / avgRevenue) * 100 : 0;
    const pattern = volatility > 30 ? 'seasonal' : volatility > 15 ? 'moderate' : 'stable';

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return {
      pattern,
      peakMonth: peakMonth ? monthNames[Number(peakMonth.month) - 1] : 'N/A',
      lowMonth: lowMonth ? monthNames[Number(lowMonth.month) - 1] : 'N/A',
      volatility,
    };
  } catch (error: any) {
    return {
      pattern: 'stable',
      peakMonth: 'N/A',
      lowMonth: 'N/A',
      volatility: 0,
    };
  }
}

