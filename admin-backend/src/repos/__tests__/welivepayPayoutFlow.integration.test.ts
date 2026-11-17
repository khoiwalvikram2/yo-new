import { before, after, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { agentCreditLedger, appConfigs, ledgerEntries, userPayoutAccounts, users, walletLedger, wallets, welivepayPayouts, whitelabelPgSettings, whitelabels, withdrawalRequests } from '@shared/db/schema.js'
import { encrypt } from '@shared/security/cryptoVault.js'
import { WelivepayPayoutService } from '@shared/services/welivepay/welivepayPayoutService.js'
import { createWithdrawalRequest } from '../../../../user-backend/src/repos/userAppRepo.js'
import { updateWithdrawalStatusAdmin } from '../payments/withdrawalRequestsRepo.js'

// WeLivePay IMPS payouts against this repo's withdrawal accounting, on an isolated UUID tenant. No request
// leaves the process: fetch is mocked per test, answering like the merchant API.
const tenant = `payout-flow-${randomUUID().slice(0, 12)}`
const service = new WelivepayPayoutService(db, 'https://welivepay.in')
const ACCOUNT = { accountNumber: '012345678901', ifscCode: 'SBIN0001234', bankName: 'Test Bank', accountHolderName: 'Test Person' }

before(async () => {
  await db.insert(whitelabels).values({ id: tenant, name: 'Payout Flow Test', domain: `${tenant}.invalid`,
    creditLimit: '1000000', creditUsed: '50000', creditAvailable: '950000' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  await db.insert(whitelabelPgSettings).values({ tenant, enabled: false, payoutEnabled: true, payoutGateway: 'AUTO',
    secretSiteKeyEncrypted: encrypt('test-key-never-sent'), webhookToken: randomUUID() })
})

after(async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM welivepay_payouts WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM wallet_ledger WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM ledger_entries WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM withdrawal_requests WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM user_payout_accounts WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM notifications WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id=${tenant}`)
    await tx.execute(sql`DELETE FROM wallets WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM users WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabel_pg_settings WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

/** A player with 5,000 cash and an approved bank account, and a reserved withdrawal of `amount`. */
async function reservedWithdrawal(amount = 1000) {
  const [user] = await db.insert(users).values({ tenant, name: 'Payout Fixture', username: `payout-${randomUUID()}`,
    phone: '9876543210', passwordHash: 'test-not-login', playerType: 'REGULAR' }).returning()
  await db.insert(wallets).values({ tenant, userId: user.id, currency: 'INR', cash: '5000' })
  const [account] = await db.insert(userPayoutAccounts).values({ tenant, userId: user.id, method: 'BANK', approvalStatus: 'APPROVED', ...ACCOUNT }).returning()
  const withdrawal = await createWithdrawalRequest({ tenant, userId: user.id, amount, accountId: String(account.id) })
  return { user, withdrawalId: Number((withdrawal as any).id ?? (withdrawal as any)[0]?.id) }
}

const cash = async (userId: number) => Number((await db.select().from(wallets).where(and(eq(wallets.tenant, tenant), eq(wallets.userId, userId))))[0].cash)
const withdrawal = async (id: number) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0]
const creditUsed = async () => Number((await db.select().from(whitelabels).where(eq(whitelabels.id, tenant)))[0].creditUsed)
const refunds = async (id: number) => (await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenant, tenant), eq(ledgerEntries.type, 'withdrawal_refund'), sql`${ledgerEntries.meta}->>'withdrawalId' = ${String(id)}`))).length

/** The merchant API: create-payout answers `onCreate`, get-payout-detail answers `onDetail`. */
function mockProvider(t: TestContext, handlers: { onCreate?: (body: any) => Response; onDetail?: (body: any) => Response }) {
  const created: any[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (path === '/api/create-payout' && handlers.onCreate) { created.push(body); return handlers.onCreate(body) }
    if (path === '/api/get-payout-detail' && handlers.onDetail) return handlers.onDetail(body)
    throw new Error(`unexpected provider call ${path}`)
  })
  return created
}
const payoutBody = (orderid: string, status: string, extra: Record<string, unknown> = {}) => Response.json({ success: true, payout: {
  order_id: orderid, amount: 1000, status, beneficiary_account: ACCOUNT.accountNumber, beneficiary_ifsc: ACCOUNT.ifscCode, ...extra,
} }, { status: 201 })

test('a confirmed payout completes the withdrawal once, keeps the reserved cash spent and releases whitelabel credit', async t => {
  const { user, withdrawalId } = await reservedWithdrawal()
  assert.equal(await cash(user.id), 4000, 'the request reserved the amount')
  const usedBefore = await creditUsed()
  const created = mockProvider(t, {
    onCreate: body => payoutBody(body.orderid, 'processing', { payout_id: 'PO_1' }),
    onDetail: body => payoutBody(body.orderid, 'success', { utr: 'UTR_TEST_1' }),
  })

  const sent = await service.submit(withdrawalId, tenant, 1)
  assert.equal(sent.status, 'processing')
  assert.equal(created.length, 1)
  assert.equal(created[0].beneficiaryAccount, ACCOUNT.accountNumber, 'leading zeros preserved')
  assert.equal((await withdrawal(withdrawalId)).status, 'PROCESSING')
  await assert.rejects(() => updateWithdrawalStatusAdmin(withdrawalId, tenant, 'COMPLETED', 1), /managed by WeLivePay/)

  const settled = await service.reconcile(sent.orderid, tenant)
  assert.equal(settled.status, 'success')
  assert.equal(settled.utr, 'UTR_TEST_1')
  assert.equal((await withdrawal(withdrawalId)).status, 'COMPLETED')
  assert.equal(await cash(user.id), 4000)
  assert.equal(await creditUsed(), usedBefore - 1000)
  const releases = await db.select().from(agentCreditLedger).where(and(eq(agentCreditLedger.tenantId, tenant), eq(agentCreditLedger.transactionType, 'RELEASE')))
  assert.equal(releases.length, 1)
  const marker = await db.select().from(walletLedger).where(and(eq(walletLedger.tenant, tenant), eq(walletLedger.category, 'withdrawal_completed'), eq(walletLedger.referenceId, String(withdrawalId))))
  assert.equal(marker.length, 1)
  assert.equal(Number(marker[0].amount), 0)

  await service.reconcile(sent.orderid, tenant) // final: nothing more happens
  assert.equal(await creditUsed(), usedBefore - 1000)
})

test('a failed payout refunds the reserved cash exactly once', async t => {
  const { user, withdrawalId } = await reservedWithdrawal()
  mockProvider(t, {
    onCreate: body => payoutBody(body.orderid, 'processing'),
    onDetail: body => payoutBody(body.orderid, 'failed', { failure_reason: 'Beneficiary bank declined' }),
  })
  const sent = await service.submit(withdrawalId, tenant, 1)
  await service.reconcile(sent.orderid, tenant)
  await service.reconcile(sent.orderid, tenant)
  assert.equal((await withdrawal(withdrawalId)).status, 'FAILED')
  assert.equal(await cash(user.id), 5000)
  assert.equal(await refunds(withdrawalId), 1)
})

test('an unconfirmed submission keeps the reservation, and a retry reuses the same reference', async t => {
  const { user, withdrawalId } = await reservedWithdrawal()
  let reachable = false
  const created = mockProvider(t, {
    onCreate: body => {
      if (!reachable) throw new Error('socket hang up')
      return payoutBody(body.orderid, 'processing')
    },
    onDetail: () => Response.json({ success: false, error: 'Payout not found' }, { status: 404 }),
  })
  const first = await service.submit(withdrawalId, tenant, 1)
  assert.equal(first.status, 'pending')
  assert.match(first.failureReason ?? '', /unconfirmed/)
  assert.equal(await cash(user.id), 4000, 'an unconfirmed outcome is not a failure')
  await assert.rejects(() => service.reject(withdrawalId, tenant, 1, 'stop'), /Only an unsent payout/)

  // The submission lease expires, then the retry checks status first and resends the stored body.
  await db.update(welivepayPayouts).set({ submittedAt: new Date(Date.now() - 60_000) }).where(eq(welivepayPayouts.id, first.id))
  reachable = true
  const retried = await service.submit(withdrawalId, tenant, 1)
  assert.equal(retried.status, 'processing')
  assert.equal(created.length, 2)
  assert.equal(created[1].orderid, created[0].orderid, 'never a second reference for one withdrawal')
})

test('a balance-rejected payout can be rejected by an admin: cancelled and refunded once', async t => {
  const { user, withdrawalId } = await reservedWithdrawal()
  mockProvider(t, {
    onCreate: () => Response.json({ success: false, error: 'Amount + fee exceeds the project\'s withdrawable balance' }, { status: 400 }),
    onDetail: () => Response.json({ success: false, error: 'Payout not found' }, { status: 404 }),
  })
  const sent = await service.submit(withdrawalId, tenant, 1)
  assert.equal(sent.status, 'pending')
  await assert.rejects(() => service.reject(withdrawalId, tenant, 1, 'Funding'), /submission is in progress/)
  await db.update(welivepayPayouts).set({ submittedAt: new Date(Date.now() - 60_000) }).where(eq(welivepayPayouts.id, sent.id))
  await assert.rejects(() => service.reject(withdrawalId, tenant, 1, '   '), /rejection reason/)

  const rejected = await service.reject(withdrawalId, tenant, 1, 'Project balance too low')
  assert.equal(rejected.status, 'rejected')
  assert.equal((await withdrawal(withdrawalId)).status, 'CANCELLED')
  assert.equal(await cash(user.id), 5000)
  await service.reject(withdrawalId, tenant, 1, 'again')
  assert.equal(await refunds(withdrawalId), 1)
})

test('payouts stay off until enabled, and a withdrawal without a gateway payout still settles by hand', async t => {
  const { user, withdrawalId } = await reservedWithdrawal()
  mockProvider(t, {})
  await db.update(whitelabelPgSettings).set({ payoutEnabled: false }).where(eq(whitelabelPgSettings.tenant, tenant))
  try {
    await assert.rejects(() => service.submit(withdrawalId, tenant, 1), /Enable WeLivePay payouts/)
  } finally {
    await db.update(whitelabelPgSettings).set({ payoutEnabled: true }).where(eq(whitelabelPgSettings.tenant, tenant))
  }
  const failed = await updateWithdrawalStatusAdmin(withdrawalId, tenant, 'FAILED', 1)
  assert.equal(failed?.status, 'FAILED')
  assert.equal(await cash(user.id), 5000)
  assert.equal(await refunds(withdrawalId), 1)
})
