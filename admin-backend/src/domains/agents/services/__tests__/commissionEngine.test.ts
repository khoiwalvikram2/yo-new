/**
 * Commission engine (agent-schemes hardening, W8). No database: repos, readers
 * and the rate loader are in-memory fakes, so every figure here is exact.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/commissionEngine.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CommissionCalculationService } from '../CommissionCalculationService.js';
import { CommissionReadinessService } from '../CommissionReadinessService.js';
import { CommissionCycleService } from '../CommissionCycleService.js';
import {
	computeCycleCommission,
	cycleBoundsFromKey,
	cycleKeyIST,
	resolveCommissionRate,
	type CommissionRateRow,
} from '../commissionCycleMath.js';
import { CARRY_FORWARD_FROM, getCurrentCycleIST, getLastNCompletedCycles } from '../CommissionCycleUtils.js';
import type { CycleAgentGGRRow, OpenBetCounts, VerticalReaders } from '../VerticalReaders.js';

const T = 't1';
const JAN = new Date('2026-01-01T00:00:00+05:30');

function agent(id: string, parentAgentId: string | null, extra: Record<string, unknown> = {}) {
	return {
		id,
		tenantId: T,
		schemeType: 'COMMISSION',
		status: 'ACTIVE',
		parentAgentId,
		allowedDomains: ['sports', 'casino', 'matka'],
		tallyEnabled: false,
		tallyDomains: [],
		createdAt: JAN,
		username: id,
		...extra,
	};
}

function rate(agentId: string, r: number, from: Date = JAN, domain = 'sports'): CommissionRateRow {
	return { agentId, domain, commissionRate: String(r), effectiveFrom: from, effectiveTo: null };
}

interface World {
	agents: Record<string, ReturnType<typeof agent>>;
	subtree: Record<string, string[]>;
	rates: CommissionRateRow[];
	ggr: CycleAgentGGRRow[];
	open?: OpenBetCounts;
	paidByCycle?: Record<string, Record<string, number>>; // agentId -> cycleKey -> amount
	appliedAdjustments?: Record<string, number>; // cycleKey -> amount
	pendingAdjustments?: number;
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
		countOpenBetsByAgentIds: async () => w.open ?? { sports: 0, casino: 0, matka: 0 },
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
		sumAppliedForCycle: async (_t: string, _a: string, from: Date) => w.appliedAdjustments?.[cycleKeyIST(from)] ?? 0,
		sumAppliedByTargetCycle: async () => new Map(Object.entries(w.appliedAdjustments ?? {})),
		countPendingForSourceCycle: async () => w.pendingAdjustments ?? 0,
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

// A closed cycle well in the past: Monday 2026-10-05 -> Monday 2026-10-12 IST.
const OCT5 = cycleBoundsFromKey('2026-10-05');

describe('3-level chain A 10% -> B 8% -> C 5%; C\'s players lose 1000', () => {
	const world: World = {
		agents: { A: agent('A', null), B: agent('B', 'A'), C: agent('C', 'B') },
		subtree: { A: ['A', 'B', 'C'], B: ['B', 'C'], C: ['C'] },
		rates: [rate('A', 0.1), rate('B', 0.08), rate('C', 0.05)],
		ggr: [{ cycleKey: '2026-10-05', agentId: 'C', sports: 1000, casino: 0, matka: 0 }],
	};
	const { calc, readiness } = fakes(world);

	it('what each payer owes is the payee\'s GROSS: admin->A 100, A->B 80, B->C 50', async () => {
		const gross = async (id: string) =>
			(await calc.calculateCommissionSummary(id, OCT5.from, OCT5.to, 'INR', 'gross')).effectiveCalculatedTotal;
		assert.equal(await gross('A'), 100);
		assert.equal(await gross('B'), 80);
		assert.equal(await gross('C'), 50);
	});

	it('My Share (net) is gross minus what is owed to the children: A 20, B 30, C 50, summing to the 100 the platform pays', async () => {
		const net = async (id: string) =>
			(await calc.calculateCommissionSummary(id, OCT5.from, OCT5.to, 'INR', 'net')).effectiveCalculatedTotal;
		const [a, b, c] = [await net('A'), await net('B'), await net('C')];
		assert.ok(Math.abs(a - 20) < 1e-9, `A net ${a}`);
		assert.ok(Math.abs(b - 30) < 1e-9, `B net ${b}`);
		assert.ok(Math.abs(c - 50) < 1e-9, `C net ${c}`);
		assert.ok(Math.abs(a + b + c - 100) < 1e-9);
	});

	it('a net-mode summary still carries the gross the parent owes', async () => {
		const s = await calc.calculateCommissionSummary('B', OCT5.from, OCT5.to, 'INR', 'net');
		assert.equal(s.grossEffectiveCalculatedTotal, 80);
		assert.ok(Math.abs((s.netEffectiveCalculatedTotal ?? 0) - 30) < 1e-9);
	});

	it('readiness (what payCommission checks) gives B 80 whichever mode is asked — never the 30 net', async () => {
		for (const mode of ['net', 'gross'] as const) {
			const r = await readiness.getReadiness('B', OCT5.from, OCT5.to, T, 'INR', mode);
			assert.equal(r.payableAmount, 80, mode);
			assert.equal(r.calculatedTotal, 80, mode);
		}
	});
});

describe('rates are resolved per cycle, so ranges sum cycle by cycle', () => {
	// S earns 10% until Monday 2026-10-12, 20% from then.
	const world: World = {
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1), rate('S', 0.2, cycleBoundsFromKey('2026-10-12').from)],
		ggr: [
			{ cycleKey: '2026-09-28', agentId: 'S', sports: -2000, casino: 0, matka: 0 }, // players won: 0, not -200
			{ cycleKey: '2026-10-05', agentId: 'S', sports: 1000, casino: 0, matka: 0 }, // 10% -> 100
			{ cycleKey: '2026-10-12', agentId: 'S', sports: 500, casino: 0, matka: 0 }, // 20% -> 100
		],
		paidByCycle: { S: { '2026-10-05': 100 } },
	};
	const { calc } = fakes(world);

	it('an all-time range (from 1970) is the sum of each cycle at its own rate, max(0) per cycle', async () => {
		const s = await calc.calculateCommissionSummary('S', new Date(0), cycleBoundsFromKey('2026-10-19').from, 'INR', 'gross');
		assert.equal(s.effectiveCalculatedTotal, 200);
		assert.equal(s.cycles?.length, 3);
		assert.deepEqual(
			s.cycles?.map((c) => [c.cycleKey, c.rates.sports, c.grossEffective]),
			[
				['2026-09-28', 0.1, 0],
				['2026-10-05', 0.1, 100],
				['2026-10-12', 0.2, 100],
			],
		);
	});

	it('a single cycle is unchanged: its own rate, its own GGR', async () => {
		const oct12 = cycleBoundsFromKey('2026-10-12');
		const s = await calc.calculateCommissionSummary('S', oct12.from, oct12.to, 'INR', 'gross');
		assert.equal(s.effectiveCalculatedTotal, 100);
		assert.equal(s.sportsCommissionRate, 0.2);
		const s5 = await calc.calculateCommissionSummary('S', OCT5.from, OCT5.to, 'INR', 'gross');
		assert.equal(s5.effectiveCalculatedTotal, 100);
		assert.equal(s5.sportsCommissionRate, 0.1);
	});

	it('all-time pending subtracts what was paid for each cycle (paid 100 for Oct 5 -> 100 left)', async () => {
		const u = await calc.getUnifiedCommission('S', 'INR', T, {
			periodFrom: new Date(0),
			periodTo: cycleBoundsFromKey('2026-10-19').from,
			mode: 'net',
		});
		assert.equal(u.paid, 100);
		assert.equal(u.pending, 100);
	});

	it('resolveCommissionRate matches getCommissionConfig: newest effectiveFrom <= at, nothing before the first row', () => {
		assert.equal(resolveCommissionRate(world.rates, 'S', 'sports', new Date('2025-12-01T00:00:00Z')), 0);
		assert.equal(resolveCommissionRate(world.rates, 'S', 'sports', OCT5.from), 0.1);
		assert.equal(resolveCommissionRate(world.rates, 'S', 'sports', cycleBoundsFromKey('2026-10-12').from), 0.2);
		const ended: CommissionRateRow[] = [{ agentId: 'S', domain: 'sports', commissionRate: '0.3', effectiveFrom: JAN, effectiveTo: OCT5.from }];
		assert.equal(resolveCommissionRate(ended, 'S', 'sports', cycleBoundsFromKey('2026-10-12').from), 0);
	});
});

describe('readiness: open bets and unresolved adjustments block payment', () => {
	const [last] = getLastNCompletedCycles(1);
	const key = cycleKeyIST(last.periodFrom);
	const base = (): World => ({
		agents: { S: agent('S', null) },
		subtree: { S: ['S'] },
		rates: [rate('S', 0.1)],
		ggr: [{ cycleKey: key, agentId: 'S', sports: 1000, casino: 0, matka: 0 }],
		posted: 100,
	});

	it('a cycle with bets still open is MISSING_BETS and not ready', async () => {
		const { readiness } = fakes({ ...base(), open: { sports: 2, casino: 1, matka: 0 } });
		const r = await readiness.getReadiness('S', last.periodFrom, last.periodTo, T, 'INR');
		assert.equal(r.ready, false);
		assert.ok(r.reasons.includes('MISSING_BETS'));
		assert.equal(r.openBets, 3);
	});

	it('a PENDING adjustment raised against the cycle is UNRESOLVED_ADJUSTMENT and not ready', async () => {
		const { readiness } = fakes({ ...base(), pendingAdjustments: 1 });
		const r = await readiness.getReadiness('S', last.periodFrom, last.periodTo, T, 'INR');
		assert.equal(r.ready, false);
		assert.ok(r.reasons.includes('UNRESOLVED_ADJUSTMENT'));
	});

	it('with neither, the cycle is READY for its gross and LEDGER_GAP stays quiet when the ledger matches', async () => {
		const { readiness } = fakes(base());
		const r = await readiness.getReadiness('S', last.periodFrom, last.periodTo, T, 'INR');
		assert.deepEqual(r.reasons, ['READY']);
		assert.equal(r.payableAmount, 100);
	});

	it('an already-paid cycle has nothing payable', async () => {
		const { readiness } = fakes({ ...base(), paidByCycle: { S: { [key]: 100 } } });
		const r = await readiness.getReadiness('S', last.periodFrom, last.periodTo, T, 'INR');
		assert.equal(r.payableAmount, 0);
	});
});

describe('cycle list: a zero-commission week is SETTLED without a payout', () => {
	const [c1, c2, c3] = getLastNCompletedCycles(3); // newest first
	const k = (d: Date) => cycleKeyIST(d);
	const current = getCurrentCycleIST();
	const world: World = {
		agents: { Z: agent('Z', null, { createdAt: c3.periodFrom }) },
		subtree: { Z: ['Z'] },
		rates: [rate('Z', 0.1)],
		ggr: [
			{ cycleKey: k(c3.periodFrom), agentId: 'Z', sports: -500, casino: 0, matka: 0 }, // players won -> nothing owed
			{ cycleKey: k(c2.periodFrom), agentId: 'Z', sports: 1000, casino: 0, matka: 0 }, // 100 unpaid
			{ cycleKey: k(c1.periodFrom), agentId: 'Z', sports: 1000, casino: 0, matka: 0 }, // 100 paid
		],
		paidByCycle: { Z: { [k(c1.periodFrom)]: 100 } },
	};
	const { agentsRepo, payoutsRepo, calc } = fakes(world);
	const service = new CommissionCycleService(agentsRepo, payoutsRepo, calc);

	it('lists every cycle since creation with status, payable and paid', async () => {
		const cycles = await service.listCyclesForAgent('Z', T);
		assert.equal(cycles.length, 4);
		const [zero, unpaid, paid, open] = cycles;
		assert.equal(zero.status, 'SETTLED');
		assert.equal(zero.zeroCommission, true);
		assert.equal(zero.payableAmount, 0);
		assert.equal(unpaid.status, 'CLOSED_UNSETTLED');
		// Once c3 starts on/after CARRY_FORWARD_FROM its loss (raw -50) carries into c2 (spec §3).
		const carried = c3.periodFrom.getTime() >= CARRY_FORWARD_FROM.getTime() ? 50 : 0;
		assert.equal(unpaid.payableAmount, 100 - carried);
		assert.equal(paid.status, 'SETTLED');
		assert.equal(paid.zeroCommission, false);
		assert.equal(paid.paidAmount, 100);
		assert.equal(open.status, 'OPEN');
		assert.equal(open.from.getTime(), current.from.getTime());
	});
});

describe('computeCycleCommission edge: a parent whose own players won still owes its child', () => {
	it('net (My Share) can go below zero: it is cash, gross received minus gross paid down', () => {
		const r = computeCycleCommission({
			direct: { sports: -1000, casino: 0, matka: 0 },
			rates: { sports: 0.1, casino: 0, matka: 0 },
			tally: { enabled: false, domains: [] },
			children: [
				{ childId: 'K', ggr: { sports: 500, casino: 0, matka: 0 }, rates: { sports: 0.05, casino: 0, matka: 0 }, tally: { enabled: false, domains: [] } },
			],
		});
		assert.equal(r.gross.effectiveCalculatedTotal, 0); // subtree GGR -500 -> raw -50 -> max(0) = 0
		assert.equal(r.owedToChildren[0].effective.effectiveCalculatedTotal, 25);
		assert.equal(r.net.total, -25);
	});
});
