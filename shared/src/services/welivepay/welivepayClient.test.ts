import test from 'node:test'
import assert from 'node:assert/strict'
import { createWelivepayPayment, getWelivepayPayin, createWelivepayPayout, getWelivepayPayout, getWelivepayAvailableGateways, isPayinGatewayCode, isPayoutGatewayCode, indianMobile, paymentAmount, validatePayoutRequest, WelivepayApiError } from './welivepayClient.js'

// Contract tests ported from the gw project. No request leaves the process: fetch is mocked.
const credentials = { baseUrl: 'https://welivepay.in', key: 'PRIVATE_TEST_KEY' }
const payout = { orderid: 'PAYOUT_20261010_TEST', amount: 100, payoutType: 'IMPS' as const, beneficiaryAccount: '012345678901', beneficiaryIFSC: 'sbin0001234', beneficiaryName: 'Test Person', beneficiaryMobNo: '+91 9876543210', bankName: 'Test Bank', payoutRemark: 'Withdrawal' }
const remote = { order_id: payout.orderid, amount: 100, status: 'processing', beneficiary_account: payout.beneficiaryAccount, beneficiary_ifsc: 'SBIN0001234', merchant_transaction_id: 'PO_TEST', payout_id: 'TEST' }

test('Iris hosted checkout is preferred even when QR and payment_link are empty', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, order_id: 'PAYIN_TEST_2026', hosted_url: 'https://welivepay.in/pay/intent/test', payment_link: '', qr_image: '', status: 'pending' }))
  const result = await createWelivepayPayment({ ...credentials, orderid: 'PAYIN_TEST_2026', amount: 100, mobile: '+91 9876543210', username: 'Test' })
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://welivepay.in/api/irispay/create-payment')
  assert.equal(JSON.parse(fetch.mock.calls[0].arguments[1]!.body as string).mobile, '9876543210')
  assert.equal(result.paymentLink, 'https://welivepay.in/pay/intent/test')
  assert.equal(result.hostedUrl, result.paymentLink)
})

test('existing assigned AKMulti gateway remains supported', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, order_id: 'PAYIN_LEGACY_1', payment_link: 'upi://pay?pa=test', qr_image: 'BASE64' }))
  const result = await createWelivepayPayment({ ...credentials, gateway: 'AKMULTISOLUTIONS', orderid: 'PAYIN_LEGACY_1', amount: 10, mobile: '9876543210', username: 'Test' })
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://welivepay.in/api/akmultisolutions/create-payment')
  assert.equal(result.hostedUrl, null)
})

test('status uses original reference, gross amount and authenticated GET', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, order: { order_id: 'PAYIN_TEST_2026', amount: 100, total_amount: 98, status: 'success', txn_ref: 'UTR_TEST', gateway: 'irispay' } }))
  const result = await getWelivepayPayin({ ...credentials, orderid: 'PAYIN_TEST_2026' })
  assert.equal(new URL(String(fetch.mock.calls[0].arguments[0])).searchParams.get('key'), credentials.key)
  assert.equal(result.amount, 100); assert.equal(result.status, 'success')
})

test('payout preserves account leading zeros and only sends documented fields', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, payout: remote }, { status: 201 }))
  const result = await createWelivepayPayout({ ...credentials, payout: { ...payout, extra: 'DO_NOT_SEND' } as any })
  const call = fetch.mock.calls[0].arguments
  assert.equal(call[0], 'https://welivepay.in/api/create-payout')
  const body = JSON.parse(call[1]!.body as string)
  assert.equal(body.beneficiaryAccount, '012345678901'); assert.equal(body.beneficiaryIFSC, 'SBIN0001234'); assert.equal(body.beneficiaryMobNo, '9876543210')
  assert.equal(body.extra, undefined); assert.equal(result.status, 'processing')
})

test('payout status is a POST so its URL does not expose the merchant key', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, payout: { ...remote, status: 'failed', failure_reason: `Invalid ${credentials.key}` } }))
  const result = await getWelivepayPayout({ ...credentials, orderid: payout.orderid })
  const call = fetch.mock.calls[0].arguments
  assert.equal(call[0], 'https://welivepay.in/api/get-payout-detail'); assert.equal(call[1]!.method, 'POST')
  assert.equal(result.status, 'failed'); assert.ok(!result.failureReason!.includes(credentials.key))
})

test('mismatched references, invalid precision and malformed beneficiary data are rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, payout: { ...remote, order_id: 'OTHER_ORDER' } }))
  await assert.rejects(getWelivepayPayout({ ...credentials, orderid: payout.orderid }), /Invalid.*response/)
  for (const amount of [0, -1, NaN, Infinity, 1.234]) assert.throws(() => paymentAmount(amount))
  assert.equal(paymentAmount('0.01'), 0.01)
  assert.throws(() => validatePayoutRequest({ ...payout, beneficiaryAccount: 'name@upi' }))
  assert.throws(() => indianMobile('123'))
})

test('available gateways are read with the key in a POST body and mapped to create-path codes', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, gateways: {
    payin: [{ key: 'qpc', label: 'QuickPayCash (Payin)', method: 'POST', endpoint: '/api/qpc/create-payment' }, { key: 'akms', label: 'AK Multi Solutions', method: 'POST', endpoint: '/api/akmultisolutions/create-payment' }, { key: 'unknown', label: 'No endpoint', method: 'POST' }, { key: 'evil', label: 'Off-path', method: 'POST', endpoint: 'https://evil.test/api/x/create-payment' }],
    payout: [{ key: 'qpc_payout', label: 'QuickPayCash (Payout)', method: 'POST', endpoint: '/api/qpc/create-payout' }, { key: 'wrong', label: 'Payin path', method: 'POST', endpoint: '/api/irispay/create-payment' }],
  } }))
  const result = await getWelivepayAvailableGateways(credentials)
  const call = fetch.mock.calls[0].arguments
  assert.equal(call[0], 'https://welivepay.in/api/get-available-gateways'); assert.equal(call[1]!.method, 'POST')
  assert.deepEqual(JSON.parse(call[1]!.body as string), { key: credentials.key })
  assert.deepEqual(result, {
    payin: [{ code: 'QPC', key: 'qpc', label: 'QuickPayCash (Payin)' }, { code: 'AKMULTISOLUTIONS', key: 'akms', label: 'AK Multi Solutions' }],
    payout: [{ code: 'QPC', key: 'qpc_payout', label: 'QuickPayCash (Payout)' }],
  })
})

test('no payout permission yields an empty payout list; a malformed body is rejected', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, gateways: { payin: [], payout: [] } }))
  assert.deepEqual(await getWelivepayAvailableGateways(credentials), { payin: [], payout: [] })
  fetch.mock.mockImplementation(async () => Response.json({ success: true }))
  await assert.rejects(getWelivepayAvailableGateways(credentials), /Invalid WeLivePay gateway list/)
  fetch.mock.mockImplementation(async () => Response.json({ success: false, error: `Invalid key ${credentials.key}` }, { status: 400 }))
  await assert.rejects(getWelivepayAvailableGateways(credentials), error => error instanceof WelivepayApiError && error.statusCode === 400 && !error.message.includes(credentials.key))
})

test('a listed QPC gateway is used for pay-in and pinned payout create paths', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).endsWith('/create-payment')
    ? Response.json({ success: true, order_id: 'PAYIN_QPC_2026', hosted_url: 'https://welivepay.in/pay/intent/qpc' })
    : Response.json({ success: true, payout: remote }, { status: 201 }))
  await createWelivepayPayment({ ...credentials, gateway: 'QPC', orderid: 'PAYIN_QPC_2026', amount: 100, mobile: '9876543210', username: 'Test' })
  await createWelivepayPayout({ ...credentials, gateway: 'QPC', payout })
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://welivepay.in/api/qpc/create-payment')
  assert.equal(fetch.mock.calls[1].arguments[0], 'https://welivepay.in/api/qpc/create-payout')
  assert.ok(isPayinGatewayCode('QPC') && isPayoutGatewayCode('AUTO') && !isPayinGatewayCode('../x') && !isPayinGatewayCode('qpc'))
  await assert.rejects(createWelivepayPayment({ ...credentials, gateway: '../admin', orderid: 'PAYIN_QPC_2026', amount: 100, mobile: '9876543210', username: 'Test' }), /Unsupported/)
})

test('AK Multi order detail key matches the stored create-path code', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, order: { order_id: 'PAYIN_LEGACY_1', amount: 10, status: 'pending', gateway: 'akms' } }))
  assert.equal((await getWelivepayPayin({ ...credentials, orderid: 'PAYIN_LEGACY_1' })).gateway, 'AKMULTISOLUTIONS')
})

test('HTTP and network failures never leak the merchant key', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, error: `bad key ${credentials.key}` }, { status: 403 }))
  await assert.rejects(getWelivepayPayout({ ...credentials, orderid: payout.orderid }), error => error instanceof WelivepayApiError && error.statusCode === 403 && !error.message.includes(credentials.key))
  fetch.mock.mockImplementation(async () => { throw new Error(`fetch URL ?key=${credentials.key}`) })
  await assert.rejects(getWelivepayPayin({ ...credentials, orderid: 'PAYIN_TEST_2026' }), error => error instanceof WelivepayApiError && error.statusCode === 0 && !error.message.includes(credentials.key))
})
