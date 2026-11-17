import { usersQueryResolvers } from '@src/domains/users/resolvers/queries.js'
import { usersMutationResolvers } from '@src/domains/users/resolvers/mutations.js'
import { usersSubscriptionResolvers } from '@src/domains/users/resolvers/subscriptions.js'
import { userAccessField } from '@src/domains/players/services/userAccessField.js'
import { hasPermission } from '@src/domains/common/auth.js'

export const usersResolvers = {
  Query: usersQueryResolvers,
  Mutation: usersMutationResolvers,
  Subscription: usersSubscriptionResolvers,
  User: {
    vipDepositAccess: async (user: any, _args: unknown, ctx: any) => {
      // The player's monthly deposits and tier: the VIP read's figures. It was never served before it was wired
      // (domains/index.ts), so this keeps it to the callers of the VIP screens (agents derive players.vip:view).
      if (!hasPermission(ctx?.permissions ?? [], 'players.vip', 'view')) return null
      const { db } = await import('@/db/client.js')
      const { getVipDepositContext } = await import('@shared/vip/depositAccess.js')
      try {
        const tenant = user.tenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
        const access = await getVipDepositContext(db, tenant, Number(user.id))
        return { eligible: true, tierId: access.tier.id, tierName: access.tier.name, mode: access.user.vipTierMode,
          programStartedAt: access.startsAt.toISOString(), monthlyDeposits: access.monthlyDeposits,
          message: access.manualTierUnavailable ? `The manually assigned tier is no longer active, so the automatic tier ${access.tier.name} applies. Choose a tier to assign one again.` : null }
      } catch (error) {
        return { eligible: !(error instanceof Error && error.message.includes('credit-agent')), message: error instanceof Error ? error.message : 'VIP access unavailable' }
      }
    },

    vipTierName: async (user: any, _args: unknown, ctx: any) => {
      // If already resolved, return it
      if (user.vipTierName !== undefined) return user.vipTierName
      // Otherwise resolve from vipTierId
      if (!user.vipTierId) return null
      try {
        const { getVipTierDb } = await import('@/repos/vip/vipRepo.js')
        const tier = await getVipTierDb(user.vipTierId, user.tenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
        return tier?.name ?? null
      } catch {
        return null
      }
    },
    parentAgent: async (user: any) => {
      // If already resolved, return it
      if (user.parentAgent !== undefined) return user.parentAgent
      // Otherwise resolve from agentId
      if (!user.agentId) return null
      try {
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
        const agentsRepo = new AgentsRepo()
        const agent = await agentsRepo.findById(user.agentId)
        if (!agent) return null
        return {
          id: agent.id,
          username: agent.username || null,
          schemeType: agent.schemeType || 'SHARING',
        }
      } catch {
        return null
      }
    },
    // Not what serves User.access: domains/index.ts spreads commonResolvers.User after this map, so its access (the
    // same rule) wins. Kept on the one resolver so this map cannot answer the old "an inactive player can log in" (PLA-09).
    access: userAccessField,
  }
}
