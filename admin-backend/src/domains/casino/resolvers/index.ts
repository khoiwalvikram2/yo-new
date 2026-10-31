import { guardMutationMap, type RequiredPermission } from '@src/domains/common/guardMutationMap.js'
import { casinoQueryResolvers } from '@src/domains/casino/resolvers/queries.js'
import { casinoMutationResolvers } from '@src/domains/casino/resolvers/mutations.js'
import { casinoSubscriptionResolvers } from '@src/domains/casino/resolvers/subscriptions.js'
import { hasPermission, ensureAgentCanMutate } from '@src/domains/common/auth.js'

function wrapCasinoQueries(queries: Record<string, (...args: any[]) => any>) {
  return Object.fromEntries(
    Object.entries(queries).map(([key, fn]) => [
      key,
      async (parent: any, args: any, ctx: any, info: any) => {
        if (!hasPermission(ctx?.permissions ?? [], 'casino.management', 'view')) {
          throw new Error('Forbidden: insufficient permissions to access casino')
        }
        return fn(parent, args, ctx, info)
      },
    ])
  )
}

/** At least one casino mutation permission required; resolvers may add stricter checks. */
/**
 * The permission each casino mutation demands.
 *
 * `canMutateCasino` ORed nine permissions, so `casino.bet-settings:create`
 * — the narrowest write the domain grants — also opened provider creation,
 * vendor overrides, VIP game assignment and every category and content
 * screen. Nine separately grantable permissions behaved as one.
 *
 * A mutation absent from this map is refused, not allowed.
 */
export const CASINO_MUTATION_PERMISSIONS: Record<string, RequiredPermission> = {
  // Categories, in both the legacy and current naming.
  createCategory: [['casino.categories', 'create']],
  renameCategory: [['casino.categories', 'update']],
  reorderCategory: [['casino.categories', 'update']],
  deleteCategory: [['casino.categories', 'delete']],
  createCasinoCategory: [['casino.categories', 'create']],
  updateCasinoCategory: [['casino.categories', 'update']],
  deleteCasinoCategory: [['casino.categories', 'delete']],
  reorderCasinoCategories: [['casino.categories', 'update']],
  assignGamesToCategory: [['casino.categories', 'update']],
  saveCasinoLoungeGames: [['casino.categories', 'update']],
  removeGamesFromCategory: [['casino.categories', 'update']],
  reorderCategoryGames: [['casino.categories', 'update']],

  // Providers and the revenue share attached to them.
  createCasinoProvider: [['casino.providers', 'create']],
  updateCasinoProvider: [['casino.providers', 'update']],
  deleteCasinoProvider: [['casino.providers', 'delete']],
  upsertProviderVendorShare: [['casino.providers', 'update']],
  toggleWhitelabelCasinoProvider: [['casino.provider-settings', 'update']],

  // Vendors and their per-whitelabel overrides.
  toggleCasinoVendorEnabled: [['casino.vendors', 'update']],
  bulkUpdateVendorSettings: [['casino.vendors', 'update']],
  updateVendorDisplayOrder: [['casino.vendors', 'update']],
  reorderVendorGames: [['casino.vendors', 'update']],
  setWhitelabelCasinoVendorSuperAdminOverride: [['casino.vendor-overrides', 'update']],
  setWhitelabelCasinoGameSuperAdminOverride: [['casino.game-overrides', 'update']],

  // Games.
  toggleCasinoGameEnabled: [['casino.management', 'update']],
  updateCasinoGameSettings: [['casino.game-overrides', 'update']],
  bulkUpdateCasinoGameSettings: [['casino.game-overrides', 'update']],
  toggleCasinoGameMasterActive: [['casino.management', 'toggle-master']],

  // VIP-restricted games.
  toggleVipTierGameEnabled: [['casino.vip-games', 'update']],
  bulkUpdateVipTierGames: [['casino.vip-games', 'update']],

  // Per-game bet limits.
  upsertCasinoGameBetSettings: [['casino.bet-settings', 'update']],
  deleteCasinoGameBetSettings: [['casino.bet-settings', 'delete']],
  upsertLimit: [['casino.bet-settings', 'update']],

  // Promotions, content and jackpots all live on the casino management screen.
  createPromotion: [['casino.management', 'update']],
  publishPromotion: [['casino.management', 'update']],
  pausePromotion: [['casino.management', 'update']],
  createContent: [['casino.management', 'update']],
  updateContent: [['casino.management', 'update']],
  publishContent: [['casino.management', 'update']],
  pauseJackpot: [['casino.management', 'update']],
  payoutJackpot: [['casino.management', 'update']],

  // Diagnostics and provider round lookup.
  // The two test mutations carry their own `requireDiagnosticAccess`, which is
  // stricter than anything here: platform permission, and off in production.
  createTestCasinoBet: [['casino.management', 'update']],
  settleTestCasinoBet: [['casino.management', 'update']],
  gmagRoundDetail: [['casino.bets', 'view']],
}
function wrapCasinoMutations(mutations: Record<string, (...args: any[]) => any>) {
  return guardMutationMap(mutations, CASINO_MUTATION_PERMISSIONS, {
    label: 'casino',
  })
}

// Helper to convert S3 keys to presigned URLs
async function convertS3KeyToUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null

  // Already a usable URL or data URI (for backward compatibility with base64)
  if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('data:')) {
    return key
  }

  try {
    const { generatePresignedGetUrl, getS3ObjectUrl } = await import('@src/services/storage/s3.js')
    try {
      const presigned = await generatePresignedGetUrl(key, 7 * 24 * 3600) // 7 days
      if (presigned) return presigned
    } catch {}
    return getS3ObjectUrl(key)
  } catch (err) {
    return key
  }
}

export const casinoResolvers = {
  Query: wrapCasinoQueries(casinoQueryResolvers),
  Mutation: wrapCasinoMutations(casinoMutationResolvers),
  Subscription: casinoSubscriptionResolvers,
  // Field resolver for CasinoCategory to convert iconData (S3 key) to presigned URL
  CasinoCategory: {
    iconData: async (parent: any) => convertS3KeyToUrl(parent.iconData),
  },
}
