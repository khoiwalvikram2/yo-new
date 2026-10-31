import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getCasinoEnv } from '../../config/env.js'
import { stringifyCanonical, createCasinoSignature, checkCasinoSignature } from '../../config/casino/signatureUtils.js'
import {
  walletBalanceBodySchema,
  debitBodySchema,
  creditBodySchema,
  rollbackBodySchema,
} from './callbackSchemas.js'
import { handleWalletBalance, handleDebit, handleCredit, handleRollback } from './gapCasinoService.js'
import { gapLog } from './gapCasinoLog.js'

const LOG_PREFIX = '[GapCasinoCallback]'

// Development-only opt-in tracing; sensitive fields are redacted by gapLog.
function gdbg(tag: string, data: Record<string, unknown>) { gapLog('[GapCasinoCallback]', tag, data) }

function getRequestUuid(body: Record<string, unknown>): string | undefined {
  return (body.request_uuid as string) ?? (body.reqId as string)
}

async function casinoCallbackPre(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
  reply: FastifyReply,
  routeName: string
): Promise<{ env: NonNullable<Awaited<ReturnType<typeof getCasinoEnv>>>; body: Record<string, unknown> } | null> {

  const env = getCasinoEnv()
  if (!env) {
    gdbg('Pre:NoEnv', { routeName })
    await reply.status(503).send({ success: false, message: 'Casino not configured' })
    return null
  }

  const body = (request.body as Record<string, unknown>) ?? {}
  const rawBody = (request as { rawBody?: string }).rawBody ?? ''
  const canonical = stringifyCanonical(body)
  const signature = (request.headers['signature'] as string) ?? (request.headers['Signature'] as string) ?? ''

  gdbg('Pre:Incoming', {
    routeName,
    url: request.url,
    ip: request.ip,
    sigHeaderPresent: signature.length > 0,
    sigLen: signature.length,
    rawLen: rawBody.length,
    bodyKeys: Object.keys(body),
    rawBody,
  })

  const rawValid = rawBody.length > 0 && checkCasinoSignature(rawBody, signature, env.CASINO_SECRET)
  const canonicalValid = !rawValid && checkCasinoSignature(canonical, signature, env.CASINO_SECRET)
  const isValidSignature = rawValid || canonicalValid

  gdbg('Pre:SigVerify', {
    routeName,
    rawValid,
    canonicalValid,
    rawEqualsCanonical: rawBody === canonical,
    canonical,
    signaturePreview: signature.slice(0, 32),
  })

  if (!isValidSignature) {
    const request_uuid = getRequestUuid(body)
    gdbg('Pre:SigRejected', { routeName, request_uuid })
    await reply.status(200).send({ status: 'OP_INVALID_SIGNATURE', request_uuid })
    return null
  }

  gdbg('Pre:SigOK', { routeName })
  return { env, body }
}

export async function registerCasinoCallbackRoutes(app: FastifyInstance) {

  // Capture raw JSON body so signature can be verified against the exact bytes
  // the casino (GAP) signed, not a re-stringified parsed object. Shared with
  // Gmag routes which also need rawBody on inbound callbacks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as { rawBody?: string }).rawBody = body as string
    try {
      done(null, (body as string).length ? JSON.parse(body as string) : {})
    } catch (e) {
      done(e as Error, undefined)
    }
  })

  app.post('/gap/balance', async (request, reply) => {
    const routeName = 'wallet-balance'
    const startTime = Date.now()

    const pre = await casinoCallbackPre(request as FastifyRequest<{ Body: Record<string, unknown> }>, reply, routeName)
    if (!pre) return

    const parsed = walletBalanceBodySchema.safeParse(pre.body)
    if (!parsed.success) {
      gdbg('Balance:SchemaFail', { issues: parsed.error.issues, body: pre.body })
      await reply.status(200).send({ status: 'OP_INVALID_PARAMS', request_uuid: getRequestUuid(pre.body) })
      return
    }

    gdbg('Balance:HandlerIn', { userId: parsed.data.userId, token: parsed.data.token, request_uuid: parsed.data.request_uuid })
    try {
      const result = await handleWalletBalance(parsed.data)
      const responseBody = {
        user: result.user,
        status: result.status,
        ...(result.balance != null && { balance: result.balance }),
        request_uuid: result.request_uuid,
      }
      const responseStr = JSON.stringify(responseBody)
      const signature = createCasinoSignature(responseStr)

      const elapsed = Date.now() - startTime
      gdbg('Balance:HandlerOut', { status: result.status, balance: result.balance, elapsed, responseBody })
      gdbg('Balance:ResponseSent', { httpStatus: 200, responseStr, sigHeader: signature.slice(0, 32) + '...' })

      await reply.header('Signature', signature).status(200).send(responseBody)
    } catch (err) {
      const elapsed = Date.now() - startTime
      gdbg('Balance:HandlerError', { err: (err as Error).message, stack: (err as Error).stack, elapsed })
      app.log.error(err, 'casino wallet-balance handler error')
      await reply.status(200).send({ status: 'OP_GENERAL_ERROR', request_uuid: getRequestUuid(pre.body) })
    }
  })

  // Register both camelCase (per GAP docs) and lowercase (what some GAP operator
  // configs actually hit in production) for debit/credit/rollback. Fastify route
  // matching is case-sensitive so we register both paths → same handler.
  const debitHandler = async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const routeName = 'debit'
    const startTime = Date.now()

    const pre = await casinoCallbackPre(request, reply, routeName)
    if (!pre) return

    const parsed = debitBodySchema.safeParse(pre.body)
    if (!parsed.success) {
      gdbg('Debit:SchemaFail', { issues: parsed.error.issues, body: pre.body })
      await reply.status(200).send({ status: 'OP_INVALID_PARAMS', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
      return
    }

    gdbg('Debit:HandlerIn', {
      userId: parsed.data.userId,
      token: parsed.data.token,
      transactionId: parsed.data.transactionId,
      roundId: parsed.data.roundId,
      debitAmount: parsed.data.debitAmount,
      gameId: parsed.data.gameId,
      reqId: parsed.data.reqId,
    })
    try {
      const result = await handleDebit(parsed.data)
      const responseBody = {
        user: result.user,
        status: result.status,
        ...(result.balance != null && { balance: result.balance }),
        request_uuid: result.request_uuid,
      }
      const responseStr = JSON.stringify(responseBody)
      const signature = createCasinoSignature(responseStr)

      const elapsed = Date.now() - startTime
      gdbg('Debit:HandlerOut', { status: result.status, balance: result.balance, elapsed, responseBody })
      gdbg('Debit:ResponseSent', { httpStatus: 200, responseStr, sigHeader: signature.slice(0, 32) + '...' })

      await reply.header('Signature', signature).status(200).send(responseBody)
    } catch (err) {
      const elapsed = Date.now() - startTime
      gdbg('Debit:HandlerError', { err: (err as Error).message, stack: (err as Error).stack, elapsed })
      app.log.error(err, 'casino debit handler error')
      await reply.status(200).send({ status: 'OP_GENERAL_ERROR', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
    }
  }
  app.post('/gap/betRequest', debitHandler)
  app.post('/gap/betrequest', debitHandler)

  const creditHandler = async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const routeName = 'credit'
    const startTime = Date.now()

    const pre = await casinoCallbackPre(request, reply, routeName)
    if (!pre) return

    const parsed = creditBodySchema.safeParse(pre.body)
    if (!parsed.success) {
      gdbg('Credit:SchemaFail', { issues: parsed.error.issues, body: pre.body })
      await reply.status(200).send({ status: 'OP_INVALID_PARAMS', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
      return
    }

    gdbg('Credit:HandlerIn', {
      userId: parsed.data.userId,
      token: parsed.data.token,
      transactionId: parsed.data.transactionId,
      roundId: parsed.data.roundId,
      creditAmount: parsed.data.creditAmount,
      gameId: parsed.data.gameId,
      reqId: parsed.data.reqId,
    })
    try {
      const result = await handleCredit(parsed.data)
      const responseBody = {
        user: result.user,
        status: result.status,
        ...(result.balance != null && { balance: result.balance }),
        request_uuid: result.request_uuid,
      }
      const responseStr = JSON.stringify(responseBody)
      const signature = createCasinoSignature(responseStr)

      const elapsed = Date.now() - startTime
      gdbg('Credit:HandlerOut', { status: result.status, balance: result.balance, elapsed, responseBody })
      gdbg('Credit:ResponseSent', { httpStatus: 200, responseStr, sigHeader: signature.slice(0, 32) + '...' })

      await reply.header('Signature', signature).status(200).send(responseBody)
    } catch (err) {
      const elapsed = Date.now() - startTime
      gdbg('Credit:HandlerError', { err: (err as Error).message, stack: (err as Error).stack, elapsed })
      app.log.error(err, 'casino credit handler error')
      await reply.status(200).send({ status: 'OP_GENERAL_ERROR', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
    }
  }
  app.post('/gap/resultRequest', creditHandler)
  app.post('/gap/resultrequest', creditHandler)

  const rollbackHandler = async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
    const routeName = 'rollback'
    const startTime = Date.now()

    const pre = await casinoCallbackPre(request, reply, routeName)
    if (!pre) return

    const parsed = rollbackBodySchema.safeParse(pre.body)
    if (!parsed.success) {
      gdbg('Rollback:SchemaFail', { issues: parsed.error.issues, body: pre.body })
      await reply.status(200).send({ status: 'OP_INVALID_PARAMS', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
      return
    }

    gdbg('Rollback:HandlerIn', {
      userId: parsed.data.userId,
      token: parsed.data.token,
      transactionId: parsed.data.transactionId,
      roundId: parsed.data.roundId,
      gameId: parsed.data.gameId,
      reqId: parsed.data.reqId,
    })
    try {
      const result = await handleRollback(parsed.data)
      const responseBody = {
        user: result.user,
        status: result.status,
        ...(result.balance != null && { balance: result.balance }),
        request_uuid: result.request_uuid,
      }
      const responseStr = JSON.stringify(responseBody)
      const signature = createCasinoSignature(responseStr)

      const elapsed = Date.now() - startTime
      gdbg('Rollback:HandlerOut', { status: result.status, balance: result.balance, elapsed, responseBody })
      gdbg('Rollback:ResponseSent', { httpStatus: 200, responseStr, sigHeader: signature.slice(0, 32) + '...' })

      await reply.header('Signature', signature).status(200).send(responseBody)
    } catch (err) {
      const elapsed = Date.now() - startTime
      gdbg('Rollback:HandlerError', { err: (err as Error).message, stack: (err as Error).stack, elapsed })
      app.log.error(err, 'casino rollback handler error')
      await reply.status(200).send({ status: 'OP_GENERAL_ERROR', user: (pre.body as { userId?: number }).userId, request_uuid: getRequestUuid(pre.body) })
    }
  }
  app.post('/gap/rollbackRequest', rollbackHandler)
  app.post('/gap/rollbackrequest', rollbackHandler)
  
}
