import type { AgentDomain } from '../../../repos/agents/AgentsRepo.js';
import { agentExportPermissions } from '../../reporting/services/agentExportPolicy.js';

export interface AgentPermission {
	domain: string;
	actions: string[];
}

/**
 * Returns read-only monitoring permissions for a game domain.
 * Agents must not receive write/manage/update/delete for casino, sports, matka management.
 */
function getAgentDomainPermissions(domain: string): AgentPermission[] {
	switch (domain) {
		case 'casino':
			return [
				{ domain: 'casino', actions: ['read'] },
				{ domain: 'casino.live-analysis', actions: ['view'] },
				{ domain: 'casino.bets', actions: ['view'] },
			];
		case 'sports':
			return [
				{ domain: 'sports', actions: ['read'] },
				{ domain: 'sports.events', actions: ['view'] },
				{ domain: 'sports.live-analysis', actions: ['view'] },
				{ domain: 'sports.bets', actions: ['view'] },
			];
		case 'matka':
			return [
				{ domain: 'matka', actions: ['read'] },
				{ domain: 'matka.results', actions: ['view'] },
				{ domain: 'matka.live-analysis', actions: ['view'] },
				{ domain: 'matka.bets', actions: ['view'] },
			];
		default:
			return [{ domain, actions: ['read'] }];
	}
}

/**
 * Converts agent's allowedDomains to permissions format.
 * Game domains (casino, sports, matka) get read-only monitoring permissions only.
 * Base permissions for reporting, players, agents, users allow scoped operations.
 *
 * With the agent's scheme it also carries the Export Center rights of agentExportPolicy (agent
 * features spec §4, owner decision 4, 2026-10-22): `reporting.exports:create` and the nested
 * `<screen>:export` permissions of the types that scheme and those domains may export. Export and
 * create actions only, never a view permission (one of those opens a whole admin screen). Callers
 * that pass no scheme get exactly what they got before.
 */
export function deriveAgentPermissions(
	allowedDomains: AgentDomain[] | null | undefined,
	schemeType?: string | null
): AgentPermission[] {
	const domainPerms: AgentPermission[] = [];
	if (allowedDomains && Array.isArray(allowedDomains)) {
		for (const d of allowedDomains) {
			domainPerms.push(...getAgentDomainPermissions(d));
		}
	}

	const basePerms: AgentPermission[] = [
		{ domain: 'reporting', actions: ['read', 'view'] },
		{ domain: 'players', actions: ['view', 'manage'] },
		{ domain: 'users', actions: ['read', 'write'] },
		{ domain: 'agents', actions: ['view', 'manage', 'read'] },
		{ domain: 'bonuses', actions: ['read', 'view'] },
	];

	return [...domainPerms, ...basePerms, ...agentExportPermissions(schemeType, allowedDomains)];
}

/**
 * Checks if agent has permission for a specific domain
 */
export function hasAgentDomainPermission(
	allowedDomains: AgentDomain[] | null | undefined,
	domain: string
): boolean {
	// Safety check: ensure allowedDomains is an array
	if (!allowedDomains || !Array.isArray(allowedDomains)) {
		return false;
	}
	return allowedDomains.includes(domain as AgentDomain);
}

/**
 * Validates agent status - only ACTIVE agents can perform mutations and have full access
 */
export function isAgentActive(status: string): boolean {
	return status === 'ACTIVE';
}

/**
 * Whether an agent can login (ACTIVE = full access, INACTIVE = read-only after login).
 * SUSPENDED and BLOCKED cannot login.
 */
export function canAgentLogin(status: string): boolean {
	return status === 'ACTIVE' || status === 'INACTIVE';
}

/**
 * May an agent sign in, and is its token honoured, given its own status and the
 * statuses of its ancestors (agent_hierarchy_closure) that are not ACTIVE?
 * Owner decision 1 (2026-10-21): suspending or blocking an agent blocks its
 * whole subtree.
 *
 * - The agent itself SUSPENDED/BLOCKED: refused (canAgentLogin, unchanged).
 * - Any ancestor SUSPENDED/BLOCKED: refused, reason `ancestor_suspended`.
 * - The agent or any ancestor INACTIVE: allowed, read-only. INACTIVE already
 *   means read-only for the agent itself; its subtree inherits that.
 */
export function agentAccessVerdict(
	ownStatus: string,
	ancestorStatuses: readonly string[]
): { allowed: boolean; isReadOnly: boolean; reason?: 'suspended' | 'inactive' | 'ancestor_suspended' } {
	if (!canAgentLogin(ownStatus)) {
		return { allowed: false, isReadOnly: true, reason: ownStatus === 'SUSPENDED' ? 'suspended' : 'inactive' };
	}
	if (ancestorStatuses.some((s) => !canAgentLogin(s))) {
		return { allowed: false, isReadOnly: true, reason: 'ancestor_suspended' };
	}
	const isReadOnly = ownStatus === 'INACTIVE' || ancestorStatuses.includes('INACTIVE');
	return { allowed: true, isReadOnly };
}

