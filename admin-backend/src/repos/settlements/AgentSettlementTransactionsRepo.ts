import { db } from '@/db/client';
import { agentSettlementTransactions } from '@shared/db/schema.js';
import { and, eq, desc, inArray, gte, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export interface CreateAgentSettlementInput {
  tenant: string;
  agentId: string;
  settlementType: 'P_L' | 'CREDIT';
  amount: number;
  direction: 'TO_AGENT' | 'FROM_AGENT';
  previousBalance?: number;
  newBalance?: number;
  notes?: string;
  settledBy?: string;
}

export interface AgentSettlement {
  id: string;
  tenant: string;
  agentId: string;
  settlementType: 'P_L' | 'CREDIT';
  amount: number;
  direction: 'TO_AGENT' | 'FROM_AGENT';
  previousBalance?: number | null;
  newBalance?: number | null;
  notes?: string | null;
  settledBy?: string | null;
  createdAt: Date;
}

export class AgentSettlementTransactionsRepo {
  async create(input: CreateAgentSettlementInput, tx: any = db): Promise<AgentSettlement> {
    const runner = tx ?? db;
    const [row] = await runner
      .insert(agentSettlementTransactions)
      .values({
        tenant: input.tenant,
        agentId: input.agentId,
        settlementType: input.settlementType,
        amount: String(input.amount),
        direction: input.direction,
        previousBalance: input.previousBalance != null ? String(input.previousBalance) : null,
        newBalance: input.newBalance != null ? String(input.newBalance) : null,
        notes: input.notes || null,
        settledBy: input.settledBy || null,
      })
      .returning();

    return this.toRow(row);
  }

  async list(params: {
    tenant: string;
    agentId?: string;
    agentIds?: string[];
    limit?: number;
    offset?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<AgentSettlement[]> {
    const conditions = [eq(agentSettlementTransactions.tenant, params.tenant)];
    
    if (params.agentIds && params.agentIds.length > 0) {
      conditions.push(inArray(agentSettlementTransactions.agentId, params.agentIds));
    } else if (params.agentId) {
      conditions.push(eq(agentSettlementTransactions.agentId, params.agentId));
    }
    
    if (params.fromDate) {
      conditions.push(gte(agentSettlementTransactions.createdAt, params.fromDate));
    }
    
    if (params.toDate) {
      conditions.push(lte(agentSettlementTransactions.createdAt, params.toDate));
    }

    let query = db
      .select()
      .from(agentSettlementTransactions)
      .where(and(...conditions))
      .orderBy(desc(agentSettlementTransactions.createdAt), desc(agentSettlementTransactions.id));

    if (params.limit) {
      query = query.limit(params.limit) as any;
    }
    
    if (params.offset) {
      query = query.offset(params.offset) as any;
    }

    const rows = await query;
    return rows.map(row => this.toRow(row));
  }

  async summary(params: { tenant: string; agentId?: string; fromDate?: Date; toDate?: Date }) {
    const conditions = [eq(agentSettlementTransactions.tenant, params.tenant)];
    if (params.agentId) conditions.push(eq(agentSettlementTransactions.agentId, params.agentId));
    if (params.fromDate) conditions.push(gte(agentSettlementTransactions.createdAt, params.fromDate));
    if (params.toDate) conditions.push(lte(agentSettlementTransactions.createdAt, params.toDate));
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(amount),0)::float8`,
      toAgent: sql<number>`coalesce(sum(amount) filter (where direction='TO_AGENT'),0)::float8`,
      fromAgent: sql<number>`coalesce(sum(amount) filter (where direction='FROM_AGENT'),0)::float8`,
      toCount: sql<number>`count(*) filter (where direction='TO_AGENT')::int`,
      fromCount: sql<number>`count(*) filter (where direction='FROM_AGENT')::int`,
    }).from(agentSettlementTransactions).where(and(...conditions));
    return row;
  }

  async getById(id: string, tenant: string): Promise<AgentSettlement | null> {
    const [row] = await db
      .select()
      .from(agentSettlementTransactions)
      .where(and(eq(agentSettlementTransactions.id, id), eq(agentSettlementTransactions.tenant, tenant)))
      .limit(1);

    return row ? this.toRow(row) : null;
  }

  /**
   * Find the transaction (with notes) that was created for a given settlement.
   * Settlement and transaction are created in the same flow, so transaction.createdAt is near settlement.createdAt.
   * Matches by tenant, agentId, and createdAt within a short window; optionally by amount for disambiguation.
   */
  async getTransactionForSettlement(params: {
    tenant: string;
    agentId: string;
    settlementCreatedAt: Date;
    settlementAmount?: number;
  }): Promise<AgentSettlement | null> {
    const t = params.settlementCreatedAt.getTime();
    if (!Number.isFinite(t)) return null;
    const from = new Date(t - 30 * 1000);
    const to = new Date(t + 5 * 60 * 1000);
    const conditions = [
      eq(agentSettlementTransactions.tenant, params.tenant),
      eq(agentSettlementTransactions.agentId, params.agentId),
      gte(agentSettlementTransactions.createdAt, from),
      lte(agentSettlementTransactions.createdAt, to),
    ];
    if (params.settlementAmount != null) {
      const lo = Math.abs(params.settlementAmount) - 0.01;
      const hi = Math.abs(params.settlementAmount) + 0.01;
      conditions.push(sql`abs(${agentSettlementTransactions.amount}::float) >= ${lo}`);
      conditions.push(sql`abs(${agentSettlementTransactions.amount}::float) <= ${hi}`);
    }
    const [row] = await db
      .select()
      .from(agentSettlementTransactions)
      .where(and(...conditions))
      .orderBy(agentSettlementTransactions.createdAt)
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async getByTenant(
    tenant: string,
    limit?: number,
    offset?: number
  ): Promise<AgentSettlement[]> {
    return this.list({
      tenant,
      limit,
      offset,
    });
  }

  /**
   * Total settled amount per agent (all time), for display in pending list.
   * Returns map of agentId -> sum of transaction amounts for that agent.
   */
  async getTotalSettledByAgentIds(tenant: string, agentIds: string[]): Promise<Map<string, number>> {
    if (agentIds.length === 0) return new Map();
    const rows = await db
      .select({
        agentId: agentSettlementTransactions.agentId,
        total: sql<number>`COALESCE(SUM((${agentSettlementTransactions.amount})::numeric), 0)`,
      })
      .from(agentSettlementTransactions)
      .where(
        and(
          eq(agentSettlementTransactions.tenant, tenant),
          inArray(agentSettlementTransactions.agentId, agentIds)
        )
      )
      .groupBy(agentSettlementTransactions.agentId);
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.agentId) continue;
      const total = Number(r.total);
      if (Number.isFinite(total)) map.set(r.agentId, total);
    }
    return map;
  }

  async getPendingSettlements(tenant: string, agentIds?: string[]): Promise<Map<string, number>> {
    // Calculate pending settlement amounts from agent stats
    // This method is used to get pending amounts for bulk operations
    const { AgentListStatsService } = await import('../../domains/agents/services/AgentListStatsService');
    const { AgentsRepo } = await import('../agents/AgentsRepo');
    
    const agentsRepo = new AgentsRepo();
    const statsService = new AgentListStatsService();
    
    // Get agents (filtered by agentIds if provided)
    let allAgents = await agentsRepo.list(tenant);
    if (agentIds && agentIds.length > 0) {
      allAgents = allAgents.filter(a => agentIds.includes(a.id));
    }
    
    if (allAgents.length === 0) {
      return new Map();
    }
    
    const agentIdsList = allAgents.map(a => a.id);
    const statsMap = await statsService.getStatsForAgents(agentIdsList, tenant);

    const commissionAgentIds = allAgents.filter((a) => a.schemeType === 'COMMISSION').map((a) => a.id);
    const { CommissionPayoutsRepo } = await import('./CommissionPayoutsRepo');
    const payoutsRepo = new CommissionPayoutsRepo();
    const commissionTotalPaidMap = commissionAgentIds.length > 0
      ? await payoutsRepo.getTotalPaidByAgentIds(tenant, commissionAgentIds)
      : new Map<string, number>();
    
    const pendingMap = new Map<string, number>();
    
    for (const agent of allAgents) {
      const stats = statsMap.get(agent.id);
      let pendingAmount = 0;
      
      // CREDIT has no pending settlement: its chips move by Deposit / Withdraw.
      if (agent.schemeType === 'SHARING' && stats?.profitLoss != null && stats.profitLoss !== 0) {
        const pl = Number(stats.profitLoss);
        pendingAmount = Number.isFinite(pl) ? Math.abs(pl) : 0;
      } else if (agent.schemeType === 'COMMISSION') {
        const earned = Number(stats?.commissionEarned ?? 0);
        const paid = commissionTotalPaidMap.get(agent.id) ?? 0;
        pendingAmount = Number.isFinite(earned) && Number.isFinite(paid) ? Math.max(0, earned - paid) : 0;
      }
      
      if (Number.isFinite(pendingAmount) && pendingAmount > 0.01) {
        pendingMap.set(agent.id, pendingAmount);
      }
    }
    
    return pendingMap;
  }

  private toRow(row: any): AgentSettlement {
    return {
      id: row.id,
      tenant: row.tenant,
      agentId: row.agentId,
      settlementType: row.settlementType,
      amount: Number(row.amount),
      direction: row.direction,
      previousBalance: row.previousBalance ? Number(row.previousBalance) : null,
      newBalance: row.newBalance ? Number(row.newBalance) : null,
      notes: row.notes,
      settledBy: row.settledBy,
      createdAt: row.createdAt,
    };
  }
}

