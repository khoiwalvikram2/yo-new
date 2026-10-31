import { rbacQueryResolvers } from './queries.js'
import { rbacMutationResolvers } from './mutations.js'
import { rbacSubscriptionResolvers } from './subscriptions.js'

export const rbacResolvers = {
  Query: rbacQueryResolvers,
  Mutation: rbacMutationResolvers,
  Subscription: rbacSubscriptionResolvers,
}

