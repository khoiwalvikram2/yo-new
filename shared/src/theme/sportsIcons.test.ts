// shared/src/theme/sportsIcons.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPORTS_ICON_SLUGS, SPORTS_ICON_STYLE_OPTIONS, getSportsIconSlug, resolveSportsIconStyle } from './sportsIcons'

test('the player app sport keys and names map to the icon slugs', () => {
  assert.equal(getSportsIconSlug('cricket'), 'cricket')
  assert.equal(getSportsIconSlug('horseracing'), 'horse-racing')
  assert.equal(getSportsIconSlug('greyhoundracing'), 'greyhound-racing')
  assert.equal(getSportsIconSlug('ice-hockey'), 'ice-hockey')
  assert.equal(getSportsIconSlug('hockey'), 'ice-hockey')
  assert.equal(getSportsIconSlug('Soccer'), 'football')
  assert.equal(getSportsIconSlug('Mixed Martial Arts'), 'mma')
  for (const slug of SPORTS_ICON_SLUGS) assert.equal(getSportsIconSlug(slug), slug)
  for (const none of ['live', 'politics', '', null, undefined, 'toString', '__proto__', 'constructor']) {
    assert.equal(getSportsIconSlug(none), null, String(none))
  }
})

test('only flat and 3d are colourful styles; anything else is the default', () => {
  assert.equal(resolveSportsIconStyle('flat'), 'flat')
  assert.equal(resolveSportsIconStyle('3d'), '3d')
  for (const other of ['default', 'neon', '', null, undefined, 3]) assert.equal(resolveSportsIconStyle(other), 'default')
  assert.deepEqual(SPORTS_ICON_STYLE_OPTIONS.map((option) => option.value), ['default', 'flat', '3d'])
})
