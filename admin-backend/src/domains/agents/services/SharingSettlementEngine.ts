import { rateAt, rateChangePoints, type RateRow } from './agentMutationRules';
import { nextSharingWindow } from './SettlementPeriodUtils';
import type { VerticalReaders } from './VerticalReaders';

/**
 * SHARING settlement engine — the one place that decides, for a SHARING agent:
 *  - which window is open (half-open [periodFrom, periodTo), nextSharingWindow),
 *  - the agent's share of that window (GGR x rate, per rate segment),
 *  - what is still owed, and in which direction,
 *  - and, when settling, which SHARE lines to post and which wallets move.
 *
 * The pending figures (settlement centre lists, dashboard, agent lists, the
 * agent's settlement summary) and the settle mutation all call it, so the
 * amount shown as pending is the amount the settlement posts.
 *
 * Model (cumulative): an agent's share is its rate x the GGR of ALL players in
 * its subtree (the GGR reader's 'downline' scope). A parent's rate caps its
 * children's (W1's resolveRateRow), so a child's share is carved out of its
 * parent's: when a parent settles a child, the parent funds it (see
 * settlementWalletMoves).
 *
 * Sign convention — the same as SHARE / SETTLEMENT ledger lines and
 * agent_settlements.total_amount:
 *   positive = TO_AGENT   players lost (GGR > 0): the agent is paid its share
 *                         (by the platform for a root agent, by its parent otherwise);
 *   negative = FROM_AGENT players won (GGR < 0): the agent pays its share of the loss.
 *
 * Pure functions are exported for tests; the class takes its I/O as deps
 * (sharingSettlementWiring.ts builds the real ones).
 */

export type ShareDomain = 'sports' | 'casino' | 'matka';
export const SHARE_DOMAINS: readonly ShareDomain[] = ['sports', 'casino', 'matka'];
export type SharingDirection = 'TO_AGENT' | 'FROM_AGENT' | 'NONE';

/** Half a cent. Ledger, settlement and wallet amounts are numeric(18,2). */
export const HALF_CENT = 0.005;

/** Round to cents the way numeric(…,2) stores it (half away from zero). */
export function round2(n: number): number {
	if (!Number.isFinite(n)) return 0;
	const r = Math.round(Math.abs(n) * 100 + 1e-7) / 100;
	return n < 0 && r !== 0 ? -r : r;
}

/** Who pays for a signed SHARING amount (see the sign convention above). */
export function sharingDirection(amount: number): SharingDirection {
	if (!Number.isFinite(amount) || Math.abs(amount) < HALF_CENT) return 'NONE';
	return amount > 0 ? 'TO_AGENT' : 'FROM_AGENT';
}

export function isShareDomain(d: unknown): d is ShareDomain {
	return d === 'sports' || d === 'casino' || d === 'matka';
}

export interface RateSegment {
	from: Date;
	to: Date;
	rate: number;
}

/**
 * Split [from, to) wherever the agent's rate changes. Each segment carries the
 * rate in force at its start, resolved exactly as AgentConfigsRepo.getSharingConfig
 * resolves it (rateAt). A stretch with no rate row gets rate 0. Adjacent
 * segments with the same rate are merged.
 *
 * Before, the rate in force at the window START applied to the whole window, so
 * a rate change mid-period was applied to bets placed before it.
 */
export function rateSegments(rows: readonly RateRow[], from: Date, to: Date): RateSegment[] {
	if (!(to.getTime() > from.getTime())) return [];
	const points = rateChangePoints({ start: from, end: to }, rows);
	const segments: RateSegment[] = [];
	for (let i = 0; i < points.length; i++) {
		const start = points[i];
		const end = i + 1 < points.length ? points[i + 1] : to;
		if (end.getTime() <= start.getTime()) continue;
		const raw = rateAt(rows, start);
		const rate = raw != null && Number.isFinite(raw) && raw > 0 ? raw : 0;
		const prev = segments[segments.length - 1];
		if (prev && prev.rate === rate && prev.to.getTime() === start.getTime()) {
			prev.to = end;
		} else {
			segments.push({ from: start, to: end, rate });
		}
	}
	return segments;
}

export interface SharingLedgerLine {
	id?: string;
	agentId?: string;
	lineType: string;
	domain?: string | null;
	periodFrom: Date | string;
	periodTo: Date | string;
	amount: number | string;
	createdAt?: Date | string | null;
}

const ms = (d: Date | string | number) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * The SHARE lines posted inside [from, to): periodFrom >= from and periodTo <= to.
 *
 * SHARE lines tile time: each settlement posts lines only for the part of its
 * window not yet covered (planWindowShare), so the lines inside a window are its
 * whole posted share and never overlap. This generalises W3's exact-window rule
 * (shareLinesForExactWindow): the exact-window lines of a retried settlement are
 * inside the window too. Two lines for the same domain and the same window (a
 * race before the settlement lock existed) count once, the newest.
 */
export function containedShareLines<T extends SharingLedgerLine>(lines: readonly T[], from: Date, to: Date): T[] {
	const f = from.getTime();
	const t = to.getTime();
	const newestFirst = [...lines].sort((a, b) => ms(b.createdAt ?? 0) - ms(a.createdAt ?? 0));
	const seen = new Set<string>();
	const out: T[] = [];
	for (const line of newestFirst) {
		if (line.lineType !== 'SHARE') continue;
		const lf = ms(line.periodFrom);
		const lt = ms(line.periodTo);
		if (lf < f || lt > t) continue;
		const key = `${line.domain ?? ''}|${lf}|${lt}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(line);
	}
	return out;
}

/**
 * Signed sum of the SETTLEMENT lines whose window overlaps [from, to)
 * (half-open, as AgentLedgerRepo.list). Positive = paid to the agent.
 * Equals -AgentLedgerRepo.sumSettlementLinesInPeriod.
 */
export function settledInWindow(lines: readonly SharingLedgerLine[], from: Date, to: Date): number {
	let total = 0;
	for (const line of lines) {
		if (line.lineType !== 'SETTLEMENT') continue;
		if (!(ms(line.periodFrom) < to.getTime() && ms(line.periodTo) > from.getTime())) continue;
		const amount = Number(line.amount);
		if (Number.isFinite(amount)) total += amount;
	}
	return round2(total);
}

export type DomainAmounts = Record<ShareDomain, number>;
const zeroDomains = (): DomainAmounts => ({ sports: 0, casino: 0, matka: 0 });

export interface NewShareLine {
	domain: ShareDomain;
	periodFrom: Date;
	periodTo: Date;
	amount: number;
}

export interface WindowSharePlan {
	/** SHARE lines already posted inside the window. */
	existingByDomain: DomainAmounts;
	/** End of the posted coverage (>= the window start). */
	coverEnd: Date;
	/** Lines a settlement of this window posts now (empty when the window is already covered). */
	newLines: NewShareLine[];
	/** The window's share per domain once newLines are posted. */
	shareByDomain: DomainAmounts;
	shareTotal: number;
}

/**
 * What the window's share is, and which SHARE lines a settlement must post.
 *
 * - Nothing posted inside the window yet: post the fresh share of the whole
 *   window, one line per domain.
 * - An earlier partial settlement of an extended window posted lines for
 *   [from, coverEnd): post only the difference (fresh share of the whole window
 *   − what is already posted) as a line for [coverEnd, to). The lines then tile
 *   the window, so all-time SHARE totals (getAllTimeTotalsByType) are not
 *   inflated by overlapping lines, and their sum equals the fresh share.
 * - The window is already covered (a retry of the same window): reuse the
 *   posted lines and post nothing (W3's exact-window rule).
 */
export function planWindowShare(params: {
	lines: readonly SharingLedgerLine[];
	from: Date;
	to: Date;
	fresh: DomainAmounts;
}): WindowSharePlan {
	const existing = containedShareLines(params.lines, params.from, params.to);
	const existingByDomain = zeroDomains();
	let coverEndMs = params.from.getTime();
	for (const line of existing) {
		if (isShareDomain(line.domain)) {
			const amount = Number(line.amount);
			if (Number.isFinite(amount)) existingByDomain[line.domain] = round2(existingByDomain[line.domain] + amount);
		}
		coverEndMs = Math.max(coverEndMs, ms(line.periodTo));
	}
	const coverEnd = new Date(coverEndMs);
	const newLines: NewShareLine[] = [];
	const shareByDomain = { ...existingByDomain };
	if (coverEndMs < params.to.getTime()) {
		for (const d of SHARE_DOMAINS) {
			const delta = round2(round2(params.fresh[d]) - existingByDomain[d]);
			if (Math.abs(delta) < HALF_CENT) continue;
			newLines.push({ domain: d, periodFrom: coverEnd, periodTo: new Date(params.to.getTime()), amount: delta });
			shareByDomain[d] = round2(existingByDomain[d] + delta);
		}
	}
	const shareTotal = round2(shareByDomain.sports + shareByDomain.casino + shareByDomain.matka);
	return { existingByDomain, coverEnd, newLines, shareByDomain, shareTotal };
}

/**
 * The signed amount a settlement moves, from what is owed (`remaining`, signed)
 * and what the caller asked for (`requested` > 0, or 0/absent = all of it).
 * The direction always follows the sign of what is owed; a request above it is
 * refused, never capped silently.
 */
export function planSettlementAmount(
	remaining: number,
	requested: number | null | undefined
): { ok: true; amount: number; direction: SharingDirection } | { ok: false; message: string } {
	const owed = round2(remaining);
	if (Math.abs(owed) < HALF_CENT) {
		return { ok: false, message: 'This period is already fully settled. No remaining amount to settle.' };
	}
	const cap = Math.abs(owed);
	const req = requested != null && Number.isFinite(requested) && requested > 0 ? round2(requested) : cap;
	if (req < 0.01) {
		return { ok: false, message: 'Settlement amount must be at least 0.01.' };
	}
	if (req > cap + 1e-9) {
		return {
			ok: false,
			message: `Settlement amount (${req.toFixed(2)}) cannot exceed the remaining amount (${cap.toFixed(2)}, ${owed > 0 ? 'to be paid to the agent' : 'to be collected from the agent'}).`,
		};
	}
	const amount = owed > 0 ? req : -req;
	return { ok: true, amount, direction: sharingDirection(amount) };
}

/**
 * The wallet movements of a SHARING settlement of `amount` (signed, as posted).
 *
 * A root agent is settled by the platform: only its own wallet moves.
 * A sub-agent's share is part of its parent's (the parent's own SHARE is its
 * rate x the WHOLE subtree, including this child's players, and the child's rate
 * is capped by the parent's), so the parent funds it: the child's wallet moves
 * by +amount and the parent's by -amount. Without this the platform paid the
 * child's portion twice — once inside the parent's cumulative share and once to
 * the child — and the parent kept its child's share. With it, the parent's net
 * is (its rate − the child's rate) x the child's subtree GGR, which is what its
 * own settlement with its upline assumes.
 */
export function settlementWalletMoves(params: {
	agentId: string;
	parentAgentId?: string | null;
	amount: number;
}): Array<{ agentId: string; amount: number; role: 'agent' | 'parent' }> {
	const amount = round2(params.amount);
	const moves: Array<{ agentId: string; amount: number; role: 'agent' | 'parent' }> = [
		{ agentId: params.agentId, amount, role: 'agent' },
	];
	if (params.parentAgentId && params.parentAgentId !== params.agentId) {
		moves.push({ agentId: params.parentAgentId, amount: round2(-amount), role: 'parent' });
	}
	return moves;
}

/**
 * Where an open SHARING window ends once still-open bets are held back.
 *
 * GGR is read by bet CREATION time and only for SETTLED bets. A window that ran
 * past a bet still open at settlement time left that bet behind for good: the
 * next window starts where this one ended, after the bet's creation time, so the
 * bet was never shared once it settled. The window therefore ends at the
 * creation of the earliest still-open bet (of the agent's SHARE base) when that
 * is before `periodTo`, and the bet falls into a later window, counted once it
 * settles.
 *
 * Never earlier than `floor`: the window start, or — for an extended
 * (partially settled) window — the end of the last settlement, whose SHARE and
 * SETTLEMENT lines must stay inside the window. A bet open at the floor itself
 * yields an empty window (nothing new to settle until it settles).
 */
export function capWindowAtOpenBet(params: {
	floor: Date;
	periodTo: Date;
	earliestOpenBetAt: Date | null | undefined;
}): { periodTo: Date; openBetCutoff: Date | null } {
	const end = params.periodTo.getTime();
	const open = params.earliestOpenBetAt ? params.earliestOpenBetAt.getTime() : NaN;
	if (!Number.isFinite(open) || open >= end) return { periodTo: new Date(end), openBetCutoff: null };
	return { periodTo: new Date(Math.min(end, Math.max(params.floor.getTime(), open))), openBetCutoff: new Date(open) };
}

/**
 * The settlement-centre dashboard's SHARING pending figure.
 *
 * Only the agents the caller settles count: the ROOT agents for an admin (an
 * admin settles roots; each parent settles its own children), or the direct
 * children of an agent caller. Summing every leaf (as before) counted shares the
 * admin never settles, and adding the absolute values of pay and collect made
 * offsetting amounts look like twice the work. Pay and collect are now reported
 * separately and netted.
 */
export function summarizeSharingPending(
	rows: ReadonlyArray<{ agentId: string; parentAgentId?: string | null; remaining: number }>,
	opts: { settlerAgentId?: string | null } = {}
): { net: number; toAgents: number; fromAgents: number; count: number } {
	let toAgents = 0;
	let fromAgents = 0;
	let count = 0;
	for (const row of rows) {
		const settles = opts.settlerAgentId ? row.parentAgentId === opts.settlerAgentId : row.parentAgentId == null;
		if (!settles) continue;
		const r = round2(row.remaining);
		if (Math.abs(r) < HALF_CENT) continue;
		count++;
		if (r > 0) toAgents += r;
		else fromAgents += -r;
	}
	toAgents = round2(toAgents);
	fromAgents = round2(fromAgents);
	return { net: round2(toAgents - fromAgents), toAgents, fromAgents, count };
}

// ---------------------------------------------------------------------------
// Engine (I/O through deps)
// ---------------------------------------------------------------------------

export interface SharingAgentLike {
	id: string;
	tenantId: string;
	createdAt: Date | string;
	allowedDomains?: readonly string[] | null;
	parentAgentId?: string | null;
	schemeType?: string | null;
}

export interface SharingEngineDeps {
	/** GGR source — the same reader the SHARE posting always used (HybridGGRReader → LiveGGRReader), 'downline' scope. */
	readers: Pick<VerticalReaders, 'getSportsGGR' | 'getCasinoGGR' | 'getMatkaGGR'>;
	/** The agent's sharing rate rows for a domain (AgentRateHistoryRepo.listRows('sharing', …)). */
	rateRows(agentId: string, domain: ShareDomain): Promise<RateRow[]>;
	/** Ledger lines overlapping the half-open window (AgentLedgerRepo.list). */
	ledgerLines(agentId: string, from: Date, to: Date): Promise<SharingLedgerLine[]>;
	/** Last POSTED settlement, latest periodTo first (AgentSettlementsRepo.getLastPostedSettlement). */
	lastPostedSettlement(agentId: string): Promise<{ periodFrom: Date; periodTo: Date } | null>;
	timezone(tenantId: string): Promise<string>;
	now(): Date;
	/**
	 * Optional: the creation time of the earliest bet placed in [from, to) by the
	 * players of the agent's SHARE base (the same 'downline' players the GGR reader
	 * counts) that is still open; null when none. When given, an open window ends
	 * before that bet (capWindowAtOpenBet). sharingSettlementWiring.ts wires
	 * LiveGGRReader.earliestOpenBetForAgent.
	 */
	earliestOpenBetAt?(agent: SharingAgentLike, from: Date, to: Date): Promise<Date | null>;
}

export interface DomainShare {
	/** Operator GGR of the agent's whole subtree in the window (stakes − payouts; > 0 = players lost). */
	ggr: number;
	/** The agent's share: Σ over rate segments of GGR x rate. */
	share: number;
	rateAtStart: number;
	rateAtEnd: number;
	/** share / GGR when GGR ≠ 0, else the rate at the window end. */
	effectiveRate: number;
	segments: Array<RateSegment & { ggr: number; share: number }>;
}

export interface FreshShare {
	from: Date;
	to: Date;
	byDomain: Record<ShareDomain, DomainShare>;
	totalGgr: number;
	total: number;
}

export interface SharingWindowState {
	periodFrom: Date;
	periodTo: Date;
	/** The window was not advanced because the last settlement left something owed. */
	extendsPartial: boolean;
	fresh: FreshShare;
	plan: WindowSharePlan;
	/** The window's share (positive = TO_AGENT). Equal to what a settlement of this window posts. */
	shareTotal: number;
	/** Already settled inside the window (signed; positive = paid to the agent). */
	settled: number;
	/** shareTotal − settled. Positive = the agent is owed (TO_AGENT); negative = the agent owes (FROM_AGENT). */
	remaining: number;
	direction: SharingDirection;
	/**
	 * Set when the window was ended early because a bet placed at this instant is
	 * still open (capWindowAtOpenBet): later activity waits for the next window.
	 */
	openBetCutoff?: Date | null;
}

export interface SharingSettlementWriter {
	/** Serialises settlements of one agent (pg_advisory_xact_lock in the settlement transaction). */
	lockAgent(agentId: string): Promise<void>;
	addLedgerLine(line: {
		agentId: string;
		domain: ShareDomain;
		periodFrom: Date;
		periodTo: Date;
		lineType: 'SHARE' | 'SETTLEMENT' | 'ADJUSTMENT';
		amount: number;
		currency: string;
		refKey?: string | null;
		meta?: Record<string, unknown> | null;
	}): Promise<void>;
	openAndPostSettlement(p: {
		agentId: string;
		periodFrom: Date;
		periodTo: Date;
		totalAmount: number;
		currency: string;
		settledByAgentId: string | null;
		postedBy: string | null;
	}): Promise<{ id: string }>;
	creditWallet(agentId: string, currency: string, amount: number): Promise<void>;
	recordTransaction(p: {
		tenant: string;
		agentId: string;
		settlementType: string;
		amount: number;
		direction: 'TO_AGENT' | 'FROM_AGENT';
		previousBalance: number;
		newBalance: number;
		notes: string;
		settledBy?: string;
	}): Promise<any>;
}

export type SharingSettlementOutcome =
	| {
			ok: true;
			periodFrom: Date;
			periodTo: Date;
			settlementId: string;
			amount: number;
			direction: 'TO_AGENT' | 'FROM_AGENT';
			remainingBefore: number;
			remainingAfter: number;
			postedShareLines: NewShareLine[];
			walletMoves: Array<{ agentId: string; amount: number; role: 'agent' | 'parent' }>;
			transaction: any;
	  }
	| { ok: false; message: string };

function allowedShareDomains(agent: SharingAgentLike): ShareDomain[] {
	return (agent.allowedDomains ?? []).filter(isShareDomain);
}

export class SharingSettlementEngine {
	constructor(private readonly deps: SharingEngineDeps) {}

	private ggrReader(domain: ShareDomain) {
		if (domain === 'sports') return this.deps.readers.getSportsGGR.bind(this.deps.readers);
		if (domain === 'casino') return this.deps.readers.getCasinoGGR.bind(this.deps.readers);
		return this.deps.readers.getMatkaGGR.bind(this.deps.readers);
	}

	/**
	 * The agent's share of [from, to), fresh from the GGR reader, per domain and
	 * rate segment. `domains` defaults to the agent's allowed domains; a domain
	 * outside the set has zero share (and is not read).
	 */
	async computeShare(agent: SharingAgentLike, from: Date, to: Date, domains?: readonly ShareDomain[]): Promise<FreshShare> {
		const set = new Set<ShareDomain>(domains ?? allowedShareDomains(agent));
		const byDomain = {} as Record<ShareDomain, DomainShare>;
		let totalGgr = 0;
		let total = 0;
		for (const d of SHARE_DOMAINS) {
			const empty: DomainShare = { ggr: 0, share: 0, rateAtStart: 0, rateAtEnd: 0, effectiveRate: 0, segments: [] };
			if (!set.has(d) || !(to.getTime() > from.getTime())) {
				byDomain[d] = empty;
				continue;
			}
			const rows = await this.deps.rateRows(agent.id, d);
			const segments = rateSegments(rows, from, to);
			const read = this.ggrReader(d);
			let ggr = 0;
			let share = 0;
			const detailed: DomainShare['segments'] = [];
			for (const seg of segments) {
				const res = await read({ agentId: agent.id, from: seg.from, to: seg.to, scope: 'downline' });
				const g = Number(res?.ggr ?? 0);
				const segGgr = Number.isFinite(g) ? g : 0;
				const segShare = segGgr * seg.rate;
				ggr += segGgr;
				share += segShare;
				detailed.push({ ...seg, ggr: round2(segGgr), share: round2(segShare) });
			}
			const rateAtStart = segments[0]?.rate ?? 0;
			const rateAtEnd = segments[segments.length - 1]?.rate ?? 0;
			const ggrR = round2(ggr);
			const shareR = round2(share);
			byDomain[d] = {
				ggr: ggrR,
				share: shareR,
				rateAtStart,
				rateAtEnd,
				effectiveRate: Math.abs(ggr) > 1e-9 ? share / ggr : rateAtEnd,
				segments: detailed,
			};
			totalGgr += ggrR;
			total += shareR;
		}
		return { from, to, byDomain, totalGgr: round2(totalGgr), total: round2(total) };
	}

	/** The share, settled amount and remaining of an explicit window. */
	async windowState(agent: SharingAgentLike, from: Date, to: Date, extendsPartial = false): Promise<SharingWindowState> {
		const lines = await this.deps.ledgerLines(agent.id, from, to);
		// Domains already posted inside the window keep counting even if the agent
		// lost the domain since, so a top-up line never reverses earned share.
		const domains = new Set<ShareDomain>(allowedShareDomains(agent));
		for (const line of containedShareLines(lines, from, to)) {
			if (isShareDomain(line.domain)) domains.add(line.domain);
		}
		const fresh = await this.computeShare(agent, from, to, [...domains]);
		const plan = planWindowShare({
			lines,
			from,
			to,
			fresh: { sports: fresh.byDomain.sports.share, casino: fresh.byDomain.casino.share, matka: fresh.byDomain.matka.share },
		});
		const settled = settledInWindow(lines, from, to);
		const remaining = round2(plan.shareTotal - settled);
		return {
			periodFrom: from,
			periodTo: to,
			extendsPartial,
			fresh,
			plan,
			shareTotal: plan.shareTotal,
			settled,
			remaining,
			direction: sharingDirection(remaining),
		};
	}

	/** share − settled (signed) of a window that was settled: posted SHARE lines, not a recomputation. */
	async postedRemaining(agentId: string, from: Date, to: Date): Promise<number> {
		const lines = await this.deps.ledgerLines(agentId, from, to);
		let posted = 0;
		for (const line of containedShareLines(lines, from, to)) {
			const amount = Number(line.amount);
			if (Number.isFinite(amount)) posted += amount;
		}
		return round2(round2(posted) - settledInWindow(lines, from, to));
	}

	/**
	 * The window open at `now` (see nextSharingWindow), ended before the earliest
	 * still-open bet of the agent's SHARE base when the deps can tell
	 * (capWindowAtOpenBet), so that bet is shared in a later window once settled.
	 */
	async openWindow(
		agent: SharingAgentLike,
		now: Date = this.deps.now()
	): Promise<{ periodFrom: Date; periodTo: Date; extendsPartial: boolean; openBetCutoff: Date | null }> {
		const last = await this.deps.lastPostedSettlement(agent.id);
		const lastWindowRemaining = last ? await this.postedRemaining(agent.id, last.periodFrom, last.periodTo) : null;
		const timezone = await this.deps.timezone(agent.tenantId);
		const createdAt = agent.createdAt instanceof Date ? agent.createdAt : new Date(agent.createdAt);
		const win = nextSharingWindow({ last, agentCreatedAt: createdAt, whitelabelTimezone: timezone, now, lastWindowRemaining });
		if (!this.deps.earliestOpenBetAt) return { ...win, openBetCutoff: null };
		// An extended window already has SHARE/SETTLEMENT lines up to the last
		// settlement's end; it may not end before them.
		const lastEnd = last ? ms(last.periodTo) : NaN;
		const floor = win.extendsPartial && Number.isFinite(lastEnd)
			? new Date(Math.min(win.periodTo.getTime(), Math.max(win.periodFrom.getTime(), lastEnd)))
			: win.periodFrom;
		if (!(win.periodTo.getTime() > floor.getTime())) return { ...win, openBetCutoff: null };
		const earliestOpenBetAt = await this.deps.earliestOpenBetAt(agent, floor, win.periodTo);
		const capped = capWindowAtOpenBet({ floor, periodTo: win.periodTo, earliestOpenBetAt });
		return { ...win, periodTo: capped.periodTo, openBetCutoff: capped.openBetCutoff };
	}

	/** What is pending for the agent now: the open window's state. */
	async pending(agent: SharingAgentLike, opts: { now?: Date } = {}): Promise<SharingWindowState> {
		const win = await this.openWindow(agent, opts.now ?? this.deps.now());
		const state = await this.windowState(agent, win.periodFrom, win.periodTo, win.extendsPartial);
		return { ...state, openBetCutoff: win.openBetCutoff };
	}

	/**
	 * Reads only: the window, its state and the amount a settlement would move.
	 *
	 * `requestedPeriodTo` is the end of the window the caller was shown (the
	 * pending row's periodTo). Settling exactly that window posts exactly the
	 * share that was displayed. It may not be in the future (clamped to now), nor
	 * run past the earliest still-open bet (clamped to it, see openWindow), and
	 * may not end before what is already settled or posted in the window.
	 * Without it the window ends now, or before the earliest still-open bet.
	 */
	async prepareSettlement(
		agent: SharingAgentLike,
		params: { requestedAmount?: number | null; requestedPeriodTo?: Date | null; now?: Date }
	): Promise<{ ok: true; state: SharingWindowState; amount: number; direction: 'TO_AGENT' | 'FROM_AGENT' } | { ok: false; message: string }> {
		const now = params.now ?? this.deps.now();
		const win = await this.openWindow(agent, now);
		let periodTo = win.periodTo;
		if (params.requestedPeriodTo != null) {
			const requested = params.requestedPeriodTo.getTime();
			if (!Number.isFinite(requested)) return { ok: false, message: 'Invalid settlement period end.' };
			// win.periodTo is now, or earlier when an open bet holds the window back.
			periodTo = new Date(Math.min(requested, now.getTime(), win.periodTo.getTime()));
		}
		if (!(periodTo.getTime() > win.periodFrom.getTime())) {
			return { ok: false, message: `The settlement period must end after its start (${win.periodFrom.toISOString()}).` };
		}
		// Never settle a window shorter than what is already settled or posted in it:
		// the lines covering the longer window would no longer sit inside it.
		const lines = await this.deps.ledgerLines(agent.id, win.periodFrom, periodTo);
		let coveredTo = 0;
		for (const line of lines) {
			if (line.lineType !== 'SHARE' && line.lineType !== 'SETTLEMENT') continue;
			if (ms(line.periodFrom) < win.periodFrom.getTime()) continue;
			coveredTo = Math.max(coveredTo, ms(line.periodTo));
		}
		if (coveredTo > periodTo.getTime()) {
			return {
				ok: false,
				message: `This period is already settled up to ${new Date(coveredTo).toISOString()}; refresh the pending amount and settle again.`,
			};
		}
		const state = await this.windowState(agent, win.periodFrom, periodTo, win.extendsPartial);
		const planned = planSettlementAmount(state.remaining, params.requestedAmount);
		if (!planned.ok) return planned;
		return { ok: true, state, amount: planned.amount, direction: planned.direction as 'TO_AGENT' | 'FROM_AGENT' };
	}

	/**
	 * Settle the agent's open window inside the caller's transaction. The writer's
	 * lock is taken first, so two settlements of the same agent run one after the
	 * other and the second sees the first one's lines.
	 */
	async settle(params: {
		agent: SharingAgentLike;
		writer: SharingSettlementWriter;
		currency: string;
		tenant: string;
		notes: string;
		requestedAmount?: number | null;
		requestedPeriodTo?: Date | null;
		settledByAgentId: string | null;
		settledByUuid: string | null;
		now?: Date;
	}): Promise<SharingSettlementOutcome> {
		const { agent, writer, currency } = params;
		await writer.lockAgent(agent.id);
		const prepared = await this.prepareSettlement(agent, {
			requestedAmount: params.requestedAmount,
			requestedPeriodTo: params.requestedPeriodTo,
			now: params.now,
		});
		if (!prepared.ok) return prepared;
		const { state, amount, direction } = prepared;
		const { periodFrom, periodTo } = state;

		for (const line of state.plan.newLines) {
			await writer.addLedgerLine({
				agentId: agent.id,
				domain: line.domain,
				periodFrom: line.periodFrom,
				periodTo: line.periodTo,
				lineType: 'SHARE',
				amount: line.amount,
				currency,
				refKey: null,
				meta: {
					basis: 'GGR',
					window: { from: periodFrom.toISOString(), to: periodTo.toISOString() },
					windowShare: state.plan.shareByDomain[line.domain],
					segments: state.fresh.byDomain[line.domain].segments.map((s) => ({
						from: s.from.toISOString(),
						to: s.to.toISOString(),
						rate: s.rate,
						ggr: s.ggr,
						share: s.share,
					})),
				},
			});
		}

		const settlement = await writer.openAndPostSettlement({
			agentId: agent.id,
			periodFrom,
			periodTo,
			totalAmount: amount,
			currency,
			settledByAgentId: params.settledByAgentId,
			postedBy: params.settledByUuid,
		});

		const walletMoves = settlementWalletMoves({ agentId: agent.id, parentAgentId: agent.parentAgentId, amount });
		for (const move of walletMoves) {
			await writer.creditWallet(move.agentId, currency, move.amount);
		}

		// SETTLEMENT line: what reduces this window's remaining (settledInWindow).
		await writer.addLedgerLine({
			agentId: agent.id,
			domain: 'sports',
			periodFrom,
			periodTo,
			lineType: 'SETTLEMENT',
			amount,
			currency,
			refKey: `settlement-${settlement.id}`,
			meta: { settlementId: settlement.id, notes: params.notes },
		});
		// The parent's side of a sub-agent settlement, for its own ledger. ADJUSTMENT
		// lines are not SHARE or SETTLEMENT lines, so they never change the parent's
		// own pending with its upline.
		for (const move of walletMoves) {
			if (move.role !== 'parent') continue;
			await writer.addLedgerLine({
				agentId: move.agentId,
				domain: 'sports',
				periodFrom,
				periodTo,
				lineType: 'ADJUSTMENT',
				amount: move.amount,
				currency,
				refKey: `child-settlement-${settlement.id}`,
				meta: { kind: 'CHILD_SHARE_SETTLEMENT', childAgentId: agent.id, settlementId: settlement.id, notes: params.notes },
			});
		}

		const remainingAfter = round2(state.remaining - amount);
		const transaction = await writer.recordTransaction({
			tenant: params.tenant,
			agentId: agent.id,
			settlementType: 'P_L',
			amount: Math.abs(amount),
			direction,
			previousBalance: state.remaining,
			newBalance: remainingAfter,
			notes: params.notes,
			settledBy: params.settledByUuid ?? undefined,
		});

		return {
			ok: true,
			periodFrom,
			periodTo,
			settlementId: settlement.id,
			amount,
			direction,
			remainingBefore: state.remaining,
			remainingAfter,
			postedShareLines: state.plan.newLines,
			walletMoves,
			transaction,
		};
	}
}

/**
 * The settlement-centre breakdown row for a domain (SettlementDomainBreakdownItem).
 * amount = the players' P/L (−GGR), agentShare = the agent's share (positive =
 * TO_AGENT), cut = the rest of the GGR (|GGR| − |share|).
 */
export function domainBreakdownItems(fresh: FreshShare, shareByDomain?: DomainAmounts) {
	const totalAbs = SHARE_DOMAINS.reduce((s, d) => s + Math.abs(fresh.byDomain[d].ggr), 0);
	return SHARE_DOMAINS.map((d) => {
		const ds = fresh.byDomain[d];
		const share = shareByDomain ? shareByDomain[d] : ds.share;
		const rate = Number.isFinite(ds.effectiveRate) ? ds.effectiveRate : 0;
		return {
			domain: d,
			amount: round2(-ds.ggr),
			percentage: totalAbs > 0 ? Math.round((Math.abs(ds.ggr) / totalAbs) * 1000) / 10 : 0,
			shareRate: Math.round(rate * 1000) / 10,
			agentShare: round2(share),
			cutAmount: round2(Math.max(0, Math.abs(ds.ggr) - Math.abs(share))),
			cutPercentage: Math.round((1 - rate) * 1000) / 10,
		};
	});
}
