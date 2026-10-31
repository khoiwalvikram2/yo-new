/**
 * The stroke ramp is the mockup's own (M:2014-2021). A call site that hard-codes a stroke is how the
 * icon weight drifts between pages, so every size band is pinned here, including its edges.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { strokeFor } from './icons'

describe('strokeFor', () => {
  test('gives the heaviest stroke up to 13px', () => {
    assert.equal(strokeFor(11), 2)
    assert.equal(strokeFor(13), 2)
  })

  test('gives 1.75 from 14 to 16px, the common row and label size', () => {
    assert.equal(strokeFor(14), 1.75)
    assert.equal(strokeFor(16), 1.75)
  })

  test('gives 1.6 from 17 to 19px', () => {
    assert.equal(strokeFor(17), 1.6)
    assert.equal(strokeFor(19), 1.6)
  })

  test('gives the lightest stroke above 19px', () => {
    assert.equal(strokeFor(20), 1.45)
    assert.equal(strokeFor(44), 1.45)
  })
})
