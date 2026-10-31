import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { DashboardDateRange, DashboardKPIs } from '@/services/dashboardService.js'

/**
 * `overviewKPIs` for an AGENT caller.
 *
 * The resolver handed agents `getDashboardKPIs(tenant, …)` — the whitelabel's
 * own dashboard: every player's turnover and GGR, every deposit and withdrawal,
 * the player totals, the whitelabel's commission bill and its pending payment
 * approvals. The agent portal reads it on the Nth Deposit/Withdrawal and Player
 * Activity pages, so an agent saw whitelabel-wide money figures there.
 *
 * Here every figure is computed over the agent's own players — its subtree plus
 * referral-linked players, the canonical scope in
 * repos/reporting/agentPlayerScope.ts — and the administrative fields an agent
 * has no business seeing (pending approvals, alerts, the whitelabel's
 * settlement and commission totals) are left empty. The response shape is the
 * dashboard's, unchanged, so no client changes.
 */

export interface AgentDashboardScope {
  tenant: string
  whitelabelId?: string
  agentId: string
}

interface DomainKpis {
  totalStakes: number
  grossGamingRevenue: number
  totalExposure?: number
  betCount: number
}

export interface MoneyTotals {
  depositVolume: number
  depositCount: number
  withdrawalVolume: number
  withdrawalCount: number
}

export interface PlayerTotals {
  totalPlayers: number
  newPlayers: number
  activePlayers: number
}

export interface AgentDashboardDeps {
  currency(tenant: string): Promise<string>
  sportsKPIs(filter: Record<string, unknown>): Promise<DomainKpis>
  casinoKPIs(filter: Record<string, unknown>): Promise<DomainKpis>
  matkaKPIs(filter: Record<string, unknown>): Promise<DomainKpis>
  bonusKPIs(filter: Record<string, unknown>): Promise<{ totalRedeemed: number }>
  moneyTotals(scope: AgentDashboardScope, dateFrom: Date, dateTo: Date): Promise<MoneyTotals>
  playerTotals(scope: AgentDashboardScope, dateFrom: Date, dateTo: Date): Promise<PlayerTotals>
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Same parsing as getDashboardKPIs, so an agent's range means what an admin's does. */
function toRangeDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return fallback
  const d = value instanceof Date ? value : new Date(value)
  return isNaN(d.getTime()) ? fallback : d
}

async function defaultMoneyTotals(scope: AgentDashboardScope, dateFrom: Date, dateTo: Date): Promise<MoneyTotals> {
  const { db } = await import('@/db/client.js')
  const { depositRequests, withdrawalRequests, ledgerEntries, wallets } = await import('@shared/db/schema.js')
  const { settlementDateExpr } = await import('@/shared/reportingSql.js')
  const { inAgentPlayers } = await import('@/repos/reporting/agentPlayerScope.js')

  // Bucketed by the date money moved (approval), as the admin dashboard does.
  const depAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt)
  const wdAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt)

  const [dep, wd, manualDep, manualWd] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int`, volume: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)` })
      .from(depositRequests)
      .where(and(
        eq(depositRequests.tenant, scope.tenant),
        eq(depositRequests.status, 'APPROVED' as any),
        gte(depAt, dateFrom),
        lte(depAt, dateTo),
        inAgentPlayers(depositRequests.userId, scope.agentId, scope.tenant),
      )),
    db
      .select({ count: sql<number>`COUNT(*)::int`, volume: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)` })
      .from(withdrawalRequests)
      .where(and(
        eq(withdrawalRequests.tenant, scope.tenant),
        eq(withdrawalRequests.status, 'COMPLETED' as any),
        gte(wdAt, dateFrom),
        lte(wdAt, dateTo),
        inAgentPlayers(withdrawalRequests.userId, scope.agentId, scope.tenant),
      )),
    // Manual (admin) deposits and withdrawals, the same definition as
    // getManualDepositWithdrawalStatsTenantDb, restricted to the agent's players.
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
      .where(and(
        eq(ledgerEntries.tenant, scope.tenant),
        eq(ledgerEntries.type, 'credit'),
        sql`${ledgerEntries.meta} IS NOT NULL`,
        sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
        sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
        gte(ledgerEntries.createdAt, dateFrom),
        lte(ledgerEntries.createdAt, dateTo),
        inAgentPlayers(wallets.userId, scope.agentId, scope.tenant),
      )),
    db
      .select({
        count: sql<number>`COALESCE(COUNT(*)::int, 0)`,
        volume: sql<number>`COALESCE(SUM(ABS((NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric))), 0)`,
      })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
      .where(and(
        eq(ledgerEntries.tenant, scope.tenant),
        eq(ledgerEntries.type, 'debit'),
        sql`${ledgerEntries.meta} IS NOT NULL`,
        sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
        gte(ledgerEntries.createdAt, dateFrom),
        lte(ledgerEntries.createdAt, dateTo),
        inAgentPlayers(wallets.userId, scope.agentId, scope.tenant),
      )),
  ])

  return {
    depositCount: Number(dep[0]?.count ?? 0) + Number(manualDep[0]?.count ?? 0),
    depositVolume: Number(dep[0]?.volume ?? 0) + Number(manualDep[0]?.volume ?? 0),
    withdrawalCount: Number(wd[0]?.count ?? 0) + Number(manualWd[0]?.count ?? 0),
    withdrawalVolume: Number(wd[0]?.volume ?? 0) + Number(manualWd[0]?.volume ?? 0),
  }
}

async function defaultPlayerTotals(scope: AgentDashboardScope, dateFrom: Date, dateTo: Date): Promise<PlayerTotals> {
  const { db } = await import('@/db/client.js')
  const { users, ledgerEntries, wallets } = await import('@shared/db/schema.js')
  const { inAgentPlayers } = await import('@/repos/reporting/agentPlayerScope.js')

  const [total, fresh, active] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)::int` }).from(users)
      .where(and(eq(users.tenant, scope.tenant), inAgentPlayers(users.id, scope.agentId, scope.tenant))),
    db.select({ n: sql<number>`COUNT(*)::int` }).from(users)
      .where(and(
        eq(users.tenant, scope.tenant),
        gte(users.createdAt, dateFrom),
        lte(users.createdAt, dateTo),
        inAgentPlayers(users.id, scope.agentId, scope.tenant),
      )),
    // "Active" = had wallet activity in the range, the admin dashboard's definition.
    db.select({ n: sql<number>`COUNT(DISTINCT ${wallets.userId})::int` })
      .from(ledgerEntries)
      .innerJoin(wallets, eq(ledgerEntries.walletId, wallets.id))
      .where(and(
        eq(ledgerEntries.tenant, scope.tenant),
        gte(ledgerEntries.createdAt, dateFrom),
        lte(ledgerEntries.createdAt, dateTo),
        inAgentPlayers(wallets.userId, scope.agentId, scope.tenant),
      )),
  ])
  return {
    totalPlayers: Number(total[0]?.n ?? 0),
    newPlayers: Number(fresh[0]?.n ?? 0),
    activePlayers: Number(active[0]?.n ?? 0),
  }
}

async function loadDefaultDeps(): Promise<AgentDashboardDeps> {
  const sports = await import('@/repos/reporting/sportsReportingRepo.js')
  const casino = await import('@/repos/reporting/casinoReportingRepo.js')
  const matka = await import('@/repos/reporting/matkaReportingRepo.js')
  const bonus = await import('@/repos/reporting/bonusReportingRepo.js')
  const { getWhitelabelBaseCurrency } = await import('@/services/dashboardService.js')
  return {
    currency: (tenant) => getWhitelabelBaseCurrency(tenant),
    sportsKPIs: (f) => sports.getSportsKPIs(f as any),
    casinoKPIs: (f) => casino.getCasinoKPIs(f as any),
    matkaKPIs: (f) => matka.getMatkaKPIs(f as any),
    bonusKPIs: (f) => bonus.getBonusKPIs(f as any),
    moneyTotals: defaultMoneyTotals,
    playerTotals: defaultPlayerTotals,
  }
}

const ZERO_DOMAIN: DomainKpis = { totalStakes: 0, grossGamingRevenue: 0, totalExposure: 0, betCount: 0 }

export async function getAgentDashboardKPIs(
  scope: AgentDashboardScope,
  dateRange?: DashboardDateRange,
  injected?: AgentDashboardDeps,
): Promise<DashboardKPIs> {
  if (!scope.agentId) throw new Error('getAgentDashboardKPIs requires an agentId')
  const deps = injected ?? (await loadDefaultDeps())

  const dateFrom = toRangeDate(dateRange?.dateFrom, new Date(Date.now() - WEEK_MS))
  const dateTo = toRangeDate(dateRange?.dateTo, new Date())
  const currency = await deps.currency(scope.tenant).catch(() => 'INR')

  // Every repo below receives the agent id; each one scopes to the agent's players.
  const filter = {
    tenant: scope.tenant,
    whitelabelId: scope.whitelabelId ?? scope.tenant,
    agentId: scope.agentId,
    dateFrom,
    dateTo,
    currency,
  }

  const [sportsK, casinoK, matkaK, bonusK, money, players] = await Promise.all([
    deps.sportsKPIs(filter).catch(() => ZERO_DOMAIN),
    deps.casinoKPIs(filter).catch(() => ZERO_DOMAIN),
    deps.matkaKPIs(filter).catch(() => ZERO_DOMAIN),
    deps.bonusKPIs(filter).catch(() => ({ totalRedeemed: 0 })),
    deps.moneyTotals(scope, dateFrom, dateTo).catch(() => ({ depositVolume: 0, depositCount: 0, withdrawalVolume: 0, withdrawalCount: 0 })),
    deps.playerTotals(scope, dateFrom, dateTo).catch(() => ({ totalPlayers: 0, newPlayers: 0, activePlayers: 0 })),
  ])

  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  const sportsTurnover = n(sportsK.totalStakes)
  const casinoTurnover = n(casinoK.totalStakes)
  const matkaTurnover = n(matkaK.totalStakes)
  const turnover = sportsTurnover + casinoTurnover + matkaTurnover
  const sportsGGR = n(sportsK.grossGamingRevenue)
  const casinoGGR = n(casinoK.grossGamingRevenue)
  const matkaGGR = n(matkaK.grossGamingRevenue)
  const ggr = sportsGGR + casinoGGR + matkaGGR
  const bonusPayouts = n(bonusK.totalRedeemed)
  const exposure = n(sportsK.totalExposure) + n(matkaK.totalExposure)
  const sportsBets = n(sportsK.betCount)
  const casinoBets = n(casinoK.betCount)
  const matkaBets = n(matkaK.betCount)
  const totalBets = sportsBets + casinoBets + matkaBets
  const { totalPlayers, newPlayers, activePlayers } = players
  const retentionRate = totalPlayers > 0 ? (activePlayers / totalPlayers) * 100 : 0

  return {
    turnover,
    sportsTurnover,
    casinoTurnover,
    matkaTurnover,
    ggr,
    // The whitelabel's commission bill is not the agent's figure; NGR here is
    // GGR less the agent's players' redeemed bonuses.
    ngr: ggr - bonusPayouts,
    liquidity: turnover,
    exposure,
    unmatchedOrders: 0,
    upcomingDrawCutoffs: 0,
    jackpotStatus: 'Stable',
    // Whitelabel administration: pending deposit/withdrawal approvals and their
    // alerts belong to the operator, not to an agent.
    alerts: [],
    approvalsPending: [],
    auditSpotlight: [],
    totalDeposits: money.depositVolume,
    totalWithdrawals: money.withdrawalVolume,
    netDeposits: money.depositVolume - money.withdrawalVolume,
    sportsGGR,
    casinoGGR,
    matkaGGR,
    activePlayers,
    newPlayers,
    totalPlayers,
    totalBets,
    sportsBets,
    casinoBets,
    matkaBets,
    agentCommission: 0,
    bonusPayouts,
    totalSettlement: 0,
    liveSettlement: 0,
    liveCommission: 0,
    totalCommission: 0,
    ftd: 0,
    ftdCount: 0,
    ltv: totalPlayers > 0 ? ggr / totalPlayers : 0,
    arpu: activePlayers > 0 ? ggr / activePlayers : 0,
    arppu: 0,
    conversionRate: 0,
    retentionRate,
    churnRate: totalPlayers > 0 ? 100 - retentionRate : 0,
    dauMauRatio: retentionRate,
    avgSessionDuration: 0,
    avgBetSize: totalBets > 0 ? turnover / totalBets : 0,
    winRate: turnover > 0 ? ((turnover - ggr) / turnover) * 100 : 0,
    riskScore: 0,
    complianceScore: 0,
    revenueGrowth: 0,
    playerGrowth: 0,
    depositGrowth: 0,
    totalSessions: 0,
    avgSessionsPerUser: 0,
    bounceRate: 0,
  }
}
