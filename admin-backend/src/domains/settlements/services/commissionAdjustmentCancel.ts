/**
 * Cancelling a commission adjustment (agent features 2026-10-22, section 2;
 * owner decision 3: admins create, apply and cancel adjustments).
 *
 * Only a PENDING adjustment can be cancelled. An APPLIED one has already moved
 * a cycle's payable (and may be paid); a CANCELLED one is final. The repo's
 * cancel is a conditional update (WHERE status = 'PENDING'), so an apply that
 * lands between the read and the write leaves the row APPLIED and the caller
 * gets a refusal instead of a flipped row.
 *
 * Who cancelled it, when and why go in the audit row
 * ('commission_adjustment_cancel'); the table has no column for them.
 *
 * The repo and the audit writer are injected, so these rules are unit tested
 * without a database.
 */
import {
	COMMISSION_ADJUSTMENT_STATUS,
	type CommissionAdjustmentRow,
} from '@/repos/settlements/CommissionAdjustmentsRepo.js';

/** Longest cancel reason kept in the audit row. */
export const CANCEL_REASON_MAX = 500;

export interface CommissionAdjustmentAuditEntry {
	tenant: string;
	actorId: string;
	domain: string;
	action: string;
	resourceType: string;
	resourceId: string;
	before: Record<string, unknown>;
	after: Record<string, unknown>;
}

export interface CancelAdjustmentDeps {
	repo: {
		getById(id: string, tenantId: string): Promise<CommissionAdjustmentRow | null>;
		cancel(id: string, tenantId: string): Promise<CommissionAdjustmentRow | null>;
	};
	audit(entry: CommissionAdjustmentAuditEntry): Promise<void>;
}

/** The GraphQL CommissionAdjustment shape (dates as ISO strings). */
export interface CommissionAdjustmentGql {
	id: string;
	agentId: string;
	amount: number;
	sourceCycleFrom: string;
	sourceCycleTo: string;
	targetCycleFrom: string | null;
	targetCycleTo: string | null;
	reason: string;
	status: string;
	createdAt: string;
	appliedAt: string | null;
}

export interface CancelCommissionAdjustmentPayload {
	success: boolean;
	message: string;
	adjustment: CommissionAdjustmentGql | null;
}

export function adjustmentToGql(row: CommissionAdjustmentRow): CommissionAdjustmentGql {
	return {
		id: row.id,
		agentId: row.agentId,
		amount: row.amount,
		sourceCycleFrom: row.sourceCycleFrom.toISOString(),
		sourceCycleTo: row.sourceCycleTo.toISOString(),
		targetCycleFrom: row.targetCycleFrom?.toISOString() ?? null,
		targetCycleTo: row.targetCycleTo?.toISOString() ?? null,
		reason: row.reason,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		appliedAt: row.appliedAt?.toISOString() ?? null,
	};
}

function refused(message: string): CancelCommissionAdjustmentPayload {
	return { success: false, message, adjustment: null };
}

/** PENDING -> CANCELLED for an adjustment of `scope.tenant`, with its audit row. */
export async function cancelPendingAdjustment(
	input: { adjustmentId?: string | null; reason?: string | null },
	scope: { tenant: string; actorId: string },
	deps: CancelAdjustmentDeps,
): Promise<CancelCommissionAdjustmentPayload> {
	const id = typeof input.adjustmentId === 'string' ? input.adjustmentId.trim() : '';
	if (!id) return refused('Missing adjustmentId');
	const reason =
		typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, CANCEL_REASON_MAX) : null;

	// getById is tenant-filtered: another whitelabel's adjustment is "not found".
	const existing = await deps.repo.getById(id, scope.tenant);
	if (!existing) return refused('Adjustment not found');
	if (existing.status !== COMMISSION_ADJUSTMENT_STATUS.PENDING) {
		return refused(`Only a PENDING adjustment can be cancelled (this one is ${existing.status})`);
	}
	const cancelled = await deps.repo.cancel(id, scope.tenant);
	if (!cancelled) return refused('Adjustment is no longer PENDING; reload and try again');

	try {
		await deps.audit({
			tenant: scope.tenant,
			actorId: scope.actorId,
			domain: 'settlements',
			action: 'commission_adjustment_cancel',
			resourceType: 'commission_adjustment',
			resourceId: cancelled.id,
			before: {
				status: existing.status,
				agentId: existing.agentId,
				amount: existing.amount,
				sourceCycleFrom: existing.sourceCycleFrom.toISOString(),
				sourceCycleTo: existing.sourceCycleTo.toISOString(),
				reason: existing.reason,
			},
			after: { status: cancelled.status, cancelReason: reason },
		});
	} catch {
		// As for create and apply: a failed audit write never undoes the change.
	}
	return { success: true, message: 'Adjustment cancelled', adjustment: adjustmentToGql(cancelled) };
}
