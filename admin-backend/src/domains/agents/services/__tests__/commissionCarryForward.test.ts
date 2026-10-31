/**
 * Loss carry-forward, one week, approach A (docs/superpowers/specs/2026-10-22-agent-features-design.md §3).
 * No database: repos, readers and the rate loader are in-memory fakes, as in
 * commissionEngine.test.ts. Week keys are fixed IST Mondays; CARRY_FORWARD_FROM
 * is the week of 2026-10-19.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/commissionCarryForward.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionCalculationService } from '../CommissionCalculationService.js';
import { CommissionReadinessService } from '../CommissionReadinessService.js';
import { CommissionCycleService } from '../CommissionCycleService.js';
import { cycleBoundsFromKey, cycleKeyIST, type CommissionRateRow } from '../commissionCycleMath.js';
import type { CycleAgentGGRRow, OpenBetCounts, VerticalReaders } from '../VerticalReaders.js';

const T = 't1';
const JAN = new Date('2026-01-01T00:00:00+05:30');
const NONE: OpenBetCounts = { sports: 0, casino: 0, matka: 0 };

// IST Monday keys. W0 is before the rule; W1 is CARRY_FORWARD_FROM.
const W0 = '2026-10-12';
const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';
const week = (key: string) => cycleBoundsFromKey(key);

/** Equal within 1e-9: rates such as 0.08 are not exact in binary. */
function near(actual: number | null | undefined, expected: number, label = ''): void {
	assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

function agent(id: string, parentAgentId: string | null, extra: Record<string, unknown> = {}) {
	return {
		id,
		tenantId: T,
		schemeType: 'COMMISSION',
		status: 'ACTIVE',
		parentAgentId,
		allowedDomains: ['sports', 'casino', 'matka'],
		tallyEnabled: false,
		tallyDomains: [] as string[],
		createdAt: JAN,
		username: id,
		...extra,
	};
}

function rate(agentId: string, r: number, domain = 'sports'): CommissionRateRow {
	return { agentId, domain, commissionRate: String(r), effectiveFrom: JAN, effectiveTo: null };
}

function sportsGgr(cycleKey: string, agentId: string, sports: number): CycleAgentGGRRow {
	return { cycleKey, agentId, sports, casino: 0, matka: 0 };
}

interface World {
	agents: Record<string, ReturnType<typeof agent>>;
	subtree: Record<string, string[]>;
	rates: CommissionRateRow[];
	ggr: CycleAgentGGRRow[];
	/** Open bets by the IST cycle a counted range starts in. */
	openByCycle?: Record<string, OpenBetCounts>;
	paidByCycle?: Record<string, Record<string, number>>; // agentId -> cycleKey -> amount
	posted?: number;
}

function fakes(w: World) {
	const agentsRepo: any = {
		findById: async (id: string) => w.agents[id] ?? null,
		listChildren: async (id: string) => Object.values(w.agents).filter((a) => a.parentAgentId === id),
		getDescendantIds: async (id: string) => w.subtree[id] ?? [id],
	};
	const overlaps = (key: string, from: Date, to: Date) => {
		const b = cycleBoundsFromKey(key);
		return b.from.getTime() < to.getTime() && b.to.getTime() > from.getTime();
	};
	const readers: VerticalReaders = {
		getSportsGGR: async () => ({ ggr: 0 }),
		getCasinoGGR: async () => ({ ggr: 0 }),
		getMatkaGGR: async () => ({ ggr: 0 }),
		getGGRByCycleAndAgent: async ({ agentIds, from, to }) =>
			w.ggr.filter((r) => agentIds.includes(r.agentId) && overlaps(r.cycleKey, from, to)),
		countOpenBetsByAgentIds: async ({ from }) => w.openByCycle?.[cycleKeyIST(from)] ?? NONE,
	};
	const payoutsRepo: any = {
		getTotalPaidForCycle: async (_t: string, agentId: string, from: Date) =>
			w.paidByCycle?.[agentId]?.[cycleKeyIST(from)] ?? 0,
		getPaidByCycleForAgents: async (_t: string, agentIds: string[]) => {
			const out = new Map<string, Map<string, number>>();
			for (const id of agentIds) out.set(id, new Map(Object.entries(w.paidByCycle?.[id] ?? {})));
			return out;
		},
	};
	const adjustments: any = {
		sumAppliedForCycle: async () => 0,
		sumAppliedByTargetCycle: async () => new Map<string, number>(),
		countPendingForSourceCycle: async () => 0,
	};
	const ledgerRepo: any = { getEarnedPostedSum: async () => w.posted ?? 0 };
	const rateRowsLoader = async (ids: string[]) => w.rates.filter((r) => ids.includes(r.agentId));
	const calc = new CommissionCalculationService(agentsRepo, {} as any, ledgerRepo, readers, payoutsRepo, {
		rateRowsLoader,
		adjustmentsReader: adjustments,
	});
	const readiness = new CommissionReadinessService(agentsRepo, {} as any, ledgerRepo, payoutsRepo, {
		ggrReaders: readers,
		adjustments,
		rateRowsLoader,
	});
	return { agentsRepo, payoutsRepo, calc, readiness };
}

describe('3-level A 10% -> B 8% -> C 5%: C\'s players win 2000 in W1, then lose 3000 in W2', () => {
	const world: World = {
		agents: { A: agent('A', null), B: agent('B', 'A'), C: agent('C', 'B') },
		subtree: { A: ['A', 'B', 'C'], B: ['B', 'C'], C: ['C'] },
		rates: [rate('A', 0.1), rate('B', 0.08), rate('C', 0.05)],
		ggr: [sportsGgr(W1, 'C', -2000), sportsGgr(W2, 'C', 3000)],
	};
	const { calc, readiness } = fakes(world);
	const summary = (id: string, key: string, mode: 'net' | 'gross') =>
		calc.calculateCommissionSummary(id, week(key).from, week(key).to, 'INR', mode);

	it('W1: nobody is owed anything; each agent\'s floor removed its own loss', async () => {
		for (const [id, loss] of [['A', 200], ['B', 160], ['C', 100]] as const) {
			const s = await summary(id, W1, 'gross');
			assert.equal(s.effectiveCalculatedTotal, 0, id);
			near(s.lossThisCycle, loss, `${id} loss`);
			assert.equal(s.carriedLoss, 0, id);
		}
	});

	it('W2: each payable is the payee\'s own gross after its own carry: admin->A 100, A->B 80, B->C 50', async () => {
		for (const [id, gross, carried] of [['A', 100, 200], ['B', 80, 160], ['C', 50, 100]] as const) {
			const s = await summary(id, W2, 'gross');
			near(s.effectiveCalculatedTotal, gross, `${id} gross after carry`);
			near(s.grossEffectiveCalculatedTotal, gross, `${id} grossEffectiveCalculatedTotal`);
			near(s.carriedLoss, carried, `${id} carried`);
			near(s.carryApplied, carried, `${id} applied`);
			// Per domain stays as computed, before the carry: the carry is one line.
			near(s.grossEffectiveSportsCommission, gross + carried, `${id} sports before carry`);
			const r = await readiness.getReadiness(id, week(W2).from, week(W2).to, T, 'INR');
			near(r.payableAmount, gross, `${id} readiness payable`);
		}
	});

	it('W2 My Share: own gross after carry minus the child\'s gross after its carry (A 20, B 30, C 50, summing to the 100 paid)', async () => {
		let sum = 0;
		for (const [id, expected] of [['A', 20], ['B', 30], ['C', 50]] as const) {
			const s = await summary(id, W2, 'net');
			near(s.effectiveCalculatedTotal, expected, `${id} net`);
			near(s.netEffectiveCalculatedTotal, expected, `${id} netEffectiveCalculatedTotal`);
			sum += s.effectiveCalculatedTotal;
		}
		near(sum, 100, 'the nets add up to what the platform pays A');
	});

	it('a two-week range sums cycle by cycle (0 + 100 for A), with the carry in its W2 row', async () => {
		const s = await calc.calculateCommissionSummary('A', week(W1).from, week(W2).to, 'INR', 'gross');
		near(s.effectiveCalculatedTotal, 100, 'A over W1..W2');
		near(s.carryApplied, 200, 'A applied');
		assert.deepEqual(s.cycles?.map((c) => c.cycleKey), [W1, W2]);
		const w2 = s.cycles![1];
		near(w2.grossBeforeCarry, 300, 'W2 before carry');
		near(w2.grossEffective, 100, 'W2 after carry');
		near(w2.carriedLoss, 200, 'W2 carried');
		near(s.cycles![0].lossThisCycle, 200, 'W1 loss that carries');
	});

	it('all-time pending is the sum of the cycles after carry', async () => {
		const u = await calc.getUnifiedCommission('A', 'INR', T, { periodFrom: new Date(0), periodTo: week(W3).from });
		assert.equal(u.pending, 100);
	});
});

describe('a loss not recovered in the next week is forgiven, never carried further', () => {
	const world: World = {
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [sportsGgr(W1, 'S', -2000), sportsGgr(W2, 'S', 1000), sportsGgr(W3, 'S', 1000)],
	};
	const { calc } = fakes(world);

	it('W2 recovers 100 of the 200 carried; the other 100 is forgiven', async () => {
		const s = await calc.calculateCommissionSummary('S', week(W2).from, week(W2).to, 'INR', 'gross');
		assert.equal(s.effectiveCalculatedTotal, 0);
		near(s.carriedLoss, 200, 'carried');
		near(s.carryApplied, 100, 'applied');
		assert.equal(s.lossThisCycle, 0); // W2's own gross is positive: nothing new carries
	});

	it('W3 is owed in full: the forgiven 100 never reaches it', async () => {
		const s = await calc.calculateCommissionSummary('S', week(W3).from, week(W3).to, 'INR', 'gross');
		near(s.effectiveCalculatedTotal, 100, 'W3');
		assert.equal(s.carriedLoss, 0);
		const all = await calc.calculateCommissionSummary('S', week(W1).from, week(W3).to, 'INR', 'gross');
		near(all.effectiveCalculatedTotal, 100, 'W1..W3 = 0 + 0 + 100');
	});
});

describe('a week before CARRY_FORWARD_FROM carries nothing', () => {
	const world: World = {
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [sportsGgr(W0, 'S', -2000), sportsGgr(W1, 'S', 1000)],
	};
	const { calc } = fakes(world);

	it('W0 lost 200, yet W1 (the first week of the rule) is owed its full 100', async () => {
		const s = await calc.calculateCommissionSummary('S', week(W1).from, week(W1).to, 'INR', 'gross');
		near(s.effectiveCalculatedTotal, 100, 'W1');
		assert.equal(s.carriedLoss, 0);
		const w0 = await calc.calculateCommissionSummary('S', week(W0).from, week(W0).to, 'INR', 'gross');
		assert.equal(w0.lossThisCycle, 0); // W0's loss does not carry, so none is shown as carrying
	});

	it('a range across the cut-over: W0 0 + W1 100, nothing applied', async () => {
		const s = await calc.calculateCommissionSummary('S', week(W0).from, week(W1).to, 'INR', 'gross');
		near(s.effectiveCalculatedTotal, 100, 'W0..W1');
		assert.equal(s.carryApplied, 0);
	});
});

describe('a week with no bets yet still shows the loss carried into it', () => {
	const world: World = {
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [sportsGgr(W1, 'S', -2000)],
	};
	const { calc } = fakes(world);

	it('W2 has no bets: carried 200, nothing applied, nothing owed', async () => {
		const s = await calc.calculateCommissionSummary('S', week(W2).from, week(W2).to, 'INR', 'gross');
		near(s.carriedLoss, 200, 'carried');
		assert.equal(s.carryApplied, 0);
		assert.equal(s.effectiveCalculatedTotal, 0);
		assert.deepEqual(s.cycles?.map((c) => [c.cycleKey, c.ggr, c.grossEffective]), [[W2, 0, 0]]);
	});
});

describe('the carried loss uses the previous week\'s tally buckets', () => {
	const rates3 = (id: string) => [rate(id, 0.1, 'sports'), rate(id, 0.1, 'casino'), rate(id, 0.1, 'matka')];
	const world: World = {
		agents: {
			ON: agent('ON', null, { tallyEnabled: true, tallyDomains: ['sports', 'casino'] }),
			OFF: agent('OFF', null),
		},
		subtree: { ON: ['ON'], OFF: ['OFF'] },
		rates: [...rates3('ON'), ...rates3('OFF')],
		ggr: [
			{ cycleKey: W1, agentId: 'ON', sports: 500, casino: -800, matka: -200 },
			{ cycleKey: W1, agentId: 'OFF', sports: 500, casino: -800, matka: -200 },
			sportsGgr(W2, 'ON', 1000),
			sportsGgr(W2, 'OFF', 1000),
		],
	};
	const { calc } = fakes(world);

	it('tally ON (sports+casino): loss = group 30 + matka 20 = 50; W2 is owed 100 - 50', async () => {
		const w1 = await calc.calculateCommissionSummary('ON', week(W1).from, week(W1).to, 'INR', 'gross');
		assert.equal(w1.effectiveCalculatedTotal, 0);
		near(w1.lossThisCycle, 50, 'ON W1 loss');
		const w2 = await calc.calculateCommissionSummary('ON', week(W2).from, week(W2).to, 'INR', 'gross');
		near(w2.effectiveCalculatedTotal, 50, 'ON W2');
		near(w2.carryApplied, 50, 'ON applied');
	});

	it('tally OFF: loss = casino 80 + matka 20 = 100 (sports 50 was owed in W1); W2 is owed 0', async () => {
		const w1 = await calc.calculateCommissionSummary('OFF', week(W1).from, week(W1).to, 'INR', 'gross');
		near(w1.effectiveCalculatedTotal, 50, 'OFF W1 sports');
		near(w1.lossThisCycle, 100, 'OFF W1 loss');
		const w2 = await calc.calculateCommissionSummary('OFF', week(W2).from, week(W2).to, 'INR', 'gross');
		near(w2.effectiveCalculatedTotal, 0, 'OFF W2');
		near(w2.carriedLoss, 100, 'OFF carried');
		near(w2.carryApplied, 100, 'OFF applied');
	});
});

describe('a paid cycle is frozen', () => {
	const base = (w1Loss: number): World => ({
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [sportsGgr(W1, 'S', -w1Loss), sportsGgr(W2, 'S', 2000)],
		paidByCycle: { S: { [W2]: 100 } },
	});
	const NOW = new Date('2026-11-04T12:00:00+05:30');

	it('W2 was paid 200 - 100 carried = 100: nothing is payable, and the list shows the carry it was paid with', async () => {
		const { calc } = fakes(base(1000));
		const w2 = (await calc.listCyclePayables('S', T, 'INR', NOW)).find((r) => r.cycleKey === W2)!;
		assert.equal(w2.paid, 100);
		assert.equal(w2.payable, 0);
		near(w2.calculatedTotal, 100, 'gross after carry');
		near(w2.carriedLoss, 100, 'carried');
		near(w2.carryApplied, 100, 'applied');
	});

	it('a later change to W1 (a resettled bet: loss 150) re-opens nothing: payable 0, paid 100, pending 0', async () => {
		const { calc, readiness } = fakes(base(1500));
		const w2 = (await calc.listCyclePayables('S', T, 'INR', NOW)).find((r) => r.cycleKey === W2)!;
		assert.equal(w2.payable, 0);
		assert.equal(w2.paid, 100);
		const r = await readiness.getReadiness('S', week(W2).from, week(W2).to, T, 'INR');
		assert.equal(r.payableAmount, 0);
		assert.equal(r.paidInCycle, 100);
		const u = await calc.getUnifiedCommission('S', 'INR', T, { periodFrom: week(W1).from, periodTo: week(W3).from });
		assert.equal(u.paid, 100);
		assert.equal(u.pending, 0);
	});
});

describe('the cycle list carries the carry figures', () => {
	it('the W1 row shows the loss it carries on; W1 carries nothing in (W0 is before the rule)', async () => {
		const world: World = {
			agents: { S: agent('S', null) },
			subtree: { S: ['S'] },
			rates: [rate('S', 0.1)],
			ggr: [sportsGgr(W0, 'S', -500), sportsGgr(W1, 'S', -1000)],
		};
		const { agentsRepo, payoutsRepo, calc } = fakes(world);
		const rows = await new CommissionCycleService(agentsRepo, payoutsRepo, calc).listCyclesForAgent('S', T);
		const w1 = rows.find((r) => cycleKeyIST(r.from) === W1)!;
		near(w1.lossThisCycle, 100, 'W1 loss that carries');
		assert.equal(w1.carriedLoss, 0);
		const w0 = rows.find((r) => cycleKeyIST(r.from) === W0)!;
		assert.equal(w0.lossThisCycle, 0);
	});
});

describe('readiness: open bets of the previous week hold this week (its loss carries in)', () => {
	const world = (open: Record<string, OpenBetCounts>, posted = 200): World => ({
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [sportsGgr(W1, 'S', -1000), sportsGgr(W2, 'S', 2000)],
		openByCycle: open,
		posted,
	});

	it('W1 still has 2 open bets: W2 is MISSING_BETS and not ready, though W2 itself has none', async () => {
		const { readiness } = fakes(world({ [W1]: { sports: 2, casino: 0, matka: 0 } }));
		const r = await readiness.getReadiness('S', week(W2).from, week(W2).to, T, 'INR');
		assert.equal(r.ready, false);
		assert.ok(r.reasons.includes('MISSING_BETS'));
		assert.equal(r.openBets, 0);
		assert.equal(r.previousCycleOpenBets, 2);
		near(r.carriedLoss, 100, 'carried');
		near(r.carryApplied, 100, 'applied');
		near(r.calculatedTotal, 100, 'gross after carry');
	});

	it('once they settle W2 pays its gross after carry; the ledger (gross before carry, 200) shows no gap', async () => {
		const { readiness } = fakes(world({}));
		const r = await readiness.getReadiness('S', week(W2).from, week(W2).to, T, 'INR');
		assert.equal(r.previousCycleOpenBets, 0);
		assert.equal(r.reasons.includes('MISSING_BETS'), false);
		assert.equal(r.reasons.includes('LEDGER_GAP'), false);
		near(r.payableAmount, 100, 'payable');
		const gap = await fakes(world({}, 100)).readiness.getReadiness('S', week(W2).from, week(W2).to, T, 'INR');
		assert.ok(gap.reasons.includes('LEDGER_GAP'), 'posted 100 vs the gross before carry 200');
	});

	it('before CARRY_FORWARD_FROM the previous week is not checked: W0 open bets do not hold W1', async () => {
		const { readiness } = fakes(world({ [W0]: { sports: 4, casino: 0, matka: 0 } }));
		const r = await readiness.getReadiness('S', week(W1).from, week(W1).to, T, 'INR');
		assert.equal(r.previousCycleOpenBets, 0);
		assert.equal(r.reasons.includes('MISSING_BETS'), false);
	});
});
