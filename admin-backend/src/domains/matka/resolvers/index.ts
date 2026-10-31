import { matkaQueryResolvers } from '@src/domains/matka/resolvers/queries.js'
import { matkaMutationResolvers } from '@src/domains/matka/resolvers/mutations.js'
import { matkaSubscriptionResolvers } from '@src/domains/matka/resolvers/subscriptions.js'

export const matkaResolvers = {
  Query: matkaQueryResolvers,
  Mutation: matkaMutationResolvers,
  Subscription: matkaSubscriptionResolvers,
  Matka: {
    // passthrough JSON fields (already stored as JSONB), nothing special
  }
}
