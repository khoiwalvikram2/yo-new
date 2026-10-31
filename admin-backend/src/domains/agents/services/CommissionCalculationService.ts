import { db } from '@/db/client.js';
import { and, desc, eq, gte, inArray, notInArray, lt, sql } from 'drizzle-orm';
import { sportsBets, casinoBets, matkaBets, users, agentCredentials, agentCommissionConfig } from '@shared/db/schema';
import { sportsTable, sportsLeaguesTable, sportsEventsTable, sportsMarketsTable, sportsRunnersTable } from '@shared/db/schema.js';
import { AgentsRepo } from '@/repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '@/repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '@/repos/agents/AgentLedgerRepo';
import type { CommissionPayoutsRepo } from '@/repos/settlements/CommissionPayoutsRepo.js';
import type { VerticalReaders } from './VerticalReaders';
import { type EffectiveSettlementResult } from './commissionTallyRules.js';
import {
	COMMISSION_DOMAINS,
	addAmounts,
	carryLookbackWindow,
	computeCycleCommission,
	cycleBoundsFromKey,
	cycleKeyIST,
	cycleKeysInRange,
	cycleLosses,
	nextCycleKey,
	noLosses,
	previousCycleKey,
	ratesAt,
	resolveCommissionRate,
	roundPayable,
	totalOf,
	withCarriedLosses,
	zeroAmounts,
	type CommissionDomain,
	type CommissionRateRow,
	type CycleCommissionInput,
	type CycleLosses,
	type DomainAmounts,
} from './commissionCycleMath.js';
import { CARRY_FORWARD_FROM, lossCarriesForward } from './CommissionCycleUtils.js';
import {
	attributedAgentId,
	istCycleKeySql,
	referralAttributions,
	referralAttributionJoinOn,
	referrerJoinOn,
	referrerUsers,
} from './commissionPlayerScope.js';

/** Result of applying tally rules to raw per-domain commission (for settlement/pending). */
export type { EffectiveSettlementResult } from './commissionTallyRules.js';

/** Loads agent_commission_config rows for a set of agents (injectable for tests). */
export type CommissionRateRowsLoader = (agentIds: string[]) => Promise<CommissionRateRow[]>;

/** The default loader: every commission config row of the given agents, one query. */
export const loadCommissionRateRows: CommissionRateRowsLoader = async (agentIds) => {
	if (agentIds.length === 0) return [];
	const rows = await db
		.select({
			agentId: agentCommissionConfig.agentId,
			domain: agentCommissionConfig.domain,
			commissionRate: agentCommissionConfig.commissionRate,
			effectiveFrom: agentCommissionConfig.effectiveFrom,
			effectiveTo: agentCommissionConfig.effectiveTo,
		})
		.from(agentCommissionConfig)
		.where(inArray(agentCommissionConfig.agentId, agentIds));
	return rows as CommissionRateRow[];
};

/** Reads applied adjustments per target cycle (CommissionAdjustmentsRepo; injectable for tests). */
export interface CommissionAdjustmentsReader {
	sumAppliedByTargetCycle(tenantId: string, agentId: string, from: Date, to: Date): Promise<Map<string, number>>;
}

export interface CommissionCalculationOptions {
	rateRowsLoader?: CommissionRateRowsLoader;
	adjustmentsReader?: CommissionAdjustmentsReader;
}

/** One IST cycle (or the part of it inside the requested range) of a summary. */
export interface CommissionCycleBreakdown {
	/** IST Monday, YYYY-MM-DD. */
	cycleKey: string;
	cycleFrom: Date;
	cycleTo: Date;
	/** Subtree GGR, all domains. */
	ggr: number;
	/** The cycle's gross after tally rules, BEFORE the loss carried from the previous cycle. */
	grossBeforeCarry: number;
	/**
	 * What the agent's payer owes it for the cycle: the gross after tally rules
	 * minus the loss carried from the previous cycle, never below 0 (spec §3).
	 */
	grossEffective: number;
	/** The agent's own share: grossEffective minus what it owes its direct children (their grossEffective, after their own carry). */
	netEffective: number;
	/** Loss carried in from the previous cycle (0 when none, or the previous cycle starts before CARRY_FORWARD_FROM). */
	carriedLoss: number;
	/** The part of carriedLoss taken off this cycle's gross; the rest is forgiven. */
	carryApplied: number;
	/** What the floor removed from this cycle's gross; it carries into the next cycle (0 before CARRY_FORWARD_FROM). */
	lossThisCycle: number;
	/** The agent's own rates at the cycle start. */
	rates: DomainAmounts;
}

export interface CommissionSummary {
	agentId: string;
	periodFrom: Date;
	periodTo: Date;
	totalCommission: number;
	sportsCommission: number;
	casinoCommission: number;
	matkaCommission: number;
	commissionRate: number;
	totalGGR: number;
	currency: string;
	sportsGGR: number;
	casinoGGR: number;
	matkaGGR: number;
	directSportsGGR?: number;
	directCasinoGGR?: number;
	directMatkaGGR?: number;
	sportsCommissionRate: number;
	casinoCommissionRate: number;
	matkaCommissionRate: number;
	/** Settlement/pending use these when tally rules apply. */
	effectiveCalculatedTotal: number;
	effectiveSportsCommission: number;
	effectiveCasinoCommission: number;
	effectiveMatkaCommission: number;
	/**
	 * GROSS whatever the mode: what the agent's payer owes it (rate x subtree GGR,
	 * per cycle). Raw per domain, and effective (tally rules applied per cycle).
	 */
	grossSportsCommission?: number;
	grossCasinoCommission?: number;
	grossMatkaCommission?: number;
	grossEffectiveSportsCommission?: number;
	grossEffectiveCasinoCommission?: number;
	grossEffectiveMatkaCommission?: number;
	grossEffectiveCalculatedTotal?: number;
	/** NET (My Share) whatever the mode: gross minus what the agent owes its direct children. */
	netEffectiveCalculatedTotal?: number;
	/**
	 * Loss carry-forward (one week, approach A, spec §3). The totals above
	 * (effectiveCalculatedTotal, grossEffectiveCalculatedTotal,
	 * netEffectiveCalculatedTotal) are AFTER the carry; the per-domain figures are
	 * before it (the carry is one line, not spread over domains).
	 * carriedLoss / carryApplied: summed over the range's cycles.
	 * lossThisCycle: the loss of the cycle holding the range's last instant (up to
	 * now), which carries into the next cycle.
	 */
	carriedLoss?: number;
	carryApplied?: number;
	lossThisCycle?: number;
	/** Per IST cycle, oldest first. Only cycles with bets in the range appear. */
	cycles?: CommissionCycleBreakdown[];
}

export interface CommissionHistoryEntry {
	id: string;
	date: Date;
	playerId: string;
	playerName: string;
	domain: 'sports' | 'casino' | 'matka';
	betAmount: number;
	ggr: number;
	commissionRate: number;
	commissionEarned: number;
	currency: string;
	status: string;
	// Sports-specific
	eventName?: string | null;
	marketName?: string | null;
	selectionName?: string | null;
	side?: string | null;
	odds?: number | null;
	liability?: number | null;
	// Casino-specific
	gameName?: string | null;
	vendorName?: string | null;
	payout?: number | null;
	winAmount?: number | null;
	// Matka-specific
	matkaType?: string | null;
	bidType?: string | null;
	betNumbers?: string | null;
	payoutMultiplier?: number | null;
	potentialWin?: number | null;
	actualWin?: number | null;
	marketSession?: string | null;
}

/** Per-domain audit action for commission backfill reporting */
export type AccrualDomainAction = 'inserted' | 'skipped';

/** Unified commission read model: single source for all commission surfaces */
export interface UnifiedCommissionRead {
	calculatedTotal: number;
	earnedPosted: number;
	paid: number;
	pending: number;
}

const DOMAINS: ('sports' | 'casino' | 'matka')[] = ['sports', 'casino', 'matka'];

/** Owner key for the agent's own players in a cycle breakdown. */
const SELF = '__self__';

interface CycleGgr {
	direct: DomainAmounts;
	byChild: Map<string, DomainAmounts>;
}

/** The read-only agent fields the commission engine actually consumes. */
export type CommissionAgentRecord = Pick<NonNullable<Awaited<ReturnType<AgentsRepo['findById']>>>,
  'id' | 'tenantId' | 'schemeType' | 'tallyEnabled' | 'tallyDomains' | 'createdAt' | 'username'>;
export interface CommissionAgentsReader {
  findById(id: string): Promise<CommissionAgentRecord | null>;
  listChildren(parentAgentId: string): Promise<CommissionAgentRecord[]>;
  getDescendantIds(ancestorId: string): Promise<string[]>;
}

export class CommissionCalculationService {
	private readonly rateRowsLoader: CommissionRateRowsLoader;
	private adjustmentsReader?: CommissionAdjustmentsReader;

	constructor(
		private agentsRepo: CommissionAgentsReader,
		private configsRepo: AgentConfigsRepo,
		private ledgerRepo: AgentLedgerRepo,
		private ggrReaders: VerticalReaders,
		private commissionPayoutsRepo?: CommissionPayoutsRepo,
		options?: CommissionCalculationOptions,
	) {
		this.rateRowsLoader = options?.rateRowsLoader ?? loadCommissionRateRows;
		this.adjustmentsReader = options?.adjustmentsReader;
	}

	private async getAdjustmentsReader(): Promise<CommissionAdjustmentsReader> {
		if (!this.adjustmentsReader) {
			const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
			this.adjustmentsReader = new CommissionAdjustmentsRepo();
		}
		return this.adjustmentsReader;
	}

	/**
	 * Apply tally rules for settlement: tally OFF => each domain contributes max(0, raw);
	 * tally ON => selected domains form one net (signed sum), contribution = max(0, groupNet); others max(0, raw).
	 */
	private applyTallyRules(
		sportsCommission: number,
		casinoCommission: number,
		matkaCommission: number,
		tallyEnabled: boolean,
		tallyDomains: string[] | null | undefined
	): EffectiveSettlementResult {
		const raw: Record<'sports' | 'casino' | 'matka', number> = {
			sports: sportsCommission,
			casino: casinoCommission,
			matka: matkaCommission,
		};
		const talliedSet = new Set(
			(tallyDomains ?? []).filter((d): d is 'sports' | 'casino' | 'matka' =>
				DOMAINS.includes(d as 'sports' | 'casino' | 'matka')
			)
		);
		const canTally = Boolean(tallyEnabled) && talliedSet.size > 0;

		if (!canTally) {
			return {
				effectiveSportsCommission: Math.max(0, raw.sports),
				effectiveCasinoCommission: Math.max(0, raw.casino),
				effectiveMatkaCommission: Math.max(0, raw.matka),
				effectiveCalculatedTotal:
					Math.max(0, raw.sports) + Math.max(0, raw.casino) + Math.max(0, raw.matka),
			};
		}

		let effectiveSports = 0;
		let effectiveCasino = 0;
		let effectiveMatka = 0;

		const tallyGroupNet =
			(talliedSet.has('sports') ? raw.sports : 0) +
			(talliedSet.has('casino') ? raw.casino : 0) +
			(talliedSet.has('matka') ? raw.matka : 0);
		const tallyContribution = Math.max(0, tallyGroupNet);

		if (talliedSet.size > 0 && tallyGroupNet > 0) {
			const ratio = tallyContribution / tallyGroupNet;
			if (talliedSet.has('sports')) effectiveSports = raw.sports * ratio;
			if (talliedSet.has('casino')) effectiveCasino = raw.casino * ratio;
			if (talliedSet.has('matka')) effectiveMatka = raw.matka * ratio;
		}

		for (const d of DOMAINS) {
			if (talliedSet.has(d)) continue;
			const v = raw[d];
			if (d === 'sports') effectiveSports = Math.max(0, v);
			else if (d === 'casino') effectiveCasino = Math.max(0, v);
			else effectiveMatka = Math.max(0, v);
		}

		return {
			effectiveSportsCommission: effectiveSports,
			effectiveCasinoCommission: effectiveCasino,
			effectiveMatkaCommission: effectiveMatka,
			effectiveCalculatedTotal: effectiveSports + effectiveCasino + effectiveMatka,
		};
	}

	/**
	 * Calculate commission summary for an agent over a period.
	 *
	 * The range is summed IST cycle by IST cycle (Monday 00:00 -> Monday 00:00),
	 * each cycle at the rates in force at ITS start, with tally rules / max(0)
	 * applied per cycle — exactly what payable does for one cycle. One cycle in,
	 * one cycle out: a single-cycle summary is unchanged. Before, one rate was read
	 * at the range start, so any all-time or multi-week total was 0 (no config is
	 * effective at 1970) or used the wrong week's rate.
	 *
	 * mode 'gross': what the agent's payer owes it (rate x subtree GGR).
	 * mode 'net'  : the agent's own share — gross minus what it owes each direct
	 *               child (that child's gross). See commissionCycleMath.ts.
	 * Both are always returned as gross* / netEffectiveCalculatedTotal.
	 *
	 * Loss carry-forward (spec §3): each cycle's gross is reduced by what the floor
	 * removed from the agent's gross in the WHOLE previous cycle (with that cycle's
	 * rates and tally), only when the previous cycle starts on or after
	 * CARRY_FORWARD_FROM; never below 0; the rest is forgiven. Each direct child is
	 * reduced by its own previous loss, so the net is gross' - children's gross'.
	 */
	async calculateCommissionSummary(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string,
		mode: 'net' | 'gross' = 'net'
	): Promise<CommissionSummary> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		if (agent.schemeType !== 'COMMISSION') {
			throw new Error('Agent is not on commission scheme');
		}

		const children = (await this.agentsRepo.listChildren(agentId)).filter((c) => c.schemeType === 'COMMISSION');
		// Loss carry-forward needs whole cycles the range does not hold: the cycle before
		// its first one, and its first one when the range starts mid-cycle (spec §3).
		const lookback = carryLookbackWindow(periodFrom, periodTo, CARRY_FORWARD_FROM);
		const [cycleGgr, lookbackGgr, rateRows] = await Promise.all([
			this.loadCycleGgr(agent, children, periodFrom, periodTo),
			lookback
				? this.loadCycleGgr(agent, children, lookback.from, lookback.to)
				: Promise.resolve(new Map<string, CycleGgr>()),
			this.rateRowsLoader([agentId, ...children.map((c) => c.id)]),
		]);

		const agentTally = { enabled: agent.tallyEnabled ?? false, domains: agent.tallyDomains ?? null };
		const inputFor = (key: string, data: CycleGgr): CycleCommissionInput => {
			const at = cycleBoundsFromKey(key).from;
			return {
				direct: data.direct,
				rates: ratesAt(rateRows, agentId, at),
				tally: agentTally,
				children: children.map((c) => ({
					childId: c.id,
					ggr: data.byChild.get(c.id) ?? zeroAmounts(),
					rates: ratesAt(rateRows, c.id, at),
					tally: { enabled: c.tallyEnabled ?? false, domains: c.tallyDomains ?? null },
				})),
			};
		};
		// What the floor removed from each gross (the agent's and each direct child's)
		// over a WHOLE cycle, with that cycle's rates and tally. Only a cycle that starts
		// on or after CARRY_FORWARD_FROM leaves a loss to carry (spec §3).
		const lossMemo = new Map<string, CycleLosses>();
		const lossesOf = (key: string): CycleLosses => {
			const known = lossMemo.get(key);
			if (known) return known;
			let losses = noLosses();
			const whole = lookbackGgr.get(key) ?? cycleGgr.get(key);
			if (whole && lossCarriesForward(cycleBoundsFromKey(key).from)) {
				losses = cycleLosses(computeCycleCommission(inputFor(key, whole)));
			}
			lossMemo.set(key, losses);
			return losses;
		};
		// The range's cycles: those with bets, plus a cycle whose previous cycle left the
		// agent a loss to carry (a week with no bets yet still shows the carried loss).
		const firstKey = cycleKeyIST(periodFrom);
		const lastKey = cycleKeyIST(new Date(periodTo.getTime() - 1));
		const keys = new Set<string>(cycleGgr.keys());
		for (const key of new Set([...cycleGgr.keys(), ...lookbackGgr.keys()])) {
			const next = nextCycleKey(key);
			if (next >= firstKey && next <= lastKey && lossesOf(key).self > 0) keys.add(next);
		}

		const ggr = zeroAmounts();
		const direct = zeroAmounts();
		const grossRaw = zeroAmounts();
		const netRaw = zeroAmounts();
		const grossEffective = zeroAmounts();
		const netEffective = zeroAmounts();
		let grossEffectiveTotal = 0;
		let netEffectiveTotal = 0;
		let carriedLossTotal = 0;
		let carryAppliedTotal = 0;
		const cycles: CommissionCycleBreakdown[] = [];

		for (const key of Array.from(keys).sort()) {
			const data = cycleGgr.get(key) ?? { direct: zeroAmounts(), byChild: new Map<string, DomainAmounts>() };
			const bounds = cycleBoundsFromKey(key);
			const input = inputFor(key, data);
			const result = computeCycleCommission(withCarriedLosses(input, lossesOf(previousCycleKey(key))));
			addAmounts(ggr, result.ggr);
			addAmounts(direct, result.direct);
			addAmounts(grossRaw, result.grossRaw);
			addAmounts(netRaw, result.netRaw);
			addAmounts(grossEffective, {
				sports: result.gross.effectiveSportsCommission,
				casino: result.gross.effectiveCasinoCommission,
				matka: result.gross.effectiveMatkaCommission,
			});
			addAmounts(netEffective, result.net.perDomain);
			grossEffectiveTotal += result.grossAfterCarry;
			netEffectiveTotal += result.net.total;
			carriedLossTotal += result.carriedLoss;
			carryAppliedTotal += result.carryApplied;
			cycles.push({
				cycleKey: key,
				cycleFrom: bounds.from,
				cycleTo: bounds.to,
				ggr: totalOf(result.ggr),
				grossBeforeCarry: result.gross.effectiveCalculatedTotal,
				grossEffective: result.grossAfterCarry,
				netEffective: result.net.total,
				carriedLoss: result.carriedLoss,
				carryApplied: result.carryApplied,
				lossThisCycle: lossesOf(key).self,
				rates: input.rates,
			});
		}

		// Rates shown with the summary: those of the last cycle the range touches
		// (the current cycle for an all-time range; the cycle itself for one cycle).
		const lastInstant = new Date(Math.max(periodFrom.getTime(), Math.min(periodTo.getTime() - 1, Date.now())));
		const displayRates = ratesAt(rateRows, agentId, cycleBoundsFromKey(cycleKeyIST(lastInstant)).from);
		// The loss that carries into the next cycle: that of the cycle holding the range's last instant.
		const lossThisCycle = lossesOf(cycleKeyIST(lastInstant)).self;

		const raw = mode === 'gross' ? grossRaw : netRaw;
		const effective = mode === 'gross' ? grossEffective : netEffective;
		const effectiveTotal = mode === 'gross' ? grossEffectiveTotal : netEffectiveTotal;
		const totalCommission = totalOf(raw);
		const totalGGR = totalOf(ggr);
		// Weighted average commission rate (as decimal, 0..1)
		const commissionRate = totalGGR > 0 ? totalCommission / totalGGR : 0;

		return {
			agentId,
			periodFrom,
			periodTo,
			totalCommission,
			sportsCommission: raw.sports,
			casinoCommission: raw.casino,
			matkaCommission: raw.matka,
			commissionRate,
			totalGGR,
			currency,
			sportsGGR: ggr.sports,
			casinoGGR: ggr.casino,
			matkaGGR: ggr.matka,
			directSportsGGR: direct.sports,
			directCasinoGGR: direct.casino,
			directMatkaGGR: direct.matka,
			sportsCommissionRate: displayRates.sports,
			casinoCommissionRate: displayRates.casino,
			matkaCommissionRate: displayRates.matka,
			effectiveCalculatedTotal: effectiveTotal,
			effectiveSportsCommission: effective.sports,
			effectiveCasinoCommission: effective.casino,
			effectiveMatkaCommission: effective.matka,
			grossSportsCommission: grossRaw.sports,
			grossCasinoCommission: grossRaw.casino,
			grossMatkaCommission: grossRaw.matka,
			grossEffectiveSportsCommission: grossEffective.sports,
			grossEffectiveCasinoCommission: grossEffective.casino,
			grossEffectiveMatkaCommission: grossEffective.matka,
			grossEffectiveCalculatedTotal: grossEffectiveTotal,
			netEffectiveCalculatedTotal: netEffectiveTotal,
			carriedLoss: carriedLossTotal,
			carryApplied: carryAppliedTotal,
			lossThisCycle,
			cycles,
		};
	}

	/**
	 * GGR per IST cycle in [from, to), split into the agent's own players and each
	 * direct COMMISSION child's whole subtree. Players are attributed by
	 * commissionPlayerScope (agent_id, else confirmed referral), once each.
	 */
	private async loadCycleGgr(
		agent: { id: string; tenantId: string | null; createdAt: Date | string },
		children: Array<{ id: string }>,
		from: Date,
		to: Date,
	): Promise<Map<string, CycleGgr>> {
		const out = new Map<string, CycleGgr>();
		if (!(to.getTime() > from.getTime())) return out;
		const tenantId = agent.tenantId ?? 'default';
		const entry = (key: string): CycleGgr => {
			let e = out.get(key);
			if (!e) {
				e = { direct: zeroAmounts(), byChild: new Map() };
				out.set(key, e);
			}
			return e;
		};
		const childAmounts = (e: CycleGgr, childId: string): DomainAmounts => {
			let a = e.byChild.get(childId);
			if (!a) {
				a = zeroAmounts();
				e.byChild.set(childId, a);
			}
			return a;
		};

		const childSubtrees = await Promise.all(
			children.map(async (c) => ({ childId: c.id, ids: await this.agentsRepo.getDescendantIds(c.id) })),
		);

		if (this.ggrReaders.getGGRByCycleAndAgent) {
			const owner = new Map<string, string>();
			for (const s of childSubtrees) for (const id of s.ids) owner.set(id, s.childId);
			owner.set(agent.id, SELF);
			const rows = await this.ggrReaders.getGGRByCycleAndAgent({
				agentIds: Array.from(owner.keys()),
				tenantId,
				from,
				to,
			});
			for (const r of rows) {
				const who = owner.get(r.agentId);
				if (!who) continue;
				const amounts: DomainAmounts = { sports: Number(r.sports) || 0, casino: Number(r.casino) || 0, matka: Number(r.matka) || 0 };
				const e = entry(r.cycleKey);
				addAmounts(who === SELF ? e.direct : childAmounts(e, who), amounts);
			}
			return out;
		}

		// Readers without the grouped read: one segment per cycle, from the agent's
		// creation cycle (no rate can apply earlier) to `to`.
		const created = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
		const createdCycleStart = Number.isNaN(created.getTime()) ? from : cycleBoundsFromKey(cycleKeyIST(created)).from;
		const start = new Date(Math.max(from.getTime(), createdCycleStart.getTime()));
		const byIds = {
			sports: this.ggrReaders.getSportsGGRByAgentIds?.bind(this.ggrReaders),
			casino: this.ggrReaders.getCasinoGGRByAgentIds?.bind(this.ggrReaders),
			matka: this.ggrReaders.getMatkaGGRByAgentIds?.bind(this.ggrReaders),
		};
		for (const key of cycleKeysInRange(start, to, 520)) {
			const bounds = cycleBoundsFromKey(key);
			const segFrom = new Date(Math.max(start.getTime(), bounds.from.getTime()));
			const segTo = new Date(Math.min(to.getTime(), bounds.to.getTime()));
			if (!(segTo.getTime() > segFrom.getTime())) continue;
			const [s, c, m] = await Promise.all([
				this.ggrReaders.getSportsGGR({ agentId: agent.id, from: segFrom, to: segTo, scope: 'direct' }),
				this.ggrReaders.getCasinoGGR({ agentId: agent.id, from: segFrom, to: segTo, scope: 'direct' }),
				this.ggrReaders.getMatkaGGR({ agentId: agent.id, from: segFrom, to: segTo, scope: 'direct' }),
			]);
			const e = entry(key);
			addAmounts(e.direct, { sports: s.ggr ?? 0, casino: c.ggr ?? 0, matka: m.ggr ?? 0 });
			for (const sub of childSubtrees) {
				const amounts = zeroAmounts();
				for (const d of COMMISSION_DOMAINS) {
					const read = byIds[d];
					if (!read) continue;
					const res = await read({ agentIds: sub.ids, tenantId, from: segFrom, to: segTo });
					amounts[d] = res.ggr ?? 0;
				}
				addAmounts(childAmounts(e, sub.childId), amounts);
			}
		}
		return out;
	}

	/**
	 * Bets placed in [from, to) by the players of the agent's whole subtree that
	 * are still open. 0 when the reader cannot tell.
	 */
	async countOpenBetsInRange(agentId: string, from: Date, to: Date): Promise<number> {
		if (!this.ggrReaders.countOpenBetsByAgentIds) return 0;
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) return 0;
		const agentIds = await this.agentsRepo.getDescendantIds(agentId);
		const counts = await this.ggrReaders.countOpenBetsByAgentIds({
			agentIds,
			tenantId: agent.tenantId ?? 'default',
			from,
			to,
		});
		return (counts.sports ?? 0) + (counts.casino ?? 0) + (counts.matka ?? 0);
	}

	/**
	 * Get detailed commission history from actual bets (one row per bet) with real player names.
	 * Uses sports_bets, casino_bets, matka_bets for the agent's direct players; excludes aggregated ledger.
	 */
	async getCommissionHistory(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string,
		filters?: {
			domain?: 'sports' | 'casino' | 'matka';
			playerId?: string;
			limit?: number;
			offset?: number;
			mode?: 'net' | 'gross';
		}
	): Promise<{ entries: CommissionHistoryEntry[]; total: number }> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) return { entries: [], total: 0 };
		const tenantId = agent.tenantId ?? 'default';

		const mode = filters?.mode ?? 'net';
		let agentIdsForBets: string[] = [agentId];
		// In net mode, find direct COMMISSION children's user IDs (they are registered as players too)
		// and exclude their bets so they are not double-counted at the parent level
		let excludeUserIds: number[] = [];
		if (mode === 'gross') {
			const descendantIds = await this.agentsRepo.getDescendantIds(agentId);
			agentIdsForBets = [agentId, ...descendantIds];
		} else {
			// In net mode, find direct COMMISSION children's usernames
			// These sub-agents are also registered as players under the parent agent
			// Exclude their user records so their bets are not double-counted
			const directChildren = (await this.agentsRepo.listChildren(agentId)).filter(
				(c) => c.schemeType === 'COMMISSION'
			);
			if (directChildren.length > 0) {
				const childUsernames = directChildren.map((c) => c.username).filter(Boolean) as string[];
				if (childUsernames.length > 0) {
					const childAgentUsers = await db
						.select({ id: users.id })
						.from(users)
						.where(and(
							eq(users.agentId, agentId),
							inArray(users.username, childUsernames)
						));
					excludeUserIds = childAgentUsers.map((u) => u.id);
				}
			}
		}

		// Each bet earns the agent's rate in force at the start of ITS cycle, as
		// payable does, so a multi-week history shows the rate each week used.
		const ownRateRows = await this.rateRowsLoader([agentId]);
		const rateCache = new Map<string, number>();
		const rateFor = (domain: CommissionDomain, at: Date | string | null | undefined): number => {
			const when = at instanceof Date ? at : at ? new Date(at) : periodFrom;
			const cycleStart = cycleBoundsFromKey(cycleKeyIST(Number.isNaN(when.getTime()) ? periodFrom : when)).from;
			const k = `${domain}|${cycleStart.getTime()}`;
			let r = rateCache.get(k);
			if (r === undefined) {
				r = resolveCommissionRate(ownRateRows, agentId, domain, cycleStart);
				rateCache.set(k, r);
			}
			return r;
		};
		// Players of these agents: users.agent_id, or a confirmed referral into them (decision 3).
		const inScope = inArray(attributedAgentId, Array.from(new Set(agentIdsForBets)));

		const domainFilter = filters?.domain;
		const playerIdFilter = filters?.playerId;
		const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 1000);
		const offset = Math.max(filters?.offset ?? 0, 0);

		const allRows: CommissionHistoryEntry[] = [];

		if (!domainFilter || domainFilter === 'sports') {
			const sportsConditions = [
				inScope,
				gte(sportsBets.createdAt, periodFrom),
				lt(sportsBets.createdAt, periodTo),
				inArray(sportsBets.status, ['won', 'lost', 'settled']),
			];
			if (excludeUserIds.length > 0) sportsConditions.push(notInArray(users.id, excludeUserIds));
			if (playerIdFilter) sportsConditions.push(eq(sportsBets.userId, Number(playerIdFilter)));
			const sportsRows = await db
				.select({
					id: sportsBets.id,
					date: sportsBets.createdAt,
					userId: sportsBets.userId,
					name: users.name,
					username: users.username,
					stake: sportsBets.stake,
					pl: sportsBets.pl,
					currency: sportsBets.currency,
					status: sportsBets.status,
					side: sportsBets.side,
					price: sportsBets.price,
					oddsSize: sportsBets.oddsSize,
					liability: sportsBets.liability,
					eventName: sportsEventsTable.name,
					marketName: sportsMarketsTable.name,
					selectionName: sportsRunnersTable.name,
				})
				.from(sportsBets)
				.innerJoin(users, eq(sportsBets.userId, users.id))
				.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
				.leftJoin(referrerUsers, referrerJoinOn(tenantId))
				.leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
				.leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
				.leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
				.where(and(...sportsConditions))
				.orderBy(desc(sportsBets.createdAt));
			for (const r of sportsRows) {
				const pl = Number(r.pl ?? 0);
				const ggr = -pl;
				allRows.push({
					id: r.id,
					date: r.date ?? periodFrom,
					playerId: String(r.userId),
					playerName: (r.username || r.name || `Player ${r.userId}`).trim() || 'Unknown',
					domain: 'sports',
					betAmount: Number(r.stake ?? 0),
					ggr,
					commissionRate: rateFor('sports', r.date),
					commissionEarned: ggr * rateFor('sports', r.date),
					currency: r.currency ?? currency,
					status: r.status,
					eventName: r.eventName,
					marketName: r.marketName,
					selectionName: r.selectionName,
					side: r.side,
					odds: r.oddsSize ? Number(r.oddsSize) : Number(r.price ?? 0),
					liability: Number(r.liability ?? 0),
				});
			}
		}

		if (!domainFilter || domainFilter === 'casino') {
			const casinoConditions = [
				inScope,
				eq(casinoBets.walletType, 'cash'),
				gte(casinoBets.createdAt, periodFrom),
				lt(casinoBets.createdAt, periodTo),
				inArray(casinoBets.status, ['won', 'lost']),
			];
			if (excludeUserIds.length > 0) casinoConditions.push(notInArray(users.id, excludeUserIds));
			if (playerIdFilter) casinoConditions.push(eq(casinoBets.userId, Number(playerIdFilter)));
			const casinoRows = await db
				.select({
					id: casinoBets.id,
					date: casinoBets.createdAt,
					userId: casinoBets.userId,
					name: users.name,
					username: users.username,
					stake: casinoBets.stake,
					casinoPayout: casinoBets.payout,
					casinoWinAmount: casinoBets.winAmount,
					currency: casinoBets.currency,
					status: casinoBets.status,
					gameName: casinoBets.gameName,
					vendorName: casinoBets.vendorName,
				})
				.from(casinoBets)
				.innerJoin(users, eq(casinoBets.userId, users.id))
				.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
				.leftJoin(referrerUsers, referrerJoinOn(tenantId))
				.where(and(...casinoConditions))
				.orderBy(desc(casinoBets.createdAt));
			for (const r of casinoRows) {
				const stake = Number(r.stake ?? 0);
				const payoutVal = Number(r.casinoPayout ?? r.casinoWinAmount ?? 0);
				const ggr = stake - payoutVal;
				allRows.push({
					id: r.id,
					date: r.date ?? periodFrom,
					playerId: String(r.userId),
					playerName: (r.username || r.name || `Player ${r.userId}`).trim() || 'Unknown',
					domain: 'casino',
					betAmount: stake,
					ggr,
					commissionRate: rateFor('casino', r.date),
					commissionEarned: ggr * rateFor('casino', r.date),
					currency: r.currency ?? currency,
					status: r.status,
					gameName: r.gameName,
					vendorName: r.vendorName,
					payout: payoutVal,
					winAmount: Number(r.casinoWinAmount ?? 0),
				});
			}
		}

		if (!domainFilter || domainFilter === 'matka') {
			const matkaConditions = [
				inScope,
				gte(matkaBets.createdAt, periodFrom),
				lt(matkaBets.createdAt, periodTo),
				inArray(matkaBets.status, ['won', 'lost']),
			];
			if (excludeUserIds.length > 0) matkaConditions.push(notInArray(users.id, excludeUserIds));
			if (playerIdFilter) matkaConditions.push(eq(matkaBets.userId, Number(playerIdFilter)));
			const matkaRows = await db
				.select({
					id: matkaBets.id,
					date: matkaBets.createdAt,
					userId: matkaBets.userId,
					name: users.name,
					username: users.username,
					matkaBetAmount: matkaBets.betAmount,
					matkaActualWin: matkaBets.actualWin,
					status: matkaBets.status,
					currency: matkaBets.currency,
					matkaMarketName: matkaBets.marketName,
					matkaType: matkaBets.matkaType,
					marketSession: matkaBets.marketSession,
					bidType: matkaBets.bidType,
					betNumbers: matkaBets.betNumbers,
					payoutMultiplier: matkaBets.payoutMultiplier,
					potentialWin: matkaBets.potentialWin,
				})
				.from(matkaBets)
				.innerJoin(users, eq(matkaBets.userId, users.id))
				.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
				.leftJoin(referrerUsers, referrerJoinOn(tenantId))
				.where(and(...matkaConditions))
				.orderBy(desc(matkaBets.createdAt));
			for (const r of matkaRows) {
				const stake = Number(r.matkaBetAmount ?? 0);
				const win = r.status === 'won' ? Number(r.matkaActualWin ?? 0) : 0;
				const ggr = stake - win;
				allRows.push({
					id: r.id,
					date: r.date ?? periodFrom,
					playerId: String(r.userId),
					playerName: (r.username || r.name || `Player ${r.userId}`).trim() || 'Unknown',
					domain: 'matka',
					betAmount: stake,
					ggr,
					commissionRate: rateFor('matka', r.date),
					commissionEarned: ggr * rateFor('matka', r.date),
					currency: r.currency ?? currency,
					status: r.status,
					marketName: r.matkaMarketName,
					matkaType: r.matkaType,
					marketSession: r.marketSession,
					bidType: r.bidType,
					betNumbers: r.betNumbers,
					payoutMultiplier: Number(r.payoutMultiplier ?? 0),
					potentialWin: Number(r.potentialWin ?? 0),
					actualWin: Number(r.matkaActualWin ?? 0),
				});
			}
		}

		// Sort by date desc and apply currency filter
		allRows.sort((a, b) => (b.date.getTime ? b.date.getTime() : new Date(b.date).getTime()) - (a.date.getTime ? a.date.getTime() : new Date(a.date).getTime()));
		const currencyFiltered = currency ? allRows.filter((r) => r.currency === currency) : allRows;
		const total = currencyFiltered.length;
		const paginated = currencyFiltered.slice(offset, offset + limit);

		return { entries: paginated, total };
	}

	/**
	 * Get per-player aggregated commission summaries for ALL players in the agent's downline.
	 * Includes direct players + all sub-agents' players (entire tree), and players
	 * referred into any of them (decision 3) — each player once, under the one
	 * agent it belongs to (commissionPlayerScope).
	 * Commission per player uses that agent's rate (sub-agent rates for sub-agent
	 * players, the agent's own for its direct players) in force at the start of each
	 * cycle the bets fall in, so multi-week ranges are summed cycle by cycle.
	 *
	 * `_parentCommissionRates` is kept for the existing call signature; the agent's
	 * own rates are now resolved per cycle like everyone else's.
	 */
	async getDirectPlayerSummaries(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		_parentCommissionRates?: { sports: number; casino: number; matka: number }
	): Promise<Array<{
		playerId: string;
		playerName: string;
		subAgentId: string | null;
		subAgentUsername: string | null;
		subAgentSportsRate: number | null;
		subAgentCasinoRate: number | null;
		subAgentMatkaRate: number | null;
		sportsGGR: number;
		casinoGGR: number;
		matkaGGR: number;
		sportsCommission: number;
		casinoCommission: number;
		matkaCommission: number;
		totalGGR: number;
		totalCommission: number;
	}>> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) return [];
		const tenantId = agent.tenantId ?? 'default';

		const descendantIds = await this.agentsRepo.getDescendantIds(agentId);
		const allAgentIds = Array.from(new Set([agentId, ...descendantIds]));
		const rateRows = await this.rateRowsLoader(allAgentIds);
		const inScope = inArray(attributedAgentId, allAgentIds);

		const playerMap = new Map<string, {
			playerName: string;
			playerAgentId: string | null;
			ggr: DomainAmounts;
			commission: DomainAmounts;
		}>();

		const rateCache = new Map<string, number>();
		const rateOf = (ownerId: string, domain: CommissionDomain, cycleKey: string): number => {
			const k = `${ownerId}|${domain}|${cycleKey}`;
			let r = rateCache.get(k);
			if (r === undefined) {
				r = resolveCommissionRate(rateRows, ownerId, domain, cycleBoundsFromKey(cycleKey).from);
				rateCache.set(k, r);
			}
			return r;
		};
		const add = (
			domain: CommissionDomain,
			row: { userId: number | null; username: string | null; name: string | null; ownerId: string | null; cycleKey: string | null },
			ggr: number,
		) => {
			if (row.userId == null || !row.ownerId || !row.cycleKey) return;
			const id = String(row.userId);
			let p = playerMap.get(id);
			if (!p) {
				const playerName = (row.username || row.name || `Player ${row.userId}`).trim() || 'Unknown';
				p = { playerName, playerAgentId: row.ownerId, ggr: zeroAmounts(), commission: zeroAmounts() };
				playerMap.set(id, p);
			}
			p.ggr[domain] += ggr;
			p.commission[domain] += ggr * rateOf(row.ownerId, domain, String(row.cycleKey));
		};

		// Sports bets
		const sportsRows = await db
			.select({
				userId: sportsBets.userId,
				username: users.username,
				name: users.name,
				ownerId: attributedAgentId,
				cycleKey: istCycleKeySql(sportsBets.createdAt),
				pl: sql<number>`SUM(COALESCE(${sportsBets.pl}, 0))`,
			})
			.from(sportsBets)
			.innerJoin(users, eq(sportsBets.userId, users.id))
			.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
			.leftJoin(referrerUsers, referrerJoinOn(tenantId))
			.where(and(
				inScope,
				gte(sportsBets.createdAt, periodFrom),
				lt(sportsBets.createdAt, periodTo),
				inArray(sportsBets.status, ['won', 'lost', 'settled']),
			))
			.groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`);
		for (const r of sportsRows) add('sports', r, -(Number(r.pl ?? 0)));

		// Casino bets
		const casinoRows = await db
			.select({
				userId: casinoBets.userId,
				username: users.username,
				name: users.name,
				ownerId: attributedAgentId,
				cycleKey: istCycleKeySql(casinoBets.createdAt),
				totalStake: sql<number>`SUM(${casinoBets.stake})`,
				totalPayout: sql<number>`SUM(COALESCE(${casinoBets.payout}, ${casinoBets.winAmount}, 0))`,
			})
			.from(casinoBets)
			.innerJoin(users, eq(casinoBets.userId, users.id))
			.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
			.leftJoin(referrerUsers, referrerJoinOn(tenantId))
			.where(and(
				inScope,
				eq(casinoBets.walletType, 'cash'),
				gte(casinoBets.createdAt, periodFrom),
				lt(casinoBets.createdAt, periodTo),
				inArray(casinoBets.status, ['won', 'lost']),
			))
			.groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`);
		for (const r of casinoRows) add('casino', r, Number(r.totalStake ?? 0) - Number(r.totalPayout ?? 0));

		// Matka bets
		const matkaRows = await db
			.select({
				userId: matkaBets.userId,
				username: users.username,
				name: users.name,
				ownerId: attributedAgentId,
				cycleKey: istCycleKeySql(matkaBets.createdAt),
				totalBetAmount: sql<number>`SUM(${matkaBets.betAmount})`,
				totalActualWin: sql<number>`SUM(CASE WHEN ${matkaBets.status} = 'won' THEN COALESCE(${matkaBets.actualWin}, 0) ELSE 0 END)`,
			})
			.from(matkaBets)
			.innerJoin(users, eq(matkaBets.userId, users.id))
			.leftJoin(referralAttributions, referralAttributionJoinOn(tenantId))
			.leftJoin(referrerUsers, referrerJoinOn(tenantId))
			.where(and(
				inScope,
				gte(matkaBets.createdAt, periodFrom),
				lt(matkaBets.createdAt, periodTo),
				inArray(matkaBets.status, ['won', 'lost']),
			))
			.groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`);
		for (const r of matkaRows) add('matka', r, Number(r.totalBetAmount ?? 0) - Number(r.totalActualWin ?? 0));

		// Collect all unique agent IDs that players belong to (for sub-agent usernames + display rates)
		const subAgentIdSet = new Set<string>();
		for (const data of playerMap.values()) {
			if (data.playerAgentId && data.playerAgentId !== agentId) {
				subAgentIdSet.add(data.playerAgentId);
			}
		}

		// Batch-fetch sub-agent usernames
		const subAgentUsernameMap = new Map<string, string>();
		if (subAgentIdSet.size > 0) {
			const credRows = await db
				.select({ agentId: agentCredentials.agentId, username: agentCredentials.username })
				.from(agentCredentials)
				.where(inArray(agentCredentials.agentId, Array.from(subAgentIdSet)));
			for (const row of credRows) {
				subAgentUsernameMap.set(row.agentId, row.username);
			}
		}

		// Rates shown for a sub-agent: those of the last cycle the range touches.
		const lastInstant = new Date(Math.max(periodFrom.getTime(), Math.min(periodTo.getTime() - 1, Date.now())));
		const displayCycleStart = cycleBoundsFromKey(cycleKeyIST(lastInstant)).from;

		const results = [];
		for (const [playerId, data] of playerMap.entries()) {
			const isSubAgent = Boolean(data.playerAgentId && data.playerAgentId !== agentId);
			const subRates = isSubAgent && data.playerAgentId ? ratesAt(rateRows, data.playerAgentId, displayCycleStart) : null;
			results.push({
				playerId,
				playerName: data.playerName,
				subAgentId: isSubAgent ? data.playerAgentId : null,
				subAgentUsername: isSubAgent ? (subAgentUsernameMap.get(data.playerAgentId!) ?? null) : null,
				subAgentSportsRate: subRates ? subRates.sports : null,
				subAgentCasinoRate: subRates ? subRates.casino : null,
				subAgentMatkaRate: subRates ? subRates.matka : null,
				sportsGGR: data.ggr.sports,
				casinoGGR: data.ggr.casino,
				matkaGGR: data.ggr.matka,
				sportsCommission: data.commission.sports,
				casinoCommission: data.commission.casino,
				matkaCommission: data.commission.matka,
				totalGGR: totalOf(data.ggr),
				totalCommission: totalOf(data.commission),
			});
		}

		results.sort((a, b) => b.totalCommission - a.totalCommission);
		return results;
	}

	/**
	 * Accrue commission for a period (called by cron job)
	 * Creates ledger entries for commission earned
	 *
	 * Posts exactly what payable computes for the cycle: GROSS (what the agent's
	 * payer owes it), per domain, after the agent's tally rules, over the same
	 * [Monday, next Monday) IST window from the same live bets. It used to post the
	 * raw net per domain from daily snapshots read with an inclusive end date and
	 * no tally, so "Total Earned" and LEDGER_GAP disagreed with payable.
	 *
	 * deferIfOpenBets: when bets placed in the cycle are still open, post nothing
	 * yet (deferred) — a later run posts the final figure once they settle.
	 *
	 * Loss carry-forward (spec §3) is NOT posted: the per-domain figures used here
	 * are the gross BEFORE the carried loss (the carry is one payout-time line, not
	 * spread over domains, and agent_ledger.domain is the GraphQL AgentDomain enum,
	 * so a "carry" line would break agentLedgers). Readiness compares the ledger
	 * with the gross before the carry, so the carry raises no LEDGER_GAP.
	 */
	async accrueCommission(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string,
		options?: { deferIfOpenBets?: boolean }
	): Promise<{ inserted: number; skipped: number; deferred?: boolean; details: Record<'sports' | 'casino' | 'matka', AccrualDomainAction | null> }> {
		const details: Record<'sports' | 'casino' | 'matka', AccrualDomainAction | null> = { sports: null, casino: null, matka: null };
		if (options?.deferIfOpenBets && (await this.countOpenBetsInRange(agentId, periodFrom, periodTo)) > 0) {
			return { inserted: 0, skipped: 0, deferred: true, details };
		}
		const gross = await this.calculateCommissionSummary(agentId, periodFrom, periodTo, currency, 'gross');
		const summary = {
			sportsCommission: gross.effectiveSportsCommission,
			casinoCommission: gross.effectiveCasinoCommission,
			matkaCommission: gross.effectiveMatkaCommission,
		};
		let inserted = 0;
		let skipped = 0;

		// Create ledger entries for each domain atomically (idempotent: skip if already accrued for this period)
		await db.transaction(async (tx) => {
			if (summary.sportsCommission > 0) {
				const alreadyExists = await this.ledgerRepo.existsCommissionLine(agentId, 'sports', periodFrom, periodTo, tx);
				if (!alreadyExists) {
					const row = await this.ledgerRepo.addLine({
						agentId,
						domain: 'sports',
						periodFrom,
						periodTo,
						lineType: 'COMMISSION',
						amount: summary.sportsCommission,
						currency,
						refKey: `commission-sports-${periodFrom.toISOString()}-${periodTo.toISOString()}`,
					}, tx);
					// row is undefined when a concurrent run already inserted this line (ON CONFLICT DO NOTHING).
					if (row) { inserted++; details.sports = 'inserted'; }
					else { skipped++; details.sports = 'skipped'; }
				} else {
					skipped++;
					details.sports = 'skipped';
				}
			}

			if (summary.casinoCommission > 0) {
				const alreadyExists = await this.ledgerRepo.existsCommissionLine(agentId, 'casino', periodFrom, periodTo, tx);
				if (!alreadyExists) {
					const row = await this.ledgerRepo.addLine({
						agentId,
						domain: 'casino',
						periodFrom,
						periodTo,
						lineType: 'COMMISSION',
						amount: summary.casinoCommission,
						currency,
						refKey: `commission-casino-${periodFrom.toISOString()}-${periodTo.toISOString()}`,
					}, tx);
					if (row) { inserted++; details.casino = 'inserted'; }
					else { skipped++; details.casino = 'skipped'; }
				} else {
					skipped++;
					details.casino = 'skipped';
				}
			}

			if (summary.matkaCommission > 0) {
				const alreadyExists = await this.ledgerRepo.existsCommissionLine(agentId, 'matka', periodFrom, periodTo, tx);
				if (!alreadyExists) {
					const row = await this.ledgerRepo.addLine({
						agentId,
						domain: 'matka',
						periodFrom,
						periodTo,
						lineType: 'COMMISSION',
						amount: summary.matkaCommission,
						currency,
						refKey: `commission-matka-${periodFrom.toISOString()}-${periodTo.toISOString()}`,
					}, tx);
					if (row) { inserted++; details.matka = 'inserted'; }
					else { skipped++; details.matka = 'skipped'; }
				} else {
					skipped++;
					details.matka = 'skipped';
				}
			}
		});
		return { inserted, skipped, details };
	}

	/**
	 * Unified commission read: calculatedTotal (hybrid GGR × rate, in the requested mode),
	 * earnedPosted (ledger COMMISSION sum), paid (commission_payouts for the cycles in the range),
	 * pending. Use for all listing/report/dashboard surfaces.
	 * Pass preCalculatedSummary when you already have a summary to avoid recalculating (e.g. from resolver).
	 *
	 * pending is what the agent's payer still owes it, whatever the mode: per IST
	 * cycle, max(0, GROSS + applied adjustments - paid for that cycle), summed. A
	 * payout is always the gross, so comparing it with a net figure (My Share) was
	 * meaningless, and matching the whole range as one exact cycle found no payout
	 * for any range but a single week, so all-time "pending" never went down.
	 */
	async getUnifiedCommission(
		agentId: string,
		currency: string,
		tenant: string,
		options?: { periodFrom?: Date; periodTo?: Date; preCalculatedSummary?: CommissionSummary; mode?: 'net' | 'gross'; paidOverride?: number }
	): Promise<UnifiedCommissionRead> {
		const periodFrom = options?.periodFrom ?? new Date(0);
		const periodTo = options?.periodTo ?? new Date();
		const summary =
			options?.preCalculatedSummary ??
			(await this.calculateCommissionSummary(agentId, periodFrom, periodTo, currency, options?.mode ?? 'net'));
		const calculatedTotal = summary.effectiveCalculatedTotal;
		const owedTotal = summary.grossEffectiveCalculatedTotal ?? calculatedTotal;
		const earnedPosted = await this.ledgerRepo.getEarnedPostedSum(agentId, { from: periodFrom, to: periodTo, currency });

		if (options?.paidOverride !== undefined) {
			const paid = options.paidOverride;
			return { calculatedTotal, earnedPosted, paid, pending: roundPayable(owedTotal - paid) };
		}
		if (!this.commissionPayoutsRepo) {
			return { calculatedTotal, earnedPosted, paid: 0, pending: roundPayable(owedTotal) };
		}
		if (!summary.cycles) {
			// A summary without a cycle breakdown (built elsewhere): one-cycle reading.
			const paid = await this.commissionPayoutsRepo.getTotalPaidForCycle(tenant, agentId, periodFrom, periodTo);
			return { calculatedTotal, earnedPosted, paid, pending: roundPayable(owedTotal - paid) };
		}

		const [paidByCycleAll, adjustmentsByCycle] = await Promise.all([
			this.commissionPayoutsRepo.getPaidByCycleForAgents(tenant, [agentId], periodFrom, periodTo),
			this.getAdjustmentsReader().then((r) => r.sumAppliedByTargetCycle(tenant, agentId, periodFrom, periodTo)),
		]);
		const paidByCycle = paidByCycleAll.get(agentId) ?? new Map<string, number>();
		const owedByCycle = new Map<string, number>();
		for (const c of summary.cycles) owedByCycle.set(c.cycleKey, (owedByCycle.get(c.cycleKey) ?? 0) + c.grossEffective);
		const keys = new Set<string>([...owedByCycle.keys(), ...paidByCycle.keys(), ...adjustmentsByCycle.keys()]);
		let paid = 0;
		let pending = 0;
		for (const key of keys) {
			const paidHere = paidByCycle.get(key) ?? 0;
			paid += paidHere;
			// One payout per cycle (unique index): a paid cycle has nothing left to pay,
			// the same rule as payable/readiness.
			if (paidHere > 0) continue;
			pending += roundPayable((owedByCycle.get(key) ?? 0) + (adjustmentsByCycle.get(key) ?? 0));
		}
		return { calculatedTotal, earnedPosted, paid, pending: Math.round(pending * 100) / 100 };
	}

	/**
	 * Every IST cycle of a COMMISSION agent from its creation cycle to the current
	 * one, with what is payable for it — the backend's single answer to "which
	 * weeks can be paid, and for how much", so no screen has to work cycle dates out
	 * in the browser's time zone. Oldest first.
	 *
	 * calculatedTotal: the cycle's GROSS (tally applied) after the loss carried
	 * from the previous cycle; adjustment: applied adjustments targeting the
	 * cycle; paid: payouts recorded for it; payable: max(0, calculatedTotal +
	 * adjustment - paid), rounded, 0 once paid (a paid cycle is frozen).
	 * carriedLoss / carryApplied / lossThisCycle: the cycle's carry figures (spec §3).
	 */
	async listCyclePayables(
		agentId: string,
		tenant: string,
		currency: string,
		now: Date = new Date(),
	): Promise<Array<{ cycleKey: string; from: Date; to: Date; calculatedTotal: number; adjustment: number; paid: number; payable: number; carriedLoss: number; carryApplied: number; lossThisCycle: number }>> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) return [];
		const created = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
		const start = cycleBoundsFromKey(cycleKeyIST(Number.isNaN(created.getTime()) ? now : created)).from;
		const end = cycleBoundsFromKey(cycleKeyIST(now)).to;
		const summary = await this.calculateCommissionSummary(agentId, start, end, currency, 'gross');
		const [paidByCycleAll, adjustmentsByCycle] = await Promise.all([
			this.commissionPayoutsRepo
				? this.commissionPayoutsRepo.getPaidByCycleForAgents(tenant, [agentId], start, end)
				: Promise.resolve(new Map<string, Map<string, number>>()),
			this.getAdjustmentsReader().then((r) => r.sumAppliedByTargetCycle(tenant, agentId, start, end)),
		]);
		const paidByCycle = paidByCycleAll.get(agentId) ?? new Map<string, number>();
		const byCycle = new Map((summary.cycles ?? []).map((c): [string, CommissionCycleBreakdown] => [c.cycleKey, c]));
		return cycleKeysInRange(start, end).map((key) => {
			const bounds = cycleBoundsFromKey(key);
			const cycle = byCycle.get(key);
			const calculatedTotal = cycle?.grossEffective ?? 0;
			const adjustment = adjustmentsByCycle.get(key) ?? 0;
			const paid = paidByCycle.get(key) ?? 0;
			// Frozen once paid: one payout per cycle, so nothing becomes payable again,
			// even when a later read of the previous week changes the carried loss.
			const payable = paid > 0 ? 0 : roundPayable(calculatedTotal + adjustment - paid);
			return {
				cycleKey: key,
				from: bounds.from,
				to: bounds.to,
				calculatedTotal,
				adjustment,
				paid,
				payable,
				carriedLoss: cycle?.carriedLoss ?? 0,
				carryApplied: cycle?.carryApplied ?? 0,
				lossThisCycle: cycle?.lossThisCycle ?? 0,
			};
		});
	}

	/**
	 * Get total pending commission (not yet paid out). Uses commission_payouts for paid when tenant and repo are set.
	 */
	async getPendingCommission(agentId: string, currency: string, tenant?: string): Promise<number> {
		if (tenant && this.commissionPayoutsRepo) {
			const unified = await this.getUnifiedCommission(agentId, currency, tenant, {
				periodFrom: new Date(0),
				periodTo: new Date(),
			});
			return unified.pending;
		}
		const now = new Date();
		const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
		const entries = await this.ledgerRepo.list(agentId, oneYearAgo, now);
		const commissionEntries = entries.filter(
			(e) => e.lineType === 'COMMISSION' && e.currency === currency
		);
		const settlementEntries = entries.filter(
			(e) => e.lineType === 'SETTLEMENT' && e.currency === currency
		);
		const settledCommissionIds = new Set<string>();
		settlementEntries.forEach((settlement) => {
			commissionEntries.forEach((commission) => {
				const commissionDate = new Date(commission.createdAt);
				const settlementFrom = new Date(settlement.periodFrom);
				const settlementTo = new Date(settlement.periodTo);
				if (commissionDate >= settlementFrom && commissionDate <= settlementTo) {
					settledCommissionIds.add(commission.id);
				}
			});
		});
		const unsettledCommissions = commissionEntries.filter((e) => !settledCommissionIds.has(e.id));
		return unsettledCommissions.reduce((sum, entry) => sum + Number(entry.amount), 0);
	}

	/**
	 * Get total paid commission. Uses commission_payouts when tenant and repo are set; otherwise ledger SETTLEMENT lines (legacy).
	 */
	async getPaidCommission(
		agentId: string,
		currency: string,
		periodFrom?: Date,
		periodTo?: Date,
		tenant?: string
	): Promise<number> {
		if (tenant && this.commissionPayoutsRepo) {
			const paidMap = await this.commissionPayoutsRepo.getTotalPaidByAgentIds(tenant, [agentId], {
				fromDate: periodFrom ?? new Date(0),
				toDate: periodTo ?? new Date(),
			});
			return paidMap.get(agentId) ?? 0;
		}
		const from = periodFrom ?? new Date(0);
		const to = periodTo ?? new Date();
		const entries = await this.ledgerRepo.list(agentId, from, to);
		const settlementEntries = entries.filter(
			(e) => e.lineType === 'SETTLEMENT' && e.currency === currency
		);
		return settlementEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
	}

	/**
	 * Calculate tiered commission (if commission rate changes based on GGR thresholds)
	 */
	private calculateTieredCommission(ggr: number, tiers: { threshold: number; rate: number }[]): number {
		let commission = 0;
		let remaining = ggr;

		// Sort tiers by threshold ascending
		const sortedTiers = tiers.sort((a, b) => a.threshold - b.threshold);

		for (let i = 0; i < sortedTiers.length; i++) {
			const tier = sortedTiers[i];
			const nextThreshold = sortedTiers[i + 1]?.threshold || Infinity;
			const tierAmount = Math.min(remaining, nextThreshold - tier.threshold);

			if (tierAmount > 0) {
				commission += tierAmount * (tier.rate / 100);
				remaining -= tierAmount;
			}

			if (remaining <= 0) break;
		}

		return commission;
	}
}

