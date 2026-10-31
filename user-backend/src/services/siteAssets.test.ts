import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeSiteImage, SiteAssetCache, settingsVersion, siteAssetUrl } from './siteAssets.js'

test('inline images retain exact decoded bytes and stable content-addressed URLs', () => {
  const uri = 'data:image/png;base64,' + Buffer.from('fixture image bytes').toString('base64')
  const decoded = decodeSiteImage(uri)!
  assert.equal(decoded.bytes.toString(), 'fixture image bytes')
  assert.equal(siteAssetUrl(uri, 'tenant-a', 'settings'), siteAssetUrl(uri, 'tenant-a', 'settings'))
  assert.notEqual(siteAssetUrl(uri, 'tenant-a', 'settings'), siteAssetUrl(uri, 'tenant-b', 'settings'))
  assert.equal(decodeSiteImage('data:image/svg+xml,%3Csvg%2F%3E')?.bytes.toString(), '<svg/>')
  assert.equal(siteAssetUrl('https://example.test/image.png', 'tenant-a', 'settings'), 'https://example.test/image.png')
})
test('asset decoder rejects active documents, malformed data and oversized payloads', () => {
  assert.equal(decodeSiteImage('data:text/html;base64,PHNjcmlwdD4='), null)
  assert.equal(decodeSiteImage('data:image/png;base64,'), null)
  assert.equal(decodeSiteImage('data:image/svg+xml,%not-an-escape'), null)
  assert.equal(decodeSiteImage('data:image/png;base64,' + 'A'.repeat(13 * 1024 * 1024)), null)
})
test('bounded LRU cache evicts the least recently read image', () => {
  const asset = decodeSiteImage('data:image/png;base64,YWJj')!, cache = new SiteAssetCache(6)
  cache.put('a', asset); cache.put('b', asset); cache.get('a'); cache.put('c', asset)
  assert.ok(cache.get('a')); assert.equal(cache.get('b'), undefined); assert.ok(cache.get('c'))
})
test('settings revisions change with effective user/site configuration', () => {
  assert.equal(settingsVersion([{ key: 'hideDW', value: 'false' }]), settingsVersion([{ key: 'hideDW', value: 'false' }]))
  assert.notEqual(settingsVersion([{ key: 'hideDW', value: 'false' }]), settingsVersion([{ key: 'hideDW', value: 'true' }]))
})
