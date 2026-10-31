import { test } from 'vitest'
import assert from 'node:assert/strict'
import { effectiveCommission, rawAmount } from './agentHomeModel'
test('effective zero wins over a non-zero original calculated amount', () => {
  assert.equal(effectiveCommission({ effectiveCalculatedTotal: 0, calculatedTotal: 9000 }), 0)
  assert.equal(effectiveCommission({ effectiveCalculatedTotal: null, calculatedTotal: -125 }), -125)
})
test('raw credit values preserve sign, decimals and do not add a currency conversion', () => {
  assert.equal(rawAmount(-1250.5, '₹'), '₹-1,250.50')
  assert.equal(rawAmount(0, '₹'), '₹0.00')
})
