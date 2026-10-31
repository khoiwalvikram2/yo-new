/**
 * Commission maths for one IST Monday->Monday cycle. Pure: no I/O.
 *
 * The money model (agent-schemes hardening, W8):
 *
 *   - An agent's GROSS for a cycle is, per domain, its own rate (effective at the
 *     cycle start) times the GGR of its whole subtree, then the agent's tally
 *     rules (max(0) per domain, or one net over the tallied domains).
 *   - What a parent owes a child is the child's GROSS. An admin owes a root
 *     agent its GROSS. So payable, readiness and payCommission all use GROSS.
 *   - An agent's "My Share" (NET) is its GROSS minus what it owes its direct
 *     children (each child's GROSS under that child's own tally rules). This is
 *     the agent's cash: what it receives minus what it pays down.
 *
 * Example A 10% -> B 8% -> C 5%, C's players lose 1000:
 *   gross A 100, B 80, C 50; the admin pays A 100, A pays B 80, B pays C 50;
 *   net A 20, B 30, C 50.
 *
 * Rates are resolved per cycle, so a range that spans several cycles is the
 * sum of its cycles, each at its own rate. Resolving one rate at the range start
 * gave 0 for every all-time total (no config is effective at 1970).
 *
 * Loss carry-forward (one week, approach A, spec 2026-10-22 §3): what the floor
 * removed from a gross in cycle N-1 (lossThisCycle) comes off cycle N's gross as
 * one line, never below 0; the unrecovered rest is forgiven. Each agent carries
 * its own loss, and a parent owes a child the child's gross after the child's
 * carry. The caller decides which cycles carry (CARRY_FORWARD_FROM).
 */

import { DateTime } from 'luxon';
import { applyTallyRulesForSettlement, floorLossForSettlement, type EffectiveSettlementResult } from './commissionTallyRules.js';

export type CommissionDomain = 'sports' | 'casino' | 'matka';
export const COMMISSION_DOMAINS: readonly CommissionDomain[] = ['sports', 'casino', 'matka'];
export type DomainAmounts = Record<CommissionDomain, number>;

const IST = 'Asia/Kolkata';

export function zeroAmounts(): DomainAmounts {
	return { sports: 0, casino: 0, matka: 0 };
}

export function addAmounts(into: DomainAmounts, add: DomainAmounts): DomainAmounts {
	into.sports += add.sports;
	into.casino += add.casino;
	into.matka += add.matka;
	return into;
}

export function totalOf(a: DomainAmounts): number {
	return a.sports + a.casino + a.matka;
}

/** A commission config row as stored in agent_commission_config. */
export interface CommissionRateRow {
	agentId: string;
	domain: string;
	commissionRate: string | number;
	effectiveFrom: Date | string;
	effectiveTo?: Date | string | null;
}

const toMs = (v: Date | string): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * The rate in force at `at`, resolved in memory with exactly the rule of
 * AgentConfigsRepo.getCommissionConfig: newest effectiveFrom first, the first row
 * with effectiveFrom <= at (+1s buffer) and no effectiveTo or effectiveTo >= at.
 * No matching row means no rate (0); a later or end-dated row is never used.
 */
export function resolveCommissionRate(
	rows: readonly CommissionRateRow[],
	agentId: string,
	domain: CommissionDomain,
	at: Date,
): number {
	const atMs = at.getTime();
	const buffer = atMs + 1000;
	const candidates = rows
		.filter((r) => r.agentId === agentId && r.domain === domain)
		.sort((a, b) => toMs(b.effectiveFrom) - toMs(a.effectiveFrom));
	for (const r of candidates) {
		const from = toMs(r.effectiveFrom);
		const to = r.effectiveTo ? toMs(r.effectiveTo) : null;
		if (from <= buffer && (to === null || to >= atMs)) {
			const n = Number(r.commissionRate);
			return Number.isFinite(n) ? n : 0;
		}
	}
	return 0;
}

export function ratesAt(rows: readonly CommissionRateRow[], agentId: string, at: Date): DomainAmounts {
	return {
		sports: resolveCommissionRate(rows, agentId, 'sports', at),
		casino: resolveCommissionRate(rows, agentId, 'casino', at),
		matka: resolveCommissionRate(rows, agentId, 'matka', at),
	};
}

/** IST Monday (YYYY-MM-DD) of the cycle that contains `date`. */
export function cycleKeyIST(date: Date): string {
	const dt = DateTime.fromJSDate(date, { zone: IST });
	return dt.minus({ days: dt.weekday - 1 }).toFormat('yyyy-MM-dd');
}

/** Cycle bounds for an IST Monday key (YYYY-MM-DD): [Monday 00:00 IST, next Monday 00:00 IST). */
export function cycleBoundsFromKey(key: string): { from: Date; to: Date } {
	const from = DateTime.fromISO(key, { zone: IST }).startOf('day');
	return { from: from.toJSDate(), to: from.plus({ weeks: 1 }).toJSDate() };
}

/** Keys of every cycle that overlaps [from, to), oldest first. Capped to `maxCycles` (newest kept). */
export function cycleKeysInRange(from: Date, to: Date, maxCycles = 1000): string[] {
	if (!(to.getTime() > from.getTime())) return [];
	const keys: string[] = [];
	let cursor = DateTime.fromISO(cycleKeyIST(from), { zone: IST }).startOf('day');
	const end = to.getTime();
	while (cursor.toMillis() < end) {
		keys.push(cursor.toFormat('yyyy-MM-dd'));
		cursor = cursor.plus({ weeks: 1 });
	}
	return keys.length > maxCycles ? keys.slice(keys.length - maxCycles) : keys;
}

/** The IST Monday key of the cycle before `key`. */
export function previousCycleKey(key: string): string {
	return DateTime.fromISO(key, { zone: IST }).minus({ weeks: 1 }).toFormat('yyyy-MM-dd');
}

/** The IST Monday key of the cycle after `key`. */
export function nextCycleKey(key: string): string {
	return DateTime.fromISO(key, { zone: IST }).plus({ weeks: 1 }).toFormat('yyyy-MM-dd');
}

/**
 * The extra GGR a summary over [from, to) needs for the loss carry-forward, as
 * whole cycles: the cycle before the range's first cycle (its loss carries into
 * the first one) and, when `from` is not a cycle start, the whole first cycle too
 * (the range holds only part of it, but its loss carries into the next one).
 * Null when the range is empty or no cycle of the window can carry (the window
 * ends on or before `carryFrom`).
 */
export function carryLookbackWindow(from: Date, to: Date, carryFrom: Date): { from: Date; to: Date } | null {
	if (!(to.getTime() > from.getTime())) return null;
	const firstKey = cycleKeyIST(from);
	const first = cycleBoundsFromKey(firstKey);
	const windowFrom = cycleBoundsFromKey(previousCycleKey(firstKey)).from;
	const windowTo = first.from.getTime() === from.getTime() ? first.from : first.to;
	if (windowTo.getTime() <= carryFrom.getTime()) return null;
	return { from: windowFrom, to: windowTo };
}

export interface TallyConfig {
	enabled: boolean;
	domains: string[] | null | undefined;
}

export interface ChildCycleInput {
	childId: string;
	/** GGR of the child's whole subtree in the cycle. */
	ggr: DomainAmounts;
	/** The child's own rates at the cycle start. */
	rates: DomainAmounts;
	tally: TallyConfig;
	/** The child's own loss carried from the previous cycle (0 / omitted = none). */
	previousCycleLoss?: number;
}

export interface CycleCommissionInput {
	/** GGR of the agent's own players (users.agent_id = agent, or referred into it). */
	direct: DomainAmounts;
	children: ChildCycleInput[];
	/** The agent's own rates at the cycle start. */
	rates: DomainAmounts;
	tally: TallyConfig;
	/** The agent's own loss carried from the previous cycle (0 / omitted = none). */
	previousCycleLoss?: number;
}

/** A carried loss applied to a gross: one line, never below 0; the unrecovered rest is forgiven. */
export interface CarryOutcome {
	/** The loss carried in from the previous cycle (0 when none). */
	carriedLoss: number;
	/** The part of carriedLoss taken off the gross. */
	carryApplied: number;
	/** max(0, gross after tally - carriedLoss): what the payer owes for the cycle. */
	grossAfterCarry: number;
}

export interface OwedToChild extends CarryOutcome {
	childId: string;
	raw: DomainAmounts;
	effective: EffectiveSettlementResult;
	/** What the floor removed from the child's gross this cycle (carries into the child's next cycle). */
	lossThisCycle: number;
}

export interface CycleCommissionResult extends CarryOutcome {
	/** Subtree GGR (direct + every child's subtree). */
	ggr: DomainAmounts;
	direct: DomainAmounts;
	/** rate x subtree GGR per domain, before tally rules. */
	grossRaw: DomainAmounts;
	/** The agent's gross with tally rules applied, BEFORE any carried loss (grossAfterCarry is after it). */
	gross: EffectiveSettlementResult;
	/** Per child: what the agent owes that child (the child's own GROSS, its own tally rules, then its own carry). */
	owedToChildren: OwedToChild[];
	/** grossRaw minus the children's raw gross. */
	netRaw: DomainAmounts;
	/**
	 * My Share. total = grossAfterCarry minus the children's grossAfterCarry; may be
	 * negative. perDomain is before any carry (the carry is one line, not spread).
	 */
	net: { perDomain: DomainAmounts; total: number };
	/** What the floor removed from the agent's gross this cycle: sum of max(0, -bucket). */
	lossThisCycle: number;
}

function effectiveAmounts(e: EffectiveSettlementResult): DomainAmounts {
	return { sports: e.effectiveSportsCommission, casino: e.effectiveCasinoCommission, matka: e.effectiveMatkaCommission };
}

function tallied(raw: DomainAmounts, tally: TallyConfig): EffectiveSettlementResult {
	return applyTallyRulesForSettlement(raw.sports, raw.casino, raw.matka, Boolean(tally.enabled), tally.domains ?? null);
}

function floorLoss(raw: DomainAmounts, tally: TallyConfig): number {
	return floorLossForSettlement(raw.sports, raw.casino, raw.matka, Boolean(tally.enabled), tally.domains ?? null);
}

/**
 * Takes a carried loss off an effective gross (approach A): one line, never
 * below 0. The part not recovered is forgiven; it never moves to a later cycle.
 */
export function applyCarry(grossEffective: number, carriedLoss: number): CarryOutcome {
	const carried = Number.isFinite(carriedLoss) && carriedLoss > 0 ? carriedLoss : 0;
	const base = Number.isFinite(grossEffective) && grossEffective > 0 ? grossEffective : 0;
	const grossAfterCarry = Math.max(0, base - carried);
	return { carriedLoss: carried, carryApplied: base - grossAfterCarry, grossAfterCarry };
}

export function computeCycleCommission(input: CycleCommissionInput): CycleCommissionResult {
	const ggr = addAmounts(zeroAmounts(), input.direct);
	for (const c of input.children) addAmounts(ggr, c.ggr);

	const grossRaw: DomainAmounts = {
		sports: ggr.sports * input.rates.sports,
		casino: ggr.casino * input.rates.casino,
		matka: ggr.matka * input.rates.matka,
	};
	const gross = tallied(grossRaw, input.tally);

	const owedToChildren: OwedToChild[] = input.children.map((c) => {
		const raw: DomainAmounts = {
			sports: c.ggr.sports * c.rates.sports,
			casino: c.ggr.casino * c.rates.casino,
			matka: c.ggr.matka * c.rates.matka,
		};
		const effective = tallied(raw, c.tally);
		return {
			childId: c.childId,
			raw,
			effective,
			lossThisCycle: floorLoss(raw, c.tally),
			...applyCarry(effective.effectiveCalculatedTotal, c.previousCycleLoss ?? 0),
		};
	});

	const owedRaw = zeroAmounts();
	const owedEffective = zeroAmounts();
	let owedAfterCarry = 0;
	for (const o of owedToChildren) {
		addAmounts(owedRaw, o.raw);
		addAmounts(owedEffective, effectiveAmounts(o.effective));
		owedAfterCarry += o.grossAfterCarry;
	}

	const grossEffective = effectiveAmounts(gross);
	const netPerDomain: DomainAmounts = {
		sports: grossEffective.sports - owedEffective.sports,
		casino: grossEffective.casino - owedEffective.casino,
		matka: grossEffective.matka - owedEffective.matka,
	};
	const own = applyCarry(gross.effectiveCalculatedTotal, input.previousCycleLoss ?? 0);

	return {
		ggr,
		direct: { ...input.direct },
		grossRaw,
		gross,
		owedToChildren,
		netRaw: {
			sports: grossRaw.sports - owedRaw.sports,
			casino: grossRaw.casino - owedRaw.casino,
			matka: grossRaw.matka - owedRaw.matka,
		},
		net: { perDomain: netPerDomain, total: own.grossAfterCarry - owedAfterCarry },
		lossThisCycle: floorLoss(grossRaw, input.tally),
		...own,
	};
}

/** Round to cents; anything at or below one cent is nothing. */
export function roundPayable(raw: number): number {
	return raw <= 0.01 ? 0 : Math.round(raw * 100) / 100;
}

/** The losses one cycle leaves to carry into the next: the agent's own and each direct child's. */
export interface CycleLosses {
	self: number;
	byChild: Map<string, number>;
}

export function noLosses(): CycleLosses {
	return { self: 0, byChild: new Map<string, number>() };
}

/** The losses a cycle's result leaves (the caller applies the CARRY_FORWARD_FROM gate). */
export function cycleLosses(result: CycleCommissionResult): CycleLosses {
	return {
		self: result.lossThisCycle,
		byChild: new Map(result.owedToChildren.map((o): [string, number] => [o.childId, o.lossThisCycle])),
	};
}

/** The cycle's input with the previous cycle's losses carried in: the agent's own, and each child's own. */
export function withCarriedLosses(input: CycleCommissionInput, previous: CycleLosses): CycleCommissionInput {
	return {
		...input,
		previousCycleLoss: previous.self,
		children: input.children.map((c) => ({ ...c, previousCycleLoss: previous.byChild.get(c.childId) ?? 0 })),
	};
}
