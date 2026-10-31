import test from 'node:test'
import assert from 'node:assert/strict'
import { createWelivepayPayment } from './welivepayClient.js'

test('createWelivepayPayment posts the expected body and returns the parsed payload', async () => {
  const calls: Array<[unknown, { method?: string; body?: string }]> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init: { method?: string; body?: string }) => {
    calls.push([url, init])
    return {
      ok: true,
      json: async () => ({
        success: true,
        order_id: 'ORDER_1_2_abc',
        amount: 100,
        payment_link: 'https://pay/x',
        qr_image: 'BASE64',
        status: 'pending',
      }),
    }
  }) as unknown as typeof fetch

  try {
    const res = await createWelivepayPayment({
      baseUrl: 'https://welivepay.in',
      key: 'SECRET',
      orderid: 'ORDER_1_2_abc',
      amount: 100,
      mobile: '9876543210',
      username: 'Rajesh',
      redirectUrl: 'https://site/ok',
    })

    assert.equal(calls[0][0], 'https://welivepay.in/api/akmultisolutions/create-payment')
    assert.equal(calls[0][1].method, 'POST')
    assert.deepEqual(JSON.parse(calls[0][1].body as string), {
      key: 'SECRET', orderid: 'ORDER_1_2_abc', amount: 100,
      mobile: '9876543210', username: 'Rajesh', redirect_url: 'https://site/ok',
    })
    assert.deepEqual(res, { paymentLink: 'https://pay/x', qrImage: 'BASE64', orderId: 'ORDER_1_2_abc', status: 'pending' })
  } finally {
    globalThis.fetch = original
  }
})

test('createWelivepayPayment throws with the gateway error message on success:false', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ success: false, error: 'amount is required' }),
  })) as unknown as typeof fetch

  try {
    await assert.rejects(
      createWelivepayPayment({
        baseUrl: 'https://welivepay.in', key: 'K', orderid: 'ORDER_1_2_ab', amount: 0,
        mobile: '9', username: 'x',
      }),
      /amount is required/
    )
  } finally {
    globalThis.fetch = original
  }
})
