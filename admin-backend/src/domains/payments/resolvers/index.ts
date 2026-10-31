import { paymentsQueryResolvers } from './queries.js'
import { paymentsMutationResolvers } from './mutations.js'
import { paymentsSubscriptionResolvers } from './subscriptions.js'

export const paymentsResolvers = {
  Query: paymentsQueryResolvers,
  Mutation: paymentsMutationResolvers,
  Subscription: paymentsSubscriptionResolvers,
}

