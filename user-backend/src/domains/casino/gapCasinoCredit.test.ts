import assert from 'node:assert/strict'
import test from 'node:test'
import { mapCasinoSettlementToCredit } from './gapCasinoService.js'

// Pure-function tests for the casino credit settlement mapping.
// pl = grossCredit - stake. release adds payoutAmount to settlement on 'win'
// and subtracts it on 'loss', so net available change == net P&L of the bet.

test('mapCasinoSettlementToCredit: net win (grossCredit > stake) -> win with positive net pl', () => {
  const r = mapCasinoSettlementToCredit(100, 250)
  assert.deepEqual(r, { betResult: 'win', payoutAmount: 150 })
})

test('mapCasinoSettlementToCredit: partial loss (grossCredit < stake) -> loss with abs net pl', () => {
  const r = mapCasinoSettlementToCredit(100, 40)
  assert.deepEqual(r, { betResult: 'loss', payoutAmount: 60 })
})

test('mapCasinoSettlementToCredit: exact break-even (grossCredit == stake) -> win with payout 0', () => {
  const r = mapCasinoSettlementToCredit(100, 100)
  assert.deepEqual(r, { betResult: 'win', payoutAmount: 0 })
})

test('mapCasinoSettlementToCredit: total loss (grossCredit == 0) -> loss with payout == stake', () => {
  const r = mapCasinoSettlementToCredit(100, 0)
  assert.deepEqual(r, { betResult: 'loss', payoutAmount: 100 })
})
