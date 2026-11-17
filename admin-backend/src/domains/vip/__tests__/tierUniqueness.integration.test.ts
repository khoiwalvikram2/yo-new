/**
 * A tenant's VIP tiers keep one tier per level and per name, and the Validation card checks
 * the tenant's real tiers (MAR-12).
 *
 * Measured before: createVIPTier { name 'vfychk Tier', level 4 } was accepted next to
 * grandwinn's Platinum (level 4), and while both rows existed vipTierValidate still answered []
 * for every caller: it walked the in-memory mock tiers, never vip_tiers.
 *
 * Driven through the real guarded VIP resolvers against one throwaway `vfyfix-` tenant; its
 * tiers and vip_audit rows are removed afterwards. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const T = `vfyfix-vip-${randomUUID().replace(/-/g, '').slice(0, 6)}`

let db: (typeof import('@src/db/client.js'))['db']
let Query: Record<string, any> = {}
let Mutation: Record<string, any> = {}
const ids: Record<string, string> = {}

const ctx = {
  user: { sub: '987653', id: '987653', name: 'vfyfix vip', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [{ domain: 'vip.tiers', actions: ['view', 'create', 'update', 'delete'] }],
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
}
const m = async (field: string, args: Record<string, unknown>) => Mutation[field](undefined, args, ctx, {})
const tierInput = (name: string, level: number, minMonthlyDeposit: number) =>
  ({ name, level, minMonthlyDeposit, color: '#cd7f32', benefits: [], perks: [] })

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { vipResolvers } = await import('@src/domains/vip/resolvers/index.js')
  ;({ Query, Mutation } = vipResolvers as any)
  const { createVipTierDb } = await import('@src/repos/vip/vipRepo.js')
  for (const [name, level, deposit] of [['Bronze', 1, 0], ['Silver', 2, 10_000], ['Platinum', 4, 100_000]] as const) {
    const tier = await createVipTierDb({ tenant: T, ...tierInput(name, level, deposit), status: 'active' })
    ids[name] = tier!.id
  }
})

after(async () => {
  if (!db) return
  await db.execute(sql`DELETE FROM vip_audit WHERE tenant = ${T}`)
  await db.execute(sql`DELETE FROM vip_tier_benefits WHERE tier_id IN (SELECT id FROM vip_tiers WHERE tenant = ${T})`)
  await db.execute(sql`DELETE FROM vip_tier_perks WHERE tier_id IN (SELECT id FROM vip_tiers WHERE tenant = ${T})`)
  await db.execute(sql`DELETE FROM vip_tiers WHERE tenant = ${T}`)
})

const levels = async () =>
  ((await db.execute(sql`SELECT name, level FROM vip_tiers WHERE tenant = ${T} ORDER BY level, name`)).rows as any[]).map(r => `${r.name}:${r.level}`)

describe('VIP tier levels and names stay unique per tenant', () => {
  it('refuses a new tier at a level the tenant already uses, and writes nothing', async () => {
    const res = await m('createVIPTier', { input: tierInput('vfyfix Tier', 4, 999_999_999) })
    assert.deepEqual(res, {
      success: false,
      message: "Level 4 is already used by the Platinum tier. Choose another level, or change Platinum's level first.",
      tier: null,
    })
    assert.deepEqual(await levels(), ['Bronze:1', 'Silver:2', 'Platinum:4'])
  })

  it('refuses a new tier named like an existing one, whatever the case', async () => {
    const res = await m('createVIPTier', { input: tierInput(' silver ', 3, 50_000) })
    assert.equal(res.success, false)
    assert.equal(res.message, 'A tier named "Silver" already exists. Choose another name.')
  })

  it('still creates a tier at a free level', async () => {
    const res = await m('createVIPTier', { input: tierInput('Gold', 3, 50_000) })
    assert.equal(res.success, true, res.message)
    ids.Gold = res.tier.id
    assert.deepEqual(await levels(), ['Bronze:1', 'Silver:2', 'Gold:3', 'Platinum:4'])
  })

  it('lets a tier be saved with its own level, and refuses another tier\'s', async () => {
    const same = await m('updateVIPTier', { id: ids.Gold, input: { name: 'Gold', level: 3, minMonthlyDeposit: 60_000 } })
    assert.equal(same.success, true, same.message)

    const taken = await m('updateVIPTier', { id: ids.Gold, input: { level: 2 } })
    assert.equal(taken.success, false)
    assert.match(taken.message, /^Level 2 is already used by the Silver tier/)
    assert.deepEqual(await levels(), ['Bronze:1', 'Silver:2', 'Gold:3', 'Platinum:4'])
  })
})

describe('vipTierValidate checks the tenant tiers', () => {
  it('answers no issues for a sound ladder', async () => {
    assert.deepEqual(await Query.vipTierValidate(undefined, {}, ctx), [])
  })

  it('reports a duplicate name the database holds', async () => {
    // A duplicate written around the resolver (an old row, or a concurrent save). A duplicate level
    // can no longer be written at all: vip_tiers_tenant_level_unique (migration 0020) refuses it, and
    // the DUP_LEVEL rule itself is covered in tierValidation.test.ts. Names have no index.
    await db.execute(sql`INSERT INTO vip_tiers (tenant, name, level, min_monthly_deposit, color, status) VALUES (${T}, ' GOLD', 5, 999999999, '#000000', 'active')`)
    const issues = await Query.vipTierValidate(undefined, {}, ctx)
    assert.deepEqual(issues.map((i: any) => [i.code, i.message]), [['DUP_NAME', 'Duplicate name " GOLD": also used by the level 3 tier']])
  })

  it('stays gated on vip.tiers:view', async () => {
    await assert.rejects(async () => Query.vipTierValidate(undefined, {}, { ...ctx, permissions: [] }), /vip\.tiers:view/)
  })
})
