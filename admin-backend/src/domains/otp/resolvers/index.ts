import { upsertOtpProvider, listOtpProviders } from '@/repos/otpProvidersRepo.js'
import type { OtpProviderInput } from '../types.js'
import { hasPermission } from '@/domains/common/auth.js'

export const otpResolvers = {
  Query: {
    otpProviders: async (_: unknown, { tenant }: { tenant?: string }, ctx: any) => {
      if (!hasPermission(ctx?.permissions ?? [], 'config.otp-providers', 'view')) {
        throw new Error('Forbidden: insufficient permissions for OTP providers')
      }
      const effectiveTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? tenant ?? 'default'
      return listOtpProviders(effectiveTenant)
    },
  },
  Mutation: {
    upsertOtpProvider: async (_: unknown, { input }: { input: OtpProviderInput }, ctx: any) => {
      if (!hasPermission(ctx?.permissions ?? [], 'config.otp-providers', 'update') && !hasPermission(ctx?.permissions ?? [], 'config.otp-providers', 'create')) {
        throw new Error('Forbidden: insufficient permissions for OTP providers')
      }
      const effectiveTenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? input.tenant ?? 'default'
      await upsertOtpProvider({ ...input, tenant: effectiveTenant })
      return { success: true, message: 'OTP provider saved' }
    },
  },
}

