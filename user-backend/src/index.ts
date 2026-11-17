import Fastify from 'fastify'
import mercurius from 'mercurius'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { typeDefs, resolvers } from './schema.js'
import { buildAuthContext } from './domains/common/auth.js'
import { getAppConfig } from './config/app.js'
import { pool } from './db/client.js'
import { registerCasinoCallbackRoutes } from './domains/casino/casinoCallbackRoutes.js'
import { registerGmagCallbackRoutes } from './domains/casino/gmagCallbackRoutes.js'
import { registerGmagTestRoutes } from './domains/casino/gmagTestRoutes.js'
import { registerGapTestRoutes } from './domains/casino/gapTestRoutes.js'
import { registerBetToolRoutes } from './domains/betTool/betToolRoutes.js'
import { registerWelivepayWebhookRoutes } from './domains/payments/welivepayWebhookRoutes.js'
import { registerSiteAssetRoutes } from './routes/siteAssetRoutes.js'
import { startWelivepayExpiryJob } from './services/welivepayExpiryJob.js'
import { startWelivepayReconciliationJob, stopWelivepayReconciliationJob } from './services/welivepayReconciliationJob.js'
import { queryDepthLimit } from './graphql/depth.js'
import { registerPlayerSupportChat } from './routes/supportChat.js'

const config = getAppConfig()

// 8 MiB: assets are stored inline as base64 data URIs, so upload payloads arrive in
// the JSON body rather than as multipart. Fastify's 1 MiB default would silently
// reject them. The largest such payload is a base64 deposit proof (~2MB file ->
// ~2.7MB base64), leaving room for the rest of the GraphQL body and batched queries.
// There is no multipart upload route any more: the deposit-proof one went with S3.
const app = Fastify({ logger: true, trustProxy: config.trustProxy, bodyLimit: 8 * 1024 * 1024 })

const isDevelopment = process.env.NODE_ENV === 'development'
// Any unset or unexpected mode gets production hardening. Only the development
// launcher may opt into GraphiQL and provider test routes.
const isProduction = !isDevelopment

await app.register(cors, { origin: config.corsOrigins, credentials: true })

await app.register(helmet, {
  // This service answers API calls, not documents, so a restrictive CSP costs
  // nothing here and removes a class of response-embedding tricks.
  contentSecurityPolicy: isProduction
    ? { directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] } }
    : false,
})

// This service is public: anyone on the internet can reach registration, login
// and OTP without a credential. It previously had no global limit at all, so a
// single client could drive unbounded traffic — and requestOtp bills a real SMS
// on every call.
//
// Provider callbacks are exempt: casino and payment providers retry
// aggressively by design (one bet has been seen retried 36 times in five
// hours), and throttling a settlement callback would stall real money.
const CALLBACK_PREFIXES = ['/gap/', '/gmag/', '/wlp/', '/api/bet-tool/']
await app.register(rateLimit, {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.timeWindowMs,
  allowList: (req: any) =>
    req.method === 'OPTIONS' ||
    CALLBACK_PREFIXES.some((prefix) => String(req.url ?? '').startsWith(prefix)),
})

await registerCasinoCallbackRoutes(app)
await registerGmagCallbackRoutes(app)
// Provider *test* harnesses. Both sign an arbitrary request body with the real
// provider secret and post it to the real callback endpoint, and both take the
// callback parameters — `playerId` and `amount` included — straight from the
// request. `/gmag-test/run` with
//   { testCase: 'payUp', params: { playerId: '<anyone>', amount: 999999 } }
// therefore mints balance into any account, and both routes were registered
// unconditionally. They check only that a caller is signed in, which on a public
// player API means every player.
//
// They are development harnesses, so they are not mounted in production at all.
// Refusing at registration rather than inside the handler means the route does
// not exist to be probed.
if (isDevelopment) {
  await registerGmagTestRoutes(app)
  await registerGapTestRoutes(app)
} else {
  app.log.info('provider test routes are disabled outside development')
}
await registerBetToolRoutes(app)
await registerWelivepayWebhookRoutes(app)
app.addHook('onClose', async () => { stopWelivepayReconciliationJob() })
await registerSiteAssetRoutes(app)

await registerPlayerSupportChat(app,config.corsOrigins)
await app.register(mercurius, {
  schema: typeDefs,
  resolvers: resolvers as any,
  // The playground publishes the whole schema; keep it out of production.
  graphiql: !isProduction,
  validationRules: [queryDepthLimit],
  context: async (request, reply) => {
    const auth = await buildAuthContext(request)
    return { auth, request, reply } as any
  },
})

// Force-logout hook: if token version mismatch detected, return GraphQL error so frontend clears auth
app.graphql.addHook('preExecution', async (_schema, _document, context) => {
  const auth = (context as any)?.auth
  if (auth?.forceLoggedOut) {
    return {
      errors: [new mercurius.ErrorWithProps('Token expired', {}, 401)],
    }
  }
})

// The deposit proof is no longer uploaded on its own (POST /api/upload/deposit-proof went with S3): the player app
// sends the screenshot as a base64 data URI with createAdminDeposit (domains/userApp/services/depositProof.ts).

const start = async () => {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`User backend running at http://localhost:${config.port}/graphql`)
  // Background cleanup: mark stale pending WeLivePay orders as expired.
  startWelivepayExpiryJob()
  // Settle pay-ins and payouts whose callbacks never arrived (authenticated status reads only).
  startWelivepayReconciliationJob()
}

start().catch((err) => {
  app.log.error(err)
  process.exit(1)
})

process.on('SIGINT', async () => {
  try { await pool.end() } catch {}
  process.exit(0)
})
process.on('SIGTERM', async () => {
  try { await pool.end() } catch {}
  process.exit(0)
})

