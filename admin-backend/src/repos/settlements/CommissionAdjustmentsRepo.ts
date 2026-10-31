/**
 * Commission adjustments (post-close). COMMISSION-only; CREDIT/SHARING untouched.
 */

import { db } from '@/db/client.js';
import { commissionAdjustments } from '@shared/db/schema.js';
import { and, eq, desc, gte, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';

const IST = 'Asia/Kolkata';

/**
 * An adjustment's lifecycle. PENDING blocks its source cycle's payout
 * (readiness UNRESOLVED_ADJUSTMENT) until it is APPLIED to a target cycle,
 * whose payable it then moves, or CANCELLED. CANCELLED is final and nothing
 * counts it: every read below names the one status it counts, never "not X".
 */
export const COMMISSION_ADJUSTMENT_STATUS = {
	PENDING: 'PENDING',
	APPLIED: 'APPLIED',
	CANCELLED: 'CANCELLED',
} as const;

export interface ApplyAdjustmentInput {
	targetCycleFrom: Date;
	targetCycleTo: Date;
}

export interface CommissionAdjustmentRow {
	id: string;
	tenantId: string;
	agentId: string;
	amount: number;
	sourceCycleFrom: Date;
	sourceCycleTo: Date;
	targetCycleFrom: Date | null;
	targetCycleTo: Date | null;
	reason: string;
	refMeta: Record<string, unknown> | null;
	status: string;
	createdAt: Date;
	appliedAt: Date | null;
}

export interface CreateCommissionAdjustmentInput {
	tenantId: string;
	agentId: string;
	amount: number;
	sourceCycleFrom: Date;
	sourceCycleTo: Date;
	reason: string;
	refMeta?: Record<string, unknown> | null;
}

function toRow(r: any): CommissionAdjustmentRow {
	return {
		id: r.id,
		tenantId: r.tenantId,
		agentId: r.agentId,
		amount: Number(r.amount),
		sourceCycleFrom: r.sourceCycleFrom,
		sourceCycleTo: r.sourceCycleTo,
		targetCycleFrom: r.targetCycleFrom ?? null,
		targetCycleTo: r.targetCycleTo ?? null,
		reason: r.reason,
		refMeta: r.refMeta ?? null,
		status: r.status,
		createdAt: r.createdAt,
		appliedAt: r.appliedAt ?? null,
	};
}

export class CommissionAdjustmentsRepo {
	async create(input: CreateCommissionAdjustmentInput): Promise<CommissionAdjustmentRow> {
		const [row] = await db
			.insert(commissionAdjustments)
			.values({
				tenantId: input.tenantId,
				agentId: input.agentId,
				amount: String(input.amount),
				sourceCycleFrom: input.sourceCycleFrom,
				sourceCycleTo: input.sourceCycleTo,
				reason: input.reason,
				refMeta: (input.refMeta ?? null) as any,
			} as any)
			.returning();
		return toRow(row);
	}

	async getById(id: string, tenantId: string): Promise<CommissionAdjustmentRow | null> {
		const [row] = await db
			.select()
			.from(commissionAdjustments)
			.where(and(eq(commissionAdjustments.id, id), eq(commissionAdjustments.tenantId, tenantId)))
			.limit(1);
		return row ? toRow(row) : null;
	}

	/**
	 * PENDING -> APPLIED. Conditional on PENDING: an adjustment cancelled (or
	 * applied) since it was read is left alone and this returns null.
	 */
	async apply(id: string, tenantId: string, input: ApplyAdjustmentInput): Promise<CommissionAdjustmentRow | null> {
		const now = new Date();
		const [row] = await db
			.update(commissionAdjustments)
			.set({
				targetCycleFrom: input.targetCycleFrom,
				targetCycleTo: input.targetCycleTo,
				status: COMMISSION_ADJUSTMENT_STATUS.APPLIED,
				appliedAt: now,
			} as any)
			.where(
				and(
					eq(commissionAdjustments.id, id),
					eq(commissionAdjustments.tenantId, tenantId),
					eq(commissionAdjustments.status, COMMISSION_ADJUSTMENT_STATUS.PENDING),
				),
			)
			.returning();
		return row ? toRow(row) : null;
	}

	/**
	 * PENDING -> CANCELLED. Conditional on PENDING, so an adjustment applied in
	 * the meantime stays APPLIED and this returns null. Who cancelled it and why
	 * is in the audit row; the table has no column for it.
	 */
	async cancel(id: string, tenantId: string): Promise<CommissionAdjustmentRow | null> {
		const [row] = await db
			.update(commissionAdjustments)
			.set({ status: COMMISSION_ADJUSTMENT_STATUS.CANCELLED })
			.where(
				and(
					eq(commissionAdjustments.id, id),
					eq(commissionAdjustments.tenantId, tenantId),
					eq(commissionAdjustments.status, COMMISSION_ADJUSTMENT_STATUS.PENDING),
				),
			)
			.returning();
		return row ? toRow(row) : null;
	}

	/** One agent's adjustments in one tenant, newest first. Every status, CANCELLED included. */
	async countByAgent(tenantId: string, agentId: string): Promise<number> {
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(commissionAdjustments)
      .where(and(eq(commissionAdjustments.tenantId, tenantId), eq(commissionAdjustments.agentId, agentId)));
    return row.total;
  }

	async listByAgent(tenantId: string, agentId: string, limit = 100, offset = 0): Promise<CommissionAdjustmentRow[]> {
		const rows = await db
			.select()
			.from(commissionAdjustments)
			.where(and(eq(commissionAdjustments.tenantId, tenantId), eq(commissionAdjustments.agentId, agentId)))
			.orderBy(desc(commissionAdjustments.createdAt), desc(commissionAdjustments.id))
			.limit(Math.min(500, Math.max(1, limit))).offset(Math.max(0, offset));
		return rows.map(toRow);
	}

	async sumAppliedForCycle(
		tenantId: string,
		agentId: string,
		targetCycleFrom: Date,
		targetCycleTo: Date,
	): Promise<number> {
		const rows = await db
			.select({ amount: commissionAdjustments.amount })
			.from(commissionAdjustments)
			.where(
				and(
					eq(commissionAdjustments.tenantId, tenantId),
					eq(commissionAdjustments.agentId, agentId),
					eq(commissionAdjustments.targetCycleFrom, targetCycleFrom),
					eq(commissionAdjustments.targetCycleTo, targetCycleTo),
					eq(commissionAdjustments.status, COMMISSION_ADJUSTMENT_STATUS.APPLIED),
				),
			);
		return rows.reduce((s, r) => s + Number(r.amount), 0);
	}

	/**
	 * APPLIED adjustments per target cycle (IST Monday, YYYY-MM-DD) for target
	 * cycles that start in [from's cycle Monday, to).
	 */
	async sumAppliedByTargetCycle(
		tenantId: string,
		agentId: string,
		from: Date,
		to: Date,
	): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		if (!(to.getTime() > from.getTime())) return out;
		const fromIst = DateTime.fromJSDate(from, { zone: IST });
		const firstMonday = fromIst.minus({ days: fromIst.weekday - 1 }).startOf('day').toJSDate();
		const rows = await db
			.select({ amount: commissionAdjustments.amount, targetCycleFrom: commissionAdjustments.targetCycleFrom })
			.from(commissionAdjustments)
			.where(
				and(
					eq(commissionAdjustments.tenantId, tenantId),
					eq(commissionAdjustments.agentId, agentId),
					eq(commissionAdjustments.status, COMMISSION_ADJUSTMENT_STATUS.APPLIED),
					gte(commissionAdjustments.targetCycleFrom, firstMonday),
					lt(commissionAdjustments.targetCycleFrom, to),
				),
			);
		for (const r of rows) {
			if (!r.targetCycleFrom) continue;
			const d = r.targetCycleFrom instanceof Date ? r.targetCycleFrom : new Date(r.targetCycleFrom as any);
			const key = DateTime.fromJSDate(d, { zone: IST }).toFormat('yyyy-MM-dd');
			const n = Number(r.amount);
			if (Number.isFinite(n)) out.set(key, (out.get(key) ?? 0) + n);
		}
		return out;
	}

	/**
	 * Adjustments raised against this cycle (source cycle) that are still PENDING —
	 * not applied to any cycle yet. While one exists the cycle's figure is known to
	 * be wrong, so readiness reports UNRESOLVED_ADJUSTMENT and payment waits.
	 */
	async countPendingForSourceCycle(
		tenantId: string,
		agentId: string,
		sourceCycleFrom: Date,
		sourceCycleTo: Date,
	): Promise<number> {
		const [r] = await db
			.select({ n: sql<number>`COUNT(*)::int` })
			.from(commissionAdjustments)
			.where(
				and(
					eq(commissionAdjustments.tenantId, tenantId),
					eq(commissionAdjustments.agentId, agentId),
					eq(commissionAdjustments.sourceCycleFrom, sourceCycleFrom),
					eq(commissionAdjustments.sourceCycleTo, sourceCycleTo),
					eq(commissionAdjustments.status, COMMISSION_ADJUSTMENT_STATUS.PENDING),
				),
			);
		const n = Number(r?.n ?? 0);
		return Number.isFinite(n) ? n : 0;
	}
}
