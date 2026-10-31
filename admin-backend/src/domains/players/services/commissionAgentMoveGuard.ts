/**
 * Per-user commission guard for movePlayerToAgent.
 *
 * Commission is computed from the players an agent has NOW (users.agent_id,
 * through the closure table), not from who owned a player when it bet. Moving a
 * player therefore re-attributes its past bets in every unpaid cycle:
 *
 *   - the source agent and its upline lose the player's GGR for those cycles;
 *   - the target agent and its upline gain it. If the old chain was already paid
 *     for those weeks, the same bets are then paid a second time to the new one.
 *
 * Agents above both the source and the target keep the player in their downline
 * and are not checked. The source and the target themselves are always checked,
 * even when one is an ancestor of the other (their own share still changes).
 *
 * So the move is blocked while any affected agent has an unpaid closed cycle,
 * or the open cycle, in which THIS player has settled bets. A player with no
 * bet activity in those cycles moves freely, whatever the agents' overall state.
 *
 * Zero-commission cycles. CommissionCycleService calls a closed cycle SETTLED
 * only when a payout above zero exists, and settlement refuses a zero payout,
 * so a week in which an agent earned nothing stayed "unsettled" forever and
 * blocked every later move of a player who bet in it. Here a zero cycle counts
 * as settled — unless the move itself could make it payable: removing a player
 * who won (GGR < 0) can lift the source chain above zero, and adding a player
 * who lost (GGR > 0) can lift the target chain above zero. "Zero" means nothing
 * payable in either settlement mode (gross, as an admin pays; net, as a parent
 * agent pays a child).
 *
 * Snapshot-level BLOCKED status on the source still blocks unconditionally (admin override).
 */

import { db } from '@/db/client.js';
import { agentHierarchyClosure } from '@shared/db/schema.js';
import { eq } from 'drizzle-orm';
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js';
import { CommissionPayoutsRepo } from '@/repos/settlements/CommissionPayoutsRepo.js';
import { CommissionCycleSnapshotsRepo } from '@/repos/settlements/CommissionCycleSnapshotsRepo.js';
import { CommissionCycleService } from '@src/domains/agents/services/CommissionCycleService.js';
import type { CommissionCycleInfo } from '@src/domains/agents/services/CommissionCycleService.js';

export interface CommissionAgentMoveGuardResult {
	blockers: string[];
	commissionCycleStatus: string | null;
	commissionCycleFrom: string | null;
	commissionCycleTo: string | null;
}

export interface PlayerCycleActivity {
	/** Settled bets across sports, casino (cash) and matka in the range. */
	settledCount: number;
	/** The house's GGR from those bets (positive when the player lost). */
	ggr: number;
}

/** Everything the guard reads, injectable so the rules can be tested without a database. */
export interface CommissionMoveGuardDeps {
	latestSnapshot(
		agentId: string,
		tenant: string,
	): Promise<{ status: string; cycleFrom: Date | null; cycleTo: Date | null } | null>;
	/** Cycles of a COMMISSION agent, oldest first; [] for any other agent. */
	listCycles(agentId: string, tenant: string): Promise<CommissionCycleInfo[]>;
	/** The agent and all of its ancestors (closure table). */
	chainOf(agentId: string): Promise<string[]>;
	playerActivity(tenant: string, playerId: number, from: Date, to: Date): Promise<PlayerCycleActivity>;
	/** Whether the agent has anything payable for the cycle, in either settlement mode. */
	hasPayableCommission(agentId: string, tenant: string, cycle: CommissionCycleInfo): Promise<boolean>;
}

/**
 * Settled-bet count and GGR for a player across sports, casino (cash wallet)
 * and matka within the given date range.
 */
async function getPlayerActivityInRange(
	tenant: string,
	playerId: number,
	from: Date,
	to: Date,
): Promise<PlayerCycleActivity> {
	const { getPlayerOverviewSettledAggregates: sportsSettled } = await import(
		'@/repos/sports/sportsBetsRepo.js'
	);
	const { getPlayerOverviewSettledAggregatesByWallet: casinoSettled } = await import(
		'@/repos/casino/casinoBetsRepo.js'
	);
	const { getPlayerOverviewSettledAggregates: matkaSettled } = await import(
		'@/repos/matka/matkaBetsRepo.js'
	);

	const [sports, casino, matka] = await Promise.all([
		sportsSettled(tenant, playerId, from, to),
		casinoSettled(tenant, playerId, from, to),
		matkaSettled(tenant, playerId, from, to),
	]);

	return {
		settledCount: (sports.settledCount ?? 0) + (casino.cash?.count ?? 0) + (matka.settledCount ?? 0),
		ggr: Number(sports.ggr ?? 0) + Number(casino.cash?.ggr ?? 0) + Number(matka.ggr ?? 0),
	};
}

function defaultDeps(): CommissionMoveGuardDeps {
	const agentsRepo = new AgentsRepo();
	const payoutsRepo = new CommissionPayoutsRepo();
	const cycleService = new CommissionCycleService(agentsRepo, payoutsRepo);
	const snapshotsRepo = new CommissionCycleSnapshotsRepo();
	return {
		latestSnapshot: (agentId, tenant) => snapshotsRepo.findLatestByAgentAndTenant(agentId, tenant),
		async listCycles(agentId, tenant) {
			const agent = await agentsRepo.findById(agentId);
			if (!agent || agent.schemeType !== 'COMMISSION') return [];
			return cycleService.listCyclesForAgent(agentId, tenant);
		},
		async chainOf(agentId) {
			const rows = await db
				.select({ ancestorId: agentHierarchyClosure.ancestorId })
				.from(agentHierarchyClosure)
				.where(eq(agentHierarchyClosure.descendantId, agentId));
			return Array.from(new Set([agentId, ...rows.map((r) => String(r.ancestorId))]));
		},
		playerActivity: getPlayerActivityInRange,
		async hasPayableCommission(agentId, tenant, cycle) {
			try {
				const { CommissionReadinessService } = await import(
					'@src/domains/agents/services/CommissionReadinessService.js'
				);
				const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
				const { AgentLedgerRepo } = await import('@/repos/agents/AgentLedgerRepo.js');
				const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
				const currency = await getWhitelabelCurrency(tenant).catch(() => 'INR');
				const readiness = new CommissionReadinessService(
					agentsRepo,
					new AgentConfigsRepo(),
					new AgentLedgerRepo(),
					payoutsRepo,
				);
				for (const mode of ['gross', 'net'] as const) {
					const r = await readiness.getReadiness(agentId, cycle.from, cycle.to, tenant, currency, mode);
					if (r.payableAmount > 0) return true;
				}
				return false;
			} catch {
				// Cannot tell: treat as payable, which keeps the move blocked.
				return true;
			}
		},
	};
}

type Side = 'source' | 'sourceUpline' | 'target' | 'targetUpline';

const SIDE_LABEL: Record<Side, string> = {
	source: 'source agent',
	sourceUpline: "source agent's upline",
	target: 'target agent',
	targetUpline: "target agent's upline",
};

/** Whether moving the player could turn a zero cycle into a payable one for this side. */
function moveCouldMakePayable(side: Side, ggr: number): boolean {
	const leaving = side === 'source' || side === 'sourceUpline';
	return leaving ? ggr < 0 : ggr > 0;
}

export async function evaluateCommissionAgentMoveGuard(
	sourceAgentId: string,
	tenant: string,
	playerId: number,
	targetAgentId?: string | null,
	deps: CommissionMoveGuardDeps = defaultDeps(),
): Promise<CommissionAgentMoveGuardResult> {
	const blockers: string[] = [];

	// Snapshot-level BLOCKED always blocks (admin override)
	const latestSnapshot = await deps.latestSnapshot(sourceAgentId, tenant);
	if (latestSnapshot?.status === 'BLOCKED') {
		blockers.push("Source agent's commission cycle is BLOCKED. Resolve the cycle before moving the player.");
	}

	// Which agents' commission the move re-attributes, and on which side.
	const sourceChain = await deps.chainOf(sourceAgentId);
	const targetChain = targetAgentId ? await deps.chainOf(targetAgentId) : [];
	const inSourceChain = new Set(sourceChain);
	const inTargetChain = new Set(targetChain);
	const affected: Array<{ agentId: string; side: Side }> = [{ agentId: sourceAgentId, side: 'source' }];
	if (targetAgentId && targetAgentId !== sourceAgentId) {
		affected.push({ agentId: targetAgentId, side: 'target' });
	}
	const seen = new Set(affected.map((a) => a.agentId));
	for (const id of sourceChain) {
		if (!seen.has(id) && !inTargetChain.has(id)) {
			affected.push({ agentId: id, side: 'sourceUpline' });
			seen.add(id);
		}
	}
	for (const id of targetChain) {
		if (!seen.has(id) && !inSourceChain.has(id)) {
			affected.push({ agentId: id, side: 'targetUpline' });
			seen.add(id);
		}
	}

	// Player activity per cycle range. Every COMMISSION agent shares the IST
	// Monday->Monday cycle, so one read per week serves all affected agents.
	const activityByRange = new Map<string, Promise<PlayerCycleActivity>>();
	const activityFor = (cycle: CommissionCycleInfo) => {
		const key = `${cycle.from.getTime()}-${cycle.to.getTime()}`;
		let p = activityByRange.get(key);
		if (!p) {
			p = deps.playerActivity(tenant, playerId, cycle.from, cycle.to);
			activityByRange.set(key, p);
		}
		return p;
	};

	const blockingClosed: Array<{ side: Side; cycle: CommissionCycleInfo }> = [];
	const blockingOpen: CommissionCycleInfo[] = [];
	let sourceCycles: CommissionCycleInfo[] = [];

	for (const { agentId, side } of affected) {
		const cycles = await deps.listCycles(agentId, tenant);
		if (side === 'source') sourceCycles = cycles;
		for (const cycle of cycles) {
			// CommissionCycleService reports a closed cycle that earned nothing as SETTLED with
			// zeroCommission (no payout row). It is settled only while it stays at zero: if the
			// move could make it payable it blocks like an unpaid cycle.
			const zeroSettled = cycle.status === 'SETTLED' && cycle.zeroCommission === true;
			if (cycle.status !== 'CLOSED_UNSETTLED' && cycle.status !== 'OPEN' && !zeroSettled) continue;
			const activity = await activityFor(cycle);
			if (activity.settledCount <= 0) continue;

			if (cycle.status === 'OPEN') {
				if (!blockingOpen.some((c) => c.from.getTime() === cycle.from.getTime())) blockingOpen.push(cycle);
				continue;
			}
			if (zeroSettled) {
				if (moveCouldMakePayable(side, activity.ggr)) blockingClosed.push({ side, cycle });
				continue;
			}

			// CLOSED_UNSETTLED with this player's bets in it. Settled in effect when
			// the agent earned nothing that week and the move cannot change that.
			if (!moveCouldMakePayable(side, activity.ggr)) {
				const payable = await deps.hasPayableCommission(agentId, tenant, cycle);
				if (!payable) continue;
			}
			blockingClosed.push({ side, cycle });
		}
	}

	const sourceClosed = blockingClosed.filter((b) => b.side === 'source');
	if (sourceClosed.length > 0) {
		blockers.push(
			`Player has generated commission in ${sourceClosed.length} unsettled cycle(s). Settle the agent's commission before moving.`,
		);
	}
	for (const side of ['target', 'targetUpline', 'sourceUpline'] as const) {
		const hits = blockingClosed.filter((b) => b.side === side);
		if (hits.length === 0) continue;
		const weeks = new Set(hits.map((h) => h.cycle.from.getTime())).size;
		blockers.push(
			`Player bet in ${weeks} unpaid closed commission cycle(s) of the ${SIDE_LABEL[side]}. ` +
				'Moving now would re-attribute those bets, so the same commission could be paid twice or lost. ' +
				'Settle those cycles before moving.',
		);
	}
	if (blockingOpen.length > 0) {
		blockers.push(
			'Player has bet activity in the current open commission cycle. Wait for the cycle to close and settle before moving.',
		);
	}

	// Determine summary status for the precheck UI
	let commissionCycleStatus: string | null = null;
	let commissionCycleFrom: string | null = null;
	let commissionCycleTo: string | null = null;

	const worst = blockingClosed[0]?.cycle ?? blockingOpen[0];
	if (worst) {
		commissionCycleStatus = worst.status;
		commissionCycleFrom = worst.from.toISOString();
		commissionCycleTo = worst.to.toISOString();
	} else if (latestSnapshot?.status === 'BLOCKED') {
		commissionCycleStatus = 'BLOCKED';
		commissionCycleFrom = latestSnapshot.cycleFrom?.toISOString() ?? null;
		commissionCycleTo = latestSnapshot.cycleTo?.toISOString() ?? null;
	} else {
		commissionCycleStatus = 'SETTLED';
		const last = sourceCycles[sourceCycles.length - 1];
		if (last) {
			commissionCycleFrom = last.from.toISOString();
			commissionCycleTo = last.to.toISOString();
		}
	}

	return { blockers, commissionCycleStatus, commissionCycleFrom, commissionCycleTo };
}
