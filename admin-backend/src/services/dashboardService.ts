import * as sportsReportingRepo from '@/repos/reporting/sportsReportingRepo.js';
import * as casinoReportingRepo from '@/repos/reporting/casinoReportingRepo.js';
import * as matkaReportingRepo from '@/repos/reporting/matkaReportingRepo.js';
import * as agentReportingRepo from '@/repos/reporting/agentReportingRepo.js';
import * as bonusReportingRepo from '@/repos/reporting/bonusReportingRepo.js';
import { getLedgerAggregatesByWalletDb, getManualDepositWithdrawalStatsTenantDb } from '@/repos/players/walletsRepo.js';
import { listDepositRequests } from '@/repos/deposits/depositRequestsRepo.js';
import { listWithdrawalRequests } from '@/repos/payments/withdrawalRequestsRepo.js';
import { db } from '@/db/client.js';
import { users, ledgerEntries, wallets, agentLedger, agentSettlements, agents, userRoles, roles, depositRequests, withdrawalRequests } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, count, notInArray, inArray } from 'drizzle-orm';
import { escapeIanaTimezoneForSql, sqlDateBucketText, settlementDateExpr } from '@/shared/reportingSql.js';
import { getWhitelabelTimezone } from '@/shared/whitelabelConfig.js';
import { getUserRoleNames } from '@/repos/rbac/rbacRepo.js';
import { getAppConfigDb } from '@/repos/app-config/appConfigRepo.js';
import { CurrencyCode } from '@/types/currency.js';
import { createCommissionReportCalculator } from '@/domains/settlements/services/commissionReportCalculator.js';
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js';
import { DateTime } from 'luxon';

export interface DashboardDateRange {
  dateFrom?: Date | string;
  dateTo?: Date | string;
}

export interface DashboardKPIs {
  turnover: number;
  sportsTurnover: number;
  casinoTurnover: number;
  matkaTurnover: number;
  ggr: number;
  ngr: number;
  liquidity: number;
  exposure: number;
  unmatchedOrders: number;
  upcomingDrawCutoffs: number;
  jackpotStatus: string;
  alerts: Array<{ id: string; level: string; message: string; at: string }>;
  approvalsPending: Array<{ id: string; domain: string; action: string; resourceId: string; requestedAt: string }>;
  auditSpotlight: Array<{ id: string; actorId: string; domain: string; action: string; timestamp: string }>;
  // Enhanced financial metrics
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  sportsGGR: number;
  casinoGGR: number;
  matkaGGR: number;
  activePlayers: number;
  newPlayers: number;
  totalPlayers: number;
  totalBets: number;
  sportsBets: number;
  casinoBets: number;
  matkaBets: number;
  agentCommission: number;
  bonusPayouts: number;
  // Agent stats
  totalSettlement: number;
  liveSettlement: number;
  liveCommission: number;
  totalCommission: number;
  // Advanced metrics
  ftd: number;
  ftdCount: number;
  ltv: number;
  arpu: number;
  arppu: number;
  conversionRate: number;
  retentionRate: number;
  churnRate: number;
  dauMauRatio: number;
  avgSessionDuration: number;
  avgBetSize: number;
  winRate: number;
  riskScore: number;
  complianceScore: number;
  // Growth metrics
  revenueGrowth: number;
  playerGrowth: number;
  depositGrowth: number;
  // Engagement metrics
  totalSessions: number;
  avgSessionsPerUser: number;
  bounceRate: number;
}

export interface DashboardTrendPoint {
  date: string;
  turnover: number;
  ggr: number;
  ngr: number;
  deposits: number;
  withdrawals: number;
  netDeposits: number;
  sportsGGR: number;
  casinoGGR: number;
  matkaGGR: number;
  activePlayers: number;
  betCount: number;
}

/**
 * Safely convert a value to a Date object
 */
function toDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? fallback : value;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? fallback : date;
  }
  return fallback;
}

/**
 * The currency a whitelabel's dashboard money is filtered by and reported in:
 * app_configs.base_currency, or 'INR' when none is configured.
 *
 * Exported so that figures presented beside the KPIs (the "Exposure by market"
 * card) resolve the currency exactly as the KPIs do. Errors propagate; the
 * core-mode KPI loop swallows them to 'INR' at its own call site. Not the same
 * as whitelabelConfig.getWhitelabelCurrency, which caches for 60 s and never
 * throws; the KPIs have always read app_configs directly.
 */
export async function getWhitelabelBaseCurrency(tenant: string): Promise<CurrencyCode> {
  const appConfig = await getAppConfigDb(tenant);
  return (appConfig?.baseCurrency || 'INR') as CurrencyCode;
}

/**
 * Compute the correct GROSS commission for a whitelabel across all its root agents.
 * Each root (top-level) agent's gross commission = entireTreeGGR × agentRate per domain.
 * This is the amount the whitelabel actually pays out in commission.
 */
async function computeWhitelabelGrossCommission(
  tenant: string,
  dateFrom: Date,
  dateTo: Date,
  currency: string,
): Promise<number> {
  try {
    const agentsRepo = new AgentsRepo();
    const rootAgentIds = await agentsRepo.listRootAgentIds(tenant);
    if (rootAgentIds.length === 0) return 0;

    // Share hierarchy, effective rate rows and grouped bets inside this request.
    // Root selection/order, tally, carry and gross commission maths stay in the
    // existing commission engine. A later refresh creates a fresh reader.
    const tenantAgents = await agentsRepo.list(tenant);
    const commissionService = await createCommissionReportCalculator(tenant, tenantAgents);

    const summaries = await Promise.all(
      rootAgentIds.map((agentId) =>
        commissionService
          .calculateCommissionSummary(agentId, dateFrom, dateTo, currency, 'gross')
          .catch(() => null),
      ),
    );

    let total = 0;
    for (const s of summaries) {
      if (s) total += s.effectiveCalculatedTotal;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Fetch pending deposit and withdrawal requests for approvalsPending and alerts.
 * Filtered by tenant (whitelabel).
 */
async function getPendingApprovalsAndAlerts(tenant: string): Promise<{
  approvalsPending: Array<{ id: string; domain: string; action: string; resourceId: string; requestedAt: string }>;
  alerts: Array<{ id: string; level: string; message: string; at: string }>;
}> {
  const approvalsPending: Array<{ id: string; domain: string; action: string; resourceId: string; requestedAt: string }> = [];
  const alerts: Array<{ id: string; level: string; message: string; at: string }> = [];
  const at = new Date().toISOString();
  try {
    const [depositsRes, withdrawalsRes] = await Promise.all([
      listDepositRequests({ status: 'PENDING' }, tenant, { offset: 0, limit: 20 }),
      listWithdrawalRequests({ status: 'PENDING' }, tenant, { offset: 0, limit: 20 }),
    ]);
    const pendingDeposits = depositsRes.items;
    const pendingWithdrawals = withdrawalsRes.items;
    for (const d of pendingDeposits) {
      const createdAt = d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt as any);
      approvalsPending.push({
        id: `d-${d.id}`,
        domain: 'deposits',
        action: 'review',
        resourceId: String(d.id),
        requestedAt: createdAt.toISOString(),
      });
    }
    for (const w of pendingWithdrawals) {
      const createdAt = w.createdAt instanceof Date ? w.createdAt : new Date(w.createdAt as any);
      approvalsPending.push({
        id: `w-${w.id}`,
        domain: 'withdrawals',
        action: 'review',
        resourceId: String(w.id),
        requestedAt: createdAt.toISOString(),
      });
    }
    if (pendingDeposits.length > 0) {
      alerts.push({
        id: 'pending-deposits',
        level: 'info',
        message: `${pendingDeposits.length} deposit(s) pending review`,
        at,
      });
    }
    if (pendingWithdrawals.length > 0) {
      alerts.push({
        id: 'pending-withdrawals',
        level: 'info',
        message: `${pendingWithdrawals.length} withdrawal(s) pending review`,
        at,
      });
    }
  } catch (err: any) {
  }
  return { approvalsPending, alerts };
}

const REPORT_PLAYER_FIELDS = new Set(['activePlayers', 'newPlayers', 'totalPlayers']);
const REPORT_MONEY_FIELDS = new Set(['totalDeposits', 'totalWithdrawals', 'netDeposits']);

export interface DashboardReportDeps {
  players: typeof getPlayerStatistics;
  ledger: typeof getLedgerAggregatesByWalletDb;
  manual: typeof getManualDepositWithdrawalStatsTenantDb;
  tenants: () => Promise<string[]>;
}
const reportDeps: DashboardReportDeps = {
  players: getPlayerStatistics,
  ledger: getLedgerAggregatesByWalletDb,
  manual: getManualDepositWithdrawalStatsTenantDb,
  tenants: async () => (await (await import('@src/repos/common/whitelabelRepo.js')).listWhitelabelsDb()).map(row => row.id),
};

/** A report asking only for player counts or completed deposit/withdrawal totals
 * does not need sports analytics, commissions, alerts or advanced metrics.
 * Use the same readers/date semantics as the full dashboard. Unsupported fields
 * return null so the caller falls back to the complete calculation. */
export async function getDashboardReportKPIs(
  tenant: string | undefined,
  whitelabelId: string | undefined,
  dateRange: DashboardDateRange | undefined,
  fields: ReadonlySet<string> | undefined,
  deps: DashboardReportDeps = reportDeps,
): Promise<Partial<DashboardKPIs> | null> {
  if (!fields || [...fields].some(field => !REPORT_PLAYER_FIELDS.has(field) && !REPORT_MONEY_FIELDS.has(field))) return null;
  if (fields.size === 0) return {};
  const core = !tenant || !whitelabelId;
  const tenants = core ? await deps.tenants() : [tenant];
  const from = toDate(dateRange?.dateFrom, new Date(Date.now() - 7 * 86400000));
  const to = toDate(dateRange?.dateTo, new Date());
  const needPlayers = [...fields].some(field => REPORT_PLAYER_FIELDS.has(field));
  const needMoney = [...fields].some(field => REPORT_MONEY_FIELDS.has(field));
  const rows = await Promise.all(tenants.map(async id => {
    const playerRead = () => deps.players(id, from, to);
    const ledgerRead = () => deps.ledger({ tenant: id, dateFrom: from, dateTo: to });
    const manualRead = () => deps.manual({ tenant: id, dateFrom: from, dateTo: to });
    const [players, ledger, manual] = await Promise.all([
      needPlayers ? (core ? playerRead().catch(() => ({ activePlayers: 0, newPlayers: 0, totalPlayers: 0 })) : playerRead()) : null,
      needMoney ? (core ? ledgerRead().catch(() => ({ depositVolume: 0, withdrawalVolume: 0 })) : ledgerRead()) : null,
      needMoney ? (core ? manualRead().catch(() => ({ manualDepositVolume: 0, manualWithdrawalVolume: 0 })) : manualRead()) : null,
    ]);
    const totalDeposits = (ledger?.depositVolume ?? 0) + (manual?.manualDepositVolume ?? 0);
    const totalWithdrawals = (ledger?.withdrawalVolume ?? 0) + (manual?.manualWithdrawalVolume ?? 0);
    return { activePlayers: players?.activePlayers ?? 0, newPlayers: players?.newPlayers ?? 0, totalPlayers: players?.totalPlayers ?? 0,
      totalDeposits, totalWithdrawals, netDeposits: totalDeposits - totalWithdrawals };
  }));
  const result: Partial<DashboardKPIs> = {};
  for (const field of fields) {
    const key = field as keyof typeof rows[number];
    const value = rows.reduce((sum, row) => sum + row[key], 0);
    result[key] = REPORT_PLAYER_FIELDS.has(key) ? Math.floor(value) : value;
  }
  return result;
}

/**
 * Get dashboard KPIs by aggregating data from all domains
 */
export async function getDashboardKPIs(
  tenant: string | undefined,
  whitelabelId?: string | undefined,
  dateRange?: DashboardDateRange
): Promise<DashboardKPIs> {
  // CRITICAL: Handle Director Admin core mode (undefined tenant/whitelabelId)
  // In core mode, aggregate data across ALL whitelabels for platform-wide view
  if (!tenant || !whitelabelId) {
    // Director Admin in core mode - aggregate KPIs across all whitelabels
    const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js');
    const allWhitelabels = await listWhitelabelsDb();
    
    if (allWhitelabels.length === 0) {
      // No whitelabels exist - return empty KPIs
      const now = new Date().toISOString();
      return {
        turnover: 0,
        sportsTurnover: 0,
        casinoTurnover: 0,
        matkaTurnover: 0,
        ggr: 0,
        ngr: 0,
        liquidity: 0,
        exposure: 0,
        unmatchedOrders: 0,
        upcomingDrawCutoffs: 0,
        jackpotStatus: 'Stable',
        alerts: [],
        approvalsPending: [],
        auditSpotlight: [],
        totalDeposits: 0,
        totalWithdrawals: 0,
        netDeposits: 0,
        sportsGGR: 0,
        casinoGGR: 0,
        matkaGGR: 0,
        activePlayers: 0,
        newPlayers: 0,
        totalPlayers: 0,
        totalBets: 0,
        sportsBets: 0,
        casinoBets: 0,
        matkaBets: 0,
        agentCommission: 0,
        bonusPayouts: 0,
        totalSettlement: 0,
        liveSettlement: 0,
        liveCommission: 0,
        totalCommission: 0,
        ftd: 0,
        ftdCount: 0,
        ltv: 0,
        arpu: 0,
        arppu: 0,
        conversionRate: 0,
        retentionRate: 0,
        churnRate: 0,
        dauMauRatio: 0,
        avgSessionDuration: 0,
        avgBetSize: 0,
        winRate: 0,
        riskScore: 0,
        complianceScore: 0,
        revenueGrowth: 0,
        playerGrowth: 0,
        depositGrowth: 0,
        totalSessions: 0,
        avgSessionsPerUser: 0,
        bounceRate: 0,
      };
    }
    
    // Aggregate KPIs across all whitelabels
    // Use a helper function to get KPIs for a single whitelabel (bypasses core mode check)
    const getKPIsForWhitelabelInternal = async (wlId: string): Promise<DashboardKPIs> => {
      // Convert date range to Date objects
      let dateFrom: Date;
      let dateTo: Date;
      
      if (dateRange?.dateFrom) {
        dateFrom = toDate(dateRange.dateFrom, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      } else {
        dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }

      if (dateRange?.dateTo) {
        dateTo = toDate(dateRange.dateTo, new Date());
      } else {
        dateTo = new Date();
      }

      const wlCurrency: string = await getWhitelabelBaseCurrency(wlId).catch(() => 'INR');

      const commonFilter = {
        tenant: wlId,
        whitelabelId: wlId,
        dateFrom,
        dateTo,
        currency: wlCurrency,
      };

      // Get KPIs from all domains in parallel
      const [sportsKPIs, casinoKPIs, matkaKPIs, bonusKPIs, grossCommission] = await Promise.all([
        sportsReportingRepo.getSportsKPIs(commonFilter as any).catch(() => ({ totalStakes: 0, grossGamingRevenue: 0, totalExposure: 0, betCount: 0 })),
        casinoReportingRepo.getCasinoKPIs(commonFilter as any).catch(() => ({ totalStakes: 0, grossGamingRevenue: 0, betCount: 0 })),
        matkaReportingRepo.getMatkaKPIs(commonFilter as any).catch(() => ({ totalStakes: 0, grossGamingRevenue: 0, totalExposure: 0, betCount: 0 })),
        bonusReportingRepo.getBonusKPIs(commonFilter as any).catch(() => ({ totalRedeemed: 0 })),
        computeWhitelabelGrossCommission(wlId, dateFrom, dateTo, wlCurrency),
      ]);

      const turnover = sportsKPIs.totalStakes + casinoKPIs.totalStakes + matkaKPIs.totalStakes;
      const ggr = sportsKPIs.grossGamingRevenue + casinoKPIs.grossGamingRevenue + matkaKPIs.grossGamingRevenue;
      const agentKPIs = { commissionEarned: grossCommission };
      const ngr = ggr - grossCommission - bonusKPIs.totalRedeemed;
      const exposure = sportsKPIs.totalExposure + matkaKPIs.totalExposure;

      const [ledgerStats, manualStats] = await Promise.all([
        getLedgerAggregatesByWalletDb({
          tenant: wlId,
          dateFrom,
          dateTo,
        }).catch(() => ({ depositVolume: 0, withdrawalVolume: 0, depositCount: 0, withdrawalCount: 0 })),
        getManualDepositWithdrawalStatsTenantDb({
          tenant: wlId,
          dateFrom,
          dateTo,
        }).catch(() => ({ manualDepositCount: 0, manualDepositVolume: 0, manualWithdrawalCount: 0, manualWithdrawalVolume: 0 })),
      ]);

      const combinedDepositVolume = (ledgerStats.depositVolume || 0) + (manualStats.manualDepositVolume || 0);
      const combinedWithdrawalVolume = (ledgerStats.withdrawalVolume || 0) + (manualStats.manualWithdrawalVolume || 0);

      const playerStats = await getPlayerStatistics(wlId, dateFrom, dateTo).catch(() => ({ totalPlayers: 0, newPlayers: 0, activePlayers: 0 }));
      const agentStats = await getAgentStats(wlId, dateFrom, dateTo).catch(() => ({ totalSettlement: 0, liveSettlement: 0, totalCommission: 0 }));
      const advancedMetrics = await getAdvancedMetrics(wlId, dateFrom, dateTo, playerStats, ledgerStats, turnover, ggr, exposure).catch(() => ({
        ftd: 0, ftdCount: 0, ltv: 0, arpu: 0, arppu: 0, conversionRate: 0, retentionRate: 0, churnRate: 0,
        dauMauRatio: 0, avgSessionDuration: 0, avgBetSize: 0, winRate: 0, riskScore: 0, complianceScore: 0,
        revenueGrowth: 0, playerGrowth: 0, depositGrowth: 0, totalSessions: 0, avgSessionsPerUser: 0, bounceRate: 0
      }));

      const { approvalsPending, alerts } = await getPendingApprovalsAndAlerts(wlId);

      return {
        turnover,
        ggr,
        ngr,
        liquidity: turnover,
        exposure,
        unmatchedOrders: 0,
        upcomingDrawCutoffs: 0,
        jackpotStatus: 'Stable',
        alerts,
        approvalsPending,
        auditSpotlight: [],
        sportsTurnover: sportsKPIs.totalStakes || 0,
        casinoTurnover: casinoKPIs.totalStakes || 0,
        matkaTurnover: matkaKPIs.totalStakes || 0,
        totalDeposits: combinedDepositVolume,
        totalWithdrawals: combinedWithdrawalVolume,
        netDeposits: combinedDepositVolume - combinedWithdrawalVolume,
        sportsGGR: sportsKPIs.grossGamingRevenue || 0,
        casinoGGR: casinoKPIs.grossGamingRevenue || 0,
        matkaGGR: matkaKPIs.grossGamingRevenue || 0,
        activePlayers: playerStats.activePlayers || 0,
        newPlayers: playerStats.newPlayers || 0,
        totalPlayers: playerStats.totalPlayers || 0,
        totalBets: (sportsKPIs.betCount || 0) + (casinoKPIs.betCount || 0) + (matkaKPIs.betCount || 0),
        sportsBets: sportsKPIs.betCount || 0,
        casinoBets: casinoKPIs.betCount || 0,
        matkaBets: matkaKPIs.betCount || 0,
        agentCommission: agentKPIs.commissionEarned || 0,
        bonusPayouts: bonusKPIs.totalRedeemed || 0,
        totalSettlement: agentStats.totalSettlement || 0,
        liveSettlement: agentStats.liveSettlement || 0,
        liveCommission: agentKPIs.commissionEarned || 0,
        totalCommission: agentStats.totalCommission || 0,
        ...advancedMetrics,
      };
    };

    const aggregatedKPIs = await Promise.all(
      allWhitelabels.map(wl => getKPIsForWhitelabelInternal(wl.id))
    );
    
    // Sum all metrics across whitelabels
    const aggregated = aggregatedKPIs.reduce((acc, kpi) => ({
      tenant: null, // Platform-wide
      turnover: acc.turnover + (kpi.turnover || 0),
      sportsTurnover: acc.sportsTurnover + (kpi.sportsTurnover ?? 0),
      casinoTurnover: acc.casinoTurnover + (kpi.casinoTurnover ?? 0),
      matkaTurnover: acc.matkaTurnover + (kpi.matkaTurnover ?? 0),
      ggr: acc.ggr + (kpi.ggr || 0),
      ngr: acc.ngr + (kpi.ngr || 0),
      liquidity: acc.liquidity + (kpi.liquidity || 0),
      exposure: acc.exposure + (kpi.exposure || 0),
      unmatchedOrders: acc.unmatchedOrders + (kpi.unmatchedOrders || 0),
      upcomingDrawCutoffs: acc.upcomingDrawCutoffs + (kpi.upcomingDrawCutoffs || 0),
      jackpotStatus: 'Stable',
      alerts: [...acc.alerts, ...(kpi.alerts || [])],
      approvalsPending: [...acc.approvalsPending, ...(kpi.approvalsPending || [])],
      auditSpotlight: [...acc.auditSpotlight, ...(kpi.auditSpotlight || [])],
      totalDeposits: acc.totalDeposits + (kpi.totalDeposits || 0),
      totalWithdrawals: acc.totalWithdrawals + (kpi.totalWithdrawals || 0),
      netDeposits: acc.netDeposits + (kpi.netDeposits || 0),
      sportsGGR: acc.sportsGGR + (kpi.sportsGGR || 0),
      casinoGGR: acc.casinoGGR + (kpi.casinoGGR || 0),
      matkaGGR: acc.matkaGGR + (kpi.matkaGGR || 0),
      activePlayers: acc.activePlayers + (kpi.activePlayers || 0),
      newPlayers: acc.newPlayers + (kpi.newPlayers || 0),
      totalPlayers: acc.totalPlayers + (kpi.totalPlayers || 0),
      totalBets: acc.totalBets + (kpi.totalBets || 0),
      sportsBets: acc.sportsBets + (kpi.sportsBets || 0),
      casinoBets: acc.casinoBets + (kpi.casinoBets || 0),
      matkaBets: acc.matkaBets + (kpi.matkaBets || 0),
      agentCommission: acc.agentCommission + (kpi.agentCommission || 0),
      bonusPayouts: acc.bonusPayouts + (kpi.bonusPayouts || 0),
      totalSettlement: acc.totalSettlement + (kpi.totalSettlement || 0),
      liveSettlement: acc.liveSettlement + (kpi.liveSettlement || 0),
      liveCommission: acc.liveCommission + (kpi.liveCommission || 0),
      totalCommission: acc.totalCommission + (kpi.totalCommission || 0),
      ftd: acc.ftd + (kpi.ftd || 0),
      ftdCount: acc.ftdCount + (kpi.ftdCount || 0),
      ltv: 0, // Will recalculate below
      arpu: 0, // Will recalculate below
      arppu: 0, // Will recalculate below
      conversionRate: 0, // Will recalculate below
      retentionRate: 0, // Will recalculate below
      churnRate: 0, // Will recalculate below
      dauMauRatio: 0, // Will recalculate below
      avgSessionDuration: 0, // TODO: Weighted average
      avgBetSize: 0, // Will recalculate below
      winRate: 0, // Will recalculate below
      riskScore: 0, // TODO: Calculate aggregated risk score
      complianceScore: 0, // TODO: Calculate aggregated compliance score
      revenueGrowth: 0, // TODO: Calculate growth across all whitelabels
      playerGrowth: 0, // TODO: Calculate growth across all whitelabels
      depositGrowth: 0, // TODO: Calculate growth across all whitelabels
      totalSessions: acc.totalSessions + (kpi.totalSessions || 0),
      avgSessionsPerUser: 0, // Will recalculate below
      bounceRate: 0, // TODO: Calculate aggregated bounce rate
    }), {
      tenant: null,
      turnover: 0,
      sportsTurnover: 0,
      casinoTurnover: 0,
      matkaTurnover: 0,
      ggr: 0,
      ngr: 0,
      liquidity: 0,
      exposure: 0,
      unmatchedOrders: 0,
      upcomingDrawCutoffs: 0,
      jackpotStatus: 'Stable',
      alerts: [],
      approvalsPending: [],
      auditSpotlight: [],
      totalDeposits: 0,
      totalWithdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      newPlayers: 0,
      totalPlayers: 0,
      totalBets: 0,
      sportsBets: 0,
      casinoBets: 0,
      matkaBets: 0,
      agentCommission: 0,
      bonusPayouts: 0,
      totalSettlement: 0,
      liveSettlement: 0,
      liveCommission: 0,
      totalCommission: 0,
      ftd: 0,
      ftdCount: 0,
      ltv: 0,
      arpu: 0,
      arppu: 0,
      conversionRate: 0,
      retentionRate: 0,
      churnRate: 0,
      dauMauRatio: 0,
      avgSessionDuration: 0,
      avgBetSize: 0,
      winRate: 0,
      riskScore: 0,
      complianceScore: 0,
      revenueGrowth: 0,
      playerGrowth: 0,
      depositGrowth: 0,
      totalSessions: 0,
      avgSessionsPerUser: 0,
      bounceRate: 0,
    } as DashboardKPIs);
    
    // Recalculate derived metrics after aggregation
    aggregated.ngr = aggregated.ggr - aggregated.agentCommission - aggregated.bonusPayouts;
    aggregated.ltv = aggregated.totalPlayers > 0 ? (aggregated.ggr / aggregated.totalPlayers) : 0;
    aggregated.arpu = aggregated.activePlayers > 0 ? (aggregated.ggr / aggregated.activePlayers) : 0;
    aggregated.arppu = aggregated.ftdCount > 0 ? (aggregated.ggr / aggregated.ftdCount) : 0;
    aggregated.conversionRate = aggregated.totalPlayers > 0 ? ((aggregated.ftdCount / aggregated.totalPlayers) * 100) : 0;
    aggregated.retentionRate = aggregated.totalPlayers > 0 ? ((aggregated.activePlayers / aggregated.totalPlayers) * 100) : 0;
    aggregated.churnRate = aggregated.totalPlayers > 0 ? (100 - aggregated.retentionRate) : 0;
    aggregated.dauMauRatio = aggregated.totalPlayers > 0 ? ((aggregated.activePlayers / aggregated.totalPlayers) * 100) : 0;
    aggregated.avgBetSize = aggregated.totalBets > 0 ? (aggregated.turnover / aggregated.totalBets) : 0;
    aggregated.winRate = aggregated.turnover > 0 ? (((aggregated.turnover - aggregated.ggr) / aggregated.turnover) * 100) : 0;
    aggregated.avgSessionsPerUser = aggregated.activePlayers > 0 ? (aggregated.totalSessions / aggregated.activePlayers) : 0;
    
    return aggregated;
  }
  // Convert date range to Date objects with validation
  let dateFrom: Date;
  let dateTo: Date;
  
  if (dateRange?.dateFrom) {
    if (typeof dateRange.dateFrom === 'string') {
      dateFrom = new Date(dateRange.dateFrom);
      if (isNaN(dateFrom.getTime())) {
        dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Fallback to last 7 days
      }
    } else if (dateRange.dateFrom instanceof Date) {
      dateFrom = dateRange.dateFrom;
    } else {
      dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Fallback to last 7 days
    }
  } else {
    dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
  }

  if (dateRange?.dateTo) {
    if (typeof dateRange.dateTo === 'string') {
      dateTo = new Date(dateRange.dateTo);
      if (isNaN(dateTo.getTime())) {
        dateTo = new Date(); // Fallback to now
      }
    } else if (dateRange.dateTo instanceof Date) {
      dateTo = dateRange.dateTo;
    } else {
      dateTo = new Date(); // Fallback to now
    }
  } else {
    dateTo = new Date();
  }

  // Ensure dates are valid Date objects
  if (!(dateFrom instanceof Date) || isNaN(dateFrom.getTime())) {
    dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  if (!(dateTo instanceof Date) || isNaN(dateTo.getTime())) {
    dateTo = new Date();
  }

  // Build common filter - ensure dates are valid Date objects
  const defaultDateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const defaultDateTo = new Date();

  // Fetch whitelabel base currency so repos filter by it and return amounts in that currency (no round-trip)
  const whitelabelCurrency = await getWhitelabelBaseCurrency(tenant);

  const commonFilter = {
    tenant,
    whitelabelId,
    dateFrom: toDate(dateFrom, defaultDateFrom),
    dateTo: toDate(dateTo, defaultDateTo),
    currency: whitelabelCurrency,
  };

  // Get KPIs from all domains in parallel with error handling
  const effectiveDateFrom = toDate(dateFrom, defaultDateFrom);
  const effectiveDateTo = toDate(dateTo, defaultDateTo);

  const [sportsKPIs, casinoKPIs, matkaKPIs, bonusKPIs, grossCommission] = await Promise.all([
    sportsReportingRepo.getSportsKPIs(commonFilter as any).catch(err => {
      return { totalStakes: 0, grossGamingRevenue: 0, totalExposure: 0, betCount: 0 };
    }),
    casinoReportingRepo.getCasinoKPIs(commonFilter as any).catch(err => {
      return { totalStakes: 0, grossGamingRevenue: 0, betCount: 0 };
    }),
    matkaReportingRepo.getMatkaKPIs(commonFilter as any).catch(err => {
      return { totalStakes: 0, grossGamingRevenue: 0, totalExposure: 0, betCount: 0 };
    }),
    bonusReportingRepo.getBonusKPIs(commonFilter as any).catch(err => {
      return { totalRedeemed: 0 };
    }),
    computeWhitelabelGrossCommission(tenant, effectiveDateFrom, effectiveDateTo, whitelabelCurrency),
  ]);

  const turnover = sportsKPIs.totalStakes + casinoKPIs.totalStakes + matkaKPIs.totalStakes;
  const ggr = sportsKPIs.grossGamingRevenue + casinoKPIs.grossGamingRevenue + matkaKPIs.grossGamingRevenue;
  const ngr = ggr - grossCommission - (bonusKPIs.totalRedeemed || 0);
  const exposure = (sportsKPIs.totalExposure || 0) + (matkaKPIs.totalExposure || 0);
  const sportsGGR = sportsKPIs.grossGamingRevenue || 0;
  const casinoGGR = casinoKPIs.grossGamingRevenue || 0;
  const matkaGGR = matkaKPIs.grossGamingRevenue || 0;
  const agentCommission = grossCommission;
  const bonusPayouts = bonusKPIs.totalRedeemed || 0;

  // Get deposits and withdrawals from request tables + manual admin deposits/withdrawals
  // These amounts are already stored in the local currency (not USD), so NO conversion needed
  const [ledgerStats, manualStats] = await Promise.all([
    getLedgerAggregatesByWalletDb({
      tenant,
      dateFrom: dateFrom,
      dateTo: dateTo,
    }),
    getManualDepositWithdrawalStatsTenantDb({
      tenant,
      dateFrom: dateFrom,
      dateTo: dateTo,
    }),
  ]);
  
  // Combine user-initiated + manual admin deposits/withdrawals
  const convertedLedgerStats = {
    depositVolume: ledgerStats.depositVolume + manualStats.manualDepositVolume,
    withdrawalVolume: ledgerStats.withdrawalVolume + manualStats.manualWithdrawalVolume,
    depositCount: ledgerStats.depositCount + manualStats.manualDepositCount,
    withdrawalCount: ledgerStats.withdrawalCount + manualStats.manualWithdrawalCount,
  };

  // Get player statistics
  const playerStats = await getPlayerStatistics(tenant, dateFrom, dateTo);

  // Get agent settlement and commission stats
  let agentStats = await getAgentStats(tenant, dateFrom, dateTo);
  
  // Ensure agentStats is always a valid object with all required fields
  if (!agentStats || typeof agentStats !== 'object') {
    agentStats = { totalSettlement: 0, liveSettlement: 0, totalCommission: 0 };
  }
  
  // Ensure all fields are numbers (not null/undefined)
  agentStats = {
    totalSettlement: agentStats.totalSettlement != null ? Number(agentStats.totalSettlement) : 0,
    liveSettlement: agentStats.liveSettlement != null ? Number(agentStats.liveSettlement) : 0,
    totalCommission: agentStats.totalCommission != null ? Number(agentStats.totalCommission) : 0,
  };
  
  // Final validation - ensure no NaN or Infinity
  agentStats = {
    totalSettlement: isNaN(agentStats.totalSettlement) || !isFinite(agentStats.totalSettlement) ? 0 : agentStats.totalSettlement,
    liveSettlement: isNaN(agentStats.liveSettlement) || !isFinite(agentStats.liveSettlement) ? 0 : agentStats.liveSettlement,
    totalCommission: isNaN(agentStats.totalCommission) || !isFinite(agentStats.totalCommission) ? 0 : agentStats.totalCommission,
  };
  
  // Get advanced metrics (pass converted stats and currency conversion function)
  const advancedMetrics = await getAdvancedMetrics(
    tenant, 
    dateFrom, 
    dateTo, 
    playerStats, 
    convertedLedgerStats, 
    turnover, 
    ggr, 
    exposure,
  );

  // Calculate liquidity (simplified: sum of all matched stakes + unmatched liability)
  const liquidity = turnover; // Simplified for now

  // Get unmatched orders count (simplified - would need actual query)
  const unmatchedOrders = 0; // TODO: Implement actual unmatched orders query

  // Get upcoming draw cutoffs (simplified - would need actual query)
  const upcomingDrawCutoffs = 0; // TODO: Implement actual draw cutoffs query

  // Get pending approvals and alerts from deposit/withdrawal requests
  const { approvalsPending, alerts } = await getPendingApprovalsAndAlerts(tenant);

  // Get audit spotlight (simplified - would need actual audit system)
  const auditSpotlight: Array<{ id: string; actorId: string; domain: string; action: string; timestamp: string }> = [];

  // Ensure all numeric values are numbers (not NaN or Infinity)
  const safeNumber = (val: any): number => {
    if (val == null) return 0;
    const num = Number(val);
    return isNaN(num) || !isFinite(num) ? 0 : num;
  };

  // Helper to safely convert any value to string (handles Date objects)
  const safeString = (val: any): string => {
    if (val == null) return '';
    if (val instanceof Date) {
      return val.toISOString();
    }
    return String(val);
  };

  try {
    return {
      turnover: safeNumber(turnover),
      sportsTurnover: safeNumber(sportsKPIs.totalStakes || 0),
      casinoTurnover: safeNumber(casinoKPIs.totalStakes || 0),
      matkaTurnover: safeNumber(matkaKPIs.totalStakes || 0),
      ggr: safeNumber(ggr),
      ngr: safeNumber(ngr),
      liquidity: safeNumber(liquidity),
      exposure: safeNumber(exposure),
      unmatchedOrders: Math.floor(safeNumber(unmatchedOrders)),
      upcomingDrawCutoffs: Math.floor(safeNumber(upcomingDrawCutoffs)),
      jackpotStatus: 'Stable', // TODO: Implement actual jackpot status
      alerts: alerts.map(a => ({
        id: safeString(a.id),
        level: safeString(a.level),
        message: safeString(a.message),
        at: safeString(a.at || new Date().toISOString()),
      })),
      approvalsPending: approvalsPending.map(a => ({
        id: safeString(a.id),
        domain: safeString(a.domain),
        action: safeString(a.action),
        resourceId: safeString(a.resourceId),
        requestedAt: safeString(a.requestedAt || new Date().toISOString()),
      })),
      auditSpotlight: auditSpotlight.map(a => ({
        id: safeString(a.id),
        actorId: safeString(a.actorId),
        domain: safeString(a.domain),
        action: safeString(a.action),
        timestamp: safeString(a.timestamp || new Date().toISOString()),
      })),
      // Enhanced metrics (using converted amounts in whitelabel currency)
      totalDeposits: safeNumber(convertedLedgerStats.depositVolume),
      totalWithdrawals: safeNumber(convertedLedgerStats.withdrawalVolume),
      netDeposits: safeNumber(convertedLedgerStats.depositVolume - convertedLedgerStats.withdrawalVolume),
      sportsGGR: safeNumber(sportsGGR),
      casinoGGR: safeNumber(casinoGGR),
      matkaGGR: safeNumber(matkaGGR),
      activePlayers: Math.floor(safeNumber(playerStats.activePlayers)),
      newPlayers: Math.floor(safeNumber(playerStats.newPlayers)),
      totalPlayers: Math.floor(safeNumber(playerStats.totalPlayers)),
      totalBets: Math.floor(safeNumber(sportsKPIs.betCount + casinoKPIs.betCount + matkaKPIs.betCount)),
      sportsBets: Math.floor(safeNumber(sportsKPIs.betCount)),
      casinoBets: Math.floor(safeNumber(casinoKPIs.betCount)),
      matkaBets: Math.floor(safeNumber(matkaKPIs.betCount)),
      agentCommission: safeNumber(agentCommission),
      bonusPayouts: safeNumber(bonusPayouts),
      // Agent stats — amounts in agent_ledger / agent_settlements are already in whitelabel currency
      totalSettlement: safeNumber(agentStats.totalSettlement),
      liveSettlement: safeNumber(agentStats.liveSettlement),
      liveCommission: safeNumber(agentCommission),
      totalCommission: safeNumber(agentStats.totalCommission),
      // Advanced metrics
      ftd: safeNumber(advancedMetrics.ftd),
      ftdCount: Math.floor(safeNumber(advancedMetrics.ftdCount)),
      ltv: safeNumber(advancedMetrics.ltv),
      arpu: safeNumber(advancedMetrics.arpu),
      arppu: safeNumber(advancedMetrics.arppu),
      conversionRate: safeNumber(advancedMetrics.conversionRate),
      retentionRate: safeNumber(advancedMetrics.retentionRate),
      churnRate: safeNumber(advancedMetrics.churnRate),
      dauMauRatio: safeNumber(advancedMetrics.dauMauRatio),
      avgSessionDuration: safeNumber(advancedMetrics.avgSessionDuration),
      avgBetSize: safeNumber(advancedMetrics.avgBetSize),
      winRate: safeNumber(advancedMetrics.winRate),
      riskScore: safeNumber(advancedMetrics.riskScore),
      complianceScore: safeNumber(advancedMetrics.complianceScore),
      revenueGrowth: safeNumber(advancedMetrics.revenueGrowth),
      playerGrowth: safeNumber(advancedMetrics.playerGrowth),
      depositGrowth: safeNumber(advancedMetrics.depositGrowth),
      totalSessions: Math.floor(safeNumber(advancedMetrics.totalSessions)),
      avgSessionsPerUser: safeNumber(advancedMetrics.avgSessionsPerUser),
      bounceRate: safeNumber(advancedMetrics.bounceRate),
    };
  } catch (error: any) {
    // Return a safe fallback response
    const now = new Date().toISOString();
    return {
      turnover: 0,
      sportsTurnover: 0,
      casinoTurnover: 0,
      matkaTurnover: 0,
      ggr: 0,
      ngr: 0,
      liquidity: 0,
      exposure: 0,
      unmatchedOrders: 0,
      upcomingDrawCutoffs: 0,
      jackpotStatus: 'Stable',
      alerts: [],
      approvalsPending: [],
      auditSpotlight: [],
      totalDeposits: 0,
      totalWithdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      newPlayers: 0,
      totalPlayers: 0,
      totalBets: 0,
      sportsBets: 0,
      casinoBets: 0,
      matkaBets: 0,
      agentCommission: 0,
      bonusPayouts: 0,
      totalSettlement: 0,
      liveSettlement: 0,
      liveCommission: 0,
      totalCommission: 0,
      ftd: 0,
      ftdCount: 0,
      ltv: 0,
      arpu: 0,
      arppu: 0,
      conversionRate: 0,
      retentionRate: 0,
      churnRate: 0,
      dauMauRatio: 0,
      avgSessionDuration: 0,
      avgBetSize: 0,
      winRate: 0,
      riskScore: 0,
      complianceScore: 0,
      revenueGrowth: 0,
      playerGrowth: 0,
      depositGrowth: 0,
      totalSessions: 0,
      avgSessionsPerUser: 0,
      bounceRate: 0,
    };
  }
}

/**
 * Get dashboard trends over time
 */
export async function getDashboardTrends(
  tenant: string | undefined,
  whitelabelId?: string | undefined,
  dateRange?: DashboardDateRange
): Promise<DashboardTrendPoint[]> {
  // CRITICAL: Handle Director Admin core mode (undefined tenant/whitelabelId)
  if (!tenant || !whitelabelId) {
    // Director Admin in core mode - return empty trends
    return [];
  }
  // Convert date range to Date objects with validation
  let dateFrom: Date;
  let dateTo: Date;
  
  if (dateRange?.dateFrom) {
    if (typeof dateRange.dateFrom === 'string') {
      dateFrom = new Date(dateRange.dateFrom);
      if (isNaN(dateFrom.getTime())) {
        dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Fallback to last 30 days
      }
    } else if (dateRange.dateFrom instanceof Date) {
      dateFrom = dateRange.dateFrom;
    } else {
      dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Fallback to last 30 days
    }
  } else {
    dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
  }

  if (dateRange?.dateTo) {
    if (typeof dateRange.dateTo === 'string') {
      dateTo = new Date(dateRange.dateTo);
      if (isNaN(dateTo.getTime())) {
        dateTo = new Date(); // Fallback to now
      }
    } else if (dateRange.dateTo instanceof Date) {
      dateTo = dateRange.dateTo;
    } else {
      dateTo = new Date(); // Fallback to now
    }
  } else {
    dateTo = new Date();
  }

  // Ensure dates are valid Date objects
  if (!(dateFrom instanceof Date) || isNaN(dateFrom.getTime())) {
    dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  if (!(dateTo instanceof Date) || isNaN(dateTo.getTime())) {
    dateTo = new Date();
  }

  // Build common filter - ensure dates are valid Date objects
  const defaultDateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const defaultDateTo = new Date();

  const whitelabelCurrency = await getWhitelabelBaseCurrency(tenant);

  const commonFilter = {
    tenant,
    whitelabelId,
    dateFrom: toDate(dateFrom, defaultDateFrom),
    dateTo: toDate(dateTo, defaultDateTo),
    currency: whitelabelCurrency,
  };

  // Get trends from all domains (amounts in whitelabel currency when currency filter is set)
  // These independent, read-only inputs share the same applied scope/window.
  // Fetch them together instead of serializing ledger, activity and commission
  // behind the three domain queries. The merge and NGR formula below are unchanged.
  const [sportsTrends, casinoTrends, matkaTrends, depositWithdrawalTrends, playerTrends, grossCommissionForTrends, bonusKPIsForTrends] = await Promise.all([
    sportsReportingRepo.getSportsTrends(commonFilter as any),
    casinoReportingRepo.getCasinoTrends(commonFilter as any),
    matkaReportingRepo.getMatkaTrends(commonFilter as any),
    getDepositWithdrawalTrends(tenant, dateFrom, dateTo),
    getPlayerActivityTrends(tenant, dateFrom, dateTo),
    computeWhitelabelGrossCommission(tenant, dateFrom, dateTo, whitelabelCurrency),
    bonusReportingRepo.getBonusKPIs(commonFilter as any).catch(() => ({ totalRedeemed: 0 })),
  ]);

  // Combine all trends by date
  const dateMap = new Map<string, DashboardTrendPoint>();

  // Add sports trends (amounts already in whitelabel currency)
  sportsTrends.forEach(point => {
    const existing = dateMap.get(point.date) || {
      date: point.date,
      turnover: 0,
      ggr: 0,
      ngr: 0,
      deposits: 0,
      withdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      betCount: 0,
    };
    existing.turnover += point.stakes;
    existing.ggr += point.ggr;
    existing.sportsGGR = point.ggr;
    existing.betCount += point.betCount;
    dateMap.set(point.date, existing);
  });

  // Add casino trends (amounts already in whitelabel currency)
  casinoTrends.forEach(point => {
    const existing = dateMap.get(point.date) || {
      date: point.date,
      turnover: 0,
      ggr: 0,
      ngr: 0,
      deposits: 0,
      withdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      betCount: 0,
    };
    existing.turnover += point.stakes;
    existing.ggr += point.ggr;
    existing.casinoGGR = point.ggr;
    existing.betCount += point.betCount;
    dateMap.set(point.date, existing);
  });

  // Add matka trends (amounts already in whitelabel currency)
  matkaTrends.forEach(point => {
    const existing = dateMap.get(point.date) || {
      date: point.date,
      turnover: 0,
      ggr: 0,
      ngr: 0,
      deposits: 0,
      withdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      betCount: 0,
    };
    existing.turnover += point.stakes;
    existing.ggr += point.ggr;
    existing.matkaGGR = point.ggr;
    existing.betCount += point.betCount;
    dateMap.set(point.date, existing);
  });

  // Add deposit/withdrawal trends (NO conversion needed - amounts already in local currency from depositRequests/withdrawalRequests)
  depositWithdrawalTrends.forEach(point => {
    const existing = dateMap.get(point.date) || {
      date: point.date,
      turnover: 0,
      ggr: 0,
      ngr: 0,
      deposits: 0,
      withdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      betCount: 0,
    };
    // depositRequests/withdrawalRequests store amounts in original currency (INR), NO conversion needed
    existing.deposits = point.deposits;
    existing.withdrawals = point.withdrawals;
    existing.netDeposits = point.deposits - point.withdrawals;
    dateMap.set(point.date, existing);
  });

  // Add player activity trends
  playerTrends.forEach(point => {
    const existing = dateMap.get(point.date) || {
      date: point.date,
      turnover: 0,
      ggr: 0,
      ngr: 0,
      deposits: 0,
      withdrawals: 0,
      netDeposits: 0,
      sportsGGR: 0,
      casinoGGR: 0,
      matkaGGR: 0,
      activePlayers: 0,
      betCount: 0,
    };
    existing.activePlayers = point.activePlayers;
    dateMap.set(point.date, existing);
  });

  // Calculate NGR using actual gross commission and bonus data for the period
  let totalGGR = 0;
  dateMap.forEach((point) => { totalGGR += point.ggr; });
  const effectiveCommissionRate = totalGGR > 0 ? grossCommissionForTrends / totalGGR : 0;
  const effectiveBonusRate = totalGGR > 0 ? (bonusKPIsForTrends.totalRedeemed || 0) / totalGGR : 0;
  dateMap.forEach(point => {
    point.ngr = point.ggr * (1 - effectiveCommissionRate - effectiveBonusRate);
  });

  // Keep only calendar days inside the selected range (tenant TZ) so "Yesterday" never shows an extra UTC-offset day
  const wlTz = ((await getWhitelabelTimezone(tenant!)) ?? '').trim() || 'Asia/Kolkata';
  const fromKey = DateTime.fromJSDate(dateFrom, { zone: wlTz }).toFormat('yyyy-MM-dd');
  const toKey = DateTime.fromJSDate(dateTo, { zone: wlTz }).toFormat('yyyy-MM-dd');

  return Array.from(dateMap.values())
    .filter((p) => {
      const d = String(p.date ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= fromKey && d <= toKey;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Get agent settlement and commission stats
 */
async function getAgentStats(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    
    // Total settlement (all time) - sum of all SETTLEMENT entries in agent ledger
    // Join with agents table to filter by tenant
    const totalSettlementResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${agentLedger.amount}::numeric), 0)`,
      })
      .from(agentLedger)
      .innerJoin(agents, eq(agentLedger.agentId, agents.id))
      .where(
        and(
          eq(agents.tenantId, tenant),
          eq(agentLedger.lineType, 'SETTLEMENT' as any)
        )
      )
      .limit(1);

    // Live settlement (current period) - sum of OPEN status settlements
    // Join with agents table to filter by tenant
    const liveSettlementResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${agentSettlements.totalAmount}::numeric), 0)`,
      })
      .from(agentSettlements)
      .innerJoin(agents, eq(agentSettlements.agentId, agents.id))
      .where(
        and(
          eq(agents.tenantId, tenant),
          eq(agentSettlements.status, 'OPEN' as any),
          gte(agentSettlements.periodFrom, dateFrom),
          lte(agentSettlements.periodTo, dateTo)
        )
      )
      .limit(1);

    // Total commission (all time) - sum of all COMMISSION entries in agent ledger
    // Join with agents table to filter by tenant
    const totalCommissionResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${agentLedger.amount}::numeric), 0)`,
      })
      .from(agentLedger)
      .innerJoin(agents, eq(agentLedger.agentId, agents.id))
      .where(
        and(
          eq(agents.tenantId, tenant),
          eq(agentLedger.lineType, 'COMMISSION' as any)
        )
      )
      .limit(1);

    // Safely extract values with proper fallbacks
    const totalSettlement = totalSettlementResult?.[0]?.total != null 
      ? Number(totalSettlementResult[0].total) 
      : 0;
    const liveSettlement = liveSettlementResult?.[0]?.total != null 
      ? Number(liveSettlementResult[0].total) 
      : 0;
    const totalCommission = totalCommissionResult?.[0]?.total != null 
      ? Number(totalCommissionResult[0].total) 
      : 0;

    // Ensure all values are valid numbers (not NaN or Infinity)
    return {
      totalSettlement: isNaN(totalSettlement) || !isFinite(totalSettlement) ? 0 : totalSettlement,
      liveSettlement: isNaN(liveSettlement) || !isFinite(liveSettlement) ? 0 : liveSettlement,
      totalCommission: isNaN(totalCommission) || !isFinite(totalCommission) ? 0 : totalCommission,
    };
  } catch (error: any) {
    // Always return valid numbers, never null or undefined
    return {
      totalSettlement: 0,
      liveSettlement: 0,
      totalCommission: 0,
    };
  }
}

/**
 * Get advanced metrics (FTD, LTV, ARPU, etc.)
 */
async function getAdvancedMetrics(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date,
  playerStats: any,
  ledgerStats: any,
  turnover: number,
  ggr: number,
  exposure: number,
  convertToWhitelabelCurrency?: (usdAmount: number) => number
) {
  try {
    // Calculate FTD (First Time Deposits) - players who made their first deposit in this period
    // Includes BOTH direct deposits (deposit_requests) and manual deposits (ledger_entries)

    // Step 1: Direct FTD from deposit_requests
    const [directFtdResult] = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${depositRequests.userId})`,
        total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          eq(depositRequests.status, 'APPROVED' as any),
          // FTD is keyed by when the deposit was actually approved (money moved), not requested.
          gte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateFrom),
          lte(settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt), dateTo),
          sql`NOT EXISTS (
            SELECT 1 FROM deposit_requests dr2
            WHERE dr2.user_id = ${depositRequests.userId}
            AND dr2.status = 'APPROVED'
            AND COALESCE(dr2.reviewed_at, dr2.created_at) < COALESCE(${depositRequests.reviewedAt}, ${depositRequests.createdAt})
          )`
        )
      );

    // Step 2: Manual FTD from ledger_entries — players whose first-ever deposit was a manual one in this period
    // A player is a manual FTD if:
    //   - They have a manual deposit (credit ledger entry) in this period
    //   - They have NO approved deposit_requests at all before the end of this period
    //   - They have NO manual deposit ledger entries before this period
    const [manualFtdResult] = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${wallets.userId})`,
        total: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'credit'),
          sql`${ledgerEntries.meta} IS NOT NULL`,
          sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
          sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
          gte(ledgerEntries.createdAt, dateFrom),
          lte(ledgerEntries.createdAt, dateTo),
          // No prior approved deposit_requests for this player
          sql`NOT EXISTS (
            SELECT 1 FROM deposit_requests dr
            WHERE dr.user_id = ${wallets.userId}
            AND dr.tenant = ${tenant}
            AND dr.status = 'APPROVED'
            AND dr.created_at < ${dateFrom}
          )`,
          // No prior manual deposits for this player
          sql`NOT EXISTS (
            SELECT 1 FROM ledger_entries le2
            INNER JOIN wallets w2 ON le2.wallet_id = w2.id
            WHERE w2.user_id = ${wallets.userId}
            AND le2.tenant = ${tenant}
            AND le2.type = 'credit'
            AND le2.meta IS NOT NULL
            AND (le2.meta->>'type' IN ('deposit', 'admin_adjustment'))
            AND (le2.meta->>'depositRequestId' IS NULL OR le2.meta->>'depositRequestId' = '')
            AND le2.created_at < ${dateFrom}
          )`,
          // Exclude players already counted in direct FTD
          sql`NOT EXISTS (
            SELECT 1 FROM deposit_requests dr3
            WHERE dr3.user_id = ${wallets.userId}
            AND dr3.tenant = ${tenant}
            AND dr3.status = 'APPROVED'
            AND dr3.created_at >= ${dateFrom}
            AND dr3.created_at <= ${dateTo}
          )`
        )
      );

    const ftdCount = Number(directFtdResult?.count || 0) + Number(manualFtdResult?.count || 0);
    const ftdAmount = Number(directFtdResult?.total || 0) + Number(manualFtdResult?.total || 0);

    // Calculate LTV (Lifetime Value) - average revenue per player
    const ltv = playerStats.totalPlayers > 0 ? ggr / playerStats.totalPlayers : 0;

    // Calculate ARPU (Average Revenue Per User)
    const arpu = playerStats.activePlayers > 0 ? ggr / playerStats.activePlayers : 0;

    // Calculate ARPPU (Average Revenue Per Paying User) - only players who deposited
    const payingPlayers = ledgerStats.depositCount > 0 ? ftdCount : 1;
    const arppu = payingPlayers > 0 ? ggr / payingPlayers : 0;

    // Calculate Conversion Rate (players who deposited / total players)
    // Only show conversion rate if there are actual players (non-admins)
    const conversionRate = (playerStats.totalPlayers > 0 && ledgerStats.depositCount > 0)
      ? (Math.min(payingPlayers, playerStats.totalPlayers) / playerStats.totalPlayers) * 100 
      : 0;

    // Calculate Retention Rate (active players / total players)
    // Only show retention rate if there are actual active players with real activity
    // Return 0 if no players have activity (prevents 100% for new/empty whitelabels)
    const retentionRate = (playerStats.totalPlayers > 0 && playerStats.activePlayers > 0)
      ? (playerStats.activePlayers / playerStats.totalPlayers) * 100
      : 0;

    // Calculate Churn Rate (100 - retention rate)
    // Only calculate if we have actual data to base it on
    const churnRate = (playerStats.totalPlayers > 0 && playerStats.activePlayers > 0)
      ? (100 - retentionRate)
      : 0;

    // Calculate DAU/MAU Ratio (using active players who had activity in the period)
    // Return 0 if no actual player activity (prevents misleading 100% for empty whitelabels)
    const dauMauRatio = (playerStats.activePlayers > 0 && playerStats.totalPlayers > 0)
      ? (playerStats.activePlayers / playerStats.totalPlayers) * 100
      : 0;

    // Calculate Average Bet Size
    const totalBets = turnover;
    const betCount = 1; // TODO: Get actual bet count
    const avgBetSize = betCount > 0 ? totalBets / betCount : 0;

    // Calculate Win Rate (simplified)
    const winRate = turnover > 0 ? ((turnover - ggr) / turnover) * 100 : 0;

    // Calculate Risk Score (0-100, based on exposure and volatility)
    // Return 0 if no actual data available (no exposure, no bets)
    const riskScore = (exposure > 0 || turnover > 0) ? 0 : 0; // TODO: Implement actual risk calculation when data is available

    // Calculate Compliance Score (0-100)
    // Return 0 if no actual data available
    const complianceScore = (playerStats.totalPlayers > 0 || turnover > 0) ? 0 : 0; // TODO: Implement actual compliance calculation when data is available

    // Calculate Growth Metrics (compare with previous period)
    const periodLength = dateTo.getTime() - dateFrom.getTime();
    const previousFrom = new Date(dateFrom.getTime() - periodLength);
    const previousTo = new Date(dateFrom.getTime());

    // Get previous period stats for comparison
    const [prevRevenueResult] = await db
      .select({
        prevGGR: sql<number>`COALESCE(SUM(${ledgerEntries.amount}::numeric), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          gte(ledgerEntries.createdAt, previousFrom),
          lte(ledgerEntries.createdAt, previousTo)
        )
      );

    const prevGGR = Number(prevRevenueResult?.prevGGR || 0);
    // Only calculate growth if both current and previous periods have data
    const revenueGrowth = (prevGGR > 0 && ggr > 0) 
      ? ((ggr - prevGGR) / prevGGR) * 100 
      : (ggr > 0 && prevGGR === 0) ? 100 : 0; // 100% growth if new data, 0 if no data

    // Get previous period player count (excluding admins)
    const adminRoleIds = await db
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(
          eq(roles.tenant, tenant),
          sql`LOWER(${roles.name}) LIKE '%admin%'`
        )
      );
    const adminRoleIdList = adminRoleIds.map(r => r.id);
    let prevPlayersWhere = and(
      eq(users.tenant, tenant),
      gte(users.createdAt, previousFrom),
      lte(users.createdAt, previousTo)
    );
    
    if (adminRoleIdList.length > 0) {
      const adminUserIds = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.tenant, tenant),
            inArray(userRoles.roleId, adminRoleIdList)
          )
        );
      const adminUserIdList = adminUserIds.map(u => u.userId);
      if (adminUserIdList.length > 0) {
        prevPlayersWhere = and(
          eq(users.tenant, tenant),
          gte(users.createdAt, previousFrom),
          lte(users.createdAt, previousTo),
          notInArray(users.id, adminUserIdList)
        ) as any;
      }
    }

    const [prevPlayersResult] = await db
      .select({
        count: count(),
      })
      .from(users)
      .where(prevPlayersWhere);

    const prevPlayers = Number(prevPlayersResult?.count || 0);
    // Only calculate growth if both current and previous periods have data
    const playerGrowth = (prevPlayers > 0 && playerStats.newPlayers > 0)
      ? ((playerStats.newPlayers - prevPlayers) / prevPlayers) * 100
      : (playerStats.newPlayers > 0 && prevPlayers === 0) ? 100 : 0; // 100% growth if new data, 0 if no data

    const depositGrowth = revenueGrowth; // Simplified - use revenue growth as proxy

    // Engagement Metrics
    // Return 0 if no actual data available
    const totalSessions = 0; // TODO: Get actual session count from session tracking
    const avgSessionsPerUser = 0; // TODO: Calculate from actual session data
    const avgSessionDuration = 0; // TODO: Get actual session duration from session tracking
    const bounceRate = 0; // TODO: Get actual bounce rate from analytics

    return {
      ftd: ftdAmount,
      ftdCount,
      ltv,
      arpu,
      arppu,
      conversionRate,
      retentionRate,
      churnRate,
      dauMauRatio,
      avgSessionDuration,
      avgBetSize,
      winRate,
      riskScore,
      complianceScore,
      revenueGrowth,
      playerGrowth,
      depositGrowth,
      totalSessions,
      avgSessionsPerUser,
      bounceRate,
    };
  } catch (error: any) {
    return {
      ftd: 0,
      ftdCount: 0,
      ltv: 0,
      arpu: 0,
      arppu: 0,
      conversionRate: 0,
      retentionRate: 0,
      churnRate: 0,
      dauMauRatio: 0,
      avgSessionDuration: 0,
      avgBetSize: 0,
      winRate: 0,
      riskScore: 0,
      complianceScore: 0,
      revenueGrowth: 0,
      playerGrowth: 0,
      depositGrowth: 0,
      totalSessions: 0,
      avgSessionsPerUser: 0,
      bounceRate: 0,
    };
  }
}

/**
 * Get player statistics
 */
async function getPlayerStatistics(tenant: string, dateFrom: Date, dateTo: Date) {
  // Ensure dates are Date objects
  const fromDate = dateFrom instanceof Date ? dateFrom : new Date(dateFrom);
  const toDate = dateTo instanceof Date ? dateTo : new Date(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date range provided to getPlayerStatistics');
  }

  // Get all admin role IDs for this tenant to exclude admin users
  // Include all roles that contain 'admin' (case-insensitive) to exclude all admin types
  const adminRoleIds = await db
    .select({ id: roles.id })
    .from(roles)
    .where(
      and(
        eq(roles.tenant, tenant),
        sql`LOWER(${roles.name}) LIKE '%admin%'`
      )
    );

  const adminRoleIdList = adminRoleIds.map(r => r.id);

  // Get admin user IDs (users who have admin roles)
  let adminUserIdList: number[] = [];
  if (adminRoleIdList.length > 0) {
    const adminUserIds = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.tenant, tenant),
          inArray(userRoles.roleId, adminRoleIdList)
        )
      );
    
    adminUserIdList = adminUserIds.map(u => u.userId);
  }

  // Total players (excluding admins)
  let totalPlayersWhere = eq(users.tenant, tenant);
  if (adminUserIdList.length > 0) {
    totalPlayersWhere = and(
      eq(users.tenant, tenant),
      notInArray(users.id, adminUserIdList)
    ) as any;
  }

  const [totalResult] = await db
    .select({ count: count() })
    .from(users)
    .where(totalPlayersWhere);

  const totalPlayers = Number(totalResult?.count || 0);

  // New players (registered in date range, excluding admins)
  let newPlayersWhere = and(
    eq(users.tenant, tenant),
    gte(users.createdAt, fromDate),
    lte(users.createdAt, toDate)
  );
  
  if (adminUserIdList.length > 0) {
    newPlayersWhere = and(
      eq(users.tenant, tenant),
      gte(users.createdAt, fromDate),
      lte(users.createdAt, toDate),
      notInArray(users.id, adminUserIdList)
    ) as any;
  }

  const [newResult] = await db
    .select({ count: count() })
    .from(users)
    .where(newPlayersWhere);

  const newPlayers = Number(newResult?.count || 0);

  // Active players - count ONLY players who had actual activity (ledger entries) in the date range
  // This prevents showing 100% retention/DAU-MAU for whitelabels with no actual player activity
  let activePlayersCount = 0;
  try {
    // Get distinct player IDs who have ledger activity in the period (excluding admins)
    const activePlayersQuery = await db
      .select({
        activeCount: sql<number>`COUNT(DISTINCT ${wallets.userId})`,
      })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          gte(ledgerEntries.createdAt, fromDate),
          lte(ledgerEntries.createdAt, toDate),
          // Exclude admin users
          adminUserIdList.length > 0 ? notInArray(wallets.userId, adminUserIdList) : sql`TRUE`
        )
      );
    
    activePlayersCount = Number(activePlayersQuery[0]?.activeCount || 0);
  } catch (error) {
    activePlayersCount = 0;
  }

  return {
    totalPlayers,
    newPlayers,
    activePlayers: activePlayersCount,
  };
}

/**
 * Get deposit/withdrawal trends
 */
async function getDepositWithdrawalTrends(tenant: string, dateFrom: Date, dateTo: Date) {
  // Ensure dates are Date objects
  const fromDate = dateFrom instanceof Date ? dateFrom : new Date(dateFrom);
  const toDate = dateTo instanceof Date ? dateTo : new Date(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date range provided to getDepositWithdrawalTrends');
  }

  const tz = escapeIanaTimezoneForSql(await getWhitelabelTimezone(tenant));
  // Bucket deposits/withdrawals by the date money actually moved (approval), not request date.
  const depSettledAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt);
  const wdSettledAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt);
  const depDay = sqlDateBucketText(depSettledAt, tz);
  const wdDay = sqlDateBucketText(wdSettledAt, tz);
  const ledgerDayManualDeposit = sqlDateBucketText(ledgerEntries.createdAt, tz);
  const ledgerDayManualWithdrawal = sqlDateBucketText(ledgerEntries.createdAt, tz);

  // Query deposit/withdrawal request tables + manual admin deposits/withdrawals for accurate trends
  const [depositResults, withdrawalResults, manualDepositResults, manualWithdrawalResults] = await Promise.all([
    db
      .select({
        date: depDay,
        amount: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
      })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.tenant, tenant),
          eq(depositRequests.status, 'APPROVED' as any),
          gte(depSettledAt, fromDate),
          lte(depSettledAt, toDate)
        )
      )
      .groupBy(depDay),
    db
      .select({
        date: wdDay,
        amount: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.tenant, tenant),
          eq(withdrawalRequests.status, 'COMPLETED' as any),
          gte(wdSettledAt, fromDate),
          lte(wdSettledAt, toDate)
        )
      )
      .groupBy(wdDay),
    // Manual admin deposits from ledger_entries
    db
      .select({
        date: ledgerDayManualDeposit,
        amount: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'credit'),
          sql`${ledgerEntries.meta} IS NOT NULL`,
          sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
          sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
          gte(ledgerEntries.createdAt, fromDate),
          lte(ledgerEntries.createdAt, toDate)
        )
      )
      .groupBy(ledgerDayManualDeposit),
    // Manual admin withdrawals from ledger_entries
    db
      .select({
        date: ledgerDayManualWithdrawal,
        amount: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'debit'),
          sql`${ledgerEntries.meta} IS NOT NULL`,
          sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
          gte(ledgerEntries.createdAt, fromDate),
          lte(ledgerEntries.createdAt, toDate)
        )
      )
      .groupBy(ledgerDayManualWithdrawal),
  ]);

  // Combine results by date (user-initiated + manual admin)
  const dateMap = new Map<string, { deposits: number; withdrawals: number }>();
  
  for (const r of depositResults) {
    const dateStr = String(r.date || '');
    const existing = dateMap.get(dateStr) || { deposits: 0, withdrawals: 0 };
    existing.deposits += Number(r.amount || 0);
    dateMap.set(dateStr, existing);
  }
  
  for (const r of manualDepositResults) {
    const dateStr = String(r.date || '');
    const existing = dateMap.get(dateStr) || { deposits: 0, withdrawals: 0 };
    existing.deposits += Number(r.amount || 0);
    dateMap.set(dateStr, existing);
  }
  
  for (const r of withdrawalResults) {
    const dateStr = String(r.date || '');
    const existing = dateMap.get(dateStr) || { deposits: 0, withdrawals: 0 };
    existing.withdrawals += Number(r.amount || 0);
    dateMap.set(dateStr, existing);
  }
  
  for (const r of manualWithdrawalResults) {
    const dateStr = String(r.date || '');
    const existing = dateMap.get(dateStr) || { deposits: 0, withdrawals: 0 };
    existing.withdrawals += Number(r.amount || 0);
    dateMap.set(dateStr, existing);
  }

  return Array.from(dateMap.entries()).map(([dateStr, values]) => {
    // If date is already in YYYY-MM-DD format, use it directly
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return {
        date: dateStr,
        deposits: values.deposits,
        withdrawals: values.withdrawals,
      };
    }
    // Otherwise, try to parse it
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return {
          date: date.toISOString().split('T')[0],
          deposits: values.deposits,
          withdrawals: values.withdrawals,
        };
      }
    } catch (e) {
      // Fallback to today's date if parsing fails
    }
    return {
      date: new Date().toISOString().split('T')[0],
      deposits: values.deposits,
      withdrawals: values.withdrawals,
    };
  });
}

/**
 * Get player activity trends
 */
async function getPlayerActivityTrends(tenant: string, dateFrom: Date, dateTo: Date) {
  // Ensure dates are Date objects
  const fromDate = dateFrom instanceof Date ? dateFrom : new Date(dateFrom);
  const toDate = dateTo instanceof Date ? dateTo : new Date(dateTo);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date range provided to getPlayerActivityTrends');
  }

  const tz = escapeIanaTimezoneForSql(await getWhitelabelTimezone(tenant));
  const activityDay = sqlDateBucketText(ledgerEntries.createdAt, tz);

  // Count unique users who have ledger entries in the period by joining with wallets
  const results = await db
    .select({
      date: activityDay,
      activePlayers: sql<number>`COUNT(DISTINCT ${wallets.userId})::int`,
    })
    .from(ledgerEntries)
    .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
    .where(
      and(
        eq(ledgerEntries.tenant, tenant),
        eq(wallets.tenant, tenant),
        gte(ledgerEntries.createdAt, fromDate),
        lte(ledgerEntries.createdAt, toDate)
      )
    )
    .groupBy(activityDay);

  return results.map(r => {
    // Convert date string to ISO format (YYYY-MM-DD)
    const dateStr = String(r.date || '');
    // If date is already in YYYY-MM-DD format, use it directly
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return {
        date: dateStr,
        activePlayers: Number(r.activePlayers || 0),
      };
    }
    // Otherwise, try to parse it
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return {
          date: date.toISOString().split('T')[0],
          activePlayers: Number(r.activePlayers || 0),
        };
      }
    } catch (e) {
      // Fallback to today's date if parsing fails
    }
    return {
      date: new Date().toISOString().split('T')[0],
      activePlayers: Number(r.activePlayers || 0),
    };
  });
}

