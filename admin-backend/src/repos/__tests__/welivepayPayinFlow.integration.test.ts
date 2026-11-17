import { before, after, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, depositRequests, users, wallets, welivepayOrders, whitelabelPgSettings, whitelabels } from '@shared/db/schema.js'
import { encrypt } from '@shared/security/cryptoVault.js'
import { seedDefaultVipTiers } from '@shared/vip/defaultTiers.js'
import { WelivepayApiError } from '@shared/services/welivepay/welivepayClient.js'
import { createWelivepayDeposit } from '../../../../user-backend/src/services/welivepayDepositService.js'
import { reconcileWelivepayPayin } from '../../../../user-backend/src/services/welivepayPayinStatusService.js'

// WeLivePay pay-ins: an order is credited only after the authenticated status read agrees on amount and
// gateway, at most once, including a verified late payment. Isolated UUID tenant; fetch is mocked.
const tenant = `payin-flow-${randomUUID().slice(0, 12)}`
const previousAllowed = process.env.WELIVEPAY_ALLOWED_USER_IDS
let userId = 0

before(async () => {
  delete process.env.WELIVEPAY_ALLOWED_USER_IDS
  await db.insert(whitelabels).values({ id: tenant, name: 'Payin Flow Test', domain: `${tenant}.invalid`,
    vipStartedAt: new Date(Date.now() - 60_000), creditLimit: '1000000', creditAvailable: '1000000', creditUsed: '0' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  await seedDefaultVipTiers(db, tenant)
  await db.insert(whitelabelPgSettings).values({ tenant, enabled: true, payinGateway: 'QPC',
    secretSiteKeyEncrypted: encrypt('test-key-never-sent'), webhookToken: randomUUID() })
  const [user] = await db.insert(users).values({ tenant, name: 'Payin Fixture', username: `payin-${randomUUID()}`,
    phone: '9876543210', passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
  await db.insert(wallets).values({ tenant, userId: user.id, currency: 'INR', cash: '0' })
  userId = user.id
})

after(async () => {
  if (previousAllowed === undefined) delete process.env.WELIVEPAY_ALLOWED_USER_IDS
  else process.env.WELIVEPAY_ALLOWED_USER_IDS = previousAllowed
  await new Promise(resolve => setTimeout(resolve, 100))
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM vip_transactions WHERE member_id IN (SELECT id FROM vip_members WHERE tenant=${tenant})`)
    await tx.execute(sql`DELETE FROM vip_member_history WHERE member_id IN (SELECT id FROM vip_members WHERE tenant=${tenant})`)
    await tx.execute(sql`DELETE FROM vip_members WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM vip_audit WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM wallet_ledger WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM ledger_entries WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM welivepay_orders WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM deposit_requests WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM notifications WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id=${tenant}`)
    await tx.execute(sql`DELETE FROM wallets WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM users WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabel_pg_settings WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM vip_tiers WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

const cash = async () => Number((await db.select().from(wallets).where(and(eq(wallets.tenant, tenant), eq(wallets.userId, userId))))[0].cash)
const order = async (orderid: string) => (await db.select().from(welivepayOrders).where(eq(welivepayOrders.orderid, orderid)))[0]
const gatewayDeposits = async () => db.select().from(depositRequests).where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.proofKey, 'welivepay')))
const start = (amount = 500) => createWelivepayDeposit({ tenant, userId, amount }, async input =>
  ({ paymentLink: 'https://fixture.invalid/pay', hostedUrl: 'https://fixture.invalid/pay', qrImage: '', orderId: input.orderid, status: 'pending' }))

/** get-order-detail answers with `detail` (merged into a pending order of `amount` on QPC). */
function providerSays(t: TestContext, detail: Record<string, unknown>) {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    const params = new URL(String(url)).searchParams
    return Response.json({ success: true, order: { order_id: params.get('orderid'), amount: 500, status: 'pending', gateway: 'qpc', ...detail } })
  })
}

test('an order keeps the gateway and key it was created with; a pending status credits nothing', async t => {
  const created = await start()
  assert.equal(created.hostedUrl, 'https://fixture.invalid/pay')
  const row = await order(created.orderId)
  assert.equal(row.gateway, 'QPC')
  assert.ok(row.merchantKeyEncrypted, 'merchant key snapshot stored')
  providerSays(t, {})
  assert.equal((await reconcileWelivepayPayin(created.orderId, tenant)).status, 'pending')
  assert.equal(await cash(), 0)
})

test('the provider amount and gateway must match before any credit', async t => {
  const created = await start()
  providerSays(t, { status: 'success', amount: 5000, txn_ref: 'UTR_FORGED' })
  await assert.rejects(() => reconcileWelivepayPayin(created.orderId, tenant), /verification mismatch/)
  t.mock.restoreAll()
  providerSays(t, { status: 'success', gateway: 'irispay', txn_ref: 'UTR_OTHER' })
  await assert.rejects(() => reconcileWelivepayPayin(created.orderId, tenant), /verification mismatch/)
  assert.equal(await cash(), 0)
  assert.equal((await order(created.orderId)).status, 'pending')
})

test('a verified success credits once, however often it is confirmed', async t => {
  const before = await cash()
  const created = await start()
  providerSays(t, { status: 'success', txn_ref: 'UTR_PAID_1' })
  await reconcileWelivepayPayin(created.orderId, tenant)
  await reconcileWelivepayPayin(created.orderId, tenant)
  const row = await order(created.orderId)
  assert.equal(row.status, 'success')
  assert.equal(row.txnRef, 'UTR_PAID_1')
  assert.equal(await cash(), before + 500)
  assert.equal((await gatewayDeposits()).filter(d => d.referenceId === created.orderId).length, 1)
})

test('a verified late payment credits an expired order once', async t => {
  const before = await cash()
  const created = await start()
  await db.update(welivepayOrders).set({ status: 'expired' }).where(eq(welivepayOrders.orderid, created.orderId))
  providerSays(t, { status: 'success', txn_ref: 'UTR_LATE_1' })
  await reconcileWelivepayPayin(created.orderId, tenant)
  await reconcileWelivepayPayin(created.orderId, tenant)
  assert.equal((await order(created.orderId)).status, 'success')
  assert.equal(await cash(), before + 500)
})

test('another whitelabel cannot settle this order', async () => {
  const created = await start()
  await assert.rejects(() => reconcileWelivepayPayin(created.orderId, 'some-other-tenant'), /not found/)
})

test('a refused create releases the order at once; an unreachable provider leaves it pending for reconciliation', async () => {
  let refused = ''
  await assert.rejects(() => createWelivepayDeposit({ tenant, userId, amount: 500 }, async input => {
    refused = input.orderid; throw new WelivepayApiError('Gateway not assigned', 400)
  }), /not assigned/)
  assert.equal((await order(refused)).status, 'invalid')

  let unconfirmed = ''
  await assert.rejects(() => createWelivepayDeposit({ tenant, userId, amount: 500 }, async input => {
    unconfirmed = input.orderid; throw new WelivepayApiError('WeLivePay could not be reached', 0)
  }), /could not be reached/)
  assert.equal((await order(unconfirmed)).status, 'pending')
})
