/**
 * Commission cycle lock snapshots — COMMISSION agents only.
 * CREDIT/SHARING settlement flows do not use this repo.
 */

import { db } from '@/db/client.js';
import { commissionCycleSnapshots } from '@shared/db/schema.js';
import { and, eq, desc } from 'drizzle-orm';

export type CommissionCycleSnapshotStatus = 'OPEN' | 'CLOSED_UNSETTLED' | 'SETTLED' | 'BLOCKED';

export interface CommissionCycleSnapshotRow {
	id: string;
	tenantId: string;
	agentId: string;
	cycleFrom: Date;
	cycleTo: Date;
	calculatedTotal: number;
	postedTotal: number;
	paidTotal: number;
	payableAmount: number;
	status: CommissionCycleSnapshotStatus;
	meta: Record<string, unknown> | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface UpsertCommissionCycleSnapshotInput {
	tenantId: string;
	agentId: string;
	cycleFrom: Date;
	cycleTo: Date;
	calculatedTotal: number;
	postedTotal: number;
	paidTotal: number;
	payableAmount: number;
	status: CommissionCycleSnapshotStatus;
	meta?: Record<string, unknown> | null;
}

function toRow(r: any): CommissionCycleSnapshotRow {
	return {
		id: r.id,
		tenantId: r.tenantId,
		agentId: r.agentId,
		cycleFrom: r.cycleFrom,
		cycleTo: r.cycleTo,
		calculatedTotal: Number(r.calculatedTotal),
		postedTotal: Number(r.postedTotal),
		paidTotal: Number(r.paidTotal),
		payableAmount: Number(r.payableAmount),
		status: r.status as CommissionCycleSnapshotStatus,
		meta: r.meta ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

export class CommissionCycleSnapshotsRepo {
	async upsert(input: UpsertCommissionCycleSnapshotInput, tx: any = db): Promise<CommissionCycleSnapshotRow> {
		const now = new Date();
		const rows = await tx
			.insert(commissionCycleSnapshots)
			.values({
				tenantId: input.tenantId,
				agentId: input.agentId,
				cycleFrom: input.cycleFrom,
				cycleTo: input.cycleTo,
				calculatedTotal: String(input.calculatedTotal),
				postedTotal: String(input.postedTotal),
				paidTotal: String(input.paidTotal),
				payableAmount: String(Math.max(0, input.payableAmount)),
				status: input.status,
				meta: (input.meta ?? null) as any,
				updatedAt: now,
			} as any)
			.onConflictDoUpdate({
				target: [commissionCycleSnapshots.agentId, commissionCycleSnapshots.cycleFrom, commissionCycleSnapshots.cycleTo],
				set: {
					calculatedTotal: String(input.calculatedTotal),
					postedTotal: String(input.postedTotal),
					paidTotal: String(input.paidTotal),
					payableAmount: String(Math.max(0, input.payableAmount)),
					status: input.status,
					meta: (input.meta ?? null) as any,
					updatedAt: now,
				} as any,
			})
			.returning();
		const row = rows[0];
		if (!row) throw new Error('CommissionCycleSnapshotsRepo.upsert: no row returned');
		return toRow(row);
	}

	async getByAgentCycle(
		agentId: string,
		cycleFrom: Date,
		cycleTo: Date,
	): Promise<CommissionCycleSnapshotRow | null> {
		const [r] = await db
			.select()
			.from(commissionCycleSnapshots)
			.where(
				and(
					eq(commissionCycleSnapshots.agentId, agentId),
					eq(commissionCycleSnapshots.cycleFrom, cycleFrom),
					eq(commissionCycleSnapshots.cycleTo, cycleTo),
				),
			)
			.limit(1);
		return r ? toRow(r) : null;
	}

	async listByAgent(agentId: string, limit = 52): Promise<CommissionCycleSnapshotRow[]> {
		const rows = await db
			.select()
			.from(commissionCycleSnapshots)
			.where(eq(commissionCycleSnapshots.agentId, agentId))
			.orderBy(desc(commissionCycleSnapshots.cycleFrom))
			.limit(limit);
		return rows.map(toRow);
	}

	/** Latest snapshot row for an agent within a tenant (by cycle end). */
	async findLatestByAgentAndTenant(agentId: string, tenantId: string): Promise<CommissionCycleSnapshotRow | null> {
		const [r] = await db
			.select()
			.from(commissionCycleSnapshots)
			.where(
				and(
					eq(commissionCycleSnapshots.agentId, agentId),
					eq(commissionCycleSnapshots.tenantId, tenantId),
				),
			)
			.orderBy(desc(commissionCycleSnapshots.cycleTo))
			.limit(1);
		return r ? toRow(r) : null;
	}
}
