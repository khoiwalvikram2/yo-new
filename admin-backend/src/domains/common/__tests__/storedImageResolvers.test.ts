/**
 * The admin's image read and write paths after S3 (owner decision 2026-11-04: files are stored as base64).
 *
 * Reads: advertisement images, popup banners, whitelabel logos and favicons and casino category icons are handed
 * out as stored when they are a data URI or a link, and as null when they are a legacy S3 key or S3 URL; nothing
 * is presigned. Writes: each of those fields, and the payment-method QR codes, stores a data URI of at most 2 MB
 * (or a link) and refuses an S3 key, a non-image data URI and an image past the cap, before anything is written.
 *
 * Unit: every refusal happens before a query, and every read here is a field resolver over a given row.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/common/__tests__/storedImageResolvers.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appConfigResolvers } from '../../app-config/resolvers/index.js'
import { appConfigMutationResolvers } from '../../app-config/resolvers/mutations.js'
import { casinoResolvers } from '../../casino/resolvers/index.js'
import { casinoMutationResolvers } from '../../casino/resolvers/mutations.js'
import { commonResolvers } from '../resolvers/index.js'
import { depositsMutationResolvers } from '../../deposits/resolvers/mutations.js'

after(async () => {
  const { pool } = await import('@src/db/client.js')
  await pool.end().catch(() => {})
})

const IMAGE = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const LINK = 'https://cdn.example.com/brand/logo.png'
const S3_KEY = 'advertisements/1771860453943-452799692833bd60.png'
const S3_URL = 'https://gd-bucket-s3.s3.ap-south-1.amazonaws.com/whitelabels/logos/1.png'
const TOO_LARGE = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`

const admin = (permissions: Array<{ domain: string; actions: string[] }>) => ({
  tenant: 'vfyog-brand', whitelabel: { id: 'vfyog-brand' },
  user: { sub: '1', type: 'admin', roles: [] }, permissions,
})
const superAdmin = admin([{ domain: 'all', actions: ['*'] }])

describe('image reads hand out data URIs and links, and null for anything S3 left behind', () => {
  const reads: Array<[string, (value: string | null) => unknown]> = [
    ['Advertisement.imageUrl', (v) => (appConfigResolvers as any).Advertisement.imageUrl({ imageUrl: v })],
    ['CasinoCategory.iconData', (v) => (casinoResolvers as any).CasinoCategory.iconData({ iconData: v })],
    ['Whitelabel.logoUrl', (v) => (commonResolvers as any).Whitelabel.logoUrl({ logoUrl: v })],
    ['Whitelabel.faviconUrl', (v) => (commonResolvers as any).Whitelabel.faviconUrl({ faviconUrl: v })],
  ]
  for (const [field, read] of reads) {
    it(field, async () => {
      assert.equal(await read(IMAGE), IMAGE)
      assert.equal(await read(LINK), LINK)
      assert.equal(await read(S3_KEY), null)
      assert.equal(await read(S3_URL), null)
      assert.equal(await read(null), null)
      assert.equal(await read(''), null)
    })
  }

  it('no read or write path imports the S3 module or presigns', () => {
    for (const file of [
      'domains/app-config/resolvers/index.ts',
      'domains/app-config/resolvers/queries.ts',
      'domains/app-config/resolvers/mutations.ts',
      'domains/casino/resolvers/index.ts',
      'domains/casino/resolvers/queries.ts',
      'domains/casino/resolvers/mutations.ts',
      'domains/common/resolvers/index.ts',
      'stores/whitelabelStore.ts',
      'repos/payments/whitelabelPaymentsRepo.ts',
    ]) {
      const src = readFileSync(join('src', file), 'utf8')
      assert.doesNotMatch(src, /storage\/s3|generatePresignedGetUrl|getS3ObjectUrl|deleteFromS3|uploadFileFromBase64/, file)
    }
  })
})

describe('image writes store a data URI of at most 2 MB, or a link, and refuse the rest before writing', () => {
  it('advertisements', async () => {
    const ctx = admin([{ domain: 'config.advertisements', actions: ['create', 'update'] }])
    const create = (imageUrl: string) => appConfigMutationResolvers.createAdvertisement(null, { input: { title: 'vfyog Ad', imageUrl, type: 'BANNER' } }, ctx)
    assert.deepEqual(await create(S3_KEY), { success: false, message: 'Advertisement image must be an uploaded image or an https link' })
    assert.deepEqual(await create('data:text/plain;base64,aGk='), { success: false, message: 'Advertisement image must be an image file' })
    assert.deepEqual(await create(TOO_LARGE), { success: false, message: 'Advertisement image is too large (2.1 MB); the limit is 2 MB' })
    const update = (imageUrl: string) => appConfigMutationResolvers.updateAdvertisement(null, { input: { id: '987654321', imageUrl } }, ctx)
    assert.deepEqual(await update(S3_URL), { success: false, message: 'Advertisement image must be an uploaded image or an https link' })
  })

  it('popup banners', async () => {
    const ctx = admin([{ domain: 'config.app', actions: ['update'] }])
    await assert.rejects(
      appConfigMutationResolvers.updateAppConfig(null, { input: { preLoginBannerUrl: S3_KEY } }, ctx),
      { message: 'Pre-login banner must be an uploaded image or an https link' },
    )
    await assert.rejects(
      appConfigMutationResolvers.updateAppConfig(null, { input: { postLoginBannerUrl: TOO_LARGE } }, ctx),
      { message: 'Post-login banner is too large (2.1 MB); the limit is 2 MB' },
    )
  })

  it('whitelabel logo and favicon', async () => {
    const created = await (commonResolvers as any).Mutation.createWhitelabel(null, { input: { id: 'vfyog-brand', name: 'vfyog', domain: 'vfyog.invalid', logoUrl: S3_KEY } }, superAdmin)
    assert.deepEqual(created, { success: false, message: 'Logo must be an uploaded image or an https link', whitelabel: null })
    const updated = await (commonResolvers as any).Mutation.updateWhitelabel(null, { input: { id: 'vfyog-brand', faviconUrl: TOO_LARGE } }, superAdmin)
    assert.deepEqual(updated, { success: false, message: 'Favicon is too large (2.1 MB); the limit is 2 MB', whitelabel: null })
  })

  it('casino category icons', async () => {
    const ctx = admin([{ domain: 'casino.categories', actions: ['create', 'update'] }])
    await assert.rejects(
      casinoMutationResolvers.createCasinoCategory(null, { input: { mainCategory: 'CASINO', name: 'vfyog', slug: 'vfyog', iconData: S3_KEY } }, ctx),
      { message: 'Category icon must be an uploaded image or an https link' },
    )
    await assert.rejects(
      casinoMutationResolvers.updateCasinoCategory(null, { id: '987654321', input: { iconData: TOO_LARGE } }, ctx),
      { message: 'Category icon is too large (2.1 MB); the limit is 2 MB' },
    )
  })

  it('payment-method QR codes', async () => {
    const ctx = admin([{ domain: 'payments.methods', actions: ['update'] }])
    await assert.rejects(
      depositsMutationResolvers.upsertWhitelabelPaymentMethods(null, { input: { upis: [{ upiId: 'vfyog@upi', qrKey: 'deposits/1772012489525-c35741aa5fd4a6b4.png' }] } }, ctx),
      { message: 'UPI QR code must be an uploaded image or an https link' },
    )
    await assert.rejects(
      depositsMutationResolvers.upsertWhitelabelPaymentMethods(null, { input: { cryptos: [{ network: 'TRC20', walletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', qrKey: TOO_LARGE }] } }, ctx),
      { message: 'Wallet QR code is too large (2.1 MB); the limit is 2 MB' },
    )
  })
})
