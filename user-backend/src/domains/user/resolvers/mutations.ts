import { changePassword, loginWithOtp, loginWithPassword, registerUser, requestOtp, resetPassword } from '../services/authService.js'
import { requireAuth } from '../../common/auth.js'
import type { ResolverContext } from '../../../types/context.js'
import type { RegisterInput } from '@shared/types/user.js'
import { transferReferralBalanceToCash } from '../../../repos/referralRepo.js'
import { CREDIT_PLAYER_REFERRAL_MESSAGE, isCreditPlayerUser } from '../../userApp/services/playerCreditState.js'
import { isRegisterEnabledForTenant } from '../../../repos/userAppRepo.js'
import { getClientIp, getClientUserAgent, getClientMeta } from '../../../utils/getClientRequest.js'

function buildRequestMeta(ctx: ResolverContext) {
  if (!ctx.request) return undefined
  const req = ctx.request as any
  return {
    ip: getClientIp(req) ?? undefined,
    userAgent: getClientUserAgent(req) ?? undefined,
    ...getClientMeta(req),
  }
}

export const userMutationResolvers = {
  requestOtp: async (_: unknown, args: { phone: string }, ctx: ResolverContext) => {
    const resp = await requestOtp(args.phone, ctx.auth.requestTenant)
    return resp
  },
  loginWithOtp: async (_: unknown, args: { phone: string; otp: string }, ctx: ResolverContext) => {
    const requestMeta = buildRequestMeta(ctx)
    const payload = await loginWithOtp(args.phone, args.otp, ctx.auth.requestTenant, requestMeta)
    return payload
  },
  registerUser: async (_: unknown, args: { input: RegisterInput }, ctx: ResolverContext) => {
    // Server-side gate: block registration when the whitelabel has it disabled.
    if (!(await isRegisterEnabledForTenant(ctx.auth.requestTenant))) {
      return { success: false, message: 'Registration is currently disabled' }
    }
    const resp = await registerUser(args.input, ctx.auth.requestTenant)
    return resp
  },
  login: async (_: unknown, args: { input: { phoneOrUsername: string; password: string } }, ctx: ResolverContext) => {
    const requestMeta = buildRequestMeta(ctx)
    const payload = await loginWithPassword(args.input.phoneOrUsername, args.input.password, ctx.auth.requestTenant, requestMeta)
    return payload
  },
  changePassword: async (_: unknown, args: { currentPassword: string; newPassword: string }, ctx: ResolverContext) => {
    requireAuth(ctx.auth)
    await changePassword(ctx.auth.userId!, args.currentPassword, args.newPassword, ctx.auth.tenant)
    return { success: true, message: 'Password updated' }
  },
  requestResetOtp: async (_: unknown, args: { phone: string }, ctx: ResolverContext) => {
    const resp = await requestOtp(args.phone, ctx.auth.requestTenant, 'reset')
    return resp
  },
  resetPassword: async (_: unknown, args: { phone: string; otp: string; newPassword: string }, ctx: ResolverContext) => {
    const resp = await resetPassword(args.phone, args.otp, args.newPassword, ctx.auth.requestTenant)
    return resp
  },
  transferReferralBalanceToCash: async (_: unknown, args: { amount: number }, ctx: ResolverContext) => {
    requireAuth(ctx.auth)
    // Credit players cannot withdraw, so cash minted here could never leave.
    if (await isCreditPlayerUser(ctx.auth.userId!, ctx.auth.tenant)) {
      return { success: false, message: CREDIT_PLAYER_REFERRAL_MESSAGE, newReferralBalance: null, newCashBalance: null }
    }
    const result = await transferReferralBalanceToCash(ctx.auth.userId!, args.amount, ctx.auth.tenant)
    return {
      success: result.success,
      message: result.message,
      newReferralBalance: result.newReferralBalance,
      newCashBalance: result.newCashBalance,
    }
  },
}

