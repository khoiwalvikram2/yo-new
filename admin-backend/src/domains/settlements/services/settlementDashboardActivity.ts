import { DateTime } from 'luxon';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@src/db/client.js';
import { agentSettlementTransactions as settlements, commissionPayouts as payouts } from '@shared/db/schema.js';

export function settlementActivityRange(args: { fromDate?: string | null; toDate?: string | null }, timeZone: string, now = new Date()) {
  const localNow = DateTime.fromJSDate(now, { zone: timeZone });
  if (!localNow.isValid) throw new Error('Invalid settlement timezone');
  const filtered = args.fromDate != null || args.toDate != null;
  const parseDay = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Settlement dates must use YYYY-MM-DD');
    const parsed = DateTime.fromISO(value, { zone: timeZone }).startOf('day');
    if (!parsed.isValid || parsed.toISODate() !== value) throw new Error('Invalid settlement date');
    return parsed;
  };
  const from = filtered ? parseDay(args.fromDate) : localNow.startOf('month');
  const lastDay = filtered ? parseDay(args.toDate) : localNow.startOf('day');
  if (from > lastDay) throw new Error('Settlement end date must be on or after the start date');
  // Half-open bounds include every instant of the last local day, even sub-millisecond records.
  const toExclusive = filtered ? lastDay.plus({ days: 1 }) : localNow;
  const trendFrom = filtered ? from : localNow.minus({ months: 11 }).startOf('month');
  return { from: from.toJSDate(), toExclusive: toExclusive.toJSDate(), fromDate: from.toISODate()!, toDate: lastDay.toISODate()!,
    trendFrom, trendToExclusive: toExclusive, timeZone, now };
}
export type SettlementActivityRange = ReturnType<typeof settlementActivityRange>;

export async function readSettlementDashboardActivity(tenant: string, agentId: string | undefined, range: SettlementActivityRange) {
  const localNow = DateTime.fromJSDate(range.now, { zone: range.timeZone });
  const monthStart = localNow.startOf('month').toJSDate();
  const thirtyDaysAgo = new Date(range.now.getTime() - 30 * 86400000);
  const earliest = new Date(Math.min(monthStart.getTime(), thirtyDaysAgo.getTime(), range.from.getTime()));
  const latest = new Date(Math.max(range.now.getTime(), range.toExclusive.getTime()));
  const settlementScope = [eq(settlements.tenant, tenant)];
  const payoutScope = [eq(payouts.tenant, tenant)];
  if (agentId) { settlementScope.push(eq(settlements.agentId, agentId)); payoutScope.push(eq(payouts.agentId, agentId)); }
  const periodSettlements = and(gte(settlements.createdAt, range.from), lt(settlements.createdAt, range.toExclusive))!;
  const periodPayouts = and(gte(payouts.createdAt, range.from), lt(payouts.createdAt, range.toExclusive))!;
  const settlementMonth = sql<string>`to_char(${settlements.createdAt} AT TIME ZONE ${range.timeZone}, 'YYYY-MM')`;
  const payoutMonth = sql<string>`to_char(${payouts.createdAt} AT TIME ZONE ${range.timeZone}, 'YYYY-MM')`;
  // Group by the selected month column (ordinal 1). Repeating the expression would
  // create a second timezone parameter that PostgreSQL treats as a different group.
  const [settlementTotals, payoutTotals, settledTrend, paidTrend] = await Promise.all([
    db.select({
      thisMonth: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${settlements.createdAt} >= ${monthStart.toISOString()}::timestamptz and ${settlements.createdAt} < ${range.now.toISOString()}::timestamptz), 0)`,
      last30Days: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${settlements.createdAt} >= ${thirtyDaysAgo.toISOString()}::timestamptz and ${settlements.createdAt} < ${range.now.toISOString()}::timestamptz), 0)`,
      settled: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${periodSettlements}), 0)`,
      paid: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${periodSettlements} and ${settlements.direction} = 'TO_AGENT'), 0)`,
      collected: sql<string>`coalesce(sum(${settlements.amount}::numeric) filter (where ${periodSettlements} and ${settlements.direction} = 'FROM_AGENT'), 0)`,
    }).from(settlements).where(and(...settlementScope, gte(settlements.createdAt, earliest), lt(settlements.createdAt, latest))),
    db.select({
      thisMonth: sql<string>`coalesce(sum(${payouts.amount}::numeric) filter (where ${payouts.createdAt} >= ${monthStart.toISOString()}::timestamptz and ${payouts.createdAt} < ${range.now.toISOString()}::timestamptz), 0)`,
      paid: sql<string>`coalesce(sum(${payouts.amount}::numeric) filter (where ${periodPayouts}), 0)`,
    }).from(payouts).where(and(...payoutScope, gte(payouts.createdAt, earliest), lt(payouts.createdAt, latest))),
    db.select({ month: settlementMonth, total: sql<string>`coalesce(sum(${settlements.amount}::numeric), 0)` }).from(settlements)
      .where(and(...settlementScope, gte(settlements.createdAt, range.trendFrom.toJSDate()), lt(settlements.createdAt, range.trendToExclusive.toJSDate()))).groupBy(sql`1`),
    db.select({ month: payoutMonth, total: sql<string>`coalesce(sum(${payouts.amount}::numeric), 0)` }).from(payouts)
      .where(and(...payoutScope, gte(payouts.createdAt, range.trendFrom.toJSDate()), lt(payouts.createdAt, range.trendToExclusive.toJSDate()))).groupBy(sql`1`),
  ]);
  const settled = settlementTotals[0]; const paid = payoutTotals[0];
  const settledByMonth = new Map(settledTrend.map(row => [row.month, Number(row.total)]));
  const paidByMonth = new Map(paidTrend.map(row => [row.month, Number(row.total)]));
  const monthlyTrend: Array<{ month: string; totalSettled: number; commissionPaid: number }> = [];
  for (let month = range.trendFrom.startOf('month'); month < range.trendToExclusive; month = month.plus({ months: 1 })) {
    const key = month.toFormat('yyyy-MM');
    monthlyTrend.push({ month: key, totalSettled: settledByMonth.get(key) ?? 0, commissionPaid: paidByMonth.get(key) ?? 0 });
  }
  return { periodFrom: range.fromDate, periodTo: range.toDate,
    totalSettledThisMonth: Number(settled?.thisMonth ?? 0), totalSettledLast30Days: Number(settled?.last30Days ?? 0), totalCommissionPaidThisMonth: Number(paid?.thisMonth ?? 0),
    totalSettledInPeriod: Number(settled?.settled ?? 0), totalPaidToAgentsInPeriod: Number(settled?.paid ?? 0), totalCollectedFromAgentsInPeriod: Number(settled?.collected ?? 0), totalCommissionPaidInPeriod: Number(paid?.paid ?? 0), monthlyTrend };
}
