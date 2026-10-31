import { loadPlayerDomains } from '@shared/access/playerDomains.js'
import { db } from '../../db/client.js'
import type { ResolverContext } from '../../types/context.js'
import { ownMatkaBets, ownMatkaWallet, playerMatkaBet, playerMatkaChart, playerMatkaMarket, playerMatkaMarkets } from './readService.js'
import { placeMatkaEntries, type PlaceMatkaInput } from './betService.js'

function errorMeta(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  const systemError = !detail || /Failed query:|SQL|constraint|relation .*does not exist|ECONN|timeout|connection|deadlock/i.test(detail)
  return { code: systemError ? 500 : 400, message: systemError ? 'Matka request could not be completed. Retry the same request to check its outcome.' : detail }
}
const unauthorized = { code: 401, message: 'Please sign in to continue' }
export const playerMatkaResolvers = {
  Query: {
    matkaMarkets: async (_: unknown, args: Parameters<typeof playerMatkaMarkets>[1], ctx: ResolverContext) => {
      if (ctx.auth.userId && !(await loadPlayerDomains(db, ctx.auth.requestTenant, ctx.auth.userId)).matka.visible) return { meta: { code: 200, total: 0, message: 'Matka is hidden for this account' }, data: [] }
      return playerMatkaMarkets(ctx.auth.requestTenant, args)
    },
    matkaMarket: async (_: unknown, args: { id: string }, ctx: ResolverContext) => {
      if (ctx.auth.userId && !(await loadPlayerDomains(db, ctx.auth.requestTenant, ctx.auth.userId)).matka.visible) return { meta: { code: 403, message: 'Matka is hidden for this account' }, data: null }
      return playerMatkaMarket(ctx.auth.requestTenant, args.id)
    },
    matkaChart: async (_: unknown, args: { marketId: string; from: string; to: string }, ctx: ResolverContext) => {
      if (ctx.auth.userId && !(await loadPlayerDomains(db, ctx.auth.requestTenant, ctx.auth.userId)).matka.visible) return { meta: { code: 403, message: 'Matka is hidden for this account' }, data: [] }
      try { return await playerMatkaChart(ctx.auth.requestTenant, args.marketId, args.from, args.to) } catch (error) { return { meta: errorMeta(error), data: [] } }
    },
    myMatkaBets: async (_: unknown, args: Parameters<typeof ownMatkaBets>[2], ctx: ResolverContext) => {
      if (!ctx.auth.userId) return { meta: unauthorized, data: [] }
      try { return await ownMatkaBets(ctx.auth.tenant, ctx.auth.userId, args) } catch (error) { return { meta: errorMeta(error), data: [] } }
    },
    matkaWallet: (_: unknown, __: unknown, ctx: ResolverContext) => ctx.auth.userId ? ownMatkaWallet(ctx.auth.tenant, ctx.auth.userId) : { meta: unauthorized, data: [], canBet: false },
  },
  Mutation: {
    placeMatkaEntries: async (_: unknown, { input }: { input: PlaceMatkaInput }, ctx: ResolverContext) => {
      if (!ctx.auth.userId) return { meta: unauthorized, data: null }
      try {
        const placed = await placeMatkaEntries(ctx.auth.userId, ctx.auth.tenant, input)
        return { meta: { code: 200, message: placed.replayed ? 'These entries were already accepted' : 'Entries placed successfully' }, data: { ...placed, bets: placed.bets.map(playerMatkaBet) } }
      } catch (error) { return { meta: errorMeta(error), data: null } }
    },
  },
}
