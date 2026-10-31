import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo } from '../../../repos/agents/AgentSettlementsRepo';
import { AgentCreditLedgerRepo } from '../../../repos/agents/AgentCreditLedgerRepo';
import type { CreditTransactionType } from '../../../repos/agents/AgentCreditLedgerRepo';
import { AgentPlayerCreditsRepo } from '../../../repos/agents/AgentPlayerCreditsRepo';
import { CreditService } from '../services/CreditService';
import { AgentListStatsService } from '../services/AgentListStatsService';
import { HierarchyService } from '../services/HierarchyService';
import { validateAgentUsername } from '../agentUsernameValidation.js';
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo';
import { settlementDateExpr } from '@src/shared/reportingSql.js';

export function buildAgentsQueryResolvers() {
	const agentsRepo = new AgentsRepo();
	const ledgerRepo = new AgentLedgerRepo();
	const settlementsRepo = new AgentSettlementsRepo();
	const creditService = new CreditService(agentsRepo);
	const hierarchyService = new HierarchyService(agentsRepo);

	// An agent may read its own data and that of anything beneath it in the
	// hierarchy. Resolved through agent_hierarchy_closure rather than a
	// parent_agent_id comparison: the closure covers arbitrary depth, so a
	// grandparent can reach a grandchild. A direct-parent check silently denied
	// access at depth >= 2, which real hierarchies reach.
	//
	// This applies to every scheme. COMMISSION agents form hierarchies too —
	// createAgent allows COMMISSION parents and children explicitly.
	async function canAgentAccess(agentId: string, loggedInAgentId: string): Promise<boolean> {
		if (loggedInAgentId === agentId) {
			return true; // own data
		}
		const descendantIds = await agentsRepo.getDescendantIds(loggedInAgentId);
		return descendantIds.includes(agentId);
	}

	// The caller's tenant, director-aware, resolved the way the CR-11 checks in
	// this file resolve it. For an agent it is always the agent's own tenant
	// (buildAuthContext refuses an agent token presented for another tenant).
	async function callerTenantOf(ctx: any): Promise<string> {
		const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
		const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant || ctx?.whitelabel?.id);
		if (typeof tenant !== 'string' || tenant.trim() === '') {
			throw new Error('Tenant ID is required. Please ensure you are authenticated.');
		}
		return tenant.trim();
	}

	// The target agent of a read, looked up in the CALLER's tenant. Several
	// reads below used findById (any tenant) or took the tenant from the target
	// agent itself, so an admin of one whitelabel could read another's agents
	// by id. Throws 'Forbidden' when the agent is not in the caller's tenant.
	async function findAgentInCallerTenant(ctx: any, agentId: string) {
		const agent = await agentsRepo.findByIdScoped(agentId, await callerTenantOf(ctx));
		if (!agent) {
			throw new Error('Forbidden');
		}
		return agent;
	}

	const agentsPageResolver = async (
		parent: any,
		args: { query?: string; schemeType?: string; status?: string; parentAgentId?: string; directOnly?: boolean; offset?: number; limit?: number; includeStats?: boolean } | undefined,
		ctx: any
	) => {
		try {
			const { schemeType, status, parentAgentId, directOnly, offset = 0, limit = 10, includeStats = true } = args || {};
			let query = args?.query;
			
			// Always return a valid result - never null or undefined
			const defaultResult = { items: [], total: 0 };
			
			// CRITICAL: For Director Admin, use effective tenant based on mode
			// For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
			const directorTenant = getEffectiveTenantForDirector(ctx)
			let tenantId = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
			if (typeof tenantId !== 'string' || tenantId.trim() === '') {
				tenantId = 'default'
			} else {
				tenantId = tenantId.trim()
			}
			
			// If agent is logged in, handle authorization
			let agentIdFilter: string | undefined = undefined;
			const loggedInAgentId = ctx?.user?.type === 'agent' ? ctx.user.agentId : undefined;
			
			if (loggedInAgentId) {
				const loggedInAgent = await agentsRepo.findById(loggedInAgentId);
				// Listing the children of some agent: allowed when that agent is the
				// caller or sits beneath the caller. Requiring an exact match with
				// the caller's own id meant a grandparent could not browse past its
				// direct children, even though the hierarchy runs deeper.
				if (parentAgentId) {
					if (!(await canAgentAccess(parentAgentId, loggedInAgentId))) {
						// Querying sub-agents of an agent outside the caller's subtree - deny
						return defaultResult;
					}
					// parentAgentId matches logged-in agent - allow querying sub-agents (SHARING, CREDIT, COMMISSION)
					// Don't set agentIdFilter, allow sub-agents to be returned
				} else {
					// No parentAgentId - agent can only see themselves
					agentIdFilter = loggedInAgentId;
					// If agent provides a query, it must match their own ID
					if (query && query !== agentIdFilter) {
						// Agent trying to query other agents - return empty
						return defaultResult;
					}
					// Force query to agent's own ID
					query = agentIdFilter;
				}
			}
			
			// directOnly: only for admin when no parentAgentId (show root agents only). Ignore for agents.
			const useDirectOnly = !loggedInAgentId && directOnly === true && !parentAgentId;
			const filters = {
				schemeType: schemeType as 'COMMISSION' | 'SHARING' | 'CREDIT' | undefined,
				status,
				query,
				parentAgentId,
				directOnly: useDirectOnly || undefined,
			};
			
			let items: any[] = [];
			let total = 0;
			
			try {
				items = await agentsRepo.list(tenantId, filters, { offset: offset || 0, limit: limit || 10 });
				
				// If agent is logged in and no parentAgentId, filter results to only include their own record
				// If parentAgentId is provided, allow sub-agents (already validated above)
				if (agentIdFilter) {
					items = items.filter((item: any) => item.id === agentIdFilter);
					total = items.length; // Count is already filtered
				} else {
					total = await agentsRepo.count(tenantId, filters);
				}
			} catch (dbError: any) {
				return defaultResult;
			}
			
			// Ensure items is always an array
			if (!Array.isArray(items)) {
				return defaultResult;
			}
			
			// Ensure total is always a number
			if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
				return defaultResult;
			}
			
			// Convert createdAt to ISO string and credit fields to numbers for each item
			const formattedItems = items.map((item: any) => ({
				...item,
				creditLimit: item.creditLimit != null ? Number(item.creditLimit) : null,
				creditUsed: item.creditUsed != null ? Number(item.creditUsed) : null,
				creditAvailable: item.creditAvailable != null ? Number(item.creditAvailable) : null,
				settlementBalance: item.settlementBalance != null ? Number(item.settlementBalance) : null,
				settlementBalanceSports: item.settlementBalanceSports != null ? Number(item.settlementBalanceSports) : null,
				settlementBalanceCasino: item.settlementBalanceCasino != null ? Number(item.settlementBalanceCasino) : null,
				settlementBalanceMatka: item.settlementBalanceMatka != null ? Number(item.settlementBalanceMatka) : null,
				createdAt: item.createdAt instanceof Date 
					? item.createdAt.toISOString() 
					: item.createdAt 
						? (typeof item.createdAt === 'string' 
							? item.createdAt 
							: new Date(item.createdAt).toISOString())
						: null,
			}));
			
		const emptyStats = {
			activePlayers: 0, lastLogin: null, daysSinceLastBet: null,
			totalDeposits: null, totalWithdrawals: null, ggr: null,
			totalExposure: null, profitLoss: null, plTrend: null,
			betCount: null, pendingSettlement: null, totalSettled: null,
			lastSettlementDate: null, turnover: null, commissionEarned: null,
			commissionTrend: null,
		};

		let itemsWithStats: any[] = [];
		if (includeStats) {
			try {
				const statsService = new AgentListStatsService();
				const agentIds = formattedItems.map((item: any) => item.id);
				const statsMap = await statsService.getStatsForAgents(agentIds, tenantId);
				itemsWithStats = formattedItems.map((item: any) => ({
					agent: item,
					stats: statsMap.get(item.id) || emptyStats,
				}));
			} catch (statsError: any) {
				itemsWithStats = formattedItems.map((item: any) => ({ agent: item, stats: emptyStats }));
			}
		}
			
			const result = { 
				items: formattedItems,
				itemsWithStats,
				total 
			};
			
			
			// Final safety check
			if (!result || result.items === undefined || result.total === undefined) {
				return defaultResult;
			}
			
			return result;
		} catch (error: any) {
			// Always return a valid result, never null or undefined
			return { items: [], total: 0 };
		}
	};

	return {
		agentMe: async (_: any, __: any, ctx: any) => {
			// Only agents can query agentMe
			if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
				return null;
			}
			const agentId = ctx.user.agentId;
			return agentsRepo.findById(agentId);
		},
		agentProfile: async (_: any, { id }: { id: string }, ctx: any) => {
			// If agent is logged in, ensure they can only access their own profile or their sub-agents
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(id, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own profile or your sub-agents');
				}
			}
			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(id, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}
			return agent;
		},
		agentTree: async (_: any, { rootId }: { rootId: string }, ctx: any) => {
			// Agent may request children for self or any node in their downline (e.g. sub-agent profile page).
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				const allowedRoots = await hierarchyService.getHierarchyAgentIds(loggedInAgentId);
				if (!allowedRoots.includes(rootId)) {
					throw new Error('Unauthorized: You can only view your own hierarchy');
				}
			}
			// listChildren is unscoped, so an admin could list the sub-agents
			// (with their credit and settlement balances) of any agent in any
			// whitelabel by id. The root must be in the caller's tenant.
			const root = await findAgentInCallerTenant(ctx, rootId);
			const children = await agentsRepo.listChildren(rootId);
			return children.filter((child: any) => child.tenantId === root.tenantId);
		},
		agentDescendantIds: async (_: any, { agentId }: { agentId: string }, ctx: any) => {
			// When agent is logged in, allow only for self or any agent in their hierarchy
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				const allowedIds = await hierarchyService.getHierarchyAgentIds(loggedInAgentId);
				if (!allowedIds.includes(agentId)) {
					throw new Error('Unauthorized: You can only query descendant IDs for yourself or your sub-agents');
				}
			}
			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const target = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!target) {
				throw new Error('Forbidden');
			}
			// Whitelabel / super admin can query any agent's descendants for book roll-up
			return hierarchyService.getHierarchyAgentIds(agentId);
		},
	agentRootIds: async (_: any, __: any, ctx: any) => {
		// Only for whitelabel admin or super admin in whitelabel mode (not for agent login)
		if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
			return [];
		}
		const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
		const directorTenant = getEffectiveTenantForDirector(ctx);
		const tenantId = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
		if (typeof tenantId !== 'string' || tenantId.trim() === '') {
			return [];
		}
		return agentsRepo.listRootAgentIds(tenantId.trim());
	},
	agentRootAgents: async (_: any, __: any, ctx: any) => {
		// Only for whitelabel admin or super admin in whitelabel mode (not for agent login)
		if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
			return [];
		}
		const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
		const directorTenant = getEffectiveTenantForDirector(ctx);
		const tenantId = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
		if (typeof tenantId !== 'string' || tenantId.trim() === '') {
			return [];
		}
		return agentsRepo.listRootAgents(tenantId.trim());
	},
		agentsPage: async (parent: any, args: any, ctx: any) => {
			try {
				if (!agentsPageResolver) {
					return { items: [], total: 0 };
				}
				const result = await agentsPageResolver(parent, args, ctx);
				if (!result || result.items === undefined || result.total === undefined) {
					return { items: [], total: 0 };
				}
				return result;
			} catch (error: any) {
				return { items: [], total: 0 };
			}
		},
		agentLedgers: async (
			_: any,
			{ agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string },
			ctx: any
		) => {
			// If agent is logged in, ensure they can only access their own ledgers or their sub-agents' ledgers
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own ledgers or your sub-agents\' ledgers');
				}
			}
			// CR-11: enforce target agent belongs to caller's tenant
			{
				const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
				const directorTenant = getEffectiveTenantForDirector(ctx);
				const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
				if (!callerTenant) {
					throw new Error('Tenant ID is required. Please ensure you are authenticated.');
				}
				if (!(await agentsRepo.findByIdScoped(agentId, callerTenant))) {
					throw new Error('Forbidden');
				}
			}
			return ledgerRepo.list(agentId, new Date(periodFrom), new Date(periodTo));
		},
		agentSettlements: async (
			_: any,
			{ agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string },
			ctx: any
		) => {
			// If agent is logged in, ensure they can only access their own settlements or their sub-agents' settlements
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own settlements or your sub-agents\' settlements');
				}
			}
			// CR-11: enforce target agent belongs to caller's tenant
			{
				const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
				const directorTenant = getEffectiveTenantForDirector(ctx);
				const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
				if (!callerTenant) {
					throw new Error('Tenant ID is required. Please ensure you are authenticated.');
				}
				if (!(await agentsRepo.findByIdScoped(agentId, callerTenant))) {
					throw new Error('Forbidden');
				}
			}
			const settlements = await settlementsRepo.list(agentId, new Date(periodFrom), new Date(periodTo));
			
			// Get notes from agent_settlement_transactions (match by settlement createdAt window, not period)
			const { AgentSettlementTransactionsRepo: TransactionsRepo } = await import('../../../repos/settlements/AgentSettlementTransactionsRepo');
			const transactionsRepo = new TransactionsRepo();
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
			
			const settlementsWithNotes = await Promise.all(
				settlements.map(async (settlement) => {
					const periodFromDate = settlement.periodFrom instanceof Date ? settlement.periodFrom : new Date(settlement.periodFrom);
					const periodToDate = settlement.periodTo instanceof Date ? settlement.periodTo : new Date(settlement.periodTo);
					const settlementCreatedAt = settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt);
					const transaction = await transactionsRepo.getTransactionForSettlement({
						tenant,
						agentId: settlement.agentId,
						settlementCreatedAt,
						settlementAmount: Number(settlement.totalAmount),
					});
					const totalAmount = Number(settlement.totalAmount);
					return {
						id: settlement.id,
						agentId: settlement.agentId,
						periodFrom: periodFromDate.toISOString(),
						periodTo: periodToDate.toISOString(),
						totalAmount,
						direction: totalAmount >= 0 ? 'TO_AGENT' : 'FROM_AGENT', // Positive = platform pays TO agent, negative = platform collects FROM agent
						currency: settlement.currency,
						status: settlement.status,
						postedAt: settlement.postedAt ? (settlement.postedAt instanceof Date ? settlement.postedAt.toISOString() : settlement.postedAt) : null,
						postedBy: settlement.postedBy || null,
						createdAt: (settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt)).toISOString(),
						notes: transaction?.notes ?? null,
					};
				})
			);
			
			return settlementsWithNotes;
		},
		downlineSettlementHistory: async (
			_: any,
			{ periodFrom, periodTo }: { periodFrom: string; periodTo: string },
			ctx: any
		) => {
			if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
				return [];
			}
			const parentAgentId = ctx.user.agentId;
			const children = await agentsRepo.listChildren(parentAgentId);
			const directChildIds = children.map((c: { id: string }) => c.id);
			if (directChildIds.length === 0) {
				return [];
			}
			const from = new Date(periodFrom);
			const toRaw = new Date(periodTo);
			if (Number.isNaN(from.getTime()) || Number.isNaN(toRaw.getTime())) {
				return [];
			}
			// Use end-of-day for periodTo so settlements created today (any timezone) are included
			const to = new Date(toRaw);
			to.setHours(23, 59, 59, 999);
			const settlements = await settlementsRepo.listWhereSettledByAgent(parentAgentId, {
				from,
				to,
				agentIds: directChildIds,
			});
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
			const { AgentSettlementTransactionsRepo: TransactionsRepo } = await import('../../../repos/settlements/AgentSettlementTransactionsRepo');
			const transactionsRepo = new TransactionsRepo();
			const { db } = await import('@/db/client.js');
			const { inArray } = await import('drizzle-orm');
			const { agentCredentials } = await import('@shared/db/schema/agents.js');
			const agentIds = [...new Set(settlements.map((s) => s.agentId))];
			const credentials = agentIds.length > 0 ? await db.select().from(agentCredentials).where(inArray(agentCredentials.agentId, agentIds)) : [];
			const credentialMap = new Map(credentials.map((c) => [c.agentId, c.username]));
			const agentMap = new Map(children.map((c: any) => [c.id, c]));

			const result = await Promise.all(
				settlements.map(async (settlement) => {
					const periodFromDate = settlement.periodFrom instanceof Date ? settlement.periodFrom : new Date(settlement.periodFrom);
					const periodToDate = settlement.periodTo instanceof Date ? settlement.periodTo : new Date(settlement.periodTo);
					const settlementCreatedAt = settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt);
					const transaction = await transactionsRepo.getTransactionForSettlement({
						tenant,
						agentId: settlement.agentId,
						settlementCreatedAt,
						settlementAmount: Number(settlement.totalAmount),
					});
					const totalAmount = Number(settlement.totalAmount);
					const agent = agentMap.get(settlement.agentId);
					return {
						id: settlement.id,
						agentId: settlement.agentId,
						periodFrom: periodFromDate.toISOString(),
						periodTo: periodToDate.toISOString(),
						totalAmount,
						direction: totalAmount >= 0 ? 'TO_AGENT' : 'FROM_AGENT',
						currency: settlement.currency,
						status: settlement.status,
						postedAt: settlement.postedAt ? (settlement.postedAt instanceof Date ? settlement.postedAt.toISOString() : settlement.postedAt) : null,
						postedBy: settlement.postedBy || null,
						createdAt: (settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt)).toISOString(),
						notes: transaction?.notes ?? null,
						agent: agent
							? { id: agent.id, username: credentialMap.get(agent.id) ?? null, schemeType: agent.schemeType, rate: null }
							: null,
					};
				})
			);
			return result;
		},
		agentKPIs: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
			// If agent is logged in, ensure they can only access their own KPIs or their sub-agents' KPIs
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own KPIs or your sub-agents\' KPIs');
				}
			}
			
			// Use HybridGGRReader for realtime GGR when range includes today (tenant TZ)
			const { HybridGGRReader } = await import('../services/HybridGGRReader');
			const ggrReader = new HybridGGRReader();
			
			const from = new Date(periodFrom);
			const to = new Date(periodTo);
			
			// CR-11: enforce target agent belongs to caller's tenant
			{
				const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
				const directorTenant = getEffectiveTenantForDirector(ctx);
				const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
				if (!callerTenant) {
					throw new Error('Tenant ID is required. Please ensure you are authenticated.');
				}
				if (!(await agentsRepo.findByIdScoped(agentId, callerTenant))) {
					throw new Error('Forbidden');
				}
			}
			const ggrScope = 'downline'; // Include downline GGR for all agent types (hierarchical commission uses downline)
			
			const [sportsResult, casinoResult, matkaResult] = await Promise.all([
				ggrReader.getSportsGGR({ agentId, from, to, scope: ggrScope }),
				ggrReader.getCasinoGGR({ agentId, from, to, scope: ggrScope }),
				ggrReader.getMatkaGGR({ agentId, from, to, scope: ggrScope }),
			]);
			
			const sportsGGR = sportsResult.ggr || 0;
			const casinoGGR = casinoResult.ggr || 0;
			const matkaGGR = matkaResult.ggr || 0;
			const totalGGR = sportsGGR + casinoGGR + matkaGGR;
			
			return { sportsGGR, casinoGGR, matkaGGR, totalGGR };
		},
		creditAllocation: async (_: any, { agentId }: { agentId: string }, ctx: any) => {
			// If agent is logged in, ensure they can only access their own credit or their sub-agents' credit
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own credit allocation or your sub-agents\' credit allocation');
				}
			}
			
			// CR-11: enforce target agent belongs to caller's tenant; validate agent is CREDIT type
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) {
				throw new Error('Forbidden');
			}
			if (agent.schemeType !== 'CREDIT') {
				// Return zeroed allocation for non-CREDIT agents with all required fields
				return {
					agentId,
					creditLimit: 0,
					creditUsed: 0,
					creditAvailable: 0,
					creditAlertThreshold: 0,
					usagePercentage: 0,
					isOverLimit: false,
					isNearThreshold: false
				};
			}
			
			return await creditService.getCreditAllocation(agentId);
		},
		agentActivity: async (_: any, { agentId, limit = 10 }: { agentId: string; limit?: number }, ctx: any) => {
			// If agent is logged in, ensure they can only access their own activity or their sub-agents' activity
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own activity or your sub-agents\' activity');
				}
			}

			// The tenant is the CALLER's, and the agent must be in it. This took the
			// tenant from the target agent's own row, so an admin of one whitelabel
			// read the player activity of another whitelabel's agent by id.
			const agentRecord = await findAgentInCallerTenant(ctx, agentId);
			const tenant = String(agentRecord.tenantId).trim();

			// Get agent's player IDs
			const { PlayerAuthService } = await import('../../players/services/PlayerAuthService');
			const playerAuthService = new PlayerAuthService();
			const playerIds = await playerAuthService.getAgentPlayerIds(agentId, tenant);

			if (playerIds.length === 0) {
				return [];
			}

			// Query audit logs for player-related actions (fetch extra so after filtering by agent's players we have enough)
			const { listAuditDb } = await import('@/repos/audit/auditRepo');
			const auditLogs = await listAuditDb({
				tenant,
				domain: 'players',
				limit: Math.min(500, limit * 15),
			});

			// Filter by agent's players and map to activity events
			const activities = auditLogs.items
				.filter((log: any) => {
					const resourceId = Number(log.resourceId);
					return playerIds.includes(resourceId);
				})
				.slice(0, limit)
				.map((log: any) => {
					const playerId = log.resourceId;
					const action = log.action;
					const after = log.after || {};
					
					// Map audit actions to activity types
					let type = 'STATUS_CHANGED';
					if (action === 'create_player' || action === 'register' || action === 'create_player_via_referral') {
						type = 'PLAYER_REGISTERED';
					} else if (action.includes('deposit')) {
						type = 'DEPOSIT_MADE';
					} else if (action.includes('withdrawal') || action.includes('withdraw')) {
						type = 'WITHDRAWAL_REQUESTED';
					} else if (action.includes('bet') && (after.stake || after.amount) > 1000) {
						type = 'LARGE_BET';
					} else if (action.includes('limit')) {
						type = 'LIMIT_ADJUSTED';
					}

					return {
						id: log.id,
						type,
						timestamp: log.timestamp,
						playerName: after.username || after.name || `Player ${playerId}`,
						playerId: String(playerId),
						amount: after.amount || after.stake || after.balance || undefined,
						currency: after.currency || 'INR',
						domain: after.domain || after.product || undefined,
						details: `${action}: ${JSON.stringify(after)}`,
					};
				});

			return activities;
		},
		agentSecurityAudit: async (_: any, { agentId, limit = 50 }: { agentId: string; limit?: number }, ctx: any) => {
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own activity or your sub-agents\' activity');
				}
			}
			if (agentId == null || agentId === '') {
				throw new Error('agentId is required');
			}
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const tenant = (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default') || 'default';
			const limitNum = Math.min(500, Math.max(1, limit || 50));
			const FAILURE_ACTIONS = new Set(['login_failed']);
			const { listAuditDb } = await import('@/repos/audit/auditRepo');
			const auditResult = await listAuditDb({
				tenant,
				actorId: String(agentId),
				domain: 'agents',
				limit: limitNum,
			});
			return auditResult.items.map((e: any) => {
				const success = !FAILURE_ACTIONS.has(e.action);
				const ipAddress = e.after?.ipAddress ?? e.before?.ipAddress ?? null;
				const userAgent = e.after?.userAgent ?? e.before?.userAgent ?? null;
				const displayType = e.action === 'login_failed' ? 'login' : e.action;
				let metadata: string | null = null;
				if (e.after != null) {
					try {
						metadata = typeof e.after === 'string' ? e.after : JSON.stringify(e.after);
					} catch {
						metadata = null;
					}
				}
				return {
					id: e.id,
					type: displayType,
					description: `${e.domain}:${e.action}`,
					timestamp: e.timestamp,
					ipAddress,
					userAgent,
					success,
					metadata,
				};
			});
		},
		agentDashboardStats: async (_: any, { agentId, dateFrom: rawDateFrom, dateTo: rawDateTo }: { agentId: string; dateFrom?: string; dateTo?: string }, ctx: any) => {
			// If agent is logged in, ensure they can only access their own stats or their sub-agents' stats
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own dashboard stats or your sub-agents\' stats');
				}
			}

			// The viewed agent must be in the CALLER's tenant (director-aware). This
			// used the viewed agent's own tenantId, so the target chose the tenant
			// and an admin of one whitelabel read another whitelabel's agent stats.
			const viewedAgent = await findAgentInCallerTenant(ctx, agentId);
			const tenant = String(viewedAgent.tenantId).trim();

			// Parse optional date range using tenant timezone
			const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
			const { parseDateFrom, parseDateTo } = await import('@src/shared/dateUtils.js');
			const tz = await getWhitelabelTimezone(tenant);
			const rangeFrom: Date | null = rawDateFrom ? parseDateFrom(rawDateFrom, tz) : null;
			const rangeTo: Date | null = rawDateTo ? parseDateTo(rawDateTo, tz) : null;

			const { PlayerAuthService } = await import('../../players/services/PlayerAuthService');
			const playerAuthService = new PlayerAuthService();
			const playerIds = await playerAuthService.getAgentPlayerIds(agentId, tenant);

			// For non-commission agents, exclude COMMISSION_AGENT_PLAYER from GGR/P&L.
			// For commission agents, their downline ARE COMMISSION_AGENT_PLAYER — include them.
			let playerIdsForGgr = playerIds;
			const isCommissionScheme = viewedAgent?.schemeType === 'COMMISSION';
			if (!isCommissionScheme && playerIds.length > 0) {
				const { users } = await import('@shared/db/schema');
				const { and, eq, inArray } = await import('drizzle-orm');
				const { db } = await import('@/db/client');
				const rows = await db
					.select({ id: users.id, playerType: users.playerType })
					.from(users)
					.where(and(eq(users.tenant, tenant), inArray(users.id, playerIds)));
				playerIdsForGgr = rows
					.filter((r) => r.playerType !== 'COMMISSION_AGENT_PLAYER')
					.map((r) => r.id)
					.filter((id): id is number => typeof id === 'number');
			}

			// Get total players count
			const totalPlayers = playerIds.length;

			// Get active players (last 24h) - players who have placed bets in last 24h
			const { db } = await import('@/db/client');
			const { reportingDailySnapshots } = await import('@shared/db/schema');
			const { gte, lte, and, eq, inArray, sql } = await import('drizzle-orm');
			const yesterday = new Date();
			yesterday.setDate(yesterday.getDate() - 1);

			const activePlayersResult = playerIds.length > 0 ? await db
				.select({
					activeCount: sql<number>`COUNT(DISTINCT ${reportingDailySnapshots.playerId})::int`,
				})
				.from(reportingDailySnapshots)
				.where(
					and(
						eq(reportingDailySnapshots.tenant, tenant),
						inArray(reportingDailySnapshots.playerId, playerIds),
						gte(reportingDailySnapshots.snapshotDate, yesterday)
					)
				) : [{ activeCount: 0 }];

			const activePlayers24h = Number(activePlayersResult[0]?.activeCount || 0);

			// Get new players today (timezone-aware)
			const { getStartOfDay } = await import('@src/shared/dateUtils.js');
			const todayStart = getStartOfDay(tz);
			const { users } = await import('@shared/db/schema');
			const newPlayersResult = playerIds.length > 0 ? await db
				.select({
					newCount: sql<number>`COUNT(*)::int`,
				})
				.from(users)
				.where(
					and(
						eq(users.tenant, tenant),
						inArray(users.id, playerIds),
						gte(users.createdAt, todayStart)
					)
				) : [{ newCount: 0 }];

			const newPlayersToday = Number(newPlayersResult[0]?.newCount || 0);

			// Get pending deposits and withdrawals
			const { depositRequests, withdrawalRequests } = await import('@shared/db/schema');
			const [pendingDepositsResult] = playerIds.length > 0 ? await db
				.select({
					count: sql<number>`COUNT(*)::int`,
					total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
				})
				.from(depositRequests)
				.where(
					and(
						eq(depositRequests.tenant, tenant),
						inArray(depositRequests.userId, playerIds),
						eq(depositRequests.status, 'PENDING' as any)
					)
				) : [{ count: 0, total: 0 }];

			const [pendingWithdrawalsResult] = playerIds.length > 0 ? await db
				.select({
					count: sql<number>`COUNT(*)::int`,
					total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
				})
				.from(withdrawalRequests)
				.where(
					and(
						eq(withdrawalRequests.tenant, tenant),
						inArray(withdrawalRequests.userId, playerIds),
						eq(withdrawalRequests.status, 'PENDING' as any)
					)
				) : [{ count: 0, total: 0 }];

			// Build date conditions for financial queries.
			// Deposits/withdrawals are bucketed by the date money actually moved (approval),
			// not the request date, so an approval on a later day counts on that later day.
			const depositSettledAt = settlementDateExpr(depositRequests.reviewedAt, depositRequests.createdAt);
			const withdrawalSettledAt = settlementDateExpr(withdrawalRequests.reviewedAt, withdrawalRequests.createdAt);
			const depositDateConds: any[] = [];
			if (rangeFrom) depositDateConds.push(gte(depositSettledAt, rangeFrom));
			if (rangeTo) depositDateConds.push(lte(depositSettledAt, rangeTo));
			const withdrawalDateConds: any[] = [];
			if (rangeFrom) withdrawalDateConds.push(gte(withdrawalSettledAt, rangeFrom));
			if (rangeTo) withdrawalDateConds.push(lte(withdrawalSettledAt, rangeTo));

			const [totalDepositsResult] = playerIds.length > 0 ? await db
				.select({
					total: sql<number>`COALESCE(SUM(${depositRequests.amount}::numeric), 0)`,
				})
				.from(depositRequests)
				.where(
					and(
						eq(depositRequests.tenant, tenant),
						inArray(depositRequests.userId, playerIds),
						eq(depositRequests.status, 'APPROVED' as any),
						...depositDateConds
					)
				) : [{ total: 0 }];

			const [totalWithdrawalsResult] = playerIds.length > 0 ? await db
				.select({
					total: sql<number>`COALESCE(SUM(${withdrawalRequests.amount}::numeric), 0)`,
				})
				.from(withdrawalRequests)
				.where(
					and(
						eq(withdrawalRequests.tenant, tenant),
						inArray(withdrawalRequests.userId, playerIds),
						eq(withdrawalRequests.status, 'COMPLETED' as any),
						...withdrawalDateConds
					)
				) : [{ total: 0 }];

			const directDeposits = Number(totalDepositsResult?.total || 0);
			const directWithdrawals = Number(totalWithdrawalsResult?.total || 0);

			// Manual deposits/withdrawals from ledger_entries (admin adjustments)
			let manualDepositVolume = 0;
			let manualWithdrawalVolume = 0;

			if (playerIds.length > 0) {
				const { wallets, ledgerEntries } = await import('@shared/db/schema');
				const walletRows = await db
					.select({ walletId: wallets.id })
					.from(wallets)
					.where(
						and(
							eq(wallets.tenant, tenant),
							inArray(wallets.userId, playerIds)
						)
					);
				const walletIds = walletRows.map((r) => r.walletId);

				if (walletIds.length > 0) {
					const ledgerFromCond = rangeFrom ? [gte(ledgerEntries.createdAt, rangeFrom)] : [];
					const ledgerToCond = rangeTo ? [lte(ledgerEntries.createdAt, rangeTo)] : [];

					const [manualDepositResult] = await db
						.select({
							volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
						})
						.from(ledgerEntries)
						.where(
							and(
								eq(ledgerEntries.tenant, tenant),
								inArray(ledgerEntries.walletId, walletIds),
								eq(ledgerEntries.type, 'credit'),
								sql`${ledgerEntries.meta} IS NOT NULL`,
								sql`(${ledgerEntries.meta}->>'type' IN ('deposit', 'admin_adjustment'))`,
								sql`(${ledgerEntries.meta}->>'depositRequestId' IS NULL OR ${ledgerEntries.meta}->>'depositRequestId' = '')`,
								...ledgerFromCond,
								...ledgerToCond
							)
						);

					const [manualWithdrawalResult] = await db
						.select({
							volume: sql<number>`COALESCE(SUM(ABS(NULLIF(${ledgerEntries.meta}->>'originalAmount', '')::numeric)), 0)`,
						})
						.from(ledgerEntries)
						.where(
							and(
								eq(ledgerEntries.tenant, tenant),
								inArray(ledgerEntries.walletId, walletIds),
								eq(ledgerEntries.type, 'debit'),
								sql`${ledgerEntries.meta} IS NOT NULL`,
								sql`(${ledgerEntries.meta}->>'type' IN ('withdrawal', 'admin_adjustment'))`,
								...ledgerFromCond,
								...ledgerToCond
							)
						);

					manualDepositVolume = Number(manualDepositResult?.volume || 0);
					manualWithdrawalVolume = Number(manualWithdrawalResult?.volume || 0);
				}
			}

			// GGR and P&L by wallet type and domain for all agent's players (date-filtered)
			let ggr = 0;
			let profitLoss = 0;
			const ggrByWalletType = { cash: 0, bonus: 0, referralBonus: 0 };
			const plByWalletType = { cash: 0, bonus: 0, referralBonus: 0 };
			let sportsGgr = 0, sportsPl = 0, casinoGgr = 0, casinoPl = 0, matkaGgr = 0, matkaPl = 0;
			if (playerIdsForGgr.length > 0) {
				const hasDateFilter = !!(rangeFrom || rangeTo);
				if (!hasDateFilter) {
					// All-time: use existing aggregate functions (no date filter)
					const { getAggregatedGGRPlForUserIds: getSportsAgg } = await import('@/repos/sports/sportsBetsRepo.js');
					const { getAggregatedGGRPlByWalletTypeForUserIds: getCasinoAgg } = await import('@/repos/casino/casinoBetsRepo.js');
					const { getAggregatedGGRPlForUserIds: getMatkaAgg } = await import('@/repos/matka/matkaBetsRepo.js');
					const [sports, casino, matka] = await Promise.all([
						getSportsAgg(tenant, playerIdsForGgr),
						getCasinoAgg(tenant, playerIdsForGgr),
						getMatkaAgg(tenant, playerIdsForGgr),
					]);
					sportsGgr = sports.ggr; sportsPl = sports.pl;
					casinoGgr = casino.cash.ggr + casino.bonus.ggr + casino.referralBonus.ggr;
					casinoPl = casino.cash.pl + casino.bonus.pl + casino.referralBonus.pl;
					matkaGgr = matka.ggr; matkaPl = matka.pl;
					ggrByWalletType.cash += sports.ggr + matka.ggr + casino.cash.ggr;
					plByWalletType.cash += sports.pl + matka.pl + casino.cash.pl;
					ggrByWalletType.bonus += casino.bonus.ggr;
					plByWalletType.bonus += casino.bonus.pl;
					ggrByWalletType.referralBonus += casino.referralBonus.ggr;
					plByWalletType.referralBonus += casino.referralBonus.pl;
				} else {
					// Date-filtered: inline queries with date conditions
					const { sportsBets } = await import('@shared/db/schema');
					const { casinoBets } = await import('@shared/db/schema');
					const { matkaBets } = await import('@shared/db/schema');

					const sportsDateConds: any[] = [];
					if (rangeFrom) sportsDateConds.push(gte(sportsBets.createdAt, rangeFrom));
					if (rangeTo) sportsDateConds.push(lte(sportsBets.createdAt, rangeTo));
					const [sportsRow] = await db
						.select({
							ggr: sql<number>`COALESCE(SUM(CASE WHEN ${sportsBets.pl} IS NOT NULL THEN -${sportsBets.pl}::numeric ELSE 0 END), 0)`,
							pl: sql<number>`COALESCE(SUM(${sportsBets.pl}::numeric), 0)`,
						})
						.from(sportsBets)
						.where(and(eq(sportsBets.tenant, tenant), inArray(sportsBets.userId, playerIdsForGgr), inArray(sportsBets.status, ['won', 'lost', 'settled']), sql`${sportsBets.pl} IS NOT NULL`, ...sportsDateConds));
					sportsGgr = Number(sportsRow?.ggr ?? 0);
					sportsPl = Number(sportsRow?.pl ?? 0);

					const casinoDateConds: any[] = [];
					if (rangeFrom) casinoDateConds.push(gte(casinoBets.createdAt, rangeFrom));
					if (rangeTo) casinoDateConds.push(lte(casinoBets.createdAt, rangeTo));
					const casinoRows = await db
						.select({
							walletType: casinoBets.walletType,
							ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
							pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
						})
						.from(casinoBets)
						.where(and(eq(casinoBets.tenant, tenant), inArray(casinoBets.userId, playerIdsForGgr), inArray(casinoBets.status, ['won', 'lost']), ...casinoDateConds))
						.groupBy(casinoBets.walletType);
					const casinoAgg = { cash: { ggr: 0, pl: 0 }, bonus: { ggr: 0, pl: 0 }, referralBonus: { ggr: 0, pl: 0 } };
					for (const row of casinoRows) {
						const wt = String(row.walletType || 'cash').toLowerCase().replace(/_/g, '');
						const key = wt === 'referralbonus' ? 'referralBonus' : wt === 'bonus' ? 'bonus' : 'cash';
						casinoAgg[key].ggr += Number(row.ggr ?? 0);
						casinoAgg[key].pl += Number(row.pl ?? 0);
					}
					casinoGgr = casinoAgg.cash.ggr + casinoAgg.bonus.ggr + casinoAgg.referralBonus.ggr;
					casinoPl = casinoAgg.cash.pl + casinoAgg.bonus.pl + casinoAgg.referralBonus.pl;

					const matkaDateConds: any[] = [];
					if (rangeFrom) matkaDateConds.push(gte(matkaBets.createdAt, rangeFrom));
					if (rangeTo) matkaDateConds.push(lte(matkaBets.createdAt, rangeTo));
					const [matkaRow] = await db
						.select({
							ggr: sql<number>`COALESCE(SUM(${matkaBets.betAmount}::numeric - COALESCE(${matkaBets.actualWin}::numeric, 0)), 0)`,
							pl: sql<number>`COALESCE(SUM(COALESCE(${matkaBets.actualWin}::numeric, 0) - ${matkaBets.betAmount}::numeric), 0)`,
						})
						.from(matkaBets)
						.where(and(eq(matkaBets.tenant, tenant), inArray(matkaBets.userId, playerIdsForGgr), inArray(matkaBets.status, ['won', 'lost']), ...matkaDateConds));
					matkaGgr = Number(matkaRow?.ggr ?? 0);
					matkaPl = Number(matkaRow?.pl ?? 0);

					ggrByWalletType.cash += sportsGgr + matkaGgr + casinoAgg.cash.ggr;
					plByWalletType.cash += sportsPl + matkaPl + casinoAgg.cash.pl;
					ggrByWalletType.bonus += casinoAgg.bonus.ggr;
					plByWalletType.bonus += casinoAgg.bonus.pl;
					ggrByWalletType.referralBonus += casinoAgg.referralBonus.ggr;
					plByWalletType.referralBonus += casinoAgg.referralBonus.pl;
				}
				ggr = ggrByWalletType.cash + ggrByWalletType.bonus + ggrByWalletType.referralBonus;
				profitLoss = plByWalletType.cash + plByWalletType.bonus + plByWalletType.referralBonus;
			}

			// Downline breakdown: direct players, sub-agent players, sub-agent count, total balance/exposure
			let directPlayerCount = 0;
			let subAgentPlayerCount = 0;
			let totalSubAgents = 0;
			let totalDownlineBalance = 0;
			let totalDownlineExposure = 0;

			try {
				// Direct player IDs (users.agentId = this agent)
				const directRows = await db
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.agentId, agentId), eq(users.tenant, tenant)));
				directPlayerCount = directRows.length;
				subAgentPlayerCount = totalPlayers - directPlayerCount;

				// Sub-agent count
				const subAgentCountResult = await agentsRepo.listChildren(agentId);
				totalSubAgents = subAgentCountResult.length;

				// Total balance and exposure for all downline players
				if (playerIds.length > 0) {
					const { wallets } = await import('@shared/db/schema');
					const [balanceResult] = await db
						.select({
							totalBalance: sql<number>`COALESCE(SUM(${wallets.cash}::numeric), 0)`,
							totalExposure: sql<number>`COALESCE(SUM(${wallets.exposure}::numeric), 0)`,
						})
						.from(wallets)
						.where(
							and(
								eq(wallets.tenant, tenant),
								inArray(wallets.userId, playerIds)
							)
						);
					totalDownlineBalance = Number(balanceResult?.totalBalance || 0);
					totalDownlineExposure = Number(balanceResult?.totalExposure || 0);
				}
			} catch (err) {
				// Non-critical; defaults are 0
			}

			const safeNum = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : Number(n) || 0);
			return {
				totalPlayers,
				activePlayers24h,
				newPlayersToday,
				pendingDeposits: Number(pendingDepositsResult?.count || 0),
				pendingDepositsAmount: Number(pendingDepositsResult?.total || 0),
				pendingWithdrawals: Number(pendingWithdrawalsResult?.count || 0),
				pendingWithdrawalsAmount: Number(pendingWithdrawalsResult?.total || 0),
				totalDeposits: directDeposits + manualDepositVolume,
				totalWithdrawals: directWithdrawals + manualWithdrawalVolume,
				directDeposits,
				directWithdrawals,
				manualDeposits: manualDepositVolume,
				manualWithdrawals: manualWithdrawalVolume,
				ggr: safeNum(ggr),
				profitLoss: safeNum(profitLoss),
				ggrByWalletType: {
					cash: safeNum(ggrByWalletType.cash),
					bonus: safeNum(ggrByWalletType.bonus),
					referralBonus: safeNum(ggrByWalletType.referralBonus),
				},
				plByWalletType: {
					cash: safeNum(plByWalletType.cash),
					bonus: safeNum(plByWalletType.bonus),
					referralBonus: safeNum(plByWalletType.referralBonus),
				},
				directPlayerCount,
				subAgentPlayerCount,
				totalSubAgents,
				totalDownlineBalance: safeNum(totalDownlineBalance),
				totalDownlineExposure: safeNum(totalDownlineExposure),
				sportsGgr: safeNum(sportsGgr),
				sportsPl: safeNum(sportsPl),
				casinoGgr: safeNum(casinoGgr),
				casinoPl: safeNum(casinoPl),
				matkaGgr: safeNum(matkaGgr),
				matkaPl: safeNum(matkaPl),
			};
		},
		commissionSummary: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
			// Validate input
			if (!agentId) {
				throw new Error('Agent ID is required');
			}
			if (!periodFrom || !periodTo) {
				throw new Error('Period from and to dates are required');
			}

			const { parseCycleDateIST } = await import('../services/CommissionCycleUtils.js');
			const fromDate = parseCycleDateIST(periodFrom);
			const toDate = parseCycleDateIST(periodTo);
			if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
				throw new Error('Invalid date format');
			}
			if (fromDate > toDate) {
				throw new Error('Period from date must be before period to date');
			}

			// A logged-in agent may read its own commission summary or any sub-agent's.
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				const loggedInAgent = await agentsRepo.findById(loggedInAgentId);
				
				// One rule for every scheme: own data, or anything below in the
				// hierarchy. The COMMISSION branch used to be stricter than this
				// (direct children only), so a commission agent two levels up was
				// denied a summary it is entitled to.
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own commission summary or that of a sub-agent');
				}
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) throw new Error('Forbidden');
			const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
			const currency = await getWhitelabelCurrency(agent.tenantId);
			const { CommissionCalculationService } = await import('../services/CommissionCalculationService');
			const { AgentConfigsRepo } = await import('../../../repos/agents/AgentConfigsRepo');
			const { HybridGGRReader } = await import('../services/HybridGGRReader');
			const configsRepo = new AgentConfigsRepo();
			const ggrReader = new HybridGGRReader();
			const payoutsRepo = new CommissionPayoutsRepo();
			const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReader, payoutsRepo);
			const isAgentCaller = ctx?.user?.type === 'agent' && ctx?.user?.agentId;
			const commissionMode: 'net' | 'gross' = isAgentCaller ? 'net' : 'gross';
			const summary = await commissionService.calculateCommissionSummary(agentId, fromDate, toDate, currency, commissionMode);
			const unified = await commissionService.getUnifiedCommission(agentId, currency, agent.tenantId ?? 'default', {
				periodFrom: fromDate,
				periodTo: toDate,
				preCalculatedSummary: summary,
			});

			let netSportsCommission: number | null = null;
			let netCasinoCommission: number | null = null;
			let netMatkaCommission: number | null = null;
			let netSummary: Awaited<ReturnType<typeof commissionService.calculateCommissionSummary>> | null = null;
			if (commissionMode === 'gross') {
				netSummary = await commissionService.calculateCommissionSummary(agentId, fromDate, toDate, currency, 'net');
				netSportsCommission = netSummary.sportsCommission;
				netCasinoCommission = netSummary.casinoCommission;
				netMatkaCommission = netSummary.matkaCommission;
			}
			// W10: the gross (Receivable: what the agent's payer owes it, cycle by
			// cycle) and net-effective (My Share) figures, whatever the caller's mode.
			const { commissionSummaryGrossNetFields, commissionSummaryCarryFields } = await import('./summaryFieldRules.js');
			const grossNetFields = commissionSummaryGrossNetFields(summary, commissionMode, netSummary);
			// Loss carry-forward (one week, spec §3): the agent's own carry, whatever the caller's mode.
			const carryFields = commissionSummaryCarryFields(summary);

			return {
				...grossNetFields,
				...carryFields,
				totalEarned: unified.earnedPosted,
				calculatedTotal: unified.calculatedTotal,
				pending: unified.pending,
				paid: unified.paid,
				sportsCommission: summary.sportsCommission,
				casinoCommission: summary.casinoCommission,
				matkaCommission: summary.matkaCommission,
				currency: summary.currency,
				sportsGGR: summary.sportsGGR,
				casinoGGR: summary.casinoGGR,
				matkaGGR: summary.matkaGGR,
				directSportsGGR: summary.directSportsGGR ?? null,
				directCasinoGGR: summary.directCasinoGGR ?? null,
				directMatkaGGR: summary.directMatkaGGR ?? null,
				sportsCommissionRate: summary.sportsCommissionRate,
				casinoCommissionRate: summary.casinoCommissionRate,
				matkaCommissionRate: summary.matkaCommissionRate,
				netSportsCommission,
				netCasinoCommission,
				netMatkaCommission,
				effectiveCalculatedTotal: summary.effectiveCalculatedTotal,
				effectiveSportsCommission: summary.effectiveSportsCommission,
				effectiveCasinoCommission: summary.effectiveCasinoCommission,
				effectiveMatkaCommission: summary.effectiveMatkaCommission,
				tallyApplied: {
					enabled: agent.tallyEnabled ?? false,
					domains: (agent.tallyDomains ?? []) as ('sports' | 'casino' | 'matka')[],
				},
			};
		},
		commissionHistory: async (_: any, { agentId, periodFrom, periodTo, currency, domain, playerId, limit, offset }: { agentId: string; periodFrom: string; periodTo: string; currency?: string; domain?: string; playerId?: string; limit?: number; offset?: number }, ctx: any) => {
			// Validate input
			if (!agentId) {
				throw new Error('Agent ID is required');
			}
			if (!periodFrom || !periodTo) {
				throw new Error('Period from and to dates are required');
			}

			const { parseCycleDateIST } = await import('../services/CommissionCycleUtils.js');
			const fromDate = parseCycleDateIST(periodFrom);
			const toDate = parseCycleDateIST(periodTo);
			if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
				throw new Error('Invalid date format');
			}
			if (fromDate > toDate) {
				throw new Error('Period from date must be before period to date');
			}

			// Validate pagination limits
			const validatedLimit = Math.min(Math.max(limit || 50, 1), 1000); // Between 1 and 1000
			const validatedOffset = Math.max(offset || 0, 0); // Non-negative

			// If agent is logged in: allow own history or the history of any sub-agent
			// in its subtree (for parent commission agents). This was direct children
			// only, so "View Bets" on a sub-agent two or more levels down was refused
			// although commissionSummary for the same agent was allowed.
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (agentId !== loggedInAgentId) {
					const parentAgent = await agentsRepo.findById(loggedInAgentId);
					if (parentAgent?.schemeType !== 'COMMISSION') {
						throw new Error('Unauthorized: Only commission agents can access commission history');
					}
					if (!(await canAgentAccess(agentId, loggedInAgentId))) {
						throw new Error('Unauthorized: Commission agents can only access their own or a sub-agent\'s commission history');
					}
				} else {
					const agent = await agentsRepo.findById(loggedInAgentId);
					if (agent?.schemeType !== 'COMMISSION') {
						throw new Error('Unauthorized: Only commission agents can access commission history');
					}
				}
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) throw new Error('Forbidden');
			const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
			const effectiveCurrency = currency ?? await getWhitelabelCurrency(agent.tenantId);
			const { CommissionCalculationService } = await import('../services/CommissionCalculationService');
			const { AgentConfigsRepo } = await import('../../../repos/agents/AgentConfigsRepo');
			const { AgentLedgerRepo } = await import('../../../repos/agents/AgentLedgerRepo');
			const { HybridGGRReader } = await import('../services/HybridGGRReader');
			const configsRepo = new AgentConfigsRepo();
			const ledgerRepo = new AgentLedgerRepo();
			const ggrReader = new HybridGGRReader();
			const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReader);

			// An agent's own history is net; anyone else's (a parent viewing a child
			// from the Pay dialog, an admin) is the GROSS that is paid to it, so the
			// bet count and amounts match the payable (W10).
			const { commissionHistoryMode } = await import('./summaryFieldRules.js');
			const historyMode = commissionHistoryMode(ctx?.user, agentId);
			const result = await commissionService.getCommissionHistory(
				agentId,
				fromDate,
				toDate,
				effectiveCurrency,
				{
					domain: domain ? (domain.toLowerCase() as 'sports' | 'casino' | 'matka') : undefined,
					playerId,
					limit: validatedLimit,
					offset: validatedOffset,
					mode: historyMode,
				}
			);

			return {
				entries: result.entries.map(entry => ({
					id: entry.id,
					date: entry.date.toISOString(),
					playerId: entry.playerId,
					playerName: entry.playerName,
					domain: entry.domain as 'sports' | 'casino' | 'matka',
					betAmount: entry.betAmount,
					ggr: entry.ggr,
					commissionRate: entry.commissionRate,
					commissionEarned: entry.commissionEarned,
					currency: entry.currency,
					status: entry.status ?? null,
					eventName: entry.eventName ?? null,
					marketName: entry.marketName ?? null,
					selectionName: entry.selectionName ?? null,
					side: entry.side ?? null,
					odds: entry.odds ?? null,
					liability: entry.liability ?? null,
					gameName: entry.gameName ?? null,
					vendorName: entry.vendorName ?? null,
					payout: entry.payout ?? null,
					winAmount: entry.winAmount ?? null,
					matkaType: entry.matkaType ?? null,
					bidType: entry.bidType ?? null,
					betNumbers: entry.betNumbers ?? null,
					payoutMultiplier: entry.payoutMultiplier ?? null,
					potentialWin: entry.potentialWin ?? null,
					actualWin: entry.actualWin ?? null,
					marketSession: entry.marketSession ?? null,
				})),
				total: result.total,
			};
		},
		directPlayerCommissionSummaries: async (_: any, { agentId: argAgentId, periodFrom, periodTo }: { agentId?: string; periodFrom: string; periodTo: string }, ctx: any) => {
			let agentId: string;
			if (argAgentId && ctx?.user?.type !== 'agent') {
				agentId = argAgentId;
			} else if (ctx?.user?.agentId && ctx?.user?.type === 'agent') {
				agentId = ctx.user.agentId;
			} else {
				throw new Error('Unauthorized: Agent login or agentId required');
			}
			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent || agent.schemeType !== 'COMMISSION') {
				throw new Error('Unauthorized: Only commission agents can access player commission summaries');
			}
			const { parseCycleDateIST } = await import('../services/CommissionCycleUtils.js');
			const fromDate = parseCycleDateIST(periodFrom);
			const toDate = parseCycleDateIST(periodTo);
			if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
				throw new Error('Invalid date format');
			}
			const { CommissionCalculationService } = await import('../services/CommissionCalculationService');
			const { AgentConfigsRepo } = await import('../../../repos/agents/AgentConfigsRepo');
			const { AgentLedgerRepo } = await import('../../../repos/agents/AgentLedgerRepo');
			const { HybridGGRReader } = await import('../services/HybridGGRReader');
			const configsRepo = new AgentConfigsRepo();
			const ledgerRepo = new AgentLedgerRepo();
			const ggrReader = new HybridGGRReader();
			const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReader);

			const [sportsConfig, casinoConfig, matkaConfig] = await Promise.all([
				configsRepo.getCommissionConfig(agentId, 'sports', fromDate),
				configsRepo.getCommissionConfig(agentId, 'casino', fromDate),
				configsRepo.getCommissionConfig(agentId, 'matka', fromDate),
			]);
			const commissionRates = {
				sports: sportsConfig ? Number(sportsConfig.commissionRate) : 0,
				casino: casinoConfig ? Number(casinoConfig.commissionRate) : 0,
				matka: matkaConfig ? Number(matkaConfig.commissionRate) : 0,
			};

			return commissionService.getDirectPlayerSummaries(agentId, fromDate, toDate, commissionRates);
		},
		commissionReport: async (_: any, { agentId, periodFrom, periodTo, currency, domain, limit, offset }: { agentId: string; periodFrom: string; periodTo: string; currency?: string; domain?: string; limit?: number; offset?: number }, ctx: any) => {
			// Validate input
			if (!agentId) {
				throw new Error('Agent ID is required');
			}
			if (!periodFrom || !periodTo) {
				throw new Error('Period from and to dates are required');
			}

			const { parseCycleDateIST } = await import('../services/CommissionCycleUtils.js');
			const fromDate = parseCycleDateIST(periodFrom);
			const toDate = parseCycleDateIST(periodTo);
			if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
				throw new Error('Invalid date format');
			}
			if (fromDate > toDate) {
				throw new Error('Period from date must be before period to date');
			}

			// Validate pagination limits
			const validatedLimit = Math.min(Math.max(limit || 50, 1), 1000); // Between 1 and 1000
			const validatedOffset = Math.max(offset || 0, 0); // Non-negative

			// A logged-in agent may read its own commission report and that of any
			// agent beneath it. COMMISSION agents do form hierarchies (createAgent
			// permits COMMISSION parents and children), so restricting this to the
			// caller's own id denied parents the reports of their own sub-agents.
			// canAgentAccess resolves the subtree through agent_hierarchy_closure.
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: you can only access your own commission report or that of a sub-agent');
				}

				// Commission reports only exist for the COMMISSION scheme.
				const agent = await agentsRepo.findById(loggedInAgentId);
				if (agent?.schemeType !== 'COMMISSION') {
					throw new Error('Unauthorized: Only commission agents can access commission report');
				}
			}

			// CR-11: enforce target agent belongs to caller's tenant
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const callerTenant = directorTenant ?? (ctx?.tenant || ctx?.whitelabel?.id);
			if (!callerTenant) {
				throw new Error('Tenant ID is required. Please ensure you are authenticated.');
			}
			const agent = await agentsRepo.findByIdScoped(agentId, callerTenant);
			if (!agent) throw new Error('Forbidden');
			const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
			const effectiveCurrency = currency ?? await getWhitelabelCurrency(agent.tenantId);
			const { CommissionCalculationService } = await import('../services/CommissionCalculationService');
			const { AgentConfigsRepo } = await import('../../../repos/agents/AgentConfigsRepo');
			const { AgentLedgerRepo } = await import('../../../repos/agents/AgentLedgerRepo');
			const { HybridGGRReader } = await import('../services/HybridGGRReader');
			const configsRepo = new AgentConfigsRepo();
			const ledgerRepo = new AgentLedgerRepo();
			const ggrReader = new HybridGGRReader();
			const payoutsRepo = new CommissionPayoutsRepo();
			const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReader, payoutsRepo);

			const unified = await commissionService.getUnifiedCommission(agentId, effectiveCurrency, agent.tenantId, {
				periodFrom: fromDate,
				periodTo: toDate,
			});

			// Get history
			const historyResult = await commissionService.getCommissionHistory(
				agentId,
				fromDate,
				toDate,
				effectiveCurrency,
				{
					domain: domain ? (domain.toLowerCase() as 'sports' | 'casino' | 'matka') : undefined,
					limit: validatedLimit,
					offset: validatedOffset,
				}
			);

			const summary = await commissionService.calculateCommissionSummary(agentId, fromDate, toDate, effectiveCurrency);
			return {
				summary: {
					totalEarned: unified.earnedPosted,
					calculatedTotal: unified.calculatedTotal,
					pending: unified.pending,
					paid: unified.paid,
					sportsCommission: summary.sportsCommission,
					casinoCommission: summary.casinoCommission,
					matkaCommission: summary.matkaCommission,
					currency: summary.currency,
					effectiveCalculatedTotal: summary.effectiveCalculatedTotal,
					effectiveSportsCommission: summary.effectiveSportsCommission,
					effectiveCasinoCommission: summary.effectiveCasinoCommission,
					effectiveMatkaCommission: summary.effectiveMatkaCommission,
					tallyApplied: {
						enabled: agent.tallyEnabled ?? false,
						domains: (agent.tallyDomains ?? []) as ('sports' | 'casino' | 'matka')[],
					},
				},
				history: {
					entries: historyResult.entries.map(entry => ({
						id: entry.id,
						date: entry.date.toISOString(),
						playerId: entry.playerId,
						playerName: entry.playerName,
						domain: entry.domain.toLowerCase() as 'sports' | 'casino' | 'matka',
						betAmount: entry.betAmount,
						ggr: entry.ggr,
						commissionRate: entry.commissionRate,
						commissionEarned: entry.commissionEarned,
						currency: entry.currency,
					})),
					total: historyResult.total,
				},
			};
		},
		settlementSummary: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
			// Block commission agents from accessing settlement summary
			// Commission agents use commission payouts, not settlements
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				const loggedInAgent = await agentsRepo.findById(loggedInAgentId);
				
				if (loggedInAgent?.schemeType === 'COMMISSION') {
					throw new Error('Commission agents cannot access settlement summary. Use commission payouts instead.');
				}
				
				// For sharing/credit agents, check access
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only access your own settlement summary or your sub-agents\' settlement summary');
				}
			}

			// Looked up in the caller's tenant: an admin of one whitelabel could read
			// another whitelabel's agent settlement summary (with per-player P&L) by id.
			const agent = await findAgentInCallerTenant(ctx, agentId);
			const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
			const currency = await getWhitelabelCurrency(agent.tenantId);
			const { SettlementCalculationService } = await import('../services/SettlementCalculationService');
			const { AgentConfigsRepo } = await import('../../../repos/agents/AgentConfigsRepo');
			const configsRepo = new AgentConfigsRepo();
			const settlementService = new SettlementCalculationService(agentsRepo, configsRepo, ledgerRepo, settlementsRepo);
			const summary = await settlementService.calculateSettlementSummaryWithContributions(
				agentId,
				new Date(periodFrom),
				new Date(periodTo),
				currency
			);

			// Get last settlement from settlements repo
			const allSettlements = await settlementsRepo.list(agentId, new Date(0), new Date());
			const lastSettlement = allSettlements.length > 0 ? allSettlements[0] : null;

			// Map top players and sub-agents to GraphQL types
			const topPlayers = (summary.topPlayers || []).map(p => ({
				playerId: String(p.playerId),
				playerName: p.playerName,
				playerUsername: p.playerUsername,
				pl: p.pl,
				share: p.share,
				domainBreakdown: [
					{
						domain: 'sports' as const,
						pl: p.domainBreakdown.sports.pl,
						share: p.domainBreakdown.sports.share,
						cutAmount: p.domainBreakdown.sports.cutAmount,
					},
					{
						domain: 'casino' as const,
						pl: p.domainBreakdown.casino.pl,
						share: p.domainBreakdown.casino.share,
						cutAmount: p.domainBreakdown.casino.cutAmount,
					},
					{
						domain: 'matka' as const,
						pl: p.domainBreakdown.matka.pl,
						share: p.domainBreakdown.matka.share,
						cutAmount: p.domainBreakdown.matka.cutAmount,
					},
				],
				contributionPercentage: p.contributionPercentage,
				isDirectPlayer: p.isDirectPlayer,
				subAgentId: p.subAgentId,
				subAgentName: p.subAgentName,
			}));

			const subAgents = (summary.subAgents || []).map(s => ({
				subAgentId: s.subAgentId,
				subAgentName: s.subAgentName,
				subAgentUsername: s.subAgentUsername,
				totalPL: s.totalPL,
				totalShare: s.totalShare,
				playerCount: s.playerCount,
				domainBreakdown: [
					{
						domain: 'sports' as const,
						pl: s.domainBreakdown.sports.pl,
						share: s.domainBreakdown.sports.share,
						cutAmount: s.domainBreakdown.sports.cutAmount,
					},
					{
						domain: 'casino' as const,
						pl: s.domainBreakdown.casino.pl,
						share: s.domainBreakdown.casino.share,
						cutAmount: s.domainBreakdown.casino.cutAmount,
					},
					{
						domain: 'matka' as const,
						pl: s.domainBreakdown.matka.pl,
						share: s.domainBreakdown.matka.share,
						cutAmount: s.domainBreakdown.matka.cutAmount,
					},
				],
				contributionPercentage: s.contributionPercentage,
				players: s.players.map(p => ({
					playerId: String(p.playerId),
					playerName: p.playerName,
					playerUsername: p.playerUsername,
					pl: p.pl,
					share: p.share,
					domainBreakdown: [
						{
							domain: 'sports' as const,
							pl: p.domainBreakdown.sports.pl,
							share: p.domainBreakdown.sports.share,
							cutAmount: p.domainBreakdown.sports.cutAmount,
						},
						{
							domain: 'casino' as const,
							pl: p.domainBreakdown.casino.pl,
							share: p.domainBreakdown.casino.share,
							cutAmount: p.domainBreakdown.casino.cutAmount,
						},
						{
							domain: 'matka' as const,
							pl: p.domainBreakdown.matka.pl,
							share: p.domainBreakdown.matka.share,
							cutAmount: p.domainBreakdown.matka.cutAmount,
						},
					],
					contributionPercentage: p.contributionPercentage,
					isDirectPlayer: p.isDirectPlayer,
					subAgentId: p.subAgentId,
					subAgentName: p.subAgentName,
				})),
			}));

			// Build domain breakdown array
			// Get share rates from configs for accurate calculation
			const sportsConfig = await configsRepo.getSharingConfig(agentId, 'sports', new Date(periodFrom));
			const casinoConfig = await configsRepo.getSharingConfig(agentId, 'casino', new Date(periodFrom));
			const matkaConfig = await configsRepo.getSharingConfig(agentId, 'matka', new Date(periodFrom));
			const sportsShareRate = sportsConfig ? Number(sportsConfig.shareRate) * 100 : 0;
			const casinoShareRate = casinoConfig ? Number(casinoConfig.shareRate) * 100 : 0;
			const matkaShareRate = matkaConfig ? Number(matkaConfig.shareRate) * 100 : 0;
			
			const totalPL = Math.abs(summary.sportsPL) + Math.abs(summary.casinoPL) + Math.abs(summary.matkaPL);
			// amount = players' P/L, agentShare positive = the agent earns, cutAmount =
			// |GGR| − |share| — the meanings of the settlement engine's breakdown. The
			// cut was P/L x (1 − rate), signed like the P/L, so it read negative when
			// players lost (W10).
			const { settlementBreakdownItem, settlementSummaryDirection } = await import('./summaryFieldRules.js');
			const settlementBreakdownByDomain = [
				settlementBreakdownItem('sports', { pl: summary.sportsPL, share: summary.sportsShare, sharePct: sportsShareRate, totalAbsPl: totalPL }),
				settlementBreakdownItem('casino', { pl: summary.casinoPL, share: summary.casinoShare, sharePct: casinoShareRate, totalAbsPl: totalPL }),
				settlementBreakdownItem('matka', { pl: summary.matkaPL, share: summary.matkaShare, sharePct: matkaShareRate, totalAbsPl: totalPL }),
			].filter(d => d.amount !== 0);

			return {
				netPL: summary.netPL,
				sharePercentage: summary.sharePercentage,
				settlementDue: summary.settlementDue,
				// W10: who pays settlementDue (positive = TO_AGENT, as the settlement engine).
				settlementDirection: settlementSummaryDirection(summary),
				lastSettlementDate: lastSettlement?.periodTo ? (lastSettlement.periodTo instanceof Date ? lastSettlement.periodTo.toISOString() : lastSettlement.periodTo) : null,
				lastSettlementAmount: lastSettlement ? Number(lastSettlement.totalAmount) : null,
				currency: summary.currency,
				// Domain-wise breakdown
				sportsPL: summary.sportsPL,
				casinoPL: summary.casinoPL,
				matkaPL: summary.matkaPL,
				sportsShare: summary.sportsShare,
				casinoShare: summary.casinoShare,
				matkaShare: summary.matkaShare,
				// Domain breakdown array (for frontend)
				settlementBreakdownByDomain,
				// Contribution breakdown
				directPlayersContribution: summary.directPlayersContribution || 0,
				subAgentsContribution: summary.subAgentsContribution || 0,
				directPlayersCount: summary.directPlayersCount || 0,
				subAgentsCount: summary.subAgentsCount || 0,
				topPlayers,
				subAgents,
			};
		},

		creditTransactionHistory: async (
			_: any,
			{
				entityType,
				entityId,
				transactionTypes,
				from,
				to,
				limit,
			}: {
				entityType: string;
				entityId: string;
				transactionTypes?: string[];
				from?: string;
				to?: string;
				limit?: number;
			},
			ctx: any
		) => {
			// Validate and normalize entityType (case-insensitive)
			if (!entityType || typeof entityType !== 'string' || entityType.trim() === '') {
				throw new Error('entityType is required and cannot be empty');
			}
			
			const normalizedEntityType = entityType.toLowerCase().trim();
			const validEntityTypes = ['agent', 'player', 'whitelabel'];
			if (!validEntityTypes.includes(normalizedEntityType)) {
				throw new Error(`Invalid entityType: ${entityType}. Must be one of: ${validEntityTypes.join(', ')}`);
			}
			
			// Validate entityId
			if (!entityId || typeof entityId !== 'string' || entityId.trim() === '') {
				throw new Error('entityId is required and cannot be empty');
			}
			
			// Use normalized entityType for all subsequent checks
			const validEntityType = normalizedEntityType as 'agent' | 'player' | 'whitelabel';
			
			// Check authorization - agents can only see their own transactions or their sub-agents' transactions
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				
				if (validEntityType === 'agent') {
					// For agent entities, use canAgentAccess to allow own or sub-agent access
					if (!(await canAgentAccess(entityId.trim(), loggedInAgentId))) {
						throw new Error('Unauthorized: You can only view your own credit transactions or your sub-agents\' credit transactions');
					}
				} else if (validEntityType === 'player') {
					// For player entities, check if agent can access the player
					const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js');
					const playerAuthService = new PlayerAuthService();
					const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';
					const playerId = Number(entityId.trim());
					if (!Number.isFinite(playerId)) {
						throw new Error('Invalid player ID');
					}
					const canAccess = await playerAuthService.canAgentAccessPlayer(loggedInAgentId, playerId, tenant);
					if (!canAccess) {
						throw new Error('Unauthorized: You can only view credit transactions for your own players');
					}
				} else if (validEntityType === 'whitelabel') {
					// Agents cannot query whitelabel credit transactions directly
					throw new Error('Unauthorized: Agents cannot view whitelabel credit transactions');
				}
			}

			// Validate transactionTypes if provided
			const validTransactionTypes = [
				'ALLOCATION',
				'DEPOSIT',
				'WITHDRAWAL',
				'TRANSFER',
				'USAGE',
				'RELEASE',
				'ADJUSTMENT',
				'CREDIT_LIMIT_ADJUSTMENT',
				'CREDIT_USED_INCREASE',
				'CREDIT_USED_DECREASE',
			];
			let validatedTransactionTypes: string[] | undefined = undefined;
			if (transactionTypes && Array.isArray(transactionTypes) && transactionTypes.length > 0) {
				validatedTransactionTypes = transactionTypes.filter((type) => {
					if (typeof type !== 'string') return false;
					return validTransactionTypes.includes(type.toUpperCase());
				}).map((type) => type.toUpperCase());
				
				if (validatedTransactionTypes.length === 0) {
					throw new Error(`Invalid transactionTypes. Must be one or more of: ${validTransactionTypes.join(', ')}`);
				}
			}

			// Validate and parse date strings
			let fromDate: Date | undefined = undefined;
			let toDate: Date | undefined = undefined;
			
			if (from) {
				fromDate = new Date(from);
				if (isNaN(fromDate.getTime())) {
					throw new Error(`Invalid 'from' date: ${from}`);
				}
			}
			
			if (to) {
				toDate = new Date(to);
				if (isNaN(toDate.getTime())) {
					throw new Error(`Invalid 'to' date: ${to}`);
				}
			}
			
			// Validate date range
			if (fromDate && toDate && fromDate > toDate) {
				throw new Error('Invalid date range: "from" date must be before or equal to "to" date');
			}

			// Validate and normalize limit
			let validatedLimit: number | undefined = undefined;
			if (limit !== undefined && limit !== null) {
				const limitNum = Number(limit);
				if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
					throw new Error('limit must be a positive integer');
				}
				// Clamp to maximum limit to prevent excessive queries (consistent with other queries)
				validatedLimit = Math.min(Math.max(limitNum, 1), 1000); // Between 1 and 1000
			}

			// Get tenant for data isolation
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const tenant = directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';

			const creditLedgerRepo = new AgentCreditLedgerRepo();
			const transactions = await creditLedgerRepo.getTransactionHistory({
				entityType: validEntityType,
				entityId: entityId.trim(),
				transactionTypes: validatedTransactionTypes as CreditTransactionType[] | undefined,
				from: fromDate,
				to: toDate,
				limit: validatedLimit,
				tenantId: tenant,
			});

			return transactions.map((t) => ({
				id: t.id,
				fromEntityType: t.fromEntityType,
				fromEntityId: t.fromEntityId,
				toEntityType: t.toEntityType,
				toEntityId: t.toEntityId,
				transactionType: t.transactionType,
				amount: Number(t.amount),
				currency: t.currency,
				balanceBefore: Number(t.balanceBefore),
				balanceAfter: Number(t.balanceAfter),
				reason: t.reason,
				createdBy: t.createdBy,
				betId: t.betId,
				settlementId: t.settlementId,
				cashoutId: t.cashoutId,
				createdByType: t.createdByType,
				metadata: t.metadata ? (typeof t.metadata === 'string' ? t.metadata : JSON.stringify(t.metadata)) : null,
				createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.createdAt.toISOString(),
			}));
		},

    agentCreditTransactionsCount: async (_: any, { agentId }: { agentId: string }, ctx: any) => {
      if (!ctx?.user) throw new Error('Unauthorized: authentication required')
      if (!agentId?.trim()) throw new Error('agentId is required')
      if (ctx.user.type === 'agent' && ctx.user.agentId && !(await canAgentAccess(agentId.trim(), ctx.user.agentId))) throw new Error('Unauthorized')
      const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
      const tenant = getEffectiveTenantForDirector(ctx) ?? ctx.tenant ?? ctx.whitelabel?.id ?? 'default'
      const { AgentCreditLedgerRepo } = await import('@src/repos/agents/AgentCreditLedgerRepo.js')
      return new AgentCreditLedgerRepo().countTransactionsByEntity({ entityType: 'agent', entityId: agentId.trim(), tenantId: tenant })
    },
    agentCreditTransactions: async (_: any, args: any, ctx: any) => {
			const { agentId, limit = 50, offset = 0 } = args;
			
			// Validate agentId
			if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
				throw new Error('agentId is required and cannot be empty');
			}
			
			// Validate and normalize pagination parameters
			let validatedLimit: number = 50; // Default limit
			let validatedOffset: number = 0; // Default offset
			
			if (limit !== undefined && limit !== null) {
				const limitNum = Number(limit);
				if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
					throw new Error('limit must be a positive integer');
				}
				// Clamp to maximum limit to prevent excessive queries (consistent with other queries)
				validatedLimit = Math.min(Math.max(limitNum, 1), 1000); // Between 1 and 1000
			}
			
			if (offset !== undefined && offset !== null) {
				const offsetNum = Number(offset);
				if (!Number.isFinite(offsetNum) || !Number.isInteger(offsetNum) || offsetNum < 0) {
					throw new Error('offset must be a non-negative integer');
				}
				validatedOffset = offsetNum;
			}
			
			// Authorization: If agent is logged in, ensure they can only access their own credit transactions or their sub-agents' transactions
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId.trim(), loggedInAgentId))) {
					throw new Error('Unauthorized: You can only view your own credit transactions or your sub-agents\' credit transactions');
				}
			}
			
			// Get tenant for data isolation
			const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
			const directorTenant = getEffectiveTenantForDirector(ctx);
			const tenant = directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default';

			const { AgentCreditLedgerRepo } = await import('@src/repos/agents/AgentCreditLedgerRepo.js');
			const ledgerRepo = new AgentCreditLedgerRepo();
			
			const transactions = await ledgerRepo.getTransactionsByEntity({
				entityType: 'agent',
				entityId: agentId.trim(),
				limit: validatedLimit,
				offset: validatedOffset,
				tenantId: tenant,
			});
			
			// Resolve createdBy IDs to usernames
			const createdByIds = transactions
				.map(t => t.createdBy)
				.filter((id): id is string => id !== null && id !== undefined);
			
			// Also extract UUIDs from reason fields for resolution
			const reasonUuids: string[] = [];
			transactions.forEach(t => {
				if (t.reason) {
					const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
					const matches = t.reason.match(uuidRegex);
					if (matches) {
						reasonUuids.push(...matches);
					}
				}
			});
			
			// Combine all IDs that need resolution
			const allIdsToResolve = [...new Set([...createdByIds, ...reasonUuids])];
			const usernameMap = new Map<string, string>();
			
			if (allIdsToResolve.length > 0) {
				// Try to resolve as agents first (username is in agentCredentials table)
				try {
					const { inArray, eq } = await import('drizzle-orm');
					const { agents, agentCredentials } = await import('@shared/db/schema.js');
					const { db } = await import('@/db/client.js');
					
					const agentData = await db
						.select({
							id: agents.id,
							username: agentCredentials.username,
						})
						.from(agents)
						.leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
						.where(inArray(agents.id, allIdsToResolve));
					
					agentData.forEach(agent => {
						if (agent.username) {
							usernameMap.set(agent.id, agent.username);
						}
					});
				} catch (err) {
				}
				
				// Try to resolve remaining IDs as users
				const unresolvedIds = allIdsToResolve.filter(id => !usernameMap.has(id));
				if (unresolvedIds.length > 0) {
					try {
						const { users } = await import('@shared/db/schema.js');
						const { db } = await import('@/db/client.js');
						const { inArray, eq, and } = await import('drizzle-orm');
						
						const userData = await db
							.select({
								id: users.id,
								username: users.username,
							})
							.from(users)
							.where(
								and(
									eq(users.tenant, tenant),
									inArray(users.id, unresolvedIds.map((id: string | number) => {
										const numId = Number(id);
										return Number.isFinite(numId) ? numId : Number(id);
									}).filter((id): id is number => typeof id === 'number' && Number.isFinite(id)))
								)
							);
						
						userData.forEach(user => {
							const userId = String(user.id);
							if (user.username) {
								usernameMap.set(userId, user.username);
							}
						});
					} catch (err) {
					}
				}
			}
			
			// Get current logged-in user's username for "You" replacement
			let currentUserUsername: string | null = null;
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				try {
					const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
					const agentsRepo = new AgentsRepo();
					const currentAgent = await agentsRepo.findById(ctx.user.agentId);
					if (currentAgent?.username) {
						currentUserUsername = currentAgent.username;
					}
				} catch (err) {
				}
			} else if (ctx?.user?.id) {
				// For admin users, try to get username from users table
				try {
					const { users } = await import('@shared/db/schema.js');
					const { db } = await import('@/db/client.js');
					const { eq, and } = await import('drizzle-orm');
					
					const [userData] = await db
						.select({
							username: users.username,
						})
						.from(users)
						.where(
							and(
								eq(users.tenant, tenant),
								eq(users.id, Number(ctx.user.id) || ctx.user.id)
							)
						)
						.limit(1);
					
					if (userData?.username) {
						currentUserUsername = userData.username;
					}
				} catch (err) {
				}
			}
			
			return transactions.map(t => {
				// Resolve createdBy to username
				let createdByDisplay = t.createdBy || 'System';
				if (t.createdBy && usernameMap.has(t.createdBy)) {
					createdByDisplay = usernameMap.get(t.createdBy)!;
					// Replace with "You" if it's the current user's own action
					if (currentUserUsername && createdByDisplay === currentUserUsername) {
						createdByDisplay = 'You';
					}
				}
				
				// Clean up reason field - replace agent IDs with usernames (already resolved above)
				let reasonDisplay = t.reason || null;
				if (reasonDisplay) {
					// Replace UUIDs in reason with usernames
					const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
					reasonDisplay = reasonDisplay.replace(uuidRegex, (match) => {
						return usernameMap.get(match) || match;
					});
				}
				
				return {
					id: t.id,
					fromEntityType: t.fromEntityType,
					fromEntityId: t.fromEntityId,
					toEntityType: t.toEntityType,
					toEntityId: t.toEntityId,
					transactionType: t.transactionType,
					amount: Number(t.amount),
					currency: t.currency,
					balanceBefore: Number(t.balanceBefore),
					balanceAfter: Number(t.balanceAfter),
					reason: reasonDisplay,
					createdBy: createdByDisplay,
					betId: t.betId,
					settlementId: t.settlementId,
					cashoutId: t.cashoutId,
					createdByType: t.createdByType,
					metadata: t.metadata ? (typeof t.metadata === 'string' ? t.metadata : JSON.stringify(t.metadata)) : null,
					createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.createdAt.toISOString()
				};
			});
		},

		agentPlayerCredits: async (_: any, { agentId }: { agentId: string }, ctx: any) => {
			// Check authorization - agents can view their own player credits or their sub-agents' player credits
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only view your own player credits or your sub-agents\' player credits');
				}
			}

			// Validate agent is CREDIT type, and in the caller's tenant (an admin
			// could read another whitelabel's players' credit by agent id).
			const agent = await findAgentInCallerTenant(ctx, agentId);
			if (agent.schemeType !== 'CREDIT') {
				return []; // Only CREDIT agents have player credits
			}

			const playerCreditsRepo = new AgentPlayerCreditsRepo();
			const playerCredits = await playerCreditsRepo.listAgentPlayers(agentId);

			return playerCredits.map((pc) => ({
				playerId: pc.playerId.toString(),
				playerName: pc.playerName,
				creditLimit: pc.creditLimit,
				currentBalance: pc.currentBalance,
				openExposure: pc.openExposure,
				creditUsed: pc.creditUsed,
				creditAvailable: pc.creditAvailable,
			}));
		},
		previewCreditReconciliation: async (_: any, { agentId }: any, ctx: any) => {
			// Check authorization - agents can preview reconciliation for their own account or their sub-agents
			if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
				const loggedInAgentId = ctx.user.agentId;
				if (!(await canAgentAccess(agentId, loggedInAgentId))) {
					throw new Error('Unauthorized: You can only preview credit reconciliation for your own account or your sub-agents');
				}
			}
			
			// Validate agent is CREDIT type, in the caller's tenant.
			const agent = await findAgentInCallerTenant(ctx, agentId);
			if (agent.schemeType !== 'CREDIT') {
				throw new Error('Credit reconciliation is only available for CREDIT scheme agents');
			}

			const { CreditCalculationRepo } = await import('../../../repos/agents/CreditCalculationRepo');
			const tenant = String(agent.tenantId).trim();
			const calcRepo = new CreditCalculationRepo(agentsRepo);
			const result = await calcRepo.recalculateCreditUsedForAgent(agentId, tenant);
			return {
				agentId: result.agentId,
				currentUsed: result.currentUsed,
				calculatedUsed: result.calculatedUsed,
				delta: result.delta,
				affectedPlayers: result.affectedPlayers.map((p) => ({
					playerId: p.playerId.toString(),
					currentUsed: p.currentUsed,
					calculatedUsed: p.calculatedUsed,
					delta: p.delta,
					currentBalance: p.currentBalance,
					openExposure: p.openExposure,
				})),
				subAgentAllocations: result.subAgentAllocations,
			};
		},
		agentCreditAlerts: async (_: any, { agentId, isActive }: any, ctx: any) => {
			// This had no check at all: any caller read any agent's credit alerts.
			// An agent reads its own or its subtree's; everyone reads only agents
			// in their own tenant.
			if (ctx?.user?.type === 'agent') {
				if (!ctx?.user?.agentId || !(await canAgentAccess(agentId, ctx.user.agentId))) {
					throw new Error('Unauthorized: You can only view credit alerts for your own account or your sub-agents');
				}
			}
			await findAgentInCallerTenant(ctx, agentId);
			const { AgentCreditAlertsRepo } = await import('../../../repos/agents/AgentCreditAlertsRepo');
			const alertsRepo = new AgentCreditAlertsRepo();
			const alerts = isActive === true
				? await alertsRepo.getActiveAlerts(agentId)
				: await alertsRepo.getAllAlerts(agentId);
			return alerts.map((a) => ({
				id: a.id,
				agentId: a.agentId,
				alertType: a.alertType,
				threshold: a.threshold,
				currentValue: a.currentValue,
				isActive: a.isActive,
				notifiedAt: a.notifiedAt?.toISOString() || null,
				createdAt: a.createdAt.toISOString(),
			}));
		},

		whitelabelCreditPlayers: async (_: any, __: any, ctx: any) => {
			// Admin only. WHITELABEL_CREDIT players belong to the whitelabel, not to
			// any agent, and this returns their name, email and phone; it had no
			// check, so every agent could read them.
			if (ctx?.user?.type === 'agent') {
				throw new Error('Forbidden: whitelabel credit players are visible to admins only');
			}
			const tenant = await callerTenantOf(ctx);
			const creditService = new CreditService(new AgentsRepo());
			const players = await creditService.listWhitelabelCreditPlayers(tenant);
			return players.map((p) => ({
				id: p.id.toString(),
				name: p.name,
				email: p.email,
				phone: p.phone,
				creditLimit: p.creditLimit,
				creditUsed: p.creditUsed,
				creditAvailable: p.creditAvailable,
			}));
		},
		checkAgentUsernameAvailable: async (_: any, args: any, ctx: any) => {
			const formatValidation = validateAgentUsername(args.username ?? '');
			if (!formatValidation.valid) {
				return {
					available: false,
					message: formatValidation.message ?? 'Invalid username',
				};
			}
			const normalizedUsername = formatValidation.normalized!;

			try {
				const excludeAgentId = args.excludeAgentId || undefined
				// Task 24: usernames are unique per tenant, so scope the availability check by the
				// caller's tenant. A username taken in another tenant must still read as available here.
				const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js')
				const directorTenant = getEffectiveTenantForDirector(ctx)
				const tenantId = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
				const isAvailable = await agentsRepo.checkUsernameAvailable(normalizedUsername, excludeAgentId, undefined, tenantId)
				
				return {
					available: isAvailable,
					message: isAvailable 
						? null 
						: "This username is already taken"
				}
			} catch (error: any) {
				return {
					available: false,
					message: 'Unable to verify username availability. Please try again.'
				}
			}
		},
	};
}
