/**
 * Commission cycle readiness gate — COMMISSION agents only.
 * Determines if a closed cycle is ready for settlement (full-cycle payout).
 *
 * The payable is always the agent's GROSS for the cycle (what its payer owes it:
 * the platform for a root agent, the parent for a sub-agent), tally rules
 * applied, plus applied adjustments, minus what was already paid. The `mode`
 * argument is kept for callers but no longer changes the payable: paying a
 * sub-agent its NET (its own share after its children) left the parent short by
 * exactly what the sub-agent owes its own children.
 *
 * Blocking reasons:
 *   NOT_CLOSED            the cycle is the current open week (or not a valid cycle);
 *   MISSING_BETS          bets placed in the cycle by the agent's players are still
 *                         open. GGR is read by bet creation time, so a cycle paid now
 *                         would never include them. Also while the PREVIOUS cycle has
 *                         open bets (from CARRY_FORWARD_FROM on): its loss carries
 *                         into this cycle, so the carry is not final until they settle;
 *   UNRESOLVED_ADJUSTMENT an adjustment raised against this cycle is still PENDING.
 * Informational: LEDGER_GAP (the gross BEFORE the carried loss differs from the
 * posted ledger lines: accrual posts the per-domain gross; the carry is one
 * payout-time line, spec §3).
 * Terminal markers: READY, ZERO_PAYABLE_NET.
 */

import { AgentsRepo } from '@/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '@/repos/agents/AgentConfigsRepo.js';
import { AgentLedgerRepo } from '@/repos/agents/AgentLedgerRepo.js';
import { CommissionPayoutsRepo } from '@/repos/settlements/CommissionPayoutsRepo.js';
import { CommissionAdjustmentsRepo } from '@/repos/settlements/CommissionAdjustmentsRepo.js';
import { CommissionCalculationService, type CommissionCalculationOptions } from './CommissionCalculationService.js';
import { HybridGGRReader } from './HybridGGRReader.js';
import type { VerticalReaders } from './VerticalReaders.js';
import { isCurrentCycleIST, lossCarriesForward, validateCycleIST } from './CommissionCycleUtils.js';
import { cycleBoundsFromKey, cycleKeyIST, previousCycleKey, roundPayable } from './commissionCycleMath.js';

export const READINESS_TOLERANCE = 0.01;

export type ReadinessReason =
	| 'NOT_CLOSED'
	| 'LEDGER_GAP'
	| 'MISSING_BETS'
	| 'UNRESOLVED_ADJUSTMENT'
	| 'ZERO_PAYABLE_NET'
	| 'READY';

export interface CommissionCycleReadiness {
	ready: boolean;
	reasons: ReadinessReason[];
	calculatedTotal: number;
	postedTotal: number;
	paidInCycle: number;
	payableAmount: number;
	currency: string;
	/** Bets placed in the cycle by the agent's players that are still open. */
	openBets: number;
	/** PENDING adjustments raised against the cycle. */
	unresolvedAdjustments: number;
	/**
	 * Bets placed in the PREVIOUS cycle by the agent's players that are still open
	 * (MISSING_BETS). That cycle's loss carries into this one. Always 0 when the
	 * previous cycle starts before CARRY_FORWARD_FROM.
	 */
	previousCycleOpenBets: number;
	/** Loss carried into the cycle from the one before. */
	carriedLoss: number;
	/** The part of carriedLoss taken off the cycle's gross (calculatedTotal is after it). */
	carryApplied: number;
}

/** What readiness reads besides the repos (injectable for tests). */
export interface CommissionReadinessDeps extends CommissionCalculationOptions {
	ggrReaders?: VerticalReaders;
	adjustments?: Pick<CommissionAdjustmentsRepo, 'sumAppliedForCycle' | 'countPendingForSourceCycle' | 'sumAppliedByTargetCycle'>;
}

export class CommissionReadinessService {
	constructor(
		private agentsRepo: AgentsRepo,
		private configsRepo: AgentConfigsRepo,
		private ledgerRepo: AgentLedgerRepo,
		private payoutsRepo: CommissionPayoutsRepo,
		private deps: CommissionReadinessDeps = {},
	) {}

	async getReadiness(
		agentId: string,
		cycleFrom: Date,
		cycleTo: Date,
		tenant: string,
		currency: string,
		_mode: 'net' | 'gross' = 'gross',
	): Promise<CommissionCycleReadiness> {
		const reasons: ReadinessReason[] = [];
		const validation = validateCycleIST(cycleFrom, cycleTo);
		if (!validation.isValid) {
			return {
				ready: false,
				reasons: ['NOT_CLOSED'],
				calculatedTotal: 0,
				postedTotal: 0,
				paidInCycle: 0,
				payableAmount: 0,
				currency,
				openBets: 0,
				unresolvedAdjustments: 0,
				previousCycleOpenBets: 0,
				carriedLoss: 0,
				carryApplied: 0,
			};
		}
		if (isCurrentCycleIST(cycleFrom, cycleTo)) {
			reasons.push('NOT_CLOSED');
		}

		const adjustmentsRepo = this.deps.adjustments ?? new CommissionAdjustmentsRepo();
		const commissionCalc = new CommissionCalculationService(
			this.agentsRepo,
			this.configsRepo,
			this.ledgerRepo,
			this.deps.ggrReaders ?? new HybridGGRReader(),
			this.payoutsRepo,
			{ rateRowsLoader: this.deps.rateRowsLoader, adjustmentsReader: adjustmentsRepo },
		);
		// The previous cycle's loss carries into this one (one week), so its open bets
		// keep this cycle's carry provisional. Only from CARRY_FORWARD_FROM on.
		const previousFrom = cycleBoundsFromKey(previousCycleKey(cycleKeyIST(cycleFrom))).from;
		const [summary, postedTotal, paidInCycle, adjustmentDelta, openBets, unresolvedAdjustments, previousCycleOpenBets] = await Promise.all([
			commissionCalc.calculateCommissionSummary(agentId, cycleFrom, cycleTo, currency, 'gross'),
			this.ledgerRepo.getEarnedPostedSum(agentId, { from: cycleFrom, to: cycleTo, currency }),
			this.payoutsRepo.getTotalPaidForCycle(tenant, agentId, cycleFrom, cycleTo),
			adjustmentsRepo.sumAppliedForCycle(tenant, agentId, cycleFrom, cycleTo),
			commissionCalc.countOpenBetsInRange(agentId, cycleFrom, cycleTo),
			adjustmentsRepo.countPendingForSourceCycle(tenant, agentId, cycleFrom, cycleTo),
			lossCarriesForward(previousFrom)
				? commissionCalc.countOpenBetsInRange(agentId, previousFrom, cycleFrom)
				: Promise.resolve(0),
		]);
		// The gross after the loss carried from the previous cycle: what is paid.
		const calculatedTotal = summary.effectiveCalculatedTotal;
		const carriedLoss = summary.carriedLoss ?? 0;
		const carryApplied = summary.carryApplied ?? 0;

		if (openBets > 0 || previousCycleOpenBets > 0) reasons.push('MISSING_BETS');
		if (unresolvedAdjustments > 0) reasons.push('UNRESOLVED_ADJUSTMENT');
		// Accrual posts the per-domain gross BEFORE the carried loss (the carry is one
		// payout-time line, not a domain earning), so the ledger is compared with that.
		// Any difference is a real gap (a cycle not accrued yet, or lines posted under
		// the old net/snapshot rules). Informational.
		if (Math.abs(calculatedTotal + carryApplied - postedTotal) > READINESS_TOLERANCE) {
			reasons.push('LEDGER_GAP');
		}
		// One payout per cycle (unique index): once paid, nothing more is payable.
		const payableAmount = paidInCycle > 0 ? 0 : roundPayable(calculatedTotal + adjustmentDelta);

		const blockingReasons = reasons.filter(r => r !== 'LEDGER_GAP');
		if (blockingReasons.length === 0) {
			if (payableAmount === 0 && calculatedTotal + adjustmentDelta <= 0) {
				reasons.push('ZERO_PAYABLE_NET');
			} else {
				reasons.push('READY');
			}
		}

		const isReady = reasons.includes('READY');
		return {
			ready: isReady,
			reasons,
			calculatedTotal,
			postedTotal,
			paidInCycle,
			payableAmount,
			currency,
			openBets,
			unresolvedAdjustments,
			previousCycleOpenBets,
			carriedLoss,
			carryApplied,
		};
	}
}
