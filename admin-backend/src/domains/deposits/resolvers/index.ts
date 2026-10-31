import { depositsQueryResolvers } from './queries.js'
import { depositsMutationResolvers } from './mutations.js'
import { depositsSubscriptionResolvers } from './subscriptions.js'
import { ensureAgentCanMutate } from '@src/domains/common/auth.js'

function wrapDepositsMutations(mutations: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(
    Object.entries(mutations).map(([key, fn]) => [
      key,
      async (parent: any, args: any, ctx: any, info: any) => {
        if (!ctx?.user) throw new Error('Unauthorized: authentication required')
        ensureAgentCanMutate(ctx)
        return fn(parent, args, ctx, info)
      },
    ])
  )
}

export const depositsResolvers = {
  Query: depositsQueryResolvers,
  Mutation: wrapDepositsMutations(depositsMutationResolvers),
  Subscription: depositsSubscriptionResolvers,
}

