/**
 * Global search repository: aggregates search across domains and returns
 * a unified SearchResultItem shape. Uses Promise.allSettled so one domain
 * failure does not break others.
 */

import { listUsersDb } from '@src/repos/users/usersRepo.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { searchSportsHierarchy } from '@src/repos/sports/sportsSearchRepo.js'
import { listVipMembersDb } from '@src/repos/vip/vipRepo.js'
import { listMatkasDb } from '@src/repos/matka/matkaRepo.js'
import { getReferralLinkByCodeDb } from '@src/repos/referrals/referralsRepo.js'
import { searchWhitelabelsDb } from '@src/repos/common/whitelabelRepo.js'
import { searchCasinoGamesByNameDb } from '@src/repos/casino/casinoRepo.js'
import { listBonusCampaignsDb } from '@src/repos/marketing/bonusesRepo.js'

export interface ParentChainItem {
  id: string
  username: string
  levelIndex: number | null
  route: string
}

export interface SearchResultItem {
  id: string
  type: string
  label: string
  subtitle: string | null
  route: string
  status: string | null
  metadata: Record<string, unknown> | null
  parentChain: ParentChainItem[] | null
}

export interface GlobalSearchResult {
  players: SearchResultItem[]
  agents: SearchResultItem[]
  whitelabels: SearchResultItem[]
  casinoGames: SearchResultItem[]
  sports: SearchResultItem[]
  matkas: SearchResultItem[]
  vipMembers: SearchResultItem[]
  referralCodes: SearchResultItem[]
  bets: SearchResultItem[]
  bonuses: SearchResultItem[]
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 20

const AGENT_LEVEL_LABELS: Record<number, string> = {
  1: 'Super Master',
  2: 'Master',
  3: 'Agent',
  4: 'Sub Agent',
}

function agentSubtitle(agent: { levelIndex?: number | null; schemeType?: string; phone?: string | null }): string | null {
  const parts: string[] = []
  if (agent.levelIndex != null && AGENT_LEVEL_LABELS[agent.levelIndex]) {
    parts.push(AGENT_LEVEL_LABELS[agent.levelIndex])
  }
  if (agent.schemeType) {
    parts.push(agent.schemeType)
  }
  if (parts.length > 0) return parts.join(' • ')
  return agent.phone || null
}

export interface GlobalSearchOptions {
  tenant: string
  /** When set (agent logged in), filter players by this agent; for agents category return only this agent if query matches */
  agentId?: string
  categories?: string[]
}

/**
 * Run global search across all domains. Uses Promise.allSettled so one failure
 * does not break others. Returns unified SearchResultItem[] per category.
 */
export async function globalSearch(
  query: string,
  options: GlobalSearchOptions & { limit?: number }
): Promise<GlobalSearchResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, options.limit ?? DEFAULT_LIMIT))
  const trimmedQuery = (query ?? '').trim()
  const want = (key: string) => !options.categories || options.categories.length === 0 || options.categories.includes(key)

  const empty: GlobalSearchResult = {
    players: [],
    agents: [],
    whitelabels: [],
    casinoGames: [],
    sports: [],
    matkas: [],
    vipMembers: [],
    referralCodes: [],
    bets: [],
    bonuses: [],
  }

  if (trimmedQuery.length < 2) {
    return empty
  }

  const agentsRepo = new AgentsRepo()

  // For agent logins, resolve the full sub-agent tree so searches cover the
  // entire hierarchy (direct players + sub-agent players), matching the access
  // rules used by PlayerAuthService.
  let agentTreeIds: string[] | undefined
  if (options.agentId) {
    const collectDescendants = async (parentId: string): Promise<string[]> => {
      const children = await agentsRepo.listChildren(parentId)
      const ids: string[] = []
      for (const child of children) {
        ids.push(child.id)
        ids.push(...(await collectDescendants(child.id)))
      }
      return ids
    }
    agentTreeIds = [options.agentId, ...(await collectDescendants(options.agentId))]
  }

  const [playersSettled, agentsSettled, whitelabelsSettled, casinoGamesSettled, sportsSettled, vipSettled, matkasSettled, referralSettled, betsSettled, bonusesSettled] = await Promise.allSettled([
    want('players')
      ? listUsersDb(
          { query: trimmedQuery, agentIds: agentTreeIds },
          options.tenant
        ).then((res) => {
          const rows = Array.isArray(res) ? res : (res as { rows: unknown[] }).rows
          return rows.slice(0, limit).map((u: any) => ({
            id: String(u.id),
            type: 'player',
            label: u.name || u.username || `User ${u.id}`,
            subtitle: u.email || u.phone || u.username || null,
            route: `/players/profile/${u.id}`,
            status: (u.status && String(u.status).toUpperCase()) || null,
            metadata: { userId: String(u.id), agentId: u.agentId ? String(u.agentId) : null },
            parentChain: null as ParentChainItem[] | null,
          }))
        })
      : Promise.resolve([]),
    want('agents')
      ? agentsRepo
          .list(options.tenant, { query: trimmedQuery }, { offset: 0, limit })
          .then((items: any[]) => {
            let list = items
            if (agentTreeIds) {
              const treeSet = new Set(agentTreeIds)
              list = items.filter((a: any) => treeSet.has(a.id))
            }
            return list.slice(0, limit).map((a: any) => ({
              id: a.id,
              type: 'agent',
              label: a.username || `Agent ${a.id}`,
              subtitle: agentSubtitle(a),
              route: `/agents/${a.id}`,
              status: a.status || null,
              metadata: { schemeType: a.schemeType, levelIndex: a.levelIndex },
              parentChain: null as ParentChainItem[] | null,
            }))
          })
      : Promise.resolve([]),
    want('whitelabels')
      ? searchWhitelabelsDb(trimmedQuery, limit).then((rows) =>
          rows.map((w: any) => ({
            id: w.id,
            type: 'whitelabel',
            label: w.name,
            subtitle: w.domain || null,
            route: '/config/whitelabels',
            status: w.status || null,
            metadata: null,
            parentChain: null,
          }))
        )
      : Promise.resolve([]),
    want('casinoGames')
      ? searchCasinoGamesByNameDb(trimmedQuery, limit).then((rows) =>
          rows.map((g: { id: number; name: string }) => ({
            id: String(g.id),
            type: 'casinoGame',
            label: g.name,
            subtitle: 'Casino game',
            route: `/casino/management?search=${encodeURIComponent(g.name)}`,
            status: null,
            metadata: null,
            parentChain: null,
          }))
        )
      : Promise.resolve([]),
    want('sports')
      ? searchSportsHierarchy(trimmedQuery, options.tenant, limit).then((results) =>
          results.map((r: any) => {
            if (r.type === 'event' && r.eventId && r.eventName) {
              const parts = [r.leagueName, r.sportName].filter(Boolean)
              return {
                id: r.eventId,
                type: 'event',
                label: r.eventName,
                subtitle: parts.length > 0 ? parts.join(' → ') : 'Event',
                route: `/sports/event/${r.eventId}`,
                status: null,
                metadata: null,
                parentChain: null,
              }
            }
            if (r.type === 'league' && r.leagueId && r.leagueName) {
              return {
                id: r.leagueId,
                type: 'league',
                label: r.leagueName,
                subtitle: r.sportName || 'League',
                route: `/sports/events?league=${r.leagueId}`,
                status: null,
                metadata: null,
                parentChain: null,
              }
            }
            return {
              id: r.sportId,
              type: 'sport',
              label: r.sportName,
              subtitle: 'Sport',
              route: `/sports/events?sport=${r.sportId}`,
              status: null,
              metadata: null,
              parentChain: null,
            }
          })
        )
      : Promise.resolve([]),
    want('vipMembers')
      // The tenant goes into the query, not a filter over the result. Passing it as a
      // filter meant the repo defaulted to the 'default' whitelabel and the filter
      // then discarded everything, so VIP search returned nothing at all for every
      // other whitelabel.
      ? listVipMembersDb({ query: trimmedQuery }, options.tenant).then((list) => {
          return list.slice(0, limit).map((m: any) => ({
            id: m.id,
            type: 'vipMember',
            label: m.userName || `User ${m.userId}`,
            subtitle: [m.tierName && `${m.tierName} Tier`, m.userEmail].filter(Boolean).join(' • ') || 'VIP Member',
            route: `/players/profile/${m.userId}`,
            status: m.status || null,
            metadata: { userId: m.userId },
            parentChain: null,
          }))
        })
      : Promise.resolve([]),
    want('matkas')
      ? listMatkasDb({ query: trimmedQuery, limit, page: 1 }, options.tenant).then((page) =>
          (page.items || []).slice(0, limit).map((m: any) => ({
            id: m.id,
            type: 'matka',
            label: m.name,
            subtitle: m.code || null,
            route: `/matka/${m.id}`,
            status: m.status ? String(m.status).toUpperCase() : null,
            metadata: null,
            parentChain: null,
          }))
        )
      : Promise.resolve([]),
    want('referralCodes')
      ? getReferralLinkByCodeDb(trimmedQuery.toUpperCase()).then((link) => {
          if (!link || link.tenant !== options.tenant) return []
          const userId = link.userId != null ? String(link.userId) : ''
          return [
            {
              id: link.id,
              type: 'referralCode',
              label: link.code,
              subtitle: userId ? `Referrer User ID: ${userId}` : 'Referral code',
              route: userId ? `/players/profile/${userId}` : '/players',
              status: link.isActive ? 'ACTIVE' : 'INACTIVE',
              metadata: { referralCode: link.code, referrerId: userId },
              parentChain: null,
            },
          ]
        })
      : Promise.resolve([]),
    want('bets')
      ? Promise.resolve([
          {
            id: `bet-search-${trimmedQuery}`,
            type: 'bet',
            label: `Search bets: "${trimmedQuery}"`,
            subtitle: 'Open bet list with this search',
            route: `/bets?search=${encodeURIComponent(trimmedQuery)}`,
            status: null,
            metadata: null,
            parentChain: null,
          },
        ])
      : Promise.resolve([]),
    want('bonuses')
      ? listBonusCampaignsDb(options.tenant, { search: trimmedQuery }).then((campaigns) =>
          campaigns.slice(0, limit).map((c: any) => ({
            id: String(c.id),
            type: 'bonus',
            label: c.name,
            subtitle: c.domain ? `${c.domain} • ${c.type || ''}`.trim() : (c.type || null),
            route: `/bonuses/${c.id}`,
            status: c.status || null,
            metadata: null,
            parentChain: null,
          }))
        )
      : Promise.resolve([]),
  ])

  const players = playersSettled.status === 'fulfilled' ? playersSettled.value : []
  const agentsList = agentsSettled.status === 'fulfilled' ? agentsSettled.value : []
  const agentIds = new Set<string>()
  for (const p of players) {
    const aid = (p.metadata as Record<string, unknown>)?.agentId as string | undefined
    if (aid) agentIds.add(aid)
  }
  for (const a of agentsList) {
    agentIds.add(a.id)
  }
  let chainMap = new Map<string, ParentChainItem[]>()
  if (agentIds.size > 0) {
    chainMap = await agentsRepo.getParentChainsBatch(Array.from(agentIds))
  }
  return {
    players: players.map((p: SearchResultItem) => ({
      ...p,
      parentChain: (p.metadata as Record<string, unknown>)?.agentId
        ? (chainMap.get((p.metadata as Record<string, unknown>).agentId as string) ?? null)
        : null,
    })),
    agents: agentsList.map((a) => ({ ...a, parentChain: chainMap.get(a.id) ?? null })),
    whitelabels: whitelabelsSettled.status === 'fulfilled' ? whitelabelsSettled.value : [],
    casinoGames: casinoGamesSettled.status === 'fulfilled' ? casinoGamesSettled.value : [],
    sports: sportsSettled.status === 'fulfilled' ? sportsSettled.value : [],
    matkas: matkasSettled.status === 'fulfilled' ? matkasSettled.value : [],
    vipMembers: vipSettled.status === 'fulfilled' ? vipSettled.value : [],
    referralCodes: referralSettled.status === 'fulfilled' ? referralSettled.value : [],
    bets: betsSettled.status === 'fulfilled' ? betsSettled.value : [],
    bonuses: bonusesSettled.status === 'fulfilled' ? bonusesSettled.value : [],
  }
}
