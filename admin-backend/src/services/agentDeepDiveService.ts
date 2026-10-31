import { db } from '@/db/client.js';
import { agents, agentCredentials, users, agentWallets, agentSettlements, ledgerEntries, wallets } from '@shared/db/schema.js';
import { eq, and, gte, lte, sql, count, inArray, isNull } from 'drizzle-orm';

interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Get comprehensive agent deep dive analytics
 */
export async function getAgentDeepDive(tenant: string, filter?: DateRangeFilter) {
  try {
    const dateFrom = filter?.dateFrom ? new Date(filter.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dateTo = filter?.dateTo ? new Date(filter.dateTo) : new Date();

    const [
      downlineSummary,
      conversionMetrics,
      creditUtilization,
      topAgentsByRevenue,
      settlementStatus,
    ] = await Promise.all([
      getDownlineSummary(tenant),
      getConversionMetrics(tenant, dateFrom, dateTo),
      getCreditUtilization(tenant),
      getTopAgentsByRevenue(tenant, dateFrom, dateTo, 10),
      getSettlementStatus(tenant, dateFrom, dateTo),
    ]);

    return {
      downlineSummary,
      conversionMetrics,
      creditUtilization,
      topAgentsByRevenue,
      settlementStatus,
    };
  } catch (error: any) {
    return {
      downlineSummary: {
        totalAgents: 0,
        totalPlayers: 0,
        activePlayers: 0,
        inactivePlayers: 0,
        avgPlayersPerAgent: 0,
      },
      conversionMetrics: {
        registrationToDepositRate: 0,
        depositToActiveRate: 0,
        overallConversionRate: 0,
      },
      creditUtilization: {
        totalCreditAllocated: 0,
        totalCreditUsed: 0,
        utilizationRate: 0,
        availableCredit: 0,
      },
      topAgentsByRevenue: [],
      settlementStatus: {
        pendingAmount: 0,
        settledAmount: 0,
        overdueAmount: 0,
        pendingCount: 0,
      },
    };
  }
}

/**
 * Get downline summary stats
 */
async function getDownlineSummary(tenant: string) {
  try {
    const [agentCount] = await db
      .select({ count: count() })
      .from(agents)
      .where(eq(agents.tenantId, tenant));

    const [playerStats] = await db
      .select({
        total: count(),
        active: sql<number>`COUNT(CASE WHEN ${users.status} = 'active' THEN 1 END)::int`,
      })
      .from(users)
      .where(
        and(
          eq(users.tenant, tenant),
          sql`${users.agentId} IS NOT NULL`
        )
      );

    const totalAgents = Number(agentCount?.count || 0);
    const totalPlayers = Number(playerStats?.total || 0);
    const activePlayers = Number(playerStats?.active || 0);

    return {
      totalAgents,
      totalPlayers,
      activePlayers,
      inactivePlayers: totalPlayers - activePlayers,
      avgPlayersPerAgent: totalAgents > 0 ? totalPlayers / totalAgents : 0,
    };
  } catch (error: any) {
    return {
      totalAgents: 0,
      totalPlayers: 0,
      activePlayers: 0,
      inactivePlayers: 0,
      avgPlayersPerAgent: 0,
    };
  }
}

/**
 * Get conversion metrics for agents' downline
 */
async function getConversionMetrics(tenant: string, dateFrom: Date, dateTo: Date) {
  try {
    const [stats] = await db
      .select({
        totalRegistrations: count(),
        deposited: sql<number>`COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM ledger_entries le
          INNER JOIN wallets w ON le.wallet_id = w.id
          WHERE w.user_id = ${users.id}
          AND le.type = 'credit' AND le.meta->>'type' = 'deposit'
          AND le.created_at >= ${dateFrom}
          AND le.created_at <= ${dateTo}
        ) THEN 1 END)::int`,
        active: sql<number>`COUNT(CASE WHEN ${users.status} = 'active' THEN 1 END)::int`,
      })
      .from(users)
      .where(
        and(
          eq(users.tenant, tenant),
          sql`${users.agentId} IS NOT NULL`,
          gte(users.createdAt, dateFrom),
          lte(users.createdAt, dateTo)
        )
      );

    const totalReg = Number(stats?.totalRegistrations || 0);
    const deposited = Number(stats?.deposited || 0);
    const active = Number(stats?.active || 0);

    return {
      registrationToDepositRate: totalReg > 0 ? (deposited / totalReg) * 100 : 0,
      depositToActiveRate: deposited > 0 ? (active / deposited) * 100 : 0,
      overallConversionRate: totalReg > 0 ? (active / totalReg) * 100 : 0,
    };
  } catch (error: any) {
    return {
      registrationToDepositRate: 0,
      depositToActiveRate: 0,
      overallConversionRate: 0,
    };
  }
}

/**
 * Get credit utilization stats
 * Wallet amounts are already in the whitelabel currency — no conversion needed.
 */
async function getCreditUtilization(tenant: string) {
  try {
    const [stats] = await db
      .select({
        totalCredit: sql<number>`COALESCE(SUM(${agentWallets.balance}::numeric + ${agentWallets.lockedBalance}::numeric), 0)`,
        usedCredit: sql<number>`COALESCE(SUM(${agentWallets.lockedBalance}::numeric), 0)`,
      })
      .from(agentWallets)
      .innerJoin(agents, eq(agentWallets.agentId, agents.id))
      .where(eq(agents.tenantId, tenant));

    const totalCredit = Number(stats?.totalCredit || 0);
    const usedCredit = Number(stats?.usedCredit || 0);

    return {
      totalCreditAllocated: totalCredit,
      totalCreditUsed: usedCredit,
      utilizationRate: totalCredit > 0 ? (usedCredit / totalCredit) * 100 : 0,
      availableCredit: totalCredit - usedCredit,
    };
  } catch (error: any) {
    return {
      totalCreditAllocated: 0,
      totalCreditUsed: 0,
      utilizationRate: 0,
      availableCredit: 0,
    };
  }
}

/**
 * Get top agents by revenue (from rankings service, simplified here)
 */
async function getTopAgentsByRevenue(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date, 
  limit: number,
) {
  try {
    const results = await db
      .select({
        agentId: agents.id,
        username: agentCredentials.username,
        name: agentCredentials.username,
        playerCount: sql<number>`COUNT(DISTINCT ${users.id})::int`,
      })
      .from(agents)
      .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
      .leftJoin(users, eq(agents.id, users.agentId))
      .where(eq(agents.tenantId, tenant))
      .groupBy(agents.id, agentCredentials.username)
      .orderBy(sql`COUNT(DISTINCT ${users.id}) DESC`)
      .limit(limit);

    return results.map((r, index) => ({
      agentId: String(r.agentId),
      agentName: String(r.name || r.username),
      username: String(r.username),
      value: Number(r.playerCount || 0),
      rank: index + 1,
      metric: 'players',
      trend: 'stable',
    }));
  } catch (error: any) {
    return [];
  }
}

/**
 * Get settlement status
 * Settlement amounts are already in the whitelabel currency — no conversion needed.
 */
async function getSettlementStatus(
  tenant: string, 
  dateFrom: Date, 
  dateTo: Date,
) {
  try {
    const [stats] = await db
      .select({
        pendingAmount: sql<number>`COALESCE(SUM(CASE WHEN ${agentSettlements.status} = 'OPEN' THEN ${agentSettlements.totalAmount} ELSE 0 END)::numeric, 0)`,
        settledAmount: sql<number>`COALESCE(SUM(CASE WHEN ${agentSettlements.status} = 'CLOSED' THEN ${agentSettlements.totalAmount} ELSE 0 END)::numeric, 0)`,
        pendingCount: sql<number>`COUNT(CASE WHEN ${agentSettlements.status} = 'OPEN' THEN 1 END)::int`,
      })
      .from(agentSettlements)
      .innerJoin(agents, eq(agentSettlements.agentId, agents.id))
      .where(
        and(
          eq(agents.tenantId, tenant),
          gte(agentSettlements.periodFrom, dateFrom),
          lte(agentSettlements.periodTo, dateTo)
        )
      );

    return {
      pendingAmount: Number(stats?.pendingAmount || 0),
      settledAmount: Number(stats?.settledAmount || 0),
      overdueAmount: 0,
      pendingCount: Number(stats?.pendingCount || 0),
    };
  } catch (error: any) {
    return {
      pendingAmount: 0,
      settledAmount: 0,
      overdueAmount: 0,
      pendingCount: 0,
    };
  }
}
