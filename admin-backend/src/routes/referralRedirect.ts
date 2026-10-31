import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  getReferralLinkByCodeDb,
  recordReferralClickDb,
} from '@src/repos/referrals/referralsRepo.js'
import { getCurrentWhitelabel } from '@src/stores/whitelabelStore.js'

export async function registerReferralRedirectRoutes(app: FastifyInstance) {
  app.get('/r', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { ref?: string; [key: string]: any }
      const refCode = query.ref

      if (!refCode) {
        // No referral code, redirect to signup without tracking
        const signupUrl = process.env.SIGNUP_URL || '/signup'
        return reply.redirect(signupUrl as string)
      }

      // Get whitelabel/tenant from request
      const wlabel = await getCurrentWhitelabel({ request })
      const tenant = wlabel.id || 'default'

      // Find referral link (normalize to uppercase for consistent lookup)
      const link = await getReferralLinkByCodeDb(refCode.toUpperCase().trim())
      if (!link || link.tenant !== tenant || !link.isActive) {
        // Invalid code, redirect to signup without tracking
        const signupUrl = process.env.SIGNUP_URL || '/signup'
        return reply.redirect(signupUrl as string)
      }

      // Extract UTM parameters
      const utmSource = query.utm_source as string | undefined
      const utmMedium = query.utm_medium as string | undefined
      const utmCampaign = query.utm_campaign as string | undefined

      // Get IP and user agent (prefer X-Client-User-Agent when sent by client)
      const { getClientIp, getClientUserAgent } = await import('@src/utils/getClientIp.js')
      const ipAddress = getClientIp(request) || request.socket?.remoteAddress || undefined
      const userAgent = getClientUserAgent(request) || undefined

      // Record click (only for user referrals, not agent referrals)
      // For agent referrals, we don't record clicks in referral_clicks table
      // Agent referral tracking is done via agentId in users table
      if (link.userId) {
        await recordReferralClickDb(tenant, link.id, link.userId, {
          ipAddress: typeof ipAddress === 'string' ? ipAddress : undefined,
          userAgent,
          utmSource,
          utmMedium,
          utmCampaign,
        })
      }
      // For agent referrals (link.agentId), we skip click recording
      // Stats are calculated by counting users with agentId

      // Set cookie for attribution (30 days)
      const cookieName = `ref_${tenant}`
      const cookieValue = refCode
      const cookieOptions = {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: false, // Allow JS access for client-side attribution
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
      }

      ;(reply as any).setCookie(cookieName, cookieValue, cookieOptions)

      // Redirect to signup with referral code preserved in query string
      const signupUrl = process.env.SIGNUP_URL || '/signup'
      const redirectUrl = new URL(signupUrl, `http://${request.headers.host || 'localhost'}`)
      redirectUrl.searchParams.set('ref', refCode)
      if (utmSource) redirectUrl.searchParams.set('utm_source', utmSource)
      if (utmMedium) redirectUrl.searchParams.set('utm_medium', utmMedium)
      if (utmCampaign) redirectUrl.searchParams.set('utm_campaign', utmCampaign)

      return reply.redirect(redirectUrl.toString())
    } catch (error) {
      // On error, still redirect to signup
      const signupUrl = process.env.SIGNUP_URL || '/signup'
      return reply.redirect(signupUrl)
    }
  })
}

