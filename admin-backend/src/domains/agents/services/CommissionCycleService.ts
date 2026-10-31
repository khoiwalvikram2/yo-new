/**
 * Commission cycle status and list — IST Monday->Monday, COMMISSION agents only.
 * CREDIT and SHARING flows must not use this service.
 *
 * A closed cycle is SETTLED when it has a payout, or when nothing is payable for
 * it (GROSS after tally rules plus applied adjustments rounds to 0). Before, only
 * a payout above zero settled a cycle and a zero payout is impossible, so every
 * week in which an agent earned nothing stayed CLOSED_UNSETTLED forever — it
 * cluttered the pay lists and blocked player moves. Such a cycle carries
 * `zeroCommission: true` so a caller that cares (the player-move guard) can tell
 * it from a paid one.
 */

import { AgentsRepo } from '@/repos/agents/AgentsRepo.js';
import { CommissionPayoutsRepo } from '@/repos/settlements/CommissionPayoutsRepo.js';
import {
	getCurrentCycleIST,
	isCurrentCycleIST,
	type CycleBounds,
} from './CommissionCycleUtils.js';
import type { CommissionCalculationService } from './CommissionCalculationService.js';
import { roundPayable } from './commissionCycleMath.js';

export type CommissionCycleStatus = 'OPEN' | 'CLOSED_UNSETTLED' | 'SETTLED' | 'BLOCKED';

export interface CommissionCycleInfo {
	from: Date;
	to: Date;
	status: CommissionCycleStatus;
	/** Still payable for the cycle (0 once paid or when nothing is owed; null while OPEN). */
	payableAmount?: number | null;
	paidAmount?: number;
	/** The cycle's GROSS after tally rules (running total while OPEN). */
	calculatedTotal?: number;
	/** Applied adjustments targeting the cycle. */
	adjustmentAmount?: number;
	/** SETTLED with no payout because nothing was payable. */
	zeroCommission?: boolean;
	/** Loss carried in from the previous cycle, the part taken off calculatedTotal, and this cycle's own loss that carries on (spec §3). */
	carriedLoss?: number;
	carryApplied?: number;
	lossThisCycle?: number;
}

export class CommissionCycleService {
	constructor(
		private agentsRepo: AgentsRepo,
		private payoutsRepo: CommissionPayoutsRepo,
		private calc?: CommissionCalculationService,
	) {}

	private async calcService(): Promise<CommissionCalculationService> {
		if (!this.calc) {
			const [{ CommissionCalculationService }, { AgentConfigsRepo }, { AgentLedgerRepo }, { HybridGGRReader }] = await Promise.all([
				import('./CommissionCalculationService.js'),
				import('@/repos/agents/AgentConfigsRepo.js'),
				import('@/repos/agents/AgentLedgerRepo.js'),
				import('./HybridGGRReader.js'),
			]);
			this.calc = new CommissionCalculationService(
				this.agentsRepo,
				new AgentConfigsRepo(),
				new AgentLedgerRepo(),
				new HybridGGRReader(),
				this.payoutsRepo,
			);
		}
		return this.calc;
	}

	/** Amounts here never depend on the currency; it only labels the summary. */
	private static readonly CURRENCY_LABEL = '';

	/**
	 * Get status for one IST cycle. Call only for COMMISSION agents. The total read
	 * here is the gross after the loss carried from the previous cycle (spec §3).
	 */
	async getCycleStatus(
		agentId: string,
		cycleFrom: Date,
		cycleTo: Date,
		tenant: string,
	): Promise<CommissionCycleStatus> {
		if (isCurrentCycleIST(cycleFrom, cycleTo)) return 'OPEN';
		const paid = await this.payoutsRepo.getTotalPaidForCycle(tenant, agentId, cycleFrom, cycleTo);
		if (paid > 0) return 'SETTLED';
		const calc = await this.calcService();
		const summary = await calc.calculateCommissionSummary(agentId, cycleFrom, cycleTo, CommissionCycleService.CURRENCY_LABEL, 'gross');
		const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
		const adjustment = await new CommissionAdjustmentsRepo().sumAppliedForCycle(tenant, agentId, cycleFrom, cycleTo);
		return roundPayable(summary.effectiveCalculatedTotal + adjustment) === 0 ? 'SETTLED' : 'CLOSED_UNSETTLED';
	}

	/**
	 * List IST Monday->Monday cycles for a COMMISSION agent from creation to now.
	 * Oldest first, each with its status, payable, paid and gross.
	 */
	async listCyclesForAgent(agentId: string, tenant: string): Promise<CommissionCycleInfo[]> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) throw new Error('Agent not found');
		if (agent.schemeType !== 'COMMISSION') {
			throw new Error('CommissionCycleService is for COMMISSION agents only');
		}
		const calc = await this.calcService();
		const current = getCurrentCycleIST();
		const rows = await calc.listCyclePayables(agentId, tenant, CommissionCycleService.CURRENCY_LABEL, current.from);
		return rows.map((r) => {
			if (isCurrentCycleIST(r.from, r.to)) {
				return {
					from: r.from,
					to: r.to,
					status: 'OPEN' as const,
					payableAmount: null,
					paidAmount: r.paid,
					calculatedTotal: r.calculatedTotal,
					adjustmentAmount: r.adjustment,
					zeroCommission: false,
					carriedLoss: r.carriedLoss,
					carryApplied: r.carryApplied,
					lossThisCycle: r.lossThisCycle,
				};
			}
			const settledByPayout = r.paid > 0;
			const zero = !settledByPayout && r.payable === 0;
			return {
				from: r.from,
				to: r.to,
				status: settledByPayout || zero ? ('SETTLED' as const) : ('CLOSED_UNSETTLED' as const),
				payableAmount: r.payable,
				paidAmount: r.paid,
				calculatedTotal: r.calculatedTotal,
				adjustmentAmount: r.adjustment,
				zeroCommission: zero,
				carriedLoss: r.carriedLoss,
				carryApplied: r.carryApplied,
				lossThisCycle: r.lossThisCycle,
			};
		});
	}

	/**
	 * Current IST cycle bounds (open week).
	 */
	getCurrentCycle(): CycleBounds {
		return getCurrentCycleIST();
	}
}
