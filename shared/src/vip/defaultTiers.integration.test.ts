import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { db, pool } from '../db/client.js'
import { vipAuditTable, vipTierBenefitsTable, vipTiersTable, whitelabels } from '../db/schema.js'
import { DEFAULT_VIP_TIERS, seedDefaultVipTiers } from './defaultTiers.js'

after(() => pool.end())

const list = (database: NodePgDatabase<any>, tenant: string) => database.select().from(vipTiersTable)
  .where(eq(vipTiersTable.tenant, tenant)).orderBy(asc(vipTiersTable.level))

/** All ordinary fixtures and writes roll back, even when an assertion fails. */
async function isolated(run: (database: NodePgDatabase<any>, tenant: string) => Promise<void>) {
  const tenant = `vip-seed-test-${randomUUID()}`
  const rollback = new Error('rollback VIP seed fixture')
  try {
    await db.transaction(async tx => {
      await tx.insert(whitelabels).values({ id: tenant, name: 'VIP Seed Test', domain: `${tenant}.invalid` })
      await run(tx, tenant)
      throw rollback
    })
  } catch (error) {
    if (error !== rollback) throw error
  }
  assert.deepEqual(await list(db, tenant), [], 'test tiers must not persist')
}

test('fresh whitelabel gets four active tiers, ordered thresholds, distinct IDs and audit entries', () => isolated(async (tx, tenant) => {
  await tx.execute(sql`SET LOCAL TIME ZONE 'Asia/Kolkata'`)
  const started = Date.now()
  const result = await seedDefaultVipTiers(tx, tenant)
  const tiers = await list(tx, tenant)
  const finished = Date.now()
  assert.deepEqual(result.created, ['Bronze', 'Silver', 'Gold', 'Platinum'])
  assert.equal(new Set(tiers.map(tier => tier.id)).size, 4)
  for (const tier of tiers) {
    assert.ok(tier.createdAt.getTime() >= started - 1000 && tier.createdAt.getTime() <= finished + 1000,
      'seed timestamp must represent the actual instant, regardless of the DB session timezone')
    assert.equal(tier.updatedAt.getTime(), tier.createdAt.getTime())
  }
  assert.deepEqual(tiers.map(({ name, level, minMonthlyDeposit, status }) => ({ name, level, minMonthlyDeposit, status })), [
    { name: 'Bronze', level: 1, minMonthlyDeposit: 0, status: 'active' },
    { name: 'Silver', level: 2, minMonthlyDeposit: 10_000, status: 'active' },
    { name: 'Gold', level: 3, minMonthlyDeposit: 50_000, status: 'active' },
    { name: 'Platinum', level: 4, minMonthlyDeposit: 100_000, status: 'active' },
  ])
  const audits = await tx.select().from(vipAuditTable).where(eq(vipAuditTable.tenant, tenant))
  assert.equal(audits.length, 4)
  assert.ok(audits.every(row => row.action === 'seed_tier'))
}))

test('repeat seed preserves IDs, timestamps, admin changes, inactive status and benefits', () => isolated(async (tx, tenant) => {
  await seedDefaultVipTiers(tx, tenant)
  const silver = (await list(tx, tenant)).find(tier => tier.name === 'Silver')!
  await tx.update(vipTiersTable).set({ minMonthlyDeposit: 25_000, color: '#112233', status: 'inactive' })
    .where(eq(vipTiersTable.id, silver.id))
  await tx.insert(vipTierBenefitsTable).values({ tierId: silver.id, benefit: 'Admin configured benefit' })
  const before = await list(tx, tenant)
  const result = await seedDefaultVipTiers(tx, tenant)
  assert.deepEqual(result.created, [])
  assert.equal(result.preserved.length, 4)
  assert.deepEqual(await list(tx, tenant), before)
  assert.equal((await tx.select().from(vipAuditTable).where(eq(vipAuditTable.tenant, tenant))).length, 4)
  const benefits = await tx.select().from(vipTierBenefitsTable).where(eq(vipTierBenefitsTable.tierId, silver.id))
  assert.equal(benefits[0].benefit, 'Admin configured benefit')
}))

test('partially configured tenant gets only missing defaults, matching names case-insensitively', () => isolated(async (tx, tenant) => {
  const [silver] = await tx.insert(vipTiersTable).values({ ...DEFAULT_VIP_TIERS[1], tenant, name: '  SILVER  ' }).returning()
  const result = await seedDefaultVipTiers(tx, tenant)
  assert.deepEqual(result.created, ['Bronze', 'Gold', 'Platinum'])
  assert.equal((await list(tx, tenant)).length, 4)
  const kept = (await list(tx, tenant)).find(tier => tier.id === silver.id)!
  assert.equal(kept.name, '  SILVER  ')
}))

test('renamed and additional custom tiers keep their configuration and never share a seeded level', () => isolated(async (tx, tenant) => {
  const [custom] = await tx.insert(vipTiersTable).values({ ...DEFAULT_VIP_TIERS[0], tenant, name: 'Starter' }).returning()
  await tx.insert(vipTiersTable).values({ ...DEFAULT_VIP_TIERS[3], tenant, name: 'Diamond', level: 8, minMonthlyDeposit: 500_000 })
  const result = await seedDefaultVipTiers(tx, tenant)
  assert.deepEqual(result.created, ['Silver', 'Gold', 'Platinum'])
  const tiers = await list(tx, tenant)
  assert.deepEqual(tiers.find(tier => tier.id === custom.id), custom)
  assert.equal(tiers.filter(tier => tier.level === 1).length, 1)
  assert.equal(tiers.filter(tier => tier.name === 'Bronze').length, 0)
  assert.equal(tiers.filter(tier => tier.name === 'Diamond').length, 1)
}))

test('default names and levels are isolated between whitelabels', () => isolated(async (tx, tenant) => {
  const other = `${tenant}-other`
  await tx.insert(whitelabels).values({ id: other, name: 'Other VIP Test', domain: `${other}.invalid` })
  await seedDefaultVipTiers(tx, tenant)
  const before = await list(tx, tenant)
  const result = await seedDefaultVipTiers(tx, other)
  assert.equal(result.created.length, 4)
  assert.deepEqual(await list(tx, tenant), before)
  const originalIds = new Set(before.map(tier => tier.id))
  assert.ok((await list(tx, other)).every(tier => !originalIds.has(tier.id)))
}))

test('empty or unknown tenant is rejected without creating orphan tiers', async () => {
  await assert.rejects(() => seedDefaultVipTiers(db, '  '), /requires a tenant/)
  const unknown = `vip-missing-${randomUUID()}`
  await assert.rejects(() => seedDefaultVipTiers(db, unknown), /not found/)
  assert.deepEqual(await list(db, unknown), [])
})

test('simultaneous seed transactions create only one set of defaults', async () => {
  const tenant = `vip-race-test-${randomUUID()}`
  // Independent connections must see the fixture, so this one case commits it
  // temporarily and cleans up only its own UUID namespace in finally.
  await db.insert(whitelabels).values({ id: tenant, name: 'VIP Race Test', domain: `${tenant}.invalid` })
  try {
    const results = await Promise.all([seedDefaultVipTiers(db, tenant), seedDefaultVipTiers(db, tenant)])
    assert.deepEqual(results.map(result => result.created.length).sort(), [0, 4])
    const tiers = await list(db, tenant)
    assert.equal(tiers.length, 4)
    assert.equal(new Set(tiers.map(tier => tier.level)).size, 4)
    assert.equal((await db.select().from(vipAuditTable).where(eq(vipAuditTable.tenant, tenant))).length, 4)
  } finally {
    await db.transaction(async tx => {
      await tx.delete(vipAuditTable).where(and(eq(vipAuditTable.tenant, tenant), eq(vipAuditTable.actor, 'seed')))
      await tx.delete(vipTiersTable).where(eq(vipTiersTable.tenant, tenant))
      await tx.delete(whitelabels).where(eq(whitelabels.id, tenant))
    })
  }
})
