/**
 * VIP data must not cross whitelabels.
 *
 * vip_transactions and vip_member_history carry no tenant column; they hang off
 * vip_members, which does. Until this was fixed, listVipTransactionsDb(memberId) and
 * listVipHistoryDb(memberId) took no tenant at all, and the resolvers behind them took
 * no ctx — so any authenticated admin could read any whitelabel's points ledger and
 * tier history by passing a member uuid. addVipPointsDb and removeVipPointsDb had the
 * same gap on the write side, and listVipAuditDb returned every whitelabel's rows to
 * everybody.
 *
 * These assertions cover both halves: the leak is closed, and legitimate same-tenant
 * calls still return what they always did. A fix that quietly breaks the VIP tab is
 * not a fix.
 *
 * Requires DATABASE_URL. Uses two throwaway tenants and cleans up after itself.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const SUFFIX = randomUUID().slice(0, 8)
const TENANT_A = `vip-itest-a-${SUFFIX}`
const TENANT_B = `vip-itest-b-${SUFFIX}`

let userA = 0
let userB = 0
let memberA = ''
let memberB = ''
let tierAId = ''

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')

  const { db } = await import('@src/db/client.js')
  const { users, whitelabels } = await import('@shared/db/schema.js')
  const { createVipTierDb, ensureVipMember } = await import('../vipRepo.js')

  for (const tenant of [TENANT_A, TENANT_B]) {
    await db.insert(whitelabels).values({ id: tenant, name: 'VIP Test', domain: `${tenant}.invalid` })
    await createVipTierDb({
      tenant,
      name: 'Bronze',
      level: 1,
      minMonthlyDeposit: 0,
      color: '#cd7f32',
      status: 'active',
      benefits: [],
      perks: [],
    })
    await createVipTierDb({
      tenant,
      name: 'Silver',
      level: 2,
      minMonthlyDeposit: 1000,
      color: '#c0c0c0',
      status: 'active',
      benefits: [],
      perks: [],
    })
  }

  const [a] = await db.insert(users).values({ tenant: TENANT_A, name: 'VIP itest A', passwordHash: 'x' }).returning({ id: users.id })
  const [b] = await db.insert(users).values({ tenant: TENANT_B, name: 'VIP itest B', passwordHash: 'x' }).returning({ id: users.id })
  userA = a.id
  userB = b.id

  memberA = (await ensureVipMember(userA, TENANT_A, 'VIP itest A')).id
  memberB = (await ensureVipMember(userB, TENANT_B, 'VIP itest B')).id

  const { listVipTiersDb } = await import('../vipRepo.js')
  tierAId = (await listVipTiersDb(TENANT_A))[0].id
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const {
    users,
    whitelabels,
    vipAuditTable,
    vipMemberHistoryTable,
    vipMembersTable,
    vipTierBenefitsTable,
    vipTierPerksTable,
    vipTiersTable,
    vipTransactionsTable,
  } = await import('@shared/db/schema.js')
  const { eq, inArray } = await import('drizzle-orm')

  const tenants = [TENANT_A, TENANT_B]
  const memberIds = [memberA, memberB].filter(Boolean)
  if (memberIds.length) {
    await db.delete(vipTransactionsTable).where(inArray(vipTransactionsTable.memberId, memberIds))
    await db.delete(vipMemberHistoryTable).where(inArray(vipMemberHistoryTable.memberId, memberIds))
  }
  await db.delete(vipMembersTable).where(inArray(vipMembersTable.tenant, tenants))
  await db.delete(vipAuditTable).where(inArray(vipAuditTable.tenant, tenants))

  const tierIds = (
    await db.select({ id: vipTiersTable.id }).from(vipTiersTable).where(inArray(vipTiersTable.tenant, tenants))
  ).map(r => r.id)
  if (tierIds.length) {
    await db.delete(vipTierBenefitsTable).where(inArray(vipTierBenefitsTable.tierId, tierIds))
    await db.delete(vipTierPerksTable).where(inArray(vipTierPerksTable.tierId, tierIds))
  }
  await db.delete(vipTiersTable).where(inArray(vipTiersTable.tenant, tenants))
  await db.delete(users).where(inArray(users.id, [userA, userB].filter(Boolean)))
  await db.delete(whitelabels).where(inArray(whitelabels.id, tenants))
  void eq
})

describe('VIP points ledger is confined to its whitelabel', () => {
  it('does not return another whitelabel transactions for a known member id', async () => {
    const { addVipPointsDb, listVipTransactionsDb } = await import('../vipRepo.js')

    await addVipPointsDb(TENANT_A, memberA, 250, 'itest credit')

    const own = await listVipTransactionsDb(TENANT_A, memberA)
    assert.equal(own.length, 1, 'the owning whitelabel still sees its ledger')
    assert.equal(own[0].points, 250)

    const stolen = await listVipTransactionsDb(TENANT_B, memberA)
    assert.deepEqual(stolen, [], 'a member uuid alone must not unlock another whitelabel ledger')
  })

  it('does not return another whitelabel tier history', async () => {
    const { updateVipMemberDb, listVipTiersDb, listVipHistoryDb } = await import('../vipRepo.js')
    const silver = (await listVipTiersDb(TENANT_A)).find(tier => tier.name === 'Silver')!
    // Tier history comes from explicit assignment or deposit qualification;
    // manually awarded reward points no longer change a player's tier.
    await updateVipMemberDb(TENANT_A, memberA, { tierId: silver.id, reason: 'itest upgrade' })

    const own = await listVipHistoryDb(TENANT_A, memberA)
    assert.ok(own.length >= 1, 'the owning whitelabel still sees the upgrade')

    const stolen = await listVipHistoryDb(TENANT_B, memberA)
    assert.deepEqual(stolen, [], 'tier history is not readable across whitelabels')
  })

  it('refuses to credit points to another whitelabel member', async () => {
    const { addVipPointsDb, getVipMemberDb } = await import('../vipRepo.js')

    const before = await getVipMemberDb(memberA, TENANT_A)
    const attempt = await addVipPointsDb(TENANT_B, memberA, 5000, 'credit from the wrong whitelabel')

    assert.equal(attempt, null, 'the member must not be found from the wrong tenant')
    const after = await getVipMemberDb(memberA, TENANT_A)
    assert.equal(after?.currentPoints, before?.currentPoints, 'the balance must be untouched')
  })

  it('refuses to debit points from another whitelabel member', async () => {
    const { getVipMemberDb, removeVipPointsDb } = await import('../vipRepo.js')

    const before = await getVipMemberDb(memberA, TENANT_A)
    const attempt = await removeVipPointsDb(TENANT_B, memberA, 100, 'debit from the wrong whitelabel')

    assert.equal(attempt, null)
    const after = await getVipMemberDb(memberA, TENANT_A)
    assert.equal(after?.currentPoints, before?.currentPoints)
  })

  it('still credits and debits correctly within one whitelabel', async () => {
    const { addVipPointsDb, getVipMemberDb, removeVipPointsDb } = await import('../vipRepo.js')

    const start = (await getVipMemberDb(memberB, TENANT_B))?.currentPoints ?? 0

    const credited = await addVipPointsDb(TENANT_B, memberB, 300, 'itest credit B')
    assert.ok(credited, 'a same-tenant credit still works')
    assert.equal(credited?.transaction.balanceAfter, start + 300)

    const debited = await removeVipPointsDb(TENANT_B, memberB, 100, 'itest debit B')
    assert.ok(debited)
    assert.equal(debited?.transaction.balanceAfter, start + 200)

    assert.equal((await getVipMemberDb(memberB, TENANT_B))?.currentPoints, start + 200)
  })
})

describe('VIP membership edits are persisted and scoped', () => {
  it('returns the transaction row it actually wrote, not a reconstruction of it', async () => {
    const { addVipPointsDb } = await import('../vipRepo.js')

    const result = await addVipPointsDb(TENANT_B, memberB, 40, 'itest returning')
    assert.ok(result?.transaction, 'a transaction comes back')
    // The GraphQL VIPTransaction type declares id and createdAt non-nullable, so a
    // hand-built object would fail the query rather than the resolver.
    assert.ok(result!.transaction.id, 'it carries a real id')
    assert.ok(result!.transaction.createdAt, 'and a real timestamp')
    assert.equal(result!.transaction.type, 'credit')
  })

  it('will not edit a member from another whitelabel', async () => {
    const { getVipMemberDb, updateVipMemberDb } = await import('../vipRepo.js')

    const before = await getVipMemberDb(memberA, TENANT_A)
    const attempt = await updateVipMemberDb(TENANT_B, memberA, { status: 'inactive' })

    assert.equal(attempt, null)
    assert.equal((await getVipMemberDb(memberA, TENANT_A))?.status, before?.status)
  })

  it('will not move a member onto another whitelabel tier', async () => {
    const { getVipMemberDb, listVipTiersDb, updateVipMemberDb } = await import('../vipRepo.js')

    const foreignTier = (await listVipTiersDb(TENANT_B)).find(t => t.level === 2)
    assert.ok(foreignTier, 'tenant B has a Silver tier')

    const before = await getVipMemberDb(memberA, TENANT_A)
    const attempt = await updateVipMemberDb(TENANT_A, memberA, { tierId: foreignTier!.id })

    assert.equal(attempt, null, 'a tier from another whitelabel is not a valid target')
    assert.equal((await getVipMemberDb(memberA, TENANT_A))?.tierId, before?.tierId, 'and nothing was written')
  })

  it('persists a same-whitelabel edit and records the tier change', async () => {
    const { getVipMemberDb, listVipHistoryDb, listVipTiersDb, updateVipMemberDb } = await import('../vipRepo.js')

    const silver = (await listVipTiersDb(TENANT_B)).find(t => t.level === 2)
    const historyBefore = (await listVipHistoryDb(TENANT_B, memberB)).length

    const updated = await updateVipMemberDb(TENANT_B, memberB, { tierId: silver!.id, reason: 'itest promotion' })
    assert.ok(updated, 'the edit went through')
    assert.equal(updated?.tierId, silver!.id)

    // Re-read rather than trusting the return value: the point of this change is that
    // the edit reaches the database instead of process memory.
    assert.equal((await getVipMemberDb(memberB, TENANT_B))?.tierId, silver!.id)

    const historyAfter = await listVipHistoryDb(TENANT_B, memberB)
    assert.equal(historyAfter.length, historyBefore + 1, 'a tier change is recorded')
    assert.equal(historyAfter[0].reason, 'itest promotion')
  })
})

describe('VIP audit is confined to its whitelabel', () => {
  it('shows a whitelabel only its own audit rows', async () => {
    const { addVipAuditDb, listVipAuditDb } = await import('../vipRepo.js')

    await addVipAuditDb(TENANT_A, 'op-a', 'itest_action', tierAId, 'written by A')

    const own = await listVipAuditDb(TENANT_A)
    assert.equal(own.some((r: any) => r.message === 'written by A'), true)

    const other = await listVipAuditDb(TENANT_B)
    assert.equal(other.some((r: any) => r.message === 'written by A'), false)
  })
})

describe('VIP member listing', () => {
  it('lists only its own members and computes the gap to the next tier', async () => {
    const { listVipMembersDb } = await import('../vipRepo.js')

    const a = await listVipMembersDb(undefined, TENANT_A)
    const b = await listVipMembersDb(undefined, TENANT_B)

    assert.equal(a.some(m => m.id === memberA), true)
    assert.equal(a.some(m => m.id === memberB), false)
    assert.equal(b.some(m => m.id === memberB), true)

    // pointsToNextTier is a gap in the same unit as the threshold: points are awarded
    // 1:1 with the deposit amount (vipIntegrationService.ts), so the subtraction is
    // dimensionally sound. The invariant is tied to whether a next tier exists at all —
    // asserting it is always a number breaks the moment a member reaches the top tier,
    // which an earlier test in this file now does.
    const listedB = b.find(m => m.id === memberB)
    assert.ok(listedB, 'member B is listed')
    if (listedB!.nextTierId) {
      assert.equal(typeof listedB!.pointsToNextTier, 'number')
      assert.ok(listedB!.pointsToNextTier! >= 0)
    } else {
      assert.equal(listedB!.pointsToNextTier, undefined, 'no next tier means no gap to report')
    }
  })
})
