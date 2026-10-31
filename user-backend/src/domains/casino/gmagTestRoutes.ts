import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'
import { getGmagCasinoEnv } from '../../config/env.js'
import { getAppConfig } from '../../config/app.js'
import { computeGmagHash } from '../../config/casino/gmagHashUtils.js'
import { buildAuthContext } from '../common/auth.js'

const GMAG_LOG_PREFIXES = ['[GmagHash]', '[GmagCasino]', '[GmagCasinoCallback]', '[CasinoSessionRepo]', '[GmagEnv]', '[GmagCasinoLaunch]']

type TestCase = 'auth' | 'balance' | 'bet' | 'win' | 'cancel' | 'payUp'

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
    if (GMAG_LOG_PREFIXES.some((p) => line.includes(p))) {
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

function buildAuthBody(params: Record<string, unknown>, brandId: number): Record<string, unknown> {
  const requestId = (params.requestId as string) || randomUUID()
  return {
    brandId,
    requestId,
    token: String(params.token ?? ''),
  }
}

function buildBalanceBody(params: Record<string, unknown>, brandId: number): Record<string, unknown> {
  const requestId = (params.requestId as string) || randomUUID()
  const body: Record<string, unknown> = {
    brandId,
    requestId,
    playerId: String(params.playerId ?? ''),
    playerSessionId: String(params.playerSessionId ?? ''),
  }
  if (params.gameCode != null) body.gameCode = String(params.gameCode)
  return body
}

function buildTransactionBody(
  params: Record<string, unknown>,
  brandId: number,
  transType: 'bet' | 'win' | 'cancel'
): Record<string, unknown> {
  const requestId = (params.requestId as string) || randomUUID()
  const trans = params.trans as Record<string, unknown>[] | undefined
  const item = Array.isArray(trans) && trans[0] ? trans[0] : {}
  const seq = Number(item.seq ?? 1)
  const transId = String(item.transId ?? randomUUID())
  const amount = item.amount != null ? Number(item.amount) : 0
  const transTime = String(item.transTime ?? new Date().toISOString())
  const roundId = String(item.roundId ?? params.roundId ?? 'test-round-' + randomUUID().slice(0, 8))
  const referenceId = item.referenceId != null ? String(item.referenceId) : undefined

  const entry: Record<string, unknown> = {
    seq,
    transId,
    amount,
    transType,
    transTime,
    roundId,
  }
  if (referenceId) entry.referenceId = referenceId
  if (transType === 'bet' || transType === 'win') {
    if (item.endRound != null) entry.endRound = item.endRound
  }

  const body: Record<string, unknown> = {
    brandId,
    requestId,
    playerId: String(params.playerId ?? ''),
    playerSessionId: String(params.playerSessionId ?? ''),
    trans: [entry],
  }
  if (params.gameCode != null) body.gameCode = String(params.gameCode)
  return body
}

function buildPayUpBody(params: Record<string, unknown>, brandId: number): Record<string, unknown> {
  const requestId = (params.requestId as string) || randomUUID()
  const body: Record<string, unknown> = {
    brandId,
    requestId,
    playerId: String(params.playerId ?? ''),
    transId: String(params.transId ?? randomUUID()),
    amount: Number(params.amount ?? 0),
    transTime: String(params.transTime ?? new Date().toISOString()),
    type: String(params.type ?? 'bonus'),
  }
  if (params.currency != null) body.currency = String(params.currency)
  if (params.referenceId != null) body.referenceId = String(params.referenceId)
  if (params.providerCode != null) body.providerCode = String(params.providerCode)
  return body
}

export async function registerGmagTestRoutes(app: FastifyInstance) {
  const config = getAppConfig()

  app.post<{ Body: RunBody }>('/gmag-test/run', async (request: FastifyRequest<{ Body: RunBody }>, reply: FastifyReply) => {
    const auth = await buildAuthContext(request)
    if (!auth.userId) {
      return reply.status(401).send({ success: false, message: 'Unauthorized' })
    }

    const body = request.body as RunBody | undefined
    const testCase = body?.testCase
    const params = body?.params ?? {}

    if (!testCase || !['auth', 'balance', 'bet', 'win', 'cancel', 'payUp'].includes(testCase)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid testCase. Must be one of: auth, balance, bet, win, cancel, payUp',
      })
    }

    const env = getGmagCasinoEnv()
    if (!env) {
      return reply.status(503).send({
        success: false,
        message: 'GMAG casino is not configured (missing env)',
      })
    }

    const brandId = env.GMAG_BRAND_ID
    const secretKey = env.GMAG_SECRET_KEY
    let endpoint: string
    let requestBody: Record<string, unknown>

    switch (testCase) {
      case 'auth':
        endpoint = 'auth'
        requestBody = buildAuthBody(params, brandId)
        break
      case 'balance':
        endpoint = 'balance'
        requestBody = buildBalanceBody(params, brandId)
        break
      case 'bet':
        endpoint = 'transaction'
        requestBody = buildTransactionBody(params, brandId, 'bet')
        break
      case 'win':
        endpoint = 'transaction'
        requestBody = buildTransactionBody(params, brandId, 'win')
        break
      case 'cancel':
        endpoint = 'transaction'
        requestBody = buildTransactionBody(params, brandId, 'cancel')
        break
      case 'payUp':
        endpoint = 'payUp'
        requestBody = buildPayUpBody(params, brandId)
        break
      default:
        return reply.status(400).send({ success: false, message: 'Unknown testCase' })
    }

    const baseUrl = `http://127.0.0.1:${config.port}`
    const start = Date.now()
    let logs: string[] = []
    let hash = ''
    let resStatus = 0
    let resBody: unknown = null

    try {
      const captured = await captureConsoleLogs(async () => {
        const h = computeGmagHash(requestBody, secretKey)
        hash = h
        const url = `${baseUrl}/gmag/${endpoint}?hash=${encodeURIComponent(h)}`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
        resStatus = res.status
        const text = await res.text()
        try {
          resBody = JSON.parse(text)
        } catch {
          resBody = text
        }
        return { hash: h, resStatus, resBody }
      })
      logs = captured.logs
    } catch (err) {
      const durationMs = Date.now() - start
      return reply.send({
        success: false,
        message: (err as Error).message,
        request: { url: `${baseUrl}/gmag/${endpoint}?hash=...`, body: requestBody, hash: hash ? hash.substring(0, 8) + '...' : 'N/A' },
        response: { status: 0, body: null },
        logs,
        durationMs,
      })
    }

    const durationMs = Date.now() - start

    return reply.send({
      success: resStatus >= 200 && resStatus < 300,
      request: { url: `${baseUrl}/gmag/${endpoint}?hash=<redacted>`, body: requestBody, hash: hash.substring(0, 8) + '...' },
      response: { status: resStatus, body: resBody },
      logs,
      durationMs,
    })
  })
}
