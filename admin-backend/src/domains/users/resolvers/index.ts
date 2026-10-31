import { usersQueryResolvers } from '@src/domains/users/resolvers/queries.js'
import { usersMutationResolvers } from '@src/domains/users/resolvers/mutations.js'
import { usersSubscriptionResolvers } from '@src/domains/users/resolvers/subscriptions.js'

export const usersResolvers = {
  Query: usersQueryResolvers,
  Mutation: usersMutationResolvers,
  Subscription: usersSubscriptionResolvers,
  User: {
    vipDepositAccess: async (user: any, _args: unknown, ctx: any) => {
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
    access: (user: any) => {
      const status = String(user.status ?? 'active').toLowerCase()
      const isActive = status === 'active'
      const isInactive = status === 'inactive'
      const isSuspended = status === 'suspended'

      const canLogin = isActive || isInactive
      const canTransact = isActive
      const bonusEligible = isActive && !!user.bonusAllowed

      const domain = (visible: any, canBet: any) => ({
        visible: isSuspended ? false : !!visible,
        canBet: isActive ? !!canBet : false,
      })

      return {
        canLogin,
        canDeposit: canTransact,
        canWithdraw: canTransact && !user.withdrawalLock,
        bonusEligible,
        sports: domain(user.sportsVisible, user.sportsBetAllowed),
        casino: domain(user.casinoVisible, user.casinoBetAllowed),
        matka: domain(user.matkaVisible, user.matkaBetAllowed),
      }
    }
  }
}
