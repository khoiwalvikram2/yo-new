/**
 * GAP Casino test route — mirrors gmagTestRoutes pattern.
 *
 * Calls the service handlers (handleWalletBalance, handleDebit, handleCredit,
 * handleRollback) directly — no HTTP roundtrip and no RSA signing required on
 * the client. Signature path is covered separately by
 * casinoCallbackRoutes.integration.test.ts.
 *
 * Endpoint: POST /gap-test/run
 * Body: { testCase, params }
 * Returns: { success, request, response, logs, durationMs }
 *
 * All [GapCasino:*] logs produced during the handler call are captured and
 * returned in the `logs` array so the frontend can show them. Requires
 * GAP_DEBUG=1 in the environment to produce the step-by-step logs.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'
import { getCasinoEnv } from '../../config/env.js'
import { buildAuthContext } from '../common/auth.js'
import {
  handleWalletBalance,
  handleDebit,
  handleCredit,
  handleRollback,
  type CallbackResult,
} from './gapCasinoService.js'
import {
  walletBalanceBodySchema,
  debitBodySchema,
  creditBodySchema,
  rollbackBodySchema,
  type WalletBalanceBody,
  type DebitBody,
  type CreditBody,
  type RollbackBody,
} from './callbackSchemas.js'

const GAP_LOG_PREFIXES = ['[GapCasino:', '[GapSig:', '[CasinoSessionRepo]']

type TestCase = 'balance' | 'bet' | 'win' | 'loss' | 'rollback'

interface RunBody {
  testCase: TestCase
  params: Record<string, unknown>
}

function captureConsoleLogs<T>(fn: () => Promise<T>): Promise<{ logs: string[]; result: T }> {
  const logs: string[] = []
  const originalLog = console.log
  const originalError = console.error

  function formatArgs(args: unknown[]): string {
    return args
      .map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
      .join(' ')
  }

  function capture(orig: typeof console.log, args: unknown[]) {
    const line = formatArgs(args)
    if (GAP_LOG_PREFIXES.some((p) => line.includes(p))) {
      logs.push(line)
    }
    orig.apply(console, args)
  }

  console.log = (...args: unknown[]) => capture(originalLog, args)
  console.error = (...args: unknown[]) => capture(originalError, args)

  return fn().then(
    (result) => {
      console.log = originalLog
      console.error = originalError
      return { logs, result }
    },
    (err) => {
      console.log = originalLog
      console.error = originalError
      throw err
    }
  )
}

function buildBalanceBody(params: Record<string, unknown>, userId: number): WalletBalanceBody {
  return {
    userId,
    token: String(params.token ?? ''),
    request_uuid: (params.reqId as string) ?? (params.request_uuid as string) ?? randomUUID(),
  }
}

function buildDebitBody(params: Record<string, unknown>, userId: number): DebitBody {
  return {
    userId,
    token: String(params.token ?? ''),
    transactionId: String(params.transactionId ?? randomUUID()),
    roundId: String(params.roundId ?? 'round-' + Date.now()),
    debitAmount: params.debitAmount != null ? Number(params.debitAmount) : 0,
    gameId: String(params.gameId ?? ''),
    reqId: (params.reqId as string) ?? randomUUID(),
  }
}

function buildCreditBody(params: Record<string, unknown>, userId: number): CreditBody {
  return {
    userId,
    token: String(params.token ?? ''),
    transactionId: String(params.transactionId ?? ''),
    roundId: String(params.roundId ?? ''),
    creditAmount: params.creditAmount != null ? Number(params.creditAmount) : 0,
    gameId: String(params.gameId ?? ''),
    reqId: (params.reqId as string) ?? randomUUID(),
  }
}

function buildRollbackBody(params: Record<string, unknown>, userId: number): RollbackBody {
  return {
    userId,
    token: String(params.token ?? ''),
    transactionId: String(params.transactionId ?? ''),
    roundId: String(params.roundId ?? ''),
    gameId: String(params.gameId ?? ''),
    reqId: (params.reqId as string) ?? randomUUID(),
  }
}

export async function registerGapTestRoutes(app: FastifyInstance) {
  app.post<{ Body: RunBody }>('/gap-test/run', async (request: FastifyRequest<{ Body: RunBody }>, reply: FastifyReply) => {
    const auth = await buildAuthContext(request)
    if (!auth.userId) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' })
    }
    const userId = Number(auth.userId)

    const body = request.body as RunBody | undefined
    const testCase = body?.testCase
    const params = body?.params ?? {}

    if (!testCase || !['balance', 'bet', 'win', 'loss', 'rollback'].includes(testCase)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid testCase. Must be one of: balance, bet, win, loss, rollback',
      })
    }

    const env = getCasinoEnv()
    if (!env) {
      return reply.status(503).send({ success: false, message: 'GAP casino is not configured (missing env)' })
    }

    const start = Date.now()
    let logs: string[] = []
    let requestBody: Record<string, unknown> = {}
    let result: CallbackResult | null = null
    let errorMessage: string | undefined

    try {
      const captured = await captureConsoleLogs(async () => {
        switch (testCase) {
          case 'balance': {
            const rb = buildBalanceBody(params, userId)
            requestBody = rb as unknown as Record<string, unknown>
            const parsed = walletBalanceBodySchema.safeParse(rb)
            if (!parsed.success) {
              return {
                status: 'OP_INVALID_PARAMS' as const,
                user: userId,
                request_uuid: rb.request_uuid,
                _issues: parsed.error.issues,
              } as unknown as CallbackResult
            }
            return await handleWalletBalance(parsed.data)
          }
          case 'bet': {
            const rb = buildDebitBody(params, userId)
            requestBody = rb as unknown as Record<string, unknown>
            const parsed = debitBodySchema.safeParse(rb)
            if (!parsed.success) {
              return {
                status: 'OP_INVALID_PARAMS' as const,
                user: userId,
                request_uuid: rb.reqId,
                _issues: parsed.error.issues,
              } as unknown as CallbackResult
            }
            return await handleDebit(parsed.data)
          }
          case 'win':
          case 'loss': {
            const body = buildCreditBody(params, userId)
            // For "loss" we send creditAmount = 0 by convention (matches GAP test 9 "Loss Result")
            if (testCase === 'loss') body.creditAmount = 0
            requestBody = body as unknown as Record<string, unknown>
            const parsed = creditBodySchema.safeParse(body)
            if (!parsed.success) {
              return {
                status: 'OP_INVALID_PARAMS' as const,
                user: userId,
                request_uuid: body.reqId,
                _issues: parsed.error.issues,
              } as unknown as CallbackResult
            }
            return await handleCredit(parsed.data)
          }
          case 'rollback': {
            const rb = buildRollbackBody(params, userId)
            requestBody = rb as unknown as Record<string, unknown>
            const parsed = rollbackBodySchema.safeParse(rb)
            if (!parsed.success) {
              return {
                status: 'OP_INVALID_PARAMS' as const,
                user: userId,
                request_uuid: rb.reqId,
                _issues: parsed.error.issues,
              } as unknown as CallbackResult
            }
            return await handleRollback(parsed.data)
          }
        }
        throw new Error('Unreachable')
      })
      logs = captured.logs
      result = captured.result
    } catch (err) {
      errorMessage = (err as Error).message
    }

    const durationMs = Date.now() - start
    const success = !errorMessage && result != null && result.status === 'OP_SUCCESS'

    return reply.send({
      success,
      message: errorMessage,
      request: { url: `internal://gapCasinoService.${testCase}`, body: requestBody },
      response: { status: errorMessage ? 0 : 200, body: result },
      logs,
      durationMs,
    })
  })
}
