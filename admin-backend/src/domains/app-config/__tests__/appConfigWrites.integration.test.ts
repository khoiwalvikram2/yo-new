/**
 * App Configuration writes that reported success and changed nothing (SYS-02, SYS-03, SYS-17).
 *
 * - SYS-02/03: updateAppConfig read an explicit null as "not sent" (`value ?? undefined`), so Remove Banner,
 *   or clearing the SEO title/description/OG image, answered "Configuration updated" while the stored value
 *   stayed; and a cleared Support Email ('') was refused as an invalid address.
 * - SYS-17: updateAdvertisement/deleteAdvertisement on an id that is not the caller's tenant's changed nothing
 *   (the SQL is tenant-scoped) but answered success and wrote an audit event for it.
 *
 * Driven through the real resolvers in two throwaway `vfyfix-` tenants; their app_configs and advertisements
 * rows are removed afterwards (audit rows are left alone). Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const T = `vfyfix-appcfg-${STAMP}`
const U = `vfyfix-appcfg-u-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any>
const ctxFor = (tenant: string) => ({
  user: { sub: '1', name: 'vfyfix', roles: [], type: 'admin' },
  permissions: [{ domain: 'config', actions: ['read', 'write'] }],
  tenant,
  whitelabel: { id: tenant },
})
const update = (input: Record<string, unknown>, tenant = T) => Mutation.updateAppConfig(undefined, { input }, ctxFor(tenant))
const stored = async () => (await db.execute(sql`SELECT support_email, support_phone, seo_title, seo_description, og_image_url,
  pre_login_banner_url, post_login_banner_url FROM app_configs WHERE whitelabel_id = ${T}`)).rows[0] as Record<string, string | null>

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ appConfigMutationResolvers: Mutation } = await import('@src/domains/app-config/resolvers/mutations.js'))
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM advertisements WHERE whitelabel_id IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM app_configs WHERE whitelabel_id IN (${T}, ${U})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('an optional setting can be cleared, and an absent one is kept (SYS-02, SYS-03)', () => {
  it('stores the values to clear', async () => {
    const out = await update({
      supportEmail: 'help@vfyfix.test', supportPhone: '+91 90000 00000', seoTitle: 'vfyfix title', seoDescription: 'vfyfix description',
      ogImageUrl: 'https://vfyfix.test/og.png', preLoginBannerUrl: 'data:image/png;base64,UFJF', postLoginBannerUrl: 'data:image/png;base64,UE9TVA==',
    })
    assert.equal(out.success, true)
    assert.equal((await stored()).pre_login_banner_url, 'data:image/png;base64,UFJF')
  })

  it('Remove Banner (null) removes that banner only', async () => {
    assert.equal((await update({ preLoginBannerUrl: null })).success, true)
    const row = await stored()
    assert.equal(row.pre_login_banner_url, null, 'the removed banner is still stored')
    assert.equal(row.post_login_banner_url, 'data:image/png;base64,UE9TVA==')
  })

  it('clearing the SEO fields (null) clears them', async () => {
    assert.equal((await update({ seoTitle: null, seoDescription: null, ogImageUrl: null })).success, true)
    const row = await stored()
    assert.deepEqual([row.seo_title, row.seo_description, row.og_image_url], [null, null, null])
  })

  it("a cleared Support Email ('') is accepted and clears it, and fields not sent are kept", async () => {
    assert.equal((await update({ supportEmail: '' })).success, true)
    const row = await stored()
    assert.equal(row.support_email, null)
    assert.equal(row.support_phone, '+91 90000 00000')
    assert.equal(row.post_login_banner_url, 'data:image/png;base64,UE9TVA==')
  })

  it('an address that is not one is still refused', async () => {
    await assert.rejects(update({ supportEmail: 'not an address' }), /supportEmail/)
  })
})

describe("another tenant's advertisement is not found, and nothing is recorded (SYS-17)", () => {
  let adId = ''
  const auditRows = async (tenant: string) =>
    Number(((await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant = ${tenant} AND resource_type = 'Advertisement' AND resource_id = ${adId}`)).rows[0] as any).n)

  before(async () => {
    const created = await Mutation.createAdvertisement(undefined, { input: { title: 'vfyfix ad', imageUrl: 'data:image/png;base64,QUQ=', type: 'BANNER', status: 'INACTIVE' } }, ctxFor(T))
    assert.equal(created.success, true)
    adId = String(((await db.execute(sql`SELECT id FROM advertisements WHERE whitelabel_id = ${T} AND title = 'vfyfix ad'`)).rows[0] as any).id)
  })

  it('update and delete from another tenant answer "not found" and change nothing', async () => {
    const updated = await Mutation.updateAdvertisement(undefined, { input: { id: adId, title: 'vfyfix hijacked' } }, ctxFor(U))
    assert.deepEqual(updated, { success: false, message: 'Advertisement not found' })
    const deleted = await Mutation.deleteAdvertisement(undefined, { id: adId }, ctxFor(U))
    assert.deepEqual(deleted, { success: false, message: 'Advertisement not found' })
    const row = (await db.execute(sql`SELECT title FROM advertisements WHERE id = ${Number(adId)}`)).rows[0] as any
    assert.equal(row?.title, 'vfyfix ad')
    assert.equal(await auditRows(U), 0, 'a change that did not happen was recorded')
  })

  it('a reorder naming an id that is not this tenant\'s is refused whole', async () => {
    const out = await Mutation.reorderAdvertisements(undefined, { orders: [{ id: adId, order: 7 }, { id: '987654321', order: 8 }] }, ctxFor(T))
    assert.deepEqual(out, { success: false, message: 'Advertisement not found' })
    const row = (await db.execute(sql`SELECT "order" FROM advertisements WHERE id = ${Number(adId)}`)).rows[0] as any
    assert.notEqual(Number(row.order), 7, 'the reorder was half applied')
  })

  it('the owner still updates and deletes it', async () => {
    assert.equal((await Mutation.updateAdvertisement(undefined, { input: { id: adId, title: 'vfyfix ad 2' } }, ctxFor(T))).success, true)
    assert.equal((await Mutation.deleteAdvertisement(undefined, { id: adId }, ctxFor(T))).success, true)
    assert.equal((await db.execute(sql`SELECT 1 FROM advertisements WHERE id = ${Number(adId)}`)).rows.length, 0)
  })
})
