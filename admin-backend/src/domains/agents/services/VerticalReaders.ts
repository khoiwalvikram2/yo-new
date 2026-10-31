export type AgentDomain = 'sports' | 'casino' | 'matka';

export interface DomainGGRBreakdown {
	// Positive means player won (operator loss), negative means operator win
	// For our commission logic we use operator win as positive base; here we return operator GGR
	ggr: number;
}

export interface VerticalReaders {
	getSportsGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown>;
	getCasinoGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown>;
	getMatkaGGR(params: {
		agentId: string;
		from: Date;
		to: Date;
		scope: 'direct' | 'downline';
	}): Promise<DomainGGRBreakdown>;
	/** Optional: GGR for a set of agent IDs (used for hierarchical commission). */
	getSportsGGRByAgentIds?(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown>;
	getCasinoGGRByAgentIds?(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown>;
	getMatkaGGRByAgentIds?(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<DomainGGRBreakdown>;
	/**
	 * Optional: GGR per IST cycle and per attributed agent (players of agentIds),
	 * all domains. Lets commission sum a range cycle by cycle in three queries.
	 */
	getGGRByCycleAndAgent?(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<CycleAgentGGRRow[]>;
	/** Optional: bets placed in [from, to) by the players of agentIds that are still open. */
	countOpenBetsByAgentIds?(params: { agentIds: string[]; tenantId: string; from: Date; to: Date }): Promise<OpenBetCounts>;
}

/** One cycle's GGR for one agent's own players. cycleKey = IST Monday, YYYY-MM-DD. */
export interface CycleAgentGGRRow {
	cycleKey: string;
	agentId: string;
	sports: number;
	casino: number;
	matka: number;
}

export interface OpenBetCounts {
	sports: number;
	casino: number;
	matka: number;
}

// Default no-op readers to keep services functional until wired
export const ZeroReaders: VerticalReaders = {
	async getSportsGGR() {
		return { ggr: 0 };
	},
	async getCasinoGGR() {
		return { ggr: 0 };
	},
	async getMatkaGGR() {
		return { ggr: 0 };
	},
};

