/**
 * Loss carry-forward maths (docs/superpowers/specs/2026-10-22-agent-features-design.md §3,
 * approach A). Pure: no database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/commissionCarryMath.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTallyRulesForSettlement, floorLossForSettlement } from '../commissionTallyRules.js';
import {
	applyCarry,
	carryLookbackWindow,
	computeCycleCommission,
	cycleBoundsFromKey,
	cycleLosses,
	nextCycleKey,
	previousCycleKey,
	withCarriedLosses,
	type TallyConfig,
} from '../commissionCycleMath.js';
import { CARRY_FORWARD_FROM, lossCarriesForward } from '../CommissionCycleUtils.js';

/** Equal within 1e-9: rates such as 0.08 are not exact in binary. */
function near(actual: number | null | undefined, expected: number, label = ''): void {
	assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

describe('floorLossForSettlement: what the floor removed, by tally bucket', () => {
	it('tally OFF: every domain is its own bucket', () => {
		assert.equal(floorLossForSettlement(50, -80, -20, false, null), 100);
		assert.equal(floorLossForSettlement(100, 20, 5, false, null), 0);
	});

	it('tally ON with no valid domain is tally OFF', () => {
		assert.equal(floorLossForSettlement(50, -80, -20, true, []), 100);
		assert.equal(floorLossForSettlement(50, -80, -20, true, ['poker']), 100);
	});

	it('tally ON: the tallied domains net first; the other domains stay separate', () => {
		assert.equal(floorLossForSettlement(50, -80, -20, true, ['sports', 'casino']), 50); // group -30, matka -20
		assert.equal(floorLossForSettlement(100, -50, 20, true, ['sports', 'casino', 'matka']), 0); // group +70
		assert.equal(floorLossForSettlement(10, -50, 10, true, ['sports', 'casino', 'matka']), 30); // group -30
	});

	it('equals what applyTallyRulesForSettlement floored away: effective total minus the raw sum', () => {
		const tallies: Array<[boolean, string[] | null]> = [
			[false, null],
			[true, ['sports', 'casino']],
			[true, ['sports', 'casino', 'matka']],
			[true, ['matka']],
		];
		const values = [-120, -30, 0, 45, 200];
		for (const [enabled, domains] of tallies) {
			for (const s of values) {
				for (const c of values) {
					for (const m of values) {
						const e = applyTallyRulesForSettlement(s, c, m, enabled, domains);
						near(floorLossForSettlement(s, c, m, enabled, domains), e.effectiveCalculatedTotal - (s + c + m), `${enabled} ${domains} ${s}/${c}/${m}`);
					}
				}
			}
		}
	});
});

const OFF: TallyConfig = { enabled: false, domains: [] };
const NO_GGR = { sports: 0, casino: 0, matka: 0 };
/** Monday 2026-10-19 00:00 IST (the spec's carry-forward start), for the pure window maths. */
const CUT = new Date('2026-10-19T00:00:00+05:30');

describe('applyCarry: one line off the gross, never below 0', () => {
	it('a carry smaller than the gross is taken off in full', () => {
		assert.deepEqual(applyCarry(300, 200), { carriedLoss: 200, carryApplied: 200, grossAfterCarry: 100 });
	});

	it('a carry larger than the gross takes it to 0; the rest is forgiven', () => {
		assert.deepEqual(applyCarry(100, 250), { carriedLoss: 250, carryApplied: 100, grossAfterCarry: 0 });
	});

	it('no carry (0, negative or not a number) changes nothing', () => {
		for (const carried of [0, -5, Number.NaN]) {
			assert.deepEqual(applyCarry(100, carried), { carriedLoss: 0, carryApplied: 0, grossAfterCarry: 100 });
		}
	});
});

describe('computeCycleCommission with a carried loss', () => {
	it('parent and child each carry their own loss; the parent\'s net is its gross after carry minus the child\'s', () => {
		const r = computeCycleCommission({
			direct: NO_GGR,
			rates: { sports: 0.1, casino: 0, matka: 0 },
			tally: OFF,
			previousCycleLoss: 200,
			children: [{ childId: 'K', ggr: { sports: 3000, casino: 0, matka: 0 }, rates: { sports: 0.08, casino: 0, matka: 0 }, tally: OFF, previousCycleLoss: 160 }],
		});
		near(r.gross.effectiveCalculatedTotal, 300, 'gross before carry');
		near(r.grossAfterCarry, 100, 'gross after carry');
		near(r.carryApplied, 200, 'applied');
		near(r.owedToChildren[0].grossAfterCarry, 80, 'owed to K after K\'s carry');
		near(r.owedToChildren[0].carryApplied, 160, 'K applied');
		near(r.net.total, 20, 'net = 100 - 80');
		near(r.net.perDomain.sports, 60, 'per domain stays before the carry: 300 - 240');
		assert.equal(r.lossThisCycle, 0);
	});

	it('without a carried loss nothing changes: the net total is the per-domain sum', () => {
		const r = computeCycleCommission({
			direct: { sports: 1000, casino: -200, matka: 0 },
			rates: { sports: 0.1, casino: 0.1, matka: 0 },
			tally: OFF,
			children: [],
		});
		near(r.grossAfterCarry, r.gross.effectiveCalculatedTotal, 'after = before');
		near(r.net.total, r.net.perDomain.sports + r.net.perDomain.casino + r.net.perDomain.matka, 'net total');
		assert.equal(r.carriedLoss, 0);
		near(r.lossThisCycle, 20, 'casino -200 x 10% floored away');
	});

	it('a losing week reports what the floor removed, for the agent and for each child', () => {
		const r = computeCycleCommission({
			direct: { sports: -1000, casino: 0, matka: 0 },
			rates: { sports: 0.1, casino: 0, matka: 0 },
			tally: OFF,
			children: [{ childId: 'K', ggr: { sports: -500, casino: 0, matka: 0 }, rates: { sports: 0.05, casino: 0, matka: 0 }, tally: OFF }],
		});
		near(r.lossThisCycle, 150, 'own: (-1000 - 500) x 10%');
		near(r.owedToChildren[0].lossThisCycle, 25, 'K: -500 x 5%');
		assert.equal(r.grossAfterCarry, 0);
	});

	it('cycleLosses / withCarriedLosses hand each agent its own previous loss', () => {
		const previous = computeCycleCommission({
			direct: { sports: -1000, casino: 0, matka: 0 },
			rates: { sports: 0.1, casino: 0, matka: 0 },
			tally: OFF,
			children: [{ childId: 'K', ggr: { sports: -500, casino: 0, matka: 0 }, rates: { sports: 0.05, casino: 0, matka: 0 }, tally: OFF }],
		});
		const input = withCarriedLosses(
			{
				direct: NO_GGR,
				rates: { sports: 0.1, casino: 0, matka: 0 },
				tally: OFF,
				children: [
					{ childId: 'K', ggr: { sports: 3000, casino: 0, matka: 0 }, rates: { sports: 0.05, casino: 0, matka: 0 }, tally: OFF },
					{ childId: 'L', ggr: NO_GGR, rates: { sports: 0.05, casino: 0, matka: 0 }, tally: OFF },
				],
			},
			cycleLosses(previous),
		);
		near(input.previousCycleLoss, 150, 'own');
		near(input.children[0].previousCycleLoss, 25, 'K');
		assert.equal(input.children[1].previousCycleLoss, 0); // L had no previous loss
	});
});

describe('cycle keys and the carry lookback window', () => {
	const at = (key: string) => cycleBoundsFromKey(key);

	it('previous / next cycle keys step one IST week, across a year end', () => {
		assert.equal(previousCycleKey('2026-10-26'), '2026-10-19');
		assert.equal(nextCycleKey('2026-10-19'), '2026-10-26');
		assert.equal(previousCycleKey('2027-01-04'), '2026-12-28');
	});

	it('a range starting on a cycle start needs the whole cycle before it', () => {
		assert.deepEqual(carryLookbackWindow(at('2026-10-26').from, at('2026-11-02').to, CUT), { from: at('2026-10-19').from, to: at('2026-10-26').from });
	});

	it('a range starting mid-cycle also needs its whole first cycle', () => {
		const midWeek = new Date('2026-10-28T10:00:00+05:30');
		assert.deepEqual(carryLookbackWindow(midWeek, at('2026-11-02').to, CUT), { from: at('2026-10-19').from, to: at('2026-11-02').from });
	});

	it('nothing is needed when no cycle of the window can carry, or the range is empty', () => {
		assert.equal(carryLookbackWindow(at('2026-10-19').from, at('2026-10-26').from, CUT), null);
		assert.equal(carryLookbackWindow(new Date(0), at('2026-11-02').from, CUT), null);
		assert.equal(carryLookbackWindow(at('2026-10-26').from, at('2026-10-26').from, CUT), null);
	});
});

describe('CARRY_FORWARD_FROM: the rule starts with the week of 2026-10-19 IST', () => {
	it('is Monday 2026-10-19 00:00 IST, the start of a cycle', () => {
		assert.equal(CARRY_FORWARD_FROM.getTime(), CUT.getTime());
		assert.equal(cycleBoundsFromKey('2026-10-19').from.getTime(), CARRY_FORWARD_FROM.getTime());
	});

	it('a week starting before it leaves no loss to carry; that week and later ones do', () => {
		assert.equal(lossCarriesForward(cycleBoundsFromKey('2026-10-12').from), false);
		assert.equal(lossCarriesForward(cycleBoundsFromKey('2026-10-19').from), true);
		assert.equal(lossCarriesForward(cycleBoundsFromKey('2026-10-26').from), true);
		assert.equal(lossCarriesForward(cycleBoundsFromKey('2026-10-26').from, cycleBoundsFromKey('2026-11-02').from), false);
	});
});
