import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { db, pool } from '../db/client.js'
import { agents, appConfigs, depositRequests, users, vipMembersTable, vipTiersTable, vipTransactionsTable, whitelabelPaymentMethods, whitelabels, welivepayOrders } from '../db/schema.js'
import { seedDefaultVipTiers } from './defaultTiers.js'
import { allowedReceivingAccounts, assertVipDepositAllowed, getVipDepositContext, validatePaymentAccountTiers, type VipDatabase } from './depositAccess.js'
import { changePlayerVipTier, awardVipApprovedDeposit } from './membership.js'

after(() => pool.end())
const now = new Date()
const started = new Date(now.getTime() - 60_000)

async function fixture(run: (tx: VipDatabase, f: { tenant: string; userId: number; tiers: Array<typeof vipTiersTable.$inferSelect> }) => Promise<void>) {
  const rollback = new Error('rollback VIP deposit test')
  try {
    await db.transaction(async tx => {
      const tenant = `vip-access-${randomUUID()}`
      await tx.insert(whitelabels).values({ id: tenant, name: 'VIP Access Test', domain: `${tenant}.invalid`, vipStartedAt: started })
      await tx.insert(appConfigs).values({ whitelabelId: tenant, timeZone: 'Asia/Kolkata' })
      await seedDefaultVipTiers(tx, tenant)
      const tiers = await tx.select().from(vipTiersTable).where(eq(vipTiersTable.tenant, tenant)).orderBy(vipTiersTable.level)
      const [user] = await tx.insert(users).values({ tenant, name: 'VIP Test Player', passwordHash: 'not-a-login', playerType: 'REGULAR' }).returning()
      await tx.insert(whitelabelPaymentMethods).values({ tenant, limits: { min: 10, max: 500_000 }, bankDetails: [
        { id: 'bank-all', accountName: 'Fixture', accountNumber: 'TEST0001', ifsc: 'TEST0000001', bankName: 'Fixture Bank', branch: 'Test', enabled: true },
        { id: 'bank-silver', accountName: 'Fixture', accountNumber: 'TEST0002', ifsc: 'TEST0000001', bankName: 'Fixture Bank', branch: 'Test', enabled: true, vipTierIds: [tiers[1].id] },
        { id: 'bank-none', enabled: true, vipTierIds: [] },
        { id: 'bank-disabled', enabled: false },
      ], upiDetails: [{ id: 'upi-all', upiId: 'fixture@invalid', enabled: true, minAmount: 100, maxAmount: 500 }] })
      await run(tx, { tenant, userId: user.id, tiers })
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
}

async function deposit(tx: VipDatabase, tenant: string, userId: number, amount: number,
  status: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED', createdAt = now) {
  const [row] = await tx.insert(depositRequests).values({ tenant, userId, amount: String(amount), method: 'UPI',
    proofKey: 'test-fixture', status, createdAt, reviewedAt: status === 'APPROVED' ? now : null }).returning()
  return row
}

test('automatic starts at Bronze and historical deposits/points do not qualify', () => fixture(async (tx, f) => {
  await deposit(tx, f.tenant, f.userId, 500_000, 'APPROVED', new Date(started.getTime() - 60_000))
  await tx.insert(vipMembersTable).values({ tenant: f.tenant, userId: String(f.userId), userName: 'Fixture', tierId: f.tiers[3].id, currentPoints: 900_000, lifetimePoints: 900_000 })
  const access = await getVipDepositContext(tx, f.tenant, f.userId)
  assert.equal(access.tier.name, 'Bronze')
  assert.equal(access.monthlyDeposits, 0)
}))

test('new approved deposit jumps to highest qualifying tier and awards once', () => fixture(async (tx, f) => {
  const row = await deposit(tx, f.tenant, f.userId, 150_000)
  assert.equal(await awardVipApprovedDeposit(tx, f.tenant, f.userId, row.id), true)
  assert.equal(await awardVipApprovedDeposit(tx, f.tenant, f.userId, row.id), false)
  const access = await getVipDepositContext(tx, f.tenant, f.userId)
  assert.equal(access.tier.name, 'Platinum')
  const [user] = await tx.select().from(users).where(eq(users.id, f.userId))
  const [member] = await tx.select().from(vipMembersTable).where(eq(vipMembersTable.userId, String(f.userId)))
  assert.equal(user.vipTierId, access.tier.id)
  assert.equal(member.tierId, access.tier.id)
  assert.equal(member.currentPoints, 150_000)
  assert.equal((await tx.select().from(vipTransactionsTable).where(eq(vipTransactionsTable.depositRequestId, row.id))).length, 1)
}))

test('manual tier holds after deposits; selecting Automatic resumes qualification', () => fixture(async (tx, f) => {
  await changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[1].id, 'test')
  const row = await deposit(tx, f.tenant, f.userId, 150_000)
  await awardVipApprovedDeposit(tx, f.tenant, f.userId, row.id)
  assert.equal((await getVipDepositContext(tx, f.tenant, f.userId)).tier.name, 'Silver')
  await changePlayerVipTier(tx, f.tenant, f.userId, null, 'test')
  assert.equal((await getVipDepositContext(tx, f.tenant, f.userId)).tier.name, 'Platinum')
}))

test('cross-tenant or inactive tier rejection rolls back user and membership', () => fixture(async (tx, f) => {
  await changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[1].id)
  const [before] = await tx.select().from(users).where(eq(users.id, f.userId))
  await assert.rejects(() => changePlayerVipTier(tx, f.tenant, f.userId, randomUUID()), /active VIP tier/)
  await tx.update(vipTiersTable).set({ status: 'inactive' }).where(eq(vipTiersTable.id, f.tiers[2].id))
  await assert.rejects(() => changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[2].id), /active VIP tier/)
  const [after] = await tx.select().from(users).where(eq(users.id, f.userId))
  assert.equal(after.vipTierId, before.vipTierId)
  assert.equal(after.vipTierMode, before.vipTierMode)
}))

for (const type of ['AGENT_CREDIT', 'WHITELABEL_CREDIT'] as const) test(`${type} cannot use deposits or tier assignment`, () => fixture(async (tx, f) => {
  await tx.update(users).set({ playerType: type }).where(eq(users.id, f.userId))
  await assert.rejects(() => getVipDepositContext(tx, f.tenant, f.userId), /credit-agent/)
  await assert.rejects(() => changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[1].id), /credit-agent/)
  const [user] = await tx.select().from(users).where(eq(users.id, f.userId))
  assert.equal(user.vipTierId, null)
}))

test('legacy regular player owned by CREDIT agent is excluded too', () => fixture(async (tx, f) => {
  const [agent] = await tx.insert(agents).values({ tenantId: f.tenant, schemeType: 'CREDIT', allowedDomains: ['sports'] }).returning()
  await tx.update(users).set({ agentId: agent.id }).where(eq(users.id, f.userId))
  await assert.rejects(() => getVipDepositContext(tx, f.tenant, f.userId), /credit-agent/)
}))

for (const [scheme, type] of [['COMMISSION', 'COMMISSION_AGENT_PLAYER'], ['SHARING', 'SHARING_AGENT_PLAYER']] as const)
  test(`${scheme} cash player can receive a manual tier`, () => fixture(async (tx, f) => {
    const [agent] = await tx.insert(agents).values({ tenantId: f.tenant, schemeType: scheme, allowedDomains: ['sports'] }).returning()
    await tx.update(users).set({ agentId: agent.id, playerType: type }).where(eq(users.id, f.userId))
    await changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[2].id)
    assert.equal((await getVipDepositContext(tx, f.tenant, f.userId)).tier.name, 'Gold')
  }))

test('account whitelist, inactive accounts, empty whitelist and account-ID tampering are enforced', () => fixture(async (tx, f) => {
  let access = await getVipDepositContext(tx, f.tenant, f.userId)
  assert.deepEqual(allowedReceivingAccounts(access).map(account => account.id), ['bank-all', 'upi-all'])
  await assert.rejects(() => assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'BANK_TRANSFER', amount: 100, accountId: 'bank-silver' }), /unavailable/)
  await assert.rejects(() => assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'UPI', amount: 100, accountId: 'bank-all' }), /unavailable/)
  await changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[1].id)
  access = await getVipDepositContext(tx, f.tenant, f.userId)
  assert.ok(allowedReceivingAccounts(access).some(account => account.id === 'bank-silver'))
  await assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'BANK_TRANSFER', amount: 100, accountId: 'bank-silver' })
}))

test('site, tier and account amount restrictions use the strictest intersection', () => fixture(async (tx, f) => {
  await tx.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['UPI'], min: 150, max: 400, daily: null, monthly: null } }).where(eq(vipTiersTable.id, f.tiers[0].id))
  await assert.rejects(() => assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'BANK_TRANSFER', amount: 200, accountId: 'bank-all' }), /unavailable/)
  for (const amount of [149, 401, 1.001, -1, Number.NaN]) await assert.rejects(() => assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'UPI', amount, accountId: 'upi-all' }))
  const snapshot = await assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'UPI', amount: 200, accountId: 'upi-all' })
  assert.equal(snapshot.min, 150); assert.equal(snapshot.max, 400)
}))

test('daily/monthly caps reserve pending manual and gateway amounts, exclude rejected and avoid success double-counting', () => fixture(async (tx, f) => {
  await tx.update(vipTiersTable).set({ depositPolicy: { enabled: true, methods: ['UPI'], min: 10, max: null, daily: 500, monthly: 1000 } }).where(eq(vipTiersTable.id, f.tiers[0].id))
  await deposit(tx, f.tenant, f.userId, 100)
  await deposit(tx, f.tenant, f.userId, 100, 'PENDING')
  await deposit(tx, f.tenant, f.userId, 1000, 'REJECTED')
  await tx.insert(welivepayOrders).values({ tenant: f.tenant, userId: f.userId, orderid: randomUUID(), amount: '100', status: 'pending', createdAt: now })
  await tx.insert(welivepayOrders).values({ tenant: f.tenant, userId: f.userId, orderid: randomUUID(), amount: '100', status: 'success', createdAt: now })
  const access = await getVipDepositContext(tx, f.tenant, f.userId)
  assert.equal(access.remainingDaily, 200); assert.equal(access.remainingMonthly, 700)
  await assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'UPI', amount: 200, accountId: 'upi-all' })
  await assert.rejects(() => assertVipDepositAllowed(tx, f.tenant, f.userId, { method: 'UPI', amount: 201, accountId: 'upi-all' }), /Allowed deposit/)
}))

test('automatic month rollover starts qualification again, without changing manual tiers', () => fixture(async (tx, f) => {
  await deposit(tx, f.tenant, f.userId, 150_000)
  assert.equal((await getVipDepositContext(tx, f.tenant, f.userId)).tier.name, 'Platinum')
  const nextMonth = DateTime.fromJSDate(now).setZone('Asia/Kolkata').plus({ months: 1 }).startOf('month').toJSDate()
  assert.equal((await getVipDepositContext(tx, f.tenant, f.userId, nextMonth)).tier.name, 'Bronze')
  await changePlayerVipTier(tx, f.tenant, f.userId, f.tiers[1].id)
  assert.equal((await getVipDepositContext(tx, f.tenant, f.userId, nextMonth)).tier.name, 'Silver')
}))

test('unknown/foreign VIP IDs in payment account configuration are rejected', () => fixture(async (tx, f) => {
  await assert.rejects(() => validatePaymentAccountTiers(tx, f.tenant, [{ id: 'bank-all', vipTierIds: [randomUUID()] }]), /does not belong/)
  await assert.rejects(() => validatePaymentAccountTiers(tx, f.tenant, [{ id: 'same' }, { id: 'same' }]), /Duplicate/)
}))
