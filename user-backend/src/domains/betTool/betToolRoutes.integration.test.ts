/**
 * Bet-tool route auth smoke tests. Run: npm run test -- src/domains/betTool/betToolRoutes.integration.test.ts
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'

function ensureMinEnv() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgres://user:pass@127.0.0.1:5432/testdb'
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef'
  }
}

test('bet-tool sports place: 401 when X-Bet-Tool-Key missing', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: {},
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(res.statusCode, 401)
})

test('bet-tool sports place: 401 when key wrong', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: {},
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'wrong' },
  })
  assert.equal(res.statusCode, 401)
})

test('bet-tool sports place: 400 with valid key and empty body (validation)', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: { tenant: 't', whitelabelId: 't', userId: 1 },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
})

test('bet-tool sports place: 400 when userId invalid (route validation)', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: { tenant: 'acme', userId: 0 },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /tenant and userId/)
})

test('bet-tool sports place: 400 when whitelabelId missing', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: { tenant: 'acme', userId: 1 },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId is required/)
})

test('bet-tool sports place: 400 when whitelabelId does not match tenant', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: { tenant: 'acme', whitelabelId: 'other-wl', userId: 1 },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId must match tenant/)
})

test('bet-tool sports place: 401 when BET_TOOL_API_KEY unset', async () => {
  ensureMinEnv()
  delete process.env.BET_TOOL_API_KEY
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/sports/place',
    payload: {},
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'any' },
  })
  assert.equal(res.statusCode, 401)
})

test('bet-tool casino place: 400 when whitelabelId missing', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/casino/place',
    payload: { tenant: 'acme', userId: 1, gameCode: 'some-game', stake: 10 },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId is required/)
})

test('bet-tool casino place: 400 when whitelabelId does not match tenant', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'POST',
    url: '/api/bet-tool/casino/place',
    payload: {
      tenant: 'acme',
      whitelabelId: 'other-wl',
      userId: 1,
      gameCode: 'some-game',
      stake: 10,
    },
    headers: { 'content-type': 'application/json', 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId must match tenant/)
})

test('bet-tool sports delete: 400 when query whitelabelId missing', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/bet-tool/sports/bets/bet-1?tenant=acme&userId=1',
    headers: { 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId is required/)
})

test('bet-tool casino delete: 400 when query whitelabelId missing', async () => {
  ensureMinEnv()
  process.env.BET_TOOL_API_KEY = 'tool-integration-secret'
  const { registerBetToolRoutes } = await import('./betToolRoutes.js')
  const app = Fastify({ logger: false })
  await registerBetToolRoutes(app)
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/bet-tool/casino/bets/bet-1?tenant=acme&userId=1',
    headers: { 'x-bet-tool-key': 'tool-integration-secret' },
  })
  assert.equal(res.statusCode, 400)
  const body = JSON.parse(res.body) as { message?: string }
  assert.match(body.message ?? '', /whitelabelId is required/)
})
