import { getProfile } from '../services/authService.js'
import type { ResolverContext } from '../../../types/context.js'
import { findUserByPhone } from '../../../repos/userRepo.js'

export const userQueryResolvers = {
  me: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return null
    return getProfile(ctx.auth.userId, ctx.auth.tenant)
  },
  userData: async (_: unknown, __: unknown, ctx: ResolverContext) => {
    if (!ctx.auth.userId) return null
    return getProfile(ctx.auth.userId, ctx.auth.tenant)
  },
  checkPhoneAvailable: async (_: unknown, args: { phone: string }, ctx: ResolverContext) => {
    // Validate input
    if (!args.phone || typeof args.phone !== 'string' || args.phone.trim() === '') {
      return {
        available: false,
        message: 'Please enter a valid phone number'
      }
    }
    
    // Validate phone format (minimum length)
    const phoneDigits = args.phone.replace(/\D/g, '')
    if (phoneDigits.length < 6) {
      return {
        available: false,
        message: 'Phone number must have at least 6 digits'
      }
    }
    
    try {
      const tenant = ctx.auth.requestTenant || 'default'
      // Normalize phone before checking (current site)
      const { normalizePhoneForStorage } = await import('../../../utils/phoneUtils.js')
      const normalizedPhone = normalizePhoneForStorage(args.phone)
      
      const existing = await findUserByPhone(normalizedPhone, tenant)
      const isAvailable = existing === null
      
      return {
        available: isAvailable,
        message: isAvailable 
          ? null 
          : 'This phone number is already registered'
      }
    } catch (error: any) {
      return {
        available: false,
        message: 'Unable to verify phone availability. Please try again.'
      }
    }
  },
}

