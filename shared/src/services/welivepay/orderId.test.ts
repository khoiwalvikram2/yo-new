import test from 'node:test'
import assert from 'node:assert/strict'
import { generateOrderId, isValidOrderId } from './orderId.js'

test('generateOrderId builds an id >= 10 chars containing the userId', () => {
  const id = generateOrderId(42, 1717000000000, 'abc123')
  assert.equal(id, 'ORDER_42_1717000000000_abc123')
  assert.ok(id.length >= 10)
})

test('generateOrderId ids are unique per random suffix', () => {
  const a = generateOrderId(1, 1717000000000, 'aaa')
  const b = generateOrderId(1, 1717000000000, 'bbb')
  assert.notEqual(a, b)
})

test('isValidOrderId validates length >= 10', () => {
  assert.equal(isValidOrderId('ORDER_1_1_2'), true)
  assert.equal(isValidOrderId('short'), false)
  assert.equal(isValidOrderId(''), false)
})
