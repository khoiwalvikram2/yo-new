import { db } from '@/db/client';
import { playerCreditAdjustments } from '@shared/db/schema.js';
import { and, eq, desc, gte, lte } from 'drizzle-orm';

export interface CreatePlayerCreditAdjustmentInput {
  tenant: string;
  playerId: number;
  adjustmentType: 'INCREASE' | 'DECREASE' | 'LIMIT_CHANGE';
  amount: number;
  previousLimit?: number;
  newLimit?: number;
  previousUsed?: number;
  newUsed?: number;
  notes?: string;
  adjustedBy?: string;
  balanceBefore?: number;
  balanceAfter?: number;
}

export interface PlayerCreditAdjustment {
  id: string;
  tenant: string;
  playerId: number;
  adjustmentType: 'INCREASE' | 'DECREASE' | 'LIMIT_CHANGE';
  amount: number;
  previousLimit?: number | null;
  newLimit?: number | null;
  previousUsed?: number | null;
  newUsed?: number | null;
  notes?: string | null;
  adjustedBy?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  createdAt: Date;
}

export class PlayerCreditAdjustmentsRepo {
  async create(input: CreatePlayerCreditAdjustmentInput): Promise<PlayerCreditAdjustment> {
    const [row] = await db
      .insert(playerCreditAdjustments)
      .values({
        tenant: input.tenant,
        playerId: input.playerId,
        adjustmentType: input.adjustmentType,
        amount: String(input.amount),
        previousLimit: input.previousLimit != null ? String(input.previousLimit) : null,
        newLimit: input.newLimit != null ? String(input.newLimit) : null,
        previousUsed: input.previousUsed != null ? String(input.previousUsed) : null,
        newUsed: input.newUsed != null ? String(input.newUsed) : null,
        notes: input.notes || null,
        adjustedBy: input.adjustedBy || null,
        balanceBefore: input.balanceBefore != null ? String(input.balanceBefore) : null,
        balanceAfter: input.balanceAfter != null ? String(input.balanceAfter) : null,
      })
      .returning();

    return this.toRow(row);
  }

  async list(params: {
    tenant: string;
    playerId?: number;
    limit?: number;
    offset?: number;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<PlayerCreditAdjustment[]> {
    const conditions = [eq(playerCreditAdjustments.tenant, params.tenant)];
    
    if (params.playerId) {
      conditions.push(eq(playerCreditAdjustments.playerId, params.playerId));
    }
    
    if (params.fromDate) {
      conditions.push(gte(playerCreditAdjustments.createdAt, params.fromDate));
    }
    
    if (params.toDate) {
      conditions.push(lte(playerCreditAdjustments.createdAt, params.toDate));
    }

    let query = db
      .select()
      .from(playerCreditAdjustments)
      .where(and(...conditions))
      .orderBy(desc(playerCreditAdjustments.createdAt));

    if (params.limit) {
      query = query.limit(params.limit) as any;
    }
    
    if (params.offset) {
      query = query.offset(params.offset) as any;
    }

    const rows = await query;
    return rows.map(row => this.toRow(row));
  }

  async getById(id: string, tenant: string): Promise<PlayerCreditAdjustment | null> {
    const [row] = await db
      .select()
      .from(playerCreditAdjustments)
      .where(and(eq(playerCreditAdjustments.id, id), eq(playerCreditAdjustments.tenant, tenant)))
      .limit(1);

    return row ? this.toRow(row) : null;
  }

  private toRow(row: any): PlayerCreditAdjustment {
    return {
      id: row.id,
      tenant: row.tenant,
      playerId: row.playerId,
      adjustmentType: row.adjustmentType,
      amount: Number(row.amount),
      previousLimit: row.previousLimit ? Number(row.previousLimit) : null,
      newLimit: row.newLimit ? Number(row.newLimit) : null,
      previousUsed: row.previousUsed ? Number(row.previousUsed) : null,
      newUsed: row.newUsed ? Number(row.newUsed) : null,
      notes: row.notes,
      adjustedBy: row.adjustedBy,
      balanceBefore: row.balanceBefore ? Number(row.balanceBefore) : null,
      balanceAfter: row.balanceAfter ? Number(row.balanceAfter) : null,
      createdAt: row.createdAt,
    };
  }
}

