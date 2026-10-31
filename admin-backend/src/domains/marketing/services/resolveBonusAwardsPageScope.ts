import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { db } from '@src/db/client.js'
import { users } from '@shared/db/schema.js'
import { eq, and, or, ilike } from 'drizzle-orm'
import { getEffectiveTenant } from '@src/domains/common/directorModeUtils.js'

export type BonusAwardsPageScopeFilters = {
  agentUsername?: string | null
  playerSearch?: string | null
}

/**
 * Tenant + optional userId restriction for bonus awards list (mirrors bets page scoping).
 * Returns null when the viewer cannot see any rows (e.g. agent with no players, invalid drilldown).
 */
export async function resolveBonusAwardsPageScope(
  ctx: any,
  filters: BonusAwardsPageScopeFilters
): Promise<{ tenant: string; userIds: number[] | undefined } | null> {
  const tenant = (getEffectiveTenant(ctx) || 'default') as string

  let userIds: number[] | undefined

  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    const playerAuthService = new PlayerAuthService()
    const agentsRepo = new AgentsRepo()
    let effectiveAgentId = ctx.user.agentId as string
    if (filters.agentUsername?.trim()) {
      const agent = await agentsRepo.findByUsername(filters.agentUsername.trim(), undefined, undefined, tenant)
      if (!agent || (agent as { tenantId?: string }).tenantId !== tenant) return null
      const loggedInId = ctx.user.agentId as string
      if (agent.id === loggedInId) {
        effectiveAgentId = loggedInId
      } else {
        const getAllDescendantIds = async (parentId: string): Promise<string[]> => {
          const children = await agentsRepo.listChildren(parentId)
          const ids = (children as { id: string }[]).map((c) => c.id)
          for (const c of children as { id: string }[]) {
            ids.push(...(await getAllDescendantIds(c.id)))
          }
          return ids
        }
        const descendantIds = await getAllDescendantIds(loggedInId)
        if (!descendantIds.includes(agent.id)) return null
        effectiveAgentId = agent.id
      }
    }
    userIds = await playerAuthService.getAgentPlayerIds(effectiveAgentId, tenant)
    if (userIds.length === 0) return null
    if (filters.playerSearch?.trim()) {
      const rawPlayerSearch = filters.playerSearch.trim()
      const q = `%${rawPlayerSearch}%`
      const numericPlayerId = Number(rawPlayerSearch)
      const searchOrList = [
        ilike(users.username, q),
        ilike(users.name, q),
        ilike(users.phone, q),
      ]
      // Only add id match if within PostgreSQL integer range (phone numbers exceed it)
      if (Number.isFinite(numericPlayerId) && numericPlayerId > 0 && numericPlayerId <= 2147483647) {
        searchOrList.push(eq(users.id, numericPlayerId))
      }
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenant, tenant), or(...searchOrList)))
      const searchIds = new Set(rows.map((r) => r.id))
      userIds = userIds.filter((id) => searchIds.has(id))
      if (userIds.length === 0) return null
    }
  } else {
    let candidateIds: number[] | undefined
    if (filters.agentUsername?.trim()) {
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findByUsername(filters.agentUsername.trim(), undefined, undefined, tenant)
      if (!agent || (agent as { tenantId?: string }).tenantId !== tenant) return null
      const playerAuthService = new PlayerAuthService()
      candidateIds = await playerAuthService.getAgentPlayerIds(agent.id, tenant)
      if (candidateIds.length === 0) return null
    }
    if (filters.playerSearch?.trim()) {
      const rawPlayerSearch = filters.playerSearch.trim()
      const q = `%${rawPlayerSearch}%`
      const numericPlayerId = Number(rawPlayerSearch)
      const searchOrList = [
        ilike(users.username, q),
        ilike(users.name, q),
        ilike(users.phone, q),
      ]
      // Only add id match if within PostgreSQL integer range (phone numbers exceed it)
      if (Number.isFinite(numericPlayerId) && numericPlayerId > 0 && numericPlayerId <= 2147483647) {
        searchOrList.push(eq(users.id, numericPlayerId))
      }
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenant, tenant), or(...searchOrList)))
      const searchIds = rows.map((r) => r.id)
      if (candidateIds !== undefined) {
        const idSet = new Set(searchIds)
        userIds = candidateIds.filter((id) => idSet.has(id))
      } else {
        userIds = searchIds.length > 0 ? searchIds : []
      }
      if (userIds?.length === 0) return null
    } else if (candidateIds !== undefined) {
      userIds = candidateIds
    }
  }

  return { tenant, userIds }
}
