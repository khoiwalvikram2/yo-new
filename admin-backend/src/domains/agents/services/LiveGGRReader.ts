import { sportsPayoutAggregateSql } from '@src/shared/reportingSql.js'
import { db } from '@/db/client';
import { sportsBets, casinoBets, matkaBets, users } from '@shared/db/schema';
import { and, eq, gte, lt, sql, inArray, type SQL } from 'drizzle-orm';
import { AgentsRepo } from '@/repos/agents/AgentsRepo';
import type { VerticalReaders, DomainGGRBreakdown, CycleAgentGGRRow, OpenBetCounts } from './VerticalReaders';
import { attributedAgentId, istCycleKeySql, withReferralScope } from './commissionPlayerScope.js';
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js';

/**
 * Reads GGR by aggregating directly from bets (sports_bets, casino_bets, matka_bets)
 * over [from, to) by bet creation time, settled statuses only, GGR = stakes - payouts.
 *
 * Which agent a player's bets belong to (decision 3, 2026-10-21): a player reaches
 * an agent by `users.agent_id`, or — when it has none — through a confirmed
 * `referral_attributions` row whose referrer is one of the agent's players. That is
 * the same two-route rule as reporting (AgentFilterUtils.buildAgentFilterCTE), with
 * one deliberate difference: every player is attributed to exactly ONE agent,
 * `COALESCE(users.agent_id, referrer.agent_id)`. A referred player that has its own
 * agent_id stays with that agent and is never counted a second time through its
 * referrer, so no commission or share is paid twice for the same bets.
 *
 * Used for commission (all of it) and for the SHARING "SHARE" payout. The
 * attribution rule lives in commissionPlayerScope.ts.
 */

const IST_WEEK_KEY = istCycleKeySql;

interface ScopeParams {
	agentIds: string[];
	tenantId: string;
	from: Date;
	to: Date;
	whitelabelId?: string;
	currency?: string;
}

type DomainKey = 'sports' | 'casino' | 'matka';

export class LiveGGRReader implements VerticalReaders {
	private agentsRepo: AgentsRepo;

	constructor() {
		this.agentsRepo = new AgentsRepo();
	}

	async getSportsGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) return { ggr: 0 };
		const agentIds = params.scope === 'direct'
			? [params.agentId]
			: await this.agentsRepo.getDescendantIds(params.agentId);
		return this.getSportsGGRByAgentIds({
			agentIds,
			tenantId: agent.tenantId ?? 'default',
			from: params.from,
			to: params.to,
			whitelabelId: agent.tenantId ?? undefined,
		});
	}

	async getCasinoGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) return { ggr: 0 };
		const agentIds = params.scope === 'direct'
			? [params.agentId]
			: await this.agentsRepo.getDescendantIds(params.agentId);
		return this.getCasinoGGRByAgentIds({
			agentIds,
			tenantId: agent.tenantId ?? 'default',
			from: params.from,
			to: params.to,
			whitelabelId: agent.tenantId ?? undefined,
		});
	}

	async getMatkaGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) return { ggr: 0 };
		const agentIds = params.scope === 'direct'
			? [params.agentId]
			: await this.agentsRepo.getDescendantIds(params.agentId);
		return this.getMatkaGGRByAgentIds({
			agentIds,
			tenantId: agent.tenantId ?? 'default',
			from: params.from,
			to: params.to,
			whitelabelId: agent.tenantId ?? undefined,
		});
	}

	async getSportsGGRByAgentIds(params: ScopeParams): Promise<DomainGGRBreakdown> {
		const rows = await this.domainRows('sports', params);
		return { ggr: rows.reduce((s, r) => s + r.ggr, 0) };
	}

	async getCasinoGGRByAgentIds(params: ScopeParams): Promise<DomainGGRBreakdown> {
		const rows = await this.domainRows('casino', params);
		return { ggr: rows.reduce((s, r) => s + r.ggr, 0) };
	}

	async getMatkaGGRByAgentIds(params: ScopeParams): Promise<DomainGGRBreakdown> {
		const rows = await this.domainRows('matka', params);
		return { ggr: rows.reduce((s, r) => s + r.ggr, 0) };
	}

	/**
	 * GGR per IST cycle (Monday key) and per attributed agent, all three domains,
	 * for the players of `agentIds`. Three queries whatever the range, so a
	 * multi-cycle or all-time commission total costs the same as one cycle.
	 */
	async getGGRByCycleAndAgent(params: ScopeParams): Promise<CycleAgentGGRRow[]> {
		const [sports, casino, matka] = await Promise.all([
			this.domainRows('sports', params),
			this.domainRows('casino', params),
			this.domainRows('matka', params),
		]);
		const byKey = new Map<string, CycleAgentGGRRow>();
		const add = (domain: DomainKey, rows: Array<{ cycleKey: string; agentId: string; ggr: number }>) => {
			for (const r of rows) {
				const k = `${r.cycleKey}|${r.agentId}`;
				let row = byKey.get(k);
				if (!row) {
					row = { cycleKey: r.cycleKey, agentId: r.agentId, sports: 0, casino: 0, matka: 0 };
					byKey.set(k, row);
				}
				row[domain] += r.ggr;
			}
		};
		add('sports', sports);
		add('casino', casino);
		add('matka', matka);
		return Array.from(byKey.values());
	}

	/**
	 * Bets placed in [from, to) by the players of `agentIds` that are still open
	 * (not yet won/lost/settled/void/cancelled). Their GGR is not in any total yet,
	 * and because GGR is read by bet creation time, a cycle paid while they are
	 * open never picks them up later.
	 */
	async countOpenBetsByAgentIds(params: ScopeParams): Promise<OpenBetCounts> {
		params = { ...params, currency: params.currency || await getWhitelabelCurrency(params.tenantId) };
		const { agentIds, tenantId } = params;
		if (agentIds.length === 0) return { sports: 0, casino: 0, matka: 0 };
		const count = sql<number>`COUNT(*)::int`;

		const [s, c, m] = await Promise.all([
			this.withPlayerScope(db.select({ n: count }).from(sportsBets).leftJoin(users, eq(sportsBets.userId, users.id)), tenantId)
				.where(and(...this.openBetConditions('sports', params))),
			this.withPlayerScope(db.select({ n: count }).from(casinoBets).leftJoin(users, eq(casinoBets.userId, users.id)), tenantId)
				.where(and(...this.openBetConditions('casino', params))),
			this.withPlayerScope(db.select({ n: count }).from(matkaBets).leftJoin(users, eq(matkaBets.userId, users.id)), tenantId)
				.where(and(...this.openBetConditions('matka', params))),
		]);
		return {
			sports: Number(s[0]?.n ?? 0),
			casino: Number(c[0]?.n ?? 0),
			matka: Number(m[0]?.n ?? 0),
		};
	}

	/**
	 * The creation time of the EARLIEST bet placed in [from, to) by the players of
	 * `agentIds` that is still open, across sports, casino (cash) and matka; null
	 * when none is open. Same open-bet definition and player scope as
	 * countOpenBetsByAgentIds (and as the settled bets the GGR reads count).
	 *
	 * GGR is read by bet creation time and only for settled bets, so a SHARING
	 * window must end before this instant: a window settled past an open bet
	 * would never count that bet once it settles (the next window starts later).
	 */
	async earliestOpenBetCreatedAt(params: ScopeParams): Promise<Date | null> {
		params = { ...params, currency: params.currency || await getWhitelabelCurrency(params.tenantId) };
		const { agentIds, tenantId } = params;
		if (agentIds.length === 0) return null;
		const [s, c, m] = await Promise.all([
			this.withPlayerScope(
				db.select({ at: sql<Date | string | null>`MIN(${sportsBets.createdAt})` }).from(sportsBets).leftJoin(users, eq(sportsBets.userId, users.id)),
				tenantId,
			).where(and(...this.openBetConditions('sports', params))),
			this.withPlayerScope(
				db.select({ at: sql<Date | string | null>`MIN(${casinoBets.createdAt})` }).from(casinoBets).leftJoin(users, eq(casinoBets.userId, users.id)),
				tenantId,
			).where(and(...this.openBetConditions('casino', params))),
			this.withPlayerScope(
				db.select({ at: sql<Date | string | null>`MIN(${matkaBets.createdAt})` }).from(matkaBets).leftJoin(users, eq(matkaBets.userId, users.id)),
				tenantId,
			).where(and(...this.openBetConditions('matka', params))),
		]);
		let earliest: number | null = null;
		for (const r of [s[0]?.at, c[0]?.at, m[0]?.at]) {
			if (r == null) continue;
			const t = (r instanceof Date ? r : new Date(r)).getTime();
			if (Number.isFinite(t) && (earliest == null || t < earliest)) earliest = t;
		}
		return earliest == null ? null : new Date(earliest);
	}

	/**
	 * earliestOpenBetCreatedAt for one agent, with the agent resolved and scoped
	 * exactly as getSportsGGR / getCasinoGGR / getMatkaGGR do ('downline' = the
	 * agent and every descendant; the agent's tenant is the whitelabel filter), so
	 * it covers the same players as the SHARING "SHARE" base.
	 */
	async earliestOpenBetForAgent(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<Date | null> {
		const agent = await this.agentsRepo.findById(params.agentId);
		if (!agent) return null;
		const agentIds = params.scope === 'direct'
			? [params.agentId]
			: await this.agentsRepo.getDescendantIds(params.agentId);
		return this.earliestOpenBetCreatedAt({
			agentIds,
			tenantId: agent.tenantId ?? 'default',
			from: params.from,
			to: params.to,
			whitelabelId: agent.tenantId ?? undefined,
		});
	}

	/**
	 * Bets placed in [from, to) by the players of `agentIds` that are not settled
	 * yet: sports matched/unmatched; casino (cash wallet, as the GGR) and matka
	 * pending/active. Shared by countOpenBetsByAgentIds and earliestOpenBetCreatedAt.
	 */
	private openBetConditions(domain: DomainKey, params: ScopeParams): SQL[] {
		const { agentIds, tenantId, from, to, whitelabelId } = params;
		if (domain === 'sports') {
			const conds: SQL[] = [
				eq(sportsBets.tenant, tenantId),
                ...(params.currency ? [eq(sportsBets.currency, params.currency)] : []),
				gte(sportsBets.createdAt, from),
				lt(sportsBets.createdAt, to),
				inArray(attributedAgentId, agentIds),
				inArray(sportsBets.status, ['matched', 'unmatched']),
			];
			if (whitelabelId) conds.push(eq(sportsBets.whitelabelId, whitelabelId));
			return conds;
		}
		if (domain === 'casino') {
			const conds: SQL[] = [
				eq(casinoBets.tenant, tenantId),
                ...(params.currency ? [eq(casinoBets.currency, params.currency)] : []),
				eq(casinoBets.walletType, 'cash'),
				gte(casinoBets.createdAt, from),
				lt(casinoBets.createdAt, to),
				inArray(attributedAgentId, agentIds),
				inArray(casinoBets.status, ['pending', 'active']),
			];
			if (whitelabelId) conds.push(eq(casinoBets.whitelabelId, whitelabelId));
			return conds;
		}
		const conds: SQL[] = [
			eq(matkaBets.tenant, tenantId),
                ...(params.currency ? [eq(matkaBets.currency, params.currency)] : []),
			gte(matkaBets.createdAt, from),
			lt(matkaBets.createdAt, to),
			inArray(attributedAgentId, agentIds),
			inArray(matkaBets.status, ['pending', 'active']),
		];
		if (whitelabelId) conds.push(eq(matkaBets.whitelabelId, whitelabelId));
		return conds;
	}

	/** Adds the referral route (confirmed attribution -> referrer's agent) to a query already joined to users. */
	private withPlayerScope(query: unknown, tenantId: string): any {
		return withReferralScope(query, tenantId);
	}

	/** One domain's GGR grouped by IST cycle key and attributed agent. */
	private async domainRows(
		domain: DomainKey,
		params: ScopeParams,
	): Promise<Array<{ cycleKey: string; agentId: string; ggr: number }>> {
		const { agentIds, tenantId, from, to, whitelabelId } = params;
		if (agentIds.length === 0) return [];
		const currency = params.currency || await getWhitelabelCurrency(tenantId);

		let rows: Array<{ cycleKey: string; agentId: string; totalStakes: number; totalPayouts: number }>;
		if (domain === 'sports') {
			const conditions: SQL[] = [
				eq(sportsBets.tenant, tenantId),
				eq(sportsBets.currency, currency),
				gte(sportsBets.createdAt, from),
				lt(sportsBets.createdAt, to),
				inArray(attributedAgentId, agentIds),
				inArray(sportsBets.status, ['won', 'lost', 'settled']),
			];
			if (whitelabelId) conditions.push(eq(sportsBets.whitelabelId, whitelabelId));
			rows = await this.withPlayerScope(
				db
					.select({
						cycleKey: IST_WEEK_KEY(sportsBets.createdAt),
						agentId: attributedAgentId,
						totalStakes: sql<number>`COALESCE(SUM(${sportsBets.liability}::numeric), 0)`,
						totalPayouts: sportsPayoutAggregateSql(),
					})
					.from(sportsBets)
					.leftJoin(users, eq(sportsBets.userId, users.id)),
				tenantId,
			)
				.where(and(...conditions))
				.groupBy(sql`1`, sql`2`);
		} else if (domain === 'casino') {
			const conditions: SQL[] = [
				eq(casinoBets.tenant, tenantId),
				eq(casinoBets.currency, currency),
				eq(casinoBets.walletType, 'cash'), // Commission only on cash bets; exclude bonus and referralBonus
				gte(casinoBets.createdAt, from),
				lt(casinoBets.createdAt, to),
				inArray(attributedAgentId, agentIds),
				inArray(casinoBets.status, ['won', 'lost']),
			];
			if (whitelabelId) conditions.push(eq(casinoBets.whitelabelId, whitelabelId));
			rows = await this.withPlayerScope(
				db
					.select({
						cycleKey: IST_WEEK_KEY(casinoBets.createdAt),
						agentId: attributedAgentId,
						totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN ${casinoBets.stake}::numeric ELSE 0 END), 0)`,
						totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${casinoBets.status} IN ('won', 'lost') THEN COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) ELSE 0 END), 0)`,
					})
					.from(casinoBets)
					.leftJoin(users, eq(casinoBets.userId, users.id)),
				tenantId,
			)
				.where(and(...conditions))
				.groupBy(sql`1`, sql`2`);
		} else {
			const conditions: SQL[] = [
				eq(matkaBets.tenant, tenantId),
				eq(matkaBets.currency, currency),
				gte(matkaBets.createdAt, from),
				lt(matkaBets.createdAt, to),
				inArray(attributedAgentId, agentIds),
				inArray(matkaBets.status, ['won', 'lost']),
			];
			if (whitelabelId) conditions.push(eq(matkaBets.whitelabelId, whitelabelId));
			rows = await this.withPlayerScope(
				db
					.select({
						cycleKey: IST_WEEK_KEY(matkaBets.createdAt),
						agentId: attributedAgentId,
						totalStakes: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} IN ('won', 'lost') THEN ${matkaBets.betAmount}::numeric ELSE 0 END), 0)`,
						totalPayouts: sql<number>`COALESCE(SUM(CASE WHEN ${matkaBets.status} = 'won' THEN ${matkaBets.actualWin}::numeric ELSE 0 END), 0)`,
					})
					.from(matkaBets)
					.leftJoin(users, eq(matkaBets.userId, users.id)),
				tenantId,
			)
				.where(and(...conditions))
				.groupBy(sql`1`, sql`2`);
		}

		return rows.map((r) => ({
			cycleKey: String(r.cycleKey),
			agentId: String(r.agentId),
			ggr: Number(r.totalStakes ?? 0) - Number(r.totalPayouts ?? 0),
		}));
	}
}
