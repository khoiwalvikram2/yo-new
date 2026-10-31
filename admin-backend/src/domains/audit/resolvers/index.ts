import { auditQueryResolvers } from '@src/domains/audit/resolvers/queries.js'
import { auditMutationResolvers } from '@src/domains/audit/resolvers/mutations.js'
import { auditSubscriptionResolvers } from '@src/domains/audit/resolvers/subscriptions.js'
import { getAuditActorInfo } from '@src/repos/users/usersRepo.js'

export const auditResolvers = {
  Query: auditQueryResolvers,
  Mutation: auditMutationResolvers,
  Subscription: auditSubscriptionResolvers,
  AuditEvent: {
    actor: async (parent: any, _args: any, ctx: any) => {
      const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? parent.tenant ?? 'default'
      return getAuditActorInfo(parent.actorId, tenant)
    },
  },
}
