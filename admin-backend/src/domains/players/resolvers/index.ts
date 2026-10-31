import { playersQueryResolvers } from '@src/domains/players/resolvers/queries.js'
import { playersMutationResolvers } from '@src/domains/players/resolvers/mutations.js'
import { playersSubscriptionResolvers } from '@src/domains/players/resolvers/subscriptions.js'

export const playersResolvers = {
  Query: playersQueryResolvers,
  Mutation: playersMutationResolvers,
  Subscription: playersSubscriptionResolvers,
}
