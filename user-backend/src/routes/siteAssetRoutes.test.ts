import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import { registerSiteAssetRoutes } from './siteAssetRoutes.js'
import { siteAssetUrl } from '../services/siteAssets.js'

test('published images preserve bytes, work across the frontend/API origins and revalidate without a response body', async () => {
  const app = Fastify()
  await app.register(helmet)
  await registerSiteAssetRoutes(app)
  try {
    const bytes = Buffer.from('fixture-image-byte-parity')
    const url = siteAssetUrl(`data:image/png;base64,${bytes.toString('base64')}`, 'fixture.example', 'settings')!
    const response = await app.inject(url)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.rawPayload, bytes)
    assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.match(String(response.headers['content-security-policy']), /sandbox/)
    assert.match(String(response.headers['cache-control']), /immutable/)
    const cached = await app.inject({ url, headers: { 'if-none-match': `"another-version", ${response.headers.etag}` } })
    assert.equal(cached.statusCode, 304)
    assert.equal(cached.rawPayload.length, 0)
  } finally { await app.close() }
})

test('invalid asset paths are rejected before any source lookup and unsupported tenant paths keep their inline image', async () => {
  const app = Fastify()
  await registerSiteAssetRoutes(app)
  try {
    for (const url of ['/api/site-assets/tenant/unknown/' + 'a'.repeat(64), '/api/site-assets/tenant/settings/not-a-hash', '/api/site-assets/%3Ctenant%3E/settings/' + 'a'.repeat(64)]) {
      assert.equal((await app.inject(url)).statusCode, 404)
    }
    const image = 'data:image/png;base64,YWJj'
    assert.equal(siteAssetUrl(image, 'unsupported/tenant', 'settings'), image)
  } finally { await app.close() }
})
