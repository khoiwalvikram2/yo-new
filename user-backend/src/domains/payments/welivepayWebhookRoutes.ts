import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { findTenantByWebhookToken } from '../../repos/welivepayWebhookRepo.js'
import { findOrderByOrderId } from '../../repos/welivepayOrdersRepo.js'
import { reconcileWelivepayPayin } from '../../services/welivepayPayinStatusService.js'
import { WelivepayPayoutService } from '@shared/services/welivepay/welivepayPayoutService.js'
import { db } from '../../db/client.js'
import { getWelivepayBaseUrl } from '../../config/env.js'

/** Injectable dependencies — defaults wire the real services; tests pass stubs. */
export interface WelivepayWebhookDeps {
  findTenantByWebhookToken: (token: string) => Promise<string | null>
  findPayin: (orderid: string) => Promise<{ tenant: string } | null>
  reconcilePayin: (orderid: string, tenant: string) => Promise<unknown>
  findPayout: (orderid: string, tenant: string) => Promise<unknown>
  reconcilePayout: (orderid: string, tenant: string) => Promise<unknown>
}
const payouts = () => new WelivepayPayoutService(db, getWelivepayBaseUrl())
const defaults: WelivepayWebhookDeps = {
  findTenantByWebhookToken, findPayin: findOrderByOrderId, reconcilePayin: reconcileWelivepayPayin,
  findPayout: (orderid, tenant) => payouts().findByOrderId(orderid, tenant),
  reconcilePayout: (orderid, tenant) => payouts().reconcile(orderid, tenant),
}

type CallbackRequest = FastifyRequest<{ Params: { token: string }; Body: Record<string, unknown> }>

/**
 * WeLivePay callbacks are unsigned, so they are triggers only: the body names an order, and the
 * authenticated merchant status API decides whether anything is credited, completed or refunded.
 * The secret token in the URL resolves the whitelabel; an order of another whitelabel is ignored.
 */
export async function registerWelivepayWebhookRoutes(app: FastifyInstance, deps: WelivepayWebhookDeps = defaults): Promise<void> {
  const handle = (kind: 'payin' | 'payout') => async (request: CallbackRequest, reply: FastifyReply) => {
    // Fastify only parses application/json into an object. Anything else is a 400 (retryable)
    // rather than a silent 200 for what may be a real payment.
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ received: false, error: 'expected JSON body' })
    const tenant = await deps.findTenantByWebhookToken(request.params.token)
    if (!tenant) return reply.code(401).send({ received: false })
    const orderid = kind === 'payin' ? body.orderid : body.order_id
    if (typeof orderid !== 'string' || !orderid || orderid.length > 128) return reply.send({ received: true })
    try {
      if (kind === 'payin') {
        const order = await deps.findPayin(orderid)
        if (order?.tenant === tenant) await deps.reconcilePayin(orderid, tenant)
      } else if (await deps.findPayout(orderid, tenant)) await deps.reconcilePayout(orderid, tenant)
      return reply.send({ received: true })
    } catch {
      // Do not log the URL (secret token), raw status URL (merchant key), or beneficiary payload.
      request.log.warn({ kind, orderid }, 'WeLivePay verification deferred to reconciliation')
      return reply.code(503).send({ received: false, error: 'verification temporarily unavailable' })
    }
  }
  const options = { logLevel: 'warn' as const, bodyLimit: 64 * 1024 }
  app.post('/wlp/:token', options, handle('payin'))
  app.post('/wlp/:token/payin', options, handle('payin'))
  app.post('/wlp/:token/payout', options, handle('payout'))
}
