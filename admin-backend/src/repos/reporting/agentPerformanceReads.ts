import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js'
import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { db } from '@/db/client.js';
import { agents, agentLedger, users, sportsBets, casinoBets, matkaBets, agentCommissionConfig, agentSharingConfig } from '@shared/db/schema.js';
import { and, eq, gte, lte, gt, lt, inArray, sql } from 'drizzle-orm';
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js';
import type { AgentReportingFilter } from './agentReportingRepo.js';
import { attributedAgentId, referralAttributions, referrerUsers, referralAttributionJoinOn, referrerJoinOn } from '@src/domains/agents/services/commissionPlayerScope.js';

const DOMAINS = ['sports', 'casino', 'matka'] as const;
type Domain = typeof DOMAINS[number];
type RateRow = { agentId: string; domain: string; rate: string | number; effectiveFrom: Date | string; effectiveTo: Date | string | null };
type BetRow = { agentId: string; stakes: string | number; payouts: string | number; count: string | number };
type RateSet = { commission: Record<Domain, number>; share: Record<Domain, number> };

/** One deduplicated membership per target/descendant. Passing it as a single JSON
 * parameter avoids PostgreSQL's bind limit on larger hierarchies. Grouping by the
 * target in SQL keeps numeric sums and MAX(playerCount) identical to the old IN queries. */
export function performanceScope(hierarchy: ReadonlyMap<string, readonly string[]>) {
  const members = [...hierarchy].flatMap(([target, ids]) => [...new Set(ids)].map(id => ({ target_id: target, agent_id: id })));
  return sql`jsonb_to_recordset(${JSON.stringify(members)}::jsonb) AS performance_scope(target_id uuid, agent_id uuid)`;
}
const target = sql<string>`performance_scope.target_id`;
const member = sql<string>`performance_scope.agent_id`;

/** The existing report chooses the latest overlapping config per domain; if
 * every applicable rate is non-positive, it falls back to the latest configs. */
export function performanceRates(agentId: string, scheme: string, rows: { commission: readonly RateRow[]; share: readonly RateRow[] }, from: Date, to: Date, latest: boolean): RateSet {
  const read = (unbounded: boolean): RateSet => {
    const result: RateSet = { commission: { sports: 0, casino: 0, matka: 0 }, share: { sports: 0, casino: 0, matka: 0 } };
    for (const kind of ['commission', 'share'] as const) {
      if (kind === 'commission' ? !['COMMISSION', 'CREDIT'].includes(scheme) : !['SHARING', 'CREDIT'].includes(scheme)) continue;
      const candidates = rows[kind].filter(row => row.agentId === agentId && (unbounded || (new Date(row.effectiveFrom).getTime() <= to.getTime() && (row.effectiveTo == null || new Date(row.effectiveTo).getTime() >= from.getTime()))))
        .slice().sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
      for (const domain of DOMAINS) result[kind][domain] = Number(candidates.find(row => row.domain === domain)?.rate ?? 0) || 0;
    }
    return result;
  };
  const result = read(latest);
  const commission = Object.values(result.commission).some(rate => rate > 0);
  const share = Object.values(result.share).some(rate => rate > 0);
  const fallback = scheme === 'COMMISSION' ? !commission : scheme === 'SHARING' ? !share : scheme === 'CREDIT' && !commission && !share;
  return !latest && fallback ? read(true) : result;
}

/** All state is confined to one report request. Refresh reads new bets/configs. */
export class AgentPerformanceReads {
  constructor(private readonly players: ReadonlyMap<string, number>, private readonly bets: ReadonlyMap<Domain, ReadonlyMap<string, BetRow>>,
    private readonly config: { commission: readonly RateRow[]; share: readonly RateRow[] }, private readonly from: Date, private readonly to: Date) {}
  rates(id: string, scheme: string, latest = false) { return performanceRates(id, scheme, this.config, this.from, this.to, latest); }
  breakdown(id: string) {
    return DOMAINS.map(domain => { const row = this.bets.get(domain)?.get(id); return { domain, turnover: Number(row?.stakes ?? 0) || 0,
      ggr: (Number(row?.stakes ?? 0) || 0) - (Number(row?.payouts ?? 0) || 0), cut: 0, cutPercent: 0 }; });
  }
  fromBets(id: string, scheme: string) {
    const playerCount = this.players.get(id) ?? 0;
    if (!playerCount) return null;
    const domains = this.breakdown(id);
    const totalTurnover = domains.reduce((sum, row) => sum + row.turnover, 0);
    const totalPayouts = DOMAINS.reduce((sum, domain) => sum + (Number(this.bets.get(domain)?.get(id)?.payouts ?? 0) || 0), 0);
    const rates = this.rates(id, scheme);
    return { totalTurnover, totalGGR: totalTurnover - totalPayouts, playerCount,
      betCount: DOMAINS.reduce((sum, domain) => sum + (Number(this.bets.get(domain)?.get(id)?.count ?? 0) || 0), 0),
      commissionEarned: ['COMMISSION', 'CREDIT'].includes(scheme) ? domains.reduce((sum, row) => sum + row.ggr * rates.commission[row.domain], 0) : 0,
      shareEarned: ['SHARING', 'CREDIT'].includes(scheme) ? domains.reduce((sum, row) => sum + row.ggr * rates.share[row.domain], 0) : 0 };
  }
}

export async function createAgentPerformanceReads(hierarchy: ReadonlyMap<string, readonly string[]>, filter: AgentReportingFilter, timezone: string, options: { dateField?: 'createdAt' | 'settledAt' } = {}) {
  const scope = performanceScope(hierarchy);
  const tenant = filter.tenant || filter.whitelabelId;
  const currency = filter.currency || (tenant ? await getWhitelabelCurrency(tenant) : undefined);
  const configIds = [...hierarchy.keys(), ...(filter.parentAgentId ? [filter.parentAgentId] : [])];
  const from = filter.dateFrom ? parseDateFrom(String(filter.dateFrom), timezone) : new Date(0);
  const to = filter.dateTo ? parseDateTo(String(filter.dateTo), timezone) : new Date();
  const betConditions = (table: typeof sportsBets | typeof casinoBets | typeof matkaBets, statuses: string[]) => {
    const conditions = [inArray(table.status as any, statuses)];
    if (filter.tenant) conditions.push(eq(table.tenant, filter.tenant));
    if (filter.whitelabelId) conditions.push(eq(table.whitelabelId, filter.whitelabelId));
    if (currency) conditions.push(eq(table.currency, currency));
    const dateColumn = options.dateField === 'createdAt' ? table.createdAt : table.settledAt;
    if (filter.dateFrom) conditions.push(gte(dateColumn, from));
    if (filter.dateTo) conditions.push(lte(dateColumn, to));
    return conditions;
  };
  const [players, commission, share, sports, casino, matka] = await Promise.all([
    db.select({ agentId: target, count: sql<number>`count(*)` }).from(users).leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant)).leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant)).innerJoin(scope, eq(attributedAgentId, member)).where(tenant ? eq(users.tenant, tenant) : undefined).groupBy(target),
    db.select({ agentId: agentCommissionConfig.agentId, domain: agentCommissionConfig.domain, rate: agentCommissionConfig.commissionRate,
      effectiveFrom: agentCommissionConfig.effectiveFrom, effectiveTo: agentCommissionConfig.effectiveTo }).from(agentCommissionConfig).where(inArray(agentCommissionConfig.agentId, configIds)),
    db.select({ agentId: agentSharingConfig.agentId, domain: agentSharingConfig.domain, rate: agentSharingConfig.shareRate,
      effectiveFrom: agentSharingConfig.effectiveFrom, effectiveTo: agentSharingConfig.effectiveTo }).from(agentSharingConfig).where(inArray(agentSharingConfig.agentId, configIds)),
    !filter.domain || filter.domain === 'sports' ? db.select({ agentId: target, stakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
      payouts: sportsPayoutAggregateSql(), count: sql<number>`COUNT(*)` }).from(sportsBets).innerJoin(users, eq(sportsBets.userId, users.id)).leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant)).leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant)).innerJoin(scope, eq(attributedAgentId, member))
      .where(and(...betConditions(sportsBets, ['won', 'lost', 'settled']))).groupBy(target) : [],
    !filter.domain || filter.domain === 'casino' ? db.select({ agentId: target, stakes: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
      payouts: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0)::numeric), 0)`, count: sql<number>`COUNT(*)` }).from(casinoBets).innerJoin(users, eq(casinoBets.userId, users.id)).leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant)).leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant)).innerJoin(scope, eq(attributedAgentId, member))
      .where(and(...betConditions(casinoBets, ['won', 'lost']), eq(casinoBets.walletType, 'cash'))).groupBy(target) : [],
    !filter.domain || filter.domain === 'matka' ? db.select({ agentId: target, stakes: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric), 0)`,
      payouts: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}, 0)::numeric), 0)`, count: sql<number>`COUNT(*)` }).from(matkaBets).innerJoin(users, eq(matkaBets.userId, users.id)).leftJoin(referralAttributions, referralAttributionJoinOn(tenant || users.tenant)).leftJoin(referrerUsers, referrerJoinOn(tenant || users.tenant)).innerJoin(scope, eq(attributedAgentId, member))
      .where(and(...betConditions(matkaBets, ['won', 'lost']))).groupBy(target) : [],
  ]);
  const data = new Map<Domain, ReadonlyMap<string, BetRow>>([
    ['sports', new Map(sports.map(row => [row.agentId, row]))], ['casino', new Map(casino.map(row => [row.agentId, row]))], ['matka', new Map(matka.map(row => [row.agentId, row]))],
  ]);
  return new AgentPerformanceReads(new Map(players.map(row => [row.agentId, Number(row.count)])), data, { commission, share }, from, to);
}

/** The report displays earnedPosted only. Calculation/payout/readiness values
 * are intentionally not computed for this column. The ledger overlap and currency
 * predicates match AgentLedgerRepo.getEarnedPostedSum. */
export async function getPostedPerformanceCommissions(tenant: string, ids: string[], currency: string, from: Date, to: Date, domain?: Domain) {
  if (!ids.length) return new Map<string, number>();
  try {
    const rows = await db.select({ agentId: agentLedger.agentId, total: sql<number>`COALESCE(SUM(CAST(${agentLedger.amount} AS NUMERIC)), 0)` })
      .from(agentLedger).innerJoin(agents, eq(agentLedger.agentId, agents.id))
      .where(and(eq(agents.tenantId, tenant), inArray(agentLedger.agentId, ids), eq(agentLedger.lineType, 'COMMISSION'), ...(domain ? [eq(agentLedger.domain, domain)] : []), eq(agentLedger.currency, currency), gt(agentLedger.periodTo, from), lt(agentLedger.periodFrom, to)))
      .groupBy(agentLedger.agentId);
    return new Map(rows.map(row => [row.agentId, Number.isFinite(Number(row.total)) ? Number(row.total) : 0]));
  } catch (error) {
    console.error('[AgentPerformance] posted commission read failed:', error instanceof Error ? error.message : error);
    return new Map<string, number>();
  }
}
