import { buildAgentsQueryResolvers } from './queries';
import { buildAgentsMutationResolvers } from './mutations';
import { agentsSubscriptionResolvers } from './subscriptions';
import { AgentConfigsRepo } from '../../../repos/agents/AgentConfigsRepo';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { hasPermission } from '@src/domains/common/auth.js';
import { guardAgentMutations } from './guardAgentMutations.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { readAgentAccountRates } from '../services/agentAccountRates.js'
import { agentAccountChips, buildChipQueryResolvers } from './chipResolvers.js'

// The chip reads (spec 2026-11-02 §7) sit beside the other agent reads, behind the same agents.list:view gate, except
// the two the Chips page (/credit) makes: that page is open to credit.management:view as well (owner decision
// 2026-11-04; Finance Manager holds it without agents.list:view), so chipPool and chipDownline admit either. Read-only
// and scoped as before by ChipService: an admin reads its tenant's CREDIT accounts, an agent its own subtree.
// The chip moves are spread into buildAgentsMutationResolvers, so guardAgentMutations wraps them like the rest.
export const CHIPS_PAGE_READS: ReadonlySet<string> = new Set(['chipPool', 'chipDownline']);

const AGENTS_FORBIDDEN = 'Forbidden: insufficient permissions to access agents';
const mayListAgents = (ctx: any) => hasPermission(ctx?.permissions ?? [], 'agents.list', 'view');
const mayReadChipsPage = (ctx: any) => hasPermission(ctx?.permissions ?? [], 'credit.management', 'view');

/**
 * Query.agents now lets a credit.management:view caller in for the Chips page reads, so every other AgentsQuery field
 * asks for agents.list:view itself, exactly as the namespace did for all of them.
 */
function requireAgentsList<T extends Record<string, (...args: any[]) => any>>(fields: T): T {
	const gated: Record<string, unknown> = {};
	for (const [name, resolve] of Object.entries(fields)) {
		gated[name] = CHIPS_PAGE_READS.has(name)
			? resolve
			: async (parent: unknown, args: unknown, ctx: any, info: unknown) => {
					if (!ctx?.user) throw new Error('Unauthorized: authentication required');
					if (!mayListAgents(ctx)) throw new Error(AGENTS_FORBIDDEN);
					return resolve(parent, args, ctx, info);
				};
	}
	return gated as T;
}

const queryResolvers = requireAgentsList({ ...buildAgentsQueryResolvers(), ...buildChipQueryResolvers() });

const configsRepo = new AgentConfigsRepo();
const agentsRepo = new AgentsRepo();

export const agentsResolvers = {
	Query: {
		agents: (_: any, __: any, ctx: any) => {
			// agents.list:view opens every field; credit.management:view only CHIPS_PAGE_READS (requireAgentsList).
			if (!mayListAgents(ctx) && !mayReadChipsPage(ctx)) {
				throw new Error(AGENTS_FORBIDDEN);
			}
			return {};
		},
	},
	Mutation: {
		// The namespace itself stays open because `agentLogin` lives underneath
		// it and there is no session yet when that is called. Every other field
		// is gated individually — see guardAgentMutations.
		agents: () => {
			return {};
		},
	},
	Subscription: agentsSubscriptionResolvers,
	AgentsQuery: queryResolvers,
	AgentsMutation: guardAgentMutations(buildAgentsMutationResolvers()),
	AgentAccount: {
		/**
		 * Walks one step UP the hierarchy, which is the opposite direction to the
		 * one this model authorises.
		 *
		 * It took no `ctx` at all — measured arity 1, so it could not have been
		 * authorising anything — and returned the upline's whole row: creditLimit,
		 * creditUsed, creditAvailable and every settlement balance. An agent sees
		 * its own subtree through `agent_hierarchy_closure`; its upline is by
		 * definition outside that subtree, so a sub-agent was reading its master's
		 * total credit position. `parentAgent` returns an `AgentAccount`, so the
		 * query recursed up the chain until the depth limit of 6 stopped it.
		 *
		 * An admin keeps the full row, scoped to their tenant — reading the
		 * hierarchy is what the agent screens are for. An agent gets identity only.
		 *
		 * The redaction sets the money fields explicitly rather than omitting them:
		 * `settlementBalanceByDomain` below re-reads from the database when its
		 * three inputs are `undefined`, so an object with the fields simply left out
		 * would have leaked exactly what this removes. The admin panel only ever
		 * asks this field for `id` and `username`.
		 */
		parentAgent: async (parent: any, _args: any, ctx: any) => {
			if (!parent.parentAgentId) return null;
			try {
				const row: any = await agentsRepo.findById(parent.parentAgentId);
				if (!row) return null;

				const callerTenant =
					getEffectiveTenantForDirector(ctx) ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? null;
				if (callerTenant && row.tenantId && row.tenantId !== callerTenant) return null;

				if (ctx?.user?.type !== 'agent') return row;

				return {
					id: row.id,
					username: row.username ?? null,
					name: row.name ?? null,
					status: row.status ?? null,
					levelIndex: row.levelIndex ?? null,
					// Stops the walk one step up rather than letting it climb to the root.
					parentAgentId: null,
					// Defined-but-empty, so no nested resolver re-fetches them.
					schemeType: null,
					allowedDomains: [],
					creditLimit: null,
					creditUsed: null,
					creditAvailable: null,
					creditAlertThreshold: null,
					settlementBalance: null,
					settlementBalanceSports: 0,
					settlementBalanceCasino: 0,
					settlementBalanceMatka: 0,
				};
			} catch (error) {
				return null;
			}
		},
		/**
		 * A CREDIT agent's chip figures (null for every other scheme), batched per request: a list of agents costs
		 * one figures read, not one per row. Scoped to the caller's tenant, and for an agent caller to its own
		 * subtree, so the redacted upline that parentAgent returns to an agent never carries chips.
		 */
		chips: (parent: any, args: unknown, ctx: any) => agentAccountChips(parent, args, ctx),
		/**
		 * The ancestor that blocks this agent (SUSPENDED / BLOCKED) or makes it read-only (INACTIVE), which its own
		 * status does not show: the restriction cascades down the subtree (owner decision 1, 2026-10-21) and is only
		 * applied at sign-in and per request. The profile head names it. An agent caller is told only of one inside its
		 * own subtree, never of its upline's statuses. Read per agent: only the profile asks for it.
		 */
		blockedByAncestor: async (parent: any, _args: any, ctx: any) => {
			if (!parent?.id || parent.parentAgentId === null) return null;
			try {
				const block = await agentsRepo.findRestrictingAncestor(String(parent.id));
				if (!block) return null;
				if (ctx?.user?.type === 'agent') {
					const callerId = ctx?.user?.agentId ? String(ctx.user.agentId) : '';
					if (!callerId || !(await agentsRepo.getDescendantIds(callerId)).includes(block.id)) return null;
				}
				return block;
			} catch (error) {
				return null;
			}
		},
		creditLimit: (parent: any) => {
			return parent.creditLimit != null ? Number(parent.creditLimit) : null;
		},
		creditUsed: (parent: any) => {
			return parent.creditUsed != null ? Number(parent.creditUsed) : null;
		},
		creditAvailable: (parent: any) => {
			return parent.creditAvailable != null ? Number(parent.creditAvailable) : null;
		},
		creditAlertThreshold: (parent: any) => {
			return parent.creditAlertThreshold != null ? Number(parent.creditAlertThreshold) : null;
		},
		settlementBalance: (parent: any) => {
			return parent.settlementBalance != null ? Number(parent.settlementBalance) : null;
		},
		settlementBalanceSports: (parent: any) => {
			return parent.settlementBalanceSports != null ? Number(parent.settlementBalanceSports) : null;
		},
		settlementBalanceCasino: (parent: any) => {
			return parent.settlementBalanceCasino != null ? Number(parent.settlementBalanceCasino) : null;
		},
		settlementBalanceMatka: (parent: any) => {
			return parent.settlementBalanceMatka != null ? Number(parent.settlementBalanceMatka) : null;
		},
		settlementBalanceByDomain: async (parent: any) => {
			// If domain-specific balances are already in parent, use them
			// Otherwise, fetch from database
			let sports = 0;
			let casino = 0;
			let matka = 0;
			
			if (parent.settlementBalanceSports !== undefined && parent.settlementBalanceCasino !== undefined && parent.settlementBalanceMatka !== undefined) {
				sports = Number(parent.settlementBalanceSports || 0);
				casino = Number(parent.settlementBalanceCasino || 0);
				matka = Number(parent.settlementBalanceMatka || 0);
			} else {
				// Fetch from database if not in parent
				try {
					const creditFields = await agentsRepo.getCreditFields(parent.id);
					if (creditFields) {
						sports = creditFields.settlementBalanceSports;
						casino = creditFields.settlementBalanceCasino;
						matka = creditFields.settlementBalanceMatka;
					}
				} catch (error) {
				}
			}
			
			return [
				{ domain: 'sports', settlementBalance: sports },
				{ domain: 'casino', settlementBalance: casino },
				{ domain: 'matka', settlementBalance: matka },
			];
		},
		createdAt: (parent: any) => {
			try {
				if (!parent.createdAt) return null;
				
				// Drizzle returns Date objects for timestamp fields
				if (parent.createdAt instanceof Date) {
					return parent.createdAt.toISOString();
				}
				
				// If it's already an ISO string, return as is
				if (typeof parent.createdAt === 'string') {
					// Check if it's already a valid ISO string
					if (parent.createdAt.includes('T') && parent.createdAt.includes('Z')) {
						return parent.createdAt;
					}
					// Try to parse and convert to ISO
					const date = new Date(parent.createdAt);
					return isNaN(date.getTime()) ? null : date.toISOString();
				}
				
				// If it's a number (timestamp), convert it
				if (typeof parent.createdAt === 'number') {
					const date = parent.createdAt > 1000000000000 
						? new Date(parent.createdAt) // milliseconds
						: new Date(parent.createdAt * 1000); // seconds
					return isNaN(date.getTime()) ? null : date.toISOString();
				}
				
				return null;
			} catch (error) {
				return null;
			}
		},
		commissionRates: async (parent: any, _args?: any, ctx?: any) => {
			if (parent.schemeType !== 'COMMISSION') return [];
			const now = new Date();
			if (ctx && typeof ctx === 'object') {
				const rates = await readAgentAccountRates(parent, 'commission', ctx, now);
				if (rates) return rates;
			}
			const rates = [];
			try {
				for (const domain of parent.allowedDomains || []) {
					const config = await configsRepo.getCommissionConfig(parent.id, domain, now);
					if (config) {
						rates.push({
							domain,
							rate: Number(config.commissionRate) * 100, // Convert to percentage
						});
					}
				}
			} catch (error) {
			}
			return rates;
		},
		sharingRates: async (parent: any, _args?: any, ctx?: any) => {
			if (parent.schemeType !== 'SHARING' && parent.schemeType !== 'CREDIT') return [];
			const now = new Date();
			if (ctx && typeof ctx === 'object') {
				const rates = await readAgentAccountRates(parent, 'sharing', ctx, now);
				if (rates) return rates;
			}
			const rates = [];
			try {
				for (const domain of parent.allowedDomains || []) {
					const config = await configsRepo.getSharingConfig(parent.id, domain, now);
					if (config) {
						rates.push({
							domain,
							rate: Number(config.shareRate) * 100, // Convert to percentage
						});
					}
				}
			} catch (error) {
			}
			return rates;
		},
	},
	CommissionConfig: {
		// Convert commissionRate from decimal (0..1) to percentage (0-100) for GraphQL response
		commissionRate: (parent: any) => {
			return Number(parent.commissionRate) * 100;
		},
		effectiveFrom: (parent: any) => {
			if (!parent.effectiveFrom) return null;
			if (parent.effectiveFrom instanceof Date) {
				return parent.effectiveFrom.toISOString();
			}
			return parent.effectiveFrom;
		},
		effectiveTo: (parent: any) => {
			if (!parent.effectiveTo) return null;
			if (parent.effectiveTo instanceof Date) {
				return parent.effectiveTo.toISOString();
			}
			return parent.effectiveTo;
		},
	},
};
