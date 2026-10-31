import { guardMutationMap, type RequiredPermission } from '@src/domains/common/guardMutationMap.js'
import { referralsQueryResolvers } from './queries.js'
import { referralsMutationResolvers } from './mutations.js'
import { referralsSubscriptionResolvers } from './subscriptions.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * The permission each referrals mutation demands.
 *
 * `canMutateReferrals` ORed five, so `referrals.rules:create` also released
 * escrow, granted a manual payout and triggered a settlement — the three
 * operations in this domain that move money.
 */
export const REFERRALS_MUTATION_PERMISSIONS: Record<string, RequiredPermission> = {
  upsertReferralProgram: [['referrals.program', 'update']],
  setBudgetCaps: [['referrals.program', 'update']],
  setLadderTiers: [['referrals.program', 'update']],
  setCashbackShare: [['referrals.program', 'update']],

  upsertReferralRules: [['referrals.rules', 'update']],
  issueReferralCoupon: [['referrals.rules', 'create']],
  createRaffleDraw: [['referrals.rules', 'create']],
  runRaffleDraw: [['referrals.rules', 'update']],

  // Money.
  triggerSettlement: [['referrals.settlements', 'create']],
  grantManualPayout: [['referrals.settlements', 'create']],
  releaseEscrow: [['referrals.settlements', 'create']],

  // Attribution, written as a player moves through the funnel.
  generateReferralLink: [['referrals.program', 'view']],
  recordReferralClick: [['referrals.program', 'view']],
  attributeSignup: [['referrals.program', 'view']],
}
function wrapReferralsMutations(mutations: Record<string, (...args: any[]) => any>) {
  return guardMutationMap(mutations, REFERRALS_MUTATION_PERMISSIONS, {
    label: 'referrals',
    // An agent generating its own referral link is entitled to that without
    // holding referral-management permission. This is the exemption the old
    // wrapper expressed inline as `isAgentGeneratingOwnLink`.
    exempt: (key, _parent, _args, ctx) =>
      key === 'generateReferralLink' && ctx?.user?.type === 'agent' && !!ctx?.user?.agentId,
  })
}

export const referralsResolvers = {
  Query: referralsQueryResolvers,
  Mutation: wrapReferralsMutations(referralsMutationResolvers),
  Subscription: referralsSubscriptionResolvers,
}

