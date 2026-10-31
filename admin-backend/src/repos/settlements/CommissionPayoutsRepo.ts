/**
 * Commission payouts repository.
 *
 * BACKEND ENFORCEMENT: Commission payout records are immutable. They can only be created
 * via payCommission; there is no update or delete. Any attempt to update or delete
 * must go through this repo and will be rejected with an error.
 */
import { DateTime } from 'luxon';
import { db } from '@/db/client';
import { commissionPayouts } from '@shared/db/schema.js';
import { and, eq, desc, gte, lt, lte, inArray, sql } from 'drizzle-orm';

const COMMISSION_SETTLEMENT_IST = 'Asia/Kolkata';

const IMMUTABLE_MESSAGE = 'Commission payout records are immutable and cannot be edited or deleted.';

export interface CreateCommissionPayoutInput {
  tenant: string;
  agentId: string;
  amount: number;
  periodFrom?: Date;
  periodTo?: Date;
  turnover?: number;
  notes?: string;
  paidBy?: string;
}

export interface CommissionPayout {
  id: string;
  tenant: string;
  agentId: string;
  amount: number;
  periodFrom?: Date | null;
  periodTo?: Date | null;
  turnover?: number | null;
  notes?: string | null;
  paidBy?: string | null;
  createdAt: Date;
}

export class CommissionPayoutsRepo {
  async create(input: CreateCommissionPayoutInput, tx: any = db): Promise<CommissionPayout> {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Commission payout amount must be a finite number greater than 0');
    }
    // Store period as IST date (YYYY-MM-DD) so getPayoutForCycle/getTotalPaidForCycle match
    const periodFromStr = input.periodFrom ? CommissionPayoutsRepo.toDateStringIST(input.periodFrom) : null;
    const periodToStr = input.periodTo ? CommissionPayoutsRepo.toDateStringIST(input.periodTo) : null;
    const [row] = await tx
      .insert(commissionPayouts)
      .values({
        tenant: input.tenant,
        agentId: input.agentId,
        amount: String(amount),
        periodFrom: periodFromStr,
        periodTo: periodToStr,
        turnover: input.turnover ? String(input.turnover) : null,
        notes: input.notes || null,
        paidBy: input.paidBy || null,
      } as any)
      .returning();

    return this.toRow(row);
  }

  async list(params: {
    tenant: string;
    agentId?: string;
    limit?: number;
    offset?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<CommissionPayout[]> {
    const conditions = [eq(commissionPayouts.tenant, params.tenant)];
    
    if (params.agentId) {
      conditions.push(eq(commissionPayouts.agentId, params.agentId));
    }
    
    if (params.fromDate) {
      conditions.push(gte(commissionPayouts.createdAt, params.fromDate));
    }
    
    if (params.toDate) {
      conditions.push(lte(commissionPayouts.createdAt, params.toDate));
    }

    let query = db
      .select()
      .from(commissionPayouts)
      .where(and(...conditions))
      .orderBy(desc(commissionPayouts.createdAt), desc(commissionPayouts.id));

    if (params.limit) {
      query = query.limit(params.limit) as any;
    }
    
    if (params.offset) {
      query = query.offset(params.offset) as any;
    }

    const rows = await query;
    return rows.map(row => this.toRow(row));
  }

  /** Count matching payouts (same filters as list). */
  async count(params: {
    tenant: string;
    agentId?: string;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<number> {
    const conditions = [eq(commissionPayouts.tenant, params.tenant)];
    if (params.agentId) conditions.push(eq(commissionPayouts.agentId, params.agentId));
    if (params.fromDate) conditions.push(gte(commissionPayouts.createdAt, params.fromDate));
    if (params.toDate) conditions.push(lte(commissionPayouts.createdAt, params.toDate));
    const [r] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commissionPayouts)
      .where(and(...conditions));
    const n = Number(r?.count ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /** List payouts for downline agents (agentId IN agentIds), with optional subAgentId filter and pagination. Returns items and total. */
  async listForDownline(params: {
    tenant: string;
    agentIds: string[];
    subAgentId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ items: CommissionPayout[]; total: number }> {
    if (params.agentIds.length === 0) {
      return { items: [], total: 0 };
    }
    const conditions = [
      eq(commissionPayouts.tenant, params.tenant),
      inArray(commissionPayouts.agentId, params.subAgentId ? [params.subAgentId] : params.agentIds),
    ];
    if (params.fromDate) conditions.push(gte(commissionPayouts.createdAt, params.fromDate));
    if (params.toDate) conditions.push(lte(commissionPayouts.createdAt, params.toDate));

    const countQuery = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commissionPayouts)
      .where(and(...conditions));
    const total = Number(countQuery[0]?.count ?? 0);

    let query = db
      .select()
      .from(commissionPayouts)
      .where(and(...conditions))
      .orderBy(desc(commissionPayouts.createdAt), desc(commissionPayouts.id));
    if (params.limit != null) query = query.limit(params.limit) as any;
    if (params.offset != null) query = query.offset(params.offset) as any;
    const rows = await query;
    const items = rows.map((row: any) => this.toRow(row));
    return { items, total: Number.isFinite(total) ? total : 0 };
  }

  async getById(id: string, tenant: string): Promise<CommissionPayout | null> {
    const [row] = await db
      .select()
      .from(commissionPayouts)
      .where(and(eq(commissionPayouts.id, id), eq(commissionPayouts.tenant, tenant)))
      .limit(1);

    return row ? this.toRow(row) : null;
  }

  /**
   * Commission payouts are immutable. This method always throws.
   * Enforced so no code path can edit an existing commission payout.
   */
  async update(
    _id: string,
    _tenant: string,
    _data: Partial<Pick<CommissionPayout, 'amount' | 'notes' | 'periodFrom' | 'periodTo'>>,
  ): Promise<CommissionPayout> {
    throw new Error(IMMUTABLE_MESSAGE);
  }

  /**
   * Commission payouts are immutable and must not be deleted. This method always throws.
   * Enforced so no code path can remove or reverse a commission payout.
   */
  async delete(_id: string, _tenant: string): Promise<void> {
    throw new Error(IMMUTABLE_MESSAGE);
  }

  /** Sum of payout amounts per agent (for pending = calculatedTotal - paid). Optional period filter by createdAt. */
  async getTotalPaidByAgentIds(
    tenant: string,
    agentIds: string[],
    options?: { fromDate?: Date; toDate?: Date }
  ): Promise<Map<string, number>> {
    if (agentIds.length === 0) return new Map();
    const conditions = [eq(commissionPayouts.tenant, tenant), inArray(commissionPayouts.agentId, agentIds)];
    if (options?.fromDate) conditions.push(gte(commissionPayouts.createdAt, options.fromDate));
    if (options?.toDate) conditions.push(lte(commissionPayouts.createdAt, options.toDate));
    const rows = await db
      .select({
        agentId: commissionPayouts.agentId,
        total: sql<number>`COALESCE(SUM((${commissionPayouts.amount})::numeric), 0)`,
      })
      .from(commissionPayouts)
      .where(and(...conditions))
      .groupBy(commissionPayouts.agentId);
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.agentId) continue;
      const total = Number(r.total);
      if (Number.isFinite(total)) map.set(r.agentId, total);
    }
    return map;
  }

  /** Format Date to YYYY-MM-DD in IST for cycle period columns. */
  private static toDateStringIST(d: Date): string {
    return DateTime.fromJSDate(d, { zone: COMMISSION_SETTLEMENT_IST }).toFormat('yyyy-MM-dd');
  }

  /**
   * Total paid for a specific IST cycle (periodFrom/periodTo match). Used for cycle status and idempotency.
   * COMMISSION-only.
   */
  async getTotalPaidForCycle(
    tenant: string,
    agentId: string,
    cycleFrom: Date,
    cycleTo: Date,
  ): Promise<number> {
    const fromStr = CommissionPayoutsRepo.toDateStringIST(cycleFrom);
    const toStr = CommissionPayoutsRepo.toDateStringIST(cycleTo);
    const [r] = await db
      .select({
        total: sql<number>`COALESCE(SUM((${commissionPayouts.amount})::numeric), 0)`,
      })
      .from(commissionPayouts)
      .where(
        and(
          eq(commissionPayouts.tenant, tenant),
          eq(commissionPayouts.agentId, agentId),
          eq(commissionPayouts.periodFrom, fromStr),
          eq(commissionPayouts.periodTo, toStr),
        ),
      );
    const n = Number(r?.total ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Batch: total paid per agent for the same IST cycle (periodFrom/periodTo).
   * Use when loading stats for many agents with the same period to avoid N queries.
   */
  async getTotalPaidForCycleBatch(
    tenant: string,
    agentIds: string[],
    cycleFrom: Date,
    cycleTo: Date,
  ): Promise<Map<string, number>> {
    if (agentIds.length === 0) return new Map();
    const fromStr = CommissionPayoutsRepo.toDateStringIST(cycleFrom);
    const toStr = CommissionPayoutsRepo.toDateStringIST(cycleTo);
    const rows = await db
      .select({
        agentId: commissionPayouts.agentId,
        total: sql<number>`COALESCE(SUM((${commissionPayouts.amount})::numeric), 0)`,
      })
      .from(commissionPayouts)
      .where(
        and(
          eq(commissionPayouts.tenant, tenant),
          inArray(commissionPayouts.agentId, agentIds),
          eq(commissionPayouts.periodFrom, fromStr),
          eq(commissionPayouts.periodTo, toStr),
        ),
      )
      .groupBy(commissionPayouts.agentId);
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.agentId) continue;
      const n = Number(r.total ?? 0);
      if (Number.isFinite(n)) map.set(r.agentId, n);
    }
    return map;
  }

  /**
   * Paid per IST cycle for each agent, for every cycle that overlaps [from, to):
   * agentId -> (cycle Monday YYYY-MM-DD -> amount). Used so a multi-cycle or
   * all-time "pending" subtracts what was paid for each cycle in it; matching
   * the range itself as one exact cycle (getTotalPaidForCycle) found nothing
   * for any range but a single week, so pending never went down.
   */
  async getPaidByCycleForAgents(
    tenant: string,
    agentIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();
    if (agentIds.length === 0 || !(to.getTime() > from.getTime())) return result;
    const fromIst = DateTime.fromJSDate(from, { zone: COMMISSION_SETTLEMENT_IST });
    const firstMonday = fromIst.minus({ days: fromIst.weekday - 1 }).toFormat('yyyy-MM-dd');
    // A cycle overlaps [from, to) when its Monday 00:00 IST is before `to`.
    const toIst = DateTime.fromJSDate(to, { zone: COMMISSION_SETTLEMENT_IST });
    const toIsMidnight = toIst.hour === 0 && toIst.minute === 0 && toIst.second === 0 && toIst.millisecond === 0;
    const endExclusive = (toIsMidnight ? toIst : toIst.plus({ days: 1 })).toFormat('yyyy-MM-dd');
    const rows = await db
      .select({
        agentId: commissionPayouts.agentId,
        periodFrom: commissionPayouts.periodFrom,
        total: sql<number>`COALESCE(SUM((${commissionPayouts.amount})::numeric), 0)`,
      })
      .from(commissionPayouts)
      .where(
        and(
          eq(commissionPayouts.tenant, tenant),
          inArray(commissionPayouts.agentId, agentIds),
          gte(commissionPayouts.periodFrom, firstMonday),
          lt(commissionPayouts.periodFrom, endExclusive),
        ),
      )
      .groupBy(commissionPayouts.agentId, commissionPayouts.periodFrom);
    for (const r of rows) {
      if (!r.agentId || r.periodFrom == null) continue;
      const key = typeof r.periodFrom === 'string'
        ? r.periodFrom.slice(0, 10)
        : CommissionPayoutsRepo.toDateStringIST(r.periodFrom as unknown as Date);
      const n = Number(r.total ?? 0);
      if (!Number.isFinite(n)) continue;
      let byCycle = result.get(r.agentId);
      if (!byCycle) {
        byCycle = new Map();
        result.set(r.agentId, byCycle);
      }
      byCycle.set(key, (byCycle.get(key) ?? 0) + n);
    }
    return result;
  }

  /**
   * Whether a payout record exists for this agent+cycle (idempotency). COMMISSION-only.
   */
  async getPayoutForCycle(
    tenant: string,
    agentId: string,
    cycleFrom: Date,
    cycleTo: Date,
  ): Promise<CommissionPayout | null> {
    const fromStr = CommissionPayoutsRepo.toDateStringIST(cycleFrom);
    const toStr = CommissionPayoutsRepo.toDateStringIST(cycleTo);
    const [row] = await db
      .select()
      .from(commissionPayouts)
      .where(
        and(
          eq(commissionPayouts.tenant, tenant),
          eq(commissionPayouts.agentId, agentId),
          eq(commissionPayouts.periodFrom, fromStr),
          eq(commissionPayouts.periodTo, toStr),
        ),
      )
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  /** Last payout date (max createdAt) per agent; can be filtered before a cutoff date. */
  async getLastPayoutDateByAgentIds(
    tenant: string,
    agentIds: string[],
    options?: { beforeDate?: Date },
  ): Promise<Map<string, Date>> {
    if (agentIds.length === 0) return new Map();
    const conditions = [eq(commissionPayouts.tenant, tenant), inArray(commissionPayouts.agentId, agentIds)];
    if (options?.beforeDate) {
      conditions.push(lt(commissionPayouts.createdAt, options.beforeDate));
    }
    const rows = await db
      .select({
        agentId: commissionPayouts.agentId,
        lastAt: sql<Date>`MAX(${commissionPayouts.createdAt})`,
      })
      .from(commissionPayouts)
      .where(and(...conditions))
      .groupBy(commissionPayouts.agentId);
    const map = new Map<string, Date>();
    for (const r of rows) {
      if (!r.agentId || r.lastAt == null) continue;
      const d = r.lastAt instanceof Date ? r.lastAt : new Date(r.lastAt);
      if (!Number.isNaN(d.getTime())) map.set(r.agentId, d);
    }
    return map;
  }

  private static parsePeriod(value: unknown): Date | null {
    if (value == null) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string') {
      const d = new Date(value + (value.includes('T') ? '' : 'T00:00:00.000Z'));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private toRow(row: any): CommissionPayout {
    return {
      id: row.id,
      tenant: row.tenant,
      agentId: row.agentId,
      amount: Number(row.amount),
      periodFrom: CommissionPayoutsRepo.parsePeriod(row.periodFrom),
      periodTo: CommissionPayoutsRepo.parsePeriod(row.periodTo),
      turnover: row.turnover ? Number(row.turnover) : null,
      notes: row.notes,
      paidBy: row.paidBy,
      createdAt: row.createdAt,
    };
  }
}

