import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '../../../repos/agents/AgentSettlementsRepo';
import { AgentPlayerCreditsRepo } from '../../../repos/agents/AgentPlayerCreditsRepo';
import { CommissionService } from './CommissionService';
import { SharingService } from './SharingService';
import { db } from '../../../db/client';
import { users, wallets } from '@shared/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

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
		private readonly sharingService: SharingService,
		private readonly playerCreditsRepo?: AgentPlayerCreditsRepo
	) {
		if (!this.playerCreditsRepo) {
			this.playerCreditsRepo = new AgentPlayerCreditsRepo();
		}
	}

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
		// (AgentsMutation.settleAgent is deprecated; settleSharingAgent is CREDIT-only).
		if (agent.schemeType === 'SHARING') {
			throw new Error('SHARING agents are settled with the settleAgent mutation (Settlement Centre), not this legacy endpoint.');
		}

		// CR-16 defense-in-depth: idempotency guard. Refuse to settle a period that an
		// existing POSTED settlement already overlaps. This protects any caller that still
		// reaches this legacy path (e.g. settleAgent/settleSharingAgent) from double-settle.
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
		// (SHARING was refused above.)
		if (agent.schemeType === 'CREDIT') {
			await this.sharingService.computeAndPost({
				agentId: params.agentId,
				from: params.from,
				to: params.to,
				currency: params.currency,
				pubsub: params.pubsub,
			});
		}

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

		// Release credit on settlement (for CREDIT agents only)
		if (agent.schemeType === 'CREDIT') {
			await this.releaseCreditOnSettlement(params.agentId, params.from, params.to);
		}

		return settlement;
	}

	/**
	 * Release credit on settlement - clear settled bet exposure from credit used
	 */
	async releaseCreditOnSettlement(
		agentId: string,
		_periodFrom: Date,
		_periodTo: Date
	): Promise<void> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent || agent.schemeType !== 'CREDIT') {
			return; // Only for CREDIT agents
		}
		// A settlement does not close open bets, so a player's credit_used (= open sports book
		// exposure + open casino stake) is recomputed from the bets still open, under the player's
		// row lock — never set to 0, which let a player bet past its limit. The agent's credit_used
		// is the credit it has handed down (child agents' limits + direct players' limits), not
		// player exposure; both come from CreditCalculationRepo (credit model, plan W7).
		const { CreditCalculationRepo } = await import('../../../repos/agents/CreditCalculationRepo');
		const creditCalculation = new CreditCalculationRepo(this.agentsRepo);
		const playerCredits = await this.playerCreditsRepo!.listAgentPlayers(agentId);
		const tenant = String(agent.tenantId || 'default');
		for (const playerCredit of playerCredits) {
			await creditCalculation.applyRecalculationForPlayer(Number(playerCredit.playerId), tenant);
		}
		await creditCalculation.applyRecalculationForAgent(agentId);
	}

	/**
	 * Generate detailed settlement report
	 */
	async generateSettlementReport(params: {
		agentId: string;
		periodFrom: Date;
		periodTo: Date;
	}): Promise<{
		playerWise: Array<{
			playerId: number;
			playerName: string;
			balance: number;
			exposure: number;
			creditUsed: number;
		}>;
		domainWise: Array<{
			domain: string;
			totalAmount: number;
		}>;
		totalSettlement: number;
	}> {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		// Get ledger lines for the period
		const ledgerLines = await this.ledgerRepo.list(
			params.agentId,
			params.periodFrom,
			params.periodTo
		);

		// Get player credits
		const playerCredits = await this.playerCreditsRepo!.listAgentPlayers(params.agentId);

		// Player-wise breakdown
		const playerWise = playerCredits.map((pc) => ({
			playerId: pc.playerId,
			playerName: pc.playerName,
			balance: pc.currentBalance,
			exposure: pc.openExposure,
			creditUsed: pc.creditUsed,
		}));

		// Domain-wise breakdown
		const domainMap = new Map<string, number>();
		for (const line of ledgerLines) {
			const current = domainMap.get(line.domain) || 0;
			domainMap.set(line.domain, current + Number(line.amount));
		}

		const domainWise = Array.from(domainMap.entries()).map(([domain, totalAmount]) => ({
			domain,
			totalAmount,
		}));

		const totalSettlement = ledgerLines.reduce((sum, line) => sum + Number(line.amount), 0);

		return {
			playerWise,
			domainWise,
			totalSettlement,
		};
	}
}

