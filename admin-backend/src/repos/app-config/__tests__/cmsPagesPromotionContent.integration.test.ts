/**
 * MAR-14 follow-up: Promotions > Content keeps its blocks in cms_pages (slug promotions/<uuid>),
 * behind promotions.content. The generic CMS page API (cmsPages / cmsPage / upsertCMSPage /
 * publishCMSPage / deleteCMSPage, gated on config.app and config.cms) could list, read, edit,
 * publish and delete those blocks too. It now leaves the namespace alone and still serves every
 * other page. Against the isolated Matka QA database, inside a transaction that is rolled back.
 *   node --env-file-if-exists=.env --test --import tsx src/repos/app-config/__tests__/cmsPagesPromotionContent.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const cms = await import('../cmsRepo.js')
const { createPromotionContentDb } = await import('../../marketing/promotionsRepo.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

test('the generic CMS page API leaves promotion content blocks alone', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const block = await createPromotionContentDb(f.tenant, { name: 'vfyho Diwali banner', locale: 'en', body: '<p>block</p>' })
    const { id: pageId } = await cms.upsertCmsPageDb(f.tenant, { slug: 'vfyho-about', title: 'vfyho About', body: '<p>page</p>' })
    const stored = async (id: number) => (await tx.select().from(t.cmsPages).where(eq(t.cmsPages.id, id)))[0]

    // Reads: only the ordinary page.
    assert.deepEqual((await cms.listCmsPagesDb(f.tenant)).map((p: any) => p.id), [pageId])
    assert.equal(await cms.getCmsPageByIdDb(f.tenant, block.id), undefined)
    assert.equal(await cms.getCmsPageBySlugDb(f.tenant, block.slug), undefined)
    assert.equal((await cms.getCmsPageByIdDb(f.tenant, pageId!))?.slug, 'vfyho-about')

    // Writes by id do not reach the block.
    await cms.upsertCmsPageDb(f.tenant, { id: block.id, slug: 'vfyho-renamed', title: 'Taken over' })
    await cms.publishCmsPageDb(f.tenant, block.id)
    await cms.deleteCmsPageDb(f.tenant, block.id)
    const after = await stored(block.id)
    assert.ok(after, 'the block still exists')
    assert.deepEqual([after.slug, after.title, after.status], [block.slug, 'vfyho Diwali banner', 'DRAFT'])

    // No page is created in the prefix or moved into it.
    await assert.rejects(cms.upsertCmsPageDb(f.tenant, { slug: 'promotions/vfyho', title: 'x' }), /belong to Promotions > Content/)
    await assert.rejects(cms.upsertCmsPageDb(f.tenant, { id: pageId, slug: 'promotions/vfyho', title: 'x' }), /belong to Promotions > Content/)
    assert.equal((await stored(pageId!)).slug, 'vfyho-about')

    // The ordinary page still publishes and deletes.
    await cms.publishCmsPageDb(f.tenant, pageId!)
    assert.equal((await stored(pageId!)).status, 'PUBLISHED')
    await cms.deleteCmsPageDb(f.tenant, pageId!)
    assert.equal(await stored(pageId!), undefined)
  })
})

test('the CMS mutations say not found, and record nothing, for an id they did not change (MAR-08 for CMS pages)', async () => {
  // Measured before: publishCMSPage and deleteCMSPage answered success "Published" / "Deleted", and wrote an
  // audit row, for another tenant's page, a missing id and a promotion block, none of which they touched.
  const { appConfigMutationResolvers: m } = await import('../../../domains/app-config/resolvers/mutations.js')
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const other = await fixture(tx)
    const block = await createPromotionContentDb(f.tenant, { name: 'vfyho block', locale: 'en', body: '<p>block</p>' })
    const { id: pageId } = await cms.upsertCmsPageDb(f.tenant, { slug: 'vfyho-terms', title: 'vfyho Terms' })
    const { id: otherId } = await cms.upsertCmsPageDb(other.tenant, { slug: 'vfyho-other', title: 'vfyho Other' })
    const stored = async (id: number) => (await tx.select().from(t.cmsPages).where(eq(t.cmsPages.id, id)))[0]
    const admin = (tenant: string) => ({
      user: { sub: '987650', roles: ['Whitelabel Admin'], type: 'admin' },
      permissions: [{ domain: 'config.cms', actions: ['create', 'update', 'delete'] }],
      tenant,
      whitelabel: { id: tenant },
    })
    const NOT_FOUND = { success: false, message: 'CMS page not found' }

    // '2147483648' is one past cms_pages.id's int4 range: it names no page, and must not reach Postgres as a number.
    for (const id of [String(otherId), '999999999', '2147483648', String(block.id), 'abc', '0', '1.5']) {
      assert.deepEqual(await m.publishCMSPage(null, { id }, admin(f.tenant)), NOT_FOUND, `publish ${id}`)
      assert.deepEqual(await m.deleteCMSPage(null, { id }, admin(f.tenant)), NOT_FOUND, `delete ${id}`)
      assert.deepEqual(await m.upsertCMSPage(null, { input: { id, slug: 'vfyho-edit', title: 'Taken over' } }, admin(f.tenant)), NOT_FOUND, `edit ${id}`)
    }
    const otherPage = await stored(otherId!)
    assert.deepEqual([otherPage.slug, otherPage.title, otherPage.status], ['vfyho-other', 'vfyho Other', 'DRAFT'], 'the other tenant’s page is untouched')
    assert.equal((await stored(block.id)).status, 'DRAFT', 'the promotion block is untouched')
    const audits = await tx.select().from(t.auditLogs).where(eq(t.auditLogs.tenant, f.tenant))
    assert.deepEqual(audits, [], 'no audit row for a change that did not happen')

    // The repository answers what it did: the page publishes and deletes once; a second delete changes nothing.
    assert.equal((await cms.publishCmsPageDb(f.tenant, pageId!)).success, true)
    assert.equal((await cms.upsertCmsPageDb(f.tenant, { id: pageId!, slug: 'vfyho-terms', title: 'vfyho Terms 2' })).success, true)
    assert.equal((await cms.deleteCmsPageDb(f.tenant, pageId!)).success, true)
    assert.equal((await cms.deleteCmsPageDb(f.tenant, pageId!)).success, false)
    assert.equal((await cms.publishCmsPageDb(f.tenant, pageId!)).success, false)
    assert.equal((await cms.publishCmsPageDb(f.tenant, otherId!)).success, false)
  })
})
