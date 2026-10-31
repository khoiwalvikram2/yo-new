import type { FastifyInstance } from 'fastify'
import { referralIntegrationService } from '@src/services/referrals/referralIntegrationService.js'
import { getEnv } from '@src/config/env.js'
import { getWhitelabelCurrency } from '@src/shared/whitelabelConfig.js'
import type { CurrencyCode } from '@src/types/currency.js'

export async function registerInternalReferralRoutes(app: FastifyInstance) {
  const env = getEnv() as { INTERNAL_API_KEY?: string }

  app.post<{
    Body: { tenant: string; refereeId: number }
  }>('/internal/referral/process-signup', async (request, reply) => {
    const apiKey = request.headers['x-internal-api-key'] as string | undefined
    const expectedKey = env.INTERNAL_API_KEY
    if (!expectedKey || apiKey !== expectedKey) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' })
    }
    const { tenant, refereeId } = request.body ?? {}
    if (!tenant || typeof refereeId !== 'number') {
      return reply.status(400).send({ success: false, message: 'tenant and refereeId required' })
    }
    try {
      const currency = await getWhitelabelCurrency(tenant)
      await referralIntegrationService.processSignupForReferee(tenant, refereeId, (currency ?? 'INR') as CurrencyCode)
      return { success: true }
    } catch (err: any) {
      request.log.error(err, 'process-signup failed')
      return reply.status(500).send({ success: false, message: err?.message ?? 'Internal error' })
    }
  })

  app.post<{
    Body: { tenant: string; userId: number; netRevenue: number; currency: string; domain: 'sports' | 'casino' | 'matka'; betId?: string }
  }>('/internal/referral/process-bet-settlement', async (request, reply) => {
    const apiKey = request.headers['x-internal-api-key'] as string | undefined
    const expectedKey = env.INTERNAL_API_KEY
    if (!expectedKey || apiKey !== expectedKey) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' })
    }
    const { tenant, userId, netRevenue, currency, domain, betId } = request.body ?? {}
    if (!tenant || typeof userId !== 'number' || typeof netRevenue !== 'number' || !currency || !domain) {
      return reply.status(400).send({
        success: false,
        message: 'tenant, userId, netRevenue, currency, and domain required',
      })
    }
    if (!['sports', 'casino', 'matka'].includes(domain)) {
      return reply.status(400).send({ success: false, message: 'domain must be sports, casino, or matka' })
    }
    try {
      await referralIntegrationService.handleBetSettlement(
        tenant,
        userId,
        netRevenue,
        currency as any,
        domain,
        betId
      )
      return { success: true }
    } catch (err: any) {
      request.log.error(err, 'process-bet-settlement failed')
      return reply.status(500).send({ success: false, message: err?.message ?? 'Internal error' })
    }
  })

  app.post<{
    Body: { tenant: string; userId: number; betId: string; domain: 'sports' | 'casino' | 'matka' }
  }>('/internal/referral/process-bet-settlement-reversal', async (request, reply) => {
    const apiKey = request.headers['x-internal-api-key'] as string | undefined
    const expectedKey = env.INTERNAL_API_KEY
    if (!expectedKey || apiKey !== expectedKey) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' })
    }
    const { tenant, userId, betId, domain } = request.body ?? {}
    if (!tenant || typeof userId !== 'number' || !betId || !domain) {
      return reply.status(400).send({
        success: false,
        message: 'tenant, userId, betId, and domain required',
      })
    }
    if (!['sports', 'casino', 'matka'].includes(domain)) {
      return reply.status(400).send({ success: false, message: 'domain must be sports, casino, or matka' })
    }
    try {
      await referralIntegrationService.handleBetSettlementReversal(tenant, userId, betId, domain)
      return { success: true }
    } catch (err: any) {
      request.log.error(err, 'process-bet-settlement-reversal failed')
      return reply.status(500).send({ success: false, message: err?.message ?? 'Internal error' })
    }
  })
}
