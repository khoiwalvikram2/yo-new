import { worliQueryResolvers } from './queries.js'
import { worliMutationResolvers } from './mutations.js'
import { worliSubscriptionResolvers } from './subscriptions.js'

export const worliResolvers = {
  Query: {
    ...worliQueryResolvers,
  },
  Mutation: {
    ...worliMutationResolvers,
  },
  Subscription: {
    ...worliSubscriptionResolvers,
  },
}

