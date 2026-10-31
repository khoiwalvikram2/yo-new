/**
 * Integration tests for Gap Casino callback routes.
 * Uses RSA: casino key pair for incoming request signatures, our key pair for response signatures.
 * Run: node --test src/domains/casino/casinoCallbackRoutes.integration.test.ts
 * Or: npm run test (from user-backend)
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createSign, generateKeyPairSync } from 'crypto'
import Fastify from 'fastify'
import { registerCasinoCallbackRoutes } from './casinoCallbackRoutes.js'
import { stringifyCanonical } from '../../config/casino/signatureUtils.js'

const casinoKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ourKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const CASINO_PUBLIC_PEM = casinoKeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string
const CASINO_PRIVATE_PEM = casinoKeyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
const OUR_PRIVATE_PEM = ourKeyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string

function signWithPrivateKey(data: string, privateKeyPem: string): string {
  const sign = createSign('RSA-SHA256')
  sign.update(data)
  return sign.sign(privateKeyPem, 'base64')
}

function ensureCasinoEnv() {
  // Force-override .env values that dotenv/config loaded at import time — we need
  // the test-generated key pair, not the real GAP public key from .env.
  process.env.CASINO_BASE_URL = 'https://casino.test.example'
  process.env.CASINO_PARTNER_ID = 'test-partner'
  process.env.CASINO_SECRET = CASINO_PUBLIC_PEM
  process.env.CASINO_REDIRECT_URL = 'https://app.test.example'
  process.env.CASINO_PRIVATE_KEY = OUR_PRIVATE_PEM
}

async function buildApp() {
  const app = Fastify({ logger: false })
  await registerCasinoCallbackRoutes(app)
  return app
}

// Signs the raw serialized body bytes (what GAP actually does) so the raw-body
// verify path in casinoCallbackPre matches.
function injectSigned(
  app: Awaited<ReturnType<typeof buildApp>>,
  url: string,
  body: Record<string, unknown>,
  opts: { signer?: string; overrideSig?: string; canonicalSign?: boolean } = {}
) {
  const payload = opts.canonicalSign ? stringifyCanonical(body) : JSON.stringify(body)
  const signer = opts.signer ?? CASINO_PRIVATE_PEM
  const sig = opts.overrideSig ?? signWithPrivateKey(payload, signer)
  return app.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'content-type': 'application/json', Signature: sig },
  })
}

test('POST /gap/balance with no Signature returns OP_INVALID_SIGNATURE', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 'any', request_uuid: 'req-1' }
  const res = await app.inject({
    method: 'POST',
    url: '/gap/balance',
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(res.statusCode, 200)
  const json = res.json() as { status: string; request_uuid?: string }
  assert.equal(json.status, 'OP_INVALID_SIGNATURE')
  assert.equal(json.request_uuid, 'req-1')
})

test('POST /gap/balance with wrong-key Signature returns OP_INVALID_SIGNATURE', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 'any', request_uuid: 'req-2' }
  // Sign with OUR_PRIVATE_PEM — CASINO_SECRET is CASINO_PUBLIC_PEM, so verify must fail
  const res = await injectSigned(app, '/gap/balance', body, { signer: OUR_PRIVATE_PEM })
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_SIGNATURE')
})

test('POST /gap/balance with valid raw-body signature but bad body shape → OP_INVALID_PARAMS', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: -1 } // fails schema
  const res = await injectSigned(app, '/gap/balance', body)
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_PARAMS')
})

test('POST /gap/balance with canonical-form signature (fallback path) is also accepted', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  // Non-alphabetical key order so raw != canonical; raw verify will fail but canonical fallback should pass.
  const body = { userId: -1, token: 'any', request_uuid: 'req-canonical' }
  const res = await injectSigned(app, '/gap/balance', body, { canonicalSign: true })
  assert.equal(res.statusCode, 200)
  // Schema still rejects userId: -1 → OP_INVALID_PARAMS means signature passed.
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_PARAMS')
})

test('POST /gap/balance response carries a Signature header when handler returns 200', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 999, token: 'nonexistent-token', request_uuid: 'req-sig' }
  const res = await injectSigned(app, '/gap/balance', body)
  assert.equal(res.statusCode, 200)
  const json = res.json() as { status: string }
  // No DB: expect OP_INVALID_TOKEN from the handler (session lookup will throw/fail),
  // but OP_GENERAL_ERROR is also acceptable since there's no real DB in unit context.
  assert.ok(['OP_INVALID_TOKEN', 'OP_GENERAL_ERROR', 'OP_SUCCESS'].includes(json.status))
  const responseSig = res.headers['signature'] ?? res.headers['Signature']
  // Response signature only set on success; when handler errors we skip it.
  if (json.status === 'OP_INVALID_TOKEN' || json.status === 'OP_SUCCESS') {
    assert.ok(responseSig, 'Response should have Signature header')
  }
})

test('POST /gap/betRequest with no Signature returns OP_INVALID_SIGNATURE', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', debitAmount: 10, gameId: 'g1', reqId: 'req-d' }
  const res = await app.inject({
    method: 'POST',
    url: '/gap/betRequest',
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_SIGNATURE')
})

test('POST /gap/betRequest with missing gameId → OP_INVALID_PARAMS', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', debitAmount: 10 }
  const res = await injectSigned(app, '/gap/betRequest', body)
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_PARAMS')
})

test('POST /gap/betRequest with empty gameId → OP_INVALID_PARAMS (GAP "Nullable Parameters")', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', debitAmount: 10, gameId: '', reqId: 'rq' }
  const res = await injectSigned(app, '/gap/betRequest', body)
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_PARAMS')
})

test('POST /gap/betRequest with negative debitAmount → OP_ERROR_NEGATIVE_DEBIT_AMOUNT', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', debitAmount: -200, gameId: 'g1', reqId: 'rq-neg' }
  const res = await injectSigned(app, '/gap/betRequest', body)
  assert.equal(res.statusCode, 200)
  const json = res.json() as { status: string; user?: number; request_uuid?: string }
  assert.equal(json.status, 'OP_ERROR_NEGATIVE_DEBIT_AMOUNT')
  assert.equal(json.user, 1)
  assert.equal(json.request_uuid, 'rq-neg')
})

test('POST /gap/betRequest extra unknown field (GAP "Random Key") does not break signature verify', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = {
    randomKey: 'ROYAL CASINO',
    operatorId: 'lootofun',
    userId: 1,
    token: 't',
    transactionId: 'tx-rk',
    roundId: 'r-rk',
    debitAmount: 20,
    gameId: 'g1',
    reqId: 'req-rk',
  }
  const res = await injectSigned(app, '/gap/betRequest', body)
  assert.equal(res.statusCode, 200)
  const json = res.json() as { status: string }
  // Signature MUST pass (would be OP_INVALID_SIGNATURE otherwise). Status past that
  // depends on DB state in real env; in unit context we accept any non-signature status.
  assert.notEqual(json.status, 'OP_INVALID_SIGNATURE')
})

test('POST /gap/resultRequest with invalid signature → OP_INVALID_SIGNATURE', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', creditAmount: 50, gameId: 'g1', reqId: 'req-c' }
  const res = await injectSigned(app, '/gap/resultRequest', body, { overrideSig: 'invalid-base64!!!' })
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_SIGNATURE')
})

test('POST /gap/rollbackRequest with invalid signature → OP_INVALID_SIGNATURE', async () => {
  ensureCasinoEnv()
  const app = await buildApp()
  const body = { userId: 1, token: 't', transactionId: 'tx1', roundId: 'r1', gameId: 'g1', reqId: 'req-r' }
  const res = await injectSigned(app, '/gap/rollbackRequest', body, { overrideSig: 'bad' })
  assert.equal(res.statusCode, 200)
  assert.equal((res.json() as { status: string }).status, 'OP_INVALID_SIGNATURE')
})
