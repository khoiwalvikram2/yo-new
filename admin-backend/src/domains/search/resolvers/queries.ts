import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { globalSearch as globalSearchRepo } from '@src/repos/search/globalSearchRepo.js'
import { hasPermission } from '@src/domains/common/auth.js'

const GLOBAL_SEARCH_RATE_MAX = 10
const GLOBAL_SEARCH_RATE_WINDOW_MS = 1000
const searchRateMap = new Map<string, number[]>()

/**
 * What each search category costs to look at.
 *
 * Global search reached across players, agents, whitelabels, casino games, sports, VIP
 * members and matkas behind one shared gate — none — so it was a way to read the names
 * behind pages the caller could not open. Each category is now gated on the same
 * permission its own screen requires.
 */
const SEARCH_CATEGORY_PERMISSIONS: Record<string, { domain: string; action: string }> = {
  players: { domain: 'players.list', action: 'view' },
  agents: { domain: 'agents.list', action: 'view' },
  whitelabels: { domain: 'config.whitelabels', action: 'view' },
  casinoGames: { domain: 'casino.management', action: 'view' },
  sports: { domain: 'sports.events', action: 'view' },
  vipMembers: { domain: 'vip.members', action: 'view' },
  matkas: { domain: 'matka.management', action: 'view' },
  // The search panel offered these three and the repo searched them, but with no entry here every request
  // dropped them, and asking for one alone failed on the result lists the empty answer left out.
  referralCodes: { domain: 'referrals.overview', action: 'view' },
  bets: { domain: 'sports.bets', action: 'view' },
  bonuses: { domain: 'bonuses.list', action: 'view' },
}

/**
 * What an agent searches: the two categories the repo narrows to the agent's own tree. Every other one reads the
 * whole whitelabel (its bonus campaigns, referral codes, catalogues), and an agent holds some of those
 * permissions as base grants (bonuses:read) with no screen that shows them. The agent panel offers only these.
 */
const AGENT_SEARCH_CATEGORIES = new Set(['players', 'agents'])

/** Every result list empty: the answer when the caller may search nothing, with each list the schema requires. */
const emptySearchResult = () => Object.fromEntries(Object.keys(SEARCH_CATEGORY_PERMISSIONS).map((category) => [category, []]))
function pruneOld(timestamps: number[], windowMs: number): number[] {
  const cutoff = Date.now() - windowMs
  return timestamps.filter((t) => t > cutoff)
}
function isSearchRateLimited(key: string): boolean {
  const now = Date.now()
  let ts = searchRateMap.get(key) ?? []
  ts = pruneOld(ts, GLOBAL_SEARCH_RATE_WINDOW_MS)
  if (ts.length >= GLOBAL_SEARCH_RATE_MAX) return true
  ts.push(now)
  searchRateMap.set(key, ts)
  return false
}

export const searchQueryResolvers = {
  globalSearch: async (_: unknown, args: { query: string; limit?: number; categories?: string[] }, ctx: any) => {
    // This resolver had no authentication check of any kind. It reached ctx.user only
    // to build a rate-limit key, so an unauthenticated caller fell through to
    // 'anonymous' and searched whichever whitelabel they named in a header. That was
    // largely inert while VIP search was broken and returned nothing for every
    // non-default tenant; repairing that turned it into a live route to member names,
    // emails and tiers. Fixed here rather than only in the VIP repo, because the same
    // omission exposed players, agents and whitelabels through the other categories.
    if (!ctx?.user) {
      throw new Error('Unauthorized: authentication required')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    const agentId = ctx?.user?.type === 'agent' && ctx?.user?.agentId ? ctx.user.agentId : undefined

    const query = typeof args.query === 'string' ? args.query : ''
    const limit = Math.min(20, Math.max(1, typeof args.limit === 'number' ? args.limit : 10))
    // A caller searches only the categories they may already open a page for. Asking
    // for one they cannot see drops it rather than failing the whole search, so a mixed
    // request still returns what the caller is entitled to.
    const requested = Array.isArray(args.categories) && args.categories.length > 0
      ? args.categories
      : Object.keys(SEARCH_CATEGORY_PERMISSIONS)
    const categories = requested.filter(c => {
      if (agentId && !AGENT_SEARCH_CATEGORIES.has(c)) return false
      const required = SEARCH_CATEGORY_PERMISSIONS[c]
      return required ? hasPermission(ctx?.permissions ?? [], required.domain, required.action) : false
    })
    if (categories.length === 0) {
      return emptySearchResult()
    }

    const rateKey = String(ctx?.user?.id ?? ctx?.user?.sub ?? ctx?.req?.ip ?? 'anonymous')
    if (isSearchRateLimited(rateKey)) {
      throw new Error('Too many searches. Please slow down.')
    }

    if (query.trim().length >= 2) {
      const anonymized = { length: query.trim().length, tenant: typeof tenant === 'string' ? tenant : 'default' }
      if (process.env.NODE_ENV !== 'test') {
      }
    }

    return globalSearchRepo(query, {
      tenant: typeof tenant === 'string' ? tenant : 'default',
      agentId,
      limit,
      categories,
    })
  },
}
