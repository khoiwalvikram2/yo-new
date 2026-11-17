import { sportsQueryResolvers } from '@src/domains/sports/resolvers/queries.js'
import { sportsMutationResolvers } from '@src/domains/sports/resolvers/mutations.js'
import { sportsSubscriptionResolvers } from '@src/domains/sports/resolvers/subscriptions.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

function wrapSportsQueries(queries: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(
    Object.entries(queries).map(([key, fn]) => [
      key,
      async (parent: any, args: any, ctx: any, info: any) => {
        if (!hasPermission(ctx?.permissions ?? [], 'sports.events', 'view')) {
          throw new Error('Forbidden: insufficient permissions to access sports')
        }
        return fn(parent, args, ctx, info)
      },
    ])
  )
}

/**
 * The permission each sports mutation demands.
 *
 * `canMutateSports` used to OR ten permissions together, so holding any one of
 * them opened all twenty-nine mutations: a caller entitled only to void a bet
 * (`sports.bets:void`) could declare a result, rewrite risk limits and delete
 * automation rules. Ten separately grantable permissions collapsed into one.
 *
 * These names are the catalogue's own, and every nested write here also maps
 * back to flat `sports:write`, so a Whitelabel Admin or an agent carrying the
 * flat permission keeps exactly the access they had.
 *
 * A mutation absent from this map is refused rather than allowed — a new one
 * should fail loudly and be given a permission, not inherit an open door.
 */
export const SPORTS_MUTATION_PERMISSIONS: Record<string, [string, string]> = {
  // Catalogue and presentation.
  // The four status writes and the two reorders also carry
  // `requirePlatformCatalogueAccess` (mutations.ts): sports, leagues, events and
  // markets are one catalogue with no whitelabel column, and every Whitelabel
  // Admin reaches these entries through the flat `sports:write`. The settings
  // writes change the whitelabel's own rows, so they stay on the map alone.
  seedSportsFromProvider: ['sports.configuration', 'update'],
  setSportStatus: ['sports.configuration', 'update'],
  persistSportsSelections: ['sports.configuration', 'update'],
  upsertSportSettings: ['sports.configuration', 'update'],
  reorderSports: ['sports.configuration', 'update'],
  upsertLeagueSettings: ['sports.configuration', 'update'],
  reorderLeagues: ['sports.configuration', 'update'],
  setLeagueStatus: ['sports.configuration', 'update'],

  // Events and markets.
  upsertEventSettings: ['sports.events', 'update'],
  setEventStatus: ['sports.events', 'update'],
  setMarketStatus: ['sports.events', 'update'],

  // Results decide what a bet pays.
  createSportsResult: ['sports.results', 'create'],
  rollbackSportsResult: ['sports.results', 'rollback'],

  // Automation.
  upsertAutoSportsConfig: ['sports.automation', 'update'],
  runAutoSportsIngestion: ['sports.automation', 'create'],
  deleteAutoSportsConfig: ['sports.automation', 'delete'],
  deleteAutoRuns: ['sports.automation', 'delete'],
  upsertSportsAutoResultsSettings: ['sports.automation', 'update'],
  toggleAutoResultMarketType: ['sports.automation', 'update'],
  deleteSportsAutoResultsSettings: ['sports.automation', 'delete'],
  upsertAutomationRule: ['sports.automation', 'update'],
  deleteAutomationRule: ['sports.automation', 'delete'],

  // Risk, including the pattern and player-flag tools that sit on the risk screen.
  upsertRiskLimit: ['sports.risk', 'update'],
  upsertEventRiskConfig: ['sports.risk', 'update'],
  flagPlayer: ['sports.risk', 'update'],
  unflagPlayer: ['sports.risk', 'update'],
  dismissPattern: ['sports.risk', 'update'],

  // Individual bets.
  voidBet: ['sports.bets', 'void'],
  cancelBet: ['sports.bets', 'cancel'],
}
function wrapSportsMutations(mutations: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(
    Object.entries(mutations).map(([key, fn]) => [
      key,
      async (parent: any, args: any, ctx: any, info: any) => {
        if (!ctx?.user) throw new Error('Unauthorized: authentication required')
        ensureAgentCanMutate(ctx)
        const required = SPORTS_MUTATION_PERMISSIONS[key]
        if (!required) {
          throw new Error(
            `Forbidden: ${key} declares no permission. Add it to SPORTS_MUTATION_PERMISSIONS.`
          )
        }
        const [domain, action] = required
        if (!hasPermission(ctx?.permissions ?? [], domain, action)) {
          throw new Error(`Forbidden: insufficient permissions for ${domain}:${action}`)
        }
        return fn(parent, args, ctx, info)
      },
    ])
  )
}

export const sportsResolvers = {
  Query: wrapSportsQueries(sportsQueryResolvers),
  Mutation: wrapSportsMutations(sportsMutationResolvers),
  Subscription: sportsSubscriptionResolvers,
}
