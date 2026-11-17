import {
	domainBreakdownItems,
	sharingDirection,
	type SharingAgentLike,
	type SharingDirection,
	type SharingSettlementEngine,
	type SharingWindowState,
} from '../../agents/services/SharingSettlementEngine';

/**
 * The SHARING fields of a pending-settlement row (PendingSettlement /
 * EnhancedPendingSettlement), from the settlement engine.
 *
 * Sign convention — the same as the SHARE / SETTLEMENT lines the settle mutation
 * posts: positive = TO_AGENT (players lost; you pay the agent its share),
 * negative = FROM_AGENT (players won; the agent pays you its share of the loss).
 * `settlementDirection` states it explicitly.
 *
 * `periodFrom` / `periodTo` are the exact window the figures cover; passing
 * `periodTo` back to settleAgent settles exactly that window, so the posted
 * amount equals `pendingAmount`.
 */
export interface SharingPendingFields {
	pendingAmount: number;
	settlementDirection: SharingDirection;
	periodFrom: string;
	periodTo: string;
	settledThisPeriod: number;
	totalShareForPeriod: number;
	settlementBreakdownByDomain: ReturnType<typeof domainBreakdownItems>;
	state: SharingWindowState;
}

export async function sharingPendingFields(
	engine: SharingSettlementEngine,
	agent: SharingAgentLike,
	now?: Date
): Promise<SharingPendingFields> {
	const state = await engine.pending(agent, { now });
	return {
		pendingAmount: state.remaining,
		settlementDirection: state.direction,
		periodFrom: state.periodFrom.toISOString(),
		periodTo: state.periodTo.toISOString(),
		settledThisPeriod: state.settled,
		totalShareForPeriod: state.shareTotal,
		settlementBreakdownByDomain: domainBreakdownItems(state.fresh, state.plan.shareByDomain),
		state,
	};
}

export { sharingDirection };
