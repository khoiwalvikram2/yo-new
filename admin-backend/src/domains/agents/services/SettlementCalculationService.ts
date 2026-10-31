import { AgentsRepo } from '@/repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '@/repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '@/repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '@/repos/agents/AgentSettlementsRepo';
import { AgentListStatsService } from './AgentListStatsService';
import { SettlementContributionService, type PlayerContribution, type SubAgentContribution } from '../../settlements/services/SettlementContributionService';

export interface SettlementSummary {
	agentId: string;
	periodFrom: Date;
	periodTo: Date;
	sharePercentage: number;
	netPL: number;
	sportsPL: number;
	casinoPL: number;
	matkaPL: number;
	agentShare: number;
	platformShare: number;
	/** SHARING: signed like the SHARE lines — positive = TO_AGENT (the agent is paid), negative = FROM_AGENT. */
	settlementDue: number;
	/** SHARING: who pays settlementDue. 'NONE' for CREDIT (see getPendingSettlement) or when nothing is owed. */
	settlementDirection?: 'TO_AGENT' | 'FROM_AGENT' | 'NONE';
	lastSettlementDate: Date | null;
	lastSettlementAmount: number;
	currency: string;
	// Domain-wise breakdown
	sportsShare: number;
	casinoShare: number;
	matkaShare: number;
	sportsShareRate: number;
	casinoShareRate: number;
	matkaShareRate: number;
	// Contribution breakdown (optional, added by calculateSettlementSummaryWithContributions)
	directPlayersContribution?: number;
	subAgentsContribution?: number;
	directPlayersCount?: number;
	subAgentsCount?: number;
	topPlayers?: PlayerContribution[];
	subAgents?: SubAgentContribution[];
}

export interface LedgerEntry {
	id: string;
	date: Date;
	transactionType: string;
	debit: number;
	credit: number;
	balance: number;
	notes: string;
	currency: string;
}

export class SettlementCalculationService {
	constructor(
		private agentsRepo: AgentsRepo,
		private configsRepo: AgentConfigsRepo,
		private ledgerRepo: AgentLedgerRepo,
		private settlementsRepo: AgentSettlementsRepo,
		private statsService?: AgentListStatsService
	) {
		if (!this.statsService) {
			this.statsService = new AgentListStatsService();
		}
	}

	/**
	 * Calculate settlement summary for a sharing agent over a period
	 */
	async calculateSettlementSummary(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string
	): Promise<SettlementSummary> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT') {
			throw new Error('Agent is not on sharing/credit scheme');
		}

		// The share figures of [periodFrom, periodTo) come from the settlement engine:
		// the same GGR reader (LiveGGRReader, the agent's whole subtree), half-open
		// window and per-rate-segment maths as the SHARE lines a settlement posts.
		// P/L fields are the players' P/L (−GGR); share fields are the agent's share,
		// positive = TO_AGENT (players lost, the agent is paid), as the SHARE lines.
		const { createSharingSettlementEngine } = await import('./sharingSettlementWiring');
		const engine = createSharingSettlementEngine();
		const fresh = await engine.computeShare(agent as any, periodFrom, periodTo);

		const sportsPL = -fresh.byDomain.sports.ggr;
		const casinoPL = -fresh.byDomain.casino.ggr;
		const matkaPL = -fresh.byDomain.matka.ggr;
		const netPL = sportsPL + casinoPL + matkaPL;

		// Rate in force at the window start (decimal 0..1), for display; the shares
		// themselves use every rate segment in the window.
		const sportsShareRate = fresh.byDomain.sports.rateAtStart;
		const casinoShareRate = fresh.byDomain.casino.rateAtStart;
		const matkaShareRate = fresh.byDomain.matka.rateAtStart;

		const sportsShare = fresh.byDomain.sports.share;
		const casinoShare = fresh.byDomain.casino.share;
		const matkaShare = fresh.byDomain.matka.share;

		// Total agent share across all domains; the platform keeps the rest of the GGR.
		const agentShare = fresh.total;
		const platformShare = fresh.totalGgr - agentShare;

		// Effective share percentage (weighted by |GGR|), for display only.
		let weighted = 0;
		let weight = 0;
		for (const d of ['sports', 'casino', 'matka'] as const) {
			const g = Math.abs(fresh.byDomain[d].ggr);
			weighted += g * fresh.byDomain[d].effectiveRate;
			weight += g;
		}
		const sharePercentage = weight > 0 ? (weighted / weight) * 100 : 0;

		// Get last settlement info
		const currentDate = new Date();
		const oneYearAgo = new Date(currentDate.getTime() - 365 * 24 * 60 * 60 * 1000);
		const settlements = await this.settlementsRepo.list(agentId, oneYearAgo, currentDate);
		const lastSettlement = settlements.find(s => s.status === 'POSTED') || settlements[0] || null;

		// Settlement due: what is still owed for the open window, from the same engine
		// the settle mutation uses. SHARING sign convention (as the SHARE/SETTLEMENT
		// lines): positive = TO_AGENT (the agent is paid), negative = FROM_AGENT (the
		// agent pays). It used to be "positive = collect" from stats P/L, the opposite
		// of what the settlement then posted.
		let settlementDue = 0;
		let settlementDirection: 'TO_AGENT' | 'FROM_AGENT' | 'NONE' = 'NONE';
		if (agent.schemeType === 'SHARING') {
			const pending = await engine.pending(agent as any);
			settlementDue = pending.remaining;
			settlementDirection = pending.direction;
		} else {
			// For CREDIT agents, use ledger-based calculation
			settlementDue = await this.getPendingSettlement(agentId, currency);
		}

		return {
			agentId,
			periodFrom,
			periodTo,
			sharePercentage,
			netPL,
			sportsPL,
			casinoPL,
			matkaPL,
			agentShare,
			platformShare,
			settlementDue,
			settlementDirection,
			lastSettlementDate: lastSettlement?.postedAt ? new Date(lastSettlement.postedAt) : null,
			lastSettlementAmount: lastSettlement ? Number(lastSettlement.totalAmount) : 0,
			currency,
			// Domain-wise breakdown
			sportsShare,
			casinoShare,
			matkaShare,
			sportsShareRate: sportsShareRate * 100, // Convert to percentage
			casinoShareRate: casinoShareRate * 100,
			matkaShareRate: matkaShareRate * 100,
		};
	}

	/**
	 * Calculate settlement summary with contribution breakdown
	 */
	async calculateSettlementSummaryWithContributions(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string
	): Promise<SettlementSummary & {
		directPlayersContribution: number;
		subAgentsContribution: number;
		directPlayersCount: number;
		subAgentsCount: number;
		topPlayers: PlayerContribution[];
		subAgents: SubAgentContribution[];
	}> {
		// Calculate base summary
		const baseSummary = await this.calculateSettlementSummary(agentId, periodFrom, periodTo, currency);
		
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent) {
			throw new Error('Agent not found');
		}

		// Get contributions using SettlementContributionService
		const contributionService = new SettlementContributionService();
		const contributions = await contributionService.getPlayerContributions(
			agentId,
			periodFrom,
			periodTo,
			agent.tenantId
		);

		// Get top players (sorted by absolute P/L, limit to top 10)
		const topPlayers = [...contributions.directPlayers]
			.sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl))
			.slice(0, 10);

		return {
			...baseSummary,
			directPlayersContribution: contributions.totals.directShare,
			subAgentsContribution: contributions.totals.subAgentShare,
			directPlayersCount: contributions.totals.directPlayersCount,
			subAgentsCount: contributions.totals.subAgentsCount,
			topPlayers,
			subAgents: contributions.subAgents,
		};
	}

	/**
	 * Get complete ledger entries for an agent
	 */
	async getLedgerEntries(
		agentId: string,
		periodFrom?: Date,
		periodTo?: Date,
		filters?: {
			transactionType?: string;
			limit?: number;
			offset?: number;
		}
	): Promise<{ entries: LedgerEntry[]; total: number }> {
		const ledgerLines = await this.ledgerRepo.list(
			agentId,
			periodFrom || new Date(0),
			periodTo || new Date()
		);

		// Convert ledger lines to ledger entries with running balance
		let runningBalance = 0;
		const entries: LedgerEntry[] = ledgerLines.map((line) => {
			const amount = Number(line.amount);
			const isDebit = line.lineType === 'SETTLEMENT' || line.lineType === 'ADJUSTMENT';
			const debit = isDebit ? Math.abs(amount) : 0;
			const credit = !isDebit ? Math.abs(amount) : 0;

			runningBalance += credit - debit;

			return {
				id: line.id,
				date: new Date(line.createdAt),
				transactionType: this.getTransactionTypeLabel(line.lineType),
				debit,
				credit,
				balance: runningBalance,
				notes: line.refKey || '',
				currency: line.currency,
			};
		});

		// Apply filters
		let filteredEntries = entries;
		if (filters?.transactionType) {
			filteredEntries = entries.filter(e => e.transactionType === filters.transactionType);
		}

		const total = filteredEntries.length;
		const offset = filters?.offset || 0;
		const limit = filters?.limit || total;

		return {
			entries: filteredEntries.slice(offset, offset + limit),
			total,
		};
	}

	/**
	 * Get pending settlement amount (not yet settled)
	 */
	async getPendingSettlement(agentId: string, currency: string): Promise<number> {
		// Get all SHARE entries that haven't been settled
		const now = new Date();
		const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
		const entries = await this.ledgerRepo.list(agentId, oneYearAgo, now);
		
		// Filter SHARE entries in the specified currency
		const shareEntries = entries.filter(
			(e) => e.lineType === 'SHARE' && e.currency === currency
		);
		
		// Get settlement entries to check which shares have been settled
		const settlementEntries = entries.filter(
			(e) => e.lineType === 'SETTLEMENT' && e.currency === currency
		);

		// Match share entries with settlements by period
		const settledShareIds = new Set<string>();
		settlementEntries.forEach((settlement) => {
			shareEntries.forEach((share) => {
				const shareFrom = new Date(share.periodFrom);
				const shareTo = new Date(share.periodTo);
				const settlementFrom = new Date(settlement.periodFrom);
				const settlementTo = new Date(settlement.periodTo);
				
				// Check if share period overlaps with settlement period
				if (
					(shareFrom >= settlementFrom && shareFrom <= settlementTo) ||
					(shareTo >= settlementFrom && shareTo <= settlementTo) ||
					(shareFrom <= settlementFrom && shareTo >= settlementTo)
				) {
					settledShareIds.add(share.id);
				}
			});
		});

		// Sum only unsettled shares
		const unsettledShares = shareEntries.filter(
			(e) => !settledShareIds.has(e.id)
		);

		return unsettledShares.reduce((sum, entry) => sum + Number(entry.amount), 0);
	}

	/**
	 * Accrue settlement for a period
	 * DEPRECATED: Auto settlement is disabled. This method should not be called.
	 * Settlements must be done manually through the settleAgent mutation.
	 * Creates ledger entries for P&L sharing
	 */
	async accrueSettlement(
		agentId: string,
		periodFrom: Date,
		periodTo: Date,
		currency: string
	): Promise<void> {
		// Prevent auto settlement - settlements must be manual
		throw new Error(
			'Auto settlement is disabled. Settlements must be done manually through the settleAgent mutation. ' +
			'This method (accrueSettlement) should not be called by any cron job or automated process.'
		);
	}

	/**
	 * Validate settlement request
	 */
	async validateSettlementRequest(
		agentId: string,
		requestedAmount: number,
		currency: string
	): Promise<{ valid: boolean; error?: string; availableAmount?: number }> {
		const pendingAmount = await this.getPendingSettlement(agentId, currency);

		if (requestedAmount <= 0) {
			return { valid: false, error: 'Settlement amount must be greater than zero' };
		}

		if (requestedAmount > pendingAmount) {
			return {
				valid: false,
				error: `Requested amount exceeds available settlement. Available: ${pendingAmount}`,
				availableAmount: pendingAmount,
			};
		}

		return { valid: true, availableAmount: pendingAmount };
	}

	/**
	 * Convert ledger line type to user-friendly label
	 */
	private getTransactionTypeLabel(lineType: string): string {
		const labels: Record<string, string> = {
			COMMISSION: 'Commission Earned',
			SHARE: 'P&L Share',
			SETTLEMENT: 'Settlement Payment',
			ADJUSTMENT: 'Manual Adjustment',
		};
		return labels[lineType] || lineType;
	}
}

