import { VerticalReaders, DomainGGRBreakdown, type CycleAgentGGRRow, type OpenBetCounts } from './VerticalReaders';
import { LiveGGRReader } from './LiveGGRReader';
import { db } from '@/db/client';
import { reportingDailySnapshots } from '@shared/db/schema';
import { and, eq, gte, lte, sql, inArray, isNull } from 'drizzle-orm';
import { PlayerAuthService } from '../../players/services/PlayerAuthService';
import { AgentsRepo } from '@/repos/agents/AgentsRepo';

// Adapter to read GGR from reportingDailySnapshots filtered by agent
export class DomainGGRReadersAdapter implements VerticalReaders {
	private playerAuthService: PlayerAuthService;
	private agentsRepo: AgentsRepo;

	constructor() {
		this.playerAuthService = new PlayerAuthService();
		this.agentsRepo = new AgentsRepo();
	}

	async getSportsGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const { agentId, from, to, scope } = params;
		
		// Get agent to determine tenant
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			return { ggr: 0 };
		}

		const conditions = [
			eq(reportingDailySnapshots.domain, 'sports'),
			eq(reportingDailySnapshots.tenant, agent.tenantId),
			gte(reportingDailySnapshots.snapshotDate, from),
			lte(reportingDailySnapshots.snapshotDate, to),
			// Use agent-level snapshots only; player-level rows would double-count totals.
			isNull(reportingDailySnapshots.playerId),
		];

		// Use agentId field from reportingDailySnapshots
		if (scope === 'direct') {
			conditions.push(eq(reportingDailySnapshots.agentId, agentId));
		} else {
			// Downline scope: include self and all descendants (full hierarchy)
			const descendantIds = await this.agentsRepo.getDescendantIds(agentId);
			conditions.push(inArray(reportingDailySnapshots.agentId, descendantIds));
		}

		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(...conditions));

		const ggr = Number(result[0]?.ggr || 0);
		return { ggr };
	}
	
	async getCasinoGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const { agentId, from, to, scope } = params;
		
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			return { ggr: 0 };
		}

		const conditions = [
			eq(reportingDailySnapshots.domain, 'casino'),
			eq(reportingDailySnapshots.tenant, agent.tenantId),
			gte(reportingDailySnapshots.snapshotDate, from),
			lte(reportingDailySnapshots.snapshotDate, to),
			// Use agent-level snapshots only; player-level rows would double-count totals.
			isNull(reportingDailySnapshots.playerId),
		];

		if (scope === 'direct') {
			conditions.push(eq(reportingDailySnapshots.agentId, agentId));
		} else {
			// Downline scope: include self and all descendants (full hierarchy)
			const descendantIds = await this.agentsRepo.getDescendantIds(agentId);
			conditions.push(inArray(reportingDailySnapshots.agentId, descendantIds));
		}

		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(...conditions));

		const ggr = Number(result[0]?.ggr || 0);
		return { ggr };
	}
	
	async getMatkaGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown> {
		const { agentId, from, to, scope } = params;
		
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			return { ggr: 0 };
		}

		const conditions = [
			eq(reportingDailySnapshots.domain, 'matka'),
			eq(reportingDailySnapshots.tenant, agent.tenantId),
			gte(reportingDailySnapshots.snapshotDate, from),
			lte(reportingDailySnapshots.snapshotDate, to),
			// Use agent-level snapshots only; player-level rows would double-count totals.
			isNull(reportingDailySnapshots.playerId),
		];

		if (scope === 'direct') {
			conditions.push(eq(reportingDailySnapshots.agentId, agentId));
		} else {
			// Downline scope: include self and all descendants (full hierarchy)
			const descendantIds = await this.agentsRepo.getDescendantIds(agentId);
			conditions.push(inArray(reportingDailySnapshots.agentId, descendantIds));
		}

		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(...conditions));

		const ggr = Number(result[0]?.ggr || 0);
		return { ggr };
	}

	async getSportsGGRByAgentIds(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown> {
		const { agentIds, tenantId, from, to } = params;
		if (agentIds.length === 0) return { ggr: 0 };
		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(
				eq(reportingDailySnapshots.domain, 'sports'),
				eq(reportingDailySnapshots.tenant, tenantId),
				gte(reportingDailySnapshots.snapshotDate, from),
				lte(reportingDailySnapshots.snapshotDate, to),
				inArray(reportingDailySnapshots.agentId, agentIds),
				// Use agent-level snapshots only; player-level rows would double-count totals.
				isNull(reportingDailySnapshots.playerId)
			));
		return { ggr: Number(result[0]?.ggr || 0) };
	}

	async getCasinoGGRByAgentIds(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown> {
		const { agentIds, tenantId, from, to } = params;
		if (agentIds.length === 0) return { ggr: 0 };
		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(
				eq(reportingDailySnapshots.domain, 'casino'),
				eq(reportingDailySnapshots.tenant, tenantId),
				gte(reportingDailySnapshots.snapshotDate, from),
				lte(reportingDailySnapshots.snapshotDate, to),
				inArray(reportingDailySnapshots.agentId, agentIds),
				// Use agent-level snapshots only; player-level rows would double-count totals.
				isNull(reportingDailySnapshots.playerId)
			));
		return { ggr: Number(result[0]?.ggr || 0) };
	}

	/**
	 * Commission totals read live bets, not snapshots. Snapshot days are whole days
	 * (inclusive end) and carry no referral attribution, so they never matched the
	 * IST Monday->Monday window payable uses. CommissionCalculationService prefers
	 * this method when a reader has it, which keeps every commission figure computed
	 * through this adapter equal to the payable.
	 */
	async getGGRByCycleAndAgent(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<CycleAgentGGRRow[]> {
		return this.liveReader().getGGRByCycleAndAgent({ ...params, whitelabelId: params.tenantId });
	}

	async countOpenBetsByAgentIds(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<OpenBetCounts> {
		return this.liveReader().countOpenBetsByAgentIds({ ...params, whitelabelId: params.tenantId });
	}

	private live: LiveGGRReader | null = null;
	private liveReader(): LiveGGRReader {
		if (!this.live) this.live = new LiveGGRReader();
		return this.live;
	}

	async getMatkaGGRByAgentIds(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown> {
		const { agentIds, tenantId, from, to } = params;
		if (agentIds.length === 0) return { ggr: 0 };
		const result = await db
			.select({
				ggr: sql<number>`COALESCE(SUM(${reportingDailySnapshots.grossGamingRevenue}::numeric), 0)`,
			})
			.from(reportingDailySnapshots)
			.where(and(
				eq(reportingDailySnapshots.domain, 'matka'),
				eq(reportingDailySnapshots.tenant, tenantId),
				gte(reportingDailySnapshots.snapshotDate, from),
				lte(reportingDailySnapshots.snapshotDate, to),
				inArray(reportingDailySnapshots.agentId, agentIds),
				// Use agent-level snapshots only; player-level rows would double-count totals.
				isNull(reportingDailySnapshots.playerId)
			));
		return { ggr: Number(result[0]?.ggr || 0) };
	}
}

