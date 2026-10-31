import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getGmagCasinoEnv } from '../../config/env.js'
import { verifyGmagHash } from '../../config/casino/gmagHashUtils.js'
import {
  gmagAuthSchema,
  gmagBalanceSchema,
  gmagTransactionSchema,
  gmagPayUpSchema,
} from './gmagCallbackSchemas.js'
import {
  handleGmagAuth,
  handleGmagBalance,
  handleGmagTransaction,
  handleGmagPayUp,
  errorResponse,
  GMAG_PROVIDER_KEY,
} from './gmagCasinoService.js'
import { recordCasinoCallbackRejection } from '../../repos/casinoCallbackRejectionRepo.js'

const LOG_PREFIX = '[GmagCasinoCallback]'

/**
 * Persist any callback we refused (result.error !== '0'), so a rejection storm is visible on
 * OUR side. Incident CS-22135 produced 142 refusals in one evening with no record anywhere —
 * the investigation had to be run entirely off the provider's logs.
 *
 * Fire-and-forget: never awaited, never throws, never changes the response.
 */
function recordIfRejected(
  endpoint: string,
  result: { error?: string; message?: string } | null | undefined,
  body: Record<string, unknown>
): void {
  const code = result?.error
  if (!code || code === '0') return
  const trans = Array.isArray(body.trans) ? (body.trans[0] as Record<string, unknown> | undefined) : undefined
  recordCasinoCallbackRejection({
    providerKey: GMAG_PROVIDER_KEY,
    endpoint,
    errorCode: code,
    errorMessage: result?.message ?? null,
    playerId: (body.playerId as string) ?? null,
    gameCode: (body.gameCode as string) ?? null,
    roundId: (trans?.roundId as string) ?? null,
    transId: (trans?.transId as string) ?? (body.transId as string) ?? null,
    referenceId: (trans?.referenceId as string) ?? (body.referenceId as string) ?? null,
    requestId: (body.requestId as string) ?? null,
    payload: body,
  })
}

function getQueryHash(request: FastifyRequest): string {
  const q = request.query as Record<string, string>
  return q?.hash ?? ''
}

async function gmagCallbackPre(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
  reply: FastifyReply,
  routeName: string
): Promise<Record<string, unknown> | null> {
  const env = getGmagCasinoEnv()
  if (!env) {
    await reply.status(503).send({ error: 'P_00', message: 'Server Error' })
    return null
  }
  const body = (request.body as Record<string, unknown>) ?? {}
  const rawBody = (request as { rawBody?: string }).rawBody
  const queryHash = getQueryHash(request)
  const isValid = verifyGmagHash(body, queryHash, env.GMAG_SECRET_KEY, rawBody)
  if (!isValid) {
    const requestId = (body.requestId as string) ?? ''
    console.warn(`${LOG_PREFIX} Invalid hash`, { routeName, requestId, hasQueryHash: !!queryHash })
    const errorPayload = { error: 'P_02', message: 'Invalid hash', requestId }
    await reply.status(200).send(errorPayload)
    return null
  }
  return body
}

export async function registerGmagCallbackRoutes(app: FastifyInstance) {

  // NOTE: raw-body JSON parser is registered by registerCasinoCallbackRoutes (Gap),
  // which runs first in index.ts. Gmag reads request.rawBody from the same parser.

  app.post('/gmag/auth', async (request, reply) => {
    const routeName = 'auth'
    const body = await gmagCallbackPre(request as FastifyRequest<{ Body: Record<string, unknown> }>, reply, routeName)
    if (!body) return
    const parsed = gmagAuthSchema.safeParse(body)
    if (!parsed.success) {
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_01', 'Invalid request'))
      return
    }
    try {
      const result = await handleGmagAuth(parsed.data)
      recordIfRejected('auth', result as any, body)
      await reply.status(200).send(result)
    } catch (err) {
      console.error(`${LOG_PREFIX} auth handler error`, { requestId: (body.requestId as string) ?? '', err })
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_00', 'Server Error'))
    }
  })

  app.post('/gmag/balance', async (request, reply) => {
    const routeName = 'balance'
    const body = await gmagCallbackPre(request as FastifyRequest<{ Body: Record<string, unknown> }>, reply, routeName)
    if (!body) return
    const parsed = gmagBalanceSchema.safeParse(body)
    if (!parsed.success) {
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_01', 'Invalid request'))
      return
    }
    try {
      const result = await handleGmagBalance(parsed.data)
      recordIfRejected('balance', result as any, body)
      await reply.status(200).send(result)
    } catch (err) {
      console.error(`${LOG_PREFIX} balance handler error`, { requestId: (body.requestId as string) ?? '', err })
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_00', 'Server Error'))
    }
  })

  app.post('/gmag/transaction', async (request, reply) => {
    const routeName = 'transaction'
    const body = await gmagCallbackPre(request as FastifyRequest<{ Body: Record<string, unknown> }>, reply, routeName)
    if (!body) return
    const parsed = gmagTransactionSchema.safeParse(body)
    if (!parsed.success) {
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_01', 'Invalid request'))
      return
    }
    try {
      const result = await handleGmagTransaction(parsed.data)
      recordIfRejected('transaction', result as any, body)
      await reply.status(200).send(result)
    } catch (err) {
      console.error(`${LOG_PREFIX} transaction handler error`, { requestId: (body.requestId as string) ?? '', err })
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_00', 'Server Error'))
    }
  })

  app.post('/gmag/payUp', async (request, reply) => {
    const routeName = 'payUp'
    const body = await gmagCallbackPre(request as FastifyRequest<{ Body: Record<string, unknown> }>, reply, routeName)
    if (!body) return
    const parsed = gmagPayUpSchema.safeParse(body)
    if (!parsed.success) {
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_01', 'Invalid request'))
      return
    }
    try {
      const result = await handleGmagPayUp(parsed.data)
      recordIfRejected('payUp', result as any, body)
      await reply.status(200).send(result)
    } catch (err) {
      console.error(`${LOG_PREFIX} payUp handler error`, { requestId: (body.requestId as string) ?? '', err })
      await reply.status(200).send(errorResponse((body.requestId as string) ?? '', 'P_00', 'Server Error'))
    }
  })

}
