import { db } from '@/db/client.js';
import { users, referralAttributions } from '@shared/db/schema.js';
import { eq, or, and, inArray } from 'drizzle-orm';

/**
 * Service to handle player authorization for agents
 */
export class PlayerAuthService {
	/**
	 * Every player id in an agent's subtree: the agent's own players plus those
	 * of every descendant agent, for all scheme types.
	 *
	 * A player reaches an agent by two routes and both are covered:
	 *   1. direct assignment — users.agent_id points at an agent in the subtree
	 *   2. referral — the player was referred by someone already in the subtree
	 *
	 * The subtree comes from agent_hierarchy_closure in a single query. The
	 * previous implementation walked children recursively with no visited set, so
	 * a corrupt hierarchy (A -> B -> A) recursed until it threw, and issued one
	 * query per node besides.
	 */
	async getAgentPlayerIds(agentId: string, tenant: string): Promise<number[]> {
		const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
		const agentsRepo = new AgentsRepo();

		// getDescendantIds includes the agent itself (closure stores a depth-0 self row).
		const subtreeAgentIds = await agentsRepo.getDescendantIds(agentId);
		if (subtreeAgentIds.length === 0) return [];

		const directPlayers = await db
			.select({ id: users.id })
			.from(users)
			.where(and(inArray(users.agentId, subtreeAgentIds), eq(users.tenant, tenant)));

		const playerIds = new Set<number>();
		for (const p of directPlayers) {
			if (typeof p.id === 'number') playerIds.add(p.id);
		}

		// Players referred by anyone already in the subtree. Batched: one query for
		// all referrers rather than one per player. Only CONFIRMED attributions link a
		// player, the same rule as reporting and settlement (AgentFilterUtils
		// buildAgentFilterCTE): a rejected or reattributed one no longer ties the referee
		// to this branch (reattributed means another referrer now owns it).
		if (playerIds.size > 0) {
			const referred = await db
				.select({ refereeId: referralAttributions.refereeId })
				.from(referralAttributions)
				.where(
					and(
						inArray(referralAttributions.referrerId, Array.from(playerIds)),
						eq(referralAttributions.tenant, tenant),
						eq(referralAttributions.status, 'confirmed')
					)
				);
			for (const r of referred) {
				if (typeof r.refereeId === 'number') playerIds.add(r.refereeId);
			}
		}

		return Array.from(playerIds);
	}

	/**
	 * Check if an agent can access a specific player
	 */
	async canAgentAccessPlayer(
		agentId: string,
		playerId: number,
		tenant: string
	): Promise<boolean> {
		const agentPlayerIds = await this.getAgentPlayerIds(agentId, tenant);
		return agentPlayerIds.includes(playerId);
	}

	/**
	 * Validate that an agent is authorized to perform an action on a player
	 * Throws an error if not authorized
	 */
	async validateAgentPlayerAccess(
		ctx: any,
		playerId: number,
		action: string = 'access'
	): Promise<void> {
		// If not an agent, skip validation (admin access)
		if (!ctx?.user?.type || ctx.user.type !== 'agent' || !ctx.user.agentId) {
			return;
		}

		const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
		const canAccess = await this.canAgentAccessPlayer(
			ctx.user.agentId,
			playerId,
			tenant
		);

		if (!canAccess) {
			throw new Error(
				`Unauthorized: You do not have permission to ${action} this player`
			);
		}
	}

	/**
	 * Filter player IDs to only include those accessible by an agent
	 * If not an agent (admin), returns all IDs
	 */
	async filterPlayerIdsForAgent(
		ctx: any,
		playerIds: number[]
	): Promise<number[]> {
		// If not an agent, return all IDs (admin access)
		if (!ctx?.user?.type || ctx.user.type !== 'agent' || !ctx.user.agentId) {
			return playerIds;
		}

		const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
		const agentPlayerIds = await this.getAgentPlayerIds(ctx.user.agentId, tenant);
		const agentPlayerSet = new Set(agentPlayerIds);

		return playerIds.filter(id => agentPlayerSet.has(id));
	}
}

