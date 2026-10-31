/**
 * Pure field rules of the agents commission / settlement summary resolvers
 * (agents/resolvers/queries.ts), kept here so they can be tested without a
 * database. W10, agent-schemes hardening.
 */
import type { CommissionSummary } from '../services/CommissionCalculationService';
import { sharingDirection, type SharingDirection } from '../services/SharingSettlementEngine';

type Maybe = number | null;

/**
 * The GROSS and NET fields of CommissionSummary (agents.graphql), whatever mode
 * the main figures were computed in.
 *
 * - gross*: what the agent's payer owes it (rate x subtree GGR, cycle by cycle),
 *   raw and after tally (grossEffective*). This is what a parent pays the agent,
 *   so it is the agent's "Receivable", not GGR x one rate (wrong across weeks
 *   whose rates differ).
 * - netEffective*: "My Share", grossEffective minus what the agent owes its
 *   direct children (each child's grossEffective). `net` is the net-mode summary
 *   when the main one is gross; when the main one is net its effective* are
 *   already the net ones.
 */
export function commissionSummaryGrossNetFields(
	summary: CommissionSummary,
	mode: 'net' | 'gross',
	net?: CommissionSummary | null
): {
	grossSportsCommission: Maybe;
	grossCasinoCommission: Maybe;
	grossMatkaCommission: Maybe;
	grossEffectiveSportsCommission: Maybe;
	grossEffectiveCasinoCommission: Maybe;
	grossEffectiveMatkaCommission: Maybe;
	grossEffectiveCalculatedTotal: Maybe;
	netEffectiveSportsCommission: Maybe;
	netEffectiveCasinoCommission: Maybe;
	netEffectiveMatkaCommission: Maybe;
	netEffectiveCalculatedTotal: Maybe;
} {
	const n = (v: number | null | undefined): Maybe => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
	const netSource = mode === 'net' ? summary : net ?? null;
	return {
		grossSportsCommission: n(summary.grossSportsCommission),
		grossCasinoCommission: n(summary.grossCasinoCommission),
		grossMatkaCommission: n(summary.grossMatkaCommission),
		grossEffectiveSportsCommission: n(summary.grossEffectiveSportsCommission),
		grossEffectiveCasinoCommission: n(summary.grossEffectiveCasinoCommission),
		grossEffectiveMatkaCommission: n(summary.grossEffectiveMatkaCommission),
		grossEffectiveCalculatedTotal: n(summary.grossEffectiveCalculatedTotal),
		netEffectiveSportsCommission: netSource ? n(netSource.effectiveSportsCommission) : null,
		netEffectiveCasinoCommission: netSource ? n(netSource.effectiveCasinoCommission) : null,
		netEffectiveMatkaCommission: netSource ? n(netSource.effectiveMatkaCommission) : null,
		netEffectiveCalculatedTotal: n(summary.netEffectiveCalculatedTotal ?? netSource?.effectiveCalculatedTotal),
	};
}

/**
 * The loss carry-forward fields of CommissionSummary (agents.graphql, spec §3):
 * the loss carried into the range's weeks, the part taken off the gross, and the
 * latest week's own loss that carries into the next week. The agent's own figures
 * whatever the caller's mode. Null when missing, never NaN.
 */
export function commissionSummaryCarryFields(summary: CommissionSummary): {
	carriedLoss: Maybe;
	carryApplied: Maybe;
	lossThisCycle: Maybe;
} {
	const n = (v: number | null | undefined): Maybe => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
	return {
		carriedLoss: n(summary.carriedLoss),
		carryApplied: n(summary.carryApplied),
		lossThisCycle: n(summary.lossThisCycle),
	};
}

/**
 * Which commission figures a commissionHistory caller sees.
 *
 * An agent reading its OWN history sees its net (its own share of each bet).
 * Anyone reading ANOTHER agent's history — a parent opening a child's bets from
 * the Pay dialog, or an admin — sees that agent's GROSS (rate x its whole
 * subtree), which is what is paid to it, so the bet count and amounts match the
 * payable. (A parent used to get the child's net: the child's own players only.)
 */
export function commissionHistoryMode(caller: { type?: string | null; agentId?: string | null } | null | undefined, targetAgentId: string): 'net' | 'gross' {
	const isAgentCaller = caller?.type === 'agent' && !!caller?.agentId;
	return isAgentCaller && caller?.agentId === targetAgentId ? 'net' : 'gross';
}

/**
 * agents.settlementSummary.settlementDirection, with the SHARING sign
 * convention of the settlement engine: positive settlementDue = TO_AGENT (the
 * agent is paid), negative = FROM_AGENT (the agent pays), ~0 = NONE.
 */
export function settlementSummaryDirection(summary: { settlementDue: number; settlementDirection?: SharingDirection | null }): SharingDirection {
	if (summary.settlementDirection === 'TO_AGENT' || summary.settlementDirection === 'FROM_AGENT') return summary.settlementDirection;
	return sharingDirection(Number(summary.settlementDue));
}

/**
 * One settlementSummary.settlementBreakdownByDomain row, with the meanings the
 * settlement engine's breakdown uses (domainBreakdownItems):
 *   amount     = the players' P/L for the domain (−GGR; negative = players lost);
 *   agentShare = the agent's share (positive = the agent earns);
 *   cutAmount  = the rest of the GGR, |GGR| − |share| (never negative);
 *   shareRate  = the rate in percent; cutPercentage = 100 − shareRate.
 */
export function settlementBreakdownItem(domain: 'sports' | 'casino' | 'matka', params: { pl: number; share: number; sharePct: number; totalAbsPl: number }) {
	const round2 = (v: number) => Math.round(v * 100) / 100;
	const pl = Number(params.pl) || 0;
	const share = Number(params.share) || 0;
	const sharePct = Number(params.sharePct) || 0;
	return {
		domain,
		amount: pl,
		percentage: params.totalAbsPl > 0 ? (Math.abs(pl) / params.totalAbsPl) * 100 : 0,
		shareRate: sharePct,
		agentShare: share,
		cutAmount: round2(Math.max(0, Math.abs(pl) - Math.abs(share))),
		cutPercentage: 100 - sharePct,
	};
}
