import { db } from '@/db/client.js';
import { bonusAwards, bonusCampaigns } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { coerceReportingRangeStart, coerceReportingRangeEnd } from '@src/shared/dateUtils.js';
import { inAgentPlayers } from './agentPlayerScope.js';

const DEFAULT_TZ = 'Asia/Kolkata';

const BONUS_LEDGER_DOMAINS = ['sports', 'casino', 'matka', 'global'] as const;
type BonusLedgerDomain = (typeof BONUS_LEDGER_DOMAINS)[number];

function normalizeBonusLedgerDomain(d: string | undefined): BonusLedgerDomain | undefined {
  if (!d?.trim()) return undefined;
  const x = d.trim().toLowerCase();
  return (BONUS_LEDGER_DOMAINS as readonly string[]).includes(x) ? (x as BonusLedgerDomain) : undefined;
}

export interface BonusReportingFilter {
  tenant?: string;
  whitelabelId?: string;
  campaignId?: number;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  domain?: 'sports' | 'casino' | 'matka' | 'global';
  currency?: string;
  /** Agent caller: restrict to awards of the agent's players (subtree + referral). */
  agentId?: string;
}

export interface BonusKPIs {
  totalIssued: number;
  totalRedeemed: number;
  totalExpired: number;
  totalCancelled: number;
  outstandingLiability: number;
  totalWagering: number;
  totalRevenue: number;
  awardCount: number;
  redemptionCount: number;
  playerCount: number;
  roi: number;
}

/**
 * Compute bonus KPIs live from bonus_awards (joined with bonus_campaigns for tenant filtering).
 * The reporting_bonus_ledgers table has no population pipeline, so we query the source table directly.
 */
function resolveBonusCampaignTenantKey(filter: BonusReportingFilter): string {
  const t = filter.tenant?.trim();
  const wl = filter.whitelabelId?.trim();
  if (t && t !== 'default') return t;
  if (wl) return wl;
  if (t) return t;
  return 'default';
}

export async function getBonusKPIs(filter: BonusReportingFilter): Promise<BonusKPIs> {
  const tenant = resolveBonusCampaignTenantKey(filter);
  const domain = normalizeBonusLedgerDomain(filter.domain);

  const conditions: ReturnType<typeof eq>[] = [eq(bonusCampaigns.tenant, tenant)];

  const dateFrom = coerceReportingRangeStart(filter.dateFrom, DEFAULT_TZ);
  const dateTo = coerceReportingRangeEnd(filter.dateTo, DEFAULT_TZ);

  if (dateFrom) conditions.push(gte(bonusAwards.awardedAt, dateFrom));
  if (dateTo) conditions.push(lte(bonusAwards.awardedAt, dateTo));
  if (filter.currency) conditions.push(eq(bonusAwards.currency, filter.currency));
  if (filter.campaignId) conditions.push(eq(bonusAwards.campaignId, filter.campaignId));
  if (domain) conditions.push(eq(bonusAwards.domain, domain));
  // An agent sees bonuses awarded to its own players only, not the whitelabel's.
  if (filter.agentId) conditions.push(inAgentPlayers(bonusAwards.userId, filter.agentId, filter.tenant) as any);

  const result = await db
    .select({
      totalIssued: sql<number>`COALESCE(SUM(${bonusAwards.amount}::numeric), 0)`,
      totalRedeemed: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} = 'completed' THEN ${bonusAwards.amount}::numeric ELSE 0 END), 0)`,
      totalExpired: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} = 'expired' THEN ${bonusAwards.amount}::numeric ELSE 0 END), 0)`,
      totalCancelled: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} = 'cancelled' THEN ${bonusAwards.amount}::numeric ELSE 0 END), 0)`,
      outstandingLiability: sql<number>`COALESCE(SUM(CASE WHEN ${bonusAwards.status} IN ('pending', 'active') THEN ${bonusAwards.amount}::numeric ELSE 0 END), 0)`,
      totalWagering: sql<number>`COALESCE(SUM(${bonusAwards.currentWagering}::numeric), 0)`,
      awardCount: sql<number>`COUNT(*)`,
      redemptionCount: sql<number>`COUNT(CASE WHEN ${bonusAwards.status} = 'completed' THEN 1 END)`,
      playerCount: sql<number>`COUNT(DISTINCT ${bonusAwards.userId})`,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
    .where(and(...conditions));

  const kpis = result[0] || {
    totalIssued: 0,
    totalRedeemed: 0,
    totalExpired: 0,
    totalCancelled: 0,
    outstandingLiability: 0,
    totalWagering: 0,
    awardCount: 0,
    redemptionCount: 0,
    playerCount: 0,
  };

  const totalIssued = Number(kpis.totalIssued) || 0;
  const totalRedeemed = Number(kpis.totalRedeemed) || 0;
  const totalExpired = Number(kpis.totalExpired) || 0;
  const totalCancelled = Number(kpis.totalCancelled) || 0;
  const outstandingLiability = Number(kpis.outstandingLiability) || 0;
  const totalWagering = Number(kpis.totalWagering) || 0;

  const totalRevenue = totalExpired + totalCancelled;
  const roi = totalIssued > 0 ? totalRevenue / totalIssued : 0;

  return {
    totalIssued,
    totalRedeemed,
    totalExpired,
    totalCancelled,
    outstandingLiability,
    totalWagering,
    totalRevenue,
    awardCount: Number(kpis.awardCount) || 0,
    redemptionCount: Number(kpis.redemptionCount) || 0,
    playerCount: Number(kpis.playerCount) || 0,
    roi,
  };
}
