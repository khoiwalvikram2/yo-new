import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { bundleWeightRecord, bundleWeightsChanged, clampBundleWeight, validBundleIds } from './casinoGameBundlesModel'
describe('bundle list mechanics', () => {
  test('retains numeric-id normalization and matka UUID filtering', () => {
    assert.deepEqual(validBundleIds([123, ' 456 ', '0', 'bad', null, 'undefined'], 'casino'), ['123', '456'])
    assert.deepEqual(validBundleIds([' market-id ', 'null', 'undefined', '', 123], 'matka'), ['market-id', '123'])
  })
  test('weight normalization preserves explicit zero, converts numbers and fills missing games with one', () => {
    assert.deepEqual(bundleWeightRecord({ a: 0, b: '0.2', c: NaN }, ['a', 'b', 'c', 'd']), { a: 0, b: 0.2, c: 1, d: 1 })
  })
  test('dirty detection preserves the floating-point tolerance and complete-key comparison', () => {
    assert.equal(bundleWeightsChanged({ a: 0.2 }, { a: 0.2005 }), false)
    assert.equal(bundleWeightsChanged({ a: 0.2 }, { a: 0.3 }), true)
    assert.equal(bundleWeightsChanged({ a: 1, b: 1 }, { a: 1 }), true)
    assert.equal(bundleWeightsChanged({ b: 1 }, { a: 1 }), true, 'same number of keys does not mean the same games')
  })
  test('weight edits clamp to the persisted zero-to-one range and ignore non-numeric input', () => {
    assert.equal(clampBundleWeight(-1), 0); assert.equal(clampBundleWeight(2), 1)
    assert.equal(clampBundleWeight(0.2), 0.2); assert.equal(clampBundleWeight(null), null)
  })
})
