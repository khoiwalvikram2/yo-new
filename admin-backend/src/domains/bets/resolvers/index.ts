import { betsQueryResolvers, BetItemResolver } from './queries.js'

export const betsResolvers = {
  Query: {
    ...betsQueryResolvers,
  },
  BetItem: BetItemResolver,
}
