import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { findTenantByWebhookToken } from '../../repos/welivepayWebhookRepo.js'
import {
  findOrderByOrderId,
  creditOrderOnSuccess,
  markOrderStatus,
  shouldCreditOnWebhook,
  type WelivepayOrderRow,
} from '../../repos/welivepayOrdersRepo.js'

const LOG_PREFIX = '[WelivepayWebhook]'

interface WebhookBody {
  orderid?: string
  status?: string
  amount?: number | string
  txn_ref?: string
}

/** Injectable dependencies — defaults wire the real repo functions; tests pass stubs. */
export interface WelivepayWebhookDeps {
  findTenantByWebhookToken: (token: string) => Promise<string | null>
  findOrderByOrderId: (orderid: string) => Promise<WelivepayOrderRow | null>
  creditOrderOnSuccess: (params: { orderid: string; txnRef: string | null }) => Promise<{ credited: boolean }>
  markOrderStatus: (orderid: string, status: 'expired' | 'invalid', txnRef?: string | null) => Promise<void>
}

const defaultDeps: WelivepayWebhookDeps = {
  findTenantByWebhookToken,
  findOrderByOrderId,
  creditOrderOnSuccess,
  markOrderStatus,
}

export async function registerWelivepayWebhookRoutes(
  app: FastifyInstance,
  deps: WelivepayWebhookDeps = defaultDeps
): Promise<void> {
  app.post('/wlp/:token', async (request: FastifyRequest<{ Params: { token: string }; Body: WebhookBody }>, reply: FastifyReply) => {
    try {
      // Fastify only parses application/json into an object. A non-JSON content-type yields a
      // string/undefined here — return 400 (retryable) instead of silently 200-ing a real payment.
      const body = request.body
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        request.log.error({ url: request.url }, `${LOG_PREFIX} non-JSON body`)
        return reply.status(400).send({ ok: false, error: 'expected JSON body' })
      }

      const tenant = await deps.findTenantByWebhookToken(request.params.token)
      if (!tenant) {
        return reply.status(401).send({ ok: false, error: 'invalid token' })
      }

      const orderid = String((body as WebhookBody).orderid ?? '')
      const status = String((body as WebhookBody).status ?? '')
      const amount = Number((body as WebhookBody).amount ?? NaN)
      const rawTxnRef = (body as WebhookBody).txn_ref
      const txnRef = rawTxnRef ? String(rawTxnRef) : null

      if (!orderid) return reply.status(200).send({ ok: true })

      const order = await deps.findOrderByOrderId(orderid)
      if (!order || order.tenant !== tenant) {
        request.log.warn({ orderid, tenant }, `${LOG_PREFIX} order not found or tenant mismatch`)
        return reply.status(200).send({ ok: true })
      }

      if (status === 'success') {
        const decision = shouldCreditOnWebhook(order, status, amount)
        if (!decision.credit) {
          request.log.warn({ orderid, reason: decision.reason }, `${LOG_PREFIX} not crediting`)
          return reply.status(200).send({ ok: true })
        }
        await deps.creditOrderOnSuccess({ orderid, txnRef })
        return reply.status(200).send({ ok: true })
      }

      if (status === 'expired' || status === 'invalid') {
        await deps.markOrderStatus(orderid, status, txnRef)
      }
      return reply.status(200).send({ ok: true })
    } catch (err) {
      // Any failure (DB error, or whitelabel credit temporarily exhausted) leaves the order
      // 'pending'. Return a sanitized 500 (no raw error leaked) so WeLivePay retries later;
      // the order-row FOR UPDATE lock guarantees the eventual single credit is idempotent.
      request.log.error({ err, url: request.url }, `${LOG_PREFIX} webhook failed`)
      return reply.status(500).send({ ok: false, error: 'temporary error, will retry' })
    }
  })
}
