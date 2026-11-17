import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldCreditOnWebhook } from './welivepayOrdersRepo.js'

const base = { status: 'pending', amount: '100.00' }

test('shouldCreditOnWebhook credits when status=success, pending, amount matches', () => {
  assert.deepEqual(shouldCreditOnWebhook(base, 'success', 100), { credit: true })
})
test('shouldCreditOnWebhook does not credit on amount mismatch', () => {
  assert.deepEqual(shouldCreditOnWebhook(base, 'success', 99), { credit: false, reason: 'amount_mismatch' })
})
test('shouldCreditOnWebhook does not credit when already processed', () => {
  assert.deepEqual(shouldCreditOnWebhook({ status: 'success', amount: '100.00' }, 'success', 100), { credit: false, reason: 'already_processed' })
  assert.deepEqual(shouldCreditOnWebhook({ status: 'expired', amount: '100.00', depositRequestId: 7 }, 'success', 100), { credit: false, reason: 'already_processed' })
})
test('shouldCreditOnWebhook does not credit on non-success status', () => {
  assert.deepEqual(shouldCreditOnWebhook(base, 'expired', 100), { credit: false, reason: 'not_success' })
})
test('a verified late payment credits an expired or never-started order once', () => {
  assert.deepEqual(shouldCreditOnWebhook({ status: 'expired', amount: '100.00', depositRequestId: null }, 'success', 100), { credit: true })
  assert.deepEqual(shouldCreditOnWebhook({ status: 'invalid', amount: '100.00' }, 'success', 100), { credit: true })
})
