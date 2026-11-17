import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '../../../repos/agents/AgentSettlementsRepo';
import { CommissionService } from './CommissionService';
import { SharingService } from './SharingService';
import { CREDIT_MOVES_AS_CHIPS } from '@src/domains/settlements/schemeIsolation.js';

/**
 * Pure helper: sum only SHARE ledger lines.
 *
 * CR-16: SHARING/CREDIT settlement totals must be derived from SHARE lines ONLY.
 * Summing SETTLEMENT (and ADJUSTMENT) lines double-counts prior settlements on
 * re-settle, causing the agent to be paid/collected twice for the same period.
 */
export function sumShareLines(
	lines: Array<{ lineType?: string | null; amount: number | string }>,
): number {
	let total = 0;
	for (const l of lines) {
		if (l?.lineType !== 'SHARE') continue;
		const amt = Number(l.amount);
		if (Number.isFinite(amt)) total += amt;
	}
	return total;
}

export class SettlementService {
	constructor(
		private readonly agentsRepo: AgentsRepo,
		private readonly ledgerRepo: AgentLedgerRepo,
		private readonly settlementsRepo: AgentSettlementsRepo,
		private readonly commissionService: CommissionService,
		private readonly sharingService: SharingService
	) {}

	// Compute earnings for the period and create a settlement + credit wallet
	async settle(params: {
		agentId: string;
		from: Date;
		to: Date;
		currency: string;
		postedBy?: string | null;
		pubsub?: any;
	}) {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) throw new Error('Agent not found');

		// SHARING agents are settled only through the top-level settleAgent mutation
		// (executeSettleAgent → SharingSettlementEngine). This legacy path took the
		// window from the client, paid the whole window's share without the
		// remaining-amount cap, never funded a sub-agent's share from its parent and
		// left the next window to start wherever the client said. No UI calls it
		// (AgentsMutation.settleAgent is deprecated).
		if (agent.schemeType === 'SHARING') {
			throw new Error('SHARING agents are settled with the settleAgent mutation (Settlement Centre), not this legacy endpoint.');
		}
		// Nor is a CREDIT agent: since 2026-11-02 its chips move only by Deposit / Withdraw from its direct parent,
		// and settling it is a D/W of its Ref P/L (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
		// §6). The old CREDIT settle here posted its share and recomputed credit_used; both belong to the retired
		// credit-limit model.
		if (agent.schemeType === 'CREDIT') {
			throw new Error(CREDIT_MOVES_AS_CHIPS);
		}

		// CR-16 defense-in-depth: idempotency guard. Refuse to settle a period that an
		// existing POSTED settlement already overlaps. This protects any caller that still
		// reaches this legacy path (the deprecated AgentsMutation.settleAgent) from double-settle.
		const existingSettlements = await this.settlementsRepo.list(
			params.agentId,
			params.from,
			params.to,
		);
		const overlapping = existingSettlements.find((s: any) => {
			if (s.status !== 'POSTED') return false;
			if (!s.periodFrom || !s.periodTo) return false;
			const sFrom = s.periodFrom instanceof Date ? s.periodFrom : new Date(s.periodFrom);
			const sTo = s.periodTo instanceof Date ? s.periodTo : new Date(s.periodTo);
			// Overlap test (mirror executeSettleAgent): exact match OR ranges intersect.
			return (
				(params.from.getTime() === sFrom.getTime() && params.to.getTime() === sTo.getTime()) ||
				(params.from < sTo && params.to > sFrom)
			);
		});
		if (overlapping) {
			throw new Error(
				`A settlement already exists for this period or overlaps with it (period ${overlapping.periodFrom} to ${overlapping.periodTo}).`,
			);
		}

		// COMMISSION lines are accrued only by the daily scheduler.
		// Settlement must only read existing ledger lines and post payout.
		// (SHARING and CREDIT were refused above.)

		// CR-16: Sum SHARE lines ONLY. Including SETTLEMENT/ADJUSTMENT lines double-counts
		// prior settlements on re-settle and corrupts the payout total.
		const lines = await this.ledgerRepo.list(params.agentId, params.from, params.to);
		const total = sumShareLines(lines);

		// Wrap settlement operations in transaction for atomicity
		// This ensures: open, post, and creditWallet all succeed or all fail
		const { db } = await import('@src/db/client.js');
		let settlement: any = null;
		try {
			await db.transaction(async (tx) => {
				settlement = await this.settlementsRepo.open({
					agentId: params.agentId,
					periodFrom: params.from,
					periodTo: params.to,
					totalAmount: total,
					currency: params.currency,
				}, tx);

				// Post settlement and credit wallet (all within transaction)
				await this.settlementsRepo.post({ settlementId: settlement.id, postedBy: params.postedBy ?? null }, tx);
				await this.settlementsRepo.creditWallet(params.agentId, params.currency, total, tx);
			});
		} catch (error: any) {
			// CR-16: unique-violation on (agent_id, period_from, period_to) means another
			// concurrent settle already covered this period. Treat as already-settled.
			const code = error?.code ?? error?.constraint;
			if (
				code === '23505' ||
				(typeof code === 'string' && code.includes('agent_settlements_agent_period_open_key'))
			) {
				throw new Error('A settlement already exists for this period.');
			}
			// Transaction failed - throw error (all operations rolled back)
			throw new Error(error?.message || 'Failed to complete settlement. All operations rolled back.');
		}

		return settlement;
	}
}

