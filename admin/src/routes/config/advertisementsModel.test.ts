import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { advertisementInput, advertisementSchema, advertisementValues, filterAdvertisements,
  reorderAdvertisements, sortAdvertisements, type Advertisement } from './advertisementsModel'

const ad: Advertisement = { id: 'a', title: 'Welcome bonus', subtitle: 'New players', type: 'BANNER', status: 'ACTIVE', deviceType: 'BOTH', imageUrl: 'https://example.test/image.png', order: 3 }

describe('advertisement contracts', () => {
  test('create defaults and edit hydration preserve nullable fields and case-insensitive status', () => {
    assert.deepEqual(advertisementValues(), { title: '', subtitle: '', imageUrl: '', type: 'BANNER', deviceType: 'BOTH', url: '', order: null, status: true })
    assert.equal(advertisementValues({ ...ad, status: 'active' }).status, true)
    assert.equal(advertisementValues({ ...ad, status: 'INACTIVE' }).status, false)
  })
  test('payload retains nulls, trimmed URL, zero order and plain-string compressed image', () => {
    assert.deepEqual(advertisementInput({ ...advertisementValues(ad), subtitle: '', url: ' /casino ', order: 0, status: false }), {
      title: 'Welcome bonus', subtitle: null, type: 'BANNER', url: '/casino', order: 0,
      status: 'INACTIVE', deviceType: 'BOTH', imageUrl: 'https://example.test/image.png',
    })
  })
  test('validation requires title and image and keeps the original accepted URL prefixes', () => {
    const values = advertisementValues(ad)
    for (const url of ['', ' ', '/casino', 'https://example.test', 'http://example.test'])
      assert.ok(advertisementSchema.safeParse({ ...values, url }).success)
    assert.equal(advertisementSchema.safeParse({ ...values, url: 'javascript:test' }).success, false)
    assert.equal(advertisementSchema.safeParse({ ...values, imageUrl: '' }).success, false)
    assert.equal(advertisementSchema.safeParse({ ...values, title: '' }).success, false)
  })
  test('search includes subtitle, trims whitespace and intersects device/type filters', () => {
    assert.deepEqual(filterAdvertisements([ad], { type: '', deviceType: '', query: ' PLAYERS ' }), [ad])
    assert.deepEqual(filterAdvertisements([ad], { type: 'PROMOTIONAL', deviceType: '', query: '' }), [])
    assert.deepEqual(filterAdvertisements([ad], { type: '', deviceType: 'MOBILE', query: '' }), [])
  })
  test('drag reorder sorts existing order first, uses one-based payloads and does not mutate records', () => {
    const b = { ...ad, id: 'b', order: 1 }, c = { ...ad, id: 'c', order: 2 }
    const source = [ad, b, c]
    assert.deepEqual(sortAdvertisements(source).map((row) => row.id), ['b', 'c', 'a'])
    assert.deepEqual(reorderAdvertisements(source, 'a', 'b'), [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }])
    assert.deepEqual(source.map((row) => row.order), [3, 1, 2])
    assert.equal(reorderAdvertisements(source, 'missing', 'a'), null)
    assert.equal(reorderAdvertisements(source, 'a', 'a'), null)
  })
})
