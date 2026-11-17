/**
 * Player read paths of stored images after Amazon S3 was removed (owner 2026-11-04): a data URI or an external URL is
 * returned as stored; a legacy S3 key or S3 URL, which can no longer be fetched, reads as null, so the app shows no
 * image instead of a broken one (an advertisement without an image is left out, as before).
 *
 * Runs against the isolated QA database (tmp/domain-visibility-integration-fixtures.ts), inside a transaction that is
 * always rolled back.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/storedAssetReads.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../tmp/domain-visibility-integration-fixtures.js'
import { displayableAsset } from '@shared/utils/dataUri.js'
const guard = isolateDatabase()
const { db, pool } = await import('../db/client.js')
const { getAppSettings, listAdvertisements, getCasinoCategoriesList } = await import('./userAppRepo.js')
const { userAppQueryResolvers } = await import('../domains/userApp/resolvers/queries.js')
const { userAppMutationResolvers } = await import('../domains/userApp/resolvers/mutations.js')
const { seedDefaultVipTiers } = await import('@shared/vip/defaultTiers.js')
test.before(() => guard(pool))
test.after(() => pool.end())
test.afterEach(() => mock.restoreAll())

const DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const EXTERNAL = 'https://cdn.example.com/vfyog/banner.png'
const S3_KEY = 'whitelabels/logos/1773750188117-f2f2.png'
const S3_URL = 'https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/whitelabels/favicons/x.png'

test('displayableAsset keeps data URIs and external URLs, and reads legacy S3 values, sentinels and blanks as null', () => {
  assert.equal(displayableAsset(DATA), DATA)
  assert.equal(displayableAsset(EXTERNAL), EXTERNAL)
  for (const legacy of [S3_KEY, S3_URL, 'welivepay', 'manual', 'proof-missing', '', null, undefined]) {
    assert.equal(displayableAsset(legacy), null, String(legacy))
  }
})

test('settings, advertisements and casino category icons never send a legacy S3 value', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    await tx.update(t.whitelabels).set({ logoUrl: S3_KEY, faviconUrl: DATA }).where(eq(t.whitelabels.id, f.tenant))
    await tx.update(t.appConfigs).set({ preLoginBannerUrl: S3_URL, postLoginBannerUrl: EXTERNAL }).where(eq(t.appConfigs.whitelabelId, f.tenant))
    await tx.insert(t.advertisements).values([
      { whitelabelId: f.tenant, title: 'vfyog inline', imageUrl: DATA, order: 1 },
      { whitelabelId: f.tenant, title: 'vfyog legacy', imageUrl: S3_KEY, order: 2 },
      { whitelabelId: f.tenant, title: 'vfyog external', imageUrl: EXTERNAL, order: 3 },
    ])
    await tx.insert(t.casinoCategories).values([
      { tenantId: f.tenant, mainCategory: 'casino', name: 'vfyog Inline', slug: 'vfyog-inline', iconData: DATA, order: 1 },
      { tenantId: f.tenant, mainCategory: 'casino', name: 'vfyog Legacy', slug: 'vfyog-legacy', iconData: S3_KEY, order: 2 },
    ])
    routeDbToTransaction(mock, db, tx)

    const settings = new Map((await getAppSettings(f.tenant)).map((entry: any) => [entry.key, entry.value]))
    assert.equal(settings.has('logoUrl'), false, 'a legacy logo is not sent: the app shows its fallback')
    assert.equal(settings.get('faviconUrl'), DATA)
    assert.equal(settings.has('preLoginBannerUrl'), false)
    assert.equal(settings.get('postLoginBannerUrl'), EXTERNAL)

    const ads = await listAdvertisements(f.tenant)
    assert.deepEqual(ads.map((ad) => [ad.title, ad.image]), [['vfyog inline', DATA], ['vfyog external', EXTERNAL]])

    const icons = await getCasinoCategoriesList({ tenant: f.tenant })
    assert.deepEqual(icons.map((c) => [c.name, c.iconData]), [['vfyog Inline', DATA], ['vfyog Legacy', null]])
    mock.restoreAll()
  })
})

test('a deposit account QR is shown when stored inline or external, and not at all for a legacy S3 value', async () => {
  await rollback(db, async (tx) => {
    const f = await fixture(tx)
    await tx.update(t.whitelabels).set({ vipStartedAt: new Date(Date.now() - 60_000) }).where(eq(t.whitelabels.id, f.tenant))
    await seedDefaultVipTiers(tx, f.tenant)
    await tx.insert(t.whitelabelPaymentMethods).values({ tenant: f.tenant, limits: { min: 10, max: 500000 }, bankDetails: [], upiDetails: [
      { id: 'upi-inline', enabled: true, upiId: 'inline@vfyog', displayName: 'vfyog inline', qrKey: DATA },
      { id: 'upi-legacy-key', enabled: true, upiId: 'key@vfyog', displayName: 'vfyog legacy key', qrKey: S3_KEY },
      { id: 'upi-legacy-url', enabled: true, upiId: 'url@vfyog', displayName: 'vfyog legacy url', qrUrl: S3_URL },
      { id: 'upi-external', enabled: true, upiId: 'ext@vfyog', displayName: 'vfyog external', qrUrl: EXTERNAL },
    ] })
    const player = await f.player('REGULAR')
    routeDbToTransaction(mock, db, tx)
    const ctx = { auth: { userId: player.id, tenant: f.tenant, requestTenant: f.tenant } } as any
    const result = await userAppQueryResolvers.adminAccounts(null, {}, ctx)
    const qr = new Map(result.data.map((account: any) => [account.id, account.qrUrl]))
    // An inline QR travels as a cacheable site asset, not inside every response.
    assert.match(String(qr.get('upi-inline')), new RegExp(`^/api/site-assets/${f.tenant}/payments/[a-f0-9]{64}$`))
    assert.equal(qr.get('upi-legacy-key'), null)
    assert.equal(qr.get('upi-legacy-url'), null)
    assert.equal(qr.get('upi-external'), EXTERNAL)
    // The older getAdminAccounts mutation sends the stored link only, and never a legacy S3 one.
    const legacy = await userAppMutationResolvers.getAdminAccounts(null, {}, ctx)
    const links = new Map(legacy.data.map((account: any) => [account.id, account.qrUrl]))
    assert.equal(links.get('upi-legacy-url'), null)
    assert.equal(links.get('upi-external'), EXTERNAL)
    mock.restoreAll()
  })
})
