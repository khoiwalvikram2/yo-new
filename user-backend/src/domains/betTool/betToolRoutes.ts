import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getEnv } from '../../config/env.js'
import {
  toolPlaceSportsBet,
  toolSettleSportsBet,
  toolDeleteSportsBet,
} from '../../services/sportsBetToolService.js'
import {
  toolPlaceCasinoBet,
  toolSettleCasinoBet,
  toolDeleteCasinoBet,
} from '../../services/casinoBetToolService.js'
import { buildCasinoBetToolMetadata, parseBetToolClientContext } from './betToolClientContext.js'

function betToolUnauthorized(reply: FastifyReply) {
  return reply.status(401).send({ success: false, message: 'Unauthorized' })
}

function attachBetToolAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const env = getEnv() as { BET_TOOL_API_KEY?: string }
  const expected = env.BET_TOOL_API_KEY
  if (!expected) {
    void betToolUnauthorized(reply)
    return false
  }
  const key = request.headers['x-bet-tool-key'] as string | undefined
  if (!key || key !== expected) {
    void betToolUnauthorized(reply)
    return false
  }
  return true
}

/** Non-empty trimmed tenant and positive integer userId; otherwise reply 400 and return null. */
function parseBetToolTenantUser(
  reply: FastifyReply,
  tenantRaw: unknown,
  userIdRaw: unknown
): { tenant: string; userId: number } | null {
  const tenant = typeof tenantRaw === 'string' ? tenantRaw.trim() : String(tenantRaw ?? '').trim()
  const userId = typeof userIdRaw === 'number' ? userIdRaw : Number(userIdRaw)
  if (!tenant || !Number.isFinite(userId) || !Number.isInteger(userId) || userId < 1) {
    void reply.status(400).send({ success: false, message: 'tenant and userId (positive integer) are required' })
    return null
  }
  return { tenant, userId }
}

/** Non-empty trimmed whitelabel id; must match `tenant` (user/wallet scope). */
function parseBetToolWhitelabelId(
  reply: FastifyReply,
  whitelabelRaw: unknown,
  tenant: string
): string | null {
  const whitelabelId =
    typeof whitelabelRaw === 'string' ? whitelabelRaw.trim() : String(whitelabelRaw ?? '').trim()
  if (!whitelabelId) {
    void reply.status(400).send({ success: false, message: 'whitelabelId is required' })
    return null
  }
  if (whitelabelId !== tenant) {
    void reply
      .status(400)
      .send({ success: false, message: 'whitelabelId must match tenant for this user scope' })
    return null
  }
  return whitelabelId
}

export async function registerBetToolRoutes(app: FastifyInstance) {
  app.post('/api/bet-tool/sports/place', async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const body = request.body as Record<string, unknown>
      const tu = parseBetToolTenantUser(reply, body.tenant, body.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, body.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const clientCtx = parseBetToolClientContext(body)
      const row = await toolPlaceSportsBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        sportId: String(body.sportId ?? ''),
        leagueId: String(body.leagueId ?? ''),
        marketId: String(body.marketId ?? ''),
        eventId: String(body.eventId ?? ''),
        runnerId: String(body.runnerId ?? ''),
        selectionId: String(body.selectionId ?? ''),
        side: (String(body.side ?? 'back').toLowerCase() === 'lay' ? 'lay' : 'back') as 'back' | 'lay',
        price: Number(body.price),
        stake: Number(body.stake),
        liability: Number(body.liability),
        oddsSize: body.oddsSize != null ? Number(body.oddsSize) : undefined,
        marketCode: body.marketCode != null ? String(body.marketCode) : undefined,
        selectionLabel: body.selectionLabel != null ? String(body.selectionLabel) : undefined,
        ...clientCtx,
      })
      return reply.send({ success: true, data: row })
    } catch (e: any) {
      const code = e?.code
      if (code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })

  app.post('/api/bet-tool/sports/settle', async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const body = request.body as Record<string, unknown>
      const tu = parseBetToolTenantUser(reply, body.tenant, body.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, body.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const outcome = String(body.outcome ?? '').toLowerCase()
      if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'void') {
        return reply.status(400).send({ success: false, message: 'outcome must be won, lost, or void' })
      }
      const row = await toolSettleSportsBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        betId: String(body.betId ?? ''),
        outcome: outcome as 'won' | 'lost' | 'void',
      })
      return reply.send({ success: true, data: row })
    } catch (e: any) {
      if (e?.code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      if (e?.code === 'BET_ALREADY_SETTLED') {
        return reply.status(409).send({ success: false, message: e?.message ?? 'Conflict' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })

  app.delete<{ Params: { id: string }; Querystring: { tenant?: string; userId?: string; whitelabelId?: string } }>(
    '/api/bet-tool/sports/bets/:id',
    async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const q = request.query
      const tu = parseBetToolTenantUser(reply, q.tenant, q.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, q.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const result = await toolDeleteSportsBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        betId: request.params.id,
      })
      return reply.send({ success: true, ...result })
    } catch (e: any) {
      if (e?.code === 'SETTLED') {
        return reply.status(409).send({ success: false, message: e?.message ?? 'Conflict' })
      }
      if (e?.code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })

  app.post('/api/bet-tool/casino/place', async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const body = request.body as Record<string, unknown>
      const tu = parseBetToolTenantUser(reply, body.tenant, body.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, body.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const clientMetadata = buildCasinoBetToolMetadata(body)
      const row = await toolPlaceCasinoBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        gameCode: String(body.gameCode ?? ''),
        stake: Number(body.stake),
        transactionId: body.transactionId != null ? String(body.transactionId) : undefined,
        gameRoundId: body.gameRoundId != null ? String(body.gameRoundId) : undefined,
        clientMetadata: clientMetadata ?? null,
      })
      return reply.send({ success: true, data: row })
    } catch (e: any) {
      if (e?.code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      if (e?.code === 'DUPLICATE_TRANSACTION_ID') {
        return reply.status(409).send({ success: false, message: e?.message ?? 'Conflict' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })

  app.post('/api/bet-tool/casino/settle', async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const body = request.body as Record<string, unknown>
      const tu = parseBetToolTenantUser(reply, body.tenant, body.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, body.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const outcome = String(body.outcome ?? '').toLowerCase()
      if (outcome !== 'won' && outcome !== 'lost') {
        return reply.status(400).send({ success: false, message: 'outcome must be won or lost' })
      }
      const row = await toolSettleCasinoBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        betId: String(body.betId ?? ''),
        outcome: outcome as 'won' | 'lost',
        payout: body.payout != null ? Number(body.payout) : undefined,
      })
      return reply.send({ success: true, data: row })
    } catch (e: any) {
      if (e?.code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      if (e?.code === 'BET_ALREADY_SETTLED') {
        return reply.status(409).send({ success: false, message: e?.message ?? 'Conflict' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })

  app.delete<{ Params: { id: string }; Querystring: { tenant?: string; userId?: string; whitelabelId?: string } }>(
    '/api/bet-tool/casino/bets/:id',
    async (request, reply) => {
    if (!attachBetToolAuth(request, reply)) return
    try {
      const q = request.query
      const tu = parseBetToolTenantUser(reply, q.tenant, q.userId)
      if (!tu) return
      const whitelabelId = parseBetToolWhitelabelId(reply, q.whitelabelId, tu.tenant)
      if (!whitelabelId) return
      const result = await toolDeleteCasinoBet({
        tenant: tu.tenant,
        whitelabelId,
        userId: tu.userId,
        betId: request.params.id,
      })
      return reply.send({ success: true, ...result })
    } catch (e: any) {
      if (e?.code === 'SETTLED') {
        return reply.status(409).send({ success: false, message: e?.message ?? 'Conflict' })
      }
      if (e?.code === 'CREDIT_PLAYER') {
        return reply.status(403).send({ success: false, message: e?.message ?? 'Forbidden' })
      }
      return reply.status(400).send({ success: false, message: e?.message ?? 'Bad request' })
    }
  })
}
