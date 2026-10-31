import { players } from '@/stores/index.js'
import { listRolesWithPermissions, getUserRoleNames, getRoleNamesForUserIds, getAdminUserIds, aggregatePermissionPairs } from '@/repos/rbac/rbacRepo.js'
import { getVipTierDb, getVipTierNamesByIdsDb } from '@/repos/vip/vipRepo.js'
import { getWalletsForUserIdsDb } from '@/repos/players/walletsRepo.js'
import { getPlayerLimitsDb, getUsersByIdsForExclusion, getUserIdsByPhones, getPlayersListStatsDb } from '@/repos/users/usersRepo.js'
import { getReferralAttributionsByReferrerDb, getReferralAttributionsByRefereeIdsDb } from '@/repos/referrals/referralsRepo.js'
import { db } from '@/db/client.js'
import { agents, agentCredentials, users } from '@/db/schema.js'
import { and, eq, inArray } from 'drizzle-orm'
import { PlayerListStatsService } from '../services/PlayerListStatsService.js'
import { getPlayerDepositWithdrawalStats } from '@/repos/reporting/playerActivityRepo.js'

/**
 * Get player IDs for an agent based on referral attributions
 * Note: This assumes agents can refer players. If agents have user accounts,
 * we filter by referrerId. Otherwise, this returns empty array.
 */
async function getAgentPlayerIds(agentId: string, tenant: string): Promise<number[]> {
  // Use PlayerAuthService for consistent agent-player relationship handling
  const { PlayerAuthService } = await import('../../players/services/PlayerAuthService');
  const playerAuthService = new PlayerAuthService();
  return await playerAuthService.getAgentPlayerIds(agentId, tenant);
}

import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js'
import { maySeePlayer, visiblePlayerIds } from '@src/domains/players/services/playerVisibility.js'

/** Build GraphQL Wallet shape from DB row; ensures updatedAt is never null. */
function toWalletShape(w: any, userId: string): Record<string, unknown> {
  const updatedAt = w?.updatedAt != null
    ? (typeof w.updatedAt === 'string' ? w.updatedAt : new Date(w.updatedAt).toISOString())
    : new Date().toISOString()
  return {
    userId,
    currency: w?.currency ?? 'INR',
    balance: Number(w?.balance ?? w?.cash ?? 0),
    bonus: (w?.bonus != null) ? (typeof w.bonus === 'string' ? Number(w.bonus) : Number(w.bonus)) : 0,
    exposure: Number(w?.exposure ?? 0),
    referralBalance: (w?.referralBalance != null) ? Number(w.referralBalance) : 0,
    referralBonusBalance: (w?.referralBonus != null) ? Number(w.referralBonus) : 0,
    updatedAt,
  }
}

function getEmptyPlayerStats() {
  return {
    totalDeposits: null,
    totalWithdrawals: null,
    depositCount: null,
    withdrawalCount: null,
    manualDepositCount: null,
    manualWithdrawalCount: null,
    ggr: null,
    profitLoss: null,
    plTrend: null,
    betCount: null,
    totalExposure: null,
    lastLogin: null,
    lastActivityAt: null,
    lastBetAt: null,
    daysSinceLastBet: null,
    turnover: null,
    commissionEarned: null,
    commissionTrend: null,
  }
}

function isFieldRequested(info: any, fieldName: string): boolean {
  const visitedFragments = new Set<string>()
  const visitSelections = (selections: any[]): boolean => {
    for (const selection of selections ?? []) {
      if (selection.kind === 'Field' && selection.name?.value === fieldName) return true
      if (selection.kind === 'Field' && selection.selectionSet?.selections) {
        if (visitSelections(selection.selectionSet.selections)) return true
      }
      if (selection.kind === 'InlineFragment' && selection.selectionSet?.selections) {
        if (visitSelections(selection.selectionSet.selections)) return true
      }
      if (selection.kind === 'FragmentSpread') {
        const fragName = selection.name?.value
        if (!fragName || visitedFragments.has(fragName)) continue
        visitedFragments.add(fragName)
        const fragment = info?.fragments?.[fragName]
        if (fragment?.selectionSet?.selections && visitSelections(fragment.selectionSet.selections)) return true
      }
    }
    return false
  }
  const rootSelections = info?.fieldNodes?.flatMap((node: any) => node.selectionSet?.selections ?? []) ?? []
  return visitSelections(rootSelections)
}

export const usersQueryResolvers = {
  users: async (_: any, args: any, ctx: any, info?: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    // For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // If agent is logged in, filter by agent's players
    let agentPlayerIds: number[] | null = null
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      agentPlayerIds = await getAgentPlayerIds(ctx.user.agentId, tenant)
      // If agent has no players, return empty list
      if (agentPlayerIds.length === 0) {
        return []
      }
    }
    
    const listResult = await players.listUsers({ 
      query: args.query ?? undefined,
      status: args.status ?? undefined,
      balanceMin: typeof args.balanceMin === 'number' ? args.balanceMin : undefined,
      balanceMax: typeof args.balanceMax === 'number' ? args.balanceMax : undefined,
      registeredFrom: args.registeredFrom ?? undefined,
      registeredTo: args.registeredTo ?? undefined,
    }, tenant)
    const list = Array.isArray(listResult) ? listResult : (listResult as { list?: any[] })?.list ?? []
    
    // Filter by agent's players if agent is logged in
    let agentFiltered = list
    if (agentPlayerIds !== null && agentPlayerIds.length > 0) {
      agentFiltered = list.filter((u: any) => {
        const userId = Number(u.id)
        return Number.isFinite(userId) && agentPlayerIds!.includes(userId)
      })
    }
    
    // Exclude admins/super admins from players list
    // IMPORTANT: Pass tenant to getUserRoleNames to get roles for the correct tenant
    const ids = agentFiltered.map((u: any) => Number(u.id)).filter(Number.isFinite)
    let roleNamesByUser = new Map<number, string[]>()
    try { roleNamesByUser = await getRoleNamesForUserIds(ids, tenant) }
    catch {
      // Preserve the existing per-user fallback if the batch read is unavailable.
      await Promise.all(ids.map(async (id: number) => {
        try { roleNamesByUser.set(id, await getUserRoleNames(id, tenant)) }
        catch { roleNamesByUser.set(id, []) }
      }))
    }
    const filterMask = agentFiltered.map((u: any) => {
      const idNum = Number(u.id)
      if (!Number.isFinite(idNum)) return true // seeded demo ids won't have roles
      try {
        const names = roleNamesByUser.get(idNum) ?? []
        // Exclude any user with admin role (case-insensitive match)
        const hasAdminRole = names.some(n => 
          /admin/i.test(n) || 
          n.toLowerCase().includes('admin') ||
          n === 'Whitelabel Admin' ||
          n === 'Super Admin'
        )
        return !hasAdminRole
      } catch {
        return true
      }
    })
    const filtered = agentFiltered.filter((_ : any, idx: number) => filterMask[idx])
    const needsWallet = !info || isFieldRequested(info, 'wallet')
    const needsVip = !info || isFieldRequested(info, 'vipTierName')
    let vipNames = new Map<string, string>()
    if (needsVip) {
      const tierIds = [...new Set<string>(filtered.map((u: any) => u.vipTierId).filter(Boolean))]
      try { vipNames = await getVipTierNamesByIdsDb(tierIds, tenant) } catch { /* Fall back per tier below. */ }
    }
    const vipFallbacks = new Map<string, Promise<string | undefined>>()
    // Attach wallet snapshot and VIP tier name for list view; never leak placeholder emails
    const enriched = await Promise.all(filtered.map(async (u: any) => {
      const w = needsWallet ? await players.getWallet(u.id, tenant) : null
      let vipTierName = undefined
      if (needsVip && u.vipTierId) {
        if (vipNames.has(u.vipTierId)) vipTierName = vipNames.get(u.vipTierId)
        else {
          let read = vipFallbacks.get(u.vipTierId)
          if (!read) {
            read = getVipTierDb(u.vipTierId, tenant).then(tier => tier?.name).catch(() => undefined)
            vipFallbacks.set(u.vipTierId, read)
          }
          vipTierName = await read
        }
      }
      return {
        ...u,
        email: u.email && u.email.includes('@placeholder.local') ? undefined : u.email,
        vipTierName,
        createdAt: u.createdAt ? (typeof u.createdAt === 'string' ? u.createdAt : new Date(u.createdAt).toISOString()) : undefined,
        wallet: w ? {
          userId: u.id,
          currency: w.currency,
          balance: Number((w as any).balance ?? (w as any).cash ?? 0),
          bonus: (w as any).bonus ? (typeof (w as any).bonus === 'string' ? Number((w as any).bonus) : Number((w as any).bonus)) : 0,
          exposure: Number((w as any).exposure ?? 0),
          referralBalance: (w as any).referralBalance != null ? Number((w as any).referralBalance) : 0,
          referralBonusBalance: (w as any).referralBonus != null ? Number((w as any).referralBonus) : 0,
          ...toWalletShape(w, u.id),
        } : null,
      }
    }))
    return enriched
  },
  agentsHierarchy: async (_: any, __: any, ctx: any) => {
    requireReadPermission(ctx, 'agents.hierarchy', 'view')
    try {
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
      
      const agentsRepo = new AgentsRepo()

      // Get all agents for the tenant
      let allAgents = await agentsRepo.list(tenant, {}, { offset: 0, limit: 10000 })

      // Get root agents (agents with no parent)
      let rootAgents = allAgents.filter((a: any) => !a.parentAgentId)

      // An agent sees only its own subtree, rooted at itself. Agents hold
      // agents.hierarchy:view (flat agents:view), so without this every agent
      // received the whole whitelabel's tree, phone numbers included.
      if (ctx?.user?.type === 'agent') {
        const selfId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
        if (!selfId) return []
        const subtree = new Set(await agentsRepo.getDescendantIds(selfId))
        allAgents = allAgents.filter((a: any) => subtree.has(String(a.id)))
        rootAgents = allAgents.filter((a: any) => String(a.id) === selfId)
      }
      
      // Build hierarchy tree recursively
      const buildTree = async (agentId: string): Promise<any> => {
        const agent = allAgents.find((a: any) => a.id === agentId)
        if (!agent) return null
        
        const children = allAgents.filter((a: any) => a.parentAgentId === agentId)
        const childrenTrees = await Promise.all(
          children.map((child: any) => buildTree(child.id))
        )
        
        // Get commission plan ID (default to empty string if not available)
        let commissionPlanId = ''
        // Commission plan ID not available from AgentConfigsRepo
        // Set to empty string as default
        commissionPlanId = ''
        
        return {
          id: agent.id,
          tenant: tenant,
          parentId: agent.parentAgentId || null,
          name: agent.username || `Agent ${agent.id}`,
          level: agent.levelIndex || 0,
          commissionPlanId: commissionPlanId || '',
          phone: agent.phone ?? null,
          children: childrenTrees.filter(Boolean),
        }
      }
      
      const hierarchy = await Promise.all(
        rootAgents.map((root: any) => buildTree(root.id))
      )
      
      return hierarchy.filter(Boolean)
    } catch (error: any) {
      // Return empty array instead of null to satisfy non-nullable requirement
      return []
    }
  },
  agentsByIds: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'agents.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const rawIds = Array.isArray(args.ids) ? args.ids : []
    const requested = rawIds.map((id: string) => String(id)).filter(Boolean)
    if (!requested.length) return []
    const agentsRepo = new AgentsRepo()
    // An agent names only agents in its own subtree. Narrowed rather than
    // refused, so a mixed exclusion list still returns what the caller may see.
    let ids = requested
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const subtree = new Set(await agentsRepo.getDescendantIds(String(ctx.user.agentId)))
      ids = requested.filter((id: string) => subtree.has(id))
      if (!ids.length) return []
    }
    const rows = await agentsRepo.findByIdsForExclusion(ids, tenant)
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, phone: r.phone ?? null }))
  },
  agentExclusionImpact: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'agents.hierarchy', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const agentId = args.agentId ? String(args.agentId) : ''
    if (!agentId) return { descendantAgentIds: [], playerIds: [] }
    const agentsRepo = new AgentsRepo()
    if (ctx?.user?.type === 'agent') {
      // An agent may ask only about its own subtree (itself included). Agents
      // hold agents.hierarchy:view, so any agent id in the whitelabel used to
      // return that agent's whole downline and every player id under it.
      const selfId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
      const subtree = selfId ? await agentsRepo.getDescendantIds(selfId) : []
      if (!subtree.includes(agentId)) {
        throw new Error('Forbidden: that agent is outside your hierarchy')
      }
    } else if (!(await agentsRepo.findByIdScoped(agentId, tenant))) {
      // Admins: the agent must belong to the tenant being viewed. The player ids
      // were already tenant-filtered; the descendant agent ids were not.
      return { descendantAgentIds: [], playerIds: [] }
    }
    const descendantAgentIds = await agentsRepo.getDescendantIds(agentId)
    const playerIdsNum = await getAgentPlayerIds(agentId, tenant)
    const playerIds = playerIdsNum.map((id) => String(id))
    return { descendantAgentIds, playerIds }
  },
  agentIdsByUsernames: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'agents.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const usernames = Array.isArray(args.usernames) ? args.usernames.map((u: unknown) => String(u)).filter(Boolean) : []
    if (!usernames.length) return []
    const agentsRepo = new AgentsRepo()
    const ids = await agentsRepo.getAgentIdsByUsernames(usernames, tenant)
    // An agent resolves usernames only within its own subtree (as agentsByIds does).
    if (ctx?.user?.type === 'agent') {
      const selfId = ctx?.user?.agentId ? String(ctx.user.agentId) : ''
      if (!selfId) return []
      const subtree = new Set(await agentsRepo.getDescendantIds(selfId))
      return ids.map((id) => String(id)).filter((id) => subtree.has(id))
    }
    return ids.map((id) => String(id))
  },
  playersListStats: async (_: any, args: { parentType?: string | null }, ctx: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const isAgentLoggedIn = ctx?.user?.type === 'agent' && ctx?.user?.agentId
    const [adminUserIds, agentPlayerIdsOrNull] = await Promise.all([
      getAdminUserIds(tenant),
      isAgentLoggedIn ? getAgentPlayerIds(ctx.user.agentId, tenant) : Promise.resolve(null),
    ])
    const agentPlayerIds = agentPlayerIdsOrNull
    if (isAgentLoggedIn && agentPlayerIds && agentPlayerIds.length === 0) {
      return {
        totalPlayers: 0,
        activePlayers: 0,
        suspendedPlayers: 0,
        inactivePlayers: 0,
        totalBalance: 0,
        totalBonus: 0,
        totalExposure: 0,
        totalCreditLimit: 0,
        totalCreditUsed: 0,
        highUtilizationCount: 0,
      }
    }
    const stats = await getPlayersListStatsDb(
      { parentType: args.parentType ?? undefined },
      tenant,
      {
        excludeUserIds: adminUserIds.length > 0 ? adminUserIds : undefined,
        onlyUserIds: agentPlayerIds && agentPlayerIds.length > 0 ? agentPlayerIds : undefined,
      }
    )
    return stats
  },
  playersStatsByIds: async (_: any, args: { ids: string[] }, ctx: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const rawIds = Array.isArray(args?.ids) ? args.ids : []
    const requestedIds = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
    const allowedIds = await visiblePlayerIds(ctx, requestedIds, tenant)
    if (allowedIds.length === 0) return []

    const rows = await db
      .select({ id: users.id, playerType: users.playerType })
      .from(users)
      .where(and(eq(users.tenant, tenant), inArray(users.id, allowedIds)))
    if (!rows.length) return []

    const playerIds = rows.map((r) => r.id)
    const playerTypes = new Map<number, string>()
    for (const row of rows) {
      if (row.playerType) playerTypes.set(row.id, row.playerType)
    }

    try {
      const statsService = new PlayerListStatsService()
      const statsMap = await statsService.getStatsForPlayers(playerIds, tenant, playerTypes)
      return rows.map((row) => ({ playerId: String(row.id), stats: statsMap.get(row.id) ?? getEmptyPlayerStats() }))
    } catch {
      return rows.map((row) => ({ playerId: String(row.id), stats: getEmptyPlayerStats() }))
    }
  },
  playerActivityDepositWithdrawalStats: async (
    _: any,
    args: { ids: string[]; dateFrom?: string; dateTo?: string },
    ctx: any
  ) => {
    requireReadPermission(ctx, 'players.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const rawIds = Array.isArray(args?.ids) ? args.ids : []
    const requested = [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
    // An agent sees only its own subtree's players.
    const playerIds = await visiblePlayerIds(ctx, requested, tenant)
    if (playerIds.length === 0) return []

    const rows = await getPlayerDepositWithdrawalStats({
      playerIds,
      tenant,
      dateFrom: args.dateFrom ?? undefined,
      dateTo: args.dateTo ?? undefined,
    })
    return rows.map((r) => ({
      playerId: String(r.playerId),
      totalDepositAmount: r.totalDepositAmount,
      totalDepositCount: r.totalDepositCount,
      totalWithdrawalAmount: r.totalWithdrawalAmount,
      totalWithdrawalCount: r.totalWithdrawalCount,
      rangeDepositAmount: r.rangeDepositAmount,
      rangeDepositCount: r.rangeDepositCount,
      rangeWithdrawalAmount: r.rangeWithdrawalAmount,
      rangeWithdrawalCount: r.rangeWithdrawalCount,
    }))
  },
  usersPage: async (_: any, args: any, ctx: any, info: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    try {
      // CRITICAL: For Director Admin, use effective tenant based on mode
      // For Whitelabel Admin and Agents, use existing logic (UNCHANGED)
      const directorTenant = getEffectiveTenantForDirector(ctx)
      const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
      
      const isAgentLoggedIn = ctx?.user?.type === 'agent' && ctx?.user?.agentId
      // Run independent data fetches in parallel
      const [adminUserIds, agentPlayerIdsOrNull] = await Promise.all([
        getAdminUserIds(tenant),
        isAgentLoggedIn ? getAgentPlayerIds(ctx.user.agentId, tenant) : Promise.resolve(null),
      ])
      const agentPlayerIds: number[] | null = agentPlayerIdsOrNull

      if (isAgentLoggedIn && agentPlayerIds && agentPlayerIds.length === 0) {
        return { items: [], itemsWithStats: [], total: 0 }
      }

      const useDbPagination = !isAgentLoggedIn
      const offset = Math.max(0, Number(args.offset ?? 0))
      const limit = Math.max(1, Math.min(Number(args.limit ?? 50), 100))

      let safePage: any[]
      let total: number

      if (useDbPagination) {
        let resolvedAgentIds: string[] | undefined
        if (args.includeDownline && args.agentId) {
          const agentsRepoInst = new AgentsRepo()
          const descendantIds = await agentsRepoInst.getDescendantIds(args.agentId)
          resolvedAgentIds = [args.agentId, ...descendantIds]
        }
        const paged = await players.listUsersPage(
          {
            query: args.query ?? undefined,
            status: args.status ?? undefined,
            registeredFrom: args.registeredFrom ?? undefined,
            registeredTo: args.registeredTo ?? undefined,
            agentId: resolvedAgentIds ? undefined : (args.agentId ?? undefined),
            agentIds: resolvedAgentIds,
            parentType: args.parentType ?? undefined,
            playerType: args.playerType ?? undefined,
            balanceMin: typeof args.balanceMin === 'number' ? args.balanceMin : undefined,
            balanceMax: typeof args.balanceMax === 'number' ? args.balanceMax : undefined,
            sortBy: args.sortBy ?? undefined,
            sortOrder: args.sortOrder === 'asc' || args.sortOrder === 'desc' ? args.sortOrder : undefined,
          },
          tenant,
          {
            offset,
            limit,
            excludeUserIds: adminUserIds.length > 0 ? adminUserIds : undefined,
            onlyUserIds: agentPlayerIds && agentPlayerIds.length > 0 ? agentPlayerIds : undefined,
          }
        )
        safePage = (paged.list ?? []).filter((u: any) => u != null && typeof u === 'object')
        total = paged.total
      } else {
        // An agent looking at one agent in its subtree (the sub-agent profile's
        // Players tab) with includeDownline: that agent's whole player scope —
        // every closure-table descendant's players plus referral-linked ones,
        // the same scope getAgentPlayerIds gives everywhere else — intersected
        // with the caller's own. Filtering on agentId alone showed only the
        // sub-agent's direct players and ignored includeDownline.
        let scopedPlayerIds: number[] | null = agentPlayerIds
        let agentIdFilter: string | undefined = args.agentId ? String(args.agentId) : undefined
        if (agentIdFilter && args.includeDownline) {
          const callerScope = new Set(agentPlayerIds ?? [])
          const downline = await getAgentPlayerIds(agentIdFilter, tenant)
          scopedPlayerIds = downline.filter((id) => callerScope.has(id))
          agentIdFilter = undefined
          if (scopedPlayerIds.length === 0) {
            return { items: [], itemsWithStats: [], total: 0 }
          }
        }
        const list = await players.listUsers(
          {
            query: args.query ?? undefined,
            status: args.status ?? undefined,
            balanceMin: typeof args.balanceMin === 'number' ? args.balanceMin : undefined,
            balanceMax: typeof args.balanceMax === 'number' ? args.balanceMax : undefined,
            registeredFrom: args.registeredFrom ?? undefined,
            registeredTo: args.registeredTo ?? undefined,
            agentId: agentIdFilter,
            parentType: args.parentType ?? undefined,
            playerType: args.playerType ?? undefined,
          },
          tenant,
          {
            excludeUserIds: adminUserIds.length > 0 ? adminUserIds : undefined,
            onlyUserIds: scopedPlayerIds && scopedPlayerIds.length > 0 ? scopedPlayerIds : undefined,
          }
        )
        const safeList = (Array.isArray(list) ? list : []).filter((u: any) => u != null && typeof u === 'object')
        let agentFiltered = safeList
        if (agentPlayerIds !== null && agentPlayerIds.length > 0) {
          agentFiltered = safeList.filter((u: any) => {
            if (!u || typeof u !== 'object' || !u.id) return false
            const userId = Number(u.id)
            return Number.isFinite(userId) && agentPlayerIds!.includes(userId)
          })
        }
        if (isAgentLoggedIn && args.onlyDirect === true) {
          agentFiltered = agentFiltered.filter((u: any) => u && typeof u === 'object' && u.agentId === ctx.user.agentId)
        } else if (isAgentLoggedIn && args.onlyDirect === false) {
          agentFiltered = agentFiltered.filter((u: any) => u && typeof u === 'object' && u.agentId && u.agentId !== ctx.user.agentId)
        }
        let parentTypeFiltered = agentFiltered.filter((u: any) => u != null && typeof u === 'object')
        if (args.parentType && args.parentType !== 'ALL' && args.parentType !== 'DIRECT') {
          const agentIds = [...new Set(parentTypeFiltered.map((u: any) => u?.agentId).filter(Boolean))] as string[]
          if (agentIds.length > 0) {
            try {
              const validAgentIds = agentIds.filter(id =>
                typeof id === 'string' && id.length > 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
              )
              if (validAgentIds.length > 0) {
                const agentsData = await db.select({
                  id: agents.id,
                  schemeType: agents.schemeType,
                }).from(agents).where(inArray(agents.id, validAgentIds))
                const agentSchemeMap = new Map(agentsData.map(a => [a.id, a.schemeType || 'SHARING']))
                parentTypeFiltered = parentTypeFiltered.filter((u: any) => {
                  if (!u || typeof u !== 'object' || !u.agentId) return false
                  return agentSchemeMap.get(u.agentId) === args.parentType
                })
              } else {
                parentTypeFiltered = []
              }
            } catch {
              parentTypeFiltered = []
            }
          } else {
            parentTypeFiltered = []
          }
        }
        const filtered = parentTypeFiltered
        total = filtered.length
        const pageOffset = Math.max(0, Number(args.offset ?? 0))
        const pageLimit = Math.max(0, Number(args.limit ?? total))
        safePage = (pageLimit ? filtered.slice(pageOffset, pageOffset + pageLimit) : filtered.slice(pageOffset)).filter(Boolean) as any[]
      }

    const agentIdsForEnrichment = [...new Set(safePage.map((u: any) => u?.agentId).filter((id: any) => typeof id === 'string' && id.length > 0))] as string[]
    const pageUserIds = safePage.map((u: any) => Number(u?.id)).filter((id: number) => Number.isFinite(id)) as number[]
    const vipTierIds = [...new Set(safePage.map((u: any) => u?.vipTierId).filter(Boolean))] as string[]

    const [agentMap, referrerUserMap, walletByUserId, vipTierNameById] = await Promise.all([
      (async () => {
        if (agentIdsForEnrichment.length === 0) return new Map<string, { id: string; username: string | null; schemeType: string }>()
        try {
          const agentsData = await db.select({
            id: agents.id,
            username: agentCredentials.username,
            schemeType: agents.schemeType,
          })
          .from(agents)
          .leftJoin(agentCredentials, eq(agents.id, agentCredentials.agentId))
          .where(inArray(agents.id, agentIdsForEnrichment))
          return new Map(agentsData.map(a => [a.id, { id: a.id, username: a.username || null, schemeType: a.schemeType || 'SHARING' }]))
        } catch { return new Map<string, { id: string; username: string | null; schemeType: string }>() }
      })(),
      (async () => {
        const map = new Map<number, { id: string; username: string | null; name: string; phone: string | null }>()
        if (pageUserIds.length === 0) return map
        try {
          const attributions = await getReferralAttributionsByRefereeIdsDb(pageUserIds, tenant)
          const referrerIds = [...new Set(attributions.map((a) => a.referrerId))]
          if (referrerIds.length > 0) {
            const referrerUsers = await getUsersByIdsForExclusion(referrerIds, tenant)
            const referrerById = new Map(referrerUsers.map((r) => [r.id, r]))
            for (const a of attributions) {
              const u = referrerById.get(a.referrerId)
              if (u) map.set(a.refereeId, { id: String(u.id), username: u.username ?? null, name: u.name, phone: u.phone ?? null })
            }
          }
        } catch {}
        return map
      })(),
      pageUserIds.length > 0 ? getWalletsForUserIdsDb(pageUserIds, tenant) : Promise.resolve(new Map()),
      vipTierIds.length > 0 ? getVipTierNamesByIdsDb(vipTierIds, tenant) : Promise.resolve(new Map()),
    ])

    const items = await Promise.all(safePage.map(async (u: any) => {
      // Defensive: skip if u is null/undefined or not an object
      if (!u || typeof u !== 'object' || !u.id) {
        return null
      }
      
      try {
        const w = walletByUserId.get(Number(u.id)) ?? null
        const vipTierName = u.vipTierId ? (vipTierNameById.get(u.vipTierId) ?? null) : null
        
        const agentData = u.agentId ? agentMap.get(u.agentId) : null
        const parentAgent = agentData ? {
          id: agentData.id,
          username: agentData.username,
          schemeType: agentData.schemeType,
        } : null

        const result = {
          ...u,
          email: u.email && u.email.includes('@placeholder.local') ? undefined : u.email,
          vipTierName: vipTierName || null,
          createdAt: u.createdAt ? (typeof u.createdAt === 'string' ? u.createdAt : new Date(u.createdAt).toISOString()) : undefined,
          wallet: w ? toWalletShape(w, u.id) : null,
          parentAgent: parentAgent || null,
          referredBy: referrerUserMap.get(Number(u.id)) ?? null,
          creditLimit: u.creditLimit ?? 0,
          creditUsed: u.creditUsed ?? 0,
          creditAvailable: u.creditAvailable ?? 0,
          remark: u.remark ?? null,
        }
        return result
      } catch (error) {
        // Log error but don't crash - return null to be filtered out
        return null
      }
    }))
    
    // Filter out any null items that resulted from errors or invalid data
    const validItems = items.filter((item: any) => item != null && typeof item === 'object')
    
    const shouldComputeItemsWithStats = isFieldRequested(info, 'itemsWithStats')
    let itemsWithStats: any[] = []
    if (shouldComputeItemsWithStats) {
      const fallbackWithEmptyStats = validItems.map((item: any) => ({
        player: item,
        stats: getEmptyPlayerStats(),
      }))
      try {
        const playerIds = validItems.map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id))
        const playerTypes = new Map<number, string>()
        validItems.forEach((item: any) => {
          const id = Number(item.id)
          if (Number.isFinite(id) && item.playerType) playerTypes.set(id, item.playerType)
        })

        if (playerIds.length > 0) {
          const statsService = new PlayerListStatsService()
          const statsMap = await statsService.getStatsForPlayers(playerIds, tenant, playerTypes)
          itemsWithStats = validItems.map((item: any) => ({
            player: item,
            stats: statsMap.get(Number(item.id)) ?? getEmptyPlayerStats(),
          }))
        } else {
          itemsWithStats = fallbackWithEmptyStats
        }
      } catch {
        itemsWithStats = fallbackWithEmptyStats
      }
    }
    
    return { items: validItems, itemsWithStats, total }
    } catch (error: any) {
      // Return empty result instead of crashing
      // itemsWithStats is required by GraphQL schema, must return empty array
      return { items: [], itemsWithStats: [], total: 0 }
    }
  },
  checkPhoneAvailable: async (_: any, args: any, ctx: any) => {
    const { checkPhoneAvailable: checkPhone } = await import('@/repos/users/usersRepo.js')
    
    // Get tenant from context
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    
    // Validate input
    if (!args.phone || typeof args.phone !== 'string' || args.phone.trim() === '') {
      return {
        available: false,
        message: 'Please enter a valid phone number'
      }
    }
    
    // Validate phone format (minimum length)
    const phoneDigits = args.phone.replace(/\D/g, '')
    if (phoneDigits.length < 6) {
      return {
        available: false,
        message: 'Phone number must have at least 6 digits'
      }
    }
    
    try {
      // Normalize phone before checking (for consistency, even though repo normalizes)
      const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
      const normalizedPhone = normalizePhoneForStorage(args.phone)
      
      const excludeUserId = args.excludeUserId ? Number(args.excludeUserId) : undefined
      const isAvailable = await checkPhone(normalizedPhone, tenant, excludeUserId)
      
      return {
        available: isAvailable,
        message: isAvailable 
          ? null 
          : 'This phone number is already registered for this tenant'
      }
    } catch (error: any) {
      return {
        available: false,
        message: 'Unable to verify phone availability. Please try again.'
      }
    }
  },
  user: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.profile', 'view')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // An agent sees only its own subtree's players; an admin is bounded by tenant.
    if (!(await maySeePlayer(ctx, args.id, tenant))) return null
    const user = await players.getUser(args.id, tenant)
    if (!user) return null

    let vipTierName = undefined
    if ((user as any).vipTierId) {
      try {
        const tier = await getVipTierDb((user as any).vipTierId, tenant)
        vipTierName = tier?.name
      } catch (e) {
        // Tier not found, ignore
      }
    }

    return {
      ...user,
      vipTierName,
      createdAt: (user as any).createdAt ? (typeof (user as any).createdAt === 'string' ? (user as any).createdAt : new Date((user as any).createdAt).toISOString()) : undefined,
    }
  },
  usersByIds: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const rawIds = Array.isArray(args.ids) ? args.ids : []
    const rawNumeric = rawIds.map((id: string | number) => (typeof id === 'string' ? parseInt(id, 10) : Number(id))).filter((n: number) => Number.isFinite(n))
    // Narrowed rather than refused: a mixed request returns what the caller may
    // see, the way a list query does.
    const ids = await visiblePlayerIds(ctx, rawNumeric, tenant)
    if (!ids.length) return []
    const rows = await getUsersByIdsForExclusion(ids, tenant)
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      username: r.username ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      status: r.status ?? null,
    }))
  },
  userIdsByPhones: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.list', 'view')
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const phones = Array.isArray(args.phones) ? args.phones.map((p: unknown) => String(p)).filter(Boolean) : []
    if (!phones.length) return []
    const ids = await getUserIdsByPhones(phones, tenant)
    // An agent learns ids only for its own players (narrowed, as usersByIds is);
    // otherwise any phone number could be resolved to a player of the whitelabel.
    const visible = await visiblePlayerIds(ctx, ids, tenant)
    return visible.map((id) => String(id))
  },
  wallet: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.wallet', 'view')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // An agent sees only its own subtree's players; an admin is bounded by tenant.
    if (!(await maySeePlayer(ctx, args.userId, tenant))) return null
    return players.getWallet(args.userId, tenant)
  },
  playerLimits: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.limits', 'view')
    const userId = Number(args.userId)
    if (!Number.isFinite(userId)) throw new Error('Invalid userId')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    // An agent sees only its own subtree's players; an admin is bounded by tenant.
    if (!(await maySeePlayer(ctx, userId, tenant))) return null
    return getPlayerLimitsDb(userId, tenant)
  },
  // roles, userRoles, and permissions queries are now handled by RBAC domain resolvers
  // These old resolvers are removed to avoid conflicts with the new Role type that requires id field
}
