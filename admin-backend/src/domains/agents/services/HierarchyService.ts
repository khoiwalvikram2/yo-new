import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { walkUnique } from './hierarchyWalk';

export class HierarchyService {
	constructor(private agentsRepo: AgentsRepo) {}

	/**
	 * Validate that a sub-agent can be created under a parent agent
	 */
	async validateSubAgentCreation(
		parentAgentId: string,
		subAgentData: {
			allowedDomains: string[];
			commissionRate?: number;
			shareRate?: number;
		}
	): Promise<{ valid: boolean; error?: string }> {
		const parentAgent = await this.agentsRepo.findById(parentAgentId);
		if (!parentAgent) {
			return { valid: false, error: 'Parent agent not found' };
		}

		// Check parent agent is active
		if (parentAgent.status !== 'ACTIVE') {
			return { valid: false, error: 'Parent agent is not active' };
		}

		// Validate domains: sub-agent's domains must be subset of parent's
		const parentDomains = new Set(parentAgent.allowedDomains || []);
		const subDomains = subAgentData.allowedDomains || [];

		for (const domain of subDomains) {
			if (!parentDomains.has(domain)) {
				return {
					valid: false,
					error: `Domain '${domain}' is not allowed for parent agent`,
				};
			}
		}

		// No credit check: a CREDIT sub-agent's creditLimit is a credit reference now, never drawn from its parent
		// (spec 2026-11-02 §4.4); its opening chips are checked by the deposit that gives them.

		// Validate commission/sharing rates
		if (subAgentData.commissionRate !== undefined || subAgentData.shareRate !== undefined) {
			const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo');
			const configsRepo = new AgentConfigsRepo();
			const now = new Date();

			// Check each domain
			for (const domain of subAgentData.allowedDomains) {
				if (subAgentData.commissionRate !== undefined && parentAgent.schemeType === 'COMMISSION') {
					const parentConfig = await configsRepo.getCommissionConfig(
						parentAgent.id,
						domain as 'sports' | 'casino' | 'matka',
						now
					);
					if (parentConfig) {
						const parentRate = Number(parentConfig.commissionRate);
						const subRate = subAgentData.commissionRate;
						if (subRate > parentRate) {
							return {
								valid: false,
								error: `Commission rate (${subRate}%) cannot exceed parent's rate (${parentRate}%) for ${domain}`,
							};
						}
					}
				}

				if (subAgentData.shareRate !== undefined && (parentAgent.schemeType === 'SHARING' || parentAgent.schemeType === 'CREDIT')) {
					const parentConfig = await configsRepo.getSharingConfig(
						parentAgent.id,
						domain as 'sports' | 'casino' | 'matka',
						now
					);
					if (parentConfig) {
						const parentRate = Number(parentConfig.shareRate);
						const subRate = subAgentData.shareRate;
						if (subRate > parentRate) {
							return {
								valid: false,
								error: `Share rate (${subRate}%) cannot exceed parent's rate (${parentRate}%) for ${domain}`,
							};
						}
					}
				}
			}
		}

		return { valid: true };
	}

	/**
	 * Validate that a whitelabel admin can create an agent with the given sharing rates
	 * The agent's sharing rates cannot exceed the whitelabel's own sharing rates
	 */
	async validateWhitelabelAgentCreation(
		whitelabelId: string,
		agentData: {
			allowedDomains: string[];
			shareRate?: number;
			sharingRates?: Record<string, number>;
		}
	): Promise<{ valid: boolean; error?: string }> {
		const { getWhitelabelSharingConfig } = await import('@/repos/common/whitelabelRepo.js');
		const now = new Date();

		// Check each domain
		for (const domain of agentData.allowedDomains) {
			// Get whitelabel's sharing config for this domain
			const whitelabelConfig = await getWhitelabelSharingConfig(
				whitelabelId,
				domain as 'sports' | 'casino' | 'matka',
				now
			);

			if (!whitelabelConfig) {
				// If whitelabel has no sharing config for this domain, agent cannot have sharing either
				if (agentData.shareRate !== undefined || (agentData.sharingRates && agentData.sharingRates[domain])) {
					return {
						valid: false,
						error: `Whitelabel has no sharing configured for ${domain}. Cannot assign sharing to agent.`,
					};
				}
				continue;
			}

			const whitelabelRate = Number(whitelabelConfig.shareRate);
			
			// Check if using single shareRate (legacy) or per-domain sharingRates
			let agentRate: number | undefined;
			if (agentData.sharingRates && agentData.sharingRates[domain] !== undefined) {
				agentRate = agentData.sharingRates[domain] / 100; // Convert percentage to decimal
			} else if (agentData.shareRate !== undefined) {
				agentRate = agentData.shareRate / 100; // Convert percentage to decimal
			}

			if (agentRate !== undefined && agentRate > whitelabelRate) {
				const whitelabelRatePercent = (whitelabelRate * 100).toFixed(2);
				const agentRatePercent = (agentRate * 100).toFixed(2);
				return {
					valid: false,
					error: `Agent share rate (${agentRatePercent}%) cannot exceed whitelabel's rate (${whitelabelRatePercent}%) for ${domain}`,
				};
			}
		}

		return { valid: true };
	}

	/**
	 * Check if an agent has permission to manage another agent (parent-child relationship)
	 */
	async canManageAgent(
		actorAgentId: string,
		targetAgentId: string
	): Promise<boolean> {
		if (actorAgentId === targetAgentId) {
			return true; // Agent can manage themselves
		}

		const targetAgent = await this.agentsRepo.findById(targetAgentId);
		if (!targetAgent) {
			return false;
		}

		// Check if actor is the direct parent
		if (targetAgent.parentAgentId === actorAgentId) {
			return true;
		}

		// Check if actor is anywhere in the parent chain
		return this.isInHierarchy(actorAgentId, targetAgentId);
	}

	/**
	 * Check if an agent is in the parent chain of another agent
	 */
	private async isInHierarchy(
		ancestorAgentId: string,
		descendantAgentId: string
	): Promise<boolean> {
		let currentAgent = await this.agentsRepo.findById(descendantAgentId);
		const visited = new Set<string>(); // Prevent infinite loops

		while (currentAgent && currentAgent.parentAgentId) {
			if (visited.has(currentAgent.id)) {
				// Circular reference detected
				return false;
			}
			visited.add(currentAgent.id);

			if (currentAgent.parentAgentId === ancestorAgentId) {
				return true;
			}

			currentAgent = await this.agentsRepo.findById(currentAgent.parentAgentId);
		}

		return false;
	}

	/**
	 * Get all agents in a hierarchy (including sub-agents recursively)
	 */
	async getHierarchyAgentIds(rootAgentId: string): Promise<string[]> {
		// CR-12: cycle-safe traversal. A corrupt/re-parented hierarchy (e.g. A->B & B->A)
		// would make a naive recursive descent stack-overflow; walkUnique threads a visited
		// Set so every reachable id is returned exactly once and traversal always terminates.
		return walkUnique(rootAgentId, async (id) => {
			const children = await this.agentsRepo.listChildren(id);
			return children.map((child) => child.id);
		});
	}

	/**
	 * Validate that limits being set don't exceed parent agent's limits
	 */
	async validateLimits(
		agentId: string,
		limits: {
			dailyDepositLimit?: number;
			weeklyDepositLimit?: number;
			monthlyDepositLimit?: number;
			dailyWithdrawalLimit?: number;
			weeklyWithdrawalLimit?: number;
			monthlyWithdrawalLimit?: number;
			maxBetAmountSports?: number;
			maxBetAmountCasino?: number;
			maxBetAmountMatka?: number;
		}
	): Promise<{ valid: boolean; error?: string }> {
		const agent = await this.agentsRepo.findById(agentId);
		if (!agent || !agent.parentAgentId) {
			// Root agents or non-existent agents - no validation needed
			return { valid: true };
		}

		// Note: Agent limits validation is not implemented as agents don't have player limits
		// This method is for future use if agents need to set default limits for their players
		// For now, player limits are set independently and validated at the player level
		// If needed in the future, we would:
		// 1. Get parent agent's default limits (if they exist)
		// 2. Ensure sub-agent's limits don't exceed parent's limits
		// 3. Validate against system-wide maximums

		return { valid: true };
	}
}

