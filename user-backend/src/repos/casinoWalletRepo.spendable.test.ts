import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertCasinoCashStakeWithinSpendable,
  getCasinoSpendableCashBalance,
} from './casinoWalletRepo.js'

test('getCasinoSpendableCashBalance is cash minus exposure', () => {
  assert.equal(getCasinoSpendableCashBalance({ cash: '1000', exposure: '200' }), 800)
})

test('assertCasinoCashStakeWithinSpendable throws when stake exceeds spendable', () => {
  assert.throws(
    () => assertCasinoCashStakeWithinSpendable({ cash: '100', exposure: '80' }, 50),
    /Insufficient available balance/
  )
})

test('assertCasinoCashStakeWithinSpendable allows stake at boundary', () => {
  assert.doesNotThrow(() =>
    assertCasinoCashStakeWithinSpendable({ cash: '100', exposure: '80' }, 20)
  )
})
