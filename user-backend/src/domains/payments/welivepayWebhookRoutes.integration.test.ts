import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerWelivepayWebhookRoutes, type WelivepayWebhookDeps } from './welivepayWebhookRoutes.js'

// Callbacks are triggers only: whatever the body says, the route hands the order to the authenticated
// status check of the token's whitelabel and never credits, completes or refunds from the body itself.
async function appFor(overrides: Partial<WelivepayWebhookDeps> = {}) {
  const app = Fastify({ logger: false })
  const deps: WelivepayWebhookDeps = {
    findTenantByWebhookToken: async token => token === 'valid' ? 'tenant_a' : null,
    findPayin: async () => ({ tenant: 'tenant_a' }),
    reconcilePayin: async () => ({ status: 'pending' }),
    findPayout: async () => ({ status: 'processing' }),
    reconcilePayout: async () => ({ status: 'processing' }),
    ...overrides,
  }
  await registerWelivepayWebhookRoutes(app, deps)
  return app
}

test('an unsigned success payload cannot decide status, amount or UTR', async () => {
  const calls: unknown[][] = []
  const app = await appFor({ reconcilePayin: async (...args) => { calls.push(args); return { status: 'pending' } } })
  const res = await app.inject({ method: 'POST', url: '/wlp/valid', payload: { orderid: 'PAYIN_TEST', status: 'success', amount: 100000, txn_ref: 'FORGED' } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls, [['PAYIN_TEST', 'tenant_a']], 'only the reference and the token tenant reach the status check')
  await app.close()
})

test('pay-in and payout notifications use their documented different order fields', async () => {
  const calls: unknown[][] = []
  const app = await appFor({ reconcilePayout: async (...args) => { calls.push(args) } })
  await app.inject({ method: 'POST', url: '/wlp/valid/payout', payload: { orderid: 'WRONG', status: 'success' } })
  assert.equal(calls.length, 0)
  const res = await app.inject({ method: 'POST', url: '/wlp/valid/payout', payload: { order_id: 'PAYOUT_TEST', status: 'failed', amount: 100 } })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls, [['PAYOUT_TEST', 'tenant_a']])
  await app.close()
})

test('unknown tokens and cross-tenant orders do not reconcile', async () => {
  let calls = 0
  const app = await appFor({ findPayin: async () => ({ tenant: 'other' }), reconcilePayin: async () => { calls++ } })
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/invalid', payload: { orderid: 'PAYIN_TEST' } })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid', payload: { orderid: 'PAYIN_TEST' } })).statusCode, 200)
  assert.equal(calls, 0)
  await app.close()
})

test('a payout reference of another whitelabel is not reconciled', async () => {
  let calls = 0
  const app = await appFor({ findPayout: async () => null, reconcilePayout: async () => { calls++ } })
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid/payout', payload: { order_id: 'PAYOUT_ELSEWHERE' } })).statusCode, 200)
  assert.equal(calls, 0)
  await app.close()
})

test('transient verification failures are retryable and sanitized', async () => {
  const app = await appFor({ reconcilePayin: async () => { throw new Error('PRIVATE_KEY') } })
  const res = await app.inject({ method: 'POST', url: '/wlp/valid', payload: { orderid: 'PAYIN_TEST' } })
  assert.equal(res.statusCode, 503)
  assert.ok(!res.body.includes('PRIVATE_KEY'))
  await app.close()
})

test('non-JSON bodies are rejected and the original pay-in URL keeps working', async () => {
  let calls = 0
  const app = await appFor({ reconcilePayin: async () => { calls++ } })
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid', headers: { 'content-type': 'text/plain' }, payload: 'orderid=TEST' })).statusCode, 400)
  assert.equal(calls, 0, 'a body that is not JSON never reaches the status check')
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid', payload: { orderid: 'PAYIN_TEST' } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid/payin', payload: { orderid: 'PAYIN_TEST' } })).statusCode, 200)
  assert.equal(calls, 2)
  await app.close()
})

test('a body without a usable reference is acknowledged and ignored', async () => {
  let calls = 0
  const app = await appFor({ reconcilePayin: async () => { calls++ } })
  for (const payload of [{}, { orderid: '' }, { orderid: 42 }, { orderid: 'X'.repeat(129) }]) {
    assert.equal((await app.inject({ method: 'POST', url: '/wlp/valid', payload })).statusCode, 200)
  }
  assert.equal(calls, 0)
  await app.close()
})
