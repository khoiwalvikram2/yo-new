import { DateTime } from 'luxon';
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js';
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js';
import type { AgentLedgerRepo } from '@/repos/agents/AgentLedgerRepo.js';
import { AgentSettlementsRepo } from '@/repos/agents/AgentSettlementsRepo.js';

// Re-export for backward compatibility
export { getWhitelabelTimezone };

/**
 * Get the Monday-to-Monday period that contains the given date
 * @param date - Date to find period for
 * @param timezone - Timezone string (e.g., 'Asia/Kolkata')
 * @returns Object with from (Monday 00:00:00) and to (next Monday 00:00:00)
 */
export function getMondayToMondayPeriod(date: Date, timezone: string): { from: Date; to: Date } {
	const dt = DateTime.fromJSDate(date, { zone: timezone });

	// Find the Monday of the week containing this date
	// Monday is day 1 in Luxon (Sunday is 7)
	let monday: DateTime;
	if (dt.weekday === 1) {
		// Already Monday, use this date
		monday = dt;
	} else if (dt.weekday === 7) {
		// If it's Sunday, go to next Monday
		monday = dt.plus({ days: 1 });
	} else {
		// If it's Tuesday-Saturday, go back to Monday
		// weekday 2 = Tuesday, so go back (weekday - 1) days
		monday = dt.minus({ days: dt.weekday - 1 });
	}

	// Set to Monday 00:00:00 in the timezone
	const periodFrom = monday.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

	// Next Monday 00:00:00
	const periodTo = periodFrom.plus({ weeks: 1 });

	return {
		from: periodFrom.toJSDate(),
		to: periodTo.toJSDate(),
	};
}

/**
 * Get current active settlement period (Monday to Monday)
 * @param whitelabelId - Whitelabel ID
 * @returns Current period dates
 */
export async function getCurrentSettlementPeriod(whitelabelId: string): Promise<{ from: Date; to: Date }> {
	const timezone = await getWhitelabelTimezone(whitelabelId);
	const now = new Date();
	return getMondayToMondayPeriod(now, timezone);
}

/**
 * Validate that a period is Monday-to-Monday
 * @param from - Period start date
 * @param to - Period end date
 * @param timezone - Timezone string
 * @returns Object with isValid flag and error message if invalid
 */
export function validateSettlementPeriod(
	from: Date,
	to: Date,
	timezone: string
): { isValid: boolean; error?: string } {
	const fromDt = DateTime.fromJSDate(from, { zone: timezone });
	const toDt = DateTime.fromJSDate(to, { zone: timezone });

	// Check if from is Monday
	if (fromDt.weekday !== 1) {
		return {
			isValid: false,
			error: `Period start date must be a Monday. Got: ${fromDt.toFormat('EEEE')}`,
		};
	}

	// Check if from is at 00:00:00
	if (fromDt.hour !== 0 || fromDt.minute !== 0 || fromDt.second !== 0) {
		return {
			isValid: false,
			error: 'Period start date must be at 00:00:00 (start of day)',
		};
	}

	// Check if to is next Monday
	const expectedTo = fromDt.plus({ weeks: 1 });
	if (!toDt.hasSame(expectedTo, 'day') || !toDt.hasSame(expectedTo, 'month') || !toDt.hasSame(expectedTo, 'year')) {
		return {
			isValid: false,
			error: `Period end date must be exactly one week after start date (next Monday). Expected: ${expectedTo.toISO()}, Got: ${toDt.toISO()}`,
		};
	}

	// Check if to is at 00:00:00
	if (toDt.hour !== 0 || toDt.minute !== 0 || toDt.second !== 0) {
		return {
			isValid: false,
			error: 'Period end date must be at 00:00:00 (start of day)',
		};
	}

	return { isValid: true };
}

/**
 * The SHARING settlement window that is open at `now`, half-open [periodFrom, periodTo).
 *
 * - periodTo is `now` — the instant the settlement is made — not the end of the
 *   day. With an end-of-day periodTo, a settlement at 14:00 closed the window
 *   at 23:59:59.999 having counted bets only up to 14:00, and the next window
 *   started at midnight: the bets of 14:00-24:00 fell into neither.
 * - No settlement yet: the window starts at the agent's creation day (00:00 in
 *   the whitelabel's zone; W1 back-dates the first rate row to that instant).
 * - The last settlement left something owed (`lastWindowRemaining`, signed
 *   share − settled, is not zero): the window is NOT advanced — it starts at the
 *   last window's start again and is extended to `now`.
 * - Otherwise the next window starts at exactly the instant the last one ended,
 *   so there is no gap and, with the half-open ledger reads, no overlap.
 *
 * The settlement engine then ends the window earlier when a bet of the agent's
 * players is still open (SharingSettlementEngine.openWindow / capWindowAtOpenBet):
 * GGR counts settled bets by creation time, so the window must stop before the
 * earliest open bet for that bet to be shared once it settles.
 */
export function nextSharingWindow(params: {
	last: { periodFrom: Date; periodTo: Date } | null;
	agentCreatedAt: Date;
	whitelabelTimezone: string;
	now: Date;
	/** share − settled (signed) of the last settled window; null/undefined = fully settled */
	lastWindowRemaining?: number | null;
}): { periodFrom: Date; periodTo: Date; extendsPartial: boolean } {
	const nowMs = params.now.getTime();
	let periodFrom: Date;
	let extendsPartial = false;
	if (!params.last) {
		periodFrom = DateTime.fromJSDate(params.agentCreatedAt, { zone: params.whitelabelTimezone }).startOf('day').toJSDate();
	} else if (params.lastWindowRemaining != null && Number.isFinite(params.lastWindowRemaining) && Math.abs(params.lastWindowRemaining) >= 0.005) {
		periodFrom = new Date(params.last.periodFrom.getTime());
		extendsPartial = true;
	} else {
		periodFrom = new Date(params.last.periodTo.getTime());
	}
	// A window never ends before it starts (an empty window has no share).
	const periodTo = new Date(Math.max(nowMs, periodFrom.getTime()));
	return { periodFrom, periodTo, extendsPartial };
}

/**
 * Derive "since last settlement" period for SHARING agents.
 * When the last settlement left something owed (share − settled ≠ 0, signed), we do not advance the period so the agent stays in the pending list with the remaining amount.
 * Otherwise periodFrom = last POSTED settlement's periodTo. periodTo = now (see nextSharingWindow).
 *
 * The settlement engine (SharingSettlementEngine) derives its window with the
 * same nextSharingWindow; this wrapper is kept for callers that pass their own
 * share function.
 */
export async function deriveSinceLastPeriod(params: {
	agentId: string;
	agentCreatedAt: Date;
	whitelabelTimezone: string;
	/** When provided with getTotalShareForPeriod, we do not advance the period if the last settlement was partial */
	ledgerRepo?: AgentLedgerRepo;
	getTotalShareForPeriod?: (agentId: string, periodFrom: Date, periodTo: Date) => Promise<number>;
	/** The instant the window ends; defaults to the current time. */
	now?: Date;
}): Promise<{ periodFrom: Date; periodTo: Date }> {
	const settlementsRepo = new AgentSettlementsRepo();
	const last = await settlementsRepo.getLastPostedSettlement(params.agentId);
	const now = params.now ?? new Date();

	let lastWindow: { periodFrom: Date; periodTo: Date } | null = null;
	let lastWindowRemaining: number | null = null;
	if (last) {
		const lastFrom = last.periodFrom instanceof Date ? last.periodFrom : new Date(last.periodFrom);
		const lastTo = last.periodTo instanceof Date ? last.periodTo : new Date(last.periodTo);
		lastWindow = { periodFrom: lastFrom, periodTo: lastTo };
		// If we can check for partial: don't advance period when last period is not fully settled.
		// sumSettlementLinesInPeriod returns the NEGATED sum of SETTLEMENT amounts, so
		// share − settled = totalShare + sumSettled. Signed, so an over-payment in the
		// other direction also keeps the window open.
		if (params.ledgerRepo && params.getTotalShareForPeriod) {
			const sumSettled = await params.ledgerRepo.sumSettlementLinesInPeriod(params.agentId, lastFrom, lastTo);
			const totalShare = await params.getTotalShareForPeriod(params.agentId, lastFrom, lastTo);
			const remaining = Number(totalShare) + Number(sumSettled);
			lastWindowRemaining = Number.isFinite(remaining) ? remaining : null;
		}
	}

	// Periods are half-open [periodFrom, periodTo): the next one starts at exactly
	// the instant the last one ended. Ledger reads (AgentLedgerRepo.list,
	// sumSettlementLinesInPeriod) use the same half-open rule, so the last period's
	// SHARE and SETTLEMENT lines, which end at this instant, are not counted again.
	const { periodFrom, periodTo } = nextSharingWindow({
		last: lastWindow,
		agentCreatedAt: params.agentCreatedAt,
		whitelabelTimezone: params.whitelabelTimezone,
		now,
		lastWindowRemaining,
	});
	return { periodFrom, periodTo };
}

/**
 * Get all pending (unsettled) settlement periods for an agent
 * @param agentId - Agent ID
 * @returns Array of pending periods with from/to dates
 */
export async function getPendingSettlementPeriods(agentId: string): Promise<Array<{ from: Date; to: Date }>> {
	const agentsRepo = new AgentsRepo();
	const settlementsRepo = new AgentSettlementsRepo();

	const agent = await agentsRepo.findById(agentId);
	if (!agent) {
		throw new Error('Agent not found');
	}

	const timezone = await getWhitelabelTimezone(agent.tenantId);

	// Get all settlements for this agent
	const allSettlements = await settlementsRepo.list(agentId, new Date(0), new Date());

	// Get settled periods (POSTED status)
	const settledPeriods = new Set<string>();
	allSettlements
		.filter((s) => s.status === 'POSTED')
		.forEach((s) => {
			if (s.periodFrom && s.periodTo) {
				const from = s.periodFrom instanceof Date ? s.periodFrom : new Date(s.periodFrom);
				const key = `${from.getTime()}-${s.periodTo instanceof Date ? s.periodTo.getTime() : new Date(s.periodTo).getTime()}`;
				settledPeriods.add(key);
			}
		});

	// Generate all possible Monday-to-Monday periods from agent creation to now
	const pendingPeriods: Array<{ from: Date; to: Date }> = [];
	const agentCreatedAt = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
	const now = new Date();

	// Start from the Monday of the week when agent was created
	let currentPeriod = getMondayToMondayPeriod(agentCreatedAt, timezone);

	// If agent was created after the start of current period, start from that period
	if (agentCreatedAt > currentPeriod.from) {
		currentPeriod = getMondayToMondayPeriod(agentCreatedAt, timezone);
	}

	// Generate periods up to current period
	while (currentPeriod.from < now) {
		const periodKey = `${currentPeriod.from.getTime()}-${currentPeriod.to.getTime()}`;
		if (!settledPeriods.has(periodKey)) {
			pendingPeriods.push({ ...currentPeriod });
		}
		// Move to next period
		currentPeriod = {
			from: currentPeriod.to,
			to: new Date(currentPeriod.to.getTime() + 7 * 24 * 60 * 60 * 1000),
		};
	}

	// Sort by date (oldest first)
	return pendingPeriods.sort((a, b) => a.from.getTime() - b.from.getTime());
}
