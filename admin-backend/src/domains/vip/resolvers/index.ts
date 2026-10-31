import { vipQueryResolvers } from './queries.js'
import { vipMutationResolvers } from './mutations.js'
import { vipSubscriptionResolvers } from './subscriptions.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * What each VIP mutation costs the caller.
 *
 * This used to be one check for all of them: holding any one of
 * vip.tiers:create/update/delete or vip.members:update opened every mutation, so a role
 * granted "create tiers" could also delete them and move members between them. The four
 * permissions existed and were seeded; nothing read them apart.
 *
 * Verified before tightening: every role that can mutate VIP today holds either the flat
 * `vip:write` (which NESTED_TO_FLAT maps onto all four) or all six nested permissions
 * outright, so nobody loses access. The one role holding view-only was already blocked.
 *
 * importVIPTiers requires delete, not create: it clears the tier set before writing.
 */
const VIP_MUTATION_PERMISSIONS: Record<string, { domain: string; action: string }> = {
  createVIPTier: { domain: 'vip.tiers', action: 'create' },
  updateVIPTier: { domain: 'vip.tiers', action: 'update' },
  deleteVIPTier: { domain: 'vip.tiers', action: 'delete' },
  setVIPTierStatus: { domain: 'vip.tiers', action: 'update' },
  scheduleVIPTierStatus: { domain: 'vip.tiers', action: 'update' },
  publishScheduledVIPTier: { domain: 'vip.tiers', action: 'update' },
  revertVIPTierVersion: { domain: 'vip.tiers', action: 'update' },
  importVIPTiers: { domain: 'vip.tiers', action: 'delete' },
  exportVIPTiers: { domain: 'vip.tiers', action: 'view' },

  createVIPMember: { domain: 'vip.members', action: 'update' },
  updateVIPMember: { domain: 'vip.members', action: 'update' },
  addVIPPoints: { domain: 'vip.members', action: 'update' },
  removeVIPPoints: { domain: 'vip.members', action: 'update' },
}

export { VIP_MUTATION_PERMISSIONS }

/**
 * Fails closed. A mutation added without an entry above is refused rather than allowed,
 * so forgetting to decide what it costs is a broken feature and not a silent hole.
 * vipMutationPermissions.test.ts asserts the map covers every mutation, which turns that
 * refusal into a build-time failure instead of a runtime surprise.
 */
function wrapVipMutations(mutations: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(
    Object.entries(mutations).map(([key, fn]) => [
      key,
      async (parent: any, args: any, ctx: any, info: any) => {
        if (!ctx?.user) throw new Error('Unauthorized: authentication required')
        ensureAgentCanMutate(ctx)

        const required = VIP_MUTATION_PERMISSIONS[key]
        if (!required) {
          throw new Error(`Forbidden: no permission is defined for ${key}`)
        }
        if (!hasPermission(ctx?.permissions ?? [], required.domain, required.action)) {
          throw new Error(`Forbidden: insufficient permissions for ${required.domain}:${required.action}`)
        }
        return fn(parent, args, ctx, info)
      },
    ])
  )
}

export const vipResolvers = {
  Query: vipQueryResolvers,
  Mutation: wrapVipMutations(vipMutationResolvers),
  Subscription: vipSubscriptionResolvers,
}
