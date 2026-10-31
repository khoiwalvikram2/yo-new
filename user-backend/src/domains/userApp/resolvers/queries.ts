import { getVipDepositContext } from '@shared/vip/depositAccess.js'
import { intersectDepositLimits } from '@shared/vip/depositPolicy.js'
import { ResolverContext } from '../../../types/context.js'
import { settingsVersion, siteAssetUrl } from '../../../services/siteAssets.js'
import { getStatementPage, type StatementPageInput } from '../../../repos/statementPageRepo.js'
import { isDataUri } from '@shared/utils/dataUri.js'
import {
  getUserDetail,
  getLedgerItems,
  getAppSettings,
  getWhitelabelFeatureFlags,
  getWhitelabelAccounts,
  listUserDepositHistory,
  getCasinoGamesList,
  getCasinoCategoriesList,
  getCasinoProvidersList,
  getBonusAwards,
  getBonusHistory,
  getAvailableBonusCampaigns,
  getReferralProgramForUser,
  getActiveReferralRules,
  getSportsList,
  listWithdrawalRequests,
  listPayoutAccounts,
  listLikedCasinoGames,
  listRecentCasinoGames,
  addRecentCasinoGame,
  listAdvertisements,
  getReferralUsers,
  getReferralTransactions,
  getWeeklyReferralSummary,
  getReferralAggregate,
  listSportsBookmarks,
  listRecentSports,
  getSportsEventDetail,
  getUserBets,
  getCashoutConfig,
  getSportsSettings,
  getUserStakeLimits,
  isLiveTvScoreCardEnabledForTenant,
} from '../../../repos/userAppRepo.js'
import { ensureWallet } from '../../../repos/userRepo.js'
import { getOrCreateMyReferralLink } from '../../../repos/referralRepo.js'
import { CREDIT_PLAYER_REFERRAL_MESSAGE, isCreditPlayerUser } from '../services/playerCreditState.js'
import { AgentBettingBlockedError } from '../services/agentBettingGate.js'
import { vipService } from '../../../services/vipService.js'
import { db } from '../../../db/client.js'
import {
  casinoGames,
  casinoApiProviders,
  whitelabelCasinoVendorSettings,
  whitelabelCasinoGameSettings,
  whitelabelCasinoProviderSettings,
  whitelabelCasinoVendorSuperAdminOverride,
  whitelabelCasinoGameSuperAdminOverride,
  appConfigs,
  whitelabelPgSettings,
} from '@shared/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { isWelivepayAllowedForUser } from '../../../config/env.js'

function metaOk(message = 'ok') {
  return { code: 200, message }
}

function parseDate(input?: string | null) {
  if (!input) return undefined
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export const userAppQueryResolvers = {
  statementPage: async (_: unknown, args: { input: StatementPageInput }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized', total: 0, page: 1, hasMore: false }, data: [], walletTypes: [] }
    return getStatementPage(ctx.auth.userId, ctx.auth.tenant, args.input)
  },
  userDetail: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const detail = await getUserDetail(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data: detail }
  },
  accountStatement: async (_: unknown, args: { startDate: string; endDate: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const start = parseDate(args.startDate)
    const end = parseDate(args.endDate)
    const items = await getLedgerItems(ctx.auth.userId, ctx.auth.tenant, start, end)
    return { meta: metaOk(), data: items }
  },
  resultTransactions: async (_: unknown, args: { startDate: string; endDate: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const start = parseDate(args.startDate)
    const end = parseDate(args.endDate)
    const { getCasinoAndSportsBets } = await import('../../../repos/userAppRepo.js')
    const items = await getCasinoAndSportsBets(ctx.auth.userId, ctx.auth.tenant, start, end)
    return { meta: metaOk(), data: items }
  },
  appSettingsVersion: async (_: unknown, __: unknown, ctx: ResolverContext) => settingsVersion(await getAppSettings(ctx.auth.requestTenant, ctx.auth.userId || undefined)),
  appSettings: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const data = await getAppSettings(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    return { meta: metaOk(), version: settingsVersion(data), data: data.map(item => ({ ...item, value: siteAssetUrl(item.value, ctx.auth.requestTenant, 'settings') })) }
  },
  allAppSettings: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const data = await getAppSettings(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    return { meta: metaOk(), version: settingsVersion(data), data: data.map(item => ({ ...item, value: siteAssetUrl(item.value, ctx.auth.requestTenant, 'settings') })) }
  },
  advertisements: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const data = await listAdvertisements(ctx.auth.requestTenant)
    return { meta: metaOk(), data: data.map(ad => ({ ...ad, image: siteAssetUrl(ad.image, ctx.auth.requestTenant, 'advertisements') })) }
  },
  withdrawalRequests: async (_: unknown, args: { startDate?: string; endDate?: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const start = parseDate(args.startDate)
    const end = parseDate(args.endDate)
    const data = await listWithdrawalRequests({ userId: ctx.auth.userId, tenant: ctx.auth.tenant, start, end })
    return {
      meta: metaOk(),
      data: data.map((row) => ({
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        status: row.status,
        accountId: row.account?.id ? String(row.account.id) : row.payoutAccountId ? String(row.payoutAccountId) : null,
        accountNumber: row.account?.accountNumber ?? null,
        accountHolderName: row.account?.accountHolderName ?? null,
        method: row.account?.method ?? null,
        ifscCode: row.account?.ifscCode ?? null,
        currency: row.currency ?? 'INR',
        note: row.note ?? null,
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      })),
    }
  },
  welivepayConfig: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    // Public (per-tenant) WeLivePay availability for the deposit UI. Never exposes the
    // secret key or webhook token. enabled implies a key is configured (enforced on the
    // admin side), so the user app can safely show the instant-UPI option only when enabled.
    // TEMP test gate: WELIVEPAY_ALLOWED_USER_IDS restricts to specific users (unset = all).
    if (!ctx.auth.userId || !isWelivepayAllowedForUser(ctx.auth.userId)) {
      return { enabled: false, displayName: 'UPI (Instant)', minAmount: null, maxAmount: null }
    }
    const [s] = await db.select({
      enabled: whitelabelPgSettings.enabled,
      displayName: whitelabelPgSettings.displayName,
      minDeposit: whitelabelPgSettings.minDeposit,
      maxDeposit: whitelabelPgSettings.maxDeposit,
      hasKey: whitelabelPgSettings.secretSiteKeyEncrypted,
    }).from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, ctx.auth.tenant)).limit(1)
    if (!s) return { enabled: false, displayName: 'UPI (Instant)', minAmount: null, maxAmount: null }
    const access = await getVipDepositContext(db, ctx.auth.tenant, ctx.auth.userId).catch(() => null)
    const limits = access ? intersectDepositLimits([access.baseLimits, {
      min: s.minDeposit == null ? 10 : Number(s.minDeposit), max: s.maxDeposit == null ? null : Number(s.maxDeposit),
    }]) : null
    return {
      enabled: Boolean(s.enabled && s.hasKey && access?.policy.enabled && access.policy.methods.includes('GATEWAY') && limits?.available),
      displayName: s.displayName,
      minAmount: limits?.min ?? null,
      maxAmount: limits?.max ?? null,
    }
  },
  adminAccounts: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const accounts = await getWhitelabelAccounts(ctx.auth.tenant, ctx.auth.userId)
    const enrichedAccounts = await Promise.all(
      accounts.map(async (a) => {
        if (a.type === 'upi' && a.qrKey && !a.qrUrl) {
          // QR images are stored inline as base64 data URIs. A data URI is already
          // displayable and must never be presigned — that would sign a nonexistent
          // key and render a broken image on the player deposit screen. Legacy rows
          // still hold an S3 key and are signed as before until the backfill runs.
          if (isDataUri(a.qrKey)) {
            return { ...a, qrUrl: a.qrKey, source: 'whitelabel' as const }
          }
          try {
            const { generatePresignedGetUrl } = await import('../../../services/storage/s3.js')
            const qrUrl = await generatePresignedGetUrl(a.qrKey, 3600)
            return { ...a, qrUrl, source: 'whitelabel' as const }
          } catch {
            return { ...a, source: 'whitelabel' as const }
          }
        }
        return { ...a, source: 'whitelabel' as const }
      })
    )
    return { meta: metaOk(), data: enrichedAccounts.map(account => ({ ...account, qrUrl: siteAssetUrl(account.qrUrl, ctx.auth.requestTenant, 'payments') })) }
  },
  adminDepositRequests: async (_: unknown, args: { startDate?: string; endDate?: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const start = parseDate(args.startDate)
    const end = parseDate(args.endDate)
    // Unified history: manual deposits + every WeLivePay attempt (pending/success/expired/invalid).
    const data = await listUserDepositHistory({ userId: ctx.auth.userId, tenant: ctx.auth.tenant, start, end })
    return {
      meta: metaOk(),
      data: data.map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        createdAt: row.createdAt,
        utr: row.utr,
        method: row.method,
        provider: row.provider,
        expiresAt: row.expiresAt,
      })),
    }
  },
  accountDetails: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const rows = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    return {
      meta: metaOk(),
      data: rows.map((r) => ({
        id: String(r.id),
        accountNumber: r.accountNumber,
        ifscCode: r.ifscCode,
        accountType: r.method === 'UPI' ? 'upi' : 'bank',
        type: r.method === 'UPI' ? 'upi' : 'bank',
        bankName: r.bankName,
        accountHolderName: r.accountHolderName,
        isPrimary: r.isPrimary,
        approvalStatus: r.approvalStatus ?? 'PENDING',
        rejectionReason: r.rejectionReason ?? null,
      })),
    }
  },
  casinoGames: async (_: unknown, args: { input?: { search?: string; provider?: string; providers?: string[]; category?: string; categoryType?: string; limit?: number; page?: number; slots?: boolean; liveOnly?: boolean; cursor?: string } }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) {
      return { meta: { code: 200, message: 'ok', total: 0, page: 1, hasMore: false }, data: [] }
    }
    const data = await getCasinoGamesList({
      tenant: ctx.auth.requestTenant,
      search: args.input?.search,
      provider: args.input?.provider,
      providers: args.input?.providers,
      category: args.input?.category,
      categoryType: args.input?.categoryType,
      limit: args.input?.limit,
      page: args.input?.page,
      slots: args.input?.slots,
      liveOnly: args.input?.liveOnly,
    })
    const total = data.total ?? (data[0] as any)?.total ?? data.length
    const page = data.page ?? (data[0] as any)?.page ?? 1
    const hasMore = data.hasMore ?? (data[0] as any)?.hasMore ?? false
    return { meta: { code: 200, message: 'ok', total, page, hasMore }, data }
  },
  casinoCategories: async (_: unknown, args: { liveOnly?: boolean; slotsOnly?: boolean }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: metaOk(), data: [] }
    const data = await getCasinoCategoriesList({ tenant: ctx.auth.requestTenant, liveOnly: args.liveOnly, slotsOnly: args.slotsOnly })
    return { meta: metaOk(), data }
  },
  casinoProviders: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: metaOk(), data: [] }
    const data = await getCasinoProvidersList(ctx.auth.requestTenant)
    return { meta: metaOk(), data }
  },
  casinoSummary: async (_: unknown, args: { input?: { limit?: number; slots?: boolean; liveOnly?: boolean; provider?: string; providers?: string[] } }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: metaOk(), data: [] }
    const data = await getCasinoGamesList({
      tenant: ctx.auth.requestTenant,
      limit: args.input?.limit ?? 20,
      slots: args.input?.slots,
      liveOnly: args.input?.liveOnly,
      provider: args.input?.provider,
      providers: args.input?.providers,
    })
    return { meta: metaOk(), data }
  },
  recentCasinoGames: async (_: unknown, args: { limit?: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: metaOk(), data: [] }
    const data = await listRecentCasinoGames(ctx.auth.userId, ctx.auth.requestTenant, args.limit ?? 20)
    return { meta: metaOk(), data }
  },
  likedCasinoGames: async (_: unknown, args: { limit?: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: metaOk(), data: [] }
    const data = await listLikedCasinoGames(ctx.auth.userId, ctx.auth.requestTenant)
    return { meta: metaOk(), data }
  },
  gapCasinoUrl: async (_: unknown, args: { gameId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: { code: 403, message: 'Casino is not available for your whitelabel' }, data: null }
    const appConfig = await db.query.appConfigs.findFirst({
      where: eq(appConfigs.whitelabelId, ctx.auth.requestTenant),
    })
    const casinoConfig = {} as { visibleVendors?: string[]; visibleProviders?: string[] }
    const visibleVendors = (casinoConfig?.visibleVendors || []).map((id: string) => Number(id)).filter((id: number) => !isNaN(id))
    const visibleProviders = (casinoConfig?.visibleProviders || []).map((id: string) => Number(id)).filter((id: number) => !isNaN(id))

    const game = await db
      .select({
        id: casinoGames.id,
        vendorId: casinoGames.vendorId,
        apiProviderId: casinoGames.apiProviderId,
        externalId: casinoGames.externalId,
      })
      .from(casinoGames)
      .where(eq(casinoGames.externalId, args.gameId))
      .limit(1)
      .then(rows => rows[0] || null)

    if (!game) {
      return { meta: { code: 404, message: 'Game not found' }, data: null }
    }

    const vendorSetting = await db
      .select({ enabled: whitelabelCasinoVendorSettings.enabled })
      .from(whitelabelCasinoVendorSettings)
      .where(and(
        eq(whitelabelCasinoVendorSettings.vendorId, game.vendorId),
        eq(whitelabelCasinoVendorSettings.tenantId, ctx.auth.requestTenant)
      ))
      .limit(1)
      .then(rows => rows[0] || null)

    if (vendorSetting && vendorSetting.enabled === false) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    if (visibleVendors.length > 0 && !visibleVendors.includes(game.vendorId)) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    if (visibleProviders.length > 0 && game.apiProviderId && !visibleProviders.includes(game.apiProviderId)) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }

    const gameSetting = await db
      .select({ enabled: whitelabelCasinoGameSettings.enabled })
      .from(whitelabelCasinoGameSettings)
      .where(and(
        eq(whitelabelCasinoGameSettings.gameId, game.id),
        eq(whitelabelCasinoGameSettings.tenantId, ctx.auth.requestTenant)
      ))
      .limit(1)
      .then(rows => rows[0] || null)

    if (gameSetting && gameSetting.enabled === false) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }

    if (ctx.auth.userId && args.gameId) {
      try {
        await addRecentCasinoGame(ctx.auth.userId, ctx.auth.requestTenant, args.gameId)
      } catch (err) {
      }
    }

    try {
      const { getGapCasinoRedirectUrl } = await import('../../casino/gapCasinoLaunchService.js')
      const userDetail = await getUserDetail(ctx.auth.userId, ctx.auth.tenant)
      const request = (ctx as { request?: { headers?: Record<string, string> } }).request
      const headers = request?.headers ?? {}
      const h = headers['x-wallet-type']
      const walletType = h === 'referralBonus' ? 'referralBonus' : h === 'bonus' ? 'bonus' : 'balance'
      const result = await getGapCasinoRedirectUrl({
        userId: ctx.auth.userId,
        tenant: ctx.auth.requestTenant,
        gameId: args.gameId,
        walletType,
        username: userDetail?.name ?? userDetail?.username ?? 'User',
        userAgent: headers['user-agent'],
        clientIp: headers['x-forwarded-for'] ?? headers['x-real-ip'],
      })
      return { meta: metaOk(), data: { redirectUrl: result.redirectUrl } }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Casino launch failed'
      const stack = err instanceof Error ? err.stack : undefined
      // A blocked agent branch is a refusal, not a provider failure; its message is player-safe.
      if (err instanceof AgentBettingBlockedError) return { meta: { code: 403, message }, data: null }
      return { meta: { code: 502, message }, data: null }
    }
  },
  casinoUrl: async (_: unknown, args: { gameId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const tenant = ctx.auth.requestTenant

    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: { code: 403, message: 'Casino is not available for your whitelabel' }, data: null }
    const gameRow = await db
      .select({
        id: casinoGames.id,
        vendorId: casinoGames.vendorId,
        apiProviderId: casinoGames.apiProviderId,
        externalId: casinoGames.externalId,
        providerKey: casinoApiProviders.key,
      })
      .from(casinoGames)
      .innerJoin(casinoApiProviders, eq(casinoGames.apiProviderId, casinoApiProviders.id))
      .where(eq(casinoGames.externalId, args.gameId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!gameRow) {
      return { meta: { code: 404, message: 'Game not found' }, data: null }
    }
    const providerSetting = await db
      .select({ enabled: whitelabelCasinoProviderSettings.enabled })
      .from(whitelabelCasinoProviderSettings)
      .where(
        and(
          eq(whitelabelCasinoProviderSettings.tenantId, tenant),
          eq(whitelabelCasinoProviderSettings.providerId, gameRow.apiProviderId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (providerSetting && providerSetting.enabled === false) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    const vendorSetting = await db
      .select({ enabled: whitelabelCasinoVendorSettings.enabled })
      .from(whitelabelCasinoVendorSettings)
      .where(
        and(
          eq(whitelabelCasinoVendorSettings.vendorId, gameRow.vendorId),
          eq(whitelabelCasinoVendorSettings.tenantId, tenant)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (vendorSetting && vendorSetting.enabled === false) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    const gameSetting = await db
      .select({ enabled: whitelabelCasinoGameSettings.enabled })
      .from(whitelabelCasinoGameSettings)
      .where(
        and(
          eq(whitelabelCasinoGameSettings.gameId, gameRow.id),
          eq(whitelabelCasinoGameSettings.tenantId, tenant)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (gameSetting && gameSetting.enabled === false) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    const vendorOverride = await db
      .select({ disabled: whitelabelCasinoVendorSuperAdminOverride.disabled })
      .from(whitelabelCasinoVendorSuperAdminOverride)
      .where(
        and(
          eq(whitelabelCasinoVendorSuperAdminOverride.tenantId, tenant),
          eq(whitelabelCasinoVendorSuperAdminOverride.vendorId, gameRow.vendorId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (vendorOverride?.disabled === true) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    const gameOverride = await db
      .select({ disabled: whitelabelCasinoGameSuperAdminOverride.disabled })
      .from(whitelabelCasinoGameSuperAdminOverride)
      .where(
        and(
          eq(whitelabelCasinoGameSuperAdminOverride.tenantId, tenant),
          eq(whitelabelCasinoGameSuperAdminOverride.gameId, gameRow.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (gameOverride?.disabled === true) {
      return { meta: { code: 403, message: 'This game is not available for your whitelabel' }, data: null }
    }
    if (ctx.auth.userId && args.gameId) {
      try {
        await addRecentCasinoGame(ctx.auth.userId, ctx.auth.requestTenant, args.gameId)
      } catch (err) {
      }
    }
    const request = (ctx as { request?: { headers?: Record<string, string> } }).request
    const headers = request?.headers ?? {}
    const h = headers['x-wallet-type']
    const walletType = h === 'referralBonus' ? 'referralBonus' : h === 'bonus' ? 'bonus' : 'balance'
    const userDetail = await getUserDetail(ctx.auth.userId, ctx.auth.tenant)
    try {
      if (gameRow.providerKey === 'gmagcasino') {
        const { getGmagCasinoRedirectUrl } = await import('../../casino/gmagCasinoLaunchService.js')
        const result = await getGmagCasinoRedirectUrl({
          userId: ctx.auth.userId,
          tenant,
          gameId: args.gameId,
          walletType,
          username: userDetail?.name ?? userDetail?.username ?? 'User',
          userAgent: headers['user-agent'],
          clientIp: headers['x-forwarded-for'] ?? headers['x-real-ip'],
        })
        return { meta: metaOk(), data: { redirectUrl: result.redirectUrl } }
      }
      const { getGapCasinoRedirectUrl } = await import('../../casino/gapCasinoLaunchService.js')
      const result = await getGapCasinoRedirectUrl({
        userId: ctx.auth.userId,
        tenant,
        gameId: args.gameId,
        walletType,
        username: userDetail?.name ?? userDetail?.username ?? 'User',
        userAgent: headers['user-agent'],
        clientIp: headers['x-forwarded-for'] ?? headers['x-real-ip'],
      })
      return { meta: metaOk(), data: { redirectUrl: result.redirectUrl } }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Casino launch failed'
      // A blocked agent branch is a refusal, not a provider failure; its message is player-safe.
      if (err instanceof AgentBettingBlockedError) return { meta: { code: 403, message }, data: null }
      console.warn('[Casino Launch] Error', { message, stack: err instanceof Error ? err.stack : undefined })
      return { meta: { code: 502, message }, data: null }
    }
  },
  bonusData: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getBonusAwards(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  bonusHistory: async (_: unknown, args: { status?: string; fromDate?: string; toDate?: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getBonusHistory(ctx.auth.userId, ctx.auth.tenant, {
      status: args.status,
      fromDate: parseDate(args.fromDate),
      toDate: parseDate(args.toDate),
    })
    return { meta: metaOk(), data }
  },
  availableBonusCampaigns: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getAvailableBonusCampaigns(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  referralProgram: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const data = await getReferralProgramForUser(ctx.auth.requestTenant)
    return { meta: metaOk(), data }
  },
  activeReferralRules: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getActiveReferralRules(ctx.auth.requestTenant)
    return { meta: metaOk(), data }
  },
  referralUsers: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getReferralUsers(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  referralTransactions: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getReferralTransactions(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  weeklyReferralSummary: async (_: unknown, __: { startDate: string; endDate: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getWeeklyReferralSummary(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  referralAggregate: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await getReferralAggregate(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data }
  },
  myReferralLink: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    try {
      // Credit players cannot take cash out, so referral rewards would be money that can never leave.
      if (await isCreditPlayerUser(ctx.auth.userId, ctx.auth.tenant)) {
        return { meta: { code: 403, message: CREDIT_PLAYER_REFERRAL_MESSAGE }, data: null }
      }
      const { getAppConfig } = await import('../../../config/app.js')
      const config = getAppConfig()
      const baseUrl = (config.userAppBaseUrl ?? '').trim() || '/'
      const result = await getOrCreateMyReferralLink(ctx.auth.userId, ctx.auth.requestTenant, baseUrl)
      return { meta: metaOk(), data: { code: result.code, url: result.url } }
    } catch (err: any) {
      return { meta: { code: 500, message: err?.message || 'Failed to get referral link' }, data: null }
    }
  },
  sportsList: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) {
      return { meta: { code: 200, message: 'ok', total: 0, page: 1, hasMore: false }, data: [] }
    }
    const data = await getSportsList(ctx.auth.requestTenant)
    const total = Array.isArray(data) ? data.length : undefined
    return { meta: { code: 200, message: 'ok', total, page: 1, hasMore: false }, data }
  },
  sportsEventDetail: async (_: unknown, args: { eventId: string }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: { code: 404, message: 'Event not found' }, data: null }
    const data = await getSportsEventDetail(args.eventId, ctx.auth.requestTenant)
    if (!data) return { meta: { code: 404, message: 'Event not found' }, data: null }
    return { meta: metaOk(), data }
  },
  sportsBookmarks: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: metaOk(), data: [] }
    const rows = await listSportsBookmarks(ctx.auth.userId, ctx.auth.requestTenant)
    return { meta: metaOk(), data: rows.map((r) => ({ eventId: r.eventId, meta: r.meta })) }
  },
  recentSports: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: metaOk(), data: [] }
    const rows = await listRecentSports(ctx.auth.userId, ctx.auth.requestTenant)
    return { meta: metaOk(), data: rows.map((r) => ({ eventId: r.eventId, meta: r.meta })) }
  },
  vipStatus: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const status = await vipService.getUserVipStatus(ctx.auth.userId, ctx.auth.tenant)
    if (!status) {
      // 403 tells the VIP page to leave, as it already does for credit player types.
      if (!(await vipService.isVipEligible(ctx.auth.userId, ctx.auth.tenant)))
        return { meta: { code: 403, message: 'VIP is not available for this account' }, data: null }
      return { meta: { code: 404, message: 'VIP membership not found' }, data: null }
    }
    return {
      meta: metaOk(),
      data: {
        id: status.id,
        tierId: status.tierId,
        tierName: status.tierName,
        tierLevel: status.tierLevel,
        tierColor: status.tierColor,
        currentPoints: status.currentPoints,
        lifetimePoints: status.lifetimePoints,
        monthlyDeposits: status.monthlyDeposits,
        nextTier: status.nextTier,
        pointsToNextTier: status.pointsToNextTier,
        joinedAt: status.joinedAt instanceof Date ? status.joinedAt.toISOString() : String(status.joinedAt),
        benefits: status.benefits,
        perks: status.perks,
      },
    }
  },
  vipTiers: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const tiers = await vipService.getAllVipTiers(ctx.auth.requestTenant)
    return {
      meta: metaOk(),
      data: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        level: t.level,
        minMonthlyDeposit: t.minMonthlyDeposit,
        color: t.color,
        benefits: t.benefits,
        perks: t.perks,
      })),
    }
  },
  userBets: async (_: unknown, args: { eventId?: string | null; marketIds?: string[] | null; openOnly?: boolean | null }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) {
      return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    }
    const bets = await getUserBets(ctx.auth.userId, ctx.auth.tenant, args.eventId, args.marketIds, args.openOnly === true)
    return { meta: metaOk(), data: bets }
  },
  cashoutConfig: async (_: unknown, args: { eventId: string }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return false
    // Get user's tierId (default to 'default' if not VIP)
    let tierId = 'default'
    if (ctx.auth.userId) {
      try {
        const vipStatus = await vipService.getUserVipStatus(ctx.auth.userId, ctx.auth.tenant)
        if (vipStatus?.tierId) {
          tierId = vipStatus.tierId
        }
      } catch {
        // If VIP check fails, use default tier
      }
    }
    
    const isEnabled = await getCashoutConfig(args.eventId, ctx.auth.requestTenant, tierId)
    return isEnabled
  },
  sportsSettings: async (_: unknown, args: { sportId: string; leagueId: string; eventId: string }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: { code: 404, message: 'Settings not found' }, data: null }
    // Get user's tierId (default to 'default' if not VIP)
    let tierId = 'default'
    if (ctx.auth.userId) {
      try {
        const vipStatus = await vipService.getUserVipStatus(ctx.auth.userId, ctx.auth.tenant)
        if (vipStatus?.tierId) {
          tierId = vipStatus.tierId
        }
      } catch {
        // If VIP check fails, use default tier
      }
    }
    
    const settings = await getSportsSettings(args.eventId, ctx.auth.requestTenant, tierId)
    
    if (!settings) {
      return { meta: { code: 404, message: 'Settings not found' }, data: null }
    }
    
    return { meta: metaOk(), data: settings }
  },
  myStakeLimits: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) {
      return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    }
    const limits = await getUserStakeLimits(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data: limits }
  },
  /** Live TV and Score Card URLs. Only for grandwinn-com; kondareddi-com and other tenants get null URLs. */
  sportsExtraUrls: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    const enabled = isLiveTvScoreCardEnabledForTenant(ctx.auth.requestTenant)
    const data = enabled
      ? {
          liveTvUrl: process.env.LIVE_TV_URL ?? null,
          scoreCardUrl: process.env.SCORE_CARD_URL ?? null,
        }
      : { liveTvUrl: null, scoreCardUrl: null }
    return { meta: metaOk(), data }
  },
}

