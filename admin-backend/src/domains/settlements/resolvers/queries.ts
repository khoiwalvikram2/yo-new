import { AgentSettlementTransactionsRepo } from '../../../repos/settlements/AgentSettlementTransactionsRepo';
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo';
import { AgentListStatsService } from '../../agents/services/AgentListStatsService';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentConfigsRepo } from '../../../repos/agents/AgentConfigsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { CommissionCalculationService } from '../../agents/services/CommissionCalculationService';
import { HybridGGRReader } from '../../agents/services/HybridGGRReader';
import { deriveSinceLastPeriod, getWhitelabelTimezone } from '../../agents/services/SettlementPeriodUtils.js';
import { db } from '@/db/client';
import { agents, agentSettlementTransactions, commissionPayouts } from '@shared/db/schema.js';
import { eq, and, inArray, gte, lte, lt, desc } from 'drizzle-orm';
import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@src/domains/common/directorModeUtils.js';
import { hasPermission } from '@src/domains/common/auth.js';
import { createCommissionReportCalculator } from '../services/commissionReportCalculator.js';
import { settlementActivityRange, readSettlementDashboardActivity } from '../services/settlementDashboardActivity.js';
import { pendingLastSettlementDates } from '../services/pendingSettlementReads.js';

/**
 * Read gate for the settlement-centre queries (pending lists, settlement
 * details, contributions, history).
 *
 * Several of them checked nothing at all: with only an X-Whitelabel-ID header
 * and no session, enhancedPendingSettlements returned every top-level agent's
 * pending amount with per-player P&L, and settlementDetails / allSettlementHistory
 * returned the tenant's settlement records.
 *
 * Two principals reach these legitimately:
 *  - an admin, who needs `settlements.center:view` — the permission
 *    settlementDashboard on the same page already demands;
 *  - an agent, whose derived permissions carry no finance grant. It passes on
 *    `agents.list:view` (its `agents:view`), and each resolver's existing agent
 *    branch then limits it to itself / its own downline as before.
 */
export function requireSettlementRead(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
  const perms = ctx?.permissions ?? [];
  if (ctx.user.type === 'agent') {
    if (!ctx.user.agentId || !hasPermission(perms, 'agents.list', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view settlements');
    }
    return;
  }
  if (!hasPermission(perms, 'settlements.center', 'view')) {
    throw new Error('Forbidden: insufficient permissions to view settlements (settlements.center:view)');
  }
}

/** Read gate for commission data an admin reaches from finance or from an agent's profile. */
function requireCommissionReadForAdmin(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
  const perms = ctx?.permissions ?? [];
  if (!hasPermission(perms, 'settlements.commission', 'view') && !hasPermission(perms, 'agents.commission', 'view')) {
    throw new Error('Forbidden: insufficient permissions to view commission (settlements.commission:view or agents.commission:view)');
  }
}

/**
 * Read gate for one commission agent's cycles and cycle readiness (commissionCyclesForAgent,
 * commissionCycleReadiness). An admin needed only a session: one holding nothing but jackpots:read
 * read any commission agent's paid, payable and calculated commission, week by week (SCO-09).
 *
 * An admin now needs the commission read its siblings ask (requireCommissionReadForAdmin), or
 * settlements.center:view: the settlement centre is gated on it, and its Pending > Commission list
 * (whitelabelCommissionSummaries, the same figures per agent) opens the Pay dialog that calls both.
 * Measured on the live roles before gating: grandwinn-com/Finance Manager opens that screen holding
 * settlements.center:view and no commission read, so the sibling gate alone would have taken the
 * dialog's reads from it. An agent keeps its own branch (its subtree / its direct children) below.
 */
function requireCommissionCycleRead(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
  if (ctx.user.type === 'agent') {
    if (!ctx.user.agentId) throw new Error('Forbidden: insufficient permissions to view commission cycles');
    return;
  }
  if (hasPermission(ctx?.permissions ?? [], 'settlements.center', 'view')) return;
  requireCommissionReadForAdmin(ctx);
}

/**
 * Refuses a caller with no session. For the settlement reads that had no check at
 * all: an X-Whitelabel-ID header alone was enough to read them. Authentication
 * only; commissionPayouts, its one caller now, checks its permission itself
 * (transactions and the commission cycles have their own gates above).
 */
function requireAuthenticated(ctx: any): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required');
}

/** The caller's tenant, director-aware, the way the CR-11 checks resolve it. */
function callerTenantOf(ctx: any): string | null {
  const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant || ctx?.whitelabel?.id);
  return typeof tenant === 'string' && tenant.trim() !== '' ? tenant.trim() : null;
}

export const settlementsQueryResolvers = {
  agentSettlementTransactionsPage: async (_: any, args: any, ctx: any): Promise<any> => {
    const items = await settlementsQueryResolvers.agentSettlementTransactions(_, { ...args, limit: Math.min(500, Math.max(1, args.limit ?? 50)), offset: Math.max(0, args.offset ?? 0) }, ctx);
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentId = ctx?.user?.type === 'agent' ? (args.agentId || ctx.user.agentId) : args.agentId;
    const summary = await new AgentSettlementTransactionsRepo().summary({ tenant, agentId, fromDate: args.fromDate ? new Date(args.fromDate) : undefined, toDate: args.toDate ? new Date(args.toDate) : undefined });
    return { items, ...summary };
  },
  commissionPayoutsPage: async (_: any, args: any, ctx: any): Promise<any> => {
    const items = await settlementsQueryResolvers.commissionPayouts(_, { ...args, limit: Math.min(500, Math.max(1, args.limit ?? 50)), offset: Math.max(0, args.offset ?? 0) }, ctx);
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentId = ctx?.user?.type === 'agent' ? (args.agentId || ctx.user.agentId) : args.agentId;
    const total = await new CommissionPayoutsRepo().count({ tenant, agentId, fromDate: args.fromDate ? new Date(args.fromDate) : undefined, toDate: args.toDate ? new Date(args.toDate) : undefined });
    return { items, total };
  },
  settlementDashboard: async (_: any, args: { fromDate?: string; toDate?: string }, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'settlements.center', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view settlement dashboard')
    }
    // CRITICAL: For Director Admin, use effective tenant based on mode
    // For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    const timeZone = await (await import('@src/shared/whitelabelConfig.js')).getWhitelabelTimezone(tenant);
    const activityRange = settlementActivityRange(args, timeZone);

    // Get all agents for this tenant
    const agentsRepo = new AgentsRepo();
    let allAgents = await agentsRepo.list(tenant);
    const tenantAgentsForSharing = allAgents;

    // If agent is logged in, filter to only their own data
    let loggedInAgentId: string | undefined = undefined;
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
      if (loggedInAgent && loggedInAgent.tenantId === tenant) {
        allAgents = [loggedInAgent];
        loggedInAgentId = loggedInAgent.id;
      } else {
        allAgents = [];
      }
    }

    let pendingSharingSettlements = 0;
    let pendingCommissionPayouts = 0;

    // SHARING: what the caller still has to settle, from the settlement engine (the
    // same window and maths the settle mutation posts). Only the agents the caller
    // settles count — the ROOT SHARING agents for an admin, the direct children for
    // an agent — not every leaf: each parent settles its own children, and a
    // child's share is part of its parent's. Pay (TO_AGENT) and collect
    // (FROM_AGENT) are netted, and also reported separately.
    const { createSharingSettlementEngine } = await import('../../agents/services/sharingSettlementWiring.js');
    const { summarizeSharingPending } = await import('../../agents/services/SharingSettlementEngine.js');
    const sharingEngineDashboard = createSharingSettlementEngine();
    const sharingTargetsDashboard = tenantAgentsForSharing.filter((a) =>
      a.schemeType === 'SHARING' &&
      (loggedInAgentId ? a.parentAgentId === loggedInAgentId : a.parentAgentId == null)
    );
    const sharingPendingRowsDashboard: Array<{ agentId: string; parentAgentId: string | null; remaining: number }> = [];
    for (const agent of sharingTargetsDashboard) {
      try {
        const state = await sharingEngineDashboard.pending(agent as any);
        sharingPendingRowsDashboard.push({ agentId: agent.id, parentAgentId: agent.parentAgentId ?? null, remaining: state.remaining });
      } catch (err) {
        console.error('[settlementDashboard] SHARING pending failed for agent', agent.id, err instanceof Error ? err.message : err);
      }
    }
    const sharingSummaryDashboard = summarizeSharingPending(sharingPendingRowsDashboard, { settlerAgentId: loggedInAgentId ?? null });
    // Net, positive = you pay agents overall (see pendingSharingToAgents / pendingSharingFromAgents).
    pendingSharingSettlements = sharingSummaryDashboard.net;
    // Reuse grouped bets, rate rows and the hierarchy inside this request. The monetary
    // rules remain in CommissionCalculationService; a failed calculation is not replaced
    // with an unrelated ledger estimate.
    const payoutsRepo = new CommissionPayoutsRepo();
    const now = new Date();
    const commissionTargets = allAgents.filter(a => a.schemeType === 'COMMISSION' && (loggedInAgentId || a.parentAgentId == null));
    if (commissionTargets.length) {
      const currency = await (await import('@src/shared/whitelabelConfig.js')).getWhitelabelCurrency(tenant);
      const calculator = await createCommissionReportCalculator(tenant, tenantAgentsForSharing, payoutsRepo);
      const pending = await Promise.all(commissionTargets.map(async agent =>
        (await calculator.getUnifiedCommission(agent.id, currency, tenant,
          { periodFrom: new Date(0), periodTo: now, mode: 'gross' })).pending));
      pendingCommissionPayouts = pending.reduce((sum, amount) => sum + (Number.isFinite(amount) && amount > 0.01 ? amount : 0), 0);
    }

    const activity = await readSettlementDashboardActivity(tenant, loggedInAgentId, activityRange);

    // CREDIT has left the settlement centre (spec §6, 2026-11-02): its chips move
    // by Deposit / Withdraw, and what an account owes or is owed is its Ref P/L on
    // the Chips pages. The dashboard's CREDIT fields (pending credit settlements,
    // direct credit adjustments, the CREDIT domain breakdown) are gone from the schema.
    return {
      pendingSharingSettlements,
      pendingSharingToAgents: sharingSummaryDashboard.toAgents,
      pendingSharingFromAgents: sharingSummaryDashboard.fromAgents,
      pendingCommissionPayouts,
      ...activity,
    };
  },

  agentSettlementTransactions: async (_: any, args: any, ctx: any) => {
    // An admin needed only a session to list every agent settlement of its whitelabel (usernames,
    // amounts). It now needs settlements.center:view, as settlementDashboard and the settlement-centre
    // reads do; an agent passes on its agents.list:view and is then held to the branch below (SCO-09).
    requireSettlementRead(ctx);
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Block commission agents from accessing settlement transactions
    // Commission agents use commission payouts, not settlements
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const agentsRepo = new AgentsRepo();
      const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
      if (loggedInAgent?.schemeType === 'COMMISSION') {
        throw new Error('Commission agents cannot access settlement transactions. Use commission payouts instead.');
      }
      // IDOR fix: agent can only query their own or a direct sub-agent's transactions
      if (args.agentId && args.agentId !== ctx.user.agentId) {
        const requestedAgent = await agentsRepo.findById(args.agentId);
        if (!requestedAgent || requestedAgent.parentAgentId !== ctx.user.agentId) {
          throw new Error('Forbidden: cannot access this agent\'s settlement data');
        }
      }
    }
    
    const repo = new AgentSettlementTransactionsRepo();
    
    const fromDate = args.fromDate ? new Date(args.fromDate) : undefined;
    const toDate = args.toDate ? new Date(args.toDate) : undefined;
    
    // When agent is logged in, restrict to their agentId (or validated args.agentId)
    const effectiveAgentId = (ctx?.user?.type === 'agent' && ctx?.user?.agentId)
      ? (args.agentId && args.agentId !== ctx.user.agentId ? args.agentId : ctx.user.agentId)
      : args.agentId;
    
    const settlements = await repo.list({
      tenant,
      agentId: effectiveAgentId,
      limit: args.limit,
      offset: args.offset,
      fromDate,
      toDate,
    });
    
    // Enrich with agent data
    const agentIds = [...new Set(settlements.map(s => s.agentId))];
    let agentMap = new Map();
    if (agentIds.length > 0) {
      const agentData = await db
        .select({
          id: agents.id,
          schemeType: agents.schemeType,
        })
        .from(agents)
        .where(inArray(agents.id, agentIds));
      
      // Get usernames from credentials
      const { agentCredentials } = await import('@shared/db/schema/agents');
      const credentials = await db
        .select()
        .from(agentCredentials)
        .where(inArray(agentCredentials.agentId, agentIds));
      
      agentMap = new Map(
        agentData.map(a => [
          a.id,
          {
            id: a.id,
            username: credentials.find(c => c.agentId === a.id)?.username || null,
            schemeType: a.schemeType,
          },
        ])
      );
    }
    
    return settlements.map(s => ({
      ...s,
      agent: agentMap.get(s.agentId) || null,
      createdAt: s.createdAt.toISOString(),
    }));
  },

  commissionPayouts: async (_: any, args: any, ctx: any) => {
    requireAuthenticated(ctx);
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // If agent is logged in, ensure they can only access their own or direct sub-agent's commission payouts
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const loggedInAgentId = ctx.user.agentId;
      const agentsRepo = new AgentsRepo();
      const loggedInAgent = await agentsRepo.findById(loggedInAgentId);
      if (loggedInAgent?.schemeType !== 'COMMISSION') {
        throw new Error('Unauthorized: Only commission agents can access commission payouts');
      }
      if (args.agentId && args.agentId !== loggedInAgentId) {
        const targetAgent = await agentsRepo.findById(args.agentId);
        if (!targetAgent || targetAgent.parentAgentId !== loggedInAgentId) {
          throw new Error('Unauthorized: Commission agents can only access their own or direct sub-agent commission payouts');
        }
      } else {
        args.agentId = loggedInAgentId;
      }
    } else if (ctx?.user?.type === 'agent') {
      // An agent session always carries its agent id. One without it is not an admin either: every agent derives
      // agents.commission:view (flat agents:view), so the admin gate below would hand it the whole tenant's list.
      throw new Error('Forbidden: insufficient permissions to view commission payouts');
    } else {
      // An admin needed only a session: measured, a support admin holding nothing but jackpots:read listed all
      // 137 payouts of its whitelabel (agent usernames, amounts, periods) while settlementDashboard refused it.
      // The payout table sits on the agent profile's Commission tab, so it takes that tab's read gate, as the
      // tab's other reads do: settlements.commission:view (flat finance:read) or agents.commission:view (T078).
      requireCommissionReadForAdmin(ctx);
    }

    const repo = new CommissionPayoutsRepo();
    
    const fromDate = args.fromDate ? new Date(args.fromDate) : undefined;
    const toDate = args.toDate ? new Date(args.toDate) : undefined;
    
    const payouts = await repo.list({
      tenant,
      agentId: args.agentId,
      limit: args.limit,
      offset: args.offset,
      fromDate,
      toDate,
    });
    
    // Enrich with agent data
    const agentIds = [...new Set(payouts.map(p => p.agentId))];
    let agentMap = new Map();
    if (agentIds.length > 0) {
      const agentData = await db
        .select({
          id: agents.id,
          schemeType: agents.schemeType,
        })
        .from(agents)
        .where(inArray(agents.id, agentIds));
      
      const { agentCredentials } = await import('@shared/db/schema/agents');
      const credentials = await db
        .select()
        .from(agentCredentials)
        .where(inArray(agentCredentials.agentId, agentIds));
      
      agentMap = new Map(
        agentData.map(a => [
          a.id,
          {
            id: a.id,
            username: credentials.find(c => c.agentId === a.id)?.username || null,
            schemeType: a.schemeType,
          },
        ])
      );
    }
    
    return payouts.map(p => ({
      ...p,
      agent: agentMap.get(p.agentId) || null,
      periodFrom: p.periodFrom?.toISOString() || null,
      periodTo: p.periodTo?.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
    }));
  },

  myCommissionSettlementHistory: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');

    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      return { items: [], total: 0 };
    }
    const agentsRepo = new AgentsRepo();
    const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
    if (!loggedInAgent || loggedInAgent.schemeType !== 'COMMISSION') {
      return { items: [], total: 0 };
    }
    const agentId = loggedInAgent.id;

    const repo = new CommissionPayoutsRepo();
    const fromDate = args.fromDate ? new Date(args.fromDate) : undefined;
    const toDate = args.toDate ? new Date(args.toDate) : undefined;
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;

    const [payouts, total] = await Promise.all([
      repo.list({ tenant, agentId, fromDate, toDate, limit, offset }),
      repo.count({ tenant, agentId, fromDate, toDate }),
    ]);

    const agentIds = [...new Set(payouts.map((p) => p.agentId))];
    let agentMap = new Map();
    if (agentIds.length > 0) {
      const { agentCredentials } = await import('@shared/db/schema/agents');
      const agentCredentialsTable = agentCredentials;
      const agentData = await db
        .select({ id: agents.id, schemeType: agents.schemeType })
        .from(agents)
        .where(inArray(agents.id, agentIds));
      const credentials = await db
        .select()
        .from(agentCredentialsTable)
        .where(inArray(agentCredentialsTable.agentId, agentIds));
      agentMap = new Map(
        agentData.map((a) => [
          a.id,
          { id: a.id, username: credentials.find((c) => c.agentId === a.id)?.username ?? null, schemeType: a.schemeType },
        ])
      );
    }

    const items = payouts.map((p) => ({
      ...p,
      agent: agentMap.get(p.agentId) ?? null,
      periodFrom: p.periodFrom?.toISOString?.() ?? (p.periodFrom ? new Date(p.periodFrom).toISOString() : null),
      periodTo: p.periodTo?.toISOString?.() ?? (p.periodTo ? new Date(p.periodTo).toISOString() : null),
      createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
    }));
    return { items, total };
  },

  downlineCommissionSettlementHistory: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');

    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      return { items: [], total: 0 };
    }
    const parentAgentId = ctx.user.agentId;
    const agentsRepo = new AgentsRepo();
    const parentAgent = await agentsRepo.findById(parentAgentId);
    if (!parentAgent || parentAgent.schemeType !== 'COMMISSION') {
      return { items: [], total: 0 };
    }

    const children = (await agentsRepo.listChildren(parentAgentId)).filter((c) => c.schemeType === 'COMMISSION');
    const directChildIds = children.map((c) => c.id);

    if (directChildIds.length === 0) {
      return { items: [], total: 0 };
    }

    if (args.subAgentId && !directChildIds.includes(args.subAgentId)) {
      throw new Error('Unauthorized: Commission agents can only view settlement history for their direct sub-agents');
    }

    const repo = new CommissionPayoutsRepo();
    const fromDate = args.fromDate ? new Date(args.fromDate) : undefined;
    const toDate = args.toDate ? new Date(args.toDate) : undefined;
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;

    const { items: payouts, total } = await repo.listForDownline({
      tenant,
      agentIds: directChildIds,
      subAgentId: args.subAgentId ?? undefined,
      fromDate,
      toDate,
      limit,
      offset,
    });

    const agentIds = [...new Set(payouts.map((p) => p.agentId))];
    let agentMap = new Map();
    if (agentIds.length > 0) {
      const { agentCredentials } = await import('@shared/db/schema/agents');
      const agentCredentialsTable = agentCredentials;
      const agentData = await db
        .select({ id: agents.id, schemeType: agents.schemeType })
        .from(agents)
        .where(inArray(agents.id, agentIds));
      const credentials = await db
        .select()
        .from(agentCredentialsTable)
        .where(inArray(agentCredentialsTable.agentId, agentIds));
      agentMap = new Map(
        agentData.map((a) => [
          a.id,
          { id: a.id, username: credentials.find((c) => c.agentId === a.id)?.username ?? null, schemeType: a.schemeType },
        ])
      );
    }

    const items = payouts.map((p) => ({
      ...p,
      agent: agentMap.get(p.agentId) ?? null,
      periodFrom: p.periodFrom?.toISOString?.() ?? (p.periodFrom ? new Date(p.periodFrom).toISOString() : null),
      periodTo: p.periodTo?.toISOString?.() ?? (p.periodTo ? new Date(p.periodTo).toISOString() : null),
      createdAt: (p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt)).toISOString(),
    }));
    return { items, total };
  },

  subAgentCommissionSummaries: async (_: any, args: { agentId?: string; periodFrom?: string; periodTo?: string; lastPaidBefore?: string }, ctx: any) => {
    let parentAgentId: string;
    if (args.agentId && ctx?.user?.type !== 'agent') {
      // A non-agent caller names the agent. This used to accept any agentId
      // with no permission and no tenant check, so any caller could read the
      // per-sub-agent GGR and commission of an agent in another whitelabel.
      requireCommissionReadForAdmin(ctx);
      parentAgentId = args.agentId;
    } else if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      parentAgentId = ctx.user.agentId;
    } else {
      return [];
    }
    const agentsRepo = new AgentsRepo();
    const callerTenant = callerTenantOf(ctx);
    const parentAgent = callerTenant ? await agentsRepo.findByIdScoped(parentAgentId, callerTenant) : null;
    if (!parentAgent || parentAgent.schemeType !== 'COMMISSION') {
      return [];
    }
    const tenant = parentAgent.tenantId ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const children = (await agentsRepo.listChildren(parentAgentId)).filter((c) => c.schemeType === 'COMMISSION');
    if (children.length === 0) return [];

    const payoutsRepo = new CommissionPayoutsRepo();
    // One request-local set of agent/rate/closure and grouped GGR reads for all children.
    // The existing commission engine still applies each child's gross, tally, carry and paid-cycle rules.
    const reportAgents = await agentsRepo.list(tenant);
    const commissionCalcService = await createCommissionReportCalculator(tenant, reportAgents, payoutsRepo, { preserveExactClosure: true });
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(tenant);
    const { parseCycleDateIST } = await import('../../agents/services/CommissionCycleUtils.js');
    const parsedFrom = args?.periodFrom ? parseCycleDateIST(args.periodFrom) : null;
    const parsedTo = args?.periodTo ? parseCycleDateIST(args.periodTo) : null;
    const parsedLastPaidBefore = args?.lastPaidBefore ? new Date(args.lastPaidBefore) : null;
    const periodFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : new Date(0);
    const periodTo = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : new Date();
    const lastPaidBefore = parsedLastPaidBefore && !Number.isNaN(parsedLastPaidBefore.getTime())
      ? parsedLastPaidBefore
      : undefined;
    const childIds = children.map((c) => c.id);
    const [lastPayoutDates, allTimePaidMap] = await Promise.all([
      payoutsRepo.getLastPayoutDateByAgentIds(
        tenant,
        childIds,
        { beforeDate: lastPaidBefore },
      ),
      payoutsRepo.getTotalPaidByAgentIds(tenant, childIds),
    ]);
    const summaries = await Promise.all(
      children.map(async (subAgent) => {
        // What the parent owes each child is the child's GROSS (its rate x its whole
        // subtree's GGR), not its net: the child pays its own children out of it.
        // Paying the net left the child short by exactly that (A 10% -> B 8% -> C 5%,
        // C's players lose 1000: A must pay B 80, not 30, so B can pay C 50).
        const domainSummary = await commissionCalcService.calculateCommissionSummary(subAgent.id, periodFrom, periodTo, currency, 'gross');
        const unified = await commissionCalcService.getUnifiedCommission(
          subAgent.id,
          currency,
          tenant,
          { periodFrom, periodTo, mode: 'gross', preCalculatedSummary: domainSummary },
        );
        const lastAt = lastPayoutDates.get(subAgent.id);
        const lastPaidAt = lastAt ? lastAt.toISOString() : null;
        return {
          agentId: subAgent.id,
          username: subAgent.username ?? null,
          pendingCommission: Number.isFinite(unified.pending) ? unified.pending : 0,
          totalPaid: allTimePaidMap.get(subAgent.id) ?? 0,
          lastPaidAt,
          sportsGGR: domainSummary.sportsGGR ?? 0,
          casinoGGR: domainSummary.casinoGGR ?? 0,
          matkaGGR: domainSummary.matkaGGR ?? 0,
          sportsCommission: domainSummary.sportsCommission ?? 0,
          casinoCommission: domainSummary.casinoCommission ?? 0,
          matkaCommission: domainSummary.matkaCommission ?? 0,
          sportsCommissionRate: domainSummary.sportsCommissionRate ?? 0,
          casinoCommissionRate: domainSummary.casinoCommissionRate ?? 0,
          matkaCommissionRate: domainSummary.matkaCommissionRate ?? 0,
          currency: domainSummary.currency ?? currency,
          tallyEnabled: subAgent.tallyEnabled ?? false,
          tallyDomains: (subAgent.tallyDomains ?? []) as ('sports' | 'casino' | 'matka')[],
          effectiveCalculatedTotal: domainSummary.effectiveCalculatedTotal ?? 0,
          effectiveSportsCommission: domainSummary.effectiveSportsCommission ?? 0,
          effectiveCasinoCommission: domainSummary.effectiveCasinoCommission ?? 0,
          effectiveMatkaCommission: domainSummary.effectiveMatkaCommission ?? 0,
        };
      })
    );
    return summaries
      .sort((a, b) => (b.pendingCommission ?? 0) - (a.pendingCommission ?? 0) || (b.totalPaid ?? 0) - (a.totalPaid ?? 0));
  },

  whitelabelCommissionSummaries: async (_: any, args: { periodFrom: string; periodTo: string }, ctx: any) => {
    if (ctx?.user?.type === 'agent') {
      return [];
    }
    if (!hasPermission(ctx?.permissions ?? [], 'settlements.center', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view commission summaries');
    }
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentsRepo = new AgentsRepo();
    const reportAgents = await agentsRepo.list(tenant);
    const commissionAgents = reportAgents.filter(agent => agent.schemeType === 'COMMISSION' && agent.parentAgentId == null);
    if (commissionAgents.length === 0) return [];

    const { parseCycleDateIST: parseCycleDateISTW } = await import('../../agents/services/CommissionCycleUtils.js');
    const periodFrom = args?.periodFrom ? parseCycleDateISTW(args.periodFrom) : new Date(0);
    const periodTo = args?.periodTo ? parseCycleDateISTW(args.periodTo) : new Date();
    if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime()) || periodFrom > periodTo) {
      return [];
    }

    const payoutsRepo = new CommissionPayoutsRepo();
    const commissionCalcService = await createCommissionReportCalculator(tenant, reportAgents, payoutsRepo);
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(tenant);
    const agentIds = commissionAgents.map((a) => a.id);
    const [lastPayoutDates, allTimePaidMap] = await Promise.all([
      payoutsRepo.getLastPayoutDateByAgentIds(tenant, agentIds),
      payoutsRepo.getTotalPaidByAgentIds(tenant, agentIds),
    ]);

    const summaries = await Promise.all(
      commissionAgents.map(async (agent) => {
        const domainSummary = await commissionCalcService.calculateCommissionSummary(agent.id, periodFrom, periodTo, currency, 'gross');
        const unified = await commissionCalcService.getUnifiedCommission(agent.id, currency, tenant, { periodFrom, periodTo, preCalculatedSummary: domainSummary });
        const lastAt = lastPayoutDates.get(agent.id);
        const lastPaidAt = lastAt ? lastAt.toISOString() : null;
        return {
          agentId: agent.id,
          username: agent.username ?? null,
          pendingCommission: Number.isFinite(unified.pending) ? unified.pending : 0,
          totalPaid: allTimePaidMap.get(agent.id) ?? 0,
          lastPaidAt,
          sportsGGR: domainSummary.sportsGGR ?? 0,
          casinoGGR: domainSummary.casinoGGR ?? 0,
          matkaGGR: domainSummary.matkaGGR ?? 0,
          sportsCommission: domainSummary.sportsCommission ?? 0,
          casinoCommission: domainSummary.casinoCommission ?? 0,
          matkaCommission: domainSummary.matkaCommission ?? 0,
          sportsCommissionRate: domainSummary.sportsCommissionRate ?? 0,
          casinoCommissionRate: domainSummary.casinoCommissionRate ?? 0,
          matkaCommissionRate: domainSummary.matkaCommissionRate ?? 0,
          currency: domainSummary.currency ?? currency,
          tallyEnabled: agent.tallyEnabled ?? false,
          tallyDomains: (agent.tallyDomains ?? []) as ('sports' | 'casino' | 'matka')[],
          effectiveCalculatedTotal: domainSummary.effectiveCalculatedTotal ?? 0,
          effectiveSportsCommission: domainSummary.effectiveSportsCommission ?? 0,
          effectiveCasinoCommission: domainSummary.effectiveCasinoCommission ?? 0,
          effectiveMatkaCommission: domainSummary.effectiveMatkaCommission ?? 0,
        };
      }),
    );
    return summaries
      .filter((s) => (s.pendingCommission ?? 0) > 0.01)
      .sort((a, b) => (b.pendingCommission ?? 0) - (a.pendingCommission ?? 0) || (b.totalPaid ?? 0) - (a.totalPaid ?? 0));
  },

  commissionCyclesForAgent: async (_: any, args: any, ctx: any) => {
    requireCommissionCycleRead(ctx);
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentId = args.agentId as string;
    if (!agentId) return [];
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(agentId);
    if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'COMMISSION') return [];
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      // Any agent in the caller's subtree (agent_hierarchy_closure; includes
      // self), as commissionSummary allows. This was direct children only, so
      // "View Bets" on a sub-agent two or more levels down came back empty.
      // Reading is subtree-wide; paying stays direct-child-only (payCommission).
      const subtreeIds = await agentsRepo.getDescendantIds(ctx.user.agentId);
      if (!subtreeIds.includes(agentId)) return [];
    }
    const payoutsRepo = new CommissionPayoutsRepo();
    const { CommissionCycleService } = await import('../../agents/services/CommissionCycleService.js');
    const cycleService = new CommissionCycleService(agentsRepo, payoutsRepo);
    const cycles = await cycleService.listCyclesForAgent(agentId, tenant);
    // Every cycle with its payable/paid/status, and its IST dates (fromDate /
    // toDate, YYYY-MM-DD) so a screen can offer any unpaid week and send those
    // dates back unchanged, instead of working Mondays out in the browser's zone.
    const { DateTime } = await import('luxon');
    const istDate = (d: Date) => DateTime.fromJSDate(d, { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd');
    return cycles.map((c) => ({
      from: c.from.toISOString(),
      to: c.to.toISOString(),
      status: c.status,
      paidAmount: c.paidAmount ?? null,
      payableAmount: c.payableAmount ?? null,
      calculatedTotal: c.calculatedTotal ?? null,
      adjustmentAmount: c.adjustmentAmount ?? null,
      zeroCommission: c.zeroCommission ?? false,
      carriedLoss: c.carriedLoss ?? null,
      carryApplied: c.carryApplied ?? null,
      lossThisCycle: c.lossThisCycle ?? null,
      fromDate: istDate(c.from),
      toDate: istDate(c.to),
    }));
  },

  currentCommissionCycle: async () => {
    const { getCurrentCycleIST } = await import('../../agents/services/CommissionCycleUtils.js');
    const { DateTime } = await import('luxon');
    const bounds = getCurrentCycleIST();
    const istDate = (d: Date) => DateTime.fromJSDate(d, { zone: 'Asia/Kolkata' }).toFormat('yyyy-MM-dd');
    const previousFrom = DateTime.fromJSDate(bounds.from, { zone: 'Asia/Kolkata' }).minus({ weeks: 1 }).toJSDate();
    return {
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      status: 'OPEN',
      // IST calendar dates of this cycle and of the last closed one, for screens
      // that pass cycle dates to commission queries (YYYY-MM-DD is read as IST).
      fromDate: istDate(bounds.from),
      toDate: istDate(bounds.to),
      previousFromDate: istDate(previousFrom),
      previousToDate: istDate(bounds.from),
    };
  },

  commissionAdjustmentsPage: async (_: any, args: any, ctx: any): Promise<any> => {
    const items = await settlementsQueryResolvers.commissionAdjustments(_, args, ctx);
    const tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    // Empty/hidden agent targets must not leak their counts.
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const agent = args.agentId ? await new AgentsRepo().findById(args.agentId) : null;
    const visible = agent?.tenantId === tenant && agent?.schemeType === 'COMMISSION' &&
      (ctx?.user?.type !== 'agent' || (await new AgentsRepo().getDescendantIds(ctx.user.agentId)).includes(args.agentId));
    return { items, total: visible ? await new CommissionAdjustmentsRepo().countByAgent(tenant, args.agentId) : 0 };
  },
  commissionAdjustments: async (_: any, args: any, ctx: any) => {
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentId = args.agentId as string;
    if (!agentId) return [];
    // Adjustments are back-office corrections. An admin needs a commission read
    // permission; an agent may see them only for itself or its own subtree.
    // There was no check of either kind, so any agent could list any agent's.
    if (ctx?.user?.type === 'agent') {
      if (!ctx?.user?.agentId) throw new Error('Forbidden: insufficient permissions to view commission adjustments');
    } else {
      requireCommissionReadForAdmin(ctx);
    }
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(agentId);
    if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'COMMISSION') return [];
    if (ctx?.user?.type === 'agent') {
      const subtreeIds = await agentsRepo.getDescendantIds(ctx.user.agentId);
      if (!subtreeIds.includes(agentId)) return [];
    }
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const repo = new CommissionAdjustmentsRepo();
    const list = await repo.listByAgent(tenant, agentId, args.limit ?? 100, args.offset ?? 0);
    return list.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      amount: a.amount,
      sourceCycleFrom: a.sourceCycleFrom.toISOString(),
      sourceCycleTo: a.sourceCycleTo.toISOString(),
      targetCycleFrom: a.targetCycleFrom?.toISOString() ?? null,
      targetCycleTo: a.targetCycleTo?.toISOString() ?? null,
      reason: a.reason,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      appliedAt: a.appliedAt?.toISOString() ?? null,
    }));
  },

  commissionCycleReadiness: async (_: any, args: any, ctx: any) => {
    requireCommissionCycleRead(ctx);
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentId = args.agentId as string;
    const { parseCycleDateIST } = await import('../../agents/services/CommissionCycleUtils.js');
    const cycleFrom = parseCycleDateIST(args.cycleFrom);
    const cycleTo = parseCycleDateIST(args.cycleTo);
    if (!agentId) {
      return { ready: false, reasons: [], calculatedTotal: 0, postedTotal: 0, paidInCycle: 0, payableAmount: 0, currency: 'INR' };
    }
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(agentId);
    if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'COMMISSION') {
      return { ready: false, reasons: [], calculatedTotal: 0, postedTotal: 0, paidInCycle: 0, payableAmount: 0, currency: 'INR' };
    }
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const parentId = ctx.user.agentId;
      if (agentId !== parentId) {
        const children = await agentsRepo.listChildren(parentId);
        if (!children.some((c) => c.id === agentId)) {
          return { ready: false, reasons: ['Unauthorized'], calculatedTotal: 0, postedTotal: 0, paidInCycle: 0, payableAmount: 0, currency: 'INR' };
        }
      }
    }
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(tenant).catch(() => 'INR');
    const configsRepo = new AgentConfigsRepo();
    const ledgerRepo = new AgentLedgerRepo();
    const payoutsRepo = new CommissionPayoutsRepo();
    const { CommissionReadinessService } = await import('../../agents/services/CommissionReadinessService.js');
    const readinessService = new CommissionReadinessService(agentsRepo, configsRepo, ledgerRepo, payoutsRepo);
    // The payable is the target's GROSS whoever pays it (the admin a root agent,
    // a parent its direct child) — the same figure payCommission checks.
    const r = await readinessService.getReadiness(agentId, cycleFrom, cycleTo, tenant, currency, 'gross');
    return {
      ready: r.ready,
      reasons: r.reasons,
      calculatedTotal: r.calculatedTotal,
      postedTotal: r.postedTotal,
      paidInCycle: r.paidInCycle,
      payableAmount: r.payableAmount,
      currency: r.currency,
      openBets: r.openBets,
      unresolvedAdjustments: r.unresolvedAdjustments,
      previousCycleOpenBets: r.previousCycleOpenBets,
      carriedLoss: r.carriedLoss,
      carryApplied: r.carryApplied,
    };
  },

  pendingSettlements: async (_: any, args: any, ctx: any) => {
    requireSettlementRead(ctx);
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    const statsService = new AgentListStatsService();
    
    // Get agents filtered by scheme type
    let allAgents = await agentsRepo.list(tenant);
    
    // If agent is logged in, filter to only their own data
    let loggedInAgentId: string | undefined = undefined;
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
      if (loggedInAgent && loggedInAgent.tenantId === tenant) {
        allAgents = [loggedInAgent];
        loggedInAgentId = loggedInAgent.id;
      } else {
        allAgents = [];
      }
    } else {
      // Admin: keep SHARING at top-level, but include all COMMISSION agents
      // so pending commission payouts are not hidden for nested agents.
      allAgents = allAgents.filter(a => a.parentAgentId == null || a.schemeType === 'COMMISSION');
    }
    // CREDIT agents settle by moving chips (Deposit / Withdraw), never here.
    allAgents = allAgents.filter(a => a.schemeType !== 'CREDIT');

    const filteredAgents = args.schemeType
      ? allAgents.filter(a => a.schemeType === args.schemeType)
      : allAgents;

    if (filteredAgents.length === 0) return [];
    const agentIds = filteredAgents.map(a => a.id);
    const statsMap = await statsService.getStatsForAgents(agentIds, tenant);
    
    // Get last settlement dates
    const settlementsRepo = new AgentSettlementTransactionsRepo();
    const recentSettlements = await settlementsRepo.list({
      tenant,
      agentId: loggedInAgentId, // Filter by agent if logged in
      limit: 1000, // Get all to find last settlement per agent
    });
    
    // Build lastSettlementMap from recentSettlements (only store valid dates)
    const lastSettlementMap = new Map<string, Date>();
    for (const agent of filteredAgents) {
      const agentSettlements = recentSettlements.filter(s => s.agentId === agent.id);
      if (agentSettlements.length > 0) {
        const lastPosted = agentSettlements[0];
        if (lastPosted && lastPosted.createdAt) {
          const createdAt = lastPosted.createdAt instanceof Date ? lastPosted.createdAt : new Date(lastPosted.createdAt);
          if (!Number.isNaN(createdAt.getTime())) {
            const existing = lastSettlementMap.get(agent.id);
            if (!existing || createdAt > existing) {
              lastSettlementMap.set(agent.id, createdAt);
            }
          }
        }
      }
    }
    
    // Get agent credentials for usernames
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const credentials = await db
      .select()
      .from(agentCredentials)
      .where(inArray(agentCredentials.agentId, agentIds));
    
    const credentialMap = new Map(credentials.map(c => [c.agentId, c.username]));

    // COMMISSION: pending = earned - total paid; last payout date for lastSettlementDate
    const commissionAgentIdsPending = filteredAgents.filter((a) => a.schemeType === 'COMMISSION').map((a) => a.id);
    const payoutsRepoPending = new CommissionPayoutsRepo();
    const [commissionTotalPaidMapPending, commissionLastPayoutDateMapPending] = commissionAgentIdsPending.length > 0
      ? await Promise.all([
          payoutsRepoPending.getTotalPaidByAgentIds(tenant, commissionAgentIdsPending),
          payoutsRepoPending.getLastPayoutDateByAgentIds(tenant, commissionAgentIdsPending),
        ])
      : [new Map<string, number>(), new Map<string, Date>()];
    
    const pending: any[] = [];
    const ledgerRepo = new AgentLedgerRepo();
    const commissionPayoutsRepoPending = new CommissionPayoutsRepo();
    const commissionCalcServicePending = new CommissionCalculationService(
      agentsRepo,
      configsRepo,
      ledgerRepo,
      new HybridGGRReader(),
      commissionPayoutsRepoPending,
    );
    const { getWhitelabelCurrency: getWhitelabelCurrencyPending } = await import('@src/shared/whitelabelConfig.js');
    const pendingCurrency = await getWhitelabelCurrencyPending(tenant);
    const nowPending = new Date();

    // SHARING: pending from the settlement engine — the same window, GGR reader and
    // per-rate-segment maths the settle mutation posts. pendingAmount is signed like
    // the posted SHARE/SETTLEMENT lines: positive = TO_AGENT (pay the agent),
    // negative = FROM_AGENT (collect from the agent); settlementDirection says so.
    const { createSharingSettlementEngine: createSharingEnginePending } = await import('../../agents/services/sharingSettlementWiring.js');
    const { sharingPendingFields } = await import('../services/sharingPendingRows.js');
    const sharingEnginePending = createSharingEnginePending();
    const sharingAgents = filteredAgents.filter(a => a.schemeType === 'SHARING');
    const sharingPendingMap = new Map<string, Awaited<ReturnType<typeof sharingPendingFields>>>();
    for (const agent of sharingAgents) {
      try {
        sharingPendingMap.set(agent.id, await sharingPendingFields(sharingEnginePending, agent as any));
      } catch (err) {
        console.error('[pendingSettlements] SHARING pending failed for agent', agent.id, err instanceof Error ? err.message : err);
      }
    }

    for (const agent of filteredAgents) {
      const stats = statsMap.get(agent.id);
      let pendingAmount = 0;
      let settlementType = '';
      let periodFromForRates: Date | null = null;
      let settlementDirection: string | null = null;

      if (agent.schemeType === 'SHARING') {
        const sharingData = sharingPendingMap.get(agent.id);
        if (!sharingData) continue;
        periodFromForRates = new Date(sharingData.periodFrom);
        pendingAmount = sharingData.pendingAmount;
        settlementDirection = sharingData.settlementDirection;
        settlementType = 'P_L';
        // Don't show in pending list if remaining is effectively zero (fully settled for this period)
        if (Math.abs(pendingAmount) < 0.01) continue;
      } else if (agent.schemeType === 'COMMISSION') {
        try {
          const unified = await commissionCalcServicePending.getUnifiedCommission(
            agent.id,
            pendingCurrency,
            tenant,
            { periodFrom: new Date(0), periodTo: nowPending },
          );
          pendingAmount = unified.pending;
        } catch {
          const earned = Number(stats?.commissionEarned ?? 0);
          const paid = commissionTotalPaidMapPending.get(agent.id) ?? 0;
          pendingAmount = Number.isFinite(earned) && Number.isFinite(paid) ? Math.max(0, earned - paid) : 0;
        }
        if (pendingAmount > 0.01) settlementType = 'COMMISSION';
      }
      
      if ((agent.schemeType === 'SHARING' && settlementType === 'P_L') || (agent.schemeType === 'COMMISSION' && Number.isFinite(pendingAmount) && pendingAmount > 0.01)) {
        const lastSettlement = lastSettlementMap.get(agent.id);
        const lastPayoutDatePending = agent.schemeType === 'COMMISSION' ? commissionLastPayoutDateMapPending.get(agent.id) : null;
        const lastSettlementDateSafe = lastSettlement != null
          ? (lastSettlement instanceof Date ? lastSettlement : new Date(lastSettlement as any))
          : null;
        const lastDateDisplay = agent.schemeType === 'COMMISSION' && lastPayoutDatePending && !Number.isNaN(lastPayoutDatePending.getTime())
          ? lastPayoutDatePending.toISOString()
          : (lastSettlementDateSafe && !Number.isNaN(lastSettlementDateSafe.getTime()) ? lastSettlementDateSafe.toISOString() : null);

        // Build ratesByDomain from sharing or commission config per allowed domain
        const ratesByDomain: Array<{ domain: string; rate: number }> = [];
        const allowedDomains = (agent.allowedDomains ?? []) as Array<'sports' | 'casino' | 'matka'>;
        const configAt = (agent.schemeType === 'SHARING' && periodFromForRates) ? periodFromForRates : new Date();
        for (const domain of allowedDomains) {
          if (agent.schemeType === 'SHARING') {
            const config = await configsRepo.getSharingConfig(agent.id, domain, configAt);
            if (config) {
              const rate = Number(config.shareRate);
              if (Number.isFinite(rate)) ratesByDomain.push({ domain, rate });
            }
          } else if (agent.schemeType === 'COMMISSION') {
            const config = await configsRepo.getCommissionConfig(agent.id, domain, configAt);
            if (config) {
              const rate = Number(config.commissionRate);
              if (Number.isFinite(rate)) ratesByDomain.push({ domain, rate });
            }
          }
        }

        // settlementBreakdownByDomain (SHARING) from the engine: amount = players' P/L
        // (−GGR), agentShare = the share the settlement posts (positive = TO_AGENT),
        // shareRate = effective rate. COMMISSION rows carry none.
        const settlementBreakdownByDomain: Array<{ domain: string; amount: number; percentage: number; shareRate: number; agentShare: number; cutAmount: number; cutPercentage: number }> = [];
        if (agent.schemeType === 'SHARING' && settlementType === 'P_L') {
          const sharingData = sharingPendingMap.get(agent.id);
          if (sharingData) settlementBreakdownByDomain.push(...sharingData.settlementBreakdownByDomain);
        }

        pending.push({
          agentId: agent.id,
          agent: {
            id: agent.id,
            username: credentialMap.get(agent.id) || null,
            schemeType: agent.schemeType,
            ratesByDomain,
          },
          schemeType: agent.schemeType,
          pendingAmount: Number.isFinite(pendingAmount) ? pendingAmount : 0,
          settlementDirection,
          periodFrom: agent.schemeType === 'SHARING' ? sharingPendingMap.get(agent.id)?.periodFrom ?? null : null,
          periodTo: agent.schemeType === 'SHARING' ? sharingPendingMap.get(agent.id)?.periodTo ?? null : null,
          settlementType,
          lastSettlementDate: lastDateDisplay ?? null,
          settlementBreakdownByDomain,
        });
      }
    }

    return pending;
  },

  enhancedPendingSettlements: async (_: any, args: any, ctx: any) => {
    requireSettlementRead(ctx);
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    const statsService = new AgentListStatsService();
    const { SettlementContributionService } = await import('../services/SettlementContributionService');
    const contributionService = new SettlementContributionService();
    
    // Get agents filtered by scheme type
    let allAgents = await agentsRepo.list(tenant);
    const reportAgents = allAgents;
    
    // If agent is logged in, filter to only their own data
    let loggedInAgentId: string | undefined = undefined;
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
      if (loggedInAgent && loggedInAgent.tenantId === tenant) {
        allAgents = [loggedInAgent];
        loggedInAgentId = loggedInAgent.id;
      } else {
        allAgents = [];
      }
    } else {
      // Admin: keep SHARING at top-level, but include all COMMISSION agents
      // so pending commission payouts are not hidden for nested agents.
      allAgents = allAgents.filter(a => a.parentAgentId == null || a.schemeType === 'COMMISSION');
    }
    // CREDIT agents settle by moving chips (Deposit / Withdraw), never here.
    allAgents = allAgents.filter(a => a.schemeType !== 'CREDIT');

    const filteredAgents = args.schemeType
      ? allAgents.filter(a => a.schemeType === args.schemeType)
      : allAgents;

    if (filteredAgents.length === 0) return [];
    // Get agent credentials for usernames
    const agentIds = filteredAgents.map(a => a.id);
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const credentials = await db
      .select()
      .from(agentCredentials)
      .where(inArray(agentCredentials.agentId, agentIds));
    
    const credentialMap = new Map(credentials.map(c => [c.agentId, c.username]));
    
    // Get last settlement dates - use the agents repo for agent_settlements table
    const { AgentSettlementsRepo: AgentSettlementsRepoForAgents } = await import('../../../repos/agents/AgentSettlementsRepo');
    const settlementsRepoForAgents = new AgentSettlementsRepoForAgents();
    
    // One overlapping-history read; preserve each agent's POSTED-first selection.
    const lastSettlementMap = pendingLastSettlementDates(
      await settlementsRepoForAgents.listBatch(agentIds, new Date(0), new Date()),
    );

    // Total settled to each agent (all time) from agent_settlement_transactions
    const transactionsRepo = new AgentSettlementTransactionsRepo();
    const totalSettledMap = await transactionsRepo.getTotalSettledByAgentIds(tenant, agentIds);

    // COMMISSION: total paid per agent (pending = earned - paid) and last payout date for lastSettlementDate
    const commissionAgentIdsEnhanced = filteredAgents.filter((a) => a.schemeType === 'COMMISSION').map((a) => a.id);
    const payoutsRepoEnhanced = new CommissionPayoutsRepo();
    const [commissionTotalPaidMapEnhanced, commissionLastPayoutDateMap] = commissionAgentIdsEnhanced.length > 0
      ? await Promise.all([
          payoutsRepoEnhanced.getTotalPaidByAgentIds(tenant, commissionAgentIdsEnhanced),
          payoutsRepoEnhanced.getLastPayoutDateByAgentIds(tenant, commissionAgentIdsEnhanced),
        ])
      : [new Map<string, number>(), new Map<string, Date>()];
    
    const ledgerRepoEnhanced = new AgentLedgerRepo();
    const legacyCommissionCalculator = () => new CommissionCalculationService(
      agentsRepo, configsRepo, ledgerRepoEnhanced, new HybridGGRReader(), payoutsRepoEnhanced,
    );
    const commissionCalcServiceEnhanced = commissionAgentIdsEnhanced.length > 1
      ? await createCommissionReportCalculator(tenant, reportAgents, payoutsRepoEnhanced, { preserveExactClosure: true })
          .catch(() => legacyCommissionCalculator())
      : legacyCommissionCalculator();
    const { getWhitelabelCurrency: getWhitelabelCurrencyEnhanced } = await import('@src/shared/whitelabelConfig.js');
    const enhancedCurrency = await getWhitelabelCurrencyEnhanced(tenant);
    const nowEnhanced = new Date();
    // SHARING: pending from the settlement engine (same window and maths as the
    // settle mutation). pendingAmount: positive = TO_AGENT, negative = FROM_AGENT.
    const { createSharingSettlementEngine: createSharingEngineEnhanced } = await import('../../agents/services/sharingSettlementWiring.js');
    const { sharingPendingFields: sharingPendingFieldsEnhanced } = await import('../services/sharingPendingRows.js');
    const sharingEngineEnhanced = createSharingEngineEnhanced();
    const sharingAgents = filteredAgents.filter(a => a.schemeType === 'SHARING');
    const sharingStatsMap = new Map<string, Awaited<ReturnType<typeof sharingPendingFieldsEnhanced>>>();
    for (const agent of sharingAgents) {
      try {
        sharingStatsMap.set(agent.id, await sharingPendingFieldsEnhanced(sharingEngineEnhanced, agent as any));
      } catch (err) {
        console.error('[enhancedPendingSettlements] SHARING pending failed for agent', agent.id, err instanceof Error ? err.message : err);
      }
    }

    const enhanced: any[] = [];

    for (const agent of filteredAgents) {
      if (agent.schemeType === 'SHARING') {
        const sharingData = sharingStatsMap.get(agent.id);
        if (!sharingData) continue;

        const periodFrom = new Date(sharingData.periodFrom);
        const periodTo = new Date(sharingData.periodTo);
        const totalShare = sharingData.totalShareForPeriod;
        const sumSettled = sharingData.settledThisPeriod;

        {
          const pendingAmount = sharingData.pendingAmount;
          if (Math.abs(pendingAmount) < 0.01) continue;

          // Get contributions
          const contributions = await contributionService.getPlayerContributions(
            agent.id,
            periodFrom,
            periodTo,
            tenant
          );
          
          // Get top players (limit to 10)
          const topPlayers = [...contributions.directPlayers]
            .sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl))
            .slice(0, 10)
            .map(p => ({
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
          
          // Map sub-agents
          const subAgents = contributions.subAgents.map(s => ({
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
          
          // Domain breakdown from the engine (amount = players' P/L, agentShare = posted share).
          const settlementBreakdownByDomain: any[] = sharingData.settlementBreakdownByDomain;

          const lastSettlement = lastSettlementMap.get(agent.id);
          const lastSettlementDateSafe = lastSettlement && !Number.isNaN(lastSettlement.getTime()) ? lastSettlement.toISOString() : null;
          enhanced.push({
            agentId: agent.id,
            agent: {
              id: agent.id,
              username: credentialMap.get(agent.id) || null,
              schemeType: agent.schemeType,
            },
            schemeType: agent.schemeType,
            pendingAmount,
            settlementDirection: sharingData.settlementDirection,
            periodFrom: sharingData.periodFrom,
            periodTo: sharingData.periodTo,
            settledThisPeriod: sumSettled,
            totalShareForPeriod: totalShare,
            totalSettledToAgent: totalSettledMap.get(agent.id) ?? 0,
            settlementType: 'P_L',
            lastSettlementDate: lastSettlementDateSafe,
            settlementBreakdownByDomain,
            directPlayersContribution: contributions.totals.directShare,
            subAgentsContribution: contributions.totals.subAgentShare,
            directPlayersCount: contributions.totals.directPlayersCount,
            subAgentsCount: contributions.totals.subAgentsCount,
            topPlayers,
            subAgents,
          });
        }
      } else if (agent.schemeType === 'COMMISSION') {
        let pendingAmount = 0;
        let paid = commissionTotalPaidMapEnhanced.get(agent.id) ?? 0;
        try {
          const unified = await commissionCalcServiceEnhanced.getUnifiedCommission(
            agent.id,
            enhancedCurrency,
            tenant,
            { periodFrom: new Date(0), periodTo: nowEnhanced },
          );
          pendingAmount = Number(unified.pending ?? 0);
          paid = Number(unified.paid ?? paid);
        } catch {
          const statsMapForAgent = await statsService.getStatsForAgents([agent.id], tenant);
          const earned = Number(statsMapForAgent.get(agent.id)?.commissionEarned ?? 0);
          pendingAmount = Number.isFinite(earned) && Number.isFinite(paid) ? Math.max(0, earned - paid) : 0;
        }
        if (pendingAmount > 0.01) {
          const lastPayoutDate = commissionLastPayoutDateMap.get(agent.id);
          enhanced.push({
            agentId: agent.id,
            agent: {
              id: agent.id,
              username: credentialMap.get(agent.id) || null,
              schemeType: agent.schemeType,
            },
            schemeType: agent.schemeType,
            pendingAmount,
            settledThisPeriod: 0,
            totalShareForPeriod: null,
            totalSettledToAgent: paid,
            settlementType: 'COMMISSION',
            lastSettlementDate: (lastPayoutDate && !Number.isNaN(lastPayoutDate.getTime())) ? lastPayoutDate.toISOString() : null,
            settlementBreakdownByDomain: [],
            directPlayersContribution: 0,
            subAgentsContribution: 0,
            directPlayersCount: 0,
            subAgentsCount: 0,
            topPlayers: [],
            subAgents: [],
          });
        }
      }
    }
    
    return enhanced;
  },

  subAgentsPendingSettlements: async (_: any, args: any, ctx: any) => {
    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      return [];
    }
    const agentsRepo = new AgentsRepo();
    const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
    // COMMISSION pays its children by payCommission; CREDIT moves chips to and from
    // them (Deposit / Withdraw). Neither has sub-agent settlements here.
    if (!loggedInAgent || loggedInAgent.schemeType === 'COMMISSION' || loggedInAgent.schemeType === 'CREDIT') {
      return [];
    }
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const children = await agentsRepo.listChildren(ctx.user.agentId);
    const schemeType = args?.schemeType;
    let filteredAgents = schemeType
      ? children.filter((a: any) => a.schemeType === schemeType)
      : children;
    filteredAgents = filteredAgents.filter((a: any) => a.tenantId === tenant && a.schemeType !== 'CREDIT');
    if (filteredAgents.length === 0) return [];

    const configsRepo = new AgentConfigsRepo();
    const statsService = new AgentListStatsService();
    const { SettlementContributionService } = await import('../services/SettlementContributionService');
    const contributionService = new SettlementContributionService();
    const agentIds = filteredAgents.map((a: any) => a.id);
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const credentials = await db
      .select()
      .from(agentCredentials)
      .where(inArray(agentCredentials.agentId, agentIds));
    const credentialMap = new Map(credentials.map((c: any) => [c.agentId, c.username]));

    const { AgentSettlementsRepo: AgentSettlementsRepoForAgents } = await import('../../../repos/agents/AgentSettlementsRepo');
    const settlementsRepoForAgents = new AgentSettlementsRepoForAgents();
    const lastSettlementMap = new Map<string, Date>();
    for (const agent of filteredAgents) {
      const recentSettlements = await settlementsRepoForAgents.list(agent.id, new Date(0), new Date());
      if (recentSettlements.length > 0) {
        const lastPosted = recentSettlements.find((s: any) => s.status === 'POSTED') || recentSettlements[0];
        if (lastPosted?.createdAt) {
          const createdAt = lastPosted.createdAt instanceof Date ? lastPosted.createdAt : new Date(lastPosted.createdAt);
          if (!Number.isNaN(createdAt.getTime())) {
            const existing = lastSettlementMap.get(agent.id);
            if (!existing || createdAt > existing) lastSettlementMap.set(agent.id, createdAt);
          }
        }
      }
    }

    const transactionsRepoSub = new AgentSettlementTransactionsRepo();
    const totalSettledMapSub = await transactionsRepoSub.getTotalSettledByAgentIds(tenant, agentIds);

    // SHARING: pending from the settlement engine (same window and maths as the
    // settle mutation). pendingAmount: positive = TO_AGENT, negative = FROM_AGENT.
    const { createSharingSettlementEngine: createSharingEngineSub } = await import('../../agents/services/sharingSettlementWiring.js');
    const { sharingPendingFields: sharingPendingFieldsSub } = await import('../services/sharingPendingRows.js');
    const sharingEngineSub = createSharingEngineSub();
    const sharingAgents = filteredAgents.filter((a: any) => a.schemeType === 'SHARING');
    const sharingStatsMap = new Map<string, Awaited<ReturnType<typeof sharingPendingFieldsSub>>>();
    for (const agent of sharingAgents) {
      try {
        sharingStatsMap.set(agent.id, await sharingPendingFieldsSub(sharingEngineSub, agent as any));
      } catch (err) {
        console.error('[subAgentsPendingSettlements] SHARING pending failed for agent', agent.id, err instanceof Error ? err.message : err);
      }
    }

    const enhanced: any[] = [];
    const emptyRow = (agent: any, pendingAmount: number, settlementType: string, settledThisPeriod = 0, totalShareForPeriod: number | null = null) => {
      const lastSettlement = lastSettlementMap.get(agent.id);
      const safeLast = lastSettlement && !Number.isNaN(lastSettlement.getTime()) ? lastSettlement.toISOString() : null;
      const safePending = Number.isFinite(pendingAmount) ? pendingAmount : 0;
      const sharingWindow = agent.schemeType === 'SHARING' ? sharingStatsMap.get(agent.id) : undefined;
      return {
        agentId: agent.id,
        agent: { id: agent.id, username: credentialMap.get(agent.id) || null, schemeType: agent.schemeType },
        schemeType: agent.schemeType,
        pendingAmount: safePending,
        settlementDirection: sharingWindow ? sharingWindow.settlementDirection : null,
        periodFrom: sharingWindow?.periodFrom ?? null,
        periodTo: sharingWindow?.periodTo ?? null,
        settledThisPeriod,
        totalShareForPeriod,
        totalSettledToAgent: totalSettledMapSub.get(agent.id) ?? 0,
        settlementType,
        lastSettlementDate: safeLast,
        settlementBreakdownByDomain: [] as any[],
        directPlayersContribution: 0,
        subAgentsContribution: 0,
        directPlayersCount: 0,
        subAgentsCount: 0,
        topPlayers: [] as any[],
        subAgents: [] as any[],
      };
    };
    for (const agent of filteredAgents) {
      if (agent.schemeType === 'SHARING') {
        const sharingData = sharingStatsMap.get(agent.id);
        if (!sharingData) {
          enhanced.push(emptyRow(agent, 0, 'P_L'));
          continue;
        }
        const periodFrom = new Date(sharingData.periodFrom);
        const periodTo = new Date(sharingData.periodTo);
        const totalShare = sharingData.totalShareForPeriod;
        const sumSettledSub = sharingData.settledThisPeriod;
        const pendingAmount = sharingData.pendingAmount;
        const hasActivity = Math.abs(totalShare) >= 0.005 || Math.abs(sumSettledSub) >= 0.005;
        if (hasActivity && Math.abs(pendingAmount) < 0.01) continue; // Fully settled for this period - omit from list
        if (hasActivity) {
          const contributions = await contributionService.getPlayerContributions(agent.id, periodFrom, periodTo, tenant);
          const topPlayers = [...contributions.directPlayers]
            .sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl))
            .slice(0, 10)
            .map((p: any) => ({
              playerId: String(p.playerId),
              playerName: p.playerName,
              playerUsername: p.playerUsername,
              pl: p.pl,
              share: p.share,
              domainBreakdown: [
                { domain: 'sports' as const, pl: p.domainBreakdown.sports.pl, share: p.domainBreakdown.sports.share, cutAmount: p.domainBreakdown.sports.cutAmount },
                { domain: 'casino' as const, pl: p.domainBreakdown.casino.pl, share: p.domainBreakdown.casino.share, cutAmount: p.domainBreakdown.casino.cutAmount },
                { domain: 'matka' as const, pl: p.domainBreakdown.matka.pl, share: p.domainBreakdown.matka.share, cutAmount: p.domainBreakdown.matka.cutAmount },
              ],
              contributionPercentage: p.contributionPercentage,
              isDirectPlayer: p.isDirectPlayer,
              subAgentId: p.subAgentId,
              subAgentName: p.subAgentName,
            }));
          const subAgents = contributions.subAgents.map((s: any) => ({
            subAgentId: s.subAgentId,
            subAgentName: s.subAgentName,
            subAgentUsername: s.subAgentUsername,
            totalPL: s.totalPL,
            totalShare: s.totalShare,
            playerCount: s.playerCount,
            domainBreakdown: [
              { domain: 'sports' as const, pl: s.domainBreakdown.sports.pl, share: s.domainBreakdown.sports.share, cutAmount: s.domainBreakdown.sports.cutAmount },
              { domain: 'casino' as const, pl: s.domainBreakdown.casino.pl, share: s.domainBreakdown.casino.share, cutAmount: s.domainBreakdown.casino.cutAmount },
              { domain: 'matka' as const, pl: s.domainBreakdown.matka.pl, share: s.domainBreakdown.matka.share, cutAmount: s.domainBreakdown.matka.cutAmount },
            ],
            contributionPercentage: s.contributionPercentage,
            players: s.players.map((p: any) => ({
              playerId: String(p.playerId),
              playerName: p.playerName,
              playerUsername: p.playerUsername,
              pl: p.pl,
              share: p.share,
              domainBreakdown: [
                { domain: 'sports' as const, pl: p.domainBreakdown.sports.pl, share: p.domainBreakdown.sports.share, cutAmount: p.domainBreakdown.sports.cutAmount },
                { domain: 'casino' as const, pl: p.domainBreakdown.casino.pl, share: p.domainBreakdown.casino.share, cutAmount: p.domainBreakdown.casino.cutAmount },
                { domain: 'matka' as const, pl: p.domainBreakdown.matka.pl, share: p.domainBreakdown.matka.share, cutAmount: p.domainBreakdown.matka.cutAmount },
              ],
              contributionPercentage: p.contributionPercentage,
              isDirectPlayer: p.isDirectPlayer,
              subAgentId: p.subAgentId,
              subAgentName: p.subAgentName,
            })),
          }));
          // Domain breakdown from the engine (amount = players' P/L, agentShare = posted share).
          const settlementBreakdownByDomain: any[] = sharingData.settlementBreakdownByDomain;
          const lastSettlement = lastSettlementMap.get(agent.id);
          const safePending = Number.isFinite(pendingAmount) ? pendingAmount : 0;
          const lastSettlementDateSafe = lastSettlement && !Number.isNaN(lastSettlement.getTime()) ? lastSettlement.toISOString() : null;
          enhanced.push({
            agentId: agent.id,
            agent: { id: agent.id, username: credentialMap.get(agent.id) || null, schemeType: agent.schemeType },
            schemeType: agent.schemeType,
            pendingAmount: safePending,
            settlementDirection: sharingData.settlementDirection,
            periodFrom: sharingData.periodFrom,
            periodTo: sharingData.periodTo,
            settledThisPeriod: sumSettledSub,
            totalShareForPeriod: totalShare,
            totalSettledToAgent: totalSettledMapSub.get(agent.id) ?? 0,
            settlementType: 'P_L',
            lastSettlementDate: lastSettlementDateSafe,
            settlementBreakdownByDomain,
            directPlayersContribution: contributions.totals.directShare,
            subAgentsContribution: contributions.totals.subAgentShare,
            directPlayersCount: contributions.totals.directPlayersCount,
            subAgentsCount: contributions.totals.subAgentsCount,
            topPlayers,
            subAgents,
          });
        } else {
          enhanced.push(emptyRow(agent, pendingAmount, 'P_L', sumSettledSub, totalShare));
        }
      }
    }
    return enhanced;
  },

  settlementDetails: async (_: any, { settlementId }: { settlementId: string }, ctx: any) => {
    requireSettlementRead(ctx);
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const { AgentSettlementsRepo } = await import('../../../repos/agents/AgentSettlementsRepo');
    const settlementsRepo = new AgentSettlementsRepo();
    const { SettlementContributionService } = await import('../services/SettlementContributionService');
    const contributionService = new SettlementContributionService();
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    
    // Get settlement with notes
    const settlementWithNotes = await settlementsRepo.getSettlementWithNotes(settlementId);
    if (!settlementWithNotes) {
      throw new Error('Settlement not found');
    }
    
    const { settlement, notes, postedBy, postedAt } = settlementWithNotes;
    
    // Check authorization - agents can access: (1) their own settlements (upline) or (2) settlements they performed for sub-agents (downline)
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const isOwnSettlement = settlement.agentId === ctx.user.agentId;
      const isDownlineSettlement = settlement.settledByAgentId === ctx.user.agentId;
      if (!isOwnSettlement && !isDownlineSettlement) {
        throw new Error('Unauthorized: You can only access your own settlement details or details of settlements you did for your sub-agents');
      }
    }
    
    // Verify tenant
    const agent = await agentsRepo.findById(settlement.agentId);
    if (!agent || agent.tenantId !== tenant) {
      throw new Error('Settlement not found or does not belong to this tenant');
    }
    
    // Get agent username from credentials
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const [credential] = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, agent.id))
      .limit(1);
    const agentUsername = credential?.username || null;
    
    const periodFrom = settlement.periodFrom instanceof Date ? settlement.periodFrom : new Date(settlement.periodFrom);
    const periodTo = settlement.periodTo instanceof Date ? settlement.periodTo : new Date(settlement.periodTo);
    
    // Get contributions for this settlement period
    const contributions = await contributionService.getPlayerContributions(
      settlement.agentId,
      periodFrom,
      periodTo,
      tenant
    );
    
    // Map player contributions
    const playerContributions = contributions.directPlayers.map(p => ({
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
    
    // Map sub-agent contributions
    const subAgentContributions = contributions.subAgents.map(s => ({
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
    
    // Build domain breakdown
    const domainBreakdown: any[] = [];
    if (agent.schemeType === 'SHARING') {
      // The settlement window's GGR from the engine's reader, with the share that
      // was actually posted for it (the SHARE lines inside the window) — the
      // same figures the settlement was made from.
      try {
        const { createSharingSettlementEngine: createSharingEngineDetails } = await import('../../agents/services/sharingSettlementWiring.js');
        const { domainBreakdownItems } = await import('../../agents/services/SharingSettlementEngine.js');
        const engineDetails = createSharingEngineDetails();
        const stateDetails = await engineDetails.windowState(agent as any, periodFrom, periodTo);
        domainBreakdown.push(...domainBreakdownItems(stateDetails.fresh, stateDetails.plan.existingByDomain));
      } catch (err) {
        console.error('[settlementDetails] SHARING breakdown failed', err instanceof Error ? err.message : err);
      }
    }
    
    return {
      id: settlement.id,
      agentId: settlement.agentId,
      agent: {
        id: agent.id,
        username: agentUsername,
        schemeType: agent.schemeType,
      },
      periodFrom: periodFrom.toISOString(),
      periodTo: periodTo.toISOString(),
      totalAmount: Number(settlement.totalAmount),
      direction: Number(settlement.totalAmount) >= 0 ? 'TO_AGENT' : 'FROM_AGENT', // Positive = platform pays TO agent, negative = platform collects FROM agent
      status: settlement.status,
      currency: settlement.currency,
      notes,
      postedBy,
      postedAt: postedAt ? postedAt.toISOString() : null,
      createdAt: (settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt)).toISOString(),
      directPlayersContribution: contributions.totals.directShare,
      subAgentsContribution: contributions.totals.subAgentShare,
      directPlayersCount: contributions.totals.directPlayersCount,
      subAgentsCount: contributions.totals.subAgentsCount,
      domainBreakdown,
      playerContributions,
      subAgentContributions,
    };
  },

  agentSettlementContributions: async (_: any, { agentId, periodFrom, periodTo }: { agentId: string; periodFrom: string; periodTo: string }, ctx: any) => {
    requireSettlementRead(ctx);
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const agentsRepo = new AgentsRepo();
    const { SettlementContributionService } = await import('../services/SettlementContributionService');
    const contributionService = new SettlementContributionService();
    
    // Check authorization
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      if (agentId !== ctx.user.agentId) {
        throw new Error('Unauthorized: You can only access your own settlement contributions');
      }
    }
    
    const agent = await agentsRepo.findById(agentId);
    if (!agent || agent.tenantId !== tenant) {
      throw new Error('Agent not found or does not belong to this tenant');
    }
    
    const contributions = await contributionService.getPlayerContributions(
      agentId,
      new Date(periodFrom),
      new Date(periodTo),
      tenant
    );
    
    // Map to GraphQL types
    const directPlayers = contributions.directPlayers.map(p => ({
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
    
    const subAgents = contributions.subAgents.map(s => ({
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
    
    return {
      directPlayers,
      subAgents,
      totals: {
        directPL: contributions.totals.directPL,
        subAgentPL: contributions.totals.subAgentPL,
        directShare: contributions.totals.directShare,
        subAgentShare: contributions.totals.subAgentShare,
        directPlayersCount: contributions.totals.directPlayersCount,
        subAgentsCount: contributions.totals.subAgentsCount,
      },
    };
  },

  // Admin settlement history - returns all settlements (P&L + Commission) for tenant
  allSettlementHistory: async (_: any, args: any, ctx: any) => {
    // Agents are refused below with their own message; everyone else needs
    // settlements.center:view (this returned the tenant's history to anyone).
    if (ctx?.user?.type !== 'agent') requireSettlementRead(ctx);
    let tenant = getEffectiveTenantForDirector(ctx) ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');

    // Whitelabel Admin fallback: when tenant is 'default' (e.g. X-Whitelabel-ID header missing), use the logged-in user's tenant from DB so history is not empty
    const roles = Array.isArray(ctx?.user?.roles) ? ctx.user.roles : [];
    const isWhitelabelAdmin = roles.some((r: string) =>
      r === 'Whitelabel Admin' || String(r).toLowerCase() === 'whitelabel_admin' || String(r).toLowerCase().includes('whitelabel')
    );
    if (tenant === 'default' && isWhitelabelAdmin && (ctx?.user?.sub != null || ctx?.user?.id != null)) {
      const rawId = ctx.user.sub ?? ctx.user.id;
      const userId = typeof rawId === 'number' ? rawId : Number(rawId);
      if (Number.isFinite(userId)) {
        const { getTenantByUserId } = await import('../../../repos/users/usersRepo.js');
        const userTenant = await getTenantByUserId(userId);
        if (userTenant && String(userTenant).trim() !== '' && userTenant !== 'default') tenant = userTenant;
      }
    }

    if (ctx?.user?.type === 'agent') {
      throw new Error('Unauthorized: Agents cannot access all settlement history. Use the agent-specific query.');
    }

    const { agentSettlements } = await import('@shared/db/schema/agents');
    const { agentCredentials } = await import('@shared/db/schema/agents');
    
    const agentsRepo = new AgentsRepo();
    const skipTenant = shouldSkipTenantFiltering(ctx);
    const listTenant = skipTenant ? undefined : tenant;
    const allAgents = await agentsRepo.list(listTenant, skipTenant ? undefined : { directOnly: true });
    const agentIds = allAgents.map(a => a.id);
    
    if (agentIds.length === 0) {
      return [];
    }

    // Parse date filters once for both queries
    let fromDateFilter: Date | undefined;
    let toDateEndFilter: Date | undefined;
    if (args.fromDate) {
      const fromD = new Date(args.fromDate);
      if (!Number.isNaN(fromD.getTime())) fromDateFilter = fromD;
    }
    if (args.toDate) {
      const toDateEnd = new Date(args.toDate);
      if (!Number.isNaN(toDateEnd.getTime())) {
        toDateEnd.setUTCDate(toDateEnd.getUTCDate() + 1);
        toDateEndFilter = toDateEnd;
      }
    }

    // --- 1. Fetch P&L settlements from agent_settlements ---
    const plConditions: any[] = [inArray(agentSettlements.agentId, agentIds)];
    if (fromDateFilter) plConditions.push(gte(agentSettlements.createdAt, fromDateFilter));
    if (toDateEndFilter) plConditions.push(lt(agentSettlements.createdAt, toDateEndFilter));

    const plQuery = db
      .select()
      .from(agentSettlements)
      .where(and(...plConditions))
      .orderBy(desc(agentSettlements.createdAt));

    // --- 2. Fetch Commission payouts from commission_payouts ---
    const commissionRepo = new CommissionPayoutsRepo();
    const commissionParams: {
      tenant: string;
      fromDate?: Date;
      toDate?: Date;
    } = { tenant };
    if (fromDateFilter) commissionParams.fromDate = fromDateFilter;
    if (toDateEndFilter) commissionParams.toDate = toDateEndFilter;

    const [settlements, commissionPayoutsList] = await Promise.all([
      plQuery,
      commissionRepo.list(commissionParams),
    ]);

    // Only include commission payouts for agents in this tenant's agent list
    const agentIdSet = new Set(agentIds);
    const filteredCommissionPayouts = commissionPayoutsList.filter(cp => agentIdSet.has(cp.agentId));
    
    // Get agent credentials for usernames
    const credentials = agentIds.length > 0 ? await db
      .select()
      .from(agentCredentials)
      .where(inArray(agentCredentials.agentId, agentIds)) : [];
    
    const credentialMap = new Map(credentials.map(c => [c.agentId, c.username]));
    const agentMap = new Map(allAgents.map(a => [a.id, a]));
    
    const { AgentSettlementTransactionsRepo: TransactionsRepo } = await import('../../../repos/settlements/AgentSettlementTransactionsRepo');
    const transactionsRepo = new TransactionsRepo();

    // Map P&L settlements to response format
    const plResults = await Promise.all(
      settlements.map(async (s) => {
        const agent = agentMap.get(s.agentId);
        const periodFromDate = s.periodFrom instanceof Date ? s.periodFrom : new Date(s.periodFrom);
        const periodToDate = s.periodTo instanceof Date ? s.periodTo : new Date(s.periodTo);
        const settlementCreatedAt = s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt);

        const transaction = await transactionsRepo.getTransactionForSettlement({
          tenant: agent?.tenantId ?? tenant,
          agentId: s.agentId,
          settlementCreatedAt,
          settlementAmount: Number(s.totalAmount),
        });

        const totalAmount = Number(s.totalAmount);
        
        return {
          id: s.id,
          agentId: s.agentId,
          agent: agent ? {
            id: agent.id,
            username: credentialMap.get(agent.id) || null,
            schemeType: agent.schemeType,
          } : null,
          periodFrom: periodFromDate.toISOString(),
          periodTo: periodToDate.toISOString(),
          totalAmount,
          direction: totalAmount >= 0 ? 'TO_AGENT' : 'FROM_AGENT',
          status: s.status,
          currency: s.currency,
          notes: transaction?.notes || null,
          postedBy: s.postedBy || null,
          postedAt: s.postedAt ? (s.postedAt instanceof Date ? s.postedAt.toISOString() : s.postedAt) : null,
          createdAt: (s.createdAt instanceof Date ? s.createdAt : new Date(s.createdAt)).toISOString(),
        };
      })
    );

    // Map Commission payouts to the same SettlementHistoryItem shape
    const commissionResults = filteredCommissionPayouts.map((cp) => {
      const agent = agentMap.get(cp.agentId);
      const periodFrom = cp.periodFrom instanceof Date ? cp.periodFrom.toISOString()
        : cp.periodFrom ? new Date(cp.periodFrom + (String(cp.periodFrom).includes('T') ? '' : 'T00:00:00.000Z')).toISOString()
        : new Date(cp.createdAt).toISOString();
      const periodTo = cp.periodTo instanceof Date ? cp.periodTo.toISOString()
        : cp.periodTo ? new Date(cp.periodTo + (String(cp.periodTo).includes('T') ? '' : 'T00:00:00.000Z')).toISOString()
        : new Date(cp.createdAt).toISOString();
      const createdAtISO = cp.createdAt instanceof Date ? cp.createdAt.toISOString() : new Date(cp.createdAt).toISOString();

      return {
        id: cp.id,
        agentId: cp.agentId,
        agent: agent ? {
          id: agent.id,
          username: credentialMap.get(agent.id) || null,
          schemeType: agent.schemeType,
        } : null,
        periodFrom,
        periodTo,
        totalAmount: Number(cp.amount),
        direction: 'TO_AGENT',
        status: 'COMMISSION',
        currency: 'INR',
        notes: cp.notes || null,
        postedBy: cp.paidBy || null,
        postedAt: createdAtISO,
        createdAt: createdAtISO,
      };
    });

    // Merge both lists and sort by createdAt descending
    const merged = [...plResults, ...commissionResults].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply limit/offset on the merged result
    const offset = args.offset ?? 0;
    const limit = args.limit ?? merged.length;
    return merged.slice(offset, offset + limit);
  },
};

