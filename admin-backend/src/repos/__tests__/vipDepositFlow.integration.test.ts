import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { appConfigs, depositRequests, users, vipMembersTable, vipTiersTable, vipTransactionsTable, wallets, welivepayOrders, whitelabelPaymentMethods, whitelabelPgSettings, whitelabels } from '@shared/db/schema.js'
import { db as userDb } from '../../../../user-backend/src/db/client.js'
import { seedDefaultVipTiers } from '@shared/vip/defaultTiers.js'
import { changePlayerVipTier, refreshAutomaticVipTiers } from '@shared/vip/membership.js'
import { DateTime } from 'luxon'
import { encrypt } from '@shared/security/cryptoVault.js'
import { createDepositRequest, getWhitelabelAccounts } from '../../../../user-backend/src/repos/userAppRepo.js'
import { createWelivepayDeposit } from '../../../../user-backend/src/services/welivepayDepositService.js'
import { creditOrderOnSuccess } from '../../../../user-backend/src/repos/welivepayOrdersRepo.js'
import { getUserVipStatus } from '../../../../user-backend/src/repos/vipRepo.js'
import { approveDepositRequest, rejectDepositRequest } from '../deposits/depositRequestsRepo.js'
import { deleteVipTierDb, updateVipMemberDb, updateVipTierDb, addVipPointsDb, removeVipPointsDb } from '../vip/vipRepo.js'
import { isVipEligible } from '../../../../user-backend/src/repos/vipRepo.js'
import { whitelabelTimeZone } from '@shared/vip/depositAccess.js'
import { updatePlayerTypeDb } from '../users/usersRepo.js'
import { upsertWhitelabel } from '../common/whitelabelRepo.js'
import { validatePaymentAccountTiers } from '@shared/vip/depositAccess.js'

const tenant = `vip-flow-${randomUUID().slice(0, 12)}`
let tiers: Array<typeof vipTiersTable.$inferSelect> = []
const previousAllowed = process.env.WELIVEPAY_ALLOWED_USER_IDS

before(async () => {
  delete process.env.WELIVEPAY_ALLOWED_USER_IDS // isolated test process only
  await db.insert(whitelabels).values({ id: tenant, name: 'VIP Flow Test', domain: `${tenant}.invalid`,
    vipStartedAt: new Date(Date.now() - 60_000), creditLimit: '1000000', creditAvailable: '1000000', creditUsed: '0' })
  await db.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
  await seedDefaultVipTiers(db, tenant)
  tiers = await db.select().from(vipTiersTable).where(eq(vipTiersTable.tenant, tenant)).orderBy(vipTiersTable.level)
  await db.insert(whitelabelPaymentMethods).values({ tenant, limits: { min: 10, max: 500000 }, bankDetails: [
    { id: 'bank-public', enabled: true, accountName: 'Test Only', accountNumber: 'FIXTURE01', ifsc: 'TEST0000001', bankName: 'Fixture Bank', branch: 'Test' },
    { id: 'bank-silver', enabled: true, accountName: 'Test Only', accountNumber: 'FIXTURE02', ifsc: 'TEST0000001', bankName: 'Fixture Bank', branch: 'Test', vipTierIds: [tiers[1].id] },
  ], upiDetails: [] })
  await db.insert(whitelabelPgSettings).values({ tenant, enabled: true, secretSiteKeyEncrypted: encrypt('test-key-never-sent'), webhookToken: randomUUID() })
})

after(async () => {
  if (previousAllowed === undefined) delete process.env.WELIVEPAY_ALLOWED_USER_IDS
  else process.env.WELIVEPAY_ALLOWED_USER_IDS = previousAllowed
  // All financial mutations in this suite belong to this UUID tenant only.
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
    await tx.execute(sql`DELETE FROM whitelabel_payment_methods WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM vip_tiers WHERE tenant=${tenant}`)
    await tx.execute(sql`DELETE FROM app_configs WHERE whitelabel_id=${tenant}`)
    await tx.execute(sql`DELETE FROM whitelabels WHERE id=${tenant}`)
  })
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

async function player(type: 'REGULAR' | 'AGENT_CREDIT' | 'WHITELABEL_CREDIT' = 'REGULAR') {
  const [user] = await db.insert(users).values({ tenant, name: 'VIP Fixture', username: `vip-${randomUUID()}`,
    phone: '9999999911', passwordHash: 'test-not-login', playerType: type }).returning()
  await db.insert(wallets).values({ tenant, userId: user.id, currency: 'INR', cash: '0' })
  return user
}
const cash = async (userId: number) => Number((await db.select().from(wallets).where(and(eq(wallets.tenant, tenant), eq(wallets.userId, userId))))[0].cash)
const request = (userId: number, amount: number, accountId = 'bank-public') => createDepositRequest({
  tenant, userId, amount, accountId, method: 'BANK_TRANSFER', proofKey: 'test-fixture', referenceId: randomUUID(),
})

test('manual deposit: selected account snapshot, one wallet credit, matching tier and one VIP award', async () => {
  const user = await player()
  assert.ok(!(await getWhitelabelAccounts(tenant, user.id)).some(account => account.id === 'bank-silver'))
  await assert.rejects(() => request(user.id, 100, 'bank-silver'), /unavailable/)
  const pending = await request(user.id, 10_000)
  assert.equal(pending.receivingAccountId, 'bank-public')
  assert.equal((pending.vipPolicySnapshot as any).tierName, 'Bronze')
  await approveDepositRequest(pending.id, tenant, 1)
  await assert.rejects(() => approveDepositRequest(pending.id, tenant, 1), /already processed/)
  assert.equal(await cash(user.id), 10_000)
  const status = await getUserVipStatus(user.id, tenant)
  assert.equal(status?.tierName, 'Silver'); assert.equal(status?.currentPoints, 10_000)
  assert.equal((await db.select().from(vipTransactionsTable).where(eq(vipTransactionsTable.depositRequestId, pending.id))).length, 1)
  assert.ok((await getWhitelabelAccounts(tenant, user.id)).some(account => account.id === 'bank-silver'))
})

test('two simultaneous requests cannot exceed a daily cap; rejected request releases its reservation', async () => {
  const user = await player()
  await db.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['BANK_TRANSFER'], min: 10, max: null, daily: 1000, monthly: 2000 } }).where(eq(vipTiersTable.id, tiers[0].id))
  try {
    const results = await Promise.allSettled([request(user.id, 700), request(user.id, 700)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const [pending] = await db.select().from(depositRequests).where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.userId, user.id)))
    assert.equal((await getWhitelabelAccounts(tenant, user.id)).find(account => account.id === 'bank-public')?.maxAmount, 300)
    await rejectDepositRequest(pending.id, tenant, 1)
    assert.equal((await getWhitelabelAccounts(tenant, user.id)).find(account => account.id === 'bank-public')?.maxAmount, 1000)
    assert.equal(await cash(user.id), 0)
  } finally {
    await db.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'], min: null, max: null, daily: null, monthly: null } }).where(eq(vipTiersTable.id, tiers[0].id))
  }
})

const capPolicy = { enabled: true, methods: ['BANK_TRANSFER', 'GATEWAY'], min: 10, max: null, daily: 1000, monthly: null }
const openPolicy = { enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'], min: null, max: null, daily: null, monthly: null }
const bankMax = async (userId: number) => (await getWhitelabelAccounts(tenant, userId)).find(account => account.id === 'bank-public')?.maxAmount

test('a gateway order reserves the cap before the provider is called; a provider failure releases it', async () => {
  const user = await player()
  await db.update(vipTiersTable).set({ depositPolicy: capPolicy }).where(eq(vipTiersTable.id, tiers[0].id))
  try {
    const created = await createWelivepayDeposit({ tenant, userId: user.id, amount: 700 }, async input => {
      // The reservation is committed and the lock released while the provider runs.
      const [order] = await db.select().from(welivepayOrders).where(eq(welivepayOrders.orderid, input.orderid))
      assert.equal(order.status, 'pending'); assert.equal(order.paymentLink, null)
      await assert.rejects(() => request(user.id, 700), /Allowed deposit amount/)
      return { paymentLink: 'https://fixture.invalid/payment', qrImage: '', orderId: input.orderid, status: 'pending' }
    })
    const [order] = await db.select().from(welivepayOrders).where(eq(welivepayOrders.orderid, created.orderId))
    assert.equal(order.paymentLink, 'https://fixture.invalid/payment')
    assert.equal(await bankMax(user.id), 300)

    let failedOrder = ''
    await assert.rejects(() => createWelivepayDeposit({ tenant, userId: user.id, amount: 200 }, async input => {
      failedOrder = input.orderid; throw new Error('provider unavailable')
    }), /provider unavailable/)
    assert.equal((await db.select().from(welivepayOrders).where(eq(welivepayOrders.orderid, failedOrder)))[0].status, 'invalid')
    assert.equal(await bankMax(user.id), 300)
    assert.equal((await db.select().from(depositRequests).where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.userId, user.id)))).length, 0)
  } finally {
    await db.update(vipTiersTable).set({ depositPolicy: openPolicy }).where(eq(vipTiersTable.id, tiers[0].id))
  }
})

test('a manual request and a gateway order racing for one daily cap: only one is accepted', async () => {
  const user = await player()
  await db.update(vipTiersTable).set({ depositPolicy: capPolicy }).where(eq(vipTiersTable.id, tiers[0].id))
  try {
    // Warm the pool so both requests really overlap instead of queueing on connects.
    await Promise.all(Array.from({ length: 4 }, () => userDb.execute(sql`SELECT 1`)))
    const results = await Promise.allSettled([
      createWelivepayDeposit({ tenant, userId: user.id, amount: 700 }, async input =>
        ({ paymentLink: 'https://fixture.invalid/payment', qrImage: '', orderId: input.orderid, status: 'pending' })),
      request(user.id, 700),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(await bankMax(user.id), 300)
  } finally {
    await db.update(vipTiersTable).set({ depositPolicy: openPolicy }).where(eq(vipTiersTable.id, tiers[0].id))
  }
})

test('pending deposit retains its original policy snapshot after a manual tier change', async () => {
  const user = await player()
  const pending = await request(user.id, 100)
  await changePlayerVipTier(db, tenant, user.id, tiers[3].id, 'fixture')
  await approveDepositRequest(pending.id, tenant, 1)
  assert.equal(await cash(user.id), 100)
  assert.equal((await getUserVipStatus(user.id, tenant))?.tierName, 'Platinum')
  const [row] = await db.select().from(depositRequests).where(eq(depositRequests.id, pending.id))
  assert.equal((row.vipPolicySnapshot as any).tierName, 'Bronze')
})

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT'] as const) test(`${type}: no deposit options, requests or manual VIP assignment`, async () => {
  const user = await player(type)
  assert.deepEqual(await getWhitelabelAccounts(tenant, user.id), [])
  await assert.rejects(() => request(user.id, 100), /credit/)
  await assert.rejects(() => changePlayerVipTier(db, tenant, user.id, tiers[1].id), /credit/)
  assert.equal(await getUserVipStatus(user.id, tenant), null)
  assert.equal(await cash(user.id), 0)
})

test('gateway initiation and retried result credit wallet/VIP once, using a local provider stub', async () => {
  const user = await player()
  let calls = 0
  const created = await createWelivepayDeposit({ tenant, userId: user.id, amount: 500 }, async input => {
    calls++
    return { paymentLink: 'https://fixture.invalid/payment', qrImage: '', orderId: input.orderid, status: 'pending' }
  })
  assert.equal(calls, 1)
  assert.deepEqual(await creditOrderOnSuccess({ orderid: created.orderId, txnRef: 'test-provider-ref' }), { credited: true })
  assert.deepEqual(await creditOrderOnSuccess({ orderid: created.orderId, txnRef: 'test-provider-ref' }), { credited: false })
  assert.equal(await cash(user.id), 500)
  const status = await getUserVipStatus(user.id, tenant)
  assert.equal(status?.currentPoints, 500)
  const [member] = await db.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(user.id))))
  assert.equal((await db.select().from(vipTransactionsTable).where(eq(vipTransactionsTable.memberId, member.id))).length, 1)
})

test('gateway method disabled by tier never calls the provider', async () => {
  const user = await player()
  await db.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['BANK_TRANSFER'], min: null, max: null, daily: null, monthly: null } }).where(eq(vipTiersTable.id, tiers[0].id))
  let calls = 0
  try {
    await assert.rejects(() => createWelivepayDeposit({ tenant, userId: user.id, amount: 100 }, async input => {
      calls++; return { paymentLink: 'https://fixture.invalid/payment', qrImage: '', orderId: input.orderid, status: 'pending' }
    }), /unavailable/)
    assert.equal(calls, 0)
  } finally {
    await db.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'], min: null, max: null, daily: null, monthly: null } }).where(eq(vipTiersTable.id, tiers[0].id))
  }
})

test('a manual tier that is deactivated later falls back to the automatic tier instead of blocking deposits', async () => {
  const user = await player()
  await changePlayerVipTier(db, tenant, user.id, tiers[2].id, 'fixture')
  await db.update(vipTiersTable).set({ status: 'inactive' }).where(eq(vipTiersTable.id, tiers[2].id))
  try {
    assert.ok((await getWhitelabelAccounts(tenant, user.id)).length > 0)
    const pending = await request(user.id, 100)
    assert.equal((pending.vipPolicySnapshot as any).tierName, 'Bronze')
    await approveDepositRequest(pending.id, tenant, 1)
    // The award must not overwrite the admin's manual choice with the fallback tier.
    const [after] = await db.select().from(users).where(eq(users.id, user.id))
    assert.equal(after.vipTierMode, 'MANUAL'); assert.equal(after.vipTierId, tiers[2].id)
    await assert.rejects(() => changePlayerVipTier(db, tenant, user.id, tiers[2].id, 'fixture'), /active VIP tier/)
  } finally {
    await db.update(vipTiersTable).set({ status: 'active' }).where(eq(vipTiersTable.id, tiers[2].id))
  }
})

test('an approved deposit whose VIP award was missed is awarded with the next approval', async () => {
  const user = await player()
  // An approval whose post-commit award never ran (crash or logged failure).
  const [missed] = await db.insert(depositRequests).values({ tenant, userId: user.id, amount: '300', method: 'BANK_TRANSFER',
    proofKey: 'test-fixture', currency: 'INR', status: 'APPROVED', reviewedAt: new Date() }).returning()
  const pending = await request(user.id, 200)
  await approveDepositRequest(pending.id, tenant, 1)
  const [member] = await db.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(user.id))))
  const rows = await db.select().from(vipTransactionsTable).where(eq(vipTransactionsTable.memberId, member.id))
  assert.deepEqual(rows.map(row => row.depositRequestId).sort(), [missed.id, pending.id].sort())
  assert.equal(member.currentPoints, 500); assert.equal(member.lifetimePoints, 500)
})

test('deleting a tier removes it from receiving accounts so account saves keep validating', async () => {
  const [extra] = await db.insert(vipTiersTable).values({ tenant, name: 'Delete Me', level: 9, minMonthlyDeposit: 999_999, color: '#000000', status: 'active' }).returning()
  const [before] = await db.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant))
  const banks = (before.bankDetails as any[]).map(account => account.id === 'bank-silver' ? { ...account, vipTierIds: [tiers[1].id, extra.id] } : account)
  await db.update(whitelabelPaymentMethods).set({ bankDetails: banks }).where(eq(whitelabelPaymentMethods.id, before.id))
  try {
    assert.equal(await deleteVipTierDb(extra.id, tenant), true)
    const [after] = await db.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant))
    assert.deepEqual((after.bankDetails as any[]).find(account => account.id === 'bank-silver').vipTierIds, [tiers[1].id])
    await validatePaymentAccountTiers(db, tenant, after.bankDetails as any[])
  } finally {
    await db.update(whitelabelPaymentMethods).set({ bankDetails: before.bankDetails }).where(eq(whitelabelPaymentMethods.id, before.id))
  }
})

test('a newly created whitelabel starts with default VIP tiers and empty Lounge categories', async () => {
  const id = `vip-new-${randomUUID().slice(0, 12)}`
  try {
    await upsertWhitelabel({ id, name: 'VIP New Whitelabel Test', domain: `${id}.invalid` })
    const created = await db.select().from(vipTiersTable).where(eq(vipTiersTable.tenant, id)).orderBy(vipTiersTable.level)
    assert.deepEqual(created.map(tier => tier.name), ['Bronze', 'Silver', 'Gold', 'Platinum'])
    const lounges = await db.execute(sql`SELECT main_category, type::text FROM casino_categories WHERE tenant_id=${id} ORDER BY main_category`)
    assert.deepEqual(lounges.rows.map(row => row.main_category).sort(), ['casino', 'live_casino', 'slots'])
    assert.ok(lounges.rows.every(row => row.type === 'lounge'))
    const assignments = await db.execute(sql`SELECT count(*)::int AS count FROM casino_category_games g JOIN casino_categories c ON c.id=g.category_id WHERE c.tenant_id=${id}`)
    assert.equal(assignments.rows[0].count, 0)
  } finally {
    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM vip_audit WHERE tenant=${id}`)
      await tx.execute(sql`DELETE FROM vip_tiers WHERE tenant=${id}`)
      await tx.execute(sql`DELETE FROM casino_categories WHERE tenant_id=${id}`)
      await tx.execute(sql`DELETE FROM whitelabels WHERE id=${id}`)
    })
  }
})

const cachedTier = async (userId: number) => (await db.select().from(users).where(eq(users.id, userId)))[0]
const memberOf = async (userId: number) => (await db.select().from(vipMembersTable)
  .where(and(eq(vipMembersTable.tenant, tenant), eq(vipMembersTable.userId, String(userId)))))[0]
const approved = async (userId: number, amount: number) => approveDepositRequest((await request(userId, amount)).id, tenant, 1)

test('the month-rollover sweep lowers an automatic tier and leaves a manual tier alone', async () => {
  const auto = await player()
  const manual = await player()
  await approved(auto.id, 60_000)
  await approved(manual.id, 60_000)
  await changePlayerVipTier(db, tenant, manual.id, tiers[2].id, 'fixture')
  assert.equal((await cachedTier(auto.id)).vipTierId, tiers[2].id)

  // This month's deposits still earn Gold, so nothing is due yet.
  await refreshAutomaticVipTiers(db, new Date(), { tenants: [tenant] })
  assert.equal((await cachedTier(auto.id)).vipTierId, tiers[2].id)

  const nextMonth = DateTime.now().setZone('Asia/Kolkata').plus({ months: 1 }).startOf('month').plus({ hours: 1 }).toJSDate()
  const result = await refreshAutomaticVipTiers(db, nextMonth, { tenants: [tenant] })
  assert.ok(result.changed >= 1); assert.equal(result.failed, 0)
  assert.equal((await cachedTier(auto.id)).vipTierId, tiers[0].id)
  assert.equal((await memberOf(auto.id)).tierId, tiers[0].id)
  const history = await db.execute(sql`SELECT to_tier_id, reason FROM vip_member_history WHERE member_id=${(await memberOf(auto.id)).id} ORDER BY created_at DESC LIMIT 1`)
  assert.equal((history.rows[0] as any).to_tier_id, tiers[0].id)
  assert.match((history.rows[0] as any).reason, /Monthly re-qualification/)
  const pinned = await cachedTier(manual.id)
  assert.equal(pinned.vipTierMode, 'MANUAL'); assert.equal(pinned.vipTierId, tiers[2].id)
})

test('the sweep and a player-type change clear a credit player\'s stray tier', async () => {
  const credit = await player('AGENT_CREDIT')
  await db.update(users).set({ vipTierId: tiers[1].id, vipTierMode: 'MANUAL' }).where(eq(users.id, credit.id))
  const result = await refreshAutomaticVipTiers(db, new Date(), { tenants: [tenant] })
  assert.equal(result.cleared, 1)
  const after = await cachedTier(credit.id)
  assert.equal(after.vipTierId, null); assert.equal(after.vipTierMode, 'AUTO')

  const regular = await player()
  await changePlayerVipTier(db, tenant, regular.id, tiers[1].id, 'fixture')
  await updatePlayerTypeDb(regular.id, tenant, 'WHITELABEL_CREDIT')
  const converted = await cachedTier(regular.id)
  assert.equal(converted.vipTierId, null); assert.equal(converted.vipTierMode, 'AUTO')
})

test('a deposit award keeps an admin-suspended VIP membership suspended', async () => {
  const user = await player()
  await approved(user.id, 100)
  await db.update(vipMembersTable).set({ status: 'suspended' }).where(eq(vipMembersTable.id, (await memberOf(user.id)).id))
  await approved(user.id, 100)
  const member = await memberOf(user.id)
  assert.equal(member.status, 'suspended'); assert.equal(member.currentPoints, 200)
})

test('a member edit whose tier change fails saves none of its other fields', async () => {
  const user = await player()
  await approved(user.id, 100)
  const member = await memberOf(user.id)
  await db.update(vipTiersTable).set({ status: 'inactive' }).where(eq(vipTiersTable.id, tiers[3].id))
  try {
    await assert.rejects(() => updateVipMemberDb(tenant, member.id, { tierId: tiers[3].id, currentPoints: 9_999, status: 'suspended' }), /active VIP tier/)
    const unchanged = await memberOf(user.id)
    assert.equal(unchanged.currentPoints, 100); assert.equal(unchanged.status, 'active'); assert.equal(unchanged.tierId, member.tierId)
    assert.equal((await cachedTier(user.id)).vipTierMode, 'AUTO')
    await updateVipMemberDb(tenant, member.id, { tierId: tiers[1].id, currentPoints: 150 })
    const saved = await memberOf(user.id)
    assert.equal(saved.tierId, tiers[1].id); assert.equal(saved.currentPoints, 150)
    assert.equal((await cachedTier(user.id)).vipTierMode, 'MANUAL')
  } finally {
    await db.update(vipTiersTable).set({ status: 'active' }).where(eq(vipTiersTable.id, tiers[3].id))
  }
})

test('a manually assigned player is shown no next tier to unlock; Automatic shows it again', async () => {
  const user = await player()
  await changePlayerVipTier(db, tenant, user.id, tiers[1].id, 'fixture')
  const manual = await getUserVipStatus(user.id, tenant)
  assert.equal(manual?.tierName, 'Silver'); assert.equal(manual?.nextTier, null); assert.equal(manual?.pointsToNextTier, null)
  await changePlayerVipTier(db, tenant, user.id, null, 'fixture')
  const automatic = await getUserVipStatus(user.id, tenant)
  assert.equal(automatic?.tierName, 'Bronze'); assert.equal(automatic?.nextTier?.name, 'Silver'); assert.equal(automatic?.pointsToNextTier, 10_000)
})

test('the last active tier cannot be deactivated or deleted, and unknown statuses are refused', async () => {
  const others = tiers.slice(1).map(tier => tier.id)
  await db.update(vipTiersTable).set({ status: 'inactive' }).where(and(eq(vipTiersTable.tenant, tenant), inArray(vipTiersTable.id, others)))
  try {
    await assert.rejects(() => updateVipTierDb(tiers[0].id, { status: 'inactive' }, tenant), /must stay active/)
    await assert.rejects(() => deleteVipTierDb(tiers[0].id, tenant), /must stay active/)
    await assert.rejects(() => updateVipTierDb(tiers[0].id, { status: 'ACTIVE' }, tenant), /Unknown VIP tier status/)
    assert.equal((await db.select().from(vipTiersTable).where(eq(vipTiersTable.id, tiers[0].id)))[0].status, 'active')
  } finally {
    await db.update(vipTiersTable).set({ status: 'active' }).where(and(eq(vipTiersTable.tenant, tenant), inArray(vipTiersTable.id, others)))
  }
})

test('a tier players have been on cannot be deleted; deactivating it is the way out', async () => {
  const [used] = await db.insert(vipTiersTable).values({ tenant, name: 'Used Tier', level: 8, minMonthlyDeposit: 888_888, color: '#000000', status: 'active' }).returning()
  const user = await player()
  await changePlayerVipTier(db, tenant, user.id, used.id, 'fixture')
  await assert.rejects(() => deleteVipTierDb(used.id, tenant), /cannot be deleted. Deactivate it instead/)
  await changePlayerVipTier(db, tenant, user.id, null, 'fixture')
  const member = await memberOf(user.id)
  // The membership moved off the tier, but its history still names it.
  await assert.rejects(() => deleteVipTierDb(used.id, tenant), /cannot be deleted/)
  await updateVipTierDb(used.id, { status: 'inactive' }, tenant)
  await db.execute(sql`DELETE FROM vip_member_history WHERE member_id=${member.id}`)
  assert.equal(await deleteVipTierDb(used.id, tenant), true)
})

test('points added and removed by an admin keep a consistent balance and ledger', async () => {
  const user = await player()
  await approved(user.id, 100)
  const member = await memberOf(user.id)
  await addVipPointsDb(tenant, member.id, 50, 'fixture add')
  await removeVipPointsDb(tenant, member.id, 20, 'fixture remove')
  assert.equal((await memberOf(user.id)).currentPoints, 130)
  assert.equal(await addVipPointsDb('some-other-tenant', member.id, 5, 'cross-tenant'), null)
  const ledger = await db.select().from(vipTransactionsTable).where(eq(vipTransactionsTable.memberId, member.id))
  assert.deepEqual(ledger.map(row => row.balanceAfter).sort((a, b) => a - b), [100, 130, 150])
})

test('choosing receiving accounts in the tier form updates both kinds of account restriction', async () => {
  const [before] = await db.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant))
  try {
    // Bronze keeps only the Silver-restricted account; the open account loses Bronze alone.
    await updateVipTierDb(tiers[0].id, { receivingAccountIds: ['bank-silver'] }, tenant)
    const [after] = await db.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant))
    const byId = Object.fromEntries((after.bankDetails as any[]).map(account => [account.id, account.vipTierIds]))
    assert.deepEqual([...byId['bank-public']].sort(), tiers.slice(1).map(tier => tier.id).sort())
    assert.deepEqual([...byId['bank-silver']].sort(), [tiers[0].id, tiers[1].id].sort())
    await assert.rejects(() => updateVipTierDb(tiers[0].id, { receivingAccountIds: ['no-such-account'] }, tenant), /no longer exists/)
  } finally {
    await db.update(whitelabelPaymentMethods).set({ bankDetails: before.bankDetails }).where(eq(whitelabelPaymentMethods.id, before.id))
  }
})

test('VIP eligibility and timezone follow the platform rules', async () => {
  assert.equal(await isVipEligible((await player()).id, tenant), true)
  assert.equal(await isVipEligible((await player('AGENT_CREDIT')).id, tenant), false)
  assert.equal(whitelabelTimeZone({ timeZone: null, baseCurrency: 'USD' }), 'America/New_York')
  assert.equal(whitelabelTimeZone({ timeZone: 'Asia/Dubai', baseCurrency: 'INR' }), 'Asia/Dubai')
  assert.equal(whitelabelTimeZone({ timeZone: null, baseCurrency: 'XYZ' }), 'UTC')
})

test('admin member views measure the gap to the next tier in this month\'s deposits; a manual tier has none', async () => {
  const { getVipMemberByUserIdDb } = await import('../vip/vipRepo.js')
  const auto = await player()
  await approved(auto.id, 60_000)
  const view = await getVipMemberByUserIdDb(String(auto.id), tenant)
  assert.equal(view?.tierName, 'Gold'); assert.equal(view?.monthlyDeposits, 60_000)
  assert.equal(view?.nextTierName, 'Platinum'); assert.equal(view?.pointsToNextTier, 40_000)
  await changePlayerVipTier(db, tenant, auto.id, tiers[1].id, 'fixture')
  const pinned = await getVipMemberByUserIdDb(String(auto.id), tenant)
  assert.equal(pinned?.tierName, 'Silver'); assert.equal(pinned?.nextTierName, undefined); assert.equal(pinned?.pointsToNextTier, undefined)
})

test('the player profile VIP query answers for a player with tier history, naming each tier', async () => {
  const { playersQueryResolvers } = await import('../../domains/players/resolvers/queries.js')
  const user = await player()
  await changePlayerVipTier(db, tenant, user.id, tiers[2].id, 'fixture')
  await changePlayerVipTier(db, tenant, user.id, null, 'fixture')
  const ctx = { tenant, user: { id: '1', type: 'admin' }, permissions: [{ domain: 'players.vip', actions: ['view'] }] }
  const vip = await (playersQueryResolvers as any).playerVip(null, { playerId: String(user.id) }, ctx)
  assert.equal(vip.tierName, 'Bronze'); assert.equal(vip.nextTierName, 'Silver'); assert.equal(vip.monthlyDeposits, 0)
  assert.ok(vip.history.length >= 2)
  assert.ok(vip.history.every((h: any) => typeof h.toTierName === 'string' && h.toTierName.length > 0))
  assert.ok(vip.history.some((h: any) => h.toTierName === 'Gold'))
})

test('vipHistory takes its memberId argument and names tiers; vipStats top members carry tierId', async () => {
  const { vipQueryResolvers } = await import('../../domains/vip/resolvers/queries.js')
  const user = await player()
  await changePlayerVipTier(db, tenant, user.id, tiers[3].id, 'fixture')
  const member = await memberOf(user.id)
  const ctx = { tenant, user: { id: '1', type: 'admin' }, permissions: [{ domain: 'vip.members', actions: ['view'] }] }
  const history = await (vipQueryResolvers as any).vipHistory(null, { memberId: member.id }, ctx)
  assert.ok(history.length >= 1); assert.equal(history[0].toTierName, 'Platinum')
  const stats = await (vipQueryResolvers as any).vipStats(null, {}, ctx)
  assert.ok(stats.topMembers.length > 0)
  assert.ok(stats.topMembers.every((m: any) => typeof m.tierId === 'string' && m.tierId.length > 0))
})
