import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerWelivepayWebhookRoutes, type WelivepayWebhookDeps } from './welivepayWebhookRoutes.js'

function baseDeps(over: Partial<WelivepayWebhookDeps> = {}): WelivepayWebhookDeps {
  return {
    findTenantByWebhookToken: mock.fn(async () => null),
    findOrderByOrderId: mock.fn(async () => null),
    creditOrderOnSuccess: mock.fn(async () => ({ credited: true })),
    markOrderStatus: mock.fn(async () => {}),
    ...over,
  }
}

async function buildApp(deps: WelivepayWebhookDeps) {
  const app = Fastify({ logger: false })
  await registerWelivepayWebhookRoutes(app, deps)
  return app
}

function post(app: Awaited<ReturnType<typeof buildApp>>, token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/wlp/${token}`,
    payload: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

test('400s on a non-JSON body (does not silently 200 a real payment)', async () => {
  const credit = mock.fn(async () => ({ credited: true }))
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    creditOrderOnSuccess: credit,
  })
  const app = await buildApp(deps)
  const res = await app.inject({
    method: 'POST',
    url: '/wlp/goodtoken',
    payload: 'orderid=ORDER_1_2_abc&status=success&amount=100',
    headers: { 'content-type': 'text/plain' },
  })
  assert.equal(res.statusCode, 400)
  assert.equal(credit.mock.calls.length, 0)
})

test('401s on unknown token', async () => {
  const deps = baseDeps()
  const app = await buildApp(deps)
  const res = await post(app, 'badtoken', { orderid: 'ORDER_1_2_abc', status: 'success', amount: 100 })
  assert.equal(res.statusCode, 401)
})

test('credits once on success with matching amount', async () => {
  const credit = mock.fn(async () => ({ credited: true }))
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    findOrderByOrderId: mock.fn(async () => ({ tenant: 'tenantA', orderid: 'ORDER_1_2_abc', status: 'pending', amount: '100.00' }) as any),
    creditOrderOnSuccess: credit,
  })
  const app = await buildApp(deps)
  const res = await post(app, 'goodtoken', { orderid: 'ORDER_1_2_abc', status: 'success', amount: 100, txn_ref: '412345678901' })
  assert.equal(res.statusCode, 200)
  assert.equal(credit.mock.calls.length, 1)
  assert.deepEqual(credit.mock.calls[0].arguments[0], { orderid: 'ORDER_1_2_abc', txnRef: '412345678901' })
})

test('returns 500 when credit throws so WeLivePay retries', async () => {
  const credit = mock.fn(async () => { throw new Error('insufficient whitelabel credit') })
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    findOrderByOrderId: mock.fn(async () => ({ tenant: 'tenantA', orderid: 'ORDER_1_2_abc', status: 'pending', amount: '100.00' }) as any),
    creditOrderOnSuccess: credit,
  })
  const app = await buildApp(deps)
  const res = await post(app, 'goodtoken', { orderid: 'ORDER_1_2_abc', status: 'success', amount: 100 })
  assert.equal(res.statusCode, 500)
  assert.equal(credit.mock.calls.length, 1)
})

test('does not credit on amount mismatch but returns 200', async () => {
  const credit = mock.fn(async () => ({ credited: true }))
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    findOrderByOrderId: mock.fn(async () => ({ tenant: 'tenantA', orderid: 'ORDER_1_2_abc', status: 'pending', amount: '100.00' }) as any),
    creditOrderOnSuccess: credit,
  })
  const app = await buildApp(deps)
  const res = await post(app, 'goodtoken', { orderid: 'ORDER_1_2_abc', status: 'success', amount: 99 })
  assert.equal(res.statusCode, 200)
  assert.equal(credit.mock.calls.length, 0)
})

test('marks expired without crediting', async () => {
  const credit = mock.fn(async () => ({ credited: true }))
  const markStatus = mock.fn(async () => {})
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    findOrderByOrderId: mock.fn(async () => ({ tenant: 'tenantA', orderid: 'ORDER_1_2_abc', status: 'pending', amount: '100.00' }) as any),
    creditOrderOnSuccess: credit,
    markOrderStatus: markStatus,
  })
  const app = await buildApp(deps)
  const res = await post(app, 'goodtoken', { orderid: 'ORDER_1_2_abc', status: 'expired', amount: 100 })
  assert.equal(res.statusCode, 200)
  assert.equal(markStatus.mock.calls.length, 1)
  assert.deepEqual(markStatus.mock.calls[0].arguments, ['ORDER_1_2_abc', 'expired', null])
  assert.equal(credit.mock.calls.length, 0)
})

test('rejects order from a different tenant', async () => {
  const credit = mock.fn(async () => ({ credited: true }))
  const deps = baseDeps({
    findTenantByWebhookToken: mock.fn(async () => 'tenantA'),
    findOrderByOrderId: mock.fn(async () => ({ tenant: 'tenantB', orderid: 'ORDER_1_2_abc', status: 'pending', amount: '100.00' }) as any),
    creditOrderOnSuccess: credit,
  })
  const app = await buildApp(deps)
  const res = await post(app, 'goodtoken', { orderid: 'ORDER_1_2_abc', status: 'success', amount: 100 })
  assert.equal(res.statusCode, 200)
  assert.equal(credit.mock.calls.length, 0)
})
