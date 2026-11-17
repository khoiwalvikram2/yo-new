import { getCurrentWhitelabel, listWhitelabels } from '@/stores/whitelabelStore.js'
import { getDashboardKPIs, getDashboardTrends, getDashboardReportKPIs } from '@/services/dashboardService.js'
import { selectedDashboardFields } from '@/services/dashboardSelection.js'
import type { GraphQLResolveInfo } from 'graphql'
import { getPaymentAnalytics } from '@/services/paymentAnalyticsService.js'
import { getTopPerformers } from '@/services/rankingsService.js'
import { getAgentDeepDive } from '@/services/agentDeepDiveService.js'
import { getTimeAnalysis } from '@/services/timeAnalyticsService.js'
import { getFinancialForecast } from '@/services/forecastingService.js'
import { getEffectiveTenantForDirector, shouldSkipTenantFiltering } from '@/domains/common/directorModeUtils.js'
import { hasPermission } from '@/domains/common/auth.js'


/**
 * The Executive Dashboard's analytics (trends, payments, top performers, agent deep dive, time
 * analysis, forecast) read every player of the whitelabel. Agents hold overview.dashboard:view through
 * reporting:read, so they are refused here; their dashboard figures come from overviewKPIs, which is
 * scoped to their own players (services/agentDashboardKPIs.ts).
 */
function refuseAgentCaller(ctx: any): void {
  if (ctx?.user?.type === 'agent') {
    throw new Error('Forbidden: this dashboard analytics is not available to agents')
  }
}

/**
 * The insight cards' gate and scope, as dashboardOperations has them: overview.dashboard:view, no agents,
 * and the overviewKPIs tenant (undefined in director core mode, which means platform-wide).
 */
function dashboardInsightScope(ctx: any): { tenant?: string } {
  if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
    throw new Error('Forbidden: insufficient permissions to view dashboard')
  }
  refuseAgentCaller(ctx)
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const skipFiltering = shouldSkipTenantFiltering(ctx)
  return { tenant: skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default') }
}

/** The dashboard's DashboardDateRange argument as ISO strings. */
function dashboardRangeArg(args: any): { dateFrom?: string; dateTo?: string } {
  const text = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : undefined
  return { dateFrom: text(args?.dateRange?.dateFrom), dateTo: text(args?.dateRange?.dateTo) }
}

/** Who may read the brand's own chip pool: its credit line and the pool ledger. */
const POOL_STANDING: Array<[string, string]> = [['credit.management', 'view'], ['agents.credit', 'view']]
/** Who may read the brand's platform sharing terms (the Whitelabel type's sharingRates asks the same). */
const SHARING_STANDING: Array<[string, string]> = [['agents.sharing', 'view']]
/** Who may read the brand's own settlements (its root agents' and its own with the platform): the settlement centre's read. */
const SETTLEMENT_STANDING: Array<[string, string]> = [['settlements.center', 'view']]

/**
 * The gate on a whitelabel's own pool figures and sharing terms.
 *
 * These read only `ctx.tenant`, which comes from the X-Whitelabel-ID header with or without a session, and
 * checked nothing else. Measured: a request carrying only that header paged all 3,100 rows of grandwinn's pool
 * ledger, 3,086 of them naming a player and a phone number, and every agent (sub-agents and commission agents
 * included) read the same. The panel shows these only to the brand's own operators (the topbar wallet, the
 * /credit pool statement, the sports book's sharing rate), so that is who may read them: a session, never an
 * agent, and the standing the Whitelabel type's money fields ask for (mayReadWhitelabelMoney in index.ts).
 * Agents are refused by principal first because their flat `agents:view` grants the nested permissions below.
 */
function requireWhitelabelPoolReader(ctx: any, standing: Array<[string, string]>, what = 'the whitelabel pool'): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  if (ctx.user.type === 'agent') throw new Error(`Forbidden: ${what} is not available to agents`)
  const perms = ctx?.permissions ?? []
  if (hasPermission(perms, 'all', '*')) return
  if (!standing.some(([domain, action]) => hasPermission(perms, domain, action))) {
    throw new Error(`Forbidden: insufficient permissions to view ${what}`)
  }
}

export const commonQueryResolvers = {
  health: async () => 'ok',
  whitelabelCurrent: async (_: any, __: any, ctx: any) => getCurrentWhitelabel(ctx),
  whitelabels: async (_: any, __: any, ctx: any) => {
    // Measured: this returned every brand to a caller with NO SESSION at all.
    // The brand list is not sign-in branding — `whitelabelCurrent` and
    // `whitelabel(id)` serve that, for the host being addressed.
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')

    // Narrowing to one's own brand was decided by ROLE NAME, matching any name
    // containing "whitelabel". That is backwards for a restrictive test: a
    // brand admin whose role is named "Brand Manager" matched nothing and saw
    // every whitelabel. Platform-wide standing is a permission, so ask for it.
    if (hasPermission(ctx?.permissions ?? [], 'all', '*')) {
      return listWhitelabels()
    }

    // Everyone else sees the brand they are operating inside.
    const current = await getCurrentWhitelabel(ctx)
    return current ? [current] : []
  },

  myWhitelabelCredit: async (_parent: any, _args: any, ctx: any) => {
    requireWhitelabelPoolReader(ctx, POOL_STANDING)
    const tenant = ctx.tenant;
    if (!tenant) throw new Error('Tenant not found in context');

    const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
    const whitelabelCreditRepo = new WhitelabelCreditRepo();
    const credit = await whitelabelCreditRepo.getCreditFields(tenant);
    
    if (!credit) throw new Error('Whitelabel credit info not found');
    
    const usagePercentage = credit.creditLimit > 0 
      ? (credit.creditUsed / credit.creditLimit) * 100 
      : 0;
    const isNearLimit = usagePercentage >= credit.creditAlertThreshold;
    
    return { 
      ...credit, 
      usagePercentage: Math.round(usagePercentage * 100) / 100,
      isNearLimit 
    };
  },

  myWhitelabelCreditHistory: async (_parent: any, args: any, ctx: any) => {
    requireWhitelabelPoolReader(ctx, POOL_STANDING)
    const tenant = ctx.tenant;
    if (!tenant) throw new Error('Tenant not found in context');
    
    // Validate and normalize pagination parameters
    let validatedLimit: number = 50; // Default limit
    let validatedOffset: number = 0; // Default offset
    
    if (args.limit !== undefined && args.limit !== null) {
      const limitNum = Number(args.limit);
      if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
        throw new Error('limit must be a positive integer');
      }
      validatedLimit = Math.min(Math.max(limitNum, 1), 1000);
    }
    
    if (args.offset !== undefined && args.offset !== null) {
      const offsetNum = Number(args.offset);
      if (!Number.isFinite(offsetNum) || !Number.isInteger(offsetNum) || offsetNum < 0) {
        throw new Error('offset must be a non-negative integer');
      }
      validatedOffset = offsetNum;
    }
    
    const { AgentCreditLedgerRepo } = await import('@src/repos/agents/AgentCreditLedgerRepo.js');
    const ledgerRepo = new AgentCreditLedgerRepo();
    
    const transactions = await ledgerRepo.getTransactionsByEntity({
      entityType: 'whitelabel',
      entityId: tenant,
      limit: validatedLimit,
      offset: validatedOffset,
      tenantId: tenant,
    });
    
    // Helper to extract player ID from reason text (e.g. "player 22", "Player ID: 22", "userId=22")
    const parsePlayerIdFromReason = (reason: string | null): number | null => {
      if (!reason || typeof reason !== 'string') return null;
      const playerMatch = reason.match(/\bplayer\s+(\d+)\b/i);
      if (playerMatch) return parseInt(playerMatch[1], 10);
      const idMatch = reason.match(/\bPlayer ID:\s*(\d+)/i);
      if (idMatch) return parseInt(idMatch[1], 10);
      const userIdMatch = reason.match(/\buserId[=:]?\s*(\d+)/i);
      if (userIdMatch) return parseInt(userIdMatch[1], 10);
      return null;
    };
    // Extract "Deposit Request #32" / "Withdrawal Request #5" request ids from reason
    const parseDepositRequestIdFromReason = (reason: string | null): number | null => {
      if (!reason || typeof reason !== 'string') return null;
      const m = reason.match(/Deposit Request #(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    };
    const parseWithdrawalRequestIdFromReason = (reason: string | null): number | null => {
      if (!reason || typeof reason !== 'string') return null;
      const m = reason.match(/Withdrawal Request #(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    };
    
    const playerIds = new Set<number>();
    const depositRequestIds = new Set<number>();
    const withdrawalRequestIds = new Set<number>();
    for (const t of transactions) {
      const meta = (t.meta as any) || {};
      const metadata = (t.metadata as any) || {};
      let id: number | null = meta.playerId ? Number(meta.playerId) : null;
      if (!id && metadata.relatedPlayerId != null) id = Number(metadata.relatedPlayerId);
      if (!id) id = parsePlayerIdFromReason(t.reason);
      if (id != null && Number.isFinite(id)) playerIds.add(id);
      const drId = parseDepositRequestIdFromReason(t.reason);
      if (drId != null && Number.isFinite(drId)) depositRequestIds.add(drId);
      const wrId = parseWithdrawalRequestIdFromReason(t.reason);
      if (wrId != null && Number.isFinite(wrId)) withdrawalRequestIds.add(wrId);
    }
    
    const { getDepositRequestById } = await import('@src/repos/deposits/depositRequestsRepo.js');
    const depositRequestIdToUserId = new Map<number, number>();
    for (const reqId of depositRequestIds) {
      const req = await getDepositRequestById(reqId, tenant);
      if (req?.userId != null) {
        depositRequestIdToUserId.set(reqId, req.userId);
        playerIds.add(req.userId);
      }
    }
    const { getWithdrawalRequestById } = await import('@src/repos/payments/withdrawalRequestsRepo.js');
    const withdrawalRequestIdToUserId = new Map<number, number>();
    for (const reqId of withdrawalRequestIds) {
      const req = await getWithdrawalRequestById(reqId, tenant);
      if (req?.userId != null) {
        withdrawalRequestIdToUserId.set(reqId, req.userId);
        playerIds.add(req.userId);
      }
    }
    
    const { getUsersByIdsForExclusion } = await import('@src/repos/users/usersRepo.js');
    const userIds = [...playerIds];
    const usersList = userIds.length ? await getUsersByIdsForExclusion(userIds, tenant) : [];
    const userMap = new Map(usersList.map((u) => [u.id, u]));
    
    // Parse campaignId from reasons like "Instant cash bonus - awardId=40 campaignId=3"
    const campaignIdFromReason = (reason: string | null): number | null => {
      if (!reason || typeof reason !== 'string') return null;
      const m = reason.match(/campaignId=(\d+)/i);
      return m ? parseInt(m[1], 10) : null;
    };
    const campaignIds = new Set<number>();
    for (const t of transactions) {
      const cid = campaignIdFromReason(t.reason);
      if (cid != null && Number.isFinite(cid)) campaignIds.add(cid);
    }
    const { getBonusCampaignDb } = await import('@src/repos/marketing/bonusesRepo.js');
    const campaignMap = new Map<number, { name: string }>();
    for (const cid of campaignIds) {
      const campaign = await getBonusCampaignDb(cid, tenant);
      if (campaign?.name) campaignMap.set(cid, { name: campaign.name });
    }
    
    // Safe format: "Name (phone)" or "Name" or "phone" or "User #id". Handles null/empty name and phone.
    const formatUserLabel = (u: { name?: string | null; phone?: string | null } | undefined, fallbackId: number | null): string => {
      if (!u) return fallbackId != null ? `User #${fallbackId}` : '';
      const name = (u.name != null && String(u.name).trim()) ? String(u.name).trim() : null;
      const phone = (u.phone != null && String(u.phone).trim()) ? String(u.phone).trim() : null;
      if (name && phone) return `${name} (${phone})`;
      if (name) return name;
      if (phone) return phone;
      return fallbackId != null ? `User #${fallbackId}` : '';
    };
    
    const alreadyHasUserInReason = (r: string) => r != null && r.includes(' - User:');
    
    return transactions.map(t => {
      const meta = (t.meta as any) || {};
      const metadata = (t.metadata as any) || {};
      let playerId: number | null = meta.playerId ? Number(meta.playerId) : null;
      if (!playerId && metadata.relatedPlayerId != null) playerId = Number(metadata.relatedPlayerId);
      if (!playerId) playerId = parsePlayerIdFromReason(t.reason);
      if (playerId != null && !Number.isFinite(playerId)) playerId = null;
      
      const user = playerId != null ? userMap.get(playerId) : undefined;
      const playerName = meta.playerName ?? user?.name ?? null;
      const playerEmail = meta.playerEmail ?? user?.email ?? null;
      const playerUsername = meta.playerUsername ?? user?.username ?? null;
      const playerPhone = user?.phone ?? null;
      
      let displayReason = t.reason ?? null;
      // Enrich "Instant cash bonus - awardId=X campaignId=Y" (and similar) with campaign name + user name/phone
      if (displayReason && /awardId=\d+\s*campaignId=\d+/i.test(displayReason)) {
        const cid = campaignIdFromReason(displayReason);
        const campaign = cid != null ? campaignMap.get(cid) : undefined;
        const userLabel = formatUserLabel(user ?? undefined, playerId);
        const part = campaign && userLabel
          ? `Campaign: ${campaign.name}, User: ${userLabel}`
          : campaign
            ? `Campaign: ${campaign.name}${userLabel ? `, User: ${userLabel}` : ''}`
            : userLabel
              ? `User: ${userLabel}`
              : null;
        if (part) {
          displayReason = displayReason.replace(/\s*-\s*awardId=\d+\s*campaignId=\d+/i, ` - ${part}`);
        }
      }
      // Replace "player 22" / "Player ID: 22" with "Name (phone)" when we have user info
      let didReplacePlayerInReason = false;
      if (displayReason && playerId != null && user) {
        const label = formatUserLabel(user, playerId);
        const before = displayReason;
        displayReason = displayReason
          .replace(new RegExp(`\\bplayer\\s+${playerId}\\b`, 'gi'), label)
          .replace(new RegExp(`Player ID:\\s*${playerId}`, 'gi'), `Player: ${label}`);
        if (displayReason !== before) didReplacePlayerInReason = true;
      }
      // "Player deposit approved - Deposit Request #32" -> append user name and number for that request
      const depositReqId = parseDepositRequestIdFromReason(displayReason ?? t.reason);
      if (depositReqId != null && displayReason && !alreadyHasUserInReason(displayReason)) {
        const uid = depositRequestIdToUserId.get(depositReqId);
        const depositUser = uid != null ? userMap.get(uid) : undefined;
        if (depositUser) {
          const userLabel = formatUserLabel(depositUser, uid ?? null);
          if (userLabel) displayReason = displayReason + ` - User: ${userLabel}`;
        }
      }
      // "Player withdrawal completed - Withdrawal Request #5" -> append user name and number for that request
      const withdrawalReqId = parseWithdrawalRequestIdFromReason(displayReason ?? t.reason);
      if (withdrawalReqId != null && displayReason && !alreadyHasUserInReason(displayReason)) {
        const uid = withdrawalRequestIdToUserId.get(withdrawalReqId);
        const withdrawalUser = uid != null ? userMap.get(uid) : undefined;
        if (withdrawalUser) {
          const userLabel = formatUserLabel(withdrawalUser, uid ?? null);
          if (userLabel) displayReason = displayReason + ` - User: ${userLabel}`;
        }
      }
      // Any other reason: if we have a user and reason doesn't show user yet (and we didn't already replace player id in text), append name and phone
      if (displayReason && playerId != null && user && !alreadyHasUserInReason(displayReason) && !didReplacePlayerInReason) {
        const userLabel = formatUserLabel(user, playerId);
        if (userLabel) displayReason = displayReason + ` - User: ${userLabel}`;
      }
      
      return {
        id: t.id,
        transactionType: t.transactionType,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        reason: displayReason != null ? displayReason : t.reason,
        createdBy: t.createdBy,
        createdByType: t.createdByType,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.createdAt.toISOString(),
        playerId,
        playerName,
        playerEmail,
        playerUsername,
        playerPhone,
      };
    });
  },

  myWhitelabelSettlements: async (_parent: any, args: any, ctx: any) => {
    // Scoped to the caller's own tenant. With no session `ctx.tenant` fell back to the default whitelabel and the
    // rows came back anyway; after that, any session read them, every agent included (SCO-09). It lists the root
    // agents' settlements (usernames, amounts) and the brand's own with the platform, so it asks what its siblings
    // ask: a session, never an agent, and the settlement centre's read. No admin page calls it (measured).
    requireWhitelabelPoolReader(ctx, SETTLEMENT_STANDING, 'the whitelabel settlements')
    const tenant = ctx.tenant;
    if (!tenant) throw new Error('Tenant not found in context');
    
    // Validate and normalize pagination parameters
    let validatedLimit: number = 50; // Default limit
    let validatedOffset: number = 0; // Default offset
    
    if (args.limit !== undefined && args.limit !== null) {
      const limitNum = Number(args.limit);
      if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
        throw new Error('limit must be a positive integer');
      }
      // Clamp to maximum limit to prevent excessive queries (consistent with other queries)
      validatedLimit = Math.min(Math.max(limitNum, 1), 1000); // Between 1 and 1000
    }
    
    if (args.offset !== undefined && args.offset !== null) {
      const offsetNum = Number(args.offset);
      if (!Number.isFinite(offsetNum) || !Number.isInteger(offsetNum) || offsetNum < 0) {
        throw new Error('offset must be a non-negative integer');
      }
      validatedOffset = offsetNum;
    }
    
    // Get only DIRECT agent settlements (agents whose parentAgentId is NULL - top-level under whitelabel)
    const { AgentSettlementTransactionsRepo } = await import('@src/repos/settlements/AgentSettlementTransactionsRepo.js');
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
    const agentsRepo = new AgentsRepo();
    const directAgentIds = await agentsRepo.listRootAgentIds(tenant);
    
    const agentSettlementsRepo = new AgentSettlementTransactionsRepo();
    const agentSettlements = directAgentIds.length > 0
      ? await agentSettlementsRepo.list({ tenant, agentIds: directAgentIds, limit: validatedLimit, offset: Math.max(0, args.agentOffset ?? validatedOffset) })
      : [];
    
    // Get whitelabel-to-director settlements (from agent_credit_ledger)
    const { AgentCreditLedgerRepo } = await import('@src/repos/agents/AgentCreditLedgerRepo.js');
    const ledgerRepo = new AgentCreditLedgerRepo();
    const whitelabelSettlements = await ledgerRepo.getSettlementsByEntity({
      entityType: 'whitelabel',
      entityId: tenant,
      limit: validatedLimit,
      offset: Math.max(0, args.whitelabelOffset ?? validatedOffset),
      tenantId: tenant,
    });
    
    const { db: summaryDb } = await import('@src/db/client.js')
    const { agentSettlementTransactions: settlementRows, agentCreditLedger: creditRows } = await import('@shared/db/schema.js')
    const { and, or, eq, inArray, sql } = await import('drizzle-orm')
    const none = { count: 0, amount: 0 }
    const [agentSummary, whitelabelSummary] = await Promise.all([
      directAgentIds.length ? summaryDb.select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${settlementRows.amount}),0)` })
        .from(settlementRows).where(and(eq(settlementRows.tenant,tenant),inArray(settlementRows.agentId,directAgentIds))).then(rows=>rows[0] ?? none) : none,
      summaryDb.select({ count: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${creditRows.amount}),0)` }).from(creditRows)
        .where(and(eq(creditRows.tenantId,tenant),eq(creditRows.transactionType,'ADJUSTMENT'),sql`${creditRows.reason} ilike '%settlement%'`,
          or(and(eq(creditRows.fromEntityType,'whitelabel'),eq(creditRows.fromEntityId,tenant)),and(eq(creditRows.toEntityType,'whitelabel'),eq(creditRows.toEntityId,tenant)))))
        .then(rows=>rows[0] ?? none),
    ])
    const totalAgentSettled = Number(agentSummary.amount), totalWhitelabelSettled = Number(whitelabelSummary.amount)

    // Enrich with agent data (names, usernames) for agentId and settledBy
    const allAgentIds = [
      ...new Set([
        ...agentSettlements.map(s => s.agentId),
        ...agentSettlements.map(s => s.settledBy).filter(Boolean),
      ])
    ] as string[];
    
    let agentMap = new Map<string, { id: string; username: string | null; schemeType: string | null }>();
    if (allAgentIds.length > 0) {
      const { agents } = await import('@shared/db/schema.js');
      const { agentCredentials } = await import('@shared/db/schema/agents.js');
      const { db } = await import('@src/db/client.js');
      const { inArray } = await import('drizzle-orm');
      
      const agentData = await db
        .select({ id: agents.id, schemeType: agents.schemeType })
        .from(agents)
        .where(inArray(agents.id, allAgentIds));
      
      const credentials = await db
        .select()
        .from(agentCredentials)
        .where(inArray(agentCredentials.agentId, allAgentIds));
      
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

    return { 
      agentCount: agentSummary.count, whitelabelCount: whitelabelSummary.count,
      agentSettlements: agentSettlements.map(s => ({
        id: s.id,
        tenant: s.tenant,
        agentId: s.agentId,
        agent: agentMap.get(s.agentId) || null,
        settlementType: s.settlementType,
        amount: Number(s.amount || 0),
        direction: s.direction,
        previousBalance: s.previousBalance ? Number(s.previousBalance) : null,
        newBalance: s.newBalance ? Number(s.newBalance) : null,
        notes: s.notes,
        settledBy: s.settledBy ? (agentMap.get(s.settledBy)?.username || s.settledBy) : null,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : s.createdAt.toISOString(),
      })),
      whitelabelSettlements: whitelabelSettlements.map(t => ({
        id: t.id,
        transactionType: t.transactionType,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
        reason: t.reason,
        createdBy: t.createdBy,
        createdByType: t.createdByType,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : t.createdAt.toISOString(),
      })),
      totalAgentSettled, 
      totalWhitelabelSettled 
    };
  },

  myAgentSettlements: async (_parent: any, args: any, ctx: any) => {
    // Scoped to the caller's own agent and holds no permission on purpose,
    // but it never checked there was a caller: with no session `ctx.tenant`
    // falls back to the default whitelabel and the rows come back anyway.
    if (!ctx?.user) throw new Error('Unauthorized: authentication required')
    // Check if user is agent
    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      throw new Error('Unauthorized: Only agents can access their settlement information');
    }
    
    // Validate and normalize pagination parameters
    let validatedLimit: number = 50; // Default limit
    let validatedOffset: number = 0; // Default offset
    
    if (args.limit !== undefined && args.limit !== null) {
      const limitNum = Number(args.limit);
      if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1) {
        throw new Error('limit must be a positive integer');
      }
      // Clamp to maximum limit to prevent excessive queries (consistent with other queries)
      validatedLimit = Math.min(Math.max(limitNum, 1), 1000); // Between 1 and 1000
    }
    
    if (args.offset !== undefined && args.offset !== null) {
      const offsetNum = Number(args.offset);
      if (!Number.isFinite(offsetNum) || !Number.isInteger(offsetNum) || offsetNum < 0) {
        throw new Error('offset must be a non-negative integer');
      }
      validatedOffset = offsetNum;
    }
    
    const agentId = ctx.user.agentId;
    
    // Get agent info to get tenant
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    
    const tenant = agent.tenantId;
    
    const { AgentSettlementTransactionsRepo } = await import('@src/repos/settlements/AgentSettlementTransactionsRepo.js');
    const agentSettlementsRepo = new AgentSettlementTransactionsRepo();
    const directChildren = await agentsRepo.listChildren(agentId);
    const directChildIds = directChildren.map(c => c.id);
    
    // The agent's own settlements (with its parent or the platform) as well as those of its
    // DIRECT sub-agents (the ones it settles). Before, an agent never saw its own settlements here.
    const agentSettlements = await agentSettlementsRepo.list({
      tenant,
      agentIds: [String(agentId), ...directChildIds],
      limit: validatedLimit,
      offset: validatedOffset,
    });
    
    // Get credit transactions related to settlements
    const { AgentCreditLedgerRepo } = await import('@src/repos/agents/AgentCreditLedgerRepo.js');
    const ledgerRepo = new AgentCreditLedgerRepo();
    const creditTransactions = await ledgerRepo.getSettlementsByEntity({
      entityType: 'agent',
      entityId: agentId,
      limit: validatedLimit,
      offset: validatedOffset,
      tenantId: tenant,
    });
    
    // Note: These totals are calculated from paginated results, so they represent totals for the current page only
    // For accurate totals across all records, a separate aggregation query would be needed
    const totalAgentSettled = agentSettlements.reduce((sum, s) => sum + Number(s.amount), 0);
    const totalCreditTransactions = creditTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
    
    return { 
      agentSettlements: agentSettlements.map(s => ({
        id: s.id,
        tenant: s.tenant,
        agentId: s.agentId,
        settlementType: s.settlementType,
        amount: Number(s.amount),
        direction: s.direction,
        previousBalance: s.previousBalance ? Number(s.previousBalance) : null,
        newBalance: s.newBalance ? Number(s.newBalance) : null,
        notes: s.notes,
        settledBy: s.settledBy,
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : s.createdAt.toISOString(),
      })),
      creditTransactions: creditTransactions.map(t => ({
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
      })),
      totalAgentSettled, 
      totalCreditTransactions 
    };
  },

  myAgentSharing: async (_parent: any, _args: any, ctx: any) => {
    // Check if user is agent
    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      throw new Error('Unauthorized: Only agents can access their sharing information');
    }
    
    const agentId = ctx.user.agentId;
    
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
    const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js');
    const { AgentLedgerRepo } = await import('@src/repos/agents/AgentLedgerRepo.js');
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    const ledgerRepo = new AgentLedgerRepo();
    
    // Get agent info
    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    
    // Validate agent is SHARING or CREDIT type
    if (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT') {
      throw new Error('Sharing information is only available for SHARING or CREDIT scheme agents');
    }
    
    // Get sharing rates
    const now = new Date();
    const sharingRates = [];
    const allowedDomains = agent.allowedDomains || [];
    for (const domain of allowedDomains) {
      try {
        const config = await configsRepo.getSharingConfig(agent.id, domain as 'sports' | 'casino' | 'matka', now);
        if (config) {
          const rate = Number(config.shareRate);
          if (Number.isFinite(rate) && rate >= 0) {
            sharingRates.push({
              domain,
              rate: rate * 100, // Convert to percentage
            });
          }
        }
      } catch (err) {
        // Continue with other domains
      }
    }
    
    // Get all-time totals
    const allTimeTotals = await ledgerRepo.getAllTimeTotalsByType(agentId, 'SHARE');
    
    // Get current period totals (current month, timezone-aware)
    const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
    const { getStartOfMonth, getEndOfMonth } = await import('@src/shared/dateUtils.js');
    const tz = await getWhitelabelTimezone(agent.tenantId);
    const periodFrom = getStartOfMonth(tz);
    const periodTo = getEndOfMonth(tz);
    const currentPeriodTotals = await ledgerRepo.getCurrentPeriodTotalsByType(agentId, 'SHARE', periodFrom, periodTo);
    
    // Get currency from whitelabel
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(agent.tenantId);
    
    // Ensure all domains are represented (sports, casino, matka)
    const allDomains = ['sports', 'casino', 'matka'] as const;
    const allTimeTotalsMap = new Map(allTimeTotals.map(t => [t.domain, t.totalAmount]));
    const currentPeriodTotalsMap = new Map(currentPeriodTotals.map(t => [t.domain, t.totalAmount]));
    
    return {
      sharingRates,
      allTimeTotals: allDomains.map(domain => ({
        domain,
        totalAmount: allTimeTotalsMap.get(domain) || 0,
      })),
      currentPeriodTotals: allDomains.map(domain => ({
        domain,
        totalAmount: currentPeriodTotalsMap.get(domain) || 0,
      })),
      currency,
    };
  },

  myAgentCommission: async (_parent: any, _args: any, ctx: any) => {
    // Check if user is agent
    if (ctx?.user?.type !== 'agent' || !ctx?.user?.agentId) {
      throw new Error('Unauthorized: Only agents can access their commission information');
    }
    
    const agentId = ctx.user.agentId;
    
    const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js');
    const { AgentConfigsRepo } = await import('@src/repos/agents/AgentConfigsRepo.js');
    const { AgentLedgerRepo } = await import('@src/repos/agents/AgentLedgerRepo.js');
    const agentsRepo = new AgentsRepo();
    const configsRepo = new AgentConfigsRepo();
    const ledgerRepo = new AgentLedgerRepo();
    
    // Get agent info
    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }
    
    // Validate agent is COMMISSION type
    if (agent.schemeType !== 'COMMISSION') {
      throw new Error('Commission information is only available for COMMISSION scheme agents');
    }
    
    // Get currency from whitelabel first (needed for commission summary)
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(agent.tenantId);

    // Use same commission calculation as dashboard (report-aligned GGR, effective totals, tally rules)
    const { CommissionCalculationService } = await import('@src/domains/agents/services/CommissionCalculationService.js');
    const { HybridGGRReader } = await import('@src/domains/agents/services/HybridGGRReader.js');
    const { CommissionPayoutsRepo } = await import('@src/repos/settlements/CommissionPayoutsRepo.js');
    const ggrReader = new HybridGGRReader();
    const payoutsRepo = new CommissionPayoutsRepo();
    const commissionService = new CommissionCalculationService(agentsRepo, configsRepo, ledgerRepo, ggrReader, payoutsRepo);

    const { getCurrentCycleIST } = await import('@src/domains/agents/services/CommissionCycleUtils.js');
    const { from: periodFrom, to: periodTo } = getCurrentCycleIST();
    const [summaryCurrent, summaryAllTime] = await Promise.all([
      commissionService.calculateCommissionSummary(agentId, periodFrom, periodTo, currency),
      commissionService.calculateCommissionSummary(agentId, new Date(0), new Date(), currency),
    ]);

    const allDomains = ['sports', 'casino', 'matka'] as const;
    const currentPeriodTotals = allDomains.map((domain) => ({
      domain,
      totalAmount: domain === 'sports' ? summaryCurrent.effectiveSportsCommission : domain === 'casino' ? summaryCurrent.effectiveCasinoCommission : summaryCurrent.effectiveMatkaCommission,
    }));
    const allTimeTotals = allDomains.map((domain) => ({
      domain,
      totalAmount: domain === 'sports' ? summaryAllTime.effectiveSportsCommission : domain === 'casino' ? summaryAllTime.effectiveCasinoCommission : summaryAllTime.effectiveMatkaCommission,
    }));

    // Commission rates (percentage) from config
    const now = new Date();
    const commissionRates: Array<{ domain: string; rate: number }> = [];
    const allowedDomains = agent.allowedDomains?.length ? agent.allowedDomains : allDomains;
    for (const domain of allowedDomains) {
      try {
        const config = await configsRepo.getCommissionConfig(agent.id, domain as 'sports' | 'casino' | 'matka', now);
        if (config) {
          const rate = Number(config.commissionRate);
          commissionRates.push({
            domain,
            rate: Number.isFinite(rate) && rate >= 0 ? rate * 100 : 0,
          });
        }
      } catch {
        // Continue with other domains
      }
    }
    if (commissionRates.length === 0) {
      for (const domain of allDomains) {
        commissionRates.push({ domain, rate: 0 });
      }
    }

    return {
      commissionRates,
      allTimeTotals,
      currentPeriodTotals,
      currency,
    };
  },

  myWhitelabelSharing: async (_parent: any, _args: any, ctx: any) => {
    requireWhitelabelPoolReader(ctx, SHARING_STANDING)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const { getEffectiveTenantForDirector } = await import('@src/domains/common/directorModeUtils.js');
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const whitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? ctx?.tenant ?? 'default');
    
    if (!whitelabelId || whitelabelId === 'default') {
      throw new Error('Whitelabel ID is required');
    }
    
    const { getWhitelabelSharingConfig, getWhitelabelAllTimeSharingTotals, getWhitelabelCurrentPeriodSharingTotals } = await import('@src/repos/common/whitelabelRepo.js');
    const now = new Date();
    
    // Get sharing rates
    const sharingRates = [];
    for (const domain of ['sports', 'casino', 'matka'] as const) {
      try {
        const config = await getWhitelabelSharingConfig(whitelabelId, domain, now);
        if (config) {
          const rate = Number(config.shareRate);
          if (Number.isFinite(rate) && rate >= 0) {
            sharingRates.push({
              domain,
              rate: rate * 100, // Convert to percentage
            });
          } else {
            sharingRates.push({
              domain,
              rate: 0,
            });
          }
        } else {
          sharingRates.push({
            domain,
            rate: 0,
          });
        }
      } catch (err) {
        // Default to 0 rate on error
        sharingRates.push({
          domain,
          rate: 0,
        });
      }
    }
    
    // Get all-time totals
    const allTimeTotals = await getWhitelabelAllTimeSharingTotals(whitelabelId);
    
    // Get current period totals (current month, timezone-aware)
    const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js');
    const { getStartOfMonth, getEndOfMonth } = await import('@src/shared/dateUtils.js');
    const tzWl = await getWhitelabelTimezone(whitelabelId);
    const periodFromWl = getStartOfMonth(tzWl);
    const periodToWl = getEndOfMonth(tzWl);
    const currentPeriodTotals = await getWhitelabelCurrentPeriodSharingTotals(whitelabelId, periodFromWl, periodToWl);
    
    // Get currency from whitelabel
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(whitelabelId);
    
    // Ensure all domains are represented
    const allDomains = ['sports', 'casino', 'matka'] as const;
    const allTimeTotalsMap = new Map(allTimeTotals.map(t => [t.domain, t.totalAmount]));
    const currentPeriodTotalsMap = new Map(currentPeriodTotals.map(t => [t.domain, t.totalAmount]));
    
    return {
      sharingRates,
      allTimeTotals: allDomains.map(domain => ({
        domain,
        totalAmount: allTimeTotalsMap.get(domain) || 0,
      })),
      currentPeriodTotals: allDomains.map(domain => ({
        domain,
        totalAmount: currentPeriodTotalsMap.get(domain) || 0,
      })),
      currency,
    };
  },
  
  // Enhanced Dashboard Analytics (all require overview.dashboard:view)
  paymentAnalytics: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    try {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          dateRange.dateFrom = args.dateRange.dateFrom instanceof Date
            ? args.dateRange.dateFrom.toISOString()
            : String(args.dateRange.dateFrom || '');
        }
        if (args.dateRange.dateTo) {
          dateRange.dateTo = args.dateRange.dateTo instanceof Date
            ? args.dateRange.dateTo.toISOString()
            : String(args.dateRange.dateTo || '');
        }
      }
      return await getPaymentAnalytics(tenant, dateRange)
    } catch (error: any) {
      throw error;
    }
  },
  
  topPerformers: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    try {
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const limit = args?.limit || 10
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          dateRange.dateFrom = args.dateRange.dateFrom instanceof Date
            ? args.dateRange.dateFrom.toISOString()
            : String(args.dateRange.dateFrom || '');
        }
        if (args.dateRange.dateTo) {
          dateRange.dateTo = args.dateRange.dateTo instanceof Date
            ? args.dateRange.dateTo.toISOString()
            : String(args.dateRange.dateTo || '');
        }
      }
      const whitelabelId = directorTenant ?? ctx?.whitelabel?.id
      return await getTopPerformers(tenant, dateRange, limit, whitelabelId)
    } catch (error: any) {
      throw error;
    }
  },
  
  agentDeepDive: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    try {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          dateRange.dateFrom = args.dateRange.dateFrom instanceof Date
            ? args.dateRange.dateFrom.toISOString()
            : String(args.dateRange.dateFrom || '');
        }
        if (args.dateRange.dateTo) {
          dateRange.dateTo = args.dateRange.dateTo instanceof Date
            ? args.dateRange.dateTo.toISOString()
            : String(args.dateRange.dateTo || '');
        }
      }
      return await getAgentDeepDive(tenant, dateRange)
    } catch (error: any) {
      throw error;
    }
  },
  
  timeAnalysis: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    try {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          dateRange.dateFrom = args.dateRange.dateFrom instanceof Date
            ? args.dateRange.dateFrom.toISOString()
            : String(args.dateRange.dateFrom || '');
        }
        if (args.dateRange.dateTo) {
          dateRange.dateTo = args.dateRange.dateTo instanceof Date
            ? args.dateRange.dateTo.toISOString()
            : String(args.dateRange.dateTo || '');
        }
      }
      return await getTimeAnalysis(tenant, dateRange)
    } catch (error: any) {
      throw error;
    }
  },
  
  financialForecast: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    try {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          dateRange.dateFrom = args.dateRange.dateFrom instanceof Date
            ? args.dateRange.dateFrom.toISOString()
            : String(args.dateRange.dateFrom || '');
        }
        if (args.dateRange.dateTo) {
          dateRange.dateTo = args.dateRange.dateTo instanceof Date
            ? args.dateRange.dateTo.toISOString()
            : String(args.dateRange.dateTo || '');
        }
      }
      return await getFinancialForecast(tenant, dateRange)
    } catch (error: any) {
      throw error;
    }
  },
  overviewKPIs: async (_: any, args: any, ctx: any, info?: GraphQLResolveInfo) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    try {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      // For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const skipFiltering = shouldSkipTenantFiltering(ctx)
      
      // In core mode, skip tenant filtering (return platform-wide data or empty)
      // In whitelabel mode, use selected whitelabel
      const tenant = skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
      const whitelabelId = skipFiltering ? undefined : (directorTenant ?? ctx?.whitelabel?.id)
      
      // Safely extract dateRange, ensuring all values are strings or undefined
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          // If it's a Date object, convert to ISO string; if it's already a string, use it
          const fromValue = args.dateRange.dateFrom;
          dateRange.dateFrom = fromValue instanceof Date 
            ? fromValue.toISOString() 
            : (typeof fromValue === 'string' ? fromValue : String(fromValue));
        }
        if (args.dateRange.dateTo) {
          const toValue = args.dateRange.dateTo;
          dateRange.dateTo = toValue instanceof Date 
            ? toValue.toISOString() 
            : (typeof toValue === 'string' ? toValue : String(toValue));
        }
      }
      
      // An agent gets its own players' figures, never the whitelabel's dashboard.
      // getDashboardKPIs is the operator's view (every player's money, pending
      // approvals, the commission bill); the agent portal's Nth D/W and Player
      // Activity pages read this query. See services/agentDashboardKPIs.ts.
      if (ctx?.user?.type === 'agent') {
        const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
        // An agent session without an agent id cannot be scoped; fail closed.
        if (!agentId) throw new Error('Forbidden: agent session has no agent id')
        const agentTenant = tenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
        const { getAgentDashboardKPIs } = await import('@/services/agentDashboardKPIs.js')
        return await getAgentDashboardKPIs({ tenant: agentTenant, whitelabelId: whitelabelId ?? agentTenant, agentId }, dateRange)
      }

      const report = await getDashboardReportKPIs(tenant, whitelabelId, dateRange, selectedDashboardFields(info))
      if (report !== null) return report

      const result = await getDashboardKPIs(tenant, whitelabelId, dateRange)

      return result
    } catch (error: any) {
      throw error;
    }
  },
  dashboardTrends: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    refuseAgentCaller(ctx)
    // CRITICAL: For Director Admin, use effective tenant based on mode
    // For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    
    // In core mode, skip tenant filtering (return platform-wide data or empty)
    // In whitelabel mode, use selected whitelabel
    const tenant = skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const whitelabelId = skipFiltering ? undefined : (directorTenant ?? ctx?.whitelabel?.id)
    
    try {
      
      // Safely extract dateRange, ensuring all values are strings or undefined
      const dateRange: { dateFrom?: string; dateTo?: string } = {}
      if (args?.dateRange) {
        if (args.dateRange.dateFrom) {
          const fromValue = args.dateRange.dateFrom;
          dateRange.dateFrom = fromValue instanceof Date 
            ? fromValue.toISOString() 
            : (typeof fromValue === 'string' ? fromValue : String(fromValue));
        }
        if (args.dateRange.dateTo) {
          const toValue = args.dateRange.dateTo;
          dateRange.dateTo = toValue instanceof Date 
            ? toValue.toISOString() 
            : (typeof toValue === 'string' ? toValue : String(toValue));
        }
      }
      
      return await getDashboardTrends(tenant, whitelabelId, dateRange)
    } catch (error: any) {
      throw error;
    }
  },
  // The Overview's operations sections (the owner's list, 2026-10-29). Admins only: an agent has its own
  // home, and these figures are the whitelabel's, so an agent is refused rather than shown them.
  dashboardOperations: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    if (ctx?.user?.type === 'agent') {
      throw new Error('Forbidden: the dashboard operations are not available to agents')
    }
    // Same tenant resolution as overviewKPIs: undefined in director core mode, which means platform-wide.
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const text = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : undefined
    const { getDashboardOperations } = await import('@/services/dashboardOperationsService.js')
    return getDashboardOperations({ tenant }, { dateFrom: text(args?.dateRange?.dateFrom), dateTo: text(args?.dateRange?.dateTo) })
  },
  // The dashboard's insight cards, one query per tab (Overview, Players, Financial). Same gate and tenant
  // resolution as dashboardOperations; the Overview's risk events also need the exposure permission.
  dashboardInsights: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const includeRisk = hasPermission(ctx?.permissions ?? [], 'reporting.exposure', 'view')
    const { getDashboardInsights } = await import('@/services/dashboardInsightsService.js')
    return getDashboardInsights(scope, dashboardRangeArg(args), { includeRisk })
  },
  dashboardPlayerRetention: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getPlayerRetention } = await import('@/services/dashboardInsightsService.js')
    return getPlayerRetention(scope, dashboardRangeArg(args))
  },
  dashboardFinancialInsights: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getFinancialInsights } = await import('@/services/dashboardInsightsService.js')
    return getFinancialInsights(scope, dashboardRangeArg(args))
  },
  // The Players, Agents and Time tabs, rebuilt on real data (2026-10-29). Same gate and scope as the
  // insight cards above.
  dashboardPlayersTab: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getPlayersTab } = await import('@/services/dashboardTabsService.js')
    return getPlayersTab(scope, dashboardRangeArg(args))
  },
  dashboardAgentsTab: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getAgentsTab } = await import('@/services/dashboardTabsService.js')
    return getAgentsTab(scope, dashboardRangeArg(args))
  },
  dashboardTimeTab: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getTimeTab } = await import('@/services/dashboardTabsService.js')
    return getTimeTab(scope, dashboardRangeArg(args))
  },
  // The rows behind a dashboard figure (its pop-up). Same gate and scope as the insight cards.
  dashboardDrilldown: async (_: any, args: any, ctx: any) => {
    const scope = dashboardInsightScope(ctx)
    const { getDashboardDrilldown } = await import('@/services/dashboardDrilldownService.js')
    const range = dashboardRangeArg(args)
    return getDashboardDrilldown(scope, {
      kind: String(args?.kind ?? ''),
      arg: typeof args?.arg === 'string' ? args.arg : null,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      search: typeof args?.search === 'string' ? args.search : null,
      limit: typeof args?.limit === 'number' ? args.limit : null,
      offset: typeof args?.offset === 'number' ? args.offset : null,
    })
  },
  // Takes no arguments on purpose: the snapshot is "what is happening right
  // now" and does not follow the dashboard period presets.
  realtimeSnapshot: async (_: any, __: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'overview.dashboard', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view dashboard')
    }
    // Same tenant resolution as overviewKPIs: in director core mode both are
    // undefined, which means platform-wide.
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const whitelabelId = skipFiltering ? undefined : (directorTenant ?? ctx?.whitelabel?.id)

    const { getRealtimeSnapshot, emptyRealtimeSnapshot } = await import('@/services/realtimeSnapshotService.js')

    // Stricter than overviewKPIs, which does not scope agents at all: an agent
    // sees only the players of its own subtree. getAgentPlayerIds walks
    // agent_hierarchy_closure (depth-0 self row included) and covers both the
    // direct users.agent_id route and the referral route.
    if (ctx?.user?.type === 'agent') {
      const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
      // An agent session without an agent id cannot be scoped; fail closed.
      if (!agentId) return emptyRealtimeSnapshot()
      // An agent is never in core mode; keep a tenant predicate regardless.
      const agentTenant = tenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
      const playerIds = await new PlayerAuthService().getAgentPlayerIds(agentId, agentTenant)
      return getRealtimeSnapshot({ tenant: agentTenant, whitelabelId, agent: { agentId, playerIds } })
    }

    return getRealtimeSnapshot({ tenant, whitelabelId })
  },
  // The open book split by market: the dashboard Exposure figure, per sport plus
  // one matka row. No arguments, like realtimeSnapshot: it is a reading of what
  // is open now and does not follow the period presets.
  exposureByMarket: async (_: any, __: any, ctx: any) => {
    // Both, before any cache or database read: the card sits on the dashboard,
    // and what it shows is exposure, which has a permission of its own.
    const perms = ctx?.permissions ?? []
    if (!hasPermission(perms, 'overview.dashboard', 'view') || !hasPermission(perms, 'reporting.exposure', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view exposure by market')
    }
    // From here on, the same scoping as realtimeSnapshot: in director core mode
    // both are undefined, which means every whitelabel.
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const skipFiltering = shouldSkipTenantFiltering(ctx)
    const tenant = skipFiltering ? undefined : (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const whitelabelId = skipFiltering ? undefined : (directorTenant ?? ctx?.whitelabel?.id)

    const { getExposureByMarket, emptyExposureByMarket } = await import('@/services/exposureByMarketService.js')

    // An agent sees only the players of its own subtree, by both the direct
    // users.agent_id route and the referral route — which is why this does not
    // use the reporting repos' agent filter (users.agent_id only).
    if (ctx?.user?.type === 'agent') {
      const agentId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
      // An agent session without an agent id cannot be scoped; fail closed.
      if (!agentId) return emptyExposureByMarket()
      // An agent is never in core mode; keep a tenant predicate regardless.
      const agentTenant = tenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
      const { PlayerAuthService } = await import('@/domains/players/services/PlayerAuthService.js')
      const playerIds = await new PlayerAuthService().getAgentPlayerIds(agentId, agentTenant)
      return getExposureByMarket({ tenant: agentTenant, whitelabelId, agent: { agentId, playerIds } })
    }

    return getExposureByMarket({ tenant, whitelabelId })
  },

  myAdminPreferences: async (_: any, __: any, ctx: any) => {
    // SECURITY: Only Super Admin can access their preferences
    const roleNames = ctx?.user?.roles || []
    const isSuperAdmin = roleNames.some((r: string) => 
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    if (!isSuperAdmin) {
      throw new Error('Unauthorized: Only Super Admin can access preferences')
    }
    
    // CRITICAL: Use ctx.user.sub (JWT standard field) instead of ctx.user.userId
    const userId = ctx?.user?.sub ? Number(ctx.user.sub) : null
    if (!userId || !Number.isFinite(userId)) {
      throw new Error('Invalid user ID')
    }
    
    const { getAdminPreferencesDb } = await import('@src/repos/users/usersRepo.js')
    const preferences = await getAdminPreferencesDb(userId)
    
    // CRITICAL: Return the actual database values
    // If directorMode is null/undefined, default to 'core', otherwise use the database value
    const directorMode = (preferences.directorMode && (preferences.directorMode === 'core' || preferences.directorMode === 'whitelabel'))
      ? preferences.directorMode
      : 'core'
    const selectedWhitelabelId = preferences.selectedWhitelabelId ?? null
    
    
    return {
      directorMode,
      selectedWhitelabelId,
    }
  },
}
