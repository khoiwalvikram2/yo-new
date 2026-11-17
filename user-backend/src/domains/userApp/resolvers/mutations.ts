import { ResolverContext } from '../../../types/context.js'
import {
  createDepositRequest,
  getWhitelabelAccounts,
  getWhitelabelFeatureFlags,
  listUserDepositHistory,
  getBonusAwards,
  activateBonusAward,
  claimBonusAward,
  forfeitBonusAward,
  redeemBonusCode,
  claimBonusCampaign,
  switchBonusAward,
  getSportsList,
  logLedgerEvent,
  createWithdrawalRequest,
  createOrUpdatePayoutAccount,
  deletePayoutAccount,
  listPayoutAccounts,
  toggleCasinoLike,
  addRecentCasinoGame,
  toggleSportsBookmark,
  addRecentSportsEvent,
  listSportsBookmarks,
  listRecentSports,
  updateWithdrawalStatus,
  getWithdrawalRequest,
  setPrimaryPayoutAccount,
  generateFancyOdds,
  listWithdrawalRequests,
  getUserDetail,
} from '../../../repos/userAppRepo.js'
import { depositProofFields } from '../services/depositProof.js'
import { displayableAsset } from '@shared/utils/dataUri.js'
import { createWelivepayDeposit as createWelivepayDepositService } from '../../../services/welivepayDepositService.js'
import { ensureWallet } from '../../../repos/userRepo.js'
import { executeClaimReferralBonus, recordReferralClickByCode } from '../../../repos/referralRepo.js'
import { placeSportsBetForUser, PlaceSportsBetInput } from '../services/sportsBetService.js'
import { recalculateAndUpdateExposure, getExposureBreakdown } from '../services/exposureCalculationService.js'
import {
  CREDIT_PLAYER_REFERRAL_MESSAGE,
  isCreditPlayerUser,
} from '../services/playerCreditState.js'

function metaOk(message = 'ok') {
  return { code: 200, message }
}

// Simple in-memory rate limit for trackReferralClick (per IP, 10 per minute)
const trackReferralClickCounts = new Map<string, number[]>()
const TRACK_CLICK_RATE_LIMIT = 10
const TRACK_CLICK_WINDOW_MS = 60 * 1000

function checkTrackReferralClickRateLimit(ip: string | undefined): boolean {
  if (!ip) return true
  const now = Date.now()
  let times = trackReferralClickCounts.get(ip) ?? []
  times = times.filter((t) => now - t < TRACK_CLICK_WINDOW_MS)
  if (times.length >= TRACK_CLICK_RATE_LIMIT) return false
  times.push(now)
  trackReferralClickCounts.set(ip, times)
  return true
}

function parseDate(input?: string | null) {
  if (!input) return undefined
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export const userAppMutationResolvers = {
  createWithdrawalRequest: async (_: unknown, args: { accountId: string; amount: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    try {
      const record = await createWithdrawalRequest({
        userId: ctx.auth.userId,
        tenant: ctx.auth.tenant,
        amount: args.amount,
        accountId: args.accountId,
      })
      return {
        meta: metaOk('Withdrawal request captured'),
        data: [
          {
            id: String(record.id),
            amount: Number(record.amount ?? 0),
            status: record.status,
            accountId: record.account?.id ? String(record.account.id) : record.payoutAccountId ? String(record.payoutAccountId) : null,
            accountNumber: record.account?.accountNumber ?? null,
            accountHolderName: record.account?.accountHolderName ?? null,
            method: record.account?.method ?? null,
            ifscCode: record.account?.ifscCode ?? null,
            currency: record.currency ?? 'INR',
            createdAt: record.createdAt?.toISOString?.() ?? new Date().toISOString(),
          },
        ],
      }
    } catch (err: any) {
      return { meta: { code: 400, message: err?.message || 'Failed to create withdrawal' }, data: [] }
    }
  },
  getWithdrawalRequests: async (_: unknown, args: { startDate?: string; endDate?: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const start = parseDate(args.startDate)
    const end = parseDate(args.endDate)
    const rows = await listWithdrawalRequests({ userId: ctx.auth.userId, tenant: ctx.auth.tenant, start, end })
    return {
      meta: metaOk(),
      data: rows.map((row: any) => ({
        id: String(row.id),
        amount: Number(row.amount ?? 0),
        status: row.status,
        accountId: row.account?.id ? String(row.account.id) : row.payoutAccountId ? String(row.payoutAccountId) : null,
        accountNumber: row.account?.accountNumber ?? null,
        accountHolderName: row.account?.accountHolderName ?? null,
        method: row.account?.method ?? null,
        ifscCode: row.account?.ifscCode ?? null,
        currency: row.currency ?? 'INR',
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      })),
    }
  },
  getAdminAccounts: async (_: unknown, args: { includeCrypto?: boolean | null }, ctx: ResolverContext) => {
    const data = await getWhitelabelAccounts(ctx.auth.tenant, ctx.auth.userId, { includeCrypto: args?.includeCrypto === true })
    // S3 is gone: a QR link that is a legacy S3 URL can no longer be fetched and is sent as null (see adminAccounts).
    return { meta: metaOk(), data: data.map((account: any) => ({ ...account, qrUrl: displayableAsset(account.qrUrl) })) }
  },
  createAdminDeposit: async (
    _: unknown,
    args: { accountId: string; amount: number; txnRef?: string; proofKey?: string; type?: string },
    ctx: ResolverContext
  ) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const type = (args.type || '').toLowerCase()
    const method: 'BANK_TRANSFER' | 'UPI' | 'CRYPTO' = type === 'crypto' ? 'CRYPTO' : type === 'upi' ? 'UPI' : 'BANK_TRANSFER'
    const txnRef = args.txnRef?.trim() || undefined
    // `proofKey` carries the screenshot as a base64 image data URI (no more S3 keys). A value that is not one is
    // refused with a message for the player (thrown, like every other refusal here), never stored as a key.
    const { proofKey, proofData } = depositProofFields(args.proofKey, txnRef)
    // CRYPTO: the repo requires the hash, checks the test gate and quotes the USDT itself.
    const row = await createDepositRequest({
      userId: ctx.auth.userId,
      tenant: ctx.auth.tenant,
      amount: args.amount,
      accountId: args.accountId,
      method,
      utr: txnRef,
      referenceId: txnRef,
      proofKey,
      proofData,
    })
    return {
      meta: metaOk('Deposit request created'),
      data: [
        {
          id: String(row.id),
          amount: Number(row.amount ?? 0),
          status: row.status,
          createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
          utr: row.utr,
          method: row.method,
          cryptoAmount: row.cryptoAmount != null ? Number(row.cryptoAmount) : null,
          cryptoRate: row.cryptoRate != null ? Number(row.cryptoRate) : null,
          cryptoNetwork: row.cryptoNetwork ?? null,
          cryptoBonusAmount: row.cryptoBonusAmount != null ? Number(row.cryptoBonusAmount) : null,
        },
      ],
    }
  },
  createDeposit: async (_: unknown, args: { amount: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: { redirectUrl: '/' } }
    const result = await createWelivepayDepositService({ userId: ctx.auth.userId, tenant: ctx.auth.tenant, amount: args.amount })
    return { meta: metaOk('Deposit initiated'), data: { redirectUrl: result.paymentLink } }
  },
  getAdminDepositRequests: async (_: unknown, args: { startDate?: string; endDate?: string }, ctx: ResolverContext) => {
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
        cryptoAmount: row.cryptoAmount,
        cryptoRate: row.cryptoRate,
        cryptoNetwork: row.cryptoNetwork,
        cryptoBonusAmount: row.cryptoBonusAmount,
      })),
    }
  },
  createAccountDetails: async (_: unknown, args: { accountNumber: string; ifscCode?: string; accountType?: string; type?: string; bankName?: string; accountHolderName: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const method = (args.type || args.accountType || '').toUpperCase() === 'UPI' ? 'UPI' : 'BANK'
    const existing = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    const hasPrimary = existing.some((r) => r.isPrimary)
    await createOrUpdatePayoutAccount({
      userId: ctx.auth.userId,
      tenant: ctx.auth.tenant,
      method,
      accountNumber: args.accountNumber,
      ifscCode: args.ifscCode,
      bankName: args.bankName,
      accountHolderName: args.accountHolderName,
      setPrimary: !hasPrimary,
    })
    const rows = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    return {
      meta: metaOk('Account saved'),
      data: rows.map((r) => ({
        id: String(r.id),
        accountNumber: r.accountNumber,
        ifscCode: r.ifscCode,
        accountType: r.method === 'UPI' ? 'upi' : 'bank',
        type: r.method === 'UPI' ? 'upi' : 'bank',
        bankName: r.bankName,
        accountHolderName: r.accountHolderName,
        approvalStatus: r.approvalStatus ?? 'PENDING',
        rejectionReason: r.rejectionReason ?? null,
      })),
    }
  },
  updateAccountDetails: async (_: unknown, args: { accountId: string; accountNumber?: string; ifscCode?: string; accountType?: string; bankName?: string; accountHolderName?: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const method = (args.accountType || '').toUpperCase() === 'UPI' ? 'UPI' : 'BANK'
    await createOrUpdatePayoutAccount({
      userId: ctx.auth.userId,
      tenant: ctx.auth.tenant,
      accountId: Number(args.accountId),
      method,
      accountNumber: args.accountNumber ?? '',
      ifscCode: args.ifscCode,
      bankName: args.bankName,
      accountHolderName: args.accountHolderName ?? '',
      setPrimary: true,
    })
    const rows = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    return {
      meta: metaOk('Account updated'),
      data: rows.map((r) => ({
        id: String(r.id),
        accountNumber: r.accountNumber,
        ifscCode: r.ifscCode,
        accountType: r.method === 'UPI' ? 'upi' : 'bank',
        type: r.method === 'UPI' ? 'upi' : 'bank',
        bankName: r.bankName,
        accountHolderName: r.accountHolderName,
        approvalStatus: r.approvalStatus ?? 'PENDING',
        rejectionReason: r.rejectionReason ?? null,
      })),
    }
  },
  deleteAccountDetails: async (_: unknown, args: { accountId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    await deletePayoutAccount(Number(args.accountId), ctx.auth.userId, ctx.auth.tenant)
    const rows = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    return {
      meta: metaOk('Account deleted'),
      data: rows.map((r) => ({
        id: String(r.id),
        accountNumber: r.accountNumber,
        ifscCode: r.ifscCode,
        accountType: r.method === 'UPI' ? 'upi' : 'bank',
        type: r.method === 'UPI' ? 'upi' : 'bank',
        bankName: r.bankName,
        accountHolderName: r.accountHolderName,
        approvalStatus: r.approvalStatus ?? 'PENDING',
        rejectionReason: r.rejectionReason ?? null,
      })),
    }
  },
  setPrimaryAccount: async (_: unknown, args: { accountId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    await setPrimaryPayoutAccount(Number(args.accountId), ctx.auth.userId, ctx.auth.tenant)
    const rows = await listPayoutAccounts(ctx.auth.userId, ctx.auth.tenant)
    return {
      meta: metaOk('Primary updated'),
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
  changeWallet: async (_: unknown, args: { selectedWallet: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    const detail = await getUserDetail(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk(), data: detail }
  },
  likeCasinoGame: async (_: unknown, args: { gameId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: { redirectUrl: `/casino/${args.gameId}` } }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: { code: 403, message: 'Casino is not available for your whitelabel' }, data: null }
    await toggleCasinoLike(ctx.auth.userId, ctx.auth.requestTenant, args.gameId)
    await addRecentCasinoGame(ctx.auth.userId, ctx.auth.requestTenant, args.gameId)
    return { meta: metaOk('Liked'), data: { redirectUrl: `/casino/${args.gameId}` } }
  },
  unlikeCasinoGame: async (_: unknown, args: { gameId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: { redirectUrl: `/casino/${args.gameId}` } }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.casinoEnabled) return { meta: { code: 403, message: 'Casino is not available for your whitelabel' }, data: null }
    await toggleCasinoLike(ctx.auth.userId, ctx.auth.requestTenant, args.gameId)
    return { meta: metaOk('Unliked'), data: { redirectUrl: `/casino/${args.gameId}` } }
  },
  activateBonus: async (_: unknown, args: { bonusId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const bonusId = Number(args.bonusId)
    if (isNaN(bonusId)) return { meta: { code: 400, message: 'Invalid bonus ID' }, data: [] }
    const data = await activateBonusAward(bonusId, ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk('Bonus activated'), data }
  },
  forfeitBonus: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await forfeitBonusAward(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk('Bonus forfeited'), data }
  },
  claimBonus: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const data = await claimBonusAward(ctx.auth.userId, ctx.auth.tenant)
    return { meta: metaOk('Bonus claimed'), data }
  },
  redeemBonusCode: async (_: unknown, args: { code: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    try {
      const data = await redeemBonusCode(args.code, ctx.auth.userId, ctx.auth.tenant)
      return { meta: metaOk('Bonus code redeemed successfully'), data }
    } catch (error: any) {
      return { meta: { code: 400, message: error?.message || 'Failed to redeem bonus code' }, data: [] }
    }
  },
  claimBonusCampaign: async (_: unknown, args: { campaignId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const campaignId = Number(args.campaignId)
    if (isNaN(campaignId)) return { meta: { code: 400, message: 'Invalid campaign ID' }, data: [] }
    try {
      const data = await claimBonusCampaign(campaignId, ctx.auth.userId, ctx.auth.tenant)
      return { meta: metaOk('Bonus campaign claimed successfully'), data }
    } catch (error: any) {
      return { meta: { code: 400, message: error?.message || 'Failed to claim bonus campaign' }, data: [] }
    }
  },
  switchBonus: async (_: unknown, args: { newBonusId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const newBonusId = Number(args.newBonusId)
    if (isNaN(newBonusId)) return { meta: { code: 400, message: 'Invalid bonus ID' }, data: [] }
    try {
      const data = await switchBonusAward(newBonusId, ctx.auth.userId, ctx.auth.tenant)
      return { meta: metaOk('Bonus switched successfully'), data }
    } catch (error: any) {
      return { meta: { code: 400, message: error?.message || 'Failed to switch bonus' }, data: [] }
    }
  },
  /**
   * A player may cancel their OWN pending withdrawal. Nothing else.
   *
   * This stood on the public API with the comment "In a real system we'd
   * enforce admin privileges; here we allow and audit reviewerId", no session
   * check, no ownership check, and it accepted PROCESSING, COMPLETED, FAILED and
   * CANCELLED for any request id. The non-refund branch of
   * `updateWithdrawalStatus` carried no status guard, so the chain was:
   *
   *   1. request a withdrawal; the balance is debited
   *   2. an operator pays it out and it becomes COMPLETED
   *   3. call this with PROCESSING — a terminal request reopens
   *   4. call it again with CANCELLED — `wasRefundable` is now true, and the
   *      wallet is credited back
   *
   * Paid out and refunded, repeatably, for anyone's withdrawal. No client ever
   * called this field: it is a leftover admin simulation on a player API.
   */
  completeWithdrawal: async (_: unknown, args: { requestId: string; status: string }, ctx: ResolverContext) => {
    const userId = ctx.auth?.userId
    if (!userId) {
      return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    }
    const nextStatus = String(args.status || '').toUpperCase()
    // Advancing a withdrawal is an operator decision and lives on the admin API.
    if (nextStatus !== 'CANCELLED') {
      return {
        meta: { code: 403, message: 'Only CANCELLED may be set from the player app' },
        data: [],
      }
    }
    // The request must be the caller's own, in the caller's own tenant.
    const owned = await getWithdrawalRequest({
      requestId: Number(args.requestId),
      tenant: ctx.auth.tenant,
      userId,
    })
    if (!owned) {
      return { meta: { code: 404, message: 'Not found' }, data: [] }
    }
    const row = await updateWithdrawalStatus({
      requestId: Number(args.requestId),
      tenant: ctx.auth.tenant,
      reviewerId: userId,
      status: nextStatus as any,
    })
    if (!row) return { meta: { code: 404, message: 'Not found' }, data: [] }
    const withAccount = await getWithdrawalRequest({ requestId: row.id, tenant: ctx.auth.tenant, userId: ctx.auth.userId ?? row.userId })
    return {
      meta: metaOk(`Status updated to ${nextStatus}`),
      data: [
        {
          id: String(row.id),
          amount: Number(row.amount ?? 0),
          status: row.status,
          accountId: withAccount?.account?.id ? String(withAccount.account.id) : row.payoutAccountId ? String(row.payoutAccountId) : null,
          accountNumber: withAccount?.account?.accountNumber ?? null,
          accountHolderName: withAccount?.account?.accountHolderName ?? null,
          method: withAccount?.account?.method ?? null,
          ifscCode: withAccount?.account?.ifscCode ?? null,
          currency: row.currency ?? 'INR',
          createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        },
      ],
    }
  },
  fancyOdds: async (_: unknown, args: { eventId: string; marketCode: string }, ctx: ResolverContext) => {
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: { code: 403, message: 'Sports is not available for your whitelabel' }, data: [] }
    const data = generateFancyOdds(args.eventId, args.marketCode)
    return { meta: metaOk(), data }
  },
  claimReferralBonus: async (_: unknown, _args: { amount: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    try {
      // Credit players cannot take cash out, so a referral payout would be money that can never leave.
      if (await isCreditPlayerUser(ctx.auth.userId, ctx.auth.tenant)) {
        return { meta: { code: 403, message: CREDIT_PLAYER_REFERRAL_MESSAGE }, data: null }
      }
      const result = await executeClaimReferralBonus(ctx.auth.userId, ctx.auth.tenant)
      return {
        meta: metaOk(result.count > 0 ? 'Referral bonus claimed' : 'No unsettled earnings to claim'),
        data: {
          count: result.count,
          totalCash: result.totalCash,
          totalBonus: result.totalBonus,
        },
      }
    } catch (err: any) {
      return { meta: { code: 500, message: err?.message || 'Claim failed' }, data: null }
    }
  },
  trackReferralClick: async (
    _: unknown,
    args: { code: string; utmSource?: string; utmMedium?: string; utmCampaign?: string },
    ctx: ResolverContext
  ) => {
    const code = args.code?.trim()
    if (!code) {
      return { code: 400, message: 'Referral code is required' }
    }
    const request = (ctx as { request?: { headers?: Record<string, string>; ip?: string } }).request
    const headers = request?.headers ?? {}
    const ip = (request?.ip ?? headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? '').toString().trim().split(',')[0]
    if (!checkTrackReferralClickRateLimit(ip || undefined)) {
      return { code: 429, message: 'Too many requests. Try again later.' }
    }
    const tenant = ctx.auth?.requestTenant ?? 'default'
    const userAgent = headers['user-agent']
    const ok = await recordReferralClickByCode(tenant, code, {
      ip: ip || undefined,
      userAgent,
      utmSource: args.utmSource ?? undefined,
      utmMedium: args.utmMedium ?? undefined,
      utmCampaign: args.utmCampaign ?? undefined,
    })
    return ok ? metaOk() : { code: 400, message: 'Invalid or inactive referral code' }
  },
  placeSportsBet: async (
    _: unknown,
    args: { input?: PlaceSportsBetInput | null } & Record<string, any>,
    ctx: ResolverContext
  ) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: { code: 403, message: 'Sports betting is not available for your whitelabel' }, data: [] }
    try {
      // Backward-compat: GraphQL still sends legacy-style args (selectionType/odds_size/etc).
      // The bet placement service expects `selectionType` on the leg (via normalizeLegs); it derives `side` from that.
      const side = String(args.selectionType || 'back').toLowerCase() as 'back' | 'lay'
      const effectiveSide = side === 'lay' ? 'lay' : 'back'
      const legacy = args.input
        ? null
        : {
            eventId: String(args.eventId),
            leagueId: args.leagueId != null ? String(args.leagueId) : undefined,
            sportId: args.sportId != null ? String(args.sportId) : undefined,
            marketId: String(args.marketId),
            marketCode: args.marketCode ? String(args.marketCode) : null,
            selectionId: args.selectionId != null ? String(args.selectionId) : undefined,
            selection: args.selection ? String(args.selection) : '',
            selectionType: effectiveSide,
            odds: Number(args.odds),
            stake: Number(args.stake),
            liability: null,
            side: effectiveSide,
            marketType: (args.marketType || 'match_odds') as any,
            oddsSize: args.odds_size != null ? Number(args.odds_size) : undefined,
            isLive: false,
          }

      const result = await placeSportsBetForUser(ctx, { input: args.input, legacy })
      return {
        meta: metaOk('Bet placed'),
        data: result.bets.map((bet) => ({
          id: bet.id,
          slipId: bet.slipId,
          eventId: bet.eventId,
          leagueId: bet.leagueId,
          sportId: bet.sportId,
          marketId: bet.marketId,
          selectionId: bet.selectionId,
          selection: bet.selection ?? null,
          side: bet.side,
          marketType: bet.marketType,
          odds: bet.odds,
          stake: bet.stake,
          liability: bet.liability,
          currency: bet.currency,
          status: bet.status,
          createdAt: bet.createdAt,
          // Backward-compat fields
          amount: bet.stake,
      type: 'sports_bet',
        })),
      }
    } catch (err: any) {
      return { meta: { code: 400, message: err?.message || 'Failed to place bet' }, data: [] }
    }
  },
  placeFancyBet: async (_: unknown, args: any, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: { code: 403, message: 'Sports betting is not available for your whitelabel' }, data: [] }
    try {
      // Convert fancy bet args to format expected by placeSportsBetForUser
      const stake = Number(args.stake ?? 0)
      const odds = Number(args.odds ?? 0)
      const oddsSize = Number(args.odds_size ?? stake)
      const side = (args.selectionType || 'back').toLowerCase()
      
      // Create leg in format expected by placeSportsBetForUser
      // Liability will be calculated in placeSportsBetForUser based on marketType and oddsSize
      const leg = {
        eventId: String(args.eventId),
        leagueId: args.leagueId ? String(args.leagueId) : null,
        sportId: args.sportId ? String(args.sportId) : null,
        marketId: args.marketId || null,
        marketCode: args.marketCode || null,
        selectionId: String(args.selectionId || ''),
        selection: args.selection || null,
        selectionType: side,
        odds: odds,
        stake: stake,
        marketType: 'fancy',
        oddsSize: oddsSize,
        isLive: null,
      }
      
      // Use the same bet placement service as regular sports bets
      const result = await placeSportsBetForUser(ctx, {
        legacy: leg,
      })
      
      return { 
        meta: metaOk('Bet placed successfully'), 
        data: result.bets || [] 
      }
    } catch (err: any) {
      return { 
        meta: { code: 400, message: err?.message || 'Failed to place fancy bet' }, 
        data: [] 
      }
    }
  },
  /**
   * @deprecated Recent events are now automatically added when bets are placed.
   * This mutation is kept for backward compatibility but should not be used for new code.
   * Recent events should only contain events where users have placed bets.
   */
  addRecentSports: async (_: unknown, __: { eventId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: metaOk(), data: [] }
    // Note: This should ideally only be called when a bet is placed, not when just viewing events
    await addRecentSportsEvent(ctx.auth.userId, ctx.auth.requestTenant, __.eventId)
    const rows = await listRecentSports(ctx.auth.userId, ctx.auth.requestTenant)
    return { meta: metaOk(), data: rows.map((r) => ({ eventId: r.eventId, meta: r.meta })) }
  },
  toggleBookmarkSports: async (_: unknown, __: { eventId: string }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: [] }
    const flags = await getWhitelabelFeatureFlags(ctx.auth.requestTenant, ctx.auth.userId || undefined)
    if (!flags.sportsEnabled) return { meta: metaOk(), data: [] }
    await toggleSportsBookmark(ctx.auth.userId, ctx.auth.requestTenant, __.eventId)
    const bookmarks = await listSportsBookmarks(ctx.auth.userId, ctx.auth.requestTenant)
    return { meta: metaOk(), data: bookmarks.map((b) => ({ eventId: b.eventId, meta: b.meta })) }
  },
  /**
   * Recalculate user exposure based on actual market book positions.
   * This fixes any discrepancies between stored exposure and actual risk.
   */
  recalculateExposure: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) {
      return { success: false, message: 'Unauthorized', exposure: 0 }
    }
    try {
      // Every player type, credit players included: the recalculation only rewrites
      // wallets.exposure from the open sports bets (credit players hold their chips in
      // wallets.cash, so their exposure is held the same way as a cash player's).
      const newExposure = await recalculateAndUpdateExposure(ctx.auth.userId, ctx.auth.tenant)
      return {
        success: true, 
        message: 'Exposure recalculated successfully', 
        exposure: newExposure 
      }
    } catch (error: any) {
      return { 
        success: false, 
        message: error.message || 'Failed to recalculate exposure', 
        exposure: 0 
      }
    }
  },
  /**
   * Get detailed breakdown of exposure by market.
   * Useful for debugging exposure discrepancies.
   */
  getExposureBreakdown: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) {
      return {
        meta: { code: 401, message: 'Unauthorized' },
        data: { totalExposure: 0, markets: [] }
      }
    }
    try {
      const breakdown = await getExposureBreakdown(ctx.auth.userId, ctx.auth.tenant)
      return {
        meta: metaOk(),
        data: breakdown
      }
    } catch (error: any) {
      return {
        meta: { code: 400, message: error.message || 'Failed to get exposure breakdown' },
        data: { totalExposure: 0, markets: [] }
      }
    }
  },
  createWelivepayDeposit: async (_: unknown, args: { amount: number }, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return { meta: { code: 401, message: 'Unauthorized' }, data: null }
    try {
      const data = await createWelivepayDepositService({
        userId: ctx.auth.userId,
        tenant: ctx.auth.tenant,
        amount: args.amount,
      })
      return { meta: metaOk('Payment initiated'), data }
    } catch (err) {
      return { meta: { code: 400, message: err instanceof Error ? err.message : 'Failed to initiate payment' }, data: null }
    }
  },
}

