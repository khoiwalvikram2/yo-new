/// <reference types="node" />
import Fastify from 'fastify'
import 'dotenv/config'
import mercurius from 'mercurius'
import { getRedisEmitter } from '@src/realtime/redisPubsub.js'
import { typeDefs, resolvers } from '@src/schema.js'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { getCurrentWhitelabel } from '@src/stores/whitelabelStore.js'
import { buildAuthContext } from '@src/domains/common/auth.js'
import { connectionInitHeaders } from '@src/domains/common/guardSubscriptions.js'
import { buildCrmAuthContext } from '@src/domains/crm/services/CrmAuthService.js'
import { getAppConfig } from '@src/config/app.js'
import { errorHandler } from '@src/middleware/errorHandler.js'
import { registerRequestLogger } from '@src/middleware/requestLogger.js'
import { registerHealthRoutes } from '@src/routes/health.js'
import { registerMetricsRoutes } from '@src/routes/metrics.js'
import { registerReferralRedirectRoutes } from '@src/routes/referralRedirect.js'
import { registerInternalReferralRoutes } from '@src/routes/internalReferral.js'
import { registerMediaRoutes } from '@src/routes/media.js'
import { registerGmagGameDataRoutes } from '@src/routes/gmagGameData.js'
import helmet from '@fastify/helmet'
import { registerPgBridge } from '@src/realtime/pgBridge.js'
import { pool } from '@src/db/client.js'
import { getEnv } from '@src/config/env.js'
import { queryDepthLimit } from '@src/graphql/depth.js'
import { createLoaders } from '@src/graphql/loaders.js'
import { startAutoSportsQueue } from '@src/services/autoSportsQueue.js'
import { startSportsAggregator } from '@src/services/sportsAggregator.js'
import { ensureTodayWorliInstancesForActiveMatkas } from '@src/domains/matka-worli/services/BootstrapService.js'
import { initializeSchedulers } from '@src/services/resultSchedulerService.js'
import { registerPresenceSocket } from '@src/realtime/presenceSocket.js'
import { startSnapshotQueue, getSnapshotQueue } from '@src/services/snapshotQueue.js'
import { startSnapshotScheduler } from '@src/services/snapshotScheduler.js'
import { startCommissionScheduler } from '@src/services/commissionScheduler.js'
import { startLosingBonusScheduler } from '@src/services/losingBonusScheduler.js'
import { startCasinoStuckRoundScheduler } from '@src/services/casinoStuckRoundScheduler.js'
import { startCrmSlaScheduler } from '@src/services/crmSlaScheduler.js'
import { startVipTierRefreshScheduler } from '@src/services/vipTierRefreshScheduler.js'
import { registerAdminSupportChat } from '@src/routes/supportChat.js'

const env = getEnv()
if (env.COMMISSION_CYCLE_NOW_OVERRIDE) {
  console.log('[Startup] COMMISSION_CYCLE_NOW_OVERRIDE is set:', env.COMMISSION_CYCLE_NOW_OVERRIDE, '- commission "current" cycle will use this as now (testing only)')
}

// 8 MiB: assets are stored inline as base64 data URIs, so upload payloads arrive in
// the JSON body rather than as multipart. Fastify's 1 MiB default would silently
// reject them. The largest such payload is a base64 deposit proof (~2MB file ->
// ~2.7MB base64), leaving room for the rest of the GraphQL body and batched queries.
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 8 * 1024 * 1024 })
const config = getAppConfig()
// Log CORS config at startup so production can verify env was applied
app.log.info({ corsOrigins: config.corsOrigins }, 'CORS allowed origins')
await app.register(cors, {
  origin: (origin, cb) => {
    // Preflight/requests may send origin; if not (e.g. same-origin or Postman), allow (null = no header restriction)
    if (!origin) {
      return cb(null, true)
    }
    const normalized = origin.trim().replace(/\/$/, '')
    const allowed = config.corsOrigins.some((o) => o === normalized)
    if (allowed) {
      return cb(null, origin)
    }
    app.log.warn({ origin: normalized, allowedOrigins: config.corsOrigins }, 'CORS rejected origin')
    return cb(null, false)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Whitelabel',
    'X-Whitelabel-ID',
    'X-Tenant',
    'X-Admin-Mode',
    'X-Client-User-Agent',
    // The CRM's Apollo client tags every request with this so the server can
    // tell the two front ends apart. A custom header the browser is not told
    // it may send fails the preflight, which looks to the user like the
    // server being unreachable rather than a header being refused.
    'X-Client-Type',
    'Apollo-Require-Preflight',
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  preflight: true,
  strictPreflight: false,
})
await app.register(rateLimit, {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.timeWindowMs,
  allowList: (req: any) => req.method === 'OPTIONS',
})
const isProduction = process.env.NODE_ENV === 'production'
await app.register(helmet, {
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'https:', 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      }
    : false,
})
await registerRequestLogger(app)
app.setErrorHandler(errorHandler)

await registerAdminSupportChat(app,config.corsOrigins)
app.register(mercurius as any, {
  schema: typeDefs,
  resolvers: resolvers as any,
  graphiql: !isProduction,
  allowBatchedQueries: true, // Admin client uses BatchHttpLink; reduces request flood on load
  validationRules: [queryDepthLimit],
  subscription: {
    // Mercurius reads custom emitters from subscription options.
    emitter: getRedisEmitter(),
    keepAlive: 20000,
    /**
     * Authenticates the WebSocket, which nothing did before.
     *
     * Mercurius does **not** call the `context` function below for subscriptions
     * — it builds `{ app, pubsub, request }` and nothing else. So `ctx.user`,
     * `ctx.crmUser` and `ctx.tenant` were all undefined on every subscribe, and
     * resolvers that fall back to a caller-supplied argument (`subscription {
     * depositRequestUpdated(tenant: "someone-else") }`) took the tenant
     * straight from the request. `guardAdminSurface` could not help: it wraps
     * Query and Mutation only, and would be a no-op on subscription resolvers
     * anyway because those are `{subscribe, resolve}` objects rather than
     * functions.
     *
     * Verified before this existed: a socket opened with no Authorization
     * header received `connection_ack` and was accepted onto another
     * whitelabel's topic. Audit events, casino dashboards and agent commission
     * are all published to such topics from application code.
     *
     * The admin client has always sent its token in `connectionParams`
     * (admin/src/shared/core/api.ts) — the server simply never read it. This
     * reads it, builds the *same* context the HTTP path builds, and refuses the
     * connection outright when it names nobody.
     */
    onConnect: async (data: any) => {
      // The client nests its headers under `payload.headers`; normalise them into
      // the shape `getCurrentWhitelabel` and `buildAuthContext` already read.
      const headers = connectionInitHeaders(data?.payload)
      const ctx = await buildGraphqlContext({ headers })
      if (!ctx.user) {
        // CRM principals are refused too. Every subscription on this schema is
        // an admin-panel feature, and `guardAdminSurface` refuses CRM callers on
        // the admin Query and Mutation fields for the same reason — it just
        // could not reach Subscription, whose resolvers are `{subscribe,
        // resolve}` objects rather than functions.
        throw new Error('Unauthorized: subscriptions require an admin session')
      }
      return ctx
    },
    /**
     * The upgrade request, for clients that authenticate with a cookie rather
     * than with connectionParams. `onConnect` runs after this and its result is
     * merged over the top, so a token in connectionParams still wins.
     */
    context: async (_connection: any, request: any) => buildGraphqlContext(request),
  },
  context: (request: any, reply: any) => buildGraphqlContext(request, reply),
})

/**
 * The GraphQL context, built once and used by both transports.
 *
 * Named and shared rather than inlined into `context` because the WebSocket
 * path needs exactly this and used to get nothing at all. Two builders would
 * drift, and the half that drifted would be the one deciding which tenant's
 * topic a socket may join.
 */
async function buildGraphqlContext(request: any, reply?: any) {
    let wlabel = await getCurrentWhitelabel({ request })
    let tenant = wlabel.id || 'default'

    const auth = await buildAuthContext(request, tenant)
    // SECURITY: Super Admin in core mode must see default tenant only (support admins, roles, etc.)
    // Ignore request X-Whitelabel-ID so they cannot see another whitelabel's data in core mode
    const isSuperAdmin = auth?.user?.roles?.some((r: string) =>
      r === 'Super Admin' || r?.toLowerCase() === 'super_admin' ||
      (r?.toLowerCase?.()?.includes('super') && r?.toLowerCase?.()?.includes('admin'))
    )
    if (isSuperAdmin && auth?.directorMode === 'core') {
      tenant = 'default'
      wlabel = await getCurrentWhitelabel({ request: { headers: {} } })
    }

    // Support admins / managers / WL staff: data lives under users.tenant. If the client omits
    // X-Whitelabel-ID, header resolution falls back to "default" and withdrawals (etc.) look empty.
    // Super Admin in whitelabel mode keeps header-selected tenant; core mode keeps default above.
    const isAgentUser = auth?.user?.type === 'agent' && auth?.user?.agentId
    if (auth?.user?.sub && !isAgentUser && !isSuperAdmin) {
      const userIdNum = Number(auth.user.sub)
      if (Number.isFinite(userIdNum)) {
        const { getTenantByUserId } = await import('@/repos/users/usersRepo.js')
        const ut = (await getTenantByUserId(userIdNum))?.trim() ?? ''
        if (ut) {
          tenant = ut
          const { getWhitelabelById } = await import('@/repos/common/whitelabelRepo.js')
          const wl = await getWhitelabelById(tenant)
          if (wl) {
            wlabel = {
              id: wl.id,
              name: wl.name,
              domain: (wl as { domain?: string }).domain ?? '',
              logoUrl: (wl as { logoUrl?: string | null }).logoUrl ?? undefined,
              faviconUrl: (wl as { faviconUrl?: string | null }).faviconUrl ?? undefined,
            } as typeof wlabel
          }
        }
      }
    }

    // CRM callers are a separate principal with their own tokens, tables and
    // permissions. Resolved alongside the admin identity rather than inside it:
    // buildAuthContext refuses CRM tokens outright, so the two can never be
    // confused for one another.
    const crmAuth = await buildCrmAuthContext(request, tenant)

    const loaders = createLoaders(tenant)
    return {
      request,
      reply,
      ...auth,
      ...crmAuth,
      // A CRM caller carries CRM permissions; an admin caller carries admin ones.
      // Never both — the two permission sets mean different things.
      permissions: crmAuth.crmUser ? crmAuth.permissions : auth.permissions,
      whitelabel: wlabel,
      tenant,
      loaders,
    }
}

await registerHealthRoutes(app)
if (config.metricsEnabled) {
  await registerMetricsRoutes(app)
}
await registerReferralRedirectRoutes(app)
await registerInternalReferralRoutes(app)
await registerMediaRoutes(app)
await registerGmagGameDataRoutes(app)

// bridge postgres notifications to GraphQL subscriptions
if (process.env.DATABASE_URL) {
  await registerPgBridge(app, process.env.DATABASE_URL)
}

const start = async () => {
  const port = config.port
  // Ensure Worli instances exist for today based on schedules
  try {
    await ensureTodayWorliInstancesForActiveMatkas('default')
  } catch (err) {
    app.log.error({ err }, 'Failed to bootstrap Worli instances')
  }
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`Backend GraphQL server running on http://localhost:${port}/graphql`)
  // Register Socket.IO presence (after server is listening)
  try {
    await registerPresenceSocket(app, config.corsOrigins)
    app.log.info('Presence socket ready')
  } catch (err) {
    app.log.error({ err }, 'Failed to register presence socket')
  }

  // Scheduled work has exactly one owner. A SERVER_ROLE=crm process serves the
  // same GraphQL surface and starts none of it, so a busy CRM desk can be given
  // its own process without a second copy of settlement accrual, snapshot
  // generation or result polling running beside the first.
  if (env.SERVER_ROLE === 'crm') {
    app.log.info('SERVER_ROLE=crm — serving GraphQL only; scheduled work belongs to the full process')
    return
  }

  // start background queue for auto sports ingestion (pg-boss)
  await startAutoSportsQueue()
  // start snapshot generation queue and scheduler (queue must start first so scheduler can reuse it)
  try {
    await startSnapshotQueue()
    const queue = getSnapshotQueue()
    if (queue) {
      app.log.info('Snapshot generation queue started; jobs will be processed by worker')
    } else {
      app.log.warn('Snapshot queue did not start; snapshot jobs will run inline (direct generation)')
    }
    await startSnapshotScheduler()
    app.log.info('Snapshot generation scheduler started')
  } catch (err) {
    app.log.error({ err }, 'Failed to start snapshot queue/scheduler')
  }
  try {
    // Reuses the snapshot queue’s pg-boss instance, so it must start after it.
    // Registered here, below the SERVER_ROLE=crm early return, because
    // scheduled work has exactly one owner — a CRM-only process must not
    // sweep as well.
    await startCrmSlaScheduler(getSnapshotQueue())
  } catch (err) {
    app.log.error({ err }, 'Failed to start CRM SLA scheduler')
  }
  try {
    // Same shared pg-boss instance and single owner as the CRM SLA sweep.
    await startVipTierRefreshScheduler(getSnapshotQueue())
  } catch (err) {
    app.log.error({ err }, 'Failed to start VIP tier refresh scheduler')
  }
  try {
    await startCommissionScheduler()
    app.log.info('Commission accrual scheduler started')
  } catch (err) {
    app.log.error({ err }, 'Failed to start commission scheduler')
  }
  try {
    await startLosingBonusScheduler()
    app.log.info('Losing bonus weekly scheduler started')
  } catch (err) {
    app.log.error({ err }, 'Failed to start losing bonus scheduler')
  }
  try {
    await startCasinoStuckRoundScheduler()
    app.log.info('Casino stuck-round detector started')
  } catch (err) {
    app.log.error({ err }, 'Failed to start casino stuck-round detector')
  }
  // start demo sports aggregator publishing to Redis topics
  if (String(process.env.SPORTS_AGGREGATOR_DEMO || 'false') === 'true') {
    try { 
      await startSportsAggregator() 
    } catch (err) {
      app.log.error({ err }, 'Failed to start sports aggregator')
    }
  }
  // start matka result scheduler
  try {
    await initializeSchedulers()
    app.log.info('Matka result scheduler started')
  } catch (err) {
    app.log.error({ err }, 'Failed to start matka result scheduler')
  }
}

start().catch((err) => {
  app.log.error(err)
  process.exit(1)
})

process.on('SIGINT', async () => {
  try {
    await pool.end();
    const { stopSnapshotScheduler } = await import('@src/services/snapshotScheduler.js');
    stopSnapshotScheduler();
    const { stopCommissionScheduler } = await import('@src/services/commissionScheduler.js');
    stopCommissionScheduler();
    const { stopLosingBonusScheduler } = await import('@src/services/losingBonusScheduler.js');
    stopLosingBonusScheduler();
    const { stopCasinoStuckRoundScheduler } = await import('@src/services/casinoStuckRoundScheduler.js');
    stopCasinoStuckRoundScheduler();
    const { stopCrmSlaScheduler } = await import('@src/services/crmSlaScheduler.js');
    await stopCrmSlaScheduler();
    const { stopVipTierRefreshScheduler } = await import('@src/services/vipTierRefreshScheduler.js');
    await stopVipTierRefreshScheduler();
    // Redis was left connected: the pool closed, the schedulers stopped, and
    // the pub/sub and presence sockets stayed open until the process was killed.
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js');
    await closeRedisEmitter();
    const { closeRedisClient } = await import('@src/config/redisClient.js');
    await closeRedisClient();
  } catch {}
  process.exit(0)
})
process.on('SIGTERM', async () => {
  try {
    await pool.end();
    const { stopSnapshotScheduler } = await import('@src/services/snapshotScheduler.js');
    stopSnapshotScheduler();
    const { stopCommissionScheduler } = await import('@src/services/commissionScheduler.js');
    stopCommissionScheduler();
    const { stopLosingBonusScheduler } = await import('@src/services/losingBonusScheduler.js');
    stopLosingBonusScheduler();
    const { stopCasinoStuckRoundScheduler } = await import('@src/services/casinoStuckRoundScheduler.js');
    stopCasinoStuckRoundScheduler();
    const { stopCrmSlaScheduler } = await import('@src/services/crmSlaScheduler.js');
    await stopCrmSlaScheduler();
    const { stopVipTierRefreshScheduler } = await import('@src/services/vipTierRefreshScheduler.js');
    await stopVipTierRefreshScheduler();
    // Redis was left connected: the pool closed, the schedulers stopped, and
    // the pub/sub and presence sockets stayed open until the process was killed.
    const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js');
    await closeRedisEmitter();
    const { closeRedisClient } = await import('@src/config/redisClient.js');
    await closeRedisClient();
  } catch {}
  process.exit(0)
})

