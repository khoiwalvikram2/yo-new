import { guardMutationMap, type RequiredPermission } from '@src/domains/common/guardMutationMap.js'
import { marketingQueryResolvers } from './queries.js'
import { marketingMutationResolvers } from './mutations.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

/**
 * The permission each marketing mutation demands.
 *
 * `canMutateMarketing` ORed three, so `bonuses.create:create` also deleted
 * campaigns and game bundles, and `bonuses.detail:delete` created them. The
 * bundle permissions in the catalogue gated nothing at all.
 */
export const MARKETING_MUTATION_PERMISSIONS: Record<string, RequiredPermission> = {
  createBonusCampaignV2: [['bonuses.create', 'create']],
  updateBonusCampaign: [['bonuses.detail', 'update']],
  deleteBonusCampaign: [['bonuses.detail', 'delete']],
  saveBonusCampaignGames: [['bonuses.detail', 'update']],
  saveBonusCampaignMatkas: [['bonuses.detail', 'update']],
  distributeBonusCampaign: [['bonuses.detail', 'update']],

  // These have their own catalogue entries, which previously gated nothing.
  createCasinoGameBundle: [['bonuses.bundles', 'create']],
  updateCasinoGameBundle: [['bonuses.bundles', 'update']],
  deleteCasinoGameBundle: [['bonuses.bundles', 'delete']],

  // Promotions > Campaigns and > Content and their seven mutations were retired on 2026-11-04 (MAR-14).
}
function wrapMarketingMutations(mutations: Record<string, (...args: any[]) => any>) {
  return guardMutationMap(mutations, MARKETING_MUTATION_PERMISSIONS, {
    label: 'marketing',
  })
}

export const marketingResolvers = {
  Query: marketingQueryResolvers,
  Mutation: wrapMarketingMutations(marketingMutationResolvers),
}
