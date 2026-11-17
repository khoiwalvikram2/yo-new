import { auditQueryResolvers } from '@src/domains/audit/resolvers/queries.js'
import { auditMutationResolvers } from '@src/domains/audit/resolvers/mutations.js'
import { auditSubscriptionResolvers } from '@src/domains/audit/resolvers/subscriptions.js'
import { resolveAuditActorForRequest } from '@src/repos/audit/auditActorRepo.js'

export const auditResolvers = {
  Query: auditQueryResolvers,
  Mutation: auditMutationResolvers,
  Subscription: auditSubscriptionResolvers,
  AuditEvent: {
    // The actor's kind is read from the actor itself (its own tenant's roles, then the platform's), not from
    // the viewer's tenant: see resolveAuditActor.
    actor: async (parent: any, _args: any, ctx: any) => resolveAuditActorForRequest(String(parent.actorId), ctx ?? undefined),
  },
}
